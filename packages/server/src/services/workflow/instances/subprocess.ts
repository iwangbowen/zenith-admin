// ─── 子流程派生、多实例扇出与父流程回填（拆分自 workflow-instances.service.ts）───
import { eq, and, inArray } from 'drizzle-orm';
import { db } from '../../../db';
import { workflowInstances, workflowTasks, workflowDefinitions, users } from '../../../db/schema';
import { validateFlowData, type TaskAction } from '../../../lib/workflow-engine';
import type { WorkflowFlowData, WorkflowEventActor } from '@zenith/shared';
import { buildStarterContext } from '../workflow-assignee-resolver.service';
import { resolveFormSnapshot } from '../workflow-forms.service';
import { createHash } from 'node:crypto';
import { isPgUniqueViolation } from '../../../lib/db-errors';
import logger from '../../../lib/logger';
import { handleNodeExecutionError } from './failure-policy';
import { assertLaunchMatchesFormType, buildInstanceFormSnapshot, mapInstance, mapTask } from './mapping';
import { advanceAndMaterialize } from './materialize';
import { emitInstanceEvent, emitNodeEvent, emitTaskEvent } from './shared';
import { approveTaskCore, rejectTaskCore } from './task-actions';

/**
 * 根据子流程节点配置的 subProcessFieldMapping，构造子实例 formData。
 * value 支持模板占位：
 * - `{{form.x}}` / `{{x}}` 引用父实例 formData 字段
 * - `{{item}}` 引用当前循环项的值（多实例）；`{{item.prop}}` 取循环项对象的属性
 */
export function buildChildFormData(
  mapping: Record<string, string> | undefined,
  parentFormData: Record<string, unknown>,
  item?: unknown,
): Record<string, unknown> {
  if (!mapping) return {};
  const resolveSingle = (rawKey: string): unknown => {
    const k = rawKey.trim();
    if (k === 'item') return item;
    if (k.startsWith('item.')) {
      const prop = k.slice(5).trim();
      return item && typeof item === 'object' ? (item as Record<string, unknown>)[prop] : undefined;
    }
    if (k.startsWith('form.')) return parentFormData[k.slice(5).trim()];
    return parentFormData[k];
  };
  const out: Record<string, unknown> = {};
  for (const [childKey, expr] of Object.entries(mapping)) {
    if (typeof expr !== 'string') continue;
    if (expr.includes('{{')) {
      const tplMatch = expr.match(/^\{\{\s*([^}]+?)\s*\}\}$/);
      if (tplMatch) {
        // 整段就是单个引用：保留原值类型
        out[childKey] = resolveSingle(tplMatch[1]);
      } else {
        out[childKey] = expr.replace(/\{\{\s*([^}]+?)\s*\}\}/g, (_, k) => {
          const v = resolveSingle(k);
          if (v == null || typeof v === 'object') return '';
          return String(v);
        });
      }
    } else {
      out[childKey] = expr;
    }
  }
  return out;
}

function stableStringify(value: unknown): string {
  if (value == null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, val]) => `${JSON.stringify(key)}:${stableStringify(val)}`);
  return `{${entries.join(',')}}`;
}

function buildSubProcessItemKey(parentTaskId: number, index: number, item: unknown): string {
  const digest = createHash('sha256')
    .update(`${parentTaskId}:${index}:${stableStringify(item)}`)
    .digest('hex');
  return digest.slice(0, 64);
}

/** 从实例的 definitionSnapshot 中按 nodeKey 解析节点配置 */
function snapshotNodeCfg(
  inst: typeof workflowInstances.$inferSelect,
  nodeKey: string,
): TaskAction['nodeConfig'] | null {
  return (inst.definitionSnapshot as { flowData?: WorkflowFlowData } | null)?.flowData?.nodes
    .find((n) => n.data.key === nodeKey)?.data ?? null;
}

/** 查找已发布的子流程定义 */
async function loadPublishedSubProcessDef(subProcessId?: number) {
  if (!subProcessId) return null;
  const [def] = await db.select().from(workflowDefinitions)
    .where(and(eq(workflowDefinitions.id, subProcessId), eq(workflowDefinitions.status, 'published')))
    .limit(1);
  return def ?? null;
}

/**
 * 解析子实例发起人：
 * - parentInitiator（默认）：沿用父流程发起人
 * - formField：取父表单字段中的用户 ID
 * - specifiedUser：取节点指定的用户 ID
 * 解析失败时回退父流程发起人。
 */
async function resolveChildInitiator(
  nodeCfg: TaskAction['nodeConfig'],
  parentInst: typeof workflowInstances.$inferSelect,
): Promise<number> {
  const fallback = parentInst.initiatorId;
  const mode = nodeCfg.subProcessInitiator ?? 'parentInitiator';
  let candidate: number | null;
  if (mode === 'specifiedUser') {
    candidate = nodeCfg.subProcessInitiatorUserId ?? null;
  } else if (mode === 'formField' && nodeCfg.subProcessInitiatorField) {
    const raw = (parentInst.formData as Record<string, unknown> | null)?.[nodeCfg.subProcessInitiatorField];
    const n = Array.isArray(raw) ? Number(raw[0]) : Number(raw);
    candidate = Number.isFinite(n) && n > 0 ? n : null;
  } else {
    return fallback;
  }
  if (candidate == null) return fallback;
  const [u] = await db.select({ id: users.id }).from(users).where(eq(users.id, candidate)).limit(1);
  return u ? u.id : fallback;
}

/**
 * 创建并初始化一个子流程实例（事务内插入 + materialize 初始任务），发射事件、调度延迟任务、
 * 递归展开子实例内部的子流程节点。返回创建后的子实例（含最终状态）。
 * 注意：不在此处发射 instance.approved/rejected（由调用方根据是否即时完结决定）。
 */
async function createChildInstanceAndMaterialize(
  parentInst: typeof workflowInstances.$inferSelect,
  parentTask: typeof workflowTasks.$inferSelect,
  def: typeof workflowDefinitions.$inferSelect,
  childFormData: Record<string, unknown>,
  childInitiatorId: number,
  childTitle: string,
  actor: WorkflowEventActor,
  opts?: { itemKey?: string; itemIndex?: number },
): Promise<typeof workflowInstances.$inferSelect> {
  const flowData = def.flowData as WorkflowFlowData;
  assertLaunchMatchesFormType(def, {});
  const childResolvedFormSnapshot = await resolveFormSnapshot(def.formId);
  const childFormSnapshot = buildInstanceFormSnapshot(def, childResolvedFormSnapshot);
  const childStarter = await buildStarterContext(childInitiatorId);

  const { instance: childInst, createdTasks } = await db.transaction(async (tx) => {
    const [created] = await tx.insert(workflowInstances).values({
      definitionId: def.id,
      definitionSnapshot: def,
      title: childTitle.slice(0, 128),
      formData: childFormData,
      formSnapshot: childFormSnapshot,
      status: 'running',
      currentNodeKey: null,
      initiatorId: childInitiatorId,
      tenantId: parentInst.tenantId,
      parentInstanceId: parentInst.id,
      parentTaskId: parentTask.id,
      parentTaskItemKey: opts?.itemKey ?? null,
      parentTaskItemIndex: opts?.itemIndex ?? null,
    }).returning();
    const materialized = await advanceAndMaterialize({ kind: 'seed' }, {
      instanceId: created.id,
      initiatorId: childInitiatorId,
      executor: tx,
      flowData,
      formData: childFormData,
      settings: flowData.settings,
      starter: childStarter,
      tenantId: parentInst.tenantId,
      // 子流程血缘：子实例 token 标记来源父实例/父任务/循环项，便于多实例汇聚的可观测追踪
      scopeKey: `sub:${parentInst.id}:${parentTask.id}${opts?.itemKey ? ':' + opts.itemKey : ''}`,
    });
    const [updated] = await tx.update(workflowInstances).set({
      status: materialized.rejected ? 'rejected' : (materialized.finished ? 'approved' : 'running'),
      currentNodeKey: materialized.rejected || materialized.finished ? null : materialized.currentNodeKeys[0] ?? null,
    }).where(eq(workflowInstances.id, created.id)).returning();
    return { instance: updated, createdTasks: materialized.createdTasks };
  });

  const meta = { definitionId: childInst.definitionId, tenantId: childInst.tenantId, actor };
  emitInstanceEvent('instance.created', mapInstance(childInst), actor);
  for (const t of createdTasks) {
    emitNodeEvent('node.entered', { instanceId: childInst.id, ...meta, nodeKey: t.nodeKey, nodeName: t.nodeName, nodeType: t.nodeType });
    emitTaskEvent('task.created', mapTask(t), meta);
    if (t.assigneeId && t.status === 'pending') {
      emitTaskEvent('task.assigned', mapTask(t), meta);
    }
    if (t.status === 'approved') emitTaskEvent('task.approved', mapTask(t), meta);
    if (t.status === 'rejected') emitTaskEvent('task.rejected', mapTask(t), meta);
  }
  return childInst;
}

/**
 * 子流程节点入口：根据节点 subProcessWaitChild / subProcessMode 决定是否等待、单实例 / 多实例。
 * - 同步（waitChild!==false）：parentTask 须为 waiting，子实例结束后唤醒父任务
 * - 异步（waitChild===false）：fire-and-forget，仅发起子实例，不汇聚结果
 */
async function spawnSubProcessChild(
  parentInst: typeof workflowInstances.$inferSelect,
  parentTask: typeof workflowTasks.$inferSelect,
  nodeCfg: TaskAction['nodeConfig'],
  actor: WorkflowEventActor,
  opts?: { detached?: boolean },
): Promise<void> {
  if (nodeCfg.subProcessMode === 'multi') {
    await spawnMultiSubProcess(parentInst, parentTask, nodeCfg, actor, opts);
  } else {
    await spawnSingleSubProcessChild(parentInst, parentTask, nodeCfg, actor, opts);
  }
}

/** 加载并校验已发布子流程定义；不可用时按失败策略处理（detached 模式仅告警），返回 null 表示不可继续 */
async function loadValidatedSubProcessDef(
  parentInst: typeof workflowInstances.$inferSelect,
  parentTask: typeof workflowTasks.$inferSelect,
  nodeCfg: TaskAction['nodeConfig'],
  actor: WorkflowEventActor,
  opts?: { detached?: boolean },
): Promise<NonNullable<Awaited<ReturnType<typeof loadPublishedSubProcessDef>>> | null> {
  const failWith = async (errorMessage: string) => {
    const handled = await handleNodeExecutionError({
      instance: parentInst,
      task: parentTask,
      nodeKey: parentTask.nodeKey,
      nodeName: parentTask.nodeName,
      errorMessage,
      actor,
    });
    if (!handled) await rejectTaskCore(parentTask, parentInst, errorMessage, actor);
  };
  const def = await loadPublishedSubProcessDef(nodeCfg.subProcessId);
  if (!def) {
    if (!opts?.detached) await failWith('子流程定义不存在或未发布');
    else logger.warn('[subProcess] async child def missing', { parentInstanceId: parentInst.id, subProcessId: nodeCfg.subProcessId });
    return null;
  }
  const validation = validateFlowData(def.flowData as WorkflowFlowData);
  if (!validation.valid) {
    if (!opts?.detached) await failWith(`子流程定义无效：${validation.errors[0]}`);
    return null;
  }
  return def;
}

/** 单实例子流程：发起一个子实例，结束后回写出参并唤醒父任务 */
async function spawnSingleSubProcessChild(
  parentInst: typeof workflowInstances.$inferSelect,
  parentTask: typeof workflowTasks.$inferSelect,
  nodeCfg: TaskAction['nodeConfig'],
  actor: WorkflowEventActor,
  opts?: { detached?: boolean },
): Promise<void> {
  const def = await loadValidatedSubProcessDef(parentInst, parentTask, nodeCfg, actor, opts);
  if (!def) return;
  const parentFormData = (parentInst.formData ?? {}) as Record<string, unknown>;
  const childFormData = buildChildFormData(nodeCfg.subProcessFieldMapping, parentFormData);
  const childInitiatorId = await resolveChildInitiator(nodeCfg, parentInst);
  const childTitle = `${parentInst.title} / ${nodeCfg.label ?? nodeCfg.subProcessName ?? '子流程'}`;
  let childInst: typeof workflowInstances.$inferSelect;
  try {
    childInst = await createChildInstanceAndMaterialize(parentInst, parentTask, def, childFormData, childInitiatorId, childTitle, actor);
  } catch (err) {
    if (!opts?.detached) {
      const handled = await handleNodeExecutionError({
        instance: parentInst,
        task: parentTask,
        nodeKey: parentTask.nodeKey,
        nodeName: parentTask.nodeName,
        errorMessage: err instanceof Error ? err.message : String(err),
        actor,
      });
      if (!handled) await rejectTaskCore(parentTask, parentInst, '子流程发起失败', actor);
    } else {
      logger.error('[subProcess] async single child failed', { parentInstanceId: parentInst.id, taskId: parentTask.id, err });
    }
    return;
  }
  if (opts?.detached) return;
  if (childInst.status === 'approved') {
    emitInstanceEvent('instance.approved', mapInstance(childInst), actor);
    await applySubProcessOutputAndResume(parentInst, parentTask, childInst, 'approved', actor);
  } else if (childInst.status === 'rejected') {
    emitInstanceEvent('instance.rejected', mapInstance(childInst), actor);
    await applySubProcessOutputAndResume(parentInst, parentTask, childInst, 'rejected', actor);
  }
}

/** 解析多实例循环数据源为数组 */
export function resolveMultiItems(nodeCfg: TaskAction['nodeConfig'], parentFormData: Record<string, unknown>): unknown[] {
  const raw = nodeCfg.subProcessMultiSource ? parentFormData[nodeCfg.subProcessMultiSource] : undefined;
  if (Array.isArray(raw)) return raw;
  if (raw == null || raw === '') return [];
  return [raw];
}

/** 创建多实例中第 index 个子实例，并在即时完结时触发汇聚 */
async function spawnMultiInstanceChild(
  parentInst: typeof workflowInstances.$inferSelect,
  parentTask: typeof workflowTasks.$inferSelect,
  nodeCfg: TaskAction['nodeConfig'],
  def: typeof workflowDefinitions.$inferSelect,
  items: unknown[],
  index: number,
  childInitiatorId: number,
  actor: WorkflowEventActor,
): Promise<typeof workflowInstances.$inferSelect | null> {
  const item = items[index];
  const itemKey = buildSubProcessItemKey(parentTask.id, index, item);
  const [existing] = await db.select().from(workflowInstances)
    .where(and(eq(workflowInstances.parentTaskId, parentTask.id), eq(workflowInstances.parentTaskItemKey, itemKey)))
    .limit(1);
  if (existing) return null;
  const parentFormData = (parentInst.formData ?? {}) as Record<string, unknown>;
  const childFormData = buildChildFormData(nodeCfg.subProcessFieldMapping, parentFormData, item);
  if (nodeCfg.subProcessMultiItemKey) childFormData[nodeCfg.subProcessMultiItemKey] = item;
  const childTitle = `${parentInst.title} / ${nodeCfg.label ?? nodeCfg.subProcessName ?? '子流程'} #${index + 1}`;
  let childInst: typeof workflowInstances.$inferSelect;
  try {
    childInst = await createChildInstanceAndMaterialize(parentInst, parentTask, def, childFormData, childInitiatorId, childTitle, actor, {
      itemKey,
      itemIndex: index,
    });
  } catch (err) {
    if (isPgUniqueViolation(err)) return null;
    throw err;
  }
  if (childInst.status === 'approved') {
    emitInstanceEvent('instance.approved', mapInstance(childInst), actor);
    await handleMultiChildSettled(childInst, 'approved', actor);
  } else if (childInst.status === 'rejected') {
    emitInstanceEvent('instance.rejected', mapInstance(childInst), actor);
    await handleMultiChildSettled(childInst, 'rejected', actor);
  }
  return childInst;
}

/**
 * 多实例子流程：遍历循环数据源，逐项发起子实例。
 * - parallel：一次性发起全部子实例，全部结束后推进父流程
 * - serial：先发起第一个，前一个结束后再发起下一个
 * - 出参映射在汇聚时聚合为数组写回父 formData
 */
async function spawnMultiSubProcess(
  parentInst: typeof workflowInstances.$inferSelect,
  parentTask: typeof workflowTasks.$inferSelect,
  nodeCfg: TaskAction['nodeConfig'],
  actor: WorkflowEventActor,
  opts?: { detached?: boolean },
): Promise<void> {
  const def = await loadValidatedSubProcessDef(parentInst, parentTask, nodeCfg, actor, opts);
  if (!def) return;
  const parentFormData = (parentInst.formData ?? {}) as Record<string, unknown>;
  const items = resolveMultiItems(nodeCfg, parentFormData);
  if (items.length === 0) {
    if (!opts?.detached) await approveTaskCore(parentTask, parentInst, '子流程多实例数据源为空，自动通过', actor);
    return;
  }
  const childInitiatorId = await resolveChildInitiator(nodeCfg, parentInst);

  if (opts?.detached) {
    // 异步：fire-and-forget，全部发起，不汇聚
    for (let i = 0; i < items.length; i++) {
      await spawnMultiInstanceChild(parentInst, parentTask, nodeCfg, def, items, i, childInitiatorId, actor)
        .catch((err) => logger.error('[subProcess] async multi child failed', { parentInstanceId: parentInst.id, index: i, err }));
    }
    return;
  }

  // 同步：先固化期望子实例总数，再发起
  await db.update(workflowTasks).set({ subTotal: items.length, subDone: 0 }).where(eq(workflowTasks.id, parentTask.id));
  const serial = nodeCfg.subProcessMultiExecution === 'serial';
  try {
    if (serial) {
      await spawnMultiInstanceChild(parentInst, parentTask, nodeCfg, def, items, 0, childInitiatorId, actor);
    } else {
      for (let i = 0; i < items.length; i++) {
        await spawnMultiInstanceChild(parentInst, parentTask, nodeCfg, def, items, i, childInitiatorId, actor);
      }
    }
  } catch (err) {
    logger.error('[subProcess] multi spawn failed, rejecting parent', { parentInstanceId: parentInst.id, taskId: parentTask.id, err });
    const [pt] = await db.select().from(workflowTasks).where(eq(workflowTasks.id, parentTask.id)).limit(1);
    const [pi] = await db.select().from(workflowInstances).where(eq(workflowInstances.id, parentInst.id)).limit(1);
    if (pt && pi && pt.status === 'waiting' && pi.status === 'running') {
      const handled = await handleNodeExecutionError({
        instance: pi,
        task: pt,
        nodeKey: pt.nodeKey,
        nodeName: pt.nodeName,
        errorMessage: '子流程多实例发起失败',
        actor,
      });
      if (!handled) await rejectTaskCore(pt, pi, '子流程多实例发起失败', actor);
    }
  }
}

/**
 * 多实例子实例结束时的汇聚处理（原子递增 sub_done + 抢占式 claim 防并发重复推进）。
 */
/**
 * 多实例子流程汇聚对账（幂等）：基于"实际已结束子实例数"重算 subDone 与出参聚合，
 * 据此决定 整体通过 / 整体驳回 / 顺序模式发起下一个 / 继续等待。
 *
 * 采用"绝对重算"而非"相对自增"，因此对同一子实例的重复触发、以及丢失的 settle 回调
 * 都能安全收敛——供正常 settle 回调与恢复扫描共用。
 */
export async function reconcileMultiSubProcess(
  parentTaskId: number,
  parentInstId: number,
  actor: WorkflowEventActor,
): Promise<void> {
  type Decision =
    | { action: 'approve' | 'reject'; parentTaskId: number; parentInstId: number }
    | { action: 'spawnNext'; index: number; parentTaskId: number; parentInstId: number }
    | null;

  const decision: Decision = await db.transaction(async (tx) => {
    // 锁定父任务，串行化同一父任务上的并发汇聚/对账
    const [pt] = await tx.select().from(workflowTasks)
      .where(eq(workflowTasks.id, parentTaskId)).for('update').limit(1);
    if (!pt || pt.status !== 'waiting' || pt.subTotal == null) return null;
    const [pi] = await tx.select().from(workflowInstances).where(eq(workflowInstances.id, parentInstId)).limit(1);
    if (!pi || pi.status !== 'running') return null;
    const nodeCfg = snapshotNodeCfg(pi, pt.nodeKey);

    // 基于实际子实例状态重算（绝对值，幂等）
    const settledChildren = await tx.select({
      id: workflowInstances.id,
      status: workflowInstances.status,
      formData: workflowInstances.formData,
    }).from(workflowInstances)
      .where(and(
        eq(workflowInstances.parentTaskId, pt.id),
        inArray(workflowInstances.status, ['approved', 'rejected']),
      ))
      .orderBy(workflowInstances.id);
    const settledCount = settledChildren.length;
    if (settledCount !== pt.subDone) {
      await tx.update(workflowTasks).set({ subDone: settledCount }).where(eq(workflowTasks.id, pt.id));
    }

    // 出参映射：从所有已结束子实例重算聚合数组（幂等，避免重复 append）
    const outputMapping = nodeCfg?.subProcessOutputMapping;
    if (outputMapping && Object.keys(outputMapping).length > 0) {
      const parentFormData = { ...((pi.formData ?? {}) as Record<string, unknown>) };
      for (const [parentKey, childKey] of Object.entries(outputMapping)) {
        parentFormData[parentKey] = settledChildren
          .map((c) => (c.formData as Record<string, unknown> | null)?.[childKey])
          .filter((v) => v !== undefined);
      }
      await tx.update(workflowInstances).set({ formData: parentFormData }).where(eq(workflowInstances.id, pi.id));
    }

    const ignoreReject = nodeCfg?.subProcessIgnoreReject === true;
    const abortOnReject = (nodeCfg?.subProcessOnChildReject ?? 'abort') === 'abort';
    const hasRejected = settledChildren.some((c) => c.status === 'rejected');
    const wantReject = hasRejected && abortOnReject && !ignoreReject;
    const wantApprove = !wantReject && settledCount >= pt.subTotal;

    if (wantReject || wantApprove) {
      // 抢占式 claim：将父任务移出 waiting，确保只有一个 settler 推进父流程
      const [claimed] = await tx.update(workflowTasks)
        .set({ status: 'pending' })
        .where(and(eq(workflowTasks.id, pt.id), eq(workflowTasks.status, 'waiting')))
        .returning();
      if (!claimed) return null;
      return { action: wantReject ? 'reject' : 'approve', parentTaskId: pt.id, parentInstId: pi.id };
    }

    if (nodeCfg?.subProcessMultiExecution === 'serial') {
      const spawnedCount = await tx.$count(workflowInstances, eq(workflowInstances.parentTaskId, pt.id));
      if (spawnedCount < pt.subTotal && settledCount >= spawnedCount) {
        return { action: 'spawnNext', index: spawnedCount, parentTaskId: pt.id, parentInstId: pi.id };
      }
    } else if (nodeCfg) {
      const spawnedChildren = await tx.select({
        parentTaskItemIndex: workflowInstances.parentTaskItemIndex,
      }).from(workflowInstances)
        .where(eq(workflowInstances.parentTaskId, pt.id));
      const spawnedIndexes = new Set(
        spawnedChildren
          .map((child) => child.parentTaskItemIndex)
          .filter((index): index is number => typeof index === 'number' && Number.isInteger(index) && index >= 0),
      );
      if (spawnedChildren.length < pt.subTotal) {
        if (spawnedIndexes.size === 0) {
          return { action: 'spawnNext', index: spawnedChildren.length, parentTaskId: pt.id, parentInstId: pi.id };
        } else {
          for (let i = 0; i < pt.subTotal; i++) {
            if (!spawnedIndexes.has(i)) {
              return { action: 'spawnNext', index: i, parentTaskId: pt.id, parentInstId: pi.id };
            }
          }
        }
      }
    }
    return null;
  });

  if (!decision) return;

  const [[pt], [pi]] = await Promise.all([
    db.select().from(workflowTasks).where(eq(workflowTasks.id, decision.parentTaskId)).limit(1),
    db.select().from(workflowInstances).where(eq(workflowInstances.id, decision.parentInstId)).limit(1),
  ]);
  if (!pt || !pi || pi.status !== 'running') return;

  if (decision.action === 'approve') {
    await approveTaskCore(pt, pi, '子流程全部完成', actor);
  } else if (decision.action === 'reject') {
    await rejectTaskCore(pt, pi, '子流程存在被驳回的实例', actor);
  } else if (decision.action === 'spawnNext') {
    if (pt.status !== 'waiting') return;
    const nodeCfg = snapshotNodeCfg(pi, pt.nodeKey);
    if (!nodeCfg) return;
    const def = await loadPublishedSubProcessDef(nodeCfg.subProcessId);
    if (!def) return;
    const items = resolveMultiItems(nodeCfg, (pi.formData ?? {}) as Record<string, unknown>);
    if (decision.index >= items.length) return;
    const childInitiatorId = await resolveChildInitiator(nodeCfg, pi);
    await spawnMultiInstanceChild(pi, pt, nodeCfg, def, items, decision.index, childInitiatorId, actor);
  }
}

async function handleMultiChildSettled(
  childInst: typeof workflowInstances.$inferSelect,
  _outcome: 'approved' | 'rejected',
  actor: WorkflowEventActor,
): Promise<void> {
  if (!childInst.parentInstanceId || !childInst.parentTaskId) return;
  await reconcileMultiSubProcess(childInst.parentTaskId, childInst.parentInstanceId, actor);
}

/**
 * 子流程节点的统一发起入口：在任务创建后调用，自动区分同步 / 异步、单 / 多实例。
 */
export async function maybeSpawnSubProcessChild(
  instance: typeof workflowInstances.$inferSelect,
  task: typeof workflowTasks.$inferSelect,
  actor: WorkflowEventActor,
): Promise<void> {
  if (task.nodeType !== 'subProcess') return;
  const nodeCfg = snapshotNodeCfg(instance, task.nodeKey);
  if (!nodeCfg) return;
  const sync = nodeCfg.subProcessWaitChild !== false;
  if (sync) {
    if (task.status !== 'waiting') return;
    await spawnSubProcessChild(instance, task, nodeCfg, actor);
  } else {
    await spawnSubProcessChild(instance, task, nodeCfg, actor, { detached: true });
  }
}

/**
 * 子实例结束时回写 subProcessOutputMapping 到父实例 formData，并恢复父任务。
 * - approved → approveTaskCore（推进父流程）
 * - rejected → rejectTaskCore（按父节点 rejectStrategy 处理）
 */
export async function applySubProcessOutputAndResume(
  parentInst: typeof workflowInstances.$inferSelect,
  parentTask: typeof workflowTasks.$inferSelect,
  childInst: typeof workflowInstances.$inferSelect,
  outcome: 'approved' | 'rejected',
  actor: WorkflowEventActor,
): Promise<void> {
  // 先重读父实例/父任务最新状态，避免在 spawn 期间被其他流程修改
  const [[latestParent], [latestTask]] = await Promise.all([
    db.select().from(workflowInstances).where(eq(workflowInstances.id, parentInst.id)).limit(1),
    db.select().from(workflowTasks).where(eq(workflowTasks.id, parentTask.id)).limit(1),
  ]);
  if (!latestParent || latestParent.status !== 'running') return;
  if (!latestTask || latestTask.status !== 'waiting') return;

  if (outcome === 'approved') {
    const snapshot = latestParent.definitionSnapshot as { flowData?: WorkflowFlowData } | null;
    const nodeCfg = snapshot?.flowData?.nodes.find((n) => n.data.key === latestTask.nodeKey)?.data;
    const outputMapping = nodeCfg?.subProcessOutputMapping;
    if (outputMapping && Object.keys(outputMapping).length > 0) {
      const childFormData = (childInst.formData ?? {}) as Record<string, unknown>;
      const parentFormData = { ...(latestParent.formData ?? {}) as Record<string, unknown> };
      for (const [parentKey, childKey] of Object.entries(outputMapping)) {
        if (childKey in childFormData) {
          parentFormData[parentKey] = childFormData[childKey];
        }
      }
      await db.update(workflowInstances).set({ formData: parentFormData }).where(eq(workflowInstances.id, latestParent.id));
      latestParent.formData = parentFormData;
    }
    await approveTaskCore(latestTask, latestParent, `子流程 #${childInst.id} 已通过`, actor);
  } else {
    // 子流程被驳回：默认按节点 rejectStrategy 处理；若配置忽略驳回则按通过继续
    const nodeCfg = snapshotNodeCfg(latestParent, latestTask.nodeKey);
    if (nodeCfg?.subProcessIgnoreReject) {
      await approveTaskCore(latestTask, latestParent, `子流程 #${childInst.id} 已驳回（已忽略，继续流程）`, actor);
    } else {
      await rejectTaskCore(latestTask, latestParent, `子流程 #${childInst.id} 已驳回`, actor);
    }
  }
}

/**
 * 子实例结束后唤醒父任务的入口：根据 child.parentInstanceId / parentTaskId 找到父实例/任务并恢复。
 * 自动区分单实例（直接回写出参 + 推进）与多实例（汇聚 join）。
 */
export async function resumeParentSubProcess(
  childInst: typeof workflowInstances.$inferSelect,
  outcome: 'approved' | 'rejected',
  actor: WorkflowEventActor,
): Promise<void> {
  if (!childInst.parentInstanceId || !childInst.parentTaskId) return;
  const [parentTask] = await db.select().from(workflowTasks).where(eq(workflowTasks.id, childInst.parentTaskId)).limit(1);
  if (!parentTask) return;
  const [parentInst] = await db.select().from(workflowInstances).where(eq(workflowInstances.id, childInst.parentInstanceId)).limit(1);
  if (!parentInst) return;
  // 异步（fire-and-forget）子流程：父流程在 fork 时已越过该节点，子实例结束不应再次推进父任务，否则会重复展开下游。
  const parentNodeCfg = snapshotNodeCfg(parentInst, parentTask.nodeKey);
  if (parentNodeCfg?.subProcessWaitChild === false) return;
  if (parentTask.subTotal != null) {
    // 多实例：走汇聚处理
    await handleMultiChildSettled(childInst, outcome, actor);
    return;
  }
  await applySubProcessOutputAndResume(parentInst, parentTask, childInst, outcome, actor);
}
