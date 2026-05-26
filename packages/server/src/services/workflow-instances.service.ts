// ─── 数据映射 ─────────────────────────────────────────────────────────────────
import { formatDateTime, formatNullableDateTime } from '../lib/datetime';

export function mapTask(
  row: typeof workflowTasks.$inferSelect,
  assigneeName?: string | null,
  assigneeAvatar?: string | null,
  actionButtons?: Partial<Record<WorkflowActionButtonKey, WorkflowActionButtonConfig>> | null,
) {
  return {
    id: row.id,
    instanceId: row.instanceId,
    nodeKey: row.nodeKey,
    nodeName: row.nodeName,
    nodeType: row.nodeType ?? null,
    assigneeId: row.assigneeId,
    assigneeName: assigneeName ?? null,
    assigneeAvatar: assigneeAvatar ?? null,
    status: row.status,
    comment: row.comment,
    actionAt: formatNullableDateTime(row.actionAt),
    actionButtons: actionButtons ?? null,
    externalCallbackId: row.externalCallbackId ?? null,
    externalDispatchStatus: row.externalDispatchStatus ?? null,
    createdAt: formatDateTime(row.createdAt),
  };
}

export function mapInstance(
  row: typeof workflowInstances.$inferSelect,
  extras: {
    definitionName?: string | null;
    categoryId?: number | null;
    categoryName?: string | null;
    initiatorName?: string | null;
    initiatorAvatar?: string | null;
    tasks?: ReturnType<typeof mapTask>[];
  } = {},
) {
  return {
    id: row.id,
    definitionId: row.definitionId,
    definitionName: extras.definitionName ?? null,
    categoryId: extras.categoryId ?? null,
    categoryName: extras.categoryName ?? null,
    title: row.title,
    formData: row.formData,
    status: row.status,
    currentNodeKey: row.currentNodeKey,
    initiatorId: row.initiatorId,
    initiatorName: extras.initiatorName ?? null,
    initiatorAvatar: extras.initiatorAvatar ?? null,
    tenantId: row.tenantId,
    tasks: extras.tasks ?? null,
    createdBy: row.createdBy ?? null,
    updatedBy: row.updatedBy ?? null,
    createdAt: formatDateTime(row.createdAt),
    updatedAt: formatDateTime(row.updatedAt),
  };
}

// ─── 业务逻辑 ─────────────────────────────────────────────────────────────────
import { count, countDistinct, eq, and, desc, ilike, or } from 'drizzle-orm';
import { escapeLike, withPagination } from '../lib/where-helpers';
import { db } from '../db';
import { pageOffset } from '../lib/pagination';
import { workflowInstances, workflowTasks, workflowDefinitions, workflowCategories, users, userRoles } from '../db/schema';
import { tenantCondition, getCreateTenantId } from '../lib/tenant';
import { advanceFlow, getInitialTasks, validateFlowData, type AdvanceResult, type TaskAction } from '../lib/workflow-engine';
import type { WorkflowApproveMethod, WorkflowFlowData, WorkflowTask as WorkflowTaskDto, WorkflowEventActor, WorkflowActionButtonKey, WorkflowActionButtonConfig } from '@zenith/shared';
import { HTTPException } from 'hono/http-exception';
import { currentUser } from '../lib/context';
import { resolveAssigneeIds } from './workflow-assignee-resolver.service';
import type { DbExecutor } from '../db/types';
import { workflowEventBus } from '../lib/workflow-event-bus';
import { randomBytes } from 'node:crypto';
import { delayScheduler } from '../lib/delay-scheduler';
import dayjs from 'dayjs';
import logger from '../lib/logger';

/** 发射实例生命周期事件的辅助函数 */
function emitInstanceEvent(
  type: 'instance.created' | 'instance.approved' | 'instance.rejected' | 'instance.withdrawn',
  instance: ReturnType<typeof mapInstance>,
  actor: { userId: number; name?: string | null },
) {
  workflowEventBus.emit({
    type,
    instanceId: instance.id,
    definitionId: instance.definitionId,
    tenantId: instance.tenantId ?? null,
    actor,
    instance,
  } as Parameters<typeof workflowEventBus.emit>[0]);
}

/** 发射任务生命周期事件的辅助函数 */
function emitTaskEvent(
  type: 'task.created' | 'task.approved' | 'task.rejected' | 'task.skipped' | 'task.transferred' | 'task.assigned',
  task: WorkflowTaskDto,
  meta: { definitionId: number; tenantId: number | null; actor?: { userId: number; name?: string | null }; comment?: string | null },
) {
  workflowEventBus.emit({
    type,
    instanceId: task.instanceId,
    definitionId: meta.definitionId,
    tenantId: meta.tenantId,
    actor: meta.actor,
    task,
    comment: meta.comment,
  } as Parameters<typeof workflowEventBus.emit>[0]);
}

/** 发射节点进入/离开事件 */
function emitNodeEvent(
  type: 'node.entered' | 'node.left',
  meta: { instanceId: number; definitionId: number; tenantId: number | null; nodeKey: string; nodeName: string; nodeType: WorkflowTaskDto['nodeType']; actor?: { userId: number; name?: string | null } },
) {
  workflowEventBus.emit({
    type,
    instanceId: meta.instanceId,
    definitionId: meta.definitionId,
    tenantId: meta.tenantId,
    actor: meta.actor,
    nodeKey: meta.nodeKey,
    nodeName: meta.nodeName,
    nodeType: meta.nodeType,
  } as Parameters<typeof workflowEventBus.emit>[0]);
}

/**
 * 将引擎输出的 TaskAction[] 展开为实际需插入的 workflow_tasks 行。
 * - approve / handler：调用 resolver 展开为多人，依据 approveMethod 写入状态／sequence
 * - ccNode / delay / trigger / subProcess：保持原样
 */
interface ExpandedTaskRows {
  rows: Array<typeof workflowTasks.$inferInsert>;
  autoApprovedNodeKeys: string[];
  autoRejectedNodeKey: string | null;
}

async function resolveAdminAssigneeId(exec: DbExecutor): Promise<number | null> {
  const [admin] = await exec.select({ id: users.id }).from(users)
    .where(and(eq(users.username, 'admin'), eq(users.status, 'enabled')))
    .limit(1);
  if (admin) return admin.id;
  const [firstEnabled] = await exec.select({ id: users.id }).from(users)
    .where(eq(users.status, 'enabled'))
    .limit(1);
  return firstEnabled?.id ?? null;
}

async function resolveSameInitiatorReplacement(
  task: TaskAction,
  ctx: { instanceId: number; initiatorId: number; executor: DbExecutor; formData?: Record<string, unknown>; settings?: WorkflowFlowData['settings'] },
): Promise<number[]> {
  const strategy = task.nodeConfig.sameInitiatorStrategy;
  if (strategy === 'toDirectManager') {
    return resolveAssigneeIds({ ...task.nodeConfig, assigneeType: 'manager', managerLevel: 1 }, {
      initiatorId: ctx.initiatorId,
      executor: ctx.executor,
      formData: ctx.formData,
      instanceId: ctx.instanceId,
    });
  }
  if (strategy === 'toDeptHead') {
    return resolveAssigneeIds({ ...task.nodeConfig, assigneeType: 'department' }, {
      initiatorId: ctx.initiatorId,
      executor: ctx.executor,
      formData: ctx.formData,
      instanceId: ctx.instanceId,
    });
  }
  return [];
}

async function applyAssigneeRuntimeStrategies(
  task: TaskAction,
  userIds: number[],
  ctx: { instanceId: number; initiatorId: number; executor: DbExecutor; formData?: Record<string, unknown>; settings?: WorkflowFlowData['settings'] },
): Promise<number[]> {
  let ids = [...new Set(userIds)];
  const sameInitiatorStrategy = task.nodeConfig.sameInitiatorStrategy
    ?? (ctx.settings?.autoApproveIfSameUser ? 'autoSkip' : 'selfApprove');

  if (ids.includes(ctx.initiatorId) && sameInitiatorStrategy !== 'selfApprove') {
    ids = ids.filter((id) => id !== ctx.initiatorId);
    if (sameInitiatorStrategy === 'toDirectManager' || sameInitiatorStrategy === 'toDeptHead') {
      const replacements = await resolveSameInitiatorReplacement(task, ctx);
      ids = [...new Set([...ids, ...replacements.filter((id) => id !== ctx.initiatorId)])];
    }
  }

  if ((task.nodeConfig.deduplicateStrategy ?? 'autoSkip') === 'autoSkip' && ids.length > 0) {
    const approvedRows = await ctx.executor.select({ assigneeId: workflowTasks.assigneeId }).from(workflowTasks)
      .where(and(eq(workflowTasks.instanceId, ctx.instanceId), eq(workflowTasks.status, 'approved')));
    const approvedUsers = new Set(approvedRows.map((row) => row.assigneeId).filter((id): id is number => typeof id === 'number'));
    ids = ids.filter((id) => !approvedUsers.has(id));
  }

  return ids;
}

function computeDelayWakeAt(nodeConfig: TaskAction['nodeConfig'], formData: Record<string, unknown>): Date {
  const delayType = nodeConfig.delayType ?? 'fixed';
  if (delayType === 'toDate') {
    const key = nodeConfig.targetDate;
    const raw = key ? formData[key] : undefined;
    if (raw) {
      const d = dayjs(raw as string | number | Date);
      if (d.isValid()) return d.toDate();
    }
    return new Date();
  }
  const value = Number(nodeConfig.delayValue ?? 0);
  const unit = (nodeConfig.delayUnit ?? 'hour') as 'minute' | 'hour' | 'day';
  if (!Number.isFinite(value) || value <= 0) return new Date();
  return dayjs().add(value, unit).toDate();
}

/**
 * 根据子流程节点配置的 subProcessFieldMapping，构造子实例 formData。
 * value 支持 `{{form.x}}` 模板，引用父实例 formData 字段。
 */
function buildChildFormData(
  mapping: Record<string, string> | undefined,
  parentFormData: Record<string, unknown>,
): Record<string, unknown> {
  if (!mapping) return {};
  const out: Record<string, unknown> = {};
  for (const [childKey, expr] of Object.entries(mapping)) {
    if (typeof expr !== 'string') continue;
    if (expr.includes('{{')) {
      const tplMatch = expr.match(/^\{\{form\.([^}]+)\}\}$/);
      if (tplMatch) {
        // 整段就是单个引用：保留原值类型
        out[childKey] = parentFormData[tplMatch[1].trim()];
      } else {
        out[childKey] = expr.replace(/\{\{form\.([^}]+)\}\}/g, (_, k) => {
          const v = parentFormData[k.trim()];
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

/**
 * 启动子流程实例。由父实例的 subProcess 节点触发，事务外调用。
 * - 不进行发起人范围校验（受父实例信任）
 * - 父实例 initiatorId / tenantId 透传到子实例
 * - 子实例 status='running'，并写入 parentInstanceId / parentTaskId
 * - 内部递归 materialize 初始任务、发射事件
 */
async function spawnSubProcessChild(
  parentInst: typeof workflowInstances.$inferSelect,
  parentTask: typeof workflowTasks.$inferSelect,
  nodeCfg: TaskAction['nodeConfig'],
  actor: WorkflowEventActor,
): Promise<void> {
  const subProcessId = nodeCfg.subProcessId;
  if (!subProcessId) {
    return;
  }
  const [def] = await db.select().from(workflowDefinitions)
    .where(and(eq(workflowDefinitions.id, subProcessId), eq(workflowDefinitions.status, 'published')))
    .limit(1);
  if (!def) {
    // 子流程定义不存在或未发布，直接驳回父任务以终止流程
    await rejectTaskCore(parentTask, parentInst, '子流程定义不存在或未发布', actor);
    return;
  }
  const flowData = def.flowData as WorkflowFlowData;
  const validation = validateFlowData(flowData);
  if (!validation.valid) {
    await rejectTaskCore(parentTask, parentInst, `子流程定义无效：${validation.errors[0]}`, actor);
    return;
  }
  const parentFormData = (parentInst.formData ?? {}) as Record<string, unknown>;
  const childFormData = buildChildFormData(nodeCfg.subProcessFieldMapping, parentFormData);
  const childTitle = `${parentInst.title} / ${nodeCfg.label ?? nodeCfg.subProcessName ?? '子流程'}`;
  const initialResult = getInitialTasks(flowData, childFormData);

  const { instance: childInst, createdTasks } = await db.transaction(async (tx) => {
    const [created] = await tx.insert(workflowInstances).values({
      definitionId: def.id,
      definitionSnapshot: def,
      title: childTitle.slice(0, 128),
      formData: childFormData,
      status: 'running',
      currentNodeKey: null,
      initiatorId: parentInst.initiatorId,
      tenantId: parentInst.tenantId,
      parentInstanceId: parentInst.id,
      parentTaskId: parentTask.id,
    }).returning();
    const materialized = await materializeAdvanceResult(initialResult, {
      instanceId: created.id,
      initiatorId: parentInst.initiatorId,
      executor: tx,
      flowData,
      formData: childFormData,
      settings: flowData.settings,
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
    if (t.nodeType === 'delay' && t.status === 'waiting' && t.wakeAt) {
      delayScheduler.scheduleAt(t.id, t.wakeAt);
    }
    if (t.nodeType === 'subProcess' && t.status === 'waiting') {
      // 子实例内部又遇到 subProcess：递归 spawn
      const childNodeCfg = (childInst.definitionSnapshot as { flowData?: WorkflowFlowData } | null)?.flowData?.nodes.find((n) => n.data.key === t.nodeKey)?.data;
      if (childNodeCfg) {
        await spawnSubProcessChild(childInst, t, childNodeCfg, actor);
      }
    }
  }
  // 子实例初始化即已完结：立即唤醒父任务
  if (childInst.status === 'approved') {
    emitInstanceEvent('instance.approved', mapInstance(childInst), actor);
    await applySubProcessOutputAndResume(parentInst, parentTask, childInst, 'approved', actor);
  } else if (childInst.status === 'rejected') {
    emitInstanceEvent('instance.rejected', mapInstance(childInst), actor);
    await applySubProcessOutputAndResume(parentInst, parentTask, childInst, 'rejected', actor);
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
  // 先重读父实例最新状态，避免在 spawn 期间被其他流程修改
  const [latestParent] = await db.select().from(workflowInstances).where(eq(workflowInstances.id, parentInst.id)).limit(1);
  if (!latestParent || latestParent.status !== 'running') return;
  const [latestTask] = await db.select().from(workflowTasks).where(eq(workflowTasks.id, parentTask.id)).limit(1);
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
    await rejectTaskCore(latestTask, latestParent, `子流程 #${childInst.id} 已驳回`, actor);
  }
}

/**
 * 子实例结束后唤醒父任务的入口：根据 child.parentInstanceId / parentTaskId 找到父实例/任务并恢复。
 */
export async function resumeParentSubProcess(
  childInst: typeof workflowInstances.$inferSelect,
  outcome: 'approved' | 'rejected',
  actor: WorkflowEventActor,
): Promise<void> {
  if (!childInst.parentInstanceId || !childInst.parentTaskId) return;
  const [parentInst] = await db.select().from(workflowInstances).where(eq(workflowInstances.id, childInst.parentInstanceId)).limit(1);
  if (!parentInst) return;
  const [parentTask] = await db.select().from(workflowTasks).where(eq(workflowTasks.id, childInst.parentTaskId)).limit(1);
  if (!parentTask) return;
  await applySubProcessOutputAndResume(parentInst, parentTask, childInst, outcome, actor);
}

async function expandTasksToRows(
  tasks: TaskAction[],
  ctx: { instanceId: number; initiatorId: number; executor: DbExecutor; formData?: Record<string, unknown>; settings?: WorkflowFlowData['settings']; selectedNextApprovers?: number[] },
): Promise<ExpandedTaskRows> {
  const rows: Array<typeof workflowTasks.$inferInsert> = [];
  const autoApprovedNodeKeys: string[] = [];
  let autoRejectedNodeKey: string | null = null;

  const pushAutoRow = (task: TaskAction, status: 'approved' | 'rejected') => {
    rows.push({
      instanceId: ctx.instanceId,
      nodeKey: task.nodeKey,
      nodeName: task.nodeName,
      nodeType: task.nodeType,
      assigneeId: null,
      status,
      actionAt: new Date(),
    });
    if (status === 'approved') autoApprovedNodeKeys.push(task.nodeKey);
    else autoRejectedNodeKey = task.nodeKey;
  };

  for (const t of tasks) {
    if (t.autoStatus) {
      pushAutoRow(t, t.autoStatus);
      continue;
    }

    if (t.nodeType === 'delay') {
      const wakeAt = computeDelayWakeAt(t.nodeConfig, ctx.formData ?? {});
      rows.push({
        instanceId: ctx.instanceId,
        nodeKey: t.nodeKey,
        nodeName: t.nodeName,
        nodeType: 'delay',
        assigneeId: null,
        status: 'waiting' as const,
        wakeAt,
      });
      continue;
    }

    if (t.nodeType === 'trigger' && t.nodeConfig.triggerConfig?.triggerType === 'callback') {
      rows.push({
        instanceId: ctx.instanceId,
        nodeKey: t.nodeKey,
        nodeName: t.nodeName,
        nodeType: 'trigger',
        assigneeId: null,
        status: 'waiting' as const,
        externalCallbackId: randomBytes(16).toString('hex'),
      });
      continue;
    }

    if (t.nodeType === 'subProcess' && t.nodeConfig.subProcessWaitChild !== false) {
      rows.push({
        instanceId: ctx.instanceId,
        nodeKey: t.nodeKey,
        nodeName: t.nodeName,
        nodeType: 'subProcess',
        assigneeId: null,
        status: 'waiting' as const,
      });
      continue;
    }

    if (t.nodeType !== 'approve' && t.nodeType !== 'handler') {
      rows.push({
        instanceId: ctx.instanceId,
        nodeKey: t.nodeKey,
        nodeName: t.nodeName,
        nodeType: t.nodeType,
        assigneeId: t.assigneeId,
        status: t.nodeType === 'ccNode' ? 'skipped' as const : 'approved' as const,
        actionAt: t.nodeType === 'ccNode' ? null : new Date(),
      });
      continue;
    }
    // 外部审批：不解析人员，生成一条 waiting + callbackId 任务，由 external-approver 订阅者派发
    const extCfg = t.nodeConfig.externalApproval;
    if (t.nodeType === 'approve' && extCfg?.enabled) {
      rows.push({
        instanceId: ctx.instanceId,
        nodeKey: t.nodeKey,
        nodeName: t.nodeName,
        nodeType: 'approve',
        assigneeId: null,
        status: 'waiting' as const,
        externalCallbackId: randomBytes(16).toString('hex'),
        externalDispatchStatus: 'pending' as const,
      });
      continue;
    }
    const rawMethod = t.nodeConfig.approveMethod;

    const resolvedUserIds = await resolveAssigneeIds(t.nodeConfig, {
      initiatorId: ctx.initiatorId,
      executor: ctx.executor,
      formData: ctx.formData,
      instanceId: ctx.instanceId,
      selectedNextApprovers: ctx.selectedNextApprovers,
    });

    const userIds = await applyAssigneeRuntimeStrategies(t, resolvedUserIds, ctx);
    if (userIds.length === 0) {
      const emptyStrategy = t.nodeConfig.emptyStrategy ?? 'autoApprove';
      if (emptyStrategy === 'assignTo' && t.nodeConfig.emptyAssignTo) {
        rows.push({
          instanceId: ctx.instanceId,
          nodeKey: t.nodeKey,
          nodeName: t.nodeName,
          nodeType: t.nodeType,
          assigneeId: t.nodeConfig.emptyAssignTo,
          status: 'pending' as const,
        });
      } else if (emptyStrategy === 'assignToAdmin') {
        const adminId = await resolveAdminAssigneeId(ctx.executor);
        if (adminId) {
          rows.push({
            instanceId: ctx.instanceId,
            nodeKey: t.nodeKey,
            nodeName: t.nodeName,
            nodeType: t.nodeType,
            assigneeId: adminId,
            status: 'pending' as const,
          });
        } else {
          pushAutoRow(t, 'rejected');
        }
      } else if (emptyStrategy === 'reject') {
        pushAutoRow(t, 'rejected');
      } else {
        pushAutoRow(t, 'approved');
      }
      continue;
    }

    const fallbackMethod: Exclude<WorkflowApproveMethod, 'auto'> = userIds.length > 1 ? 'and' : 'or';
    const method: Exclude<WorkflowApproveMethod, 'auto'> = rawMethod && rawMethod !== 'auto' ? rawMethod : fallbackMethod;
    userIds.forEach((uid, idx) => {
      rows.push({
        instanceId: ctx.instanceId,
        nodeKey: t.nodeKey,
        nodeName: t.nodeName,
        nodeType: t.nodeType,
        assigneeId: uid,
        // 顺序会签：只有第一人 pending，其余 waiting
        status: method === 'sequential' && idx > 0 ? 'waiting' as const : 'pending' as const,
        taskOrder: method === 'sequential' ? idx : null,
        approveMethod: userIds.length > 1 ? method : null,
      });
    });
  }
  return { rows, autoApprovedNodeKeys, autoRejectedNodeKey };
}

async function getCompletedNodeKeys(exec: DbExecutor, instanceId: number): Promise<Set<string>> {
  const rows = await exec.select({ nodeKey: workflowTasks.nodeKey }).from(workflowTasks)
    .where(and(eq(workflowTasks.instanceId, instanceId), eq(workflowTasks.status, 'approved')));
  const keys = new Set(rows.map((row) => row.nodeKey));
  keys.add('start');
  return keys;
}

async function materializeAdvanceResult(
  initial: AdvanceResult,
  ctx: { instanceId: number; initiatorId: number; executor: DbExecutor; flowData: WorkflowFlowData; formData: Record<string, unknown>; settings?: WorkflowFlowData['settings']; selectedNextApprovers?: number[] },
): Promise<{ createdTasks: typeof workflowTasks.$inferSelect[]; finished: boolean; rejected: boolean; currentNodeKeys: string[] }> {
  const createdTasks: typeof workflowTasks.$inferSelect[] = [];
  const pendingResults: AdvanceResult[] = [initial];
  const autoApprovedQueue: string[] = [];
  const processedAutoKeys = new Set<string>();
  let finished = false;
  let rejected = false;
  let currentNodeKeys: string[] = [];

  while ((pendingResults.length > 0 || autoApprovedQueue.length > 0) && !rejected) {
    if (pendingResults.length === 0) {
      const autoNodeKey = autoApprovedQueue.shift();
      if (!autoNodeKey || processedAutoKeys.has(autoNodeKey)) continue;
      processedAutoKeys.add(autoNodeKey);
      const completedKeys = await getCompletedNodeKeys(ctx.executor, ctx.instanceId);
      pendingResults.push(advanceFlow(ctx.flowData, autoNodeKey, ctx.formData, completedKeys));
      continue;
    }

    const result = pendingResults.shift();
    if (!result) continue;
    if (result.finished) finished = true;
    if (result.currentNodeKeys.length > 0) currentNodeKeys = result.currentNodeKeys;

    if (result.tasksToCreate.length > 0) {
      const expanded = await expandTasksToRows(result.tasksToCreate, ctx);
      if (expanded.rows.length > 0) {
        const inserted = await ctx.executor.insert(workflowTasks).values(expanded.rows).returning();
        createdTasks.push(...inserted);
        const activeKeys = [...new Set(inserted
          .filter((task) => task.status === 'pending' || task.status === 'waiting')
          .map((task) => task.nodeKey))];
        if (activeKeys.length > 0) currentNodeKeys = activeKeys;
      }
      autoApprovedQueue.push(...expanded.autoApprovedNodeKeys);
      if (expanded.autoRejectedNodeKey) rejected = true;
    }

    if (result.rejected) rejected = true;
  }

  if (rejected) return { createdTasks, finished: false, rejected: true, currentNodeKeys: [] };
  return { createdTasks, finished, rejected: false, currentNodeKeys };
}

/**
 * 检查同一 (instanceId, nodeKey) 下的全部任务是否已达成完成条件。
 * - and （会签）：所有人 approved 才完成
 * - or  （或签）：任一人 approved 即完成，其余 pending 任务自动 skipped
 * - sequential（顺序会签）：逐个转换 waiting -> pending，全部 approved 后完成
 */
async function checkNodeCompletion(
  tx: DbExecutor,
  instanceId: number,
  nodeKey: string,
): Promise<{ completed: boolean; method: WorkflowApproveMethod | null }> {
  const siblings = await tx.select().from(workflowTasks)
    .where(and(eq(workflowTasks.instanceId, instanceId), eq(workflowTasks.nodeKey, nodeKey)));
  if (siblings.length === 0) return { completed: true, method: null };
  const method = siblings.find((t) => t.approveMethod)?.approveMethod ?? null;

  if (!method || method === 'and') {
    const allDone = siblings.every((t) => t.status === 'approved' || t.status === 'skipped');
    return { completed: allDone, method };
  }
  if (method === 'or') {
    const anyApproved = siblings.some((t) => t.status === 'approved');
    if (anyApproved) {
      // 其余 pending 任务跳过
      await tx.update(workflowTasks).set({ status: 'skipped', actionAt: new Date() })
        .where(and(
          eq(workflowTasks.instanceId, instanceId),
          eq(workflowTasks.nodeKey, nodeKey),
          eq(workflowTasks.status, 'pending'),
        ));
      return { completed: true, method };
    }
    return { completed: false, method };
  }
  if (method === 'sequential') {
    const allApproved = siblings.every((t) => t.status === 'approved');
    if (allApproved) return { completed: true, method };
    // 将下一个 waiting 按 taskOrder 提升为 pending
    const nextWaiting = siblings
      .filter((t) => t.status === 'waiting')
      .sort((a, b) => (a.taskOrder ?? 0) - (b.taskOrder ?? 0))[0];
    if (nextWaiting) {
      await tx.update(workflowTasks).set({ status: 'pending' })
        .where(eq(workflowTasks.id, nextWaiting.id));
    }
    return { completed: false, method };
  }
  return { completed: false, method };
}

type InstanceStatus = 'draft' | 'running' | 'approved' | 'rejected' | 'withdrawn';

export async function listMyInstances(query: { page?: number; pageSize?: number; status?: string }) {
  const user = currentUser();
  const { page = 1, pageSize = 20, status } = query;
  const tc = tenantCondition(workflowInstances, user);
  const conditions = [eq(workflowInstances.initiatorId, user.userId)];
  if (tc) conditions.push(tc);
  if (status) conditions.push(eq(workflowInstances.status, status as InstanceStatus));
  const where = and(...conditions);
  const [total, rows] = await Promise.all([
    db.$count(workflowInstances, where),
    db.query.workflowInstances.findMany({
      where,
      with: {
        definition: { columns: { name: true } },
        initiator: { columns: { nickname: true, avatar: true } },
      },
      orderBy: desc(workflowInstances.id),
      limit: pageSize,
      offset: pageOffset(page, pageSize),
    }),
  ]);
  return {
    list: rows.map((r) => mapInstance(r, {
      definitionName: r.definition?.name ?? null,
      initiatorName: r.initiator?.nickname ?? null,
      initiatorAvatar: r.initiator?.avatar ?? null,
    })),
    total, page, pageSize,
  };
}

export async function listPendingMine(query: { page?: number; pageSize?: number }) {
  const user = currentUser();
  const { page = 1, pageSize = 20 } = query;
  const tc = tenantCondition(workflowInstances, user);
  const where = and(
    eq(workflowTasks.assigneeId, user.userId),
    eq(workflowTasks.status, 'pending'),
    eq(workflowInstances.status, 'running'),
    tc,
  );
  const [[{ total }], rows] = await Promise.all([
    db
      .select({ total: countDistinct(workflowInstances.id) })
      .from(workflowTasks)
      .innerJoin(workflowInstances, eq(workflowTasks.instanceId, workflowInstances.id))
      .where(where),
    withPagination(
      db
        .select({ inst: workflowInstances, definitionName: workflowDefinitions.name, initiatorName: users.nickname, initiatorAvatar: users.avatar, task: workflowTasks })
        .from(workflowTasks)
        .innerJoin(workflowInstances, eq(workflowTasks.instanceId, workflowInstances.id))
        .leftJoin(workflowDefinitions, eq(workflowInstances.definitionId, workflowDefinitions.id))
        .leftJoin(users, eq(workflowInstances.initiatorId, users.id))
        .where(where)
        .orderBy(desc(workflowTasks.createdAt))
        .$dynamic(),
      page, pageSize,
    ),
  ]);
  return {
    list: rows.map((r) => ({ ...mapInstance(r.inst, r), pendingTaskId: r.task.id })),
    total: Number(total),
    page,
    pageSize,
  };
}

export async function listAllInstances(query: { page?: number; pageSize?: number; status?: string; keyword?: string; categoryId?: number; initiatorKeyword?: string }) {
  const user = currentUser();
  const { page = 1, pageSize = 20, status, keyword, categoryId, initiatorKeyword } = query;
  const conditions = [];
  const tc = tenantCondition(workflowInstances, user);
  if (tc) conditions.push(tc);
  if (status) conditions.push(eq(workflowInstances.status, status as InstanceStatus));
  if (keyword) {
    const likeValue = `%${escapeLike(keyword)}%`;
    conditions.push(or(ilike(workflowInstances.title, likeValue), ilike(workflowDefinitions.name, likeValue)));
  }
  if (categoryId !== undefined) conditions.push(eq(workflowDefinitions.categoryId, categoryId));
  if (initiatorKeyword) conditions.push(ilike(users.nickname, `%${escapeLike(initiatorKeyword)}%`));
  const where = and(...conditions);
  const [statRows, [{ total }], rows] = await Promise.all([
    db.select({ status: workflowInstances.status, cnt: count() })
      .from(workflowInstances)
      .where(tc)
      .groupBy(workflowInstances.status),
    db.select({ total: count() })
      .from(workflowInstances)
      .leftJoin(workflowDefinitions, eq(workflowInstances.definitionId, workflowDefinitions.id))
      .leftJoin(workflowCategories, eq(workflowDefinitions.categoryId, workflowCategories.id))
      .leftJoin(users, eq(workflowInstances.initiatorId, users.id))
      .where(where),
    withPagination(
      db.select({
        inst: workflowInstances,
        definitionName: workflowDefinitions.name,
        categoryId: workflowDefinitions.categoryId,
        categoryName: workflowCategories.name,
        initiatorName: users.nickname,
        initiatorAvatar: users.avatar,
      })
        .from(workflowInstances)
        .leftJoin(workflowDefinitions, eq(workflowInstances.definitionId, workflowDefinitions.id))
        .leftJoin(workflowCategories, eq(workflowDefinitions.categoryId, workflowCategories.id))
        .leftJoin(users, eq(workflowInstances.initiatorId, users.id))
        .where(where)
        .orderBy(desc(workflowInstances.id))
        .$dynamic(),
      page, pageSize,
    ),
  ]);
  const stats: Record<string, number> = { total: 0, running: 0, approved: 0, rejected: 0, withdrawn: 0 };
  for (const r of statRows) {
    stats[r.status] = r.cnt;
    stats.total += r.cnt;
  }
  return { stats, list: rows.map((r) => mapInstance(r.inst, r)), total, page, pageSize };
}

export async function getInstanceDetail(id: number) {
  const user = currentUser();
  const tc = tenantCondition(workflowInstances, user);
  const conditions = [eq(workflowInstances.id, id)];
  if (tc) conditions.push(tc);
  const row = await db.query.workflowInstances.findFirst({
    where: and(...conditions),
    with: {
      definition: { columns: { name: true } },
      initiator: { columns: { nickname: true, avatar: true } },
      tasks: {
        with: { assignee: { columns: { nickname: true, avatar: true } } },
        orderBy: workflowTasks.id,
      },
    },
  });
  if (!row) throw new HTTPException(404, { message: '流程实例不存在' });
  const isInitiator = row.initiatorId === user.userId;
  const isAssignee = row.tasks.some((t) => t.assigneeId === user.userId);
  if (!isInitiator && !isAssignee) throw new HTTPException(403, { message: '无权查看' });
  const snapshot = row.definitionSnapshot as { flowData?: WorkflowFlowData } | null;
  const tasks = row.tasks.map((t) => {
    const cfg = snapshot?.flowData?.nodes.find((n) => n.data.key === t.nodeKey)?.data;
    const actionButtons = cfg?.actionButtons;
    return mapTask(t, t.assignee?.nickname, t.assignee?.avatar, actionButtons ?? null);
  });
  return mapInstance(row, {
    definitionName: row.definition?.name ?? null,
    initiatorName: row.initiator?.nickname ?? null,
    initiatorAvatar: row.initiator?.avatar ?? null,
    tasks,
  });
}

export async function getWorkflowInstanceBeforeAudit(id: number) {
  try {
    return await getInstanceDetail(id);
  } catch {
    return null;
  }
}

export async function getWorkflowTaskBeforeAudit(taskId: number) {
  const user = currentUser();
  const [task] = await db
    .select({ instanceId: workflowTasks.instanceId })
    .from(workflowTasks)
    .where(and(eq(workflowTasks.id, taskId), eq(workflowTasks.assigneeId, user.userId)))
    .limit(1);
  if (!task) return null;
  return getWorkflowInstanceBeforeAudit(task.instanceId);
}

export async function createInstance(data: { definitionId: number; title: string; formData?: Record<string, unknown> | null }) {
  const user = currentUser();
  const [def] = await db.select().from(workflowDefinitions).where(and(eq(workflowDefinitions.id, data.definitionId), eq(workflowDefinitions.status, 'published'))).limit(1);
  if (!def) throw new HTTPException(404, { message: '流程定义不存在或未发布' });
  const scopeType = (def.initiatorScopeType ?? 'all') as 'all' | 'users' | 'departments' | 'roles';
  const scopeIds = Array.isArray(def.initiatorScopeIds)
    ? def.initiatorScopeIds.map(Number).filter((v) => Number.isInteger(v) && v > 0)
    : [];
  if (scopeType !== 'all') {
    let allowed = false;
    if (scopeType === 'users') {
      allowed = scopeIds.includes(user.userId);
    } else if (scopeType === 'departments') {
      const [me] = await db.select({ departmentId: users.departmentId }).from(users).where(eq(users.id, user.userId)).limit(1);
      allowed = me?.departmentId != null && scopeIds.includes(me.departmentId);
    } else if (scopeType === 'roles') {
      const roleRows = await db.select({ roleId: userRoles.roleId }).from(userRoles).where(eq(userRoles.userId, user.userId));
      allowed = roleRows.some((r) => scopeIds.includes(r.roleId));
    }
    if (!allowed) {
      throw new HTTPException(403, { message: '当前流程不在你的可发起范围内' });
    }
  }
  const flowData = def.flowData as WorkflowFlowData;
  if (!flowData?.nodes?.length) throw new HTTPException(400, { message: '流程定义无效' });
  const validation = validateFlowData(flowData);
  if (!validation.valid) throw new HTTPException(400, { message: validation.errors[0] });
  const formData: Record<string, unknown> = data.formData ?? {};
  const initialResult = getInitialTasks(flowData, formData);
  if (initialResult.tasksToCreate.length === 0 && !initialResult.finished && !initialResult.rejected) {
    throw new HTTPException(400, { message: '流程定义中无可执行节点' });
  }
  const { instance, createdTasks } = await db.transaction(async (tx) => {
    const [createdInstance] = await tx.insert(workflowInstances).values({
      definitionId: def.id,
      definitionSnapshot: def,
      title: data.title,
      formData,
      status: 'running',
      currentNodeKey: null,
      initiatorId: user.userId,
      tenantId: getCreateTenantId(user),
    }).returning();
    const materialized = await materializeAdvanceResult(initialResult, {
      instanceId: createdInstance.id,
      initiatorId: user.userId,
      executor: tx,
      flowData,
      formData,
      settings: flowData.settings,
    });
    const [updatedInstance] = await tx.update(workflowInstances).set({
      status: materialized.rejected ? 'rejected' : (materialized.finished ? 'approved' : 'running'),
      currentNodeKey: materialized.rejected || materialized.finished ? null : materialized.currentNodeKeys[0] ?? null,
    }).where(eq(workflowInstances.id, createdInstance.id)).returning();
    return { instance: updatedInstance, createdTasks: materialized.createdTasks };
  });
  const instanceDto = mapInstance(instance);
  const actor = { userId: user.userId, name: user.username };
  emitInstanceEvent('instance.created', instanceDto, actor);
  for (const t of createdTasks) {
    emitNodeEvent('node.entered', { instanceId: instance.id, definitionId: instance.definitionId, tenantId: instance.tenantId, actor, nodeKey: t.nodeKey, nodeName: t.nodeName, nodeType: t.nodeType });
    emitTaskEvent('task.created', mapTask(t), { definitionId: instance.definitionId, tenantId: instance.tenantId, actor });
    if (t.assigneeId && t.status === 'pending') {
      emitTaskEvent('task.assigned', mapTask(t), { definitionId: instance.definitionId, tenantId: instance.tenantId, actor });
    }
    if (t.status === 'approved') {
      emitTaskEvent('task.approved', mapTask(t), { definitionId: instance.definitionId, tenantId: instance.tenantId, actor });
    }
    if (t.status === 'rejected') {
      emitTaskEvent('task.rejected', mapTask(t), { definitionId: instance.definitionId, tenantId: instance.tenantId, actor });
    }
    if (t.nodeType === 'delay' && t.status === 'waiting' && t.wakeAt) {
      delayScheduler.scheduleAt(t.id, t.wakeAt);
    }
    if (t.nodeType === 'subProcess' && t.status === 'waiting') {
      const nodeCfg = flowData.nodes.find((n) => n.data.key === t.nodeKey)?.data;
      if (nodeCfg) {
        void spawnSubProcessChild(instance, t, nodeCfg, actor).catch((err) => {
          logger.error('[subProcess] spawn child failed', { instanceId: instance.id, taskId: t.id, err });
        });
      }
    }
  }
  if (instance.status === 'approved') emitInstanceEvent('instance.approved', instanceDto, actor);
  if (instance.status === 'rejected') emitInstanceEvent('instance.rejected', instanceDto, actor);
  return instanceDto;
}

export async function withdrawInstance(id: number) {
  const user = currentUser();
  const tc = tenantCondition(workflowInstances, user);
  const conditions = [eq(workflowInstances.id, id)];
  if (tc) conditions.push(tc);
  const [inst] = await db.select().from(workflowInstances).where(and(...conditions)).limit(1);
  if (!inst) throw new HTTPException(404, { message: '流程实例不存在' });
  if (inst.initiatorId !== user.userId) throw new HTTPException(403, { message: '只有发起人可以撤回' });
  if (inst.status !== 'running') throw new HTTPException(400, { message: '只能撤回进行中的申请' });
  const snapshot = inst.definitionSnapshot as { flowData?: WorkflowFlowData } | null;
  if (snapshot?.flowData?.settings?.allowWithdraw === false) {
    throw new HTTPException(400, { message: '该流程不允许发起人撤回' });
  }
  const { row: updated, cancelledTasks } = await db.transaction(async (tx) => {
    const cancelled = await tx.update(workflowTasks).set({ status: 'skipped', actionAt: new Date() })
      .where(and(eq(workflowTasks.instanceId, id), eq(workflowTasks.status, 'pending')))
      .returning();
    const [row] = await tx.update(workflowInstances).set({ status: 'withdrawn' }).where(and(...conditions)).returning();
    return { row, cancelledTasks: cancelled };
  });
  const instanceDto = mapInstance(updated);
  const actor = { userId: user.userId, name: user.username };
  for (const t of cancelledTasks) {
    emitTaskEvent('task.skipped', mapTask(t), { definitionId: updated.definitionId, tenantId: updated.tenantId, actor });
  }
  emitInstanceEvent('instance.withdrawn', instanceDto, actor);
  return instanceDto;
}

export interface ApproveResult {
  instance: ReturnType<typeof mapInstance>;
  message: string;
}

export async function approveTask(taskId: number, comment?: string, attachments?: Array<{ name: string; url: string; size?: number }>, selectedNextApprovers?: number[]): Promise<ApproveResult> {
  const user = currentUser();
  const [task] = await db.select().from(workflowTasks).where(and(eq(workflowTasks.id, taskId), eq(workflowTasks.assigneeId, user.userId))).limit(1);
  if (!task) throw new HTTPException(404, { message: '任务不存在或无权操作' });
  if (task.status !== 'pending') throw new HTTPException(400, { message: '任务已处理' });
  const [inst] = await db.select().from(workflowInstances).where(eq(workflowInstances.id, task.instanceId)).limit(1);
  if (!inst) throw new HTTPException(500, { message: '流程数据异常' });
  if (inst.status !== 'running') throw new HTTPException(400, { message: '流程实例不在进行中' });
  // 校验“操作按钮设置”中通过按钮的 uploadRequired
  const flowData = (inst.definitionSnapshot as { flowData?: WorkflowFlowData } | null)?.flowData;
  const nodeCfg = flowData?.nodes.find((n) => n.data.key === task.nodeKey)?.data;
  const approveBtn = (nodeCfg?.actionButtons as { approve?: { uploadRequired?: boolean } } | undefined)?.approve;
  if (approveBtn?.uploadRequired && (!attachments || attachments.length === 0)) {
    throw new HTTPException(400, { message: '请上传附件后再提交' });
  }
  const enrichedComment = attachments && attachments.length > 0
    ? `${comment ?? ''}\n[附件]${attachments.map((a) => a.name).join(', ')}`.trim()
    : comment;
  return approveTaskCore(task, inst, enrichedComment, { userId: user.userId, name: user.username }, { selectedNextApprovers });
}

/** 外部审批回调：根据 callbackId 找到 waiting 任务并审批通过 */
export async function approveTaskByCallback(callbackId: string, comment: string | undefined, approverName: string): Promise<ApproveResult> {
  const [task] = await db.select().from(workflowTasks).where(eq(workflowTasks.externalCallbackId, callbackId)).limit(1);
  if (!task) throw new HTTPException(404, { message: '回调任务不存在' });
  if (task.status !== 'waiting') throw new HTTPException(400, { message: '回调任务已处理' });
  const [inst] = await db.select().from(workflowInstances).where(eq(workflowInstances.id, task.instanceId)).limit(1);
  if (!inst) throw new HTTPException(500, { message: '流程数据异常' });
  if (inst.status !== 'running') throw new HTTPException(400, { message: '流程实例不在进行中' });
  return approveTaskCore(task, inst, comment, { userId: 0, name: `external:${approverName}` });
}

export async function approveTaskCore(
  task: typeof workflowTasks.$inferSelect,
  inst: typeof workflowInstances.$inferSelect,
  comment: string | undefined,
  actor: WorkflowEventActor,
  options?: { selectedNextApprovers?: number[] },
): Promise<ApproveResult> {
  const taskId = task.id;
  const snapshot = inst.definitionSnapshot as { flowData?: WorkflowFlowData };
  const flowData = snapshot?.flowData;
  if (!flowData) throw new HTTPException(500, { message: '流程快照数据异常' });

  const updated = await db.transaction(async (tx) => {
    const [approvedTask] = await tx.update(workflowTasks).set({
      status: 'approved',
      comment: comment ?? null,
      actionAt: new Date(),
    }).where(eq(workflowTasks.id, taskId)).returning();

    // 检查当前节点是否已足够推进（会签/或签/顺序会签）
    const { completed } = await checkNodeCompletion(tx, inst.id, task.nodeKey);
    if (!completed) {
      const [row] = await tx.update(workflowInstances)
        .set({ currentNodeKey: task.nodeKey })
        .where(eq(workflowInstances.id, inst.id))
        .returning();
      return { row, finished: false, rejected: false, advanced: false, approvedTask, newTasks: [] as typeof workflowTasks.$inferSelect[] };
    }

    const allTasks = await tx.select().from(workflowTasks).where(and(eq(workflowTasks.instanceId, inst.id), eq(workflowTasks.status, 'approved')));
    const completedKeys = new Set(allTasks.map((t) => t.nodeKey));
    completedKeys.add('start');
    const formData = (inst.formData ?? {}) as Record<string, unknown>;
    const advanceResult = advanceFlow(flowData, task.nodeKey, formData, completedKeys);
    const materialized = await materializeAdvanceResult(advanceResult, {
      instanceId: inst.id,
      initiatorId: inst.initiatorId,
      executor: tx,
      flowData,
      formData,
      settings: flowData.settings,
      selectedNextApprovers: options?.selectedNextApprovers,
    });

    if (materialized.rejected) {
      const [row] = await tx.update(workflowInstances).set({ status: 'rejected', currentNodeKey: null }).where(eq(workflowInstances.id, inst.id)).returning();
      return { row, finished: false, rejected: true, advanced: true, approvedTask, newTasks: materialized.createdTasks };
    }

    if (materialized.finished) {
      const [row] = await tx.update(workflowInstances).set({ status: 'approved', currentNodeKey: null }).where(eq(workflowInstances.id, inst.id)).returning();
      return { row, finished: true, rejected: false, advanced: true, approvedTask, newTasks: materialized.createdTasks };
    }

    const [row] = await tx.update(workflowInstances)
      .set({ currentNodeKey: materialized.currentNodeKeys[0] ?? null })
      .where(eq(workflowInstances.id, inst.id))
      .returning();
    return { row, finished: false, rejected: false, advanced: true, approvedTask, newTasks: materialized.createdTasks };
  });

  const meta = { definitionId: updated.row.definitionId, tenantId: updated.row.tenantId, actor };
  emitTaskEvent('task.approved', mapTask(updated.approvedTask), { ...meta, comment });
  if (updated.advanced) {
    emitNodeEvent('node.left', { instanceId: updated.row.id, ...meta, nodeKey: task.nodeKey, nodeName: task.nodeName, nodeType: task.nodeType });
  }
  for (const t of updated.newTasks) {
    emitNodeEvent('node.entered', { instanceId: updated.row.id, ...meta, nodeKey: t.nodeKey, nodeName: t.nodeName, nodeType: t.nodeType });
    emitTaskEvent('task.created', mapTask(t), meta);
    if (t.assigneeId && t.status === 'pending') {
      emitTaskEvent('task.assigned', mapTask(t), meta);
    }
    if (t.status === 'approved') {
      emitTaskEvent('task.approved', mapTask(t), meta);
    }
    if (t.status === 'rejected') {
      emitTaskEvent('task.rejected', mapTask(t), meta);
    }
    if (t.nodeType === 'delay' && t.status === 'waiting' && t.wakeAt) {
      delayScheduler.scheduleAt(t.id, t.wakeAt);
    }
    if (t.nodeType === 'subProcess' && t.status === 'waiting') {
      const childCfg = (updated.row.definitionSnapshot as { flowData?: WorkflowFlowData } | null)?.flowData?.nodes.find((n) => n.data.key === t.nodeKey)?.data;
      if (childCfg) {
        void spawnSubProcessChild(updated.row, t, childCfg, actor).catch((err) => {
          logger.error('[subProcess] spawn child failed', { instanceId: updated.row.id, taskId: t.id, err });
        });
      }
    }
  }
  if (updated.finished) {
    emitInstanceEvent('instance.approved', mapInstance(updated.row), actor);
    if (updated.row.parentTaskId) {
      void resumeParentSubProcess(updated.row, 'approved', actor).catch((err) => {
        logger.error('[subProcess] resume parent failed', { childId: updated.row.id, err });
      });
    }
  }
  if (updated.rejected) {
    emitInstanceEvent('instance.rejected', mapInstance(updated.row), actor);
    if (updated.row.parentTaskId) {
      void resumeParentSubProcess(updated.row, 'rejected', actor).catch((err) => {
        logger.error('[subProcess] resume parent failed', { childId: updated.row.id, err });
      });
    }
  }

  let message: string;
  if (updated.rejected) {
    message = '审批通过，后续自动拒绝节点已终止流程';
  } else if (updated.finished) {
    message = '审批通过，流程已完成';
  } else if (updated.advanced) {
    message = '审批通过，流程已推进';
  } else {
    message = '审批通过，等待其他审批人处理';
  }
  return {
    instance: mapInstance(updated.row),
    message,
  };
}

export async function rejectTask(taskId: number, comment: string) {
  const user = currentUser();
  const [task] = await db.select().from(workflowTasks).where(and(eq(workflowTasks.id, taskId), eq(workflowTasks.assigneeId, user.userId))).limit(1);
  if (!task) throw new HTTPException(404, { message: '任务不存在或无权操作' });
  if (task.status !== 'pending') throw new HTTPException(400, { message: '任务已处理' });
  const [inst] = await db.select().from(workflowInstances).where(eq(workflowInstances.id, task.instanceId)).limit(1);
  if (!inst) throw new HTTPException(500, { message: '流程数据异常' });
  if (inst.status !== 'running') throw new HTTPException(400, { message: '流程实例不在进行中' });
  return rejectTaskCore(task, inst, comment, { userId: user.userId, name: user.username });
}

/** 外部审批回调：根据 callbackId 找到 waiting 任务并驳回 */
export async function rejectTaskByCallback(callbackId: string, comment: string, approverName: string) {
  const [task] = await db.select().from(workflowTasks).where(eq(workflowTasks.externalCallbackId, callbackId)).limit(1);
  if (!task) throw new HTTPException(404, { message: '回调任务不存在' });
  if (task.status !== 'waiting') throw new HTTPException(400, { message: '回调任务已处理' });
  const [inst] = await db.select().from(workflowInstances).where(eq(workflowInstances.id, task.instanceId)).limit(1);
  if (!inst) throw new HTTPException(500, { message: '流程数据异常' });
  if (inst.status !== 'running') throw new HTTPException(400, { message: '流程实例不在进行中' });
  return rejectTaskCore(task, inst, comment, { userId: 0, name: `external:${approverName}` });
}

export async function rejectTaskCore(
  task: typeof workflowTasks.$inferSelect,
  inst: typeof workflowInstances.$inferSelect,
  comment: string,
  actor: WorkflowEventActor,
) {
  const taskId = task.id;
  // 读取节点驳回策略
  const snapshot = inst.definitionSnapshot as { flowData?: WorkflowFlowData } | null;
  const flowData = snapshot?.flowData;
  const currentNodeCfg = flowData?.nodes.find((n) => n.data.key === task.nodeKey)?.data;
  // 优先采用“操作按钮设置”中拒绝按钮的跳转配置
  const actionRejectJump = (currentNodeCfg?.actionButtons as { reject?: { jumpToNodeKey?: string } } | undefined)?.reject?.jumpToNodeKey;
  let strategy: 'terminate' | 'returnPrev' | 'returnStart' | 'returnToNode' = currentNodeCfg?.rejectStrategy ?? 'terminate';
  let rejectToNodeKey: string | undefined = currentNodeCfg?.rejectToNodeKey;
  if (actionRejectJump) {
    strategy = 'returnToNode';
    rejectToNodeKey = actionRejectJump;
  }

  // 解析目标节点（returnPrev / returnStart / returnToNode）
  let targetNodeKey: string | null = null;
  if (strategy !== 'terminate' && flowData) {
    if (strategy === 'returnToNode') {
      if (rejectToNodeKey && flowData.nodes.some((n) => n.data.key === rejectToNodeKey)) {
        targetNodeKey = rejectToNodeKey;
      }
    } else if (strategy === 'returnPrev') {
      // 找最近一个已 approved 的 approve/handler 任务节点
      const prevApproved = await db.select().from(workflowTasks)
        .where(and(
          eq(workflowTasks.instanceId, inst.id),
          eq(workflowTasks.status, 'approved'),
        ))
        .orderBy(desc(workflowTasks.actionAt), desc(workflowTasks.id));
      const prev = prevApproved.find((t) => {
        const cfg = flowData.nodes.find((n) => n.data.key === t.nodeKey)?.data;
        return cfg && (cfg.type === 'approve' || cfg.type === 'handler');
      });
      if (prev) targetNodeKey = prev.nodeKey;
    } else if (strategy === 'returnStart') {
      // 从头重新走流程（重新生成首批任务）
      targetNodeKey = '__start__';
    }
  }

  const updated = await db.transaction(async (tx) => {
    // 当前任务 → rejected
    const [rejectedTask] = await tx.update(workflowTasks)
      .set({ status: 'rejected', comment, actionAt: new Date() })
      .where(eq(workflowTasks.id, taskId))
      .returning();
    // 同节点其他 pending / waiting 任务跳过
    const skipped = await tx.update(workflowTasks)
      .set({ status: 'skipped', actionAt: new Date() })
      .where(and(
        eq(workflowTasks.instanceId, inst.id),
        eq(workflowTasks.nodeKey, task.nodeKey),
        or(eq(workflowTasks.status, 'pending'), eq(workflowTasks.status, 'waiting')),
      ))
      .returning();

    // 终止：实例置为 rejected
    if (strategy === 'terminate' || !targetNodeKey || !flowData) {
      const [row] = await tx.update(workflowInstances)
        .set({ status: 'rejected', currentNodeKey: null })
        .where(eq(workflowInstances.id, inst.id))
        .returning();
      return { row, terminated: true, rejectedTask, skippedTasks: skipped, newTasks: [] as typeof workflowTasks.$inferSelect[] };
    }

    // 回退：实例保持 running，在目标节点重新生成任务
    const formData = (inst.formData ?? {}) as Record<string, unknown>;
    let advanceResult: AdvanceResult | null = null;

    if (strategy === 'returnStart') {
      advanceResult = getInitialTasks(flowData, formData);
    } else {
      const targetCfg = flowData.nodes.find((n) => n.data.key === targetNodeKey)?.data;
      if (targetCfg && (targetCfg.type === 'approve' || targetCfg.type === 'handler')) {
        advanceResult = {
          finished: false,
          rejected: false,
          tasksToCreate: [{
            nodeKey: targetCfg.key,
            nodeName: targetCfg.label,
            nodeType: targetCfg.type,
            assigneeId: targetCfg.assigneeId ?? null,
            nodeConfig: targetCfg,
          }],
          currentNodeKeys: [targetCfg.key],
        };
      }
    }

    if (!advanceResult || (advanceResult.tasksToCreate.length === 0 && !advanceResult.finished && !advanceResult.rejected)) {
      const [row] = await tx.update(workflowInstances)
        .set({ status: 'rejected', currentNodeKey: null })
        .where(eq(workflowInstances.id, inst.id))
        .returning();
      return { row, terminated: true, rejectedTask, skippedTasks: skipped, newTasks: [] as typeof workflowTasks.$inferSelect[] };
    }

    const materialized = await materializeAdvanceResult(advanceResult, {
      instanceId: inst.id,
      initiatorId: inst.initiatorId,
      executor: tx,
      flowData,
      formData,
      settings: flowData.settings,
    });

    if (materialized.rejected) {
      const [row] = await tx.update(workflowInstances)
        .set({ status: 'rejected', currentNodeKey: null })
        .where(eq(workflowInstances.id, inst.id))
        .returning();
      return { row, terminated: true, rejectedTask, skippedTasks: skipped, newTasks: materialized.createdTasks };
    }

    if (materialized.finished) {
      const [row] = await tx.update(workflowInstances)
        .set({ status: 'approved', currentNodeKey: null })
        .where(eq(workflowInstances.id, inst.id))
        .returning();
      return { row, terminated: false, finished: true, rejectedTask, skippedTasks: skipped, newTasks: materialized.createdTasks };
    }

    const [row] = await tx.update(workflowInstances)
      .set({ currentNodeKey: materialized.currentNodeKeys[0] ?? null })
      .where(eq(workflowInstances.id, inst.id))
      .returning();
    return { row, terminated: false, finished: false, rejectedTask, skippedTasks: skipped, newTasks: materialized.createdTasks };
  });

  const meta = { definitionId: updated.row.definitionId, tenantId: updated.row.tenantId, actor };
  emitTaskEvent('task.rejected', mapTask(updated.rejectedTask), { ...meta, comment });
  for (const t of updated.skippedTasks) {
    emitTaskEvent('task.skipped', mapTask(t), meta);
  }
  emitNodeEvent('node.left', { instanceId: updated.row.id, ...meta, nodeKey: task.nodeKey, nodeName: task.nodeName, nodeType: task.nodeType });
  if (updated.terminated) {
    emitInstanceEvent('instance.rejected', mapInstance(updated.row), actor);
    if (updated.row.parentTaskId) {
      void resumeParentSubProcess(updated.row, 'rejected', actor).catch((err) => {
        logger.error('[subProcess] resume parent failed', { childId: updated.row.id, err });
      });
    }
  } else {
    for (const t of updated.newTasks) {
      emitNodeEvent('node.entered', { instanceId: updated.row.id, ...meta, nodeKey: t.nodeKey, nodeName: t.nodeName, nodeType: t.nodeType });
      emitTaskEvent('task.created', mapTask(t), meta);
      if (t.assigneeId && t.status === 'pending') emitTaskEvent('task.assigned', mapTask(t), meta);
      if (t.status === 'approved') emitTaskEvent('task.approved', mapTask(t), meta);
      if (t.status === 'rejected') emitTaskEvent('task.rejected', mapTask(t), meta);
      if (t.nodeType === 'delay' && t.status === 'waiting' && t.wakeAt) {
        delayScheduler.scheduleAt(t.id, t.wakeAt);
      }
      if (t.nodeType === 'subProcess' && t.status === 'waiting') {
        const childCfg = (updated.row.definitionSnapshot as { flowData?: WorkflowFlowData } | null)?.flowData?.nodes.find((n) => n.data.key === t.nodeKey)?.data;
        if (childCfg) {
          void spawnSubProcessChild(updated.row, t, childCfg, actor).catch((err) => {
            logger.error('[subProcess] spawn child failed', { instanceId: updated.row.id, taskId: t.id, err });
          });
        }
      }
    }
    if (updated.finished) {
      emitInstanceEvent('instance.approved', mapInstance(updated.row), actor);
      if (updated.row.parentTaskId) {
        void resumeParentSubProcess(updated.row, 'approved', actor).catch((err) => {
          logger.error('[subProcess] resume parent failed', { childId: updated.row.id, err });
        });
      }
    }
  }

  return mapInstance(updated.row);
}

// ─── 转办 / 委派 / 加签 / 退回 ─────────────────────────────────────────────────

/** 通用：获取当前用户名下的 pending 任务 + 实例（含校验） */
async function getOwnPendingTask(taskId: number) {
  const user = currentUser();
  const [task] = await db.select().from(workflowTasks)
    .where(and(eq(workflowTasks.id, taskId), eq(workflowTasks.assigneeId, user.userId)))
    .limit(1);
  if (!task) throw new HTTPException(404, { message: '任务不存在或无权操作' });
  if (task.status !== 'pending') throw new HTTPException(400, { message: '任务已处理' });
  const [inst] = await db.select().from(workflowInstances)
    .where(eq(workflowInstances.id, task.instanceId)).limit(1);
  if (!inst) throw new HTTPException(500, { message: '流程数据异常' });
  if (inst.status !== 'running') throw new HTTPException(400, { message: '流程实例不在进行中' });
  return { task, inst, actor: { userId: user.userId, name: user.username } };
}

/** 转办：将当前任务的处理人改为目标用户 */
export async function transferTask(taskId: number, targetUserId: number, comment?: string) {
  const { task, inst, actor } = await getOwnPendingTask(taskId);
  if (targetUserId === task.assigneeId) {
    throw new HTTPException(400, { message: '转办人不能是当前处理人' });
  }
  const [target] = await db.select({ id: users.id, nickname: users.nickname })
    .from(users).where(eq(users.id, targetUserId)).limit(1);
  if (!target) throw new HTTPException(400, { message: '转办人不存在' });
  const transferSuffix = comment ? `：${comment}` : '';
  const transferComment = `[转办] 由 ${actor.name ?? '系统'} 转办${transferSuffix}`;
  const [updated] = await db.update(workflowTasks)
    .set({ assigneeId: targetUserId, comment: transferComment })
    .where(eq(workflowTasks.id, task.id))
    .returning();
  emitTaskEvent('task.transferred', mapTask(updated, target.nickname),
    { definitionId: inst.definitionId, tenantId: inst.tenantId, actor, comment: transferComment });
  return mapTask(updated, target.nickname);
}

/** 委派：与转办类似，但语义为"临时代办"，意见名加上委派标记 */
export async function delegateTask(taskId: number, targetUserId: number, comment?: string) {
  const { task, inst, actor } = await getOwnPendingTask(taskId);
  if (targetUserId === task.assigneeId) {
    throw new HTTPException(400, { message: '委派人不能是当前处理人' });
  }
  const [target] = await db.select({ id: users.id, nickname: users.nickname })
    .from(users).where(eq(users.id, targetUserId)).limit(1);
  if (!target) throw new HTTPException(400, { message: '委派人不存在' });
  const delegateSuffix = comment ? `：${comment}` : '';
  const delegateComment = `[委派] 由 ${actor.name ?? '系统'} 委派${delegateSuffix}`;
  const [updated] = await db.update(workflowTasks)
    .set({ assigneeId: targetUserId, comment: delegateComment })
    .where(eq(workflowTasks.id, task.id))
    .returning();
  emitTaskEvent('task.transferred', mapTask(updated, target.nickname),
    { definitionId: inst.definitionId, tenantId: inst.tenantId, actor, comment: delegateComment });
  return mapTask(updated, target.nickname);
}

/** 加签：在当前节点新增若干同节点 pending 任务（与原任务一并参与节点完成判定） */
export async function addSignTask(
  taskId: number,
  targetUserIds: number[],
  position: 'before' | 'after',
  comment?: string,
) {
  const { task, inst, actor } = await getOwnPendingTask(taskId);
  if (targetUserIds.length === 0) throw new HTTPException(400, { message: '请选择加签人' });
  // 与现有同节点任务共用 approveMethod（保证完成判定一致）
  const [sibling] = await db.select().from(workflowTasks)
    .where(and(eq(workflowTasks.instanceId, inst.id), eq(workflowTasks.nodeKey, task.nodeKey)))
    .limit(1);
  const approveMethod = sibling?.approveMethod ?? 'and';
  const posLabel = position === 'before' ? '前' : '后';
  const addSignSuffix = comment ? `：${comment}` : '';
  const addSignComment = `[加签-${posLabel}] 由 ${actor.name ?? '系统'} 发起${addSignSuffix}`;

  const created = await db.transaction(async (tx) => {
    // before：原任务先转为 waiting，加签任务为 pending；后续由 sequential 逻辑或单独完成回调推进
    // after：原任务保持 pending，加签任务以 pending 一起并行
    if (position === 'before') {
      await tx.update(workflowTasks).set({ status: 'waiting' }).where(eq(workflowTasks.id, task.id));
    }
    const newRows = await tx.insert(workflowTasks).values(
      targetUserIds.map((uid) => ({
        instanceId: inst.id,
        nodeKey: task.nodeKey,
        nodeName: task.nodeName,
        nodeType: task.nodeType,
        assigneeId: uid,
        status: 'pending' as const,
        comment: addSignComment,
        approveMethod,
      })),
    ).returning();
    return newRows;
  });

  const meta = { definitionId: inst.definitionId, tenantId: inst.tenantId, actor };
  for (const t of created) {
    emitTaskEvent('task.created', mapTask(t), meta);
    if (t.assigneeId) emitTaskEvent('task.assigned', mapTask(t), meta);
  }
  return { created: created.map((t) => mapTask(t)), message: `已加签 ${created.length} 人` };
}

/** 退回：将当前任务驳回到指定前序节点（使用 rejectTaskCore 的 returnToNode 路径） */
export async function returnTask(taskId: number, targetNodeKey: string, comment: string) {
  const { task, inst, actor } = await getOwnPendingTask(taskId);
  const flowData = (inst.definitionSnapshot as { flowData?: WorkflowFlowData } | null)?.flowData;
  if (!flowData) throw new HTTPException(500, { message: '流程快照数据异常' });
  const targetNode = flowData.nodes.find((n) => n.data.key === targetNodeKey)?.data;
  if (!targetNode) throw new HTTPException(400, { message: '退回目标节点不存在' });
  if (targetNode.type !== 'approve' && targetNode.type !== 'handler') {
    throw new HTTPException(400, { message: '只能退回到审批/办理节点' });
  }
  // 临时覆盖快照中当前节点的 rejectStrategy / rejectToNodeKey，使 rejectTaskCore 走 returnToNode 路径
  const overriddenSnapshot = structuredClone(inst.definitionSnapshot) as { flowData?: WorkflowFlowData };
  const currentNode = overriddenSnapshot.flowData?.nodes.find((n) => n.data.key === task.nodeKey);
  if (currentNode) {
    currentNode.data.rejectStrategy = 'returnToNode';
    currentNode.data.rejectToNodeKey = targetNodeKey;
  }
  const instOverridden = { ...inst, definitionSnapshot: overriddenSnapshot };
  return rejectTaskCore(task, instOverridden, comment, actor);
}
