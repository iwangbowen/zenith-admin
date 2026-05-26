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
    originalAssigneeId: row.originalAssigneeId ?? null,
    transferChain: Array.isArray(row.transferChain) ? row.transferChain : [],
    delegatedFromId: row.delegatedFromId ?? null,
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
import { count, countDistinct, eq, and, desc, ilike, or, inArray } from 'drizzle-orm';
import { escapeLike, withPagination } from '../lib/where-helpers';
import { db } from '../db';
import { pageOffset } from '../lib/pagination';
import { workflowInstances, workflowTasks, workflowTaskUrges, workflowDefinitions, workflowCategories, users, userRoles } from '../db/schema';
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
import { computeTimeoutAt } from '../lib/workflow-timeout';
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
  type: 'task.created' | 'task.approved' | 'task.rejected' | 'task.skipped' | 'task.transferred' | 'task.assigned' | 'task.addSigned' | 'task.reduceSigned' | 'task.urged',
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

    if (t.nodeType === 'ccNode') {
      // 解析抄送接收人：支持 assigneeType（user/role/dept/formUser 等）+ 变量插值；
      // resolver 内部使用 Set 完成去重，并在未声明 assigneeType 时自动回退 assigneeIds + assigneeId
      const ccUserIds = await resolveAssigneeIds(t.nodeConfig, {
        initiatorId: ctx.initiatorId,
        executor: ctx.executor,
        formData: ctx.formData,
        instanceId: ctx.instanceId,
      });
      for (const uid of ccUserIds) {
        rows.push({
          instanceId: ctx.instanceId,
          nodeKey: t.nodeKey,
          nodeName: t.nodeName,
          nodeType: 'ccNode' as const,
          assigneeId: uid,
          status: 'skipped' as const,
          actionAt: null,
        });
      }
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
      let emptyAssignIds: number[] = [];
      if (t.nodeConfig.emptyAssignToIds && t.nodeConfig.emptyAssignToIds.length > 0) {
        emptyAssignIds = t.nodeConfig.emptyAssignToIds;
      } else if (t.nodeConfig.emptyAssignTo) {
        emptyAssignIds = [t.nodeConfig.emptyAssignTo];
      }
      if (emptyStrategy === 'assignTo' && emptyAssignIds.length > 0) {
        const emptyMethod: 'and' | 'or' | null = emptyAssignIds.length > 1 ? 'and' : null;
        emptyAssignIds.forEach((uid) => {
          rows.push({
            instanceId: ctx.instanceId,
            nodeKey: t.nodeKey,
            nodeName: t.nodeName,
            nodeType: t.nodeType,
            assigneeId: uid,
            status: 'pending' as const,
            approveMethod: emptyMethod,
          });
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

    const fallbackMethod: 'and' | 'or' = userIds.length > 1 ? 'and' : 'or';
    let effectiveUserIds = userIds;
    if (rawMethod === 'random' && userIds.length > 1) {
      effectiveUserIds = [userIds[Math.floor(Math.random() * userIds.length)]];
    }
    const method: Exclude<WorkflowApproveMethod, 'auto' | 'random'> =
      rawMethod && rawMethod !== 'auto' && rawMethod !== 'random' ? rawMethod : fallbackMethod;
    const ratioPct = method === 'ratio'
      ? Math.min(100, Math.max(1, t.nodeConfig.approveRatio ?? 51))
      : null;
    const timeoutAt = computeTimeoutAt(t.nodeConfig.timeout);
    effectiveUserIds.forEach((uid, idx) => {
      const isPending = !(method === 'sequential' && idx > 0);
      rows.push({
        instanceId: ctx.instanceId,
        nodeKey: t.nodeKey,
        nodeName: t.nodeName,
        nodeType: t.nodeType,
        assigneeId: uid,
        // 顺序会签：只有第一人 pending，其余 waiting
        status: method === 'sequential' && idx > 0 ? 'waiting' as const : 'pending' as const,
        taskOrder: method === 'sequential' ? idx : null,
        approveMethod: effectiveUserIds.length > 1 ? method : null,
        approveRatio: effectiveUserIds.length > 1 ? ratioPct : null,
        // 仅给 pending 的任务设置 timeoutAt；waiting 的在提升时重算
        timeoutAt: isPending ? timeoutAt : null,
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
  flowData?: WorkflowFlowData,
): Promise<{ completed: boolean; method: WorkflowApproveMethod | null }> {
  const siblings = await tx.select().from(workflowTasks)
    .where(and(eq(workflowTasks.instanceId, instanceId), eq(workflowTasks.nodeKey, nodeKey)));
  if (siblings.length === 0) return { completed: true, method: null };
  const method = siblings.find((t) => t.approveMethod)?.approveMethod ?? null;

  // before-加签恢复：如果同节点存在挂起原任务（status=waiting且非顺序会签）且所有 [加签-前] 任务都已处理，则将原任务升回 pending，让节点能够继续流转。
  const beforeSuspended = siblings.filter((t) => t.status === 'waiting' && t.taskOrder == null);
  if (beforeSuspended.length > 0) {
    const beforeSignTasks = siblings.filter((t) => t.comment?.startsWith('[加签-前]'));
    const allBeforeResolved = beforeSignTasks.length > 0
      && beforeSignTasks.every((t) => t.status === 'approved' || t.status === 'skipped');
    if (allBeforeResolved) {
      const restoredIds = beforeSuspended.map((t) => t.id);
      await tx.update(workflowTasks).set({ status: 'pending' })
        .where(inArray(workflowTasks.id, restoredIds));
      for (const t of beforeSuspended) {
        siblings[siblings.findIndex((s) => s.id === t.id)] = { ...t, status: 'pending' };
      }
    } else {
      // 原任务仍需等待加签人完成，节点不可能完成
      return { completed: false, method };
    }
  }

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
      const nextTimeoutCfg = flowData?.nodes.find((n) => n.data.key === nodeKey)?.data.timeout;
      const nextTimeoutAt = computeTimeoutAt(nextTimeoutCfg);
      await tx.update(workflowTasks).set({ status: 'pending', timeoutAt: nextTimeoutAt, timeoutRemindCount: 0 })
        .where(eq(workflowTasks.id, nextWaiting.id));
    }
    return { completed: false, method };
  }
  if (method === 'ratio') {
    const total = siblings.length;
    const ratioPct = siblings.find((t) => t.approveRatio)?.approveRatio ?? 51;
    const required = Math.ceil(total * ratioPct / 100);
    const approvedCount = siblings.filter((t) => t.status === 'approved').length;
    if (approvedCount >= required) {
      // 剩余 pending/waiting 任务跳过
      await tx.update(workflowTasks).set({ status: 'skipped', actionAt: new Date() })
        .where(and(
          eq(workflowTasks.instanceId, instanceId),
          eq(workflowTasks.nodeKey, nodeKey),
          or(eq(workflowTasks.status, 'pending'), eq(workflowTasks.status, 'waiting')),
        ));
      return { completed: true, method };
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

export async function createInstance(data: { definitionId: number; title: string; formData?: Record<string, unknown> | null }, callerOverride?: { userId: number; username: string; tenantId: number | null; roles?: string[] }) {
  const user = callerOverride
    ? { userId: callerOverride.userId, username: callerOverride.username, roles: callerOverride.roles ?? [], tenantId: callerOverride.tenantId }
    : currentUser();
  const skipScopeCheck = !!callerOverride;
  const [def] = await db.select().from(workflowDefinitions).where(and(eq(workflowDefinitions.id, data.definitionId), eq(workflowDefinitions.status, 'published'))).limit(1);
  if (!def) throw new HTTPException(404, { message: '流程定义不存在或未发布' });
  const scopeType = (def.initiatorScopeType ?? 'all') as 'all' | 'users' | 'departments' | 'roles';
  const scopeIds = Array.isArray(def.initiatorScopeIds)
    ? def.initiatorScopeIds.map(Number).filter((v) => Number.isInteger(v) && v > 0)
    : [];
  if (!skipScopeCheck && scopeType !== 'all') {
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
  if (nodeCfg?.operations?.includes('opinionRequired') && !comment?.trim()) {
    throw new HTTPException(400, { message: '请填写审批意见后再提交' });
  }
  const enrichedComment = attachments && attachments.length > 0
    ? `${comment ?? ''}\n[附件]${attachments.map((a) => a.name).join(', ')}`.trim()
    : comment;
  // 委派回执：若由委派人操作，不推进流程，仅生成回执任务给原委派人
  if (task.delegatedFromId && task.delegatedFromId !== user.userId) {
    return processDelegatedReceipt(task, inst, 'approved', enrichedComment, { userId: user.userId, name: user.username });
  }
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
    const { completed } = await checkNodeCompletion(tx, inst.id, task.nodeKey, flowData);
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
  if (!comment.trim()) throw new HTTPException(400, { message: '请填写拒绝原因' });
  if (task.delegatedFromId && task.delegatedFromId !== user.userId) {
    return processDelegatedReceipt(task, inst, 'rejected', comment, { userId: user.userId, name: user.username });
  }
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
  // 比例会签：在阈值仍可达成时，仅标记当前任务 rejected，不触发整节点驳回
  if (task.approveMethod === 'ratio' && task.approveRatio) {
    const siblings = await db.select().from(workflowTasks)
      .where(and(eq(workflowTasks.instanceId, inst.id), eq(workflowTasks.nodeKey, task.nodeKey)));
    const total = siblings.length;
    const required = Math.ceil(total * task.approveRatio / 100);
    const rejectedAfter = siblings.filter((t) => t.status === 'rejected').length + 1;
    const maxPossibleApproved = total - rejectedAfter;
    if (maxPossibleApproved >= required) {
      const [rejectedTask] = await db.update(workflowTasks)
        .set({ status: 'rejected', comment, actionAt: new Date() })
        .where(eq(workflowTasks.id, taskId))
        .returning();
      const meta = { definitionId: inst.definitionId, tenantId: inst.tenantId, actor };
      emitTaskEvent('task.rejected', mapTask(rejectedTask), { ...meta, comment });
      return mapInstance(inst);
    }
  }
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

/** 委派回执：当委派人对任务做出反馈（同意/拒绝）时，原委派人接手并继续审批 */
async function processDelegatedReceipt(
  task: typeof workflowTasks.$inferSelect,
  inst: typeof workflowInstances.$inferSelect,
  action: 'approved' | 'rejected',
  comment: string | undefined,
  actor: WorkflowEventActor,
): Promise<ApproveResult> {
  const delegatorId = task.delegatedFromId;
  if (!delegatorId) throw new HTTPException(500, { message: '委派回执缺失原始审批人' });
  const verb = action === 'approved' ? '同意' : '拒绝';
  const tail = comment ? `：${comment}` : '';
  const receiptComment = `[委派回执] ${actor.name ?? '系统'} 建议${verb}${tail}`;

  const result = await db.transaction(async (tx) => {
    const [closedTask] = await tx.update(workflowTasks).set({
      status: action,
      comment: receiptComment,
      actionAt: new Date(),
    }).where(eq(workflowTasks.id, task.id)).returning();
    const [newTask] = await tx.insert(workflowTasks).values({
      instanceId: task.instanceId,
      nodeKey: task.nodeKey,
      nodeName: task.nodeName,
      nodeType: task.nodeType,
      assigneeId: delegatorId,
      status: 'pending',
      taskOrder: task.taskOrder,
      approveMethod: task.approveMethod,
      approveRatio: task.approveRatio,
      originalAssigneeId: delegatorId,
      transferChain: [],
      delegatedFromId: null,
      comment: receiptComment,
    }).returning();
    return { closedTask, newTask };
  });

  const meta = { definitionId: inst.definitionId, tenantId: inst.tenantId, actor };
  if (action === 'approved') {
    emitTaskEvent('task.approved', mapTask(result.closedTask), { ...meta, comment });
  } else {
    emitTaskEvent('task.rejected', mapTask(result.closedTask), { ...meta, comment });
  }
  emitTaskEvent('task.created', mapTask(result.newTask), meta);
  emitTaskEvent('task.assigned', mapTask(result.newTask), meta);

  return {
    instance: mapInstance(inst),
    message: '已提交委派回执，等待原审批人确认',
  };
}

/** 转办：将当前任务的处理人改为目标用户 */
export async function transferTask(taskId: number, targetUserId: number, comment?: string) {
  const { task, inst, actor } = await getOwnPendingTask(taskId);
  if (targetUserId === task.assigneeId) {
    throw new HTTPException(400, { message: '转办人不能是当前处理人' });
  }
  const chain: number[] = Array.isArray(task.transferChain) ? task.transferChain : [];
  const original = task.originalAssigneeId ?? task.assigneeId;
  // 禁止折返：转给链路上曾经出现过的人（含原始 assignee）
  if (chain.includes(targetUserId) || targetUserId === original) {
    throw new HTTPException(400, { message: '禁止将任务转回曾经经手的处理人' });
  }
  const [target] = await db.select({ id: users.id, nickname: users.nickname })
    .from(users).where(eq(users.id, targetUserId)).limit(1);
  if (!target) throw new HTTPException(400, { message: '转办人不存在' });
  const transferSuffix = comment ? `：${comment}` : '';
  const transferComment = `[转办] 由 ${actor.name ?? '系统'} 转办${transferSuffix}`;
  const nextChain = task.assigneeId ? [...chain, task.assigneeId] : chain;
  const [updated] = await db.update(workflowTasks)
    .set({
      assigneeId: targetUserId,
      comment: transferComment,
      transferChain: nextChain,
      originalAssigneeId: task.originalAssigneeId ?? task.assigneeId ?? null,
    })
    .where(eq(workflowTasks.id, task.id))
    .returning();
  emitTaskEvent('task.transferred', mapTask(updated, target.nickname),
    { definitionId: inst.definitionId, tenantId: inst.tenantId, actor, comment: transferComment });
  return mapTask(updated, target.nickname);
}

/** 委派：与转办类似，但语义为"临时代办"，反馈后原 assignee 会接到回执确认任务 */
export async function delegateTask(taskId: number, targetUserId: number, comment?: string) {
  const { task, inst, actor } = await getOwnPendingTask(taskId);
  if (targetUserId === task.assigneeId) {
    throw new HTTPException(400, { message: '委派人不能是当前处理人' });
  }
  const chain: number[] = Array.isArray(task.transferChain) ? task.transferChain : [];
  const original = task.originalAssigneeId ?? task.assigneeId;
  if (chain.includes(targetUserId) || targetUserId === original) {
    throw new HTTPException(400, { message: '禁止将任务委派给曾经经手的处理人' });
  }
  const [target] = await db.select({ id: users.id, nickname: users.nickname })
    .from(users).where(eq(users.id, targetUserId)).limit(1);
  if (!target) throw new HTTPException(400, { message: '委派人不存在' });
  const delegateSuffix = comment ? `：${comment}` : '';
  const delegateComment = `[委派] 由 ${actor.name ?? '系统'} 委派${delegateSuffix}`;
  const nextChain = task.assigneeId ? [...chain, task.assigneeId] : chain;
  // delegatedFromId 仅在首次委派时设置（保留最原始的委派人，以便回执时返还）
  const delegatedFromId = task.delegatedFromId ?? task.assigneeId ?? null;
  const [updated] = await db.update(workflowTasks)
    .set({
      assigneeId: targetUserId,
      comment: delegateComment,
      transferChain: nextChain,
      originalAssigneeId: task.originalAssigneeId ?? task.assigneeId ?? null,
      delegatedFromId,
    })
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
  position: 'before' | 'after' | 'parallel',
  comment?: string,
) {
  const { task, inst, actor } = await getOwnPendingTask(taskId);
  if (targetUserIds.length === 0) throw new HTTPException(400, { message: '请选择加签人' });
  // 与现有同节点任务共用 approveMethod（保证完成判定一致）
  const [sibling] = await db.select().from(workflowTasks)
    .where(and(eq(workflowTasks.instanceId, inst.id), eq(workflowTasks.nodeKey, task.nodeKey)))
    .limit(1);
  const approveMethod = sibling?.approveMethod ?? 'and';
  const posLabelMap = { before: '前', after: '后', parallel: '并' } as const;
  const posLabel = posLabelMap[position];
  const addSignSuffix = comment ? `：${comment}` : '';
  const addSignComment = `[加签-${posLabel}] 由 ${actor.name ?? '系统'} 发起${addSignSuffix}`;

  const created = await db.transaction(async (tx) => {
    // before：原任务先转为 waiting，加签任务为 pending；待加签人审批通过后由完成回调推进
    // after / parallel：原任务保持 pending，加签任务以 pending 与之并行（共享 approveMethod 判定完成）
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
    emitTaskEvent('task.addSigned', mapTask(t), { ...meta, comment: addSignComment });
  }
  return { created: created.map((t) => mapTask(t)), message: `已加签 ${created.length} 人` };
}

/** 减签：取消同节点上以加签方式创建的其他 pending 任务（仅限加签产生的任务，不能减去原始审批人） */
export async function reduceSignTask(taskId: number, targetTaskIds: number[], comment?: string) {
  const { task, inst, actor } = await getOwnPendingTask(taskId);
  if (targetTaskIds.length === 0) throw new HTTPException(400, { message: '请选择要减签的任务' });
  if (targetTaskIds.includes(task.id)) throw new HTTPException(400, { message: '不能减去自己' });

  const targets = await db.select().from(workflowTasks).where(and(
    eq(workflowTasks.instanceId, inst.id),
    eq(workflowTasks.nodeKey, task.nodeKey),
    inArray(workflowTasks.id, targetTaskIds),
  ));
  if (targets.length !== targetTaskIds.length) throw new HTTPException(400, { message: '部分任务不存在或不同节点' });
  for (const t of targets) {
    if (t.status !== 'pending' && t.status !== 'waiting') {
      throw new HTTPException(400, { message: '仅可减签未处理的任务' });
    }
    if (!t.comment?.startsWith('[加签-')) {
      throw new HTTPException(400, { message: '仅可减去加签产生的任务，原始审批人不可移除' });
    }
  }

  const snapshot = inst.definitionSnapshot as { flowData?: WorkflowFlowData } | null;
  const flowData = snapshot?.flowData;
  const suffix = comment ? `：${comment}` : '';
  const reduceComment = `[减签] 由 ${actor.name ?? '系统'} 发起${suffix}`;

  const removed = await db.transaction(async (tx) => {
    const updated = await tx.update(workflowTasks).set({
      status: 'skipped',
      actionAt: new Date(),
      comment: reduceComment,
    }).where(inArray(workflowTasks.id, targetTaskIds)).returning();
    // 复核节点完成状态（例如 and 会签减后可能已足）
    await checkNodeCompletion(tx, inst.id, task.nodeKey, flowData);
    return updated;
  });

  const meta = { definitionId: inst.definitionId, tenantId: inst.tenantId, actor };
  for (const t of removed) {
    emitTaskEvent('task.skipped', mapTask(t), meta);
    emitTaskEvent('task.reduceSigned', mapTask(t), { ...meta, comment: reduceComment });
  }
  return { removed: removed.map((t) => mapTask(t)), message: `已减签 ${removed.length} 人` };
}

// ─── 催办 ─────────────────────────────────────────────────────────────────────

/** 同一任务两次催办的最小间隔（毫秒） */
const URGE_MIN_INTERVAL_MS = 5 * 60 * 1000;

function mapTaskUrge(row: typeof workflowTaskUrges.$inferSelect): import('@zenith/shared').WorkflowTaskUrge {
  return {
    id: row.id,
    taskId: row.taskId,
    instanceId: row.instanceId,
    urgerId: row.urgerId ?? null,
    urgerName: row.urgerName ?? null,
    message: row.message ?? null,
    createdAt: formatDateTime(row.createdAt),
  };
}

/** 催办：仅发起人或管理员可催办 pending 任务；同任务 5 分钟内不可重复 */
export async function urgeTask(taskId: number, message?: string) {
  const user = currentUser();
  const [task] = await db.select().from(workflowTasks)
    .where(eq(workflowTasks.id, taskId)).limit(1);
  if (!task) throw new HTTPException(404, { message: '任务不存在' });
  if (task.status !== 'pending') throw new HTTPException(400, { message: '仅可催办未处理任务' });
  const [inst] = await db.select().from(workflowInstances)
    .where(eq(workflowInstances.id, task.instanceId)).limit(1);
  if (!inst) throw new HTTPException(500, { message: '流程数据异常' });
  if (inst.status !== 'running') throw new HTTPException(400, { message: '流程已结束，无需催办' });

  const isInitiator = inst.initiatorId === user.userId;
  const isAdmin = (user.roles ?? []).some((r) => r === 'super_admin' || r === 'tenant_admin');
  if (!isInitiator && !isAdmin) {
    throw new HTTPException(403, { message: '仅发起人或管理员可催办' });
  }

  const [last] = await db.select({ createdAt: workflowTaskUrges.createdAt }).from(workflowTaskUrges)
    .where(eq(workflowTaskUrges.taskId, taskId))
    .orderBy(desc(workflowTaskUrges.createdAt)).limit(1);
  if (last) {
    const elapsed = Date.now() - new Date(last.createdAt).getTime();
    if (elapsed < URGE_MIN_INTERVAL_MS) {
      const wait = Math.ceil((URGE_MIN_INTERVAL_MS - elapsed) / 1000);
      throw new HTTPException(429, { message: `催办过于频繁，请 ${wait} 秒后再试` });
    }
  }

  const [row] = await db.insert(workflowTaskUrges).values({
    taskId,
    instanceId: inst.id,
    urgerId: user.userId,
    urgerName: user.username ?? null,
    message: message?.trim() || null,
  }).returning();

  const actor = { userId: user.userId, name: user.username };
  emitTaskEvent('task.urged', mapTask(task), {
    definitionId: inst.definitionId,
    tenantId: inst.tenantId,
    actor,
    comment: row.message ?? undefined,
  });
  return mapTaskUrge(row);
}

/** 查询某任务的催办历史 */
export async function listTaskUrges(taskId: number) {
  const rows = await db.select().from(workflowTaskUrges)
    .where(eq(workflowTaskUrges.taskId, taskId))
    .orderBy(desc(workflowTaskUrges.createdAt));
  return rows.map(mapTaskUrge);
}

/** 查询某实例的全部催办历史 */
export async function listInstanceUrges(instanceId: number) {
  const rows = await db.select().from(workflowTaskUrges)
    .where(eq(workflowTaskUrges.instanceId, instanceId))
    .orderBy(desc(workflowTaskUrges.createdAt));
  return rows.map(mapTaskUrge);
}

/** 实例级批量催办：对实例所有 pending 任务依次催办，节流命中的任务静默跳过 */
export async function urgeInstance(instanceId: number, message?: string) {
  const user = currentUser();
  const [inst] = await db.select().from(workflowInstances)
    .where(eq(workflowInstances.id, instanceId)).limit(1);
  if (!inst) throw new HTTPException(404, { message: '流程不存在' });
  if (inst.status !== 'running') throw new HTTPException(400, { message: '流程已结束，无需催办' });
  const isInitiator = inst.initiatorId === user.userId;
  const isAdmin = (user.roles ?? []).some((r) => r === 'super_admin' || r === 'tenant_admin');
  if (!isInitiator && !isAdmin) throw new HTTPException(403, { message: '仅发起人或管理员可催办' });

  const pendings = await db.select().from(workflowTasks)
    .where(and(eq(workflowTasks.instanceId, instanceId), eq(workflowTasks.status, 'pending')));
  if (pendings.length === 0) throw new HTTPException(400, { message: '没有待办任务可催办' });

  const created: import('@zenith/shared').WorkflowTaskUrge[] = [];
  let skipped = 0;
  for (const task of pendings) {
    const [last] = await db.select({ createdAt: workflowTaskUrges.createdAt }).from(workflowTaskUrges)
      .where(eq(workflowTaskUrges.taskId, task.id))
      .orderBy(desc(workflowTaskUrges.createdAt)).limit(1);
    if (last && Date.now() - new Date(last.createdAt).getTime() < URGE_MIN_INTERVAL_MS) {
      skipped += 1;
      continue;
    }
    const [row] = await db.insert(workflowTaskUrges).values({
      taskId: task.id,
      instanceId,
      urgerId: user.userId,
      urgerName: user.username ?? null,
      message: message?.trim() || null,
    }).returning();
    created.push(mapTaskUrge(row));
    const actor = { userId: user.userId, name: user.username };
    emitTaskEvent('task.urged', mapTask(task), {
      definitionId: inst.definitionId,
      tenantId: inst.tenantId,
      actor,
      comment: row.message ?? undefined,
    });
  }
  return {
    list: created,
    message: skipped > 0
      ? `已催办 ${created.length} 人，${skipped} 人催办过于频繁已跳过`
      : `已催办 ${created.length} 人`,
  };
}

/** 动态补加抄送：运行中实例为指定 ccNode 节点补加抄送人（去重 + 校验节点类型） */
export async function addInstanceCc(instanceId: number, nodeKey: string, userIds: number[]) {
  const user = currentUser();
  const [inst] = await db.select().from(workflowInstances)
    .where(eq(workflowInstances.id, instanceId)).limit(1);
  if (!inst) throw new HTTPException(404, { message: '流程不存在' });
  if (inst.status !== 'running') throw new HTTPException(400, { message: '流程已结束，无法补加抄送' });
  const isInitiator = inst.initiatorId === user.userId;
  const isAdmin = (user.roles ?? []).some((r) => r === 'super_admin' || r === 'tenant_admin');
  if (!isInitiator && !isAdmin) throw new HTTPException(403, { message: '仅发起人或管理员可补加抄送' });

  const flowData = (inst.definitionSnapshot as { flowData?: WorkflowFlowData } | null)?.flowData;
  if (!flowData) throw new HTTPException(500, { message: '流程快照数据异常' });
  const node = flowData.nodes.find((n) => n.data.key === nodeKey);
  if (!node) throw new HTTPException(400, { message: '抄送节点不存在' });
  if (node.data.type !== 'ccNode') throw new HTTPException(400, { message: '仅 ccNode 节点支持补加抄送' });

  // 去重：过滤掉已经在该节点抄送过的用户
  const existing = await db.select({ assigneeId: workflowTasks.assigneeId }).from(workflowTasks)
    .where(and(
      eq(workflowTasks.instanceId, instanceId),
      eq(workflowTasks.nodeKey, nodeKey),
      eq(workflowTasks.nodeType, 'ccNode'),
    ));
  const existingSet = new Set(existing.map((r) => r.assigneeId).filter((v): v is number => typeof v === 'number'));
  const toAdd = Array.from(new Set(userIds)).filter((uid) => !existingSet.has(uid));
  if (toAdd.length === 0) {
    return { list: [] as ReturnType<typeof mapTask>[], message: '所选用户均已抄送，无需重复添加' };
  }

  const rows = toAdd.map((uid) => ({
    instanceId,
    nodeKey,
    nodeName: node.data.label,
    nodeType: 'ccNode' as const,
    assigneeId: uid,
    status: 'skipped' as const,
    actionAt: null,
  }));
  const inserted = await db.insert(workflowTasks).values(rows).returning();
  const actor = { userId: user.userId, name: user.username };
  for (const t of inserted) {
    emitTaskEvent('task.created', mapTask(t), {
      definitionId: inst.definitionId,
      tenantId: inst.tenantId,
      actor,
    });
  }
  return {
    list: inserted.map((t) => mapTask(t)),
    message: `已补加 ${inserted.length} 人抄送`,
  };
}

/** 退回：将当前任务驳回到一个或多个前序节点（多节点取流程定义中最早出现的节点作为执行目标） */
export async function returnTask(taskId: number, targetNodeKeys: string[], comment: string) {
  const { task, inst, actor } = await getOwnPendingTask(taskId);
  const flowData = (inst.definitionSnapshot as { flowData?: WorkflowFlowData } | null)?.flowData;
  if (!flowData) throw new HTTPException(500, { message: '流程快照数据异常' });
  if (!Array.isArray(targetNodeKeys) || targetNodeKeys.length === 0) {
    throw new HTTPException(400, { message: '请选择退回节点' });
  }
  const uniqueKeys = Array.from(new Set(targetNodeKeys));
  const targets = uniqueKeys.map((k) => {
    const n = flowData.nodes.find((nd) => nd.data.key === k);
    if (!n) throw new HTTPException(400, { message: `退回目标节点不存在：${k}` });
    if (n.data.type !== 'approve' && n.data.type !== 'handler') {
      throw new HTTPException(400, { message: '只能退回到审批/办理节点' });
    }
    return n;
  });
  // 多节点退回：选择 flowData.nodes 顺序中最早出现的节点作为实际目标（更贴近用户预期：回到最早分歧点）
  const earliest = targets.reduce((acc, cur) => {
    const accIdx = flowData.nodes.findIndex((n) => n.data.key === acc.data.key);
    const curIdx = flowData.nodes.findIndex((n) => n.data.key === cur.data.key);
    return curIdx < accIdx ? cur : acc;
  }, targets[0]);

  const overriddenSnapshot = structuredClone(inst.definitionSnapshot) as { flowData?: WorkflowFlowData };
  const currentNode = overriddenSnapshot.flowData?.nodes.find((n) => n.data.key === task.nodeKey);
  if (currentNode) {
    currentNode.data.rejectStrategy = 'returnToNode';
    currentNode.data.rejectToNodeKey = earliest.data.key;
  }
  const instOverridden = { ...inst, definitionSnapshot: overriddenSnapshot };
  const mergedComment = targets.length > 1
    ? `[退回多节点: ${targets.map((t) => t.data.label ?? t.data.key).join('、')}] ${comment}`
    : comment;
  return rejectTaskCore(task, instOverridden, mergedComment, actor);
}
