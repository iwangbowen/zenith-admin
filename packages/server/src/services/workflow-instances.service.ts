// ─── 数据映射 ─────────────────────────────────────────────────────────────────
import { formatDateTime, formatNullableDateTime } from '../lib/datetime';

export function mapTask(
  row: typeof workflowTasks.$inferSelect,
  assigneeName?: string | null,
  assigneeAvatar?: string | null,
  actionButtons?: Partial<Record<WorkflowActionButtonKey, WorkflowActionButtonConfig>> | null,
  signatureRequired?: boolean,
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
    signature: row.signature ?? null,
    attachments: Array.isArray(row.attachments) ? row.attachments : [],
    signatureRequired: signatureRequired ?? false,
    actionAt: formatNullableDateTime(row.actionAt),
    originalAssigneeId: row.originalAssigneeId ?? null,
    transferChain: Array.isArray(row.transferChain) ? row.transferChain : [],
    delegatedFromId: row.delegatedFromId ?? null,
    actionButtons: actionButtons ?? null,
    externalCallbackId: row.externalCallbackId ?? null,
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
    currentNodeName?: string | null;
    currentNodeKeys?: string[];
    currentNodeNames?: string[];
    tasks?: ReturnType<typeof mapTask>[];
    childInstances?: Array<{ id: number; title: string; status: typeof workflowInstances.$inferSelect['status']; parentTaskNodeKey?: string | null; createdAt: string }>;
    comments?: import('@zenith/shared').WorkflowComment[];
    consults?: import('@zenith/shared').WorkflowTaskConsult[];
    myTaskStatus?: typeof workflowTasks.$inferSelect['status'] | null;
    myActionAt?: Date | string | null;
    ccTaskId?: number | null;
    ccReadAt?: Date | string | null;
    includeDefinitionSnapshot?: boolean;
  } = {},
) {
  const snapshotSettings = (row.definitionSnapshot as { flowData?: WorkflowFlowData } | null)?.flowData?.settings;
  const activeNodeKeys = extras.currentNodeKeys
    ?? [...new Set((extras.tasks ?? [])
      .filter((task) => task.status === 'pending' || task.status === 'waiting')
      .map((task) => task.nodeKey))];
  const currentNodeKeys = activeNodeKeys.length > 0 ? activeNodeKeys : (row.currentNodeKey ? [row.currentNodeKey] : []);
  const currentNodeNames = extras.currentNodeNames
    ?? currentNodeKeys
      .map((nodeKey) => resolveNodeNameFromSnapshot(row.definitionSnapshot, nodeKey))
      .filter((name): name is string => typeof name === 'string' && name.length > 0);
  const mapped = {
    id: row.id,
    definitionId: row.definitionId,
    definitionName: extras.definitionName ?? null,
    categoryId: extras.categoryId ?? null,
    categoryName: extras.categoryName ?? null,
    title: row.title,
    serialNo: row.serialNo ?? null,
    priority: (row.priority ?? 'normal') as import('@zenith/shared').WorkflowInstancePriority,
    allowResubmit: snapshotSettings?.allowResubmit !== false,
    allowComment: snapshotSettings?.allowComment !== false,
    formData: row.formData,
    formSnapshot: (row.formSnapshot ?? null) as WorkflowFormField[] | WorkflowInstanceFormSnapshot | null,
    status: row.status,
    currentNodeKey: row.currentNodeKey,
    currentNodeKeys,
    currentNodeName: extras.currentNodeName ?? resolveNodeNameFromSnapshot(row.definitionSnapshot, row.currentNodeKey),
    currentNodeNames,
    initiatorId: row.initiatorId,
    initiatorName: extras.initiatorName ?? null,
    initiatorAvatar: extras.initiatorAvatar ?? null,
    tenantId: row.tenantId,
    parentInstanceId: row.parentInstanceId ?? null,
    parentTaskId: row.parentTaskId ?? null,
    parentTaskItemKey: row.parentTaskItemKey ?? null,
    parentTaskItemIndex: row.parentTaskItemIndex ?? null,
    bizType: row.bizType ?? null,
    bizId: row.bizId ?? null,
    childInstances: extras.childInstances ?? null,
    tasks: extras.tasks ?? null,
    comments: extras.comments,
    consults: extras.consults,
    myTaskStatus: extras.myTaskStatus ?? null,
    myActionAt: extras.myActionAt != null ? formatNullableDateTime(extras.myActionAt as Date) : null,
    ccTaskId: extras.ccTaskId ?? null,
    ccReadAt: extras.ccReadAt != null ? formatNullableDateTime(extras.ccReadAt as Date) : null,
    createdBy: row.createdBy ?? null,
    updatedBy: row.updatedBy ?? null,
    createdAt: formatDateTime(row.createdAt),
    updatedAt: formatDateTime(row.updatedAt),
  };
  return extras.includeDefinitionSnapshot
    ? { ...mapped, definitionSnapshot: mapDefinitionSnapshot(row.definitionSnapshot, row.formSnapshot) }
    : mapped;
}

/** 从流程定义快照中解析节点 key 对应的节点名称 */
function resolveNodeNameFromSnapshot(snapshot: unknown, nodeKey: string | null): string | null {
  if (!nodeKey) return null;
  const flowData = (snapshot as { flowData?: WorkflowFlowData } | null)?.flowData;
  return flowData?.nodes?.find((n) => n.data.key === nodeKey)?.data.label ?? null;
}

function normalizeStoredFormSnapshot(snapshot: unknown): WorkflowInstanceFormSnapshot | null {
  if (!snapshot) return null;
  if (Array.isArray(snapshot)) {
    return { fields: snapshot as WorkflowFormField[], settings: null };
  }
  if (typeof snapshot !== 'object') return null;
  const value = snapshot as Partial<WorkflowInstanceFormSnapshot>;
  return {
    formType: value.formType,
    formId: value.formId ?? null,
    formName: value.formName ?? null,
    fields: Array.isArray(value.fields) ? value.fields : [],
    settings: value.settings ?? null,
    customForm: value.customForm ?? null,
  };
}

function buildInstanceFormSnapshot(
  def: typeof workflowDefinitions.$inferSelect,
  resolvedForm: { fields: WorkflowFormField[]; settings?: WorkflowFormSettings; name: string } | null,
): WorkflowInstanceFormSnapshot | null {
  const formType = (def.formType ?? 'designer') as WorkflowFormType;
  if (formType === 'designer') {
    if (!resolvedForm) return null;
    return {
      formType,
      formId: def.formId ?? null,
      formName: resolvedForm.name,
      fields: resolvedForm.fields,
      settings: resolvedForm.settings ?? null,
      customForm: null,
    };
  }
  return {
    formType,
    formId: null,
    formName: null,
    fields: [],
    settings: null,
    customForm: (def.customForm ?? null) as WorkflowCustomFormConfig | null,
  };
}

function mapDefinitionSnapshot(snapshot: unknown, formSnapshot: unknown) {
  if (!snapshot || typeof snapshot !== 'object') return null;
  const row = snapshot as Partial<typeof workflowDefinitions.$inferSelect>;
  const normalizedForm = normalizeStoredFormSnapshot(formSnapshot);
  const formType = (row.formType ?? normalizedForm?.formType ?? 'designer') as WorkflowFormType;
  return {
    id: Number(row.id ?? 0),
    name: typeof row.name === 'string' ? row.name : '',
    description: typeof row.description === 'string' ? row.description : null,
    categoryId: typeof row.categoryId === 'number' ? row.categoryId : null,
    flowData: (row.flowData ?? null) as WorkflowFlowData | null,
    formId: typeof row.formId === 'number' ? row.formId : null,
    formName: normalizedForm?.formName ?? null,
    formFields: normalizedForm?.fields ?? null,
    formSettings: normalizedForm?.settings ?? null,
    formType,
    customForm: (row.customForm ?? normalizedForm?.customForm ?? null) as WorkflowCustomFormConfig | null,
    status: row.status,
    version: typeof row.version === 'number' ? row.version : undefined,
    tenantId: typeof row.tenantId === 'number' || row.tenantId === null ? row.tenantId : undefined,
  };
}

function assertLaunchMatchesFormType(
  def: typeof workflowDefinitions.$inferSelect,
  data: { bizType?: string | null; bizId?: string | null; asDraft?: boolean },
): void {
  const formType = (def.formType ?? 'designer') as WorkflowFormType;
  const hasBizKey = !!data.bizType?.trim() || !!data.bizId?.trim();
  if (formType === 'external') {
    if (data.asDraft) {
      throw new HTTPException(400, { message: '业务系统主导流程不支持在工作流中保存草稿，请在业务模块中保存草稿' });
    }
    if (!data.bizType?.trim() || !data.bizId?.trim()) {
      throw new HTTPException(400, { message: '业务系统主导流程必须通过业务模块发起，并提供 bizType 与 bizId' });
    }
    const cf = def.customForm as WorkflowCustomFormConfig | null;
    if (!cf?.viewComponent?.trim()) {
      throw new HTTPException(400, { message: '业务系统主导流程缺少审批查看页组件配置' });
    }
    return;
  }
  if (hasBizKey) {
    throw new HTTPException(400, { message: '仅业务系统主导流程允许携带 bizType 与 bizId' });
  }
  if (formType === 'custom') {
    const cf = def.customForm as WorkflowCustomFormConfig | null;
    if (!cf?.createComponent?.trim()) {
      throw new HTTPException(400, { message: '自定义业务表单缺少创建页组件配置' });
    }
  }
}

// ─── 业务逻辑 ─────────────────────────────────────────────────────────────────
import { count, countDistinct, eq, ne, and, asc, desc, ilike, lte, or, inArray, sql, gt } from 'drizzle-orm';
import { escapeLike, withPagination } from '../lib/where-helpers';
import { db } from '../db';
import { pageOffset } from '../lib/pagination';
import { workflowJobs, workflowJobExecutions, workflowInstances, workflowTasks, workflowTaskUrges, workflowDefinitions, workflowCategories, workflowTokens, inAppMessages, users, userRoles } from '../db/schema';
import { tenantCondition, getCreateTenantId } from '../lib/tenant';
import { getDataScopeCondition } from '../lib/data-scope';
import { validateFlowData, findReturnPrevTarget, getAncestorNodeKeys, resolveRuntimeApproveMethod, type TaskAction } from '../lib/workflow-engine';
import { advanceTokens, type AdvanceTrigger, type BranchPath } from '../lib/workflow-token-engine';
import type { WorkflowResolvedApproveMethod, WorkflowFlowData, WorkflowTask as WorkflowTaskDto, WorkflowEventActor, WorkflowActionButtonKey, WorkflowActionButtonConfig, WorkflowFormField, WorkflowFormSettings, WorkflowStarterContext, WorkflowBatchActionResult, WorkflowRecoveryBatchResult, WorkflowCustomFormConfig, WorkflowFormType, WorkflowInstance, WorkflowInstanceFormSnapshot, WorkflowApproverDedupMode, WorkflowDeduplicateStrategy, WorkflowRuntimeDiagnostics, WorkflowRuntimeIssue, WorkflowRuntimeOutboxEvent, WorkflowTriggerType, WorkflowInstanceTrace, WorkflowEngineExplanation, WorkflowEngineExplanationBlocker, WorkflowEngineTraceEntry, WorkflowJobType, WorkflowExecutionToken, WorkflowExecutionTokenView } from '@zenith/shared';
import { resolveApproverDedupMode } from '@zenith/shared';
import { HTTPException } from 'hono/http-exception';
import { currentUser } from '../lib/context';
import { filterSelectedApproverIds, resolveAssigneeIds, buildStarterContext } from './workflow-assignee-resolver.service';
import { getDecisionOutputs } from './rules.service';
import { recordCompensation } from './workflow-compensations.service';
import { resolveFormSnapshot } from './workflow-forms.service';
import type { DbExecutor } from '../db/types';
import { createHash, randomBytes } from 'node:crypto';
import { enqueueJob, cancelJobs } from '../lib/workflow-jobs/engine';
import { computeTimeoutAt } from '../lib/workflow-timeout';
import type { WorkflowTriggerNodeConfig } from '@zenith/shared';
import { workflowEventBus } from '../lib/workflow-event-bus';
import { generateSerialNo } from './workflow-serial.service';
import { resolveActiveDelegate } from './workflow-delegations.service';
import { loadInstanceCommentsForDetail } from './workflow-comments.service';
import { loadInstanceConsultsForDetail } from './workflow-consults.service';
import { isPgUniqueViolation } from '../lib/db-errors';
import dayjs from 'dayjs';
import logger from '../lib/logger';

/** 发射实例生命周期事件的辅助函数（传 executor 时在事务内入队 outbox，需 await） */
function emitInstanceEvent(
  type: 'instance.created' | 'instance.approved' | 'instance.rejected' | 'instance.withdrawn',
  instance: ReturnType<typeof mapInstance>,
  actor: { userId: number; name?: string | null },
  executor?: DbExecutor,
): void | Promise<unknown> {
  const ev = {
    type,
    instanceId: instance.id,
    definitionId: instance.definitionId,
    tenantId: instance.tenantId ?? null,
    actor,
    instance,
  } as Parameters<typeof workflowEventBus.emit>[0];
  return executor ? workflowEventBus.emitInTx(ev, executor) : void workflowEventBus.emit(ev);
}

/** 发射任务生命周期事件的辅助函数（传 executor 时在事务内入队 outbox，需 await） */
function emitTaskEvent(
  type: 'task.created' | 'task.approved' | 'task.rejected' | 'task.skipped' | 'task.transferred' | 'task.assigned' | 'task.addSigned' | 'task.reduceSigned' | 'task.urged',
  task: WorkflowTaskDto,
  meta: { definitionId: number; tenantId: number | null; actor?: { userId: number; name?: string | null }; comment?: string | null },
  executor?: DbExecutor,
): void | Promise<unknown> {
  const ev = {
    type,
    instanceId: task.instanceId,
    definitionId: meta.definitionId,
    tenantId: meta.tenantId,
    actor: meta.actor,
    task,
    comment: meta.comment,
  } as Parameters<typeof workflowEventBus.emit>[0];
  return executor ? workflowEventBus.emitInTx(ev, executor) : void workflowEventBus.emit(ev);
}

/** 发射节点进入/离开事件（传 executor 时在事务内入队 outbox，需 await） */
function emitNodeEvent(
  type: 'node.entered' | 'node.left',
  meta: { instanceId: number; definitionId: number; tenantId: number | null; nodeKey: string; nodeName: string; nodeType: WorkflowTaskDto['nodeType']; actor?: { userId: number; name?: string | null } },
  executor?: DbExecutor,
): void | Promise<unknown> {
  const ev = {
    type,
    instanceId: meta.instanceId,
    definitionId: meta.definitionId,
    tenantId: meta.tenantId,
    actor: meta.actor,
    nodeKey: meta.nodeKey,
    nodeName: meta.nodeName,
    nodeType: meta.nodeType,
  } as Parameters<typeof workflowEventBus.emit>[0];
  return executor ? workflowEventBus.emitInTx(ev, executor) : void workflowEventBus.emit(ev);
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
  const dedupMode = resolveApproverDedupMode(ctx.settings);
  const sameInitiatorStrategy = task.nodeConfig.sameInitiatorStrategy
    ?? (dedupMode !== 'none' ? 'autoSkip' : 'selfApprove');

  if (ids.includes(ctx.initiatorId) && sameInitiatorStrategy !== 'selfApprove') {
    ids = ids.filter((id) => id !== ctx.initiatorId);
    if (sameInitiatorStrategy === 'toDirectManager' || sameInitiatorStrategy === 'toDeptHead') {
      const replacements = await resolveSameInitiatorReplacement(task, ctx);
      ids = [...new Set([...ids, ...replacements.filter((id) => id !== ctx.initiatorId)])];
    }
  }

  // 审批人去重：节点级 deduplicateStrategy 显式设置时优先，否则跟随流程级 approverDedupMode
  const effectiveDedup = resolveEffectiveDedup(task.nodeConfig.deduplicateStrategy, dedupMode);
  if (effectiveDedup !== 'none' && ids.length > 0) {
    const dedupUsers = await collectDedupApprovers(ctx.executor, ctx.instanceId, effectiveDedup);
    ids = ids.filter((id) => !dedupUsers.has(id));
  }

  return ids;
}

/**
 * 计算某审批节点的有效去重范围：
 * - 节点显式「仍需审批」→ 不去重
 * - 节点显式「自动跳过」→ 至少 all；流程级为 consecutive 时尊重 consecutive
 * - 节点未设置 → 完全跟随流程级模式
 */
function resolveEffectiveDedup(
  nodeStrategy: WorkflowDeduplicateStrategy | undefined,
  globalMode: WorkflowApproverDedupMode,
): WorkflowApproverDedupMode {
  if (nodeStrategy === 'repeatApprove') return 'none';
  if (nodeStrategy === 'autoSkip') return globalMode === 'consecutive' ? 'consecutive' : 'all';
  return globalMode;
}

/** 收集需要去重的「前序已审批」处理人集合 */
async function collectDedupApprovers(
  exec: DbExecutor,
  instanceId: number,
  mode: 'all' | 'consecutive',
): Promise<Set<number>> {
  if (mode === 'all') {
    // 去重实例内所有已审批人（含抄送，保持既有行为）
    const rows = await exec.select({ assigneeId: workflowTasks.assigneeId }).from(workflowTasks)
      .where(and(eq(workflowTasks.instanceId, instanceId), eq(workflowTasks.status, 'approved')));
    return new Set(rows.map((row) => row.assigneeId).filter((id): id is number => typeof id === 'number'));
  }
  // consecutive：仅取「紧邻的前一个审批节点」（排除抄送）的处理人
  const rows = await exec
    .select({ nodeKey: workflowTasks.nodeKey, assigneeId: workflowTasks.assigneeId })
    .from(workflowTasks)
    .where(and(
      eq(workflowTasks.instanceId, instanceId),
      eq(workflowTasks.status, 'approved'),
      ne(workflowTasks.nodeType, 'ccNode'),
    ))
    .orderBy(desc(workflowTasks.id));
  const lastNodeKey = rows[0]?.nodeKey;
  if (!lastNodeKey) return new Set();
  return new Set(
    rows
      .filter((row) => row.nodeKey === lastNodeKey)
      .map((row) => row.assigneeId)
      .filter((id): id is number => typeof id === 'number'),
  );
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

/** 触发器最大尝试次数：continue=1，block=1+maxRetries（封顶 11） */
function resolveTriggerMaxAttempts(cfg?: WorkflowTriggerNodeConfig): number {
  const onFailure = cfg?.onFailure ?? 'continue';
  if (onFailure === 'continue') return 1;
  return Math.min(11, Math.max(1, (cfg?.maxRetries ?? 0) + 1));
}

/**
 * 为新建任务挂载异步作业（统一作业账本）。
 * 取代旧的 delayScheduler / trigger·external 订阅者派发 / timeoutAt 列扫描。
 * 子流程（spawn/join）仍走既有 maybeSpawnSubProcessChild / 恢复巡检，不在此处理。
 * 默认用 db 执行器（在提交后的事件发射循环中调用）。
 */
async function armTaskAsyncJobs(
  task: typeof workflowTasks.$inferSelect,
  inst: { id: number; flowData: WorkflowFlowData | null; formData: Record<string, unknown> | null; tenantId: number | null },
  executor: DbExecutor = db,
): Promise<void> {
  const cfg = inst.flowData?.nodes.find((n) => n.data.key === task.nodeKey)?.data;
  if (!cfg) return;
  const tenantId = inst.tenantId ?? null;
  const base = { instanceId: inst.id, nodeKey: task.nodeKey, taskId: task.id, tenantId, payload: { taskId: task.id } } as const;

  if (task.nodeType === 'subProcess') {
    await enqueueJob({ ...base, jobType: 'subprocess_spawn', maxAttempts: 5, idempotencyKey: `subprocess_spawn:${task.id}` }, executor);
    return;
  }
  if (task.nodeType === 'delay' && task.status === 'waiting') {
    await enqueueJob({ ...base, jobType: 'delay_wake', runAt: computeDelayWakeAt(cfg, (inst.formData ?? {}) as Record<string, unknown>), maxAttempts: 3, idempotencyKey: `delay_wake:${task.id}` }, executor);
    return;
  }
  if (task.nodeType === 'trigger') {
    await enqueueJob({ ...base, jobType: 'trigger_dispatch', maxAttempts: resolveTriggerMaxAttempts(cfg.triggerConfig), idempotencyKey: `trigger_dispatch:${task.id}` }, executor);
    return;
  }
  if (task.nodeType === 'approve' && task.status === 'waiting' && task.externalCallbackId && cfg.externalApproval?.enabled) {
    await enqueueJob({ ...base, jobType: 'external_dispatch', maxAttempts: 3, idempotencyKey: `external_dispatch:${task.id}` }, executor);
    return;
  }
  if ((task.nodeType === 'approve' || task.nodeType === 'handler') && task.status === 'pending') {
    const timeoutAt = computeTimeoutAt(cfg.timeout);
    if (timeoutAt) {
      await enqueueJob({ ...base, jobType: 'task_timeout', runAt: timeoutAt, maxAttempts: 3, idempotencyKey: `task_timeout:${task.id}` }, executor);
    }
  }
}

/**
 * 子实例结束后入队 subprocess_join 作业唤醒/汇聚父任务（取代直接 resumeParentSubProcess 调用）。
 * 幂等键含 childInst.id，确保每个子实例的结束都触发一次（多实例汇聚靠 reconcile 绝对重算收敛）。
 */
async function enqueueSubprocessJoin(childInst: typeof workflowInstances.$inferSelect): Promise<void> {
  if (!childInst.parentTaskId) return;
  await enqueueJob({
    jobType: 'subprocess_join',
    taskId: childInst.parentTaskId,
    instanceId: childInst.parentInstanceId ?? null,
    payload: { parentTaskId: childInst.parentTaskId },
    maxAttempts: 5,
    idempotencyKey: `subprocess_join:${childInst.parentTaskId}:${childInst.id}`,
    tenantId: childInst.tenantId ?? null,
  });
}

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

function findExceptionCatchNode(flowData: WorkflowFlowData, nodeKey: string): TaskAction['nodeConfig'] | null {
  const source = flowData.nodes.find((n) => n.data.key === nodeKey);
  if (!source) return null;
  for (const edge of flowData.edges) {
    if (edge.source !== source.id) continue;
    const target = flowData.nodes.find((n) => n.id === edge.target);
    if (!target) continue;
    if (edge.isException || target.data.type === 'catchNode') return target.data;
  }
  return null;
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

/** 单实例子流程：发起一个子实例，结束后回写出参并唤醒父任务 */
async function spawnSingleSubProcessChild(
  parentInst: typeof workflowInstances.$inferSelect,
  parentTask: typeof workflowTasks.$inferSelect,
  nodeCfg: TaskAction['nodeConfig'],
  actor: WorkflowEventActor,
  opts?: { detached?: boolean },
): Promise<void> {
  const def = await loadPublishedSubProcessDef(nodeCfg.subProcessId);
  if (!def) {
    if (!opts?.detached) {
      const handled = await handleNodeExecutionError({
        instance: parentInst,
        task: parentTask,
        nodeKey: parentTask.nodeKey,
        nodeName: parentTask.nodeName,
        errorMessage: '子流程定义不存在或未发布',
        actor,
      });
      if (!handled) await rejectTaskCore(parentTask, parentInst, '子流程定义不存在或未发布', actor);
    }
    else logger.warn('[subProcess] async child def missing', { parentInstanceId: parentInst.id, subProcessId: nodeCfg.subProcessId });
    return;
  }
  const validation = validateFlowData(def.flowData as WorkflowFlowData);
  if (!validation.valid) {
    if (!opts?.detached) {
      const message = `子流程定义无效：${validation.errors[0]}`;
      const handled = await handleNodeExecutionError({
        instance: parentInst,
        task: parentTask,
        nodeKey: parentTask.nodeKey,
        nodeName: parentTask.nodeName,
        errorMessage: message,
        actor,
      });
      if (!handled) await rejectTaskCore(parentTask, parentInst, message, actor);
    }
    return;
  }
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
  const def = await loadPublishedSubProcessDef(nodeCfg.subProcessId);
  if (!def) {
    if (!opts?.detached) {
      const handled = await handleNodeExecutionError({
        instance: parentInst,
        task: parentTask,
        nodeKey: parentTask.nodeKey,
        nodeName: parentTask.nodeName,
        errorMessage: '子流程定义不存在或未发布',
        actor,
      });
      if (!handled) await rejectTaskCore(parentTask, parentInst, '子流程定义不存在或未发布', actor);
    }
    return;
  }
  const validation = validateFlowData(def.flowData as WorkflowFlowData);
  if (!validation.valid) {
    if (!opts?.detached) {
      const message = `子流程定义无效：${validation.errors[0]}`;
      const handled = await handleNodeExecutionError({
        instance: parentInst,
        task: parentTask,
        nodeKey: parentTask.nodeKey,
        nodeName: parentTask.nodeName,
        errorMessage: message,
        actor,
      });
      if (!handled) await rejectTaskCore(parentTask, parentInst, message, actor);
    }
    return;
  }
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

  const [pt] = await db.select().from(workflowTasks).where(eq(workflowTasks.id, decision.parentTaskId)).limit(1);
  const [pi] = await db.select().from(workflowInstances).where(eq(workflowInstances.id, decision.parentInstId)).limit(1);
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

export async function handleNodeExecutionError(input: {
  instance: typeof workflowInstances.$inferSelect;
  task?: typeof workflowTasks.$inferSelect | null;
  nodeKey: string;
  nodeName?: string | null;
  errorMessage: string;
  actor: WorkflowEventActor;
}): Promise<boolean> {
  const snapshot = input.instance.definitionSnapshot as { flowData?: WorkflowFlowData } | null;
  const flowData = snapshot?.flowData;
  if (!flowData) return false;
  const catchCfg = findExceptionCatchNode(flowData, input.nodeKey);
  if (!catchCfg) return false;

  const action = catchCfg.catchAction ?? 'notify';
  const errorComment = `[节点异常] ${input.nodeName ?? input.nodeKey}：${input.errorMessage}`;
  const updated = await db.transaction(async (tx) => {
    const [lockedInst] = await tx.select().from(workflowInstances)
      .where(eq(workflowInstances.id, input.instance.id))
      .for('update')
      .limit(1);
    if (!lockedInst || lockedInst.status !== 'running') return null;
    await recordCompensation(tx, { instanceId: lockedInst.id, nodeKey: catchCfg.key, nodeName: catchCfg.label, errorMessage: input.errorMessage, action, status: action === 'toAdmin' ? 'pending' : action === 'terminate' ? 'terminated' : 'resolved', tenantId: lockedInst.tenantId });

    const affectedTasks = input.task
      ? await tx.update(workflowTasks).set({
        status: action === 'terminate' ? 'rejected' : 'skipped',
        comment: errorComment,
        actionAt: new Date(),
      }).where(and(eq(workflowTasks.id, input.task.id), inArray(workflowTasks.status, ['pending', 'waiting']))).returning()
      : [];

    if (action === 'terminate') {
      const [catchTask] = await tx.insert(workflowTasks).values({
        instanceId: lockedInst.id,
        nodeKey: catchCfg.key,
        nodeName: catchCfg.label,
        nodeType: 'catchNode',
        assigneeId: null,
        status: 'rejected',
        comment: errorComment,
        actionAt: new Date(),
      }).returning();
      await tx.update(workflowTasks).set({ status: 'skipped', actionAt: new Date(), comment: errorComment })
        .where(and(eq(workflowTasks.instanceId, lockedInst.id), inArray(workflowTasks.status, ['pending', 'waiting'])));
      await killInstanceTokens(tx, lockedInst.id);
      const [row] = await tx.update(workflowInstances)
        .set({ status: 'rejected', currentNodeKey: null })
        .where(eq(workflowInstances.id, lockedInst.id))
        .returning();
      return { row, affectedTasks, catchTask, newTasks: [] as typeof workflowTasks.$inferSelect[], finished: false, rejected: true };
    }

    if (action === 'toAdmin') {
      const adminId = await resolveAdminAssigneeId(tx);
      if (!adminId) {
        const [catchTask] = await tx.insert(workflowTasks).values({
          instanceId: lockedInst.id,
          nodeKey: catchCfg.key,
          nodeName: catchCfg.label,
          nodeType: 'catchNode',
          assigneeId: null,
          status: 'rejected',
          comment: `${errorComment}；未找到管理员`,
          actionAt: new Date(),
        }).returning();
        await tx.update(workflowTasks).set({ status: 'skipped', actionAt: new Date(), comment: errorComment })
          .where(and(eq(workflowTasks.instanceId, lockedInst.id), inArray(workflowTasks.status, ['pending', 'waiting'])));
        await killInstanceTokens(tx, lockedInst.id);
        const [row] = await tx.update(workflowInstances)
          .set({ status: 'rejected', currentNodeKey: null })
          .where(eq(workflowInstances.id, lockedInst.id))
          .returning();
        return { row, affectedTasks, catchTask, newTasks: [] as typeof workflowTasks.$inferSelect[], finished: false, rejected: true };
      }
      const [catchTask] = await tx.insert(workflowTasks).values({
        instanceId: lockedInst.id,
        nodeKey: catchCfg.key,
        nodeName: catchCfg.label,
        nodeType: 'catchNode',
        assigneeId: adminId,
        status: 'pending',
        comment: errorComment,
      }).returning();
      // Token 一致性：消费失败节点 token，在 catch 节点新建 frontier token（其余分支 token 保留）
      const liveToks = await loadLiveTokens(tx, lockedInst.id);
      const failedTok = liveToks.find((t) => t.nodeKey === input.nodeKey);
      if (failedTok) {
        await tx.update(workflowTokens).set({ status: 'consumed', consumedAt: new Date() }).where(eq(workflowTokens.id, failedTok.id));
      }
      await tx.insert(workflowTokens).values({
        instanceId: lockedInst.id,
        nodeKey: catchCfg.key,
        status: 'active',
        branchPath: [],
        parentTokenId: failedTok?.id ?? null,
        scopeKey: null,
        tenantId: lockedInst.tenantId,
      });
      const [row] = await tx.update(workflowInstances)
        .set({ currentNodeKey: catchCfg.key })
        .where(eq(workflowInstances.id, lockedInst.id))
        .returning();
      return { row, affectedTasks, catchTask, newTasks: [catchTask], finished: false, rejected: false };
    }

    const [catchTask] = await tx.insert(workflowTasks).values({
      instanceId: lockedInst.id,
      nodeKey: catchCfg.key,
      nodeName: catchCfg.label,
      nodeType: 'catchNode',
      assigneeId: null,
      status: 'approved',
      comment: errorComment,
      actionAt: new Date(),
    }).returning();
    const formData = (lockedInst.formData ?? {}) as Record<string, unknown>;
    const starter = await buildStarterContext(lockedInst.initiatorId, tx);
    const materialized = await advanceAndMaterialize(
      { kind: 'enterNode', nodeKey: catchCfg.key, consumeNodeKey: input.nodeKey },
      {
        instanceId: lockedInst.id,
        initiatorId: lockedInst.initiatorId,
        executor: tx,
        flowData,
        formData,
        settings: flowData.settings,
        starter,
        tenantId: lockedInst.tenantId,
      },
    );

    if (materialized.rejected || (!materialized.finished && materialized.currentNodeKeys.length === 0 && materialized.createdTasks.length === 0)) {
      await tx.update(workflowTasks).set({ status: 'skipped', actionAt: new Date(), comment: errorComment })
        .where(and(eq(workflowTasks.instanceId, lockedInst.id), inArray(workflowTasks.status, ['pending', 'waiting'])));
      const [row] = await tx.update(workflowInstances)
        .set({ status: 'rejected', currentNodeKey: null })
        .where(eq(workflowInstances.id, lockedInst.id))
        .returning();
      return { row, affectedTasks, catchTask, newTasks: materialized.createdTasks, finished: false, rejected: true };
    }
    if (materialized.finished) {
      const [row] = await tx.update(workflowInstances)
        .set({ status: 'approved', currentNodeKey: null })
        .where(eq(workflowInstances.id, lockedInst.id))
        .returning();
      return { row, affectedTasks, catchTask, newTasks: materialized.createdTasks, finished: true, rejected: false };
    }
    const [row] = await tx.update(workflowInstances)
      .set({ currentNodeKey: materialized.currentNodeKeys[0] ?? null })
      .where(eq(workflowInstances.id, lockedInst.id))
      .returning();
    return { row, affectedTasks, catchTask, newTasks: materialized.createdTasks, finished: false, rejected: false };
  });

  if (!updated) return true;
  const meta = { definitionId: updated.row.definitionId, tenantId: updated.row.tenantId, actor: input.actor };
  for (const task of updated.affectedTasks) {
    emitTaskEvent(task.status === 'rejected' ? 'task.rejected' : 'task.skipped', mapTask(task), { ...meta, comment: errorComment });
  }
  emitNodeEvent('node.left', {
    instanceId: updated.row.id,
    ...meta,
    nodeKey: input.nodeKey,
    nodeName: input.nodeName ?? input.nodeKey,
    nodeType: input.task?.nodeType ?? null,
  });
  emitNodeEvent('node.entered', { instanceId: updated.row.id, ...meta, nodeKey: updated.catchTask.nodeKey, nodeName: updated.catchTask.nodeName, nodeType: updated.catchTask.nodeType });
  emitTaskEvent('task.created', mapTask(updated.catchTask), meta);
  if (updated.catchTask.assigneeId && updated.catchTask.status === 'pending') emitTaskEvent('task.assigned', mapTask(updated.catchTask), meta);
  if (updated.catchTask.status === 'approved') emitTaskEvent('task.approved', mapTask(updated.catchTask), meta);
  if (updated.catchTask.status === 'rejected') emitTaskEvent('task.rejected', mapTask(updated.catchTask), meta);

  for (const task of updated.newTasks.filter((task) => task.id !== updated.catchTask.id)) {
    emitNodeEvent('node.entered', { instanceId: updated.row.id, ...meta, nodeKey: task.nodeKey, nodeName: task.nodeName, nodeType: task.nodeType });
    emitTaskEvent('task.created', mapTask(task), meta);
    if (task.assigneeId && task.status === 'pending') emitTaskEvent('task.assigned', mapTask(task), meta);
    if (task.status === 'approved') emitTaskEvent('task.approved', mapTask(task), meta);
    if (task.status === 'rejected') emitTaskEvent('task.rejected', mapTask(task), meta);
  }
  if (updated.finished) emitInstanceEvent('instance.approved', mapInstance(updated.row), input.actor);
  if (updated.rejected) emitInstanceEvent('instance.rejected', mapInstance(updated.row), input.actor);
  return true;
}

async function expandTasksToRows(
  tasks: TaskAction[],
  ctx: { instanceId: number; initiatorId: number; executor: DbExecutor; formData?: Record<string, unknown>; settings?: WorkflowFlowData['settings']; selectedNextApprovers?: number[]; flowData?: WorkflowFlowData },
): Promise<ExpandedTaskRows> {
  const rows: Array<typeof workflowTasks.$inferInsert> = [];
  const autoApprovedNodeKeys: string[] = [];
  let autoRejectedNodeKey: string | null = null;

  // 审批代理（离岗委托）：按需懒加载本实例的 definitionId，将待办自动转交给代理人
  let cachedDefinitionId: number | null = null;
  const resolveDefinitionId = async (): Promise<number> => {
    if (cachedDefinitionId == null) {
      const [r] = await ctx.executor
        .select({ definitionId: workflowInstances.definitionId })
        .from(workflowInstances)
        .where(eq(workflowInstances.id, ctx.instanceId))
        .limit(1);
      cachedDefinitionId = r?.definitionId ?? 0;
    }
    return cachedDefinitionId;
  };
  const applyDelegations = async (userIds: number[]): Promise<Array<{ assigneeId: number; delegatedFromId: number | null }>> => {
    const definitionId = await resolveDefinitionId();
    const result: Array<{ assigneeId: number; delegatedFromId: number | null }> = [];
    const seen = new Set<number>();
    for (const uid of userIds) {
      const delegate = definitionId ? await resolveActiveDelegate(ctx.executor, uid, definitionId) : null;
      const finalId = delegate ?? uid;
      if (seen.has(finalId)) continue;
      seen.add(finalId);
      result.push({ assigneeId: finalId, delegatedFromId: delegate ? uid : null });
    }
    return result;
  };

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
      });
      continue;
    }

    if (t.nodeType === 'trigger') {
      const tcfg = t.nodeConfig.triggerConfig;
      const isCallback = tcfg?.triggerType === 'callback';
      const isBlocking = tcfg?.onFailure === 'block';
      const isDataMutation = tcfg?.triggerType === 'updateData' || tcfg?.triggerType === 'deleteData';
      if (isCallback || isBlocking || isDataMutation) {
        rows.push({
          instanceId: ctx.instanceId,
          nodeKey: t.nodeKey,
          nodeName: t.nodeName,
          nodeType: 'trigger',
          assigneeId: null,
          status: 'waiting' as const,
          ...(isCallback ? { externalCallbackId: randomBytes(16).toString('hex') } : {}),
        });
        continue;
      }
      // 非阻塞触发器（continue/retry）：落到下方通用自动节点路径，由订阅者异步执行
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
        status: (t.nodeType as string) === 'ccNode' ? 'skipped' as const : 'approved' as const,
        actionAt: (t.nodeType as string) === 'ccNode' ? null : new Date(),
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
      // T3-2 节点级异常处理：审批人解析为空时，优先按本节点 catchAction 兜底
      const nodeCatch = t.nodeConfig.catchAction;
      if (nodeCatch) {
        if (nodeCatch === 'terminate') {
          pushAutoRow(t, 'rejected');
        } else if (nodeCatch === 'toAdmin') {
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
        } else {
          // notify：自动通过本节点并继续 + 通知相关人
          pushAutoRow(t, 'approved');
          const adminId = await resolveAdminAssigneeId(ctx.executor);
          const recipients = t.nodeConfig.catchNotifyUserIds && t.nodeConfig.catchNotifyUserIds.length > 0
            ? t.nodeConfig.catchNotifyUserIds
            : [ctx.initiatorId, adminId].filter((v): v is number => typeof v === 'number');
          if (recipients.length > 0) {
            try {
              await ctx.executor.insert(inAppMessages).values([...new Set(recipients)].map((uid) => ({
                userId: uid,
                title: '流程异常提醒',
                content: `流程节点「${t.nodeName}」审批人解析为空，已按异常处理自动通过`,
                type: 'warning' as const,
                source: 'system' as const,
                tenantId: null,
              })));
            } catch { /* 通知失败不影响流转 */ }
          }
        }
        continue;
      }
      // T3-2 异常捕获（React Flow 异常边）：节点存在指向 catchNode 的异常出边时，按 catchAction 兜底
      const catchCfg = ctx.flowData ? findExceptionCatchNode(ctx.flowData, t.nodeKey) : null;
      if (catchCfg) {
        const action = catchCfg.catchAction ?? 'notify';
        if (action === 'terminate') {
          pushAutoRow(t, 'rejected');
        } else if (action === 'toAdmin') {
          const adminId = await resolveAdminAssigneeId(ctx.executor);
          if (adminId) {
            rows.push({
              instanceId: ctx.instanceId,
              nodeKey: catchCfg.key,
              nodeName: catchCfg.label,
              nodeType: 'catchNode',
              assigneeId: adminId,
              status: 'pending' as const,
            });
          } else {
            pushAutoRow(t, 'rejected');
          }
        } else {
          // notify：记录跳过的异常节点 + 继续后续路径 + 通知相关人
          rows.push({
            instanceId: ctx.instanceId,
            nodeKey: catchCfg.key,
            nodeName: catchCfg.label,
            nodeType: 'catchNode',
            assigneeId: null,
            status: 'skipped' as const,
            actionAt: new Date(),
          });
          autoApprovedNodeKeys.push(catchCfg.key);
          const adminId = await resolveAdminAssigneeId(ctx.executor);
          const recipients = catchCfg.catchNotifyUserIds && catchCfg.catchNotifyUserIds.length > 0
            ? catchCfg.catchNotifyUserIds
            : [ctx.initiatorId, adminId].filter((v): v is number => typeof v === 'number');
          if (recipients.length > 0) {
            try {
              await ctx.executor.insert(inAppMessages).values([...new Set(recipients)].map((uid) => ({
                userId: uid,
                title: '流程异常提醒',
                content: `流程节点「${t.nodeName}」审批人解析为空，已触发异常处理（${catchCfg.label}）`,
                type: 'warning' as const,
                source: 'system' as const,
                tenantId: null,
              })));
            } catch { /* 通知失败不影响流转 */ }
          }
        }
        continue;
      }
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

    let effectiveUserIds = userIds;
    if (rawMethod === 'random' && userIds.length > 1) {
      effectiveUserIds = [userIds[Math.floor(Math.random() * userIds.length)]];
    }
    // 设计态(含 random/auto) → 运行态 4 值的唯一权威转换点
    const method: WorkflowResolvedApproveMethod = resolveRuntimeApproveMethod(rawMethod, userIds.length);
    const ratioPct = method === 'ratio'
      ? Math.min(100, Math.max(1, t.nodeConfig.approveRatio ?? 51))
      : null;
    const timeoutAt = computeTimeoutAt(t.nodeConfig.timeout);
    const assignList = await applyDelegations(effectiveUserIds);
    assignList.forEach(({ assigneeId, delegatedFromId }, idx) => {
      const isPending = !(method === 'sequential' && idx > 0);
      rows.push({
        instanceId: ctx.instanceId,
        nodeKey: t.nodeKey,
        nodeName: t.nodeName,
        nodeType: t.nodeType,
        assigneeId,
        delegatedFromId,
        // 顺序会签：只有第一人 pending，其余 waiting
        status: method === 'sequential' && idx > 0 ? 'waiting' as const : 'pending' as const,
        taskOrder: method === 'sequential' ? idx : null,
        approveMethod: assignList.length > 1 ? method : null,
        approveRatio: assignList.length > 1 ? ratioPct : null,
      });
    });
  }
  return { rows, autoApprovedNodeKeys, autoRejectedNodeKey };
}

async function getCompletedNodeKeys(exec: DbExecutor, instanceId: number): Promise<Set<string>> {
  const rows = await exec.select({ nodeKey: workflowTasks.nodeKey }).from(workflowTasks)
    .where(and(eq(workflowTasks.instanceId, instanceId), inArray(workflowTasks.status, ['approved', 'skipped'])));
  const keys = new Set(rows.map((row) => row.nodeKey));
  keys.add('start');
  return keys;
}

// ─── 显式执行 Token 运行时 ────────────────────────────────────────────────────
type WorkflowTokenSnapshot = { id: number; nodeKey: string; branchPath: BranchPath };

/** 读取实例当前全部 active token（含 parked join token） */
async function loadLiveTokens(exec: DbExecutor, instanceId: number): Promise<WorkflowTokenSnapshot[]> {
  const rows = await exec.select({ id: workflowTokens.id, nodeKey: workflowTokens.nodeKey, branchPath: workflowTokens.branchPath })
    .from(workflowTokens)
    .where(and(eq(workflowTokens.instanceId, instanceId), eq(workflowTokens.status, 'active')));
  return rows.map((r) => ({ id: r.id, nodeKey: r.nodeKey, branchPath: (r.branchPath ?? []) as BranchPath }));
}

/** 终止实例所有 active token（驳回 / 取消 / 撤销 / 强制跳转前清场） */
async function killInstanceTokens(exec: DbExecutor, instanceId: number): Promise<void> {
  await exec.update(workflowTokens)
    .set({ status: 'dead', consumedAt: new Date() })
    .where(and(eq(workflowTokens.instanceId, instanceId), eq(workflowTokens.status, 'active')));
}

/** 发起前快速校验：流程是否存在可执行入口（token 引擎 seed dry-run，与实际物化同源） */
/** 后端字段权限强校验：剔除 start 节点标记为 hidden/read 的字段，防止客户端写入隐藏/只读字段 */
function sanitizeFormByStartPerms(flowData: WorkflowFlowData, formData: Record<string, unknown>): Record<string, unknown> {
  const start = flowData.nodes?.find((n) => n.data.type === 'start')?.data;
  const perms = start?.fieldPermissions;
  if (!perms) return formData;
  const out: Record<string, unknown> = { ...formData };
  for (const [k, p] of Object.entries(perms)) if ((p === 'hidden' || p === 'read') && k in out) delete out[k];
  return out;
}

function hasExecutableEntry(flowData: WorkflowFlowData, formData: Record<string, unknown>, starter?: WorkflowStarterContext): boolean {
  const preview = advanceTokens({ flowData, formData, starter, liveTokens: [], trigger: { type: 'seed' } });
  return preview.tasksToCreate.length > 0 || preview.finished || preview.rejected;
}

type SelectedApproverMap = Record<string, number[]>;
const INITIATOR_SELECT_ASSIGNEE_TYPES = new Set(['initiatorSelect', 'initiatorSelectScope']);

function normalizeSelectedApproverMap(input?: SelectedApproverMap | null): SelectedApproverMap {
  const out: SelectedApproverMap = {};
  for (const [nodeKey, ids] of Object.entries(input ?? {})) {
    if (!nodeKey || !Array.isArray(ids)) continue;
    const normalized = [...new Set(ids.map((id) => Number(id)).filter((id) => Number.isInteger(id) && id > 0))];
    if (normalized.length > 0) out[nodeKey] = normalized;
  }
  return out;
}

async function applyInitiatorSelectedApprovers(
  flowData: WorkflowFlowData,
  selected: SelectedApproverMap | null | undefined,
  executor?: DbExecutor,
): Promise<WorkflowFlowData> {
  const normalized = normalizeSelectedApproverMap(selected);
  const selectNodes = (flowData.nodes ?? []).filter((node) => INITIATOR_SELECT_ASSIGNEE_TYPES.has(node.data.assigneeType ?? ''));
  if (selectNodes.length === 0) return flowData;

  const selectedByNode = new Map<string, number[]>();
  for (const node of selectNodes) {
    const picked = await filterSelectedApproverIds(node.data, normalized[node.data.key] ?? [], executor);
    if (picked.length === 0) {
      throw new HTTPException(400, { message: `请选择节点「${node.data.label || node.data.key}」的审批人` });
    }
    selectedByNode.set(node.data.key, picked);
  }

  return {
    ...flowData,
    nodes: flowData.nodes.map((node) => {
      const picked = selectedByNode.get(node.data.key);
      if (!picked) return node;
      return {
        ...node,
        data: {
          ...node.data,
          userIds: picked,
          assigneeIds: picked,
          assigneeId: picked.length === 1 ? picked[0] : null,
        },
      };
    }),
  };
}

function findReachableNodes(
  flowData: WorkflowFlowData,
  fromNodeKey: string,
  predicate: (node: WorkflowFlowData['nodes'][number]) => boolean,
): WorkflowFlowData['nodes'] {
  const startNode = flowData.nodes.find((node) => node.data.key === fromNodeKey);
  if (!startNode) return [];
  const nodeById = new Map(flowData.nodes.map((node) => [node.id, node]));
  const result: WorkflowFlowData['nodes'] = [];
  const visited = new Set<string>([startNode.id]);
  const queue = [startNode.id];
  while (queue.length > 0) {
    const currentId = queue.shift()!;
    for (const edge of flowData.edges ?? []) {
      if (edge.source !== currentId || edge.isException || visited.has(edge.target)) continue;
      const target = nodeById.get(edge.target);
      if (!target || target.data.type === 'catchNode') continue;
      visited.add(edge.target);
      if (predicate(target)) result.push(target);
      queue.push(edge.target);
    }
  }
  return result;
}

async function assertSelectedNextApprovers(
  flowData: WorkflowFlowData,
  fromNodeKey: string,
  selectedNextApprovers: number[] | undefined,
  executor: DbExecutor,
): Promise<void> {
  const selectNodes = findReachableNodes(flowData, fromNodeKey, (node) => node.data.assigneeType === 'approverSelect');
  if (selectNodes.length === 0) return;
  for (const node of selectNodes) {
    const picked = await filterSelectedApproverIds(node.data, selectedNextApprovers ?? [], executor);
    if (picked.length === 0) {
      throw new HTTPException(400, { message: `请选择节点「${node.data.label || node.data.key}」的审批人` });
    }
  }
}

/** 推进的触发方式（service 语义层，内部翻译为引擎触发并管理 token 落库） */
type MaterializeTrigger =
  /** 实例发起 / 重新发起：从 start 播种 */
  | { kind: 'seed' }
  /** 某节点已完成：消费该节点的 active token，从其出边推进（含网关/汇聚） */
  | { kind: 'advanceNode'; nodeKey: string }
  /** 直接进入某节点（强制跳转 / 退回 / 异常捕获）：可选先消费某节点 token */
  | { kind: 'enterNode'; nodeKey: string; consumeNodeKey?: string };

/**
 * Token 驱动的推进 + 落库（取代旧 materializeAdvanceResult）。
 * 以 workflow_tokens 为活动路径/网关汇聚的权威来源：消费完成 token → 产出新 token + 建任务行。
 * 多人审批完成判定（checkNodeCompletion）与任务展开（expandTasksToRows）保持不变。
 */
async function advanceAndMaterialize(
  trigger: MaterializeTrigger,
  ctx: { instanceId: number; initiatorId: number; executor: DbExecutor; flowData: WorkflowFlowData; formData: Record<string, unknown>; settings?: WorkflowFlowData['settings']; selectedNextApprovers?: number[]; starter?: WorkflowStarterContext; tenantId?: number | null; scopeKey?: string | null },
): Promise<{ createdTasks: typeof workflowTasks.$inferSelect[]; finished: boolean; rejected: boolean; currentNodeKeys: string[] }> {
  const exec = ctx.executor;
  const createdTasks: typeof workflowTasks.$inferSelect[] = [];
  let finished = false;
  let rejected = false;
  let currentNodeKeys: string[] = [];

  // 决策表→网关注入：routeGateway 配 decisionRuleKey 时，求值并把输出并入 formData，供出边条件选支
  const decisionNodes = (ctx.flowData.nodes ?? []).filter((n) => n.data.type === 'routeGateway' && n.data.decisionRuleKey);
  for (const n of decisionNodes) {
    const outputs = await getDecisionOutputs(n.data.decisionRuleKey!, { form: ctx.formData, starter: ctx.starter }, { instanceId: ctx.instanceId, nodeKey: n.data.key, source: 'runtime' });
    Object.assign(ctx.formData, outputs);
  }

  // 解析初始引擎触发（并按需先行消费 token）
  const engineTriggers: AdvanceTrigger[] = [];
  if (trigger.kind === 'seed') {
    engineTriggers.push({ type: 'seed' });
  } else if (trigger.kind === 'advanceNode') {
    const live = await loadLiveTokens(exec, ctx.instanceId);
    const tk = live.find((t) => t.nodeKey === trigger.nodeKey);
    if (!tk) throw new HTTPException(500, { message: `节点「${trigger.nodeKey}」缺少执行 Token，实例 token 状态异常` });
    engineTriggers.push({ type: 'advance', tokenId: tk.id, nodeKey: tk.nodeKey, branchPath: tk.branchPath });
  } else {
    if (trigger.consumeNodeKey) {
      const live = await loadLiveTokens(exec, ctx.instanceId);
      const tk = live.find((t) => t.nodeKey === trigger.consumeNodeKey);
      if (tk) await exec.update(workflowTokens).set({ status: 'consumed', consumedAt: new Date() }).where(eq(workflowTokens.id, tk.id));
    }
    engineTriggers.push({ type: 'enter', nodeKey: trigger.nodeKey, branchPath: [] });
  }

  while (engineTriggers.length > 0 && !rejected) {
    const et = engineTriggers.shift();
    if (!et) break;
    const liveTokens = await loadLiveTokens(exec, ctx.instanceId);
    const completedNodeKeys = await getCompletedNodeKeys(exec, ctx.instanceId);
    const res = advanceTokens({
      flowData: ctx.flowData,
      formData: ctx.formData,
      starter: ctx.starter,
      liveTokens,
      trigger: et,
      completedNodeKeys,
    });

    // 1) 消费 token（推进越过 / join 汇聚消费）
    if (res.ops.consume.length > 0) {
      await exec.update(workflowTokens).set({ status: 'consumed', consumedAt: new Date() })
        .where(and(eq(workflowTokens.instanceId, ctx.instanceId), inArray(workflowTokens.id, res.ops.consume)));
    }

    // 2) 展开并落库任务行（人员解析 / 委托 / 加签 / cc / 外部审批 / delay / trigger / subProcess）
    let autoApprovedNodeKeys: string[] = [];
    let autoRejected = false;
    if (res.tasksToCreate.length > 0) {
      const expanded = await expandTasksToRows(res.tasksToCreate, ctx);
      if (expanded.rows.length > 0) {
        const inserted = await exec.insert(workflowTasks).values(expanded.rows).returning();
        createdTasks.push(...inserted);
        // 事务内装配异步作业（延时/超时/触发器/外部派发/子流程发起），与任务行同生共死，避免提交后进程崩溃丢作业
        for (const t of inserted) {
          await armTaskAsyncJobs(t, { id: ctx.instanceId, flowData: ctx.flowData, formData: ctx.formData, tenantId: ctx.tenantId ?? null }, exec);
        }
      }
      autoApprovedNodeKeys = expanded.autoApprovedNodeKeys;
      autoRejected = !!expanded.autoRejectedNodeKey;
    }

    // 3) 落库新建 token；expand 已自动通过的 frontier 不落 token，改为续接推进
    const autoSet = new Set(autoApprovedNodeKeys);
    for (const spec of res.ops.create) {
      if (autoSet.has(spec.nodeKey)) {
        engineTriggers.push({ type: 'continue', nodeKey: spec.nodeKey, branchPath: spec.branchPath, parentTokenId: spec.parentTokenId });
      } else {
        await exec.insert(workflowTokens).values({
          instanceId: ctx.instanceId,
          nodeKey: spec.nodeKey,
          status: 'active',
          branchPath: spec.branchPath,
          parentTokenId: spec.parentTokenId,
          scopeKey: ctx.scopeKey ?? null,
          tenantId: ctx.tenantId ?? null,
        });
      }
    }

    if (res.finished) finished = true;
    if (res.rejected || autoRejected) rejected = true;
    if (res.activeNodeKeys.length > 0) currentNodeKeys = res.activeNodeKeys;
  }

  if (rejected) {
    // 自动拒绝终止：清理残留待办 + 终止全部 token，保证 rejected 实例无残留
    const orphanIds = createdTasks
      .filter((t) => t.status === 'pending' || t.status === 'waiting')
      .map((t) => t.id);
    if (orphanIds.length > 0) {
      await exec.update(workflowTasks)
        .set({ status: 'skipped', actionAt: new Date() })
        .where(inArray(workflowTasks.id, orphanIds));
    }
    await killInstanceTokens(exec, ctx.instanceId);
    const remaining = createdTasks.filter((t) => t.status !== 'pending' && t.status !== 'waiting');
    return { createdTasks: remaining, finished: false, rejected: true, currentNodeKeys: [] };
  }
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
): Promise<{ completed: boolean; method: WorkflowResolvedApproveMethod | null }> {
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
      await tx.update(workflowTasks).set({ status: 'pending' })
        .where(eq(workflowTasks.id, nextWaiting.id));
      if (nextTimeoutAt) {
        await enqueueJob({ jobType: 'task_timeout', taskId: nextWaiting.id, instanceId, nodeKey, payload: { taskId: nextWaiting.id }, runAt: nextTimeoutAt, maxAttempts: 3, idempotencyKey: `task_timeout:${nextWaiting.id}` }, tx);
      }
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

/** 优先级排序：urgent > high > normal > low（用于审批/申请列表置顶加急） */
const priorityRankOrder = sql`CASE ${workflowInstances.priority} WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 WHEN 'normal' THEN 2 ELSE 3 END`;

async function loadActiveNodeKeysByInstance(instanceIds: number[]): Promise<Map<number, string[]>> {
  if (instanceIds.length === 0) return new Map();
  const rows = await db.select({
    instanceId: workflowTasks.instanceId,
    nodeKey: workflowTasks.nodeKey,
  }).from(workflowTasks)
    .where(and(
      inArray(workflowTasks.instanceId, [...new Set(instanceIds)]),
      inArray(workflowTasks.status, ['pending', 'waiting']),
    ))
    .orderBy(workflowTasks.id);
  const map = new Map<number, string[]>();
  for (const row of rows) {
    const keys = map.get(row.instanceId) ?? [];
    if (!keys.includes(row.nodeKey)) keys.push(row.nodeKey);
    map.set(row.instanceId, keys);
  }
  return map;
}

export async function listMyInstances(query: { page?: number; pageSize?: number; status?: string; priority?: string }) {
  const user = currentUser();
  const { page = 1, pageSize = 20, status, priority } = query;
  const tc = tenantCondition(workflowInstances, user);
  const conditions = [eq(workflowInstances.initiatorId, user.userId)];
  if (tc) conditions.push(tc);
  if (status) conditions.push(eq(workflowInstances.status, status as InstanceStatus));
  if (priority) conditions.push(eq(workflowInstances.priority, priority));
  const where = and(...conditions);
  const [total, rows] = await Promise.all([
    db.$count(workflowInstances, where),
    db.query.workflowInstances.findMany({
      where,
      with: {
        definition: { columns: { name: true } },
        initiator: { columns: { nickname: true, avatar: true } },
      },
      orderBy: [priorityRankOrder, desc(workflowInstances.id)],
      limit: pageSize,
      offset: pageOffset(page, pageSize),
    }),
  ]);
  const activeNodeKeys = await loadActiveNodeKeysByInstance(rows.map((row) => row.id));
  return {
    list: rows.map((r) => mapInstance(r, {
      definitionName: r.definition?.name ?? null,
      initiatorName: r.initiator?.nickname ?? null,
      initiatorAvatar: r.initiator?.avatar ?? null,
      currentNodeKeys: activeNodeKeys.get(r.id),
    })),
    total, page, pageSize,
  };
}

type SlaTimeoutInput = { enabled?: boolean; duration?: number; unit?: 'minutes' | 'hours' | 'days' } | null | undefined;

/** 根据节点超时配置与任务创建时间，计算待办 SLA：剩余/超时秒数与紧急度。 */
function computeTaskSla(timeout: SlaTimeoutInput, createdAt: Date): { slaLevel: 'none' | 'safe' | 'warning' | 'overdue'; slaDeadline: string | null; slaOverdueSec: number | null } {
  if (!timeout?.enabled || !timeout.duration || timeout.duration <= 0) {
    return { slaLevel: 'none', slaDeadline: null, slaOverdueSec: null };
  }
  const unitMin = timeout.unit === 'minutes' ? 1 : timeout.unit === 'days' ? 1440 : 60;
  const totalSec = timeout.duration * unitMin * 60;
  const deadlineMs = createdAt.getTime() + totalSec * 1000;
  const overdueSec = Math.round((Date.now() - deadlineMs) / 1000);
  let slaLevel: 'safe' | 'warning' | 'overdue';
  if (overdueSec >= 0) slaLevel = 'overdue';
  else if (-overdueSec <= Math.max(3600, totalSec * 0.2)) slaLevel = 'warning';
  else slaLevel = 'safe';
  return { slaLevel, slaDeadline: formatDateTime(new Date(deadlineMs)), slaOverdueSec: overdueSec };
}

export async function listPendingMine(query: { page?: number; pageSize?: number; keyword?: string; definitionId?: number }) {
  const user = currentUser();
  const { page = 1, pageSize = 20, keyword, definitionId } = query;
  const tc = tenantCondition(workflowInstances, user);
  const baseConditions = [
    eq(workflowTasks.assigneeId, user.userId),
    eq(workflowTasks.status, 'pending'),
    eq(workflowInstances.status, 'running'),
  ];
  if (tc) baseConditions.push(tc);
  if (keyword) {
    const likeValue = `%${escapeLike(keyword)}%`;
    baseConditions.push(or(ilike(workflowInstances.title, likeValue), ilike(workflowDefinitions.name, likeValue))!);
  }
  if (definitionId !== undefined) baseConditions.push(eq(workflowInstances.definitionId, definitionId));
  const where = and(...baseConditions);
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
        .orderBy(priorityRankOrder, desc(workflowTasks.createdAt))
        .$dynamic(),
      page, pageSize,
    ),
  ]);
  const activeNodeKeys = await loadActiveNodeKeysByInstance(rows.map((row) => row.inst.id));
  return {
    list: rows.map((r) => {
      const flow = (r.inst.definitionSnapshot as { flowData?: WorkflowFlowData } | null)?.flowData;
      const node = flow?.nodes.find((n) => n.data.key === r.task.nodeKey)?.data;
      const pendingSignatureRequired = node?.operations?.includes('signature') ?? false;
      const sla = computeTaskSla(node?.timeout, r.task.createdAt);
      return { ...mapInstance(r.inst, { ...r, currentNodeKeys: activeNodeKeys.get(r.inst.id) }), pendingTaskId: r.task.id, pendingSignatureRequired, ...sla };
    }),
    total: Number(total),
    page,
    pageSize,
  };
}

/** G1 抄送我的：nodeType=ccNode 且 assigneeId=当前用户的任务对应的实例 */
export async function listMyCc(query: { page?: number; pageSize?: number; keyword?: string }) {
  const user = currentUser();
  const { page = 1, pageSize = 20, keyword } = query;
  const tc = tenantCondition(workflowInstances, user);
  const conditions = [
    eq(workflowTasks.assigneeId, user.userId),
    eq(workflowTasks.nodeType, 'ccNode'),
  ];
  if (tc) conditions.push(tc);
  if (keyword) {
    const likeValue = `%${escapeLike(keyword)}%`;
    conditions.push(or(ilike(workflowInstances.title, likeValue), ilike(workflowDefinitions.name, likeValue))!);
  }
  const where = and(...conditions);
  const [[{ total }], rows] = await Promise.all([
    db
      .select({ total: count() })
      .from(workflowTasks)
      .innerJoin(workflowInstances, eq(workflowTasks.instanceId, workflowInstances.id))
      .leftJoin(workflowDefinitions, eq(workflowInstances.definitionId, workflowDefinitions.id))
      .where(where),
    withPagination(
      db
        .select({ inst: workflowInstances, definitionName: workflowDefinitions.name, initiatorName: users.nickname, initiatorAvatar: users.avatar, task: workflowTasks })
        .from(workflowTasks)
        .innerJoin(workflowInstances, eq(workflowTasks.instanceId, workflowInstances.id))
        .leftJoin(workflowDefinitions, eq(workflowInstances.definitionId, workflowDefinitions.id))
        .leftJoin(users, eq(workflowInstances.initiatorId, users.id))
        .where(where)
        .orderBy(desc(workflowTasks.id))
        .$dynamic(),
      page, pageSize,
    ),
  ]);
  const activeNodeKeys = await loadActiveNodeKeysByInstance(rows.map((row) => row.inst.id));
  return {
    list: rows.map((r) => mapInstance(r.inst, {
      definitionName: r.definitionName,
      initiatorName: r.initiatorName,
      initiatorAvatar: r.initiatorAvatar,
      currentNodeKeys: activeNodeKeys.get(r.inst.id),
      ccTaskId: r.task.id,
      ccReadAt: r.task.ccReadAt,
    })),
    total: Number(total),
    page,
    pageSize,
  };
}

/** G1/T1-2 抄送未读数：当前用户 ccNode 任务中 ccReadAt 为空的数量 */
export async function countMyCcUnread(): Promise<number> {
  const user = currentUser();
  const tc = tenantCondition(workflowInstances, user);
  const conditions = [
    eq(workflowTasks.assigneeId, user.userId),
    eq(workflowTasks.nodeType, 'ccNode'),
    sql`${workflowTasks.ccReadAt} is null`,
  ];
  const where = and(...conditions);
  const [{ total }] = await db
    .select({ total: count() })
    .from(workflowTasks)
    .innerJoin(workflowInstances, eq(workflowTasks.instanceId, workflowInstances.id))
    .where(tc ? and(where, tc) : where);
  return Number(total);
}

/** T1-2 标记抄送已读：仅本人 ccNode 任务可标记 */
export async function markCcRead(ccTaskId: number): Promise<void> {
  const user = currentUser();
  const [task] = await db.select().from(workflowTasks).where(eq(workflowTasks.id, ccTaskId)).limit(1);
  if (!task) throw new HTTPException(404, { message: '抄送任务不存在' });
  if (task.assigneeId !== user.userId || task.nodeType !== 'ccNode') {
    throw new HTTPException(403, { message: '无权操作该抄送' });
  }
  if (task.ccReadAt) return;
  await db.update(workflowTasks).set({ ccReadAt: new Date() }).where(eq(workflowTasks.id, ccTaskId));
}

/** T1-2 主动抄送 / 转发：任一流程参与者（发起人/审批人/抄送人/管理员）将流程抄送给指定用户 */
export async function forwardInstance(instanceId: number, userIds: number[], note?: string) {
  const user = currentUser();
  const tc = tenantCondition(workflowInstances, user);
  const conds = [eq(workflowInstances.id, instanceId)];
  if (tc) conds.push(tc);
  const [inst] = await db.select().from(workflowInstances).where(and(...conds)).limit(1);
  if (!inst) throw new HTTPException(404, { message: '流程不存在' });
  // 参与者校验：发起人 / 管理员 / 任一任务处理人
  const isInitiator = inst.initiatorId === user.userId;
  const isAdmin = (user.roles ?? []).some((r) => r === 'super_admin' || r === 'tenant_admin');
  let allowed = isInitiator || isAdmin;
  if (!allowed) {
    const involved = await db.$count(workflowTasks, and(eq(workflowTasks.instanceId, instanceId), eq(workflowTasks.assigneeId, user.userId)));
    allowed = involved > 0;
  }
  if (!allowed) throw new HTTPException(403, { message: '仅流程参与者可转发抄送' });

  const targetIds = Array.from(new Set(userIds)).filter((v) => Number.isInteger(v) && v > 0);
  if (targetIds.length === 0) throw new HTTPException(400, { message: '请选择抄送人' });
  // 去重：跳过已抄送给的用户
  const existing = await db.select({ assigneeId: workflowTasks.assigneeId }).from(workflowTasks)
    .where(and(eq(workflowTasks.instanceId, instanceId), eq(workflowTasks.nodeType, 'ccNode')));
  const existingSet = new Set(existing.map((r) => r.assigneeId).filter((v): v is number => typeof v === 'number'));
  const toAdd = targetIds.filter((uid) => !existingSet.has(uid));
  if (toAdd.length === 0) {
    return { list: [] as ReturnType<typeof mapTask>[], message: '所选用户均已抄送，无需重复添加' };
  }
  const noteText = note?.trim() ? `：${note.trim()}` : '';
  const forwardComment = `[转发抄送] 由 ${user.username ?? '系统'} 发起${noteText}`;
  const rows = toAdd.map((uid) => ({
    instanceId,
    nodeKey: inst.currentNodeKey ?? '__forward__',
    nodeName: '转发抄送',
    nodeType: 'ccNode' as const,
    assigneeId: uid,
    status: 'skipped' as const,
    comment: forwardComment,
    actionAt: null,
  }));
  const inserted = await db.insert(workflowTasks).values(rows).returning();
  const actor = { userId: user.userId, name: user.username };
  for (const t of inserted) {
    emitTaskEvent('task.created', mapTask(t), { definitionId: inst.definitionId, tenantId: inst.tenantId, actor });
  }
  return { list: inserted.map((t) => mapTask(t)), message: `已抄送 ${inserted.length} 人` };
}

/** T2-2 关联审批单候选：当前用户可见（本人发起或参与）的非草稿实例，供 relation 字段检索 */
export async function listRelationOptions(query: { definitionId?: number; keyword?: string; limit?: number }) {
  const user = currentUser();
  const { definitionId, keyword, limit = 20 } = query;
  const tc = tenantCondition(workflowInstances, user);
  const participantSub = db.select({ id: workflowTasks.instanceId }).from(workflowTasks)
    .where(eq(workflowTasks.assigneeId, user.userId));
  const conds = [
    sql`${workflowInstances.status} <> 'draft'`,
    or(eq(workflowInstances.initiatorId, user.userId), inArray(workflowInstances.id, participantSub))!,
  ];
  if (tc) conds.push(tc);
  if (definitionId) conds.push(eq(workflowInstances.definitionId, definitionId));
  if (keyword) {
    const v = `%${escapeLike(keyword)}%`;
    conds.push(or(ilike(workflowInstances.title, v), ilike(workflowInstances.serialNo, v))!);
  }
  const rows = await db.select({ inst: workflowInstances, definitionName: workflowDefinitions.name })
    .from(workflowInstances)
    .leftJoin(workflowDefinitions, eq(workflowInstances.definitionId, workflowDefinitions.id))
    .where(and(...conds))
    .orderBy(desc(workflowInstances.id))
    .limit(Math.min(limit, 50));
  return rows.map((r) => ({
    instanceId: r.inst.id,
    title: r.inst.title,
    serialNo: r.inst.serialNo ?? null,
    definitionName: r.definitionName ?? null,
    status: r.inst.status,
    createdAt: formatDateTime(r.inst.createdAt),
  }));
}

/** G2 已办：当前用户处理过（approved/rejected）的任务对应的实例 */
export async function listMyHandled(query: { page?: number; pageSize?: number; keyword?: string }) {
  const user = currentUser();
  const { page = 1, pageSize = 20, keyword } = query;
  const tc = tenantCondition(workflowInstances, user);
  const conditions = [
    eq(workflowTasks.assigneeId, user.userId),
    inArray(workflowTasks.status, ['approved', 'rejected']),
  ];
  if (tc) conditions.push(tc);
  if (keyword) {
    const likeValue = `%${escapeLike(keyword)}%`;
    conditions.push(or(ilike(workflowInstances.title, likeValue), ilike(workflowDefinitions.name, likeValue))!);
  }
  const where = and(...conditions);
  const [[{ total }], rows] = await Promise.all([
    db
      .select({ total: count() })
      .from(workflowTasks)
      .innerJoin(workflowInstances, eq(workflowTasks.instanceId, workflowInstances.id))
      .leftJoin(workflowDefinitions, eq(workflowInstances.definitionId, workflowDefinitions.id))
      .where(where),
    withPagination(
      db
        .select({ inst: workflowInstances, definitionName: workflowDefinitions.name, initiatorName: users.nickname, initiatorAvatar: users.avatar, task: workflowTasks })
        .from(workflowTasks)
        .innerJoin(workflowInstances, eq(workflowTasks.instanceId, workflowInstances.id))
        .leftJoin(workflowDefinitions, eq(workflowInstances.definitionId, workflowDefinitions.id))
        .leftJoin(users, eq(workflowInstances.initiatorId, users.id))
        .where(where)
        .orderBy(desc(workflowTasks.actionAt))
        .$dynamic(),
      page, pageSize,
    ),
  ]);
  const activeNodeKeys = await loadActiveNodeKeysByInstance(rows.map((row) => row.inst.id));
  return {
    list: rows.map((r) => mapInstance(r.inst, {
      definitionName: r.definitionName,
      initiatorName: r.initiatorName,
      initiatorAvatar: r.initiatorAvatar,
      currentNodeKeys: activeNodeKeys.get(r.inst.id),
      myTaskStatus: r.task.status,
      myActionAt: r.task.actionAt,
    })),
    total: Number(total),
    page,
    pageSize,
  };
}

export async function listAllInstances(query: { page?: number; pageSize?: number; status?: string; keyword?: string; categoryId?: number; initiatorKeyword?: string; priority?: string }) {
  const user = currentUser();
  const { page = 1, pageSize = 20, status, keyword, categoryId, initiatorKeyword, priority } = query;
  const conditions = [];
  const tc = tenantCondition(workflowInstances, user);
  if (tc) conditions.push(tc);
  // T2-3 数据权限：按发起人部门限制非超管可见的实例范围
  const scopeCond = await getDataScopeCondition({
    currentUserId: user.userId,
    deptColumn: users.departmentId,
    ownerColumn: workflowInstances.initiatorId,
  });
  if (scopeCond) conditions.push(scopeCond);
  if (status) conditions.push(eq(workflowInstances.status, status as InstanceStatus));
  if (keyword) {
    const likeValue = `%${escapeLike(keyword)}%`;
    conditions.push(or(ilike(workflowInstances.title, likeValue), ilike(workflowDefinitions.name, likeValue)));
  }
  if (categoryId !== undefined) conditions.push(eq(workflowDefinitions.categoryId, categoryId));
  if (initiatorKeyword) conditions.push(ilike(users.nickname, `%${escapeLike(initiatorKeyword)}%`));
  if (priority) conditions.push(eq(workflowInstances.priority, priority));
  const where = and(...conditions);
  const statWhere = scopeCond ? (tc ? and(tc, scopeCond) : scopeCond) : tc;
  const [statRows, [{ total }], rows] = await Promise.all([
    db.select({ status: workflowInstances.status, cnt: count() })
      .from(workflowInstances)
      .leftJoin(users, eq(workflowInstances.initiatorId, users.id))
      .where(statWhere)
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
        .orderBy(priorityRankOrder, desc(workflowInstances.id))
        .$dynamic(),
      page, pageSize,
    ),
  ]);
  const stats: Record<string, number> = { total: 0, running: 0, approved: 0, rejected: 0, withdrawn: 0 };
  for (const r of statRows) {
    stats[r.status] = r.cnt;
    stats.total += r.cnt;
  }
  const activeNodeKeys = await loadActiveNodeKeysByInstance(rows.map((row) => row.inst.id));
  return {
    stats,
    list: rows.map((r) => mapInstance(r.inst, { ...r, currentNodeKeys: activeNodeKeys.get(r.inst.id) })),
    total,
    page,
    pageSize,
  };
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
  let allowed = isInitiator || isAssignee;
  if (!allowed && row.parentInstanceId) {
    // 子流程实例：若用户是任一祖先实例的发起人，允许查看（支持嵌套子流程）
    let pid: number | null = row.parentInstanceId;
    for (let i = 0; i < 10 && pid; i++) {
      const [anc]: Array<{ initiatorId: number; parentInstanceId: number | null }> = await db
        .select({ initiatorId: workflowInstances.initiatorId, parentInstanceId: workflowInstances.parentInstanceId })
        .from(workflowInstances).where(eq(workflowInstances.id, pid)).limit(1);
      if (!anc) break;
      if (anc.initiatorId === user.userId) { allowed = true; break; }
      pid = anc.parentInstanceId;
    }
  }
  if (!allowed) throw new HTTPException(403, { message: '无权查看' });
  const snapshot = row.definitionSnapshot as { flowData?: WorkflowFlowData } | null;
  const tasks = row.tasks.map((t) => {
    const cfg = snapshot?.flowData?.nodes.find((n) => n.data.key === t.nodeKey)?.data;
    const actionButtons = cfg?.actionButtons;
    const signatureRequired = cfg?.operations?.includes('signature') ?? false;
    return mapTask(t, t.assignee?.nickname, t.assignee?.avatar, actionButtons ?? null, signatureRequired);
  });
  // 子流程：查询本实例发起的子实例（按父任务关联到节点 key）
  const childRows = await db.select({
    id: workflowInstances.id,
    title: workflowInstances.title,
    status: workflowInstances.status,
    parentTaskId: workflowInstances.parentTaskId,
    createdAt: workflowInstances.createdAt,
  }).from(workflowInstances)
    .where(eq(workflowInstances.parentInstanceId, id))
    .orderBy(workflowInstances.id);
  const taskNodeKeyById = new Map(row.tasks.map((t) => [t.id, t.nodeKey]));
  const childInstances = childRows.map((c) => ({
    id: c.id,
    title: c.title,
    status: c.status,
    parentTaskNodeKey: c.parentTaskId != null ? (taskNodeKeyById.get(c.parentTaskId) ?? null) : null,
    createdAt: formatDateTime(c.createdAt),
  }));
  const comments = await loadInstanceCommentsForDetail(id);
  const consults = await loadInstanceConsultsForDetail(id);
  return mapInstance(row, {
    definitionName: row.definition?.name ?? null,
    initiatorName: row.initiator?.nickname ?? null,
    initiatorAvatar: row.initiator?.avatar ?? null,
    tasks,
    childInstances,
    comments,
    consults,
    includeDefinitionSnapshot: true,
  });
}

function mapRuntimeOutboxEvent(row: typeof workflowJobs.$inferSelect): WorkflowRuntimeOutboxEvent {
  const event = (row.payload as { event?: { eventId?: string; type?: string } } | null)?.event;
  return {
    id: row.id,
    eventId: event?.eventId ?? row.idempotencyKey ?? String(row.id),
    eventType: event?.type ?? 'event_dispatch',
    taskId: row.taskId ?? null,
    status: row.status,
    attempts: row.attempts,
    errorMessage: row.lastError ?? null,
    nextRetryAt: row.status === 'pending' ? formatNullableDateTime(row.runAt) : null,
    processedAt: row.status === 'succeeded' ? formatNullableDateTime(row.updatedAt) : null,
    createdAt: formatDateTime(row.createdAt),
  };
}

// TODO(workflow-jobs P5): job_executions 未存 nodeName/triggerType，nodeKey/instanceId 取自父 job
function mapRuntimeTriggerExecution(row: { exec: typeof workflowJobExecutions.$inferSelect; job: typeof workflowJobs.$inferSelect }) {
  const { exec, job } = row;
  const status: 'running' | 'success' | 'failed' =
    exec.status === 'succeeded' ? 'success' : exec.status === 'failed' ? 'failed' : 'running';
  return {
    id: exec.id,
    instanceId: job.instanceId ?? 0,
    taskId: job.taskId ?? null,
    nodeKey: job.nodeKey ?? '',
    nodeName: null as string | null,
    triggerType: 'webhook' as WorkflowTriggerType,
    status,
    attempt: exec.attempt,
    requestUrl: exec.requestUrl ?? null,
    requestMethod: exec.requestMethod ?? null,
    requestBody: exec.requestBody ?? null,
    responseStatus: exec.responseStatus ?? null,
    responseBody: exec.responseBody ?? null,
    errorMessage: exec.errorMessage ?? null,
    durationMs: exec.durationMs ?? null,
    tenantId: exec.tenantId ?? null,
    createdAt: formatDateTime(exec.createdAt),
  };
}

function buildRuntimeIssues(input: {
  inst: typeof workflowInstances.$inferSelect;
  tasks: ReturnType<typeof mapTask>[];
  triggerExecutions: ReturnType<typeof mapRuntimeTriggerExecution>[];
  outboxEvents: WorkflowRuntimeOutboxEvent[];
  jobs: typeof workflowJobs.$inferSelect[];
  tokens: WorkflowExecutionToken[];
}): WorkflowRuntimeIssue[] {
  const issues: WorkflowRuntimeIssue[] = [];
  const activeTasks = input.tasks.filter((task) => task.status === 'pending' || task.status === 'waiting');
  if (input.inst.status === 'running' && activeTasks.length === 0) {
    issues.push({
      severity: 'critical',
      source: 'instance',
      title: '运行中实例没有活动任务',
      description: '实例状态仍为 running，但没有 pending/waiting 任务，可能存在推进中断或状态未回写。',
    });
  }
  // 外部审批 / 触发器作业失败（workflow_jobs）
  for (const job of input.jobs) {
    if (job.status !== 'failed' && job.status !== 'dead') continue;
    if (job.jobType === 'external_dispatch') {
      issues.push({
        severity: 'critical',
        source: 'task',
        taskId: job.taskId ?? undefined,
        nodeKey: job.nodeKey ?? undefined,
        title: '外部审批分派失败',
        description: job.lastError ?? '外部审批作业失败，需要检查外部审批配置或人工介入。',
      });
    } else if (job.jobType === 'trigger_dispatch') {
      issues.push({
        severity: 'critical',
        source: 'trigger',
        taskId: job.taskId ?? undefined,
        nodeKey: job.nodeKey ?? undefined,
        title: '触发器执行失败',
        description: job.lastError ?? '触发器作业已失败，流程仍在等待该节点。',
      });
    }
  }
  for (const task of input.tasks) {
    if (task.status !== 'pending' && task.status !== 'waiting') continue;
    if (task.nodeType === 'trigger' && task.status === 'waiting' && !input.triggerExecutions.some((item) => item.taskId === task.id)) {
      issues.push({
        severity: 'warning',
        source: 'trigger',
        taskId: task.id,
        nodeKey: task.nodeKey,
        title: '触发器暂无执行记录',
        description: '等待中的 trigger 任务未发现执行记录，可关注事件派发是否重放失败或 dispatch 状态是否仍为 pending。',
      });
    }
  }
  for (const event of input.outboxEvents) {
    if (event.status === 'failed') {
      issues.push({
        severity: 'critical',
        source: 'outbox',
        taskId: event.taskId,
        title: '事件派发失败',
        description: event.errorMessage ?? `事件 ${event.eventType} 已失败，请检查订阅者或事件处理日志。`,
      });
    } else if (event.status === 'pending' || event.status === 'retrying') {
      issues.push({
        severity: 'warning',
        source: 'outbox',
        taskId: event.taskId,
        title: '事件派发待处理',
        description: `事件 ${event.eventType} 当前为 ${event.status}，attempts=${event.attempts}。`,
      });
    }
  }
  // Token 一致性诊断（显式执行 Token 模型）
  const activeTokens = input.tokens.filter((t) => t.status === 'active');
  if (input.inst.status === 'running' && activeTokens.length === 0) {
    issues.push({
      severity: 'critical',
      source: 'token',
      title: '运行中实例无活动执行 Token',
      description: 'running 实例没有任何 active token，执行路径可能中断（旧实例未接入 token 模型或推进异常）。',
    });
  }
  const tokenFrontierTaskKeys = new Set(activeTasks.map((t) => t.nodeKey));
  for (const tk of activeTokens) {
    if (tk.parkedAtJoin) continue; // parked join token 无对应任务，属正常等待
    if (!tokenFrontierTaskKeys.has(tk.nodeKey)) {
      issues.push({
        severity: 'warning',
        source: 'token',
        nodeKey: tk.nodeKey,
        title: 'Token 与任务不一致',
        description: `节点「${tk.nodeName ?? tk.nodeKey}」存在 active token 但无 pending/waiting 任务，可能状态漂移。`,
      });
    }
  }
  if (issues.length === 0) {
    issues.push({
      severity: 'info',
      source: 'instance',
      title: '未发现明显运行时异常',
      description: '任务状态、触发器执行、事件派发与执行 Token 未命中内置诊断规则。',
    });
  }
  return issues;
}

/** 流程定义快照 → 节点元信息（名称/类型）映射 */
function buildNodeMetaFromSnapshot(snapshot: unknown): Map<string, { name: string | null; type: string | undefined }> {
  const map = new Map<string, { name: string | null; type: string | undefined }>();
  const flowData = (snapshot as { flowData?: WorkflowFlowData } | null)?.flowData;
  if (flowData?.nodes) {
    for (const n of flowData.nodes) map.set(n.data.key, { name: n.data.label ?? null, type: n.data.type });
  }
  return map;
}

function mapExecutionToken(
  row: typeof workflowTokens.$inferSelect,
  nodeMeta: Map<string, { name: string | null; type: string | undefined }>,
): WorkflowExecutionToken {
  const meta = nodeMeta.get(row.nodeKey);
  const branchPath = (row.branchPath ?? []) as Array<{ id: string; index: number; total: number }>;
  const isJoinNode = meta?.type === 'parallelGateway' || meta?.type === 'inclusiveGateway';
  return {
    id: row.id,
    nodeKey: row.nodeKey,
    nodeName: meta?.name ?? null,
    status: row.status,
    parkedAtJoin: row.status === 'active' && isJoinNode,
    branchPath,
    depth: branchPath.length,
    parentTokenId: row.parentTokenId,
    scopeKey: row.scopeKey ?? null,
    createdAt: formatDateTime(row.createdAt),
    consumedAt: formatNullableDateTime(row.consumedAt),
  };
}

function buildTokenView(instanceId: number, tokens: WorkflowExecutionToken[]): WorkflowExecutionTokenView {
  return {
    instanceId,
    activeCount: tokens.filter((t) => t.status === 'active' && !t.parkedAtJoin).length,
    parkedCount: tokens.filter((t) => t.parkedAtJoin).length,
    consumedCount: tokens.filter((t) => t.status === 'consumed').length,
    deadCount: tokens.filter((t) => t.status === 'dead').length,
    tokens,
    generatedAt: formatDateTime(new Date()),
  };
}

/** 实例的显式执行 Token 列表（活动路径 + 血缘，用于运行态可观测/重放） */
export async function getInstanceExecutionTokens(id: number): Promise<WorkflowExecutionTokenView> {
  const user = currentUser();
  const tc = tenantCondition(workflowInstances, user);
  const conditions = [eq(workflowInstances.id, id)];
  if (tc) conditions.push(tc);
  const scopeCond = await getDataScopeCondition({
    currentUserId: user.userId,
    deptColumn: users.departmentId,
    ownerColumn: workflowInstances.initiatorId,
  });
  if (scopeCond) conditions.push(scopeCond);
  const [inst] = await db.select({ id: workflowInstances.id, definitionSnapshot: workflowInstances.definitionSnapshot })
    .from(workflowInstances).where(and(...conditions)).limit(1);
  if (!inst) throw new HTTPException(404, { message: '流程实例不存在或无权查看' });
  const nodeMeta = buildNodeMetaFromSnapshot(inst.definitionSnapshot);
  const rows = await db.select().from(workflowTokens).where(eq(workflowTokens.instanceId, id)).orderBy(workflowTokens.id);
  return buildTokenView(id, rows.map((r) => mapExecutionToken(r, nodeMeta)));
}

export async function getInstanceRuntimeDiagnostics(id: number): Promise<WorkflowRuntimeDiagnostics> {
  const user = currentUser();
  const tc = tenantCondition(workflowInstances, user);
  const conditions = [eq(workflowInstances.id, id)];
  if (tc) conditions.push(tc);
  const scopeCond = await getDataScopeCondition({
    currentUserId: user.userId,
    deptColumn: users.departmentId,
    ownerColumn: workflowInstances.initiatorId,
  });
  if (scopeCond) conditions.push(scopeCond);

  const row = await db.query.workflowInstances.findFirst({
    where: and(...conditions),
    with: {
      definition: { columns: { name: true, categoryId: true }, with: { category: { columns: { name: true } } } },
      initiator: { columns: { nickname: true, avatar: true } },
      tasks: {
        with: { assignee: { columns: { nickname: true, avatar: true } } },
        orderBy: workflowTasks.id,
      },
    },
  });
  if (!row) throw new HTTPException(404, { message: '流程实例不存在或无权查看' });

  const snapshot = row.definitionSnapshot as { flowData?: WorkflowFlowData } | null;
  const tasks = row.tasks.map((task) => {
    const cfg = snapshot?.flowData?.nodes.find((n) => n.data.key === task.nodeKey)?.data;
    return mapTask(
      task,
      task.assignee?.nickname,
      task.assignee?.avatar,
      cfg?.actionButtons ?? null,
      cfg?.operations?.includes('signature') ?? false,
    );
  });
  const [triggerExecRows, eventJobRows, instanceJobs, tokenRows] = await Promise.all([
    db.select({ exec: workflowJobExecutions, job: workflowJobs })
      .from(workflowJobExecutions)
      .innerJoin(workflowJobs, eq(workflowJobExecutions.jobId, workflowJobs.id))
      .where(and(eq(workflowJobs.instanceId, id), eq(workflowJobExecutions.jobType, 'trigger_dispatch')))
      .orderBy(desc(workflowJobExecutions.id))
      .limit(50),
    db.select().from(workflowJobs)
      .where(and(eq(workflowJobs.instanceId, id), eq(workflowJobs.jobType, 'event_dispatch')))
      .orderBy(desc(workflowJobs.id))
      .limit(80),
    db.select().from(workflowJobs).where(eq(workflowJobs.instanceId, id)).limit(200),
    db.select().from(workflowTokens).where(eq(workflowTokens.instanceId, id)).orderBy(workflowTokens.id),
  ]);
  const triggerExecutions = triggerExecRows.map(mapRuntimeTriggerExecution);
  const outboxEvents = eventJobRows.map(mapRuntimeOutboxEvent);
  const nodeMeta = buildNodeMetaFromSnapshot(row.definitionSnapshot);
  const tokens = tokenRows.map((r) => mapExecutionToken(r, nodeMeta));
  const instance = mapInstance(row, {
    definitionName: row.definition?.name ?? null,
    categoryId: row.definition?.categoryId ?? null,
    categoryName: row.definition?.category?.name ?? null,
    initiatorName: row.initiator?.nickname ?? null,
    initiatorAvatar: row.initiator?.avatar ?? null,
    tasks,
    includeDefinitionSnapshot: true,
  }) as WorkflowInstance;
  const activeTasks = tasks.filter((task) => task.status === 'pending' || task.status === 'waiting');
  return {
    instance,
    tasks,
    activeTasks,
    triggerExecutions,
    outboxEvents,
    issues: buildRuntimeIssues({ inst: row, tasks, triggerExecutions, outboxEvents, jobs: instanceJobs, tokens }),
    tokens,
    snapshot: {
      formData: (row.formData ?? null) as Record<string, unknown> | null,
      formSnapshot: row.formSnapshot ?? null,
      definitionSnapshot: row.definitionSnapshot ?? null,
    },
    generatedAt: formatDateTime(new Date()),
  };
}

// ─── 运行轨迹 / 引擎解释 ─────────────────────────────────────────────────────

const JOB_TYPE_LABELS: Record<WorkflowJobType, string> = {
  delay_wake: '延时唤醒', task_timeout: '任务超时', trigger_dispatch: '触发器调度', external_dispatch: '外部审批',
  subprocess_spawn: '子流程派生', subprocess_join: '子流程汇聚', event_dispatch: '事件派发', webhook_delivery: 'Webhook 投递',
};

function humanizeMinutes(min: number): string {
  if (min < 1) return '刚刚';
  if (min < 60) return `${min} 分钟`;
  if (min < 1440) return `${Math.floor(min / 60)} 小时`;
  return `${Math.floor(min / 1440)} 天`;
}

function nodeActionWord(nodeType: string | null): string {
  if (nodeType === 'approve') return '审批';
  if (nodeType === 'handler') return '办理';
  return '处理';
}

function jobPayloadSuffix(jobType: WorkflowJobType, payload: unknown): string {
  const p = (payload ?? {}) as Record<string, unknown>;
  const event = p.event as Record<string, unknown> | undefined;
  if ((jobType === 'event_dispatch' || jobType === 'webhook_delivery') && typeof event?.type === 'string') return ` · ${event.type}`;
  return '';
}

function buildEngineExplanation(
  inst: { status: string },
  tasks: Array<{ id: number; nodeName: string | null; nodeType: string | null; status: string; assigneeName: string | null; createdAt: Date }>,
  jobs: Array<{ id: number; jobType: WorkflowJobType; status: string; runAt: Date; lastError: string | null; nodeName: string | null }>,
): WorkflowEngineExplanation {
  const now = Date.now();
  const activeTasks = tasks.filter((t) => t.status === 'pending' || t.status === 'waiting');
  const failedJobs = jobs.filter((j) => j.status === 'failed' || j.status === 'dead');
  const pendingJobs = jobs.filter((j) => j.status === 'pending' || j.status === 'running');
  const blockers: WorkflowEngineExplanationBlocker[] = [];

  for (const j of failedJobs) {
    blockers.push({
      kind: 'job', severity: 'critical', jobId: j.id, taskId: null, jobType: j.jobType, nodeName: j.nodeName,
      title: `${JOB_TYPE_LABELS[j.jobType]}${j.status === 'dead' ? '已进入死信' : '执行失败'}`,
      detail: j.lastError ?? '无错误详情',
      waitingMinutes: null,
      nextRetryAt: j.status === 'failed' ? formatNullableDateTime(j.runAt) : null,
    });
  }
  for (const t of activeTasks) {
    const min = Math.max(0, Math.floor((now - t.createdAt.getTime()) / 60000));
    blockers.push({
      kind: 'task', severity: min > 1440 ? 'warning' : 'info', taskId: t.id, jobId: null, jobType: null, nodeName: t.nodeName,
      title: `等待${t.assigneeName ?? '处理人'}${nodeActionWord(t.nodeType)}`,
      detail: `节点「${t.nodeName ?? t.id}」· 已等待 ${humanizeMinutes(min)}`,
      waitingMinutes: min, nextRetryAt: null,
    });
  }
  for (const j of pendingJobs) {
    blockers.push({
      kind: 'job', severity: 'info', jobId: j.id, taskId: null, jobType: j.jobType, nodeName: j.nodeName,
      title: `${JOB_TYPE_LABELS[j.jobType]}待执行`,
      detail: `计划于 ${formatDateTime(j.runAt)} 执行`,
      waitingMinutes: null, nextRetryAt: formatNullableDateTime(j.runAt),
    });
  }

  const nextWakeAt = pendingJobs.length > 0
    ? formatDateTime(new Date(Math.min(...pendingJobs.map((j) => j.runAt.getTime()))))
    : null;
  const lastError = failedJobs.length > 0 ? (failedJobs[0].lastError ?? null) : null;

  let state: WorkflowEngineExplanation['state'];
  if (inst.status === 'approved') state = 'completed';
  else if (inst.status === 'rejected') state = 'rejected';
  else if (inst.status === 'cancelled') state = 'canceled';
  else if (inst.status === 'withdrawn') state = 'withdrawn';
  else if (inst.status === 'draft') state = 'draft';
  else state = failedJobs.length > 0 ? 'blocked' : 'running';

  let headline: string;
  switch (state) {
    case 'completed': headline = '流程已通过，全部审批完成'; break;
    case 'rejected': headline = '流程已被驳回'; break;
    case 'canceled': headline = '流程已取消'; break;
    case 'withdrawn': headline = '流程已撤回'; break;
    case 'draft': headline = '草稿尚未提交'; break;
    case 'blocked': headline = `流程推进受阻：${failedJobs.length} 个自动作业失败，需人工介入`; break;
    default:
      headline = activeTasks.length > 0
        ? blockers.find((b) => b.kind === 'task')?.title ?? '流程进行中'
        : pendingJobs.length > 0 ? `等待自动作业执行（${pendingJobs.length} 项）` : '流程进行中';
  }

  const severityOrder = { critical: 0, warning: 1, info: 2 } as const;
  blockers.sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity]);

  return { state, headline, blockers, lastError, nextWakeAt, pendingJobCount: pendingJobs.length, failedJobCount: failedJobs.length };
}

/**
 * 运行轨迹 + 引擎解释：把任务流转（workflow_tasks）与异步作业（workflow_jobs +
 * workflow_job_executions）按时间合并，回答"为什么停这儿、在等谁、等什么、下次何时重试"。
 */
export async function getInstanceTrace(id: number): Promise<WorkflowInstanceTrace> {
  const user = currentUser();
  const tc = tenantCondition(workflowInstances, user);
  const conditions = [eq(workflowInstances.id, id)];
  if (tc) conditions.push(tc);
  const scopeCond = await getDataScopeCondition({
    currentUserId: user.userId,
    deptColumn: users.departmentId,
    ownerColumn: workflowInstances.initiatorId,
  });
  if (scopeCond) conditions.push(scopeCond);

  const row = await db.query.workflowInstances.findFirst({
    where: and(...conditions),
    columns: { id: true, title: true, status: true, definitionSnapshot: true },
    with: {
      tasks: { with: { assignee: { columns: { nickname: true } } }, orderBy: workflowTasks.id },
    },
  });
  if (!row) throw new HTTPException(404, { message: '流程实例不存在或无权查看' });

  const jobs = await db.select().from(workflowJobs).where(eq(workflowJobs.instanceId, id)).orderBy(workflowJobs.id);
  const jobIds = jobs.map((j) => j.id);
  const execRows = jobIds.length > 0
    ? await db.select().from(workflowJobExecutions).where(inArray(workflowJobExecutions.jobId, jobIds)).orderBy(workflowJobExecutions.id)
    : [];
  const execByJob = new Map<number, typeof execRows>();
  for (const e of execRows) {
    const list = execByJob.get(e.jobId);
    if (list) list.push(e); else execByJob.set(e.jobId, [e]);
  }

  // 节点名解析映射（job 仅有 nodeKey/taskId）
  const nodeNameByTaskId = new Map<number, string | null>();
  const nodeNameByKey = new Map<string, string | null>();
  for (const t of row.tasks) {
    nodeNameByTaskId.set(t.id, t.nodeName);
    if (t.nodeKey) nodeNameByKey.set(t.nodeKey, t.nodeName);
  }
  const jobNodeName = (j: { taskId: number | null; nodeKey: string | null }): string | null => {
    if (j.taskId != null) {
      const byTask = nodeNameByTaskId.get(j.taskId);
      if (byTask != null) return byTask;
    }
    if (j.nodeKey != null) {
      const byKey = nodeNameByKey.get(j.nodeKey);
      if (byKey != null) return byKey;
    }
    return null;
  };

  const explanation = buildEngineExplanation(
    row,
    row.tasks.map((t) => ({
      id: t.id, nodeName: t.nodeName, nodeType: t.nodeType as string | null, status: t.status as string,
      assigneeName: t.assignee?.nickname ?? null, createdAt: t.createdAt,
    })),
    jobs.map((j) => ({ id: j.id, jobType: j.jobType, status: j.status as string, runAt: j.runAt, lastError: j.lastError, nodeName: jobNodeName(j) })),
  );

  // 合并时间线条目（任务流转 + 异步作业），按真实时间戳升序
  const ACTION_LABEL: Record<string, string> = { approved: '通过', rejected: '驳回', skipped: '跳过', pending: '待处理', waiting: '等待中' };
  const buf: Array<{ ts: number; entry: WorkflowEngineTraceEntry }> = [];

  for (const t of row.tasks) {
    const assigneeName = t.assignee?.nickname ?? null;
    buf.push({
      ts: t.createdAt.getTime(),
      entry: {
        key: `task-new-${t.id}`, kind: 'task', at: formatDateTime(t.createdAt), traceId: null,
        title: `创建${nodeActionWord(t.nodeType)}任务${assigneeName ? `：${assigneeName}` : ''}`,
        status: t.status, nodeName: t.nodeName, assigneeName, comment: null,
        jobId: null, jobType: null, attempts: null, maxAttempts: null, runAt: null, nextRetryAt: null, lastError: null, executions: [],
      },
    });
    if (t.actionAt) {
      buf.push({
        ts: t.actionAt.getTime(),
        entry: {
          key: `task-act-${t.id}`, kind: 'task', at: formatDateTime(t.actionAt), traceId: null,
          title: `${assigneeName ?? '处理人'} ${ACTION_LABEL[t.status] ?? t.status}`,
          status: t.status, nodeName: t.nodeName, assigneeName, comment: t.comment ?? null,
          jobId: null, jobType: null, attempts: null, maxAttempts: null, runAt: null, nextRetryAt: null, lastError: null, executions: [],
        },
      });
    }
  }

  for (const j of jobs) {
    const execs = (execByJob.get(j.id) ?? []).map((e) => ({
      attempt: e.attempt, status: e.status, requestUrl: e.requestUrl, requestMethod: e.requestMethod,
      responseStatus: e.responseStatus, durationMs: e.durationMs, errorMessage: e.errorMessage,
      finishedAt: formatNullableDateTime(e.finishedAt),
    }));
    buf.push({
      ts: j.createdAt.getTime(),
      entry: {
        key: `job-${j.id}`, kind: 'job', at: formatDateTime(j.createdAt), traceId: j.traceId,
        title: `${JOB_TYPE_LABELS[j.jobType]}${jobPayloadSuffix(j.jobType, j.payload)}`,
        status: j.status, nodeName: jobNodeName(j), assigneeName: null, comment: null,
        jobId: j.id, jobType: j.jobType, attempts: j.attempts, maxAttempts: j.maxAttempts,
        runAt: formatDateTime(j.runAt),
        nextRetryAt: (j.status === 'pending' || j.status === 'failed') ? formatNullableDateTime(j.runAt) : null,
        lastError: j.lastError, executions: execs,
      },
    });
  }

  // 显式执行 Token 生命周期（进入 / 消费·汇聚 / 终止）并入时间线
  const traceNodeMeta = buildNodeMetaFromSnapshot(row.definitionSnapshot);
  const tokenRows = await db.select().from(workflowTokens).where(eq(workflowTokens.instanceId, id)).orderBy(workflowTokens.id);
  for (const tk of tokenRows) {
    const nodeName = traceNodeMeta.get(tk.nodeKey)?.name ?? nodeNameByKey.get(tk.nodeKey) ?? tk.nodeKey;
    const bp = (tk.branchPath ?? []) as Array<{ id: string; index: number; total: number }>;
    const branchLabel = bp.length > 0 ? `分支 ${bp.map((f) => `${f.index + 1}/${f.total}`).join('·')}` : '主路径';
    buf.push({
      ts: tk.createdAt.getTime(),
      entry: {
        key: `token-new-${tk.id}`, kind: 'token', at: formatDateTime(tk.createdAt), traceId: null,
        title: `执行 Token #${tk.id} 进入「${nodeName}」`,
        status: tk.status, nodeName, assigneeName: null, comment: branchLabel,
        jobId: null, jobType: null, attempts: null, maxAttempts: null, runAt: null, nextRetryAt: null, lastError: null, executions: [],
      },
    });
    if (tk.consumedAt && (tk.status === 'consumed' || tk.status === 'dead')) {
      buf.push({
        ts: tk.consumedAt.getTime(),
        entry: {
          key: `token-end-${tk.id}`, kind: 'token', at: formatDateTime(tk.consumedAt), traceId: null,
          title: `执行 Token #${tk.id} ${tk.status === 'consumed' ? '消费（推进/汇聚）' : '终止'}：「${nodeName}」`,
          status: tk.status, nodeName, assigneeName: null, comment: branchLabel,
          jobId: null, jobType: null, attempts: null, maxAttempts: null, runAt: null, nextRetryAt: null, lastError: null, executions: [],
        },
      });
    }
  }

  buf.sort((a, b) => (a.ts - b.ts) || a.entry.key.localeCompare(b.entry.key));

  return {
    instanceId: row.id,
    title: row.title,
    explanation,
    trace: buf.map((b) => b.entry),
    generatedAt: formatDateTime(new Date()),
  };
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

export async function getWorkflowTaskForAdminAudit(taskId: number) {
  const [task] = await db
    .select({ instanceId: workflowTasks.instanceId })
    .from(workflowTasks)
    .where(eq(workflowTasks.id, taskId))
    .limit(1);
  if (!task) return null;
  return getInstanceForAdminAudit(task.instanceId);
}

export async function createInstance(data: { definitionId: number; title: string; formData?: Record<string, unknown> | null; asDraft?: boolean; priority?: import('@zenith/shared').WorkflowInstancePriority; ccUserIds?: number[]; selectedInitiatorApprovers?: SelectedApproverMap; bizType?: string | null; bizId?: string | null }, callerOverride?: { userId: number; username: string; tenantId: number | null; roles?: string[] }) {
  const user = callerOverride
    ? { userId: callerOverride.userId, username: callerOverride.username, roles: callerOverride.roles ?? [], tenantId: callerOverride.tenantId }
    : currentUser();
  const skipScopeCheck = !!callerOverride;
  const [def] = await db.select().from(workflowDefinitions).where(and(eq(workflowDefinitions.id, data.definitionId), eq(workflowDefinitions.status, 'published'))).limit(1);
  if (!def) throw new HTTPException(404, { message: '流程定义不存在或未发布' });
  const normalizedBizType = data.bizType?.trim() || null;
  const normalizedBizId = data.bizId?.trim() || null;
  const launchData = { ...data, bizType: normalizedBizType, bizId: normalizedBizId };
  assertLaunchMatchesFormType(def, launchData);
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
  const baseFlowData = def.flowData as WorkflowFlowData;
  if (!baseFlowData?.nodes?.length) throw new HTTPException(400, { message: '流程定义无效' });
  const flowData = data.asDraft
    ? baseFlowData
    : await applyInitiatorSelectedApprovers(baseFlowData, data.selectedInitiatorApprovers);
  const definitionSnapshot = data.asDraft ? def : { ...def, flowData };
  const validation = validateFlowData(flowData);
  if (!validation.valid) throw new HTTPException(400, { message: validation.errors[0] });
  const formData: Record<string, unknown> = sanitizeFormByStartPerms(flowData, data.formData ?? {});
  const resolvedFormSnapshot = await resolveFormSnapshot(def.formId);
  const formSnapshot = buildInstanceFormSnapshot(def, resolvedFormSnapshot);

  const existingBizInstance = await findInstanceByBusinessKey(normalizedBizType, normalizedBizId);
  if (existingBizInstance) return mapInstance(existingBizInstance);

  // 草稿：仅保存表单，不进入流转、不生成业务编号、不触发事件
  if (data.asDraft) {
      const [draft] = await db.insert(workflowInstances).values({
        definitionId: def.id,
        definitionSnapshot: def,
      title: data.title,
      formData,
      formSnapshot,
      status: 'draft',
      priority: data.priority ?? 'normal',
      currentNodeKey: null,
      initiatorId: user.userId,
      tenantId: getCreateTenantId(user),
      bizType: normalizedBizType,
      bizId: normalizedBizId,
    }).returning();
    return mapInstance(draft);
  }

  const starter = await buildStarterContext(user.userId);
  if (!hasExecutableEntry(flowData, formData, starter)) {
    throw new HTTPException(400, { message: '流程定义中无可执行节点' });
  }
  const serialConfig = flowData.settings?.serialNo;
  let txResult: { instance: typeof workflowInstances.$inferSelect; createdTasks: typeof workflowTasks.$inferSelect[] };
  try {
    txResult = await db.transaction(async (tx) => {
      const serialNo = await generateSerialNo(tx, def.id, serialConfig);
      const [createdInstance] = await tx.insert(workflowInstances).values({
        definitionId: def.id,
        definitionSnapshot,
        title: data.title,
        serialNo,
        formData,
        formSnapshot,
        status: 'running',
        priority: data.priority ?? 'normal',
        currentNodeKey: null,
        initiatorId: user.userId,
        tenantId: getCreateTenantId(user),
        bizType: normalizedBizType,
        bizId: normalizedBizId,
      }).returning();
      const materialized = await advanceAndMaterialize({ kind: 'seed' }, {
        instanceId: createdInstance.id,
        initiatorId: user.userId,
        executor: tx,
        flowData,
        formData,
        settings: flowData.settings,
        starter,
        tenantId: createdInstance.tenantId,
      });
      const [updatedInstance] = await tx.update(workflowInstances).set({
        status: materialized.rejected ? 'rejected' : (materialized.finished ? 'approved' : 'running'),
        currentNodeKey: materialized.rejected || materialized.finished ? null : materialized.currentNodeKeys[0] ?? null,
      }).where(eq(workflowInstances.id, createdInstance.id)).returning();
      // 事务性 outbox：发起事件在同一事务内入队，与实例/任务插入原子提交（崩溃不丢）
      await emitInstanceStartEvents(mapInstance(updatedInstance), updatedInstance, materialized.createdTasks, { userId: user.userId, name: user.username }, tx);
      return { instance: updatedInstance, createdTasks: materialized.createdTasks };
    });
  } catch (err) {
    if (normalizedBizType && normalizedBizId && isPgUniqueViolation(err)) {
      const existing = await findInstanceByBusinessKey(normalizedBizType, normalizedBizId);
      if (existing) return mapInstance(existing);
    }
    throw err;
  }
  const { instance } = txResult;
  const instanceDto = mapInstance(instance);
  // 事件与异步作业均已在事务内入队（outbox + 在库作业）
  // 发起时自选抄送：插入 ccNode 任务（best-effort，失败不影响发起结果；接收人通过「抄送我的」查看）
  const ccIds = Array.from(new Set((data.ccUserIds ?? []).filter((v) => Number.isInteger(v) && v > 0)));
  if (ccIds.length > 0) {
    try {
      const [validUsers, existing] = await Promise.all([
        db.select({ id: users.id }).from(users).where(inArray(users.id, ccIds)),
        db.select({ assigneeId: workflowTasks.assigneeId }).from(workflowTasks)
          .where(and(eq(workflowTasks.instanceId, instance.id), eq(workflowTasks.nodeType, 'ccNode'))),
      ]);
      const validSet = new Set(validUsers.map((u) => u.id));
      const existingSet = new Set(existing.map((r) => r.assigneeId).filter((v): v is number => typeof v === 'number'));
      const toAdd = ccIds.filter((uid) => validSet.has(uid) && !existingSet.has(uid));
      if (toAdd.length > 0) {
        await db.insert(workflowTasks).values(toAdd.map((uid) => ({
          instanceId: instance.id,
          nodeKey: '__initiator_cc__',
          nodeName: '发起抄送',
          nodeType: 'ccNode' as const,
          assigneeId: uid,
          status: 'skipped' as const,
          comment: `[发起抄送] 由 ${user.username ?? '系统'} 指定`,
          actionAt: null,
        })));
      }
    } catch (err) {
      logger.error('[workflow] 发起时自选抄送写入失败', { instanceId: instance.id, err });
    }
  }
  return instanceDto;
}

/** 实例进入流转后统一触发事件 + 调度延迟/子流程（createInstance 与草稿提交共用） */
/** 入队"发起"相关事件（传 executor 在事务内原子入队 outbox；不传则提交后 best-effort 入队） */
async function emitInstanceStartEvents(
  instanceDto: ReturnType<typeof mapInstance>,
  instance: typeof workflowInstances.$inferSelect,
  createdTasks: typeof workflowTasks.$inferSelect[],
  actor: { userId: number; name: string },
  executor?: DbExecutor,
): Promise<void> {
  await emitInstanceEvent('instance.created', instanceDto, actor, executor);
  for (const t of createdTasks) {
    const meta = { definitionId: instance.definitionId, tenantId: instance.tenantId, actor };
    await emitNodeEvent('node.entered', { instanceId: instance.id, ...meta, nodeKey: t.nodeKey, nodeName: t.nodeName, nodeType: t.nodeType }, executor);
    await emitTaskEvent('task.created', mapTask(t), meta, executor);
    if (t.assigneeId && t.status === 'pending') await emitTaskEvent('task.assigned', mapTask(t), meta, executor);
    if (t.status === 'approved') await emitTaskEvent('task.approved', mapTask(t), meta, executor);
    if (t.status === 'rejected') await emitTaskEvent('task.rejected', mapTask(t), meta, executor);
  }
  if (instance.status === 'approved') await emitInstanceEvent('instance.approved', instanceDto, actor, executor);
  if (instance.status === 'rejected') await emitInstanceEvent('instance.rejected', instanceDto, actor, executor);
}

async function findInstanceByBusinessKey(
  bizType: string | null,
  bizId: string | null,
): Promise<typeof workflowInstances.$inferSelect | null> {
  if (!bizType || !bizId) return null;
  const [existing] = await db.select().from(workflowInstances)
    .where(and(eq(workflowInstances.bizType, bizType), eq(workflowInstances.bizId, bizId)))
    .orderBy(desc(workflowInstances.id))
    .limit(1);
  return existing ?? null;
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
    // 实例行级锁 + 锁内重校验：避免与并发审批推进竞态（撤回时流程正被推进，导致状态互相覆盖或残留任务）
    const [locked] = await tx.select({ status: workflowInstances.status })
      .from(workflowInstances).where(eq(workflowInstances.id, id)).for('update').limit(1);
    if (!locked || locked.status !== 'running') {
      throw new HTTPException(409, { message: '流程实例状态已变化，请刷新后重试' });
    }
    const cancelled = await tx.update(workflowTasks).set({ status: 'skipped', actionAt: new Date() })
      .where(and(eq(workflowTasks.instanceId, id), inArray(workflowTasks.status, ['pending', 'waiting'])))
      .returning();
    await killInstanceTokens(tx, id);
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

export async function cancelInstance(id: number) {
  const user = currentUser();
  const tc = tenantCondition(workflowInstances, user);
  const conditions = [eq(workflowInstances.id, id)];
  if (tc) conditions.push(tc);
  const [inst] = await db.select().from(workflowInstances).where(and(...conditions)).limit(1);
  if (!inst) throw new HTTPException(404, { message: '流程实例不存在' });
  if (inst.status !== 'running') throw new HTTPException(400, { message: '只能取消进行中的流程' });
  const { row: updated, cancelledTasks } = await db.transaction(async (tx) => {
    const [locked] = await tx.select({ status: workflowInstances.status })
      .from(workflowInstances).where(and(...conditions)).for('update').limit(1);
    if (!locked || locked.status !== 'running') {
      throw new HTTPException(400, { message: '只能取消进行中的流程' });
    }
    const cancelled = await tx.update(workflowTasks).set({ status: 'skipped', actionAt: new Date() })
      .where(and(eq(workflowTasks.instanceId, id), inArray(workflowTasks.status, ['pending', 'waiting'])))
      .returning();
    await killInstanceTokens(tx, id);
    const [row] = await tx.update(workflowInstances).set({ status: 'cancelled', currentNodeKey: null }).where(and(...conditions)).returning();
    return { row, cancelledTasks: cancelled };
  });
  const instanceDto = mapInstance(updated);
  const actor = { userId: user.userId, name: user.username };
  for (const t of cancelledTasks) {
    emitTaskEvent('task.skipped', mapTask(t), { definitionId: updated.definitionId, tenantId: updated.tenantId, actor });
  }
  return instanceDto;
}

export async function deleteInstance(id: number) {
  const user = currentUser();
  const tc = tenantCondition(workflowInstances, user);
  const conditions = [eq(workflowInstances.id, id)];
  if (tc) conditions.push(tc);
  const [inst] = await db.select().from(workflowInstances).where(and(...conditions)).limit(1);
  if (!inst) throw new HTTPException(404, { message: '流程实例不存在' });
  if (inst.status === 'running' || inst.status === 'draft') {
    throw new HTTPException(400, { message: '请先取消进行中的流程再删除' });
  }
  await db.delete(workflowInstances).where(and(...conditions));
}

/** 监控页管理员操作的审计前置快照（不做发起人/审批人权限校验） */
export async function getInstanceForAdminAudit(id: number) {
  const user = currentUser();
  const tc = tenantCondition(workflowInstances, user);
  const conditions = [eq(workflowInstances.id, id)];
  if (tc) conditions.push(tc);
  const [inst] = await db.select().from(workflowInstances).where(and(...conditions)).limit(1);
  return inst ? mapInstance(inst) : null;
}

type WorkflowTaskAttachment = { name: string; url: string; size?: number };

/** 读取节点「操作按钮设置」中指定按钮的配置 */
function resolveNodeActionButton(
  inst: typeof workflowInstances.$inferSelect,
  nodeKey: string,
  key: WorkflowActionButtonKey,
): WorkflowActionButtonConfig | undefined {
  const flowData = (inst.definitionSnapshot as { flowData?: WorkflowFlowData } | null)?.flowData;
  const nodeCfg = flowData?.nodes.find((n) => n.data.key === nodeKey)?.data;
  const buttons = nodeCfg?.actionButtons as Partial<Record<WorkflowActionButtonKey, WorkflowActionButtonConfig>> | undefined;
  return buttons?.[key];
}

/** 校验「操作按钮设置」中某动作的附件必填要求（uploadMode === 'required'） */
function assertActionUploadRequirement(
  inst: typeof workflowInstances.$inferSelect,
  nodeKey: string,
  key: WorkflowActionButtonKey,
  attachments?: WorkflowTaskAttachment[],
) {
  const btn = resolveNodeActionButton(inst, nodeKey, key);
  if (btn?.uploadMode === 'required' && (!attachments || attachments.length === 0)) {
    throw new HTTPException(400, { message: '请上传附件后再提交' });
  }
}

export interface ApproveResult {
  instance: ReturnType<typeof mapInstance>;
  message: string;
}

export async function approveTask(taskId: number, comment?: string, attachments?: Array<{ name: string; url: string; size?: number }>, selectedNextApprovers?: number[], signature?: string): Promise<ApproveResult> {
  const user = currentUser();
  const [task] = await db.select().from(workflowTasks).where(and(eq(workflowTasks.id, taskId), eq(workflowTasks.assigneeId, user.userId))).limit(1);
  if (!task) throw new HTTPException(404, { message: '任务不存在或无权操作' });
  if (task.status !== 'pending') throw new HTTPException(400, { message: '任务已处理' });
  const [inst] = await db.select().from(workflowInstances).where(eq(workflowInstances.id, task.instanceId)).limit(1);
  if (!inst) throw new HTTPException(500, { message: '流程数据异常' });
  if (inst.status !== 'running') throw new HTTPException(400, { message: '流程实例不在进行中' });
  // 校验"操作按钮设置"中通过按钮的附件必填（uploadMode === 'required'）
  const flowData = (inst.definitionSnapshot as { flowData?: WorkflowFlowData } | null)?.flowData;
  const nodeCfg = flowData?.nodes.find((n) => n.data.key === task.nodeKey)?.data;
  assertActionUploadRequirement(inst, task.nodeKey, 'approve', attachments);
  if (flowData) {
    await assertSelectedNextApprovers(flowData, task.nodeKey, selectedNextApprovers, db);
  }
  if (nodeCfg?.operations?.includes('opinionRequired') && !comment?.trim()) {
    throw new HTTPException(400, { message: '请填写审批意见后再提交' });
  }
  if (nodeCfg?.operations?.includes('signature') && !signature?.trim()) {
    throw new HTTPException(400, { message: '该节点要求手写签名，请先完成签名' });
  }
  // 委派回执：若由委派人操作，不推进流程，仅生成回执任务给原委派人
  if (task.delegatedFromId && task.delegatedFromId !== user.userId) {
    return processDelegatedReceipt(task, inst, 'approved', comment, { userId: user.userId, name: user.username }, attachments);
  }
  return approveTaskCore(task, inst, comment, { userId: user.userId, name: user.username }, { selectedNextApprovers, signature, attachments });
}

/** 外部审批回调：根据 callbackId 找到 waiting 任务并审批通过 */
export async function approveTaskByCallback(callbackId: string, comment: string | undefined, approverName: string): Promise<ApproveResult> {
  const [task] = await db.select().from(workflowTasks).where(eq(workflowTasks.externalCallbackId, callbackId)).limit(1);
  if (!task) throw new HTTPException(404, { message: '回调任务不存在' });
  const [inst] = await db.select().from(workflowInstances).where(eq(workflowInstances.id, task.instanceId)).limit(1);
  if (!inst) throw new HTTPException(500, { message: '流程数据异常' });
  if (task.status === 'approved') {
    return { instance: mapInstance(inst), message: '回调已处理' };
  }
  if (task.status !== 'waiting') throw new HTTPException(409, { message: '回调任务已处理' });
  if (inst.status !== 'running') throw new HTTPException(400, { message: '流程实例不在进行中' });
  try {
    return await approveTaskCore(task, inst, comment, { userId: 0, name: `external:${approverName}` });
  } catch (err) {
    if (err instanceof HTTPException && err.status === 409) {
      const [freshTask] = await db.select().from(workflowTasks).where(eq(workflowTasks.id, task.id)).limit(1);
      const [freshInst] = await db.select().from(workflowInstances).where(eq(workflowInstances.id, task.instanceId)).limit(1);
      if (freshTask?.status === 'approved' && freshInst) {
        return { instance: mapInstance(freshInst), message: '回调已处理' };
      }
    }
    throw err;
  }
}

export async function approveTaskCore(
  task: typeof workflowTasks.$inferSelect,
  inst: typeof workflowInstances.$inferSelect,
  comment: string | undefined,
  actor: WorkflowEventActor,
  options?: { selectedNextApprovers?: number[]; signature?: string; attachments?: Array<{ name: string; url: string; size?: number }> },
): Promise<ApproveResult> {
  const taskId = task.id;
  const snapshot = inst.definitionSnapshot as { flowData?: WorkflowFlowData };
  const flowData = snapshot?.flowData;
  if (!flowData) throw new HTTPException(500, { message: '流程快照数据异常' });

  const updated = await db.transaction(async (tx) => {
    // 实例行级锁：序列化同一实例上的并发审批，避免会签末位并发各自读不到对方已审批而都不推进（节点卡死）
    const [lockedInst] = await tx.select({ status: workflowInstances.status, formData: workflowInstances.formData })
      .from(workflowInstances).where(eq(workflowInstances.id, inst.id)).for('update').limit(1);
    if (!lockedInst || lockedInst.status !== 'running') {
      throw new HTTPException(409, { message: '流程实例状态已变化，请刷新后重试' });
    }
    // 乐观并发保护：仅当任务仍处于读取时的状态才能推进，防止并发重复审批导致流程重复前进
    const [approvedTask] = await tx.update(workflowTasks).set({
      status: 'approved',
      comment: comment ?? null,
      signature: options?.signature ?? null,
      attachments: options?.attachments ?? null,
      actionAt: new Date(),
    }).where(and(eq(workflowTasks.id, taskId), eq(workflowTasks.status, task.status))).returning();
    if (!approvedTask) throw new HTTPException(409, { message: '任务已被处理，请刷新后重试' });

    // 检查当前节点是否已足够推进（会签/或签/顺序会签）
    const { completed } = await checkNodeCompletion(tx, inst.id, task.nodeKey, flowData);
    if (!completed) {
      const [row] = await tx.update(workflowInstances)
        .set({ currentNodeKey: task.nodeKey })
        .where(eq(workflowInstances.id, inst.id))
        .returning();
      return { row, finished: false, rejected: false, advanced: false, approvedTask, newTasks: [] as typeof workflowTasks.$inferSelect[] };
    }

    const formData = (lockedInst.formData ?? inst.formData ?? {}) as Record<string, unknown>;
    const starter = await buildStarterContext(inst.initiatorId, tx);
    // 退回模式 backToOrigin：被退回任务通过后，直接跳回发起退回的来源节点（而非继续后续路径）
    const originCfg = task.returnOriginNodeKey
      ? flowData.nodes.find((n) => n.data.key === task.returnOriginNodeKey)?.data
      : undefined;
    const advTrigger: MaterializeTrigger = (originCfg && (originCfg.type === 'approve' || originCfg.type === 'handler'))
      ? { kind: 'enterNode', nodeKey: originCfg.key, consumeNodeKey: task.nodeKey }
      : { kind: 'advanceNode', nodeKey: task.nodeKey };
    const materialized = await advanceAndMaterialize(advTrigger, {
      instanceId: inst.id,
      initiatorId: inst.initiatorId,
      executor: tx,
      flowData,
      formData,
      settings: flowData.settings,
      selectedNextApprovers: options?.selectedNextApprovers,
      starter,
      tenantId: inst.tenantId,
    });

    if (materialized.rejected) {
      // 下游自动拒绝终止流程：清理实例其余未结束任务（如并行其它分支待办），保证 rejected 实例无残留待办
      await tx.update(workflowTasks).set({ status: 'skipped', actionAt: new Date() })
        .where(and(eq(workflowTasks.instanceId, inst.id), inArray(workflowTasks.status, ['pending', 'waiting'])));
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
  }
  if (updated.finished) {
    emitInstanceEvent('instance.approved', mapInstance(updated.row), actor);
    if (updated.row.parentTaskId) {
      void enqueueSubprocessJoin(updated.row).catch((err) => {
        logger.error('[subProcess] resume parent failed', { childId: updated.row.id, err });
      });
    }
  }
  if (updated.rejected) {
    emitInstanceEvent('instance.rejected', mapInstance(updated.row), actor);
    if (updated.row.parentTaskId) {
      void enqueueSubprocessJoin(updated.row).catch((err) => {
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

export async function rejectTask(taskId: number, comment: string, attachments?: WorkflowTaskAttachment[]): Promise<ApproveResult> {
  const user = currentUser();
  const [task] = await db.select().from(workflowTasks).where(and(eq(workflowTasks.id, taskId), eq(workflowTasks.assigneeId, user.userId))).limit(1);
  if (!task) throw new HTTPException(404, { message: '任务不存在或无权操作' });
  if (task.status !== 'pending') throw new HTTPException(400, { message: '任务已处理' });
  const [inst] = await db.select().from(workflowInstances).where(eq(workflowInstances.id, task.instanceId)).limit(1);
  if (!inst) throw new HTTPException(500, { message: '流程数据异常' });
  if (inst.status !== 'running') throw new HTTPException(400, { message: '流程实例不在进行中' });
  if (!comment.trim()) throw new HTTPException(400, { message: '请填写拒绝原因' });
  assertActionUploadRequirement(inst, task.nodeKey, 'reject', attachments);
  if (task.delegatedFromId && task.delegatedFromId !== user.userId) {
    return processDelegatedReceipt(task, inst, 'rejected', comment, { userId: user.userId, name: user.username }, attachments);
  }
  return rejectTaskCore(task, inst, comment, { userId: user.userId, name: user.username }, attachments);
}

/** 外部审批回调：根据 callbackId 找到 waiting 任务并驳回 */
export async function rejectTaskByCallback(callbackId: string, comment: string, approverName: string) {
  const [task] = await db.select().from(workflowTasks).where(eq(workflowTasks.externalCallbackId, callbackId)).limit(1);
  if (!task) throw new HTTPException(404, { message: '回调任务不存在' });
  const [inst] = await db.select().from(workflowInstances).where(eq(workflowInstances.id, task.instanceId)).limit(1);
  if (!inst) throw new HTTPException(500, { message: '流程数据异常' });
  if (task.status === 'rejected') {
    return { instance: mapInstance(inst), message: '回调已处理' };
  }
  if (task.status !== 'waiting') throw new HTTPException(409, { message: '回调任务已处理' });
  if (inst.status !== 'running') throw new HTTPException(400, { message: '流程实例不在进行中' });
  try {
    return await rejectTaskCore(task, inst, comment, { userId: 0, name: `external:${approverName}` });
  } catch (err) {
    if (err instanceof HTTPException && err.status === 409) {
      const [freshTask] = await db.select().from(workflowTasks).where(eq(workflowTasks.id, task.id)).limit(1);
      const [freshInst] = await db.select().from(workflowInstances).where(eq(workflowInstances.id, task.instanceId)).limit(1);
      if (freshTask?.status === 'rejected' && freshInst) {
        return { instance: mapInstance(freshInst), message: '回调已处理' };
      }
    }
    throw err;
  }
}

export async function rejectTaskCore(
  task: typeof workflowTasks.$inferSelect,
  inst: typeof workflowInstances.$inferSelect,
  comment: string,
  actor: WorkflowEventActor,
  attachments?: WorkflowTaskAttachment[],
): Promise<ApproveResult> {
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
      // 找已 approved 的 approve/handler 任务节点，按审批时间倒序
      const prevApproved = await db.select().from(workflowTasks)
        .where(and(
          eq(workflowTasks.instanceId, inst.id),
          eq(workflowTasks.status, 'approved'),
        ))
        .orderBy(desc(workflowTasks.actionAt), desc(workflowTasks.id));
      const approvedApproveKeys = prevApproved
        .filter((t) => {
          const cfg = flowData.nodes.find((n) => n.data.key === t.nodeKey)?.data;
          return cfg && (cfg.type === 'approve' || cfg.type === 'handler');
        })
        .map((t) => t.nodeKey);
      // 优先退回到当前节点的最近上游祖先，避免并行流程误选到另一分支上最近审批的节点
      targetNodeKey = findReturnPrevTarget(flowData, task.nodeKey, approvedApproveKeys);
    } else if (strategy === 'returnStart') {
      // 从头重新走流程（重新生成首批任务）
      targetNodeKey = '__start__';
    }
  }

  const updated = await db.transaction(async (tx) => {
    // 实例行级锁：序列化同一实例上的并发审批/驳回，避免与并发审批互相覆盖推进
    const [lockedInst] = await tx.select({ status: workflowInstances.status })
      .from(workflowInstances).where(eq(workflowInstances.id, inst.id)).for('update').limit(1);
    if (!lockedInst || lockedInst.status !== 'running') {
      throw new HTTPException(409, { message: '流程实例状态已变化，请刷新后重试' });
    }
    // 当前任务 → rejected（乐观并发保护：状态变更则中止，防止并发重复驳回）
    const [rejectedTask] = await tx.update(workflowTasks)
      .set({ status: 'rejected', comment, attachments: attachments ?? null, actionAt: new Date() })
      .where(and(eq(workflowTasks.id, taskId), eq(workflowTasks.status, task.status)))
      .returning();
    if (!rejectedTask) throw new HTTPException(409, { message: '任务已被处理，请刷新后重试' });

    // 比例会签：本任务驳回后若阈值仍可达成，仅记录该任务驳回、节点保持活动。
    // 必须在实例行级锁内基于最新状态判定，避免并发驳回各自读到旧状态、都不触发整节点驳回而使节点卡死。
    if (rejectedTask.approveMethod === 'ratio') {
      const ratioSiblings = await tx.select().from(workflowTasks)
        .where(and(eq(workflowTasks.instanceId, inst.id), eq(workflowTasks.nodeKey, task.nodeKey)));
      const ratioPct = ratioSiblings.find((t) => t.approveRatio)?.approveRatio ?? 51;
      const required = Math.ceil(ratioSiblings.length * ratioPct / 100);
      const maxPossibleApproved = ratioSiblings
        .filter((t) => t.status === 'approved' || t.status === 'pending' || t.status === 'waiting')
        .length;
      if (maxPossibleApproved >= required) {
        return {
          row: inst,
          terminated: false as const,
          finished: false as const,
          partial: true as const,
          rejectedTask,
          skippedTasks: [] as typeof workflowTasks.$inferSelect[],
          newTasks: [] as typeof workflowTasks.$inferSelect[],
        };
      }
    }

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
      await killInstanceTokens(tx, inst.id);
      const [row] = await tx.update(workflowInstances)
        .set({ status: 'rejected', currentNodeKey: null })
        .where(eq(workflowInstances.id, inst.id))
        .returning();
      return { row, terminated: true, rejectedTask, skippedTasks: skipped, newTasks: [] as typeof workflowTasks.$inferSelect[] };
    }

    // 回退：实例保持 running，在目标节点重新生成任务
    const formData = (inst.formData ?? {}) as Record<string, unknown>;
    const starter = await buildStarterContext(inst.initiatorId, tx);
    let returnTrigger: MaterializeTrigger | null = null;

    if (strategy === 'returnStart') {
      returnTrigger = { kind: 'seed' };
    } else {
      const targetCfg = flowData.nodes.find((n) => n.data.key === targetNodeKey)?.data;
      if (targetCfg && (targetCfg.type === 'approve' || targetCfg.type === 'handler')) {
        returnTrigger = { kind: 'enterNode', nodeKey: targetCfg.key };
      }
    }

    if (!returnTrigger) {
      await killInstanceTokens(tx, inst.id);
      const [row] = await tx.update(workflowInstances)
        .set({ status: 'rejected', currentNodeKey: null })
        .where(eq(workflowInstances.id, inst.id))
        .returning();
      return { row, terminated: true, rejectedTask, skippedTasks: skipped, newTasks: [] as typeof workflowTasks.$inferSelect[] };
    }

    // 回退前清场：终止所有 active token，避免旧并行分支残留 token 影响重建路径的汇聚判定
    await killInstanceTokens(tx, inst.id);
    const materialized = await advanceAndMaterialize(returnTrigger, {
      instanceId: inst.id,
      initiatorId: inst.initiatorId,
      executor: tx,
      flowData,
      formData,
      settings: flowData.settings,
      starter,
      tenantId: inst.tenantId,
    });

    // 退回模式 backToOrigin：给目标节点新任务打上来源节点标记，通过后直接跳回本节点
    if ((strategy === 'returnPrev' || strategy === 'returnToNode')
      && currentNodeCfg?.returnMode === 'backToOrigin' && targetNodeKey) {
      const ids = materialized.createdTasks.filter((t) => t.nodeKey === targetNodeKey).map((t) => t.id);
      if (ids.length > 0) {
        await tx.update(workflowTasks).set({ returnOriginNodeKey: task.nodeKey }).where(inArray(workflowTasks.id, ids));
      }
    }

    if (materialized.rejected) {
      // 下游自动拒绝终止流程：清理实例其余未结束任务，保证 rejected 实例无残留待办
      await tx.update(workflowTasks).set({ status: 'skipped', actionAt: new Date() })
        .where(and(eq(workflowTasks.instanceId, inst.id), inArray(workflowTasks.status, ['pending', 'waiting'])));
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
  // 比例会签部分驳回：节点仍活动，仅记录该任务驳回，不发节点离开 / 实例状态事件
  if ((updated as { partial?: boolean }).partial) {
    return { instance: mapInstance(updated.row), message: '已驳回' };
  }
  for (const t of updated.skippedTasks) {
    emitTaskEvent('task.skipped', mapTask(t), meta);
  }
  emitNodeEvent('node.left', { instanceId: updated.row.id, ...meta, nodeKey: task.nodeKey, nodeName: task.nodeName, nodeType: task.nodeType });
  if (updated.terminated) {
    emitInstanceEvent('instance.rejected', mapInstance(updated.row), actor);
    if (updated.row.parentTaskId) {
      void enqueueSubprocessJoin(updated.row).catch((err) => {
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
    }
    if (updated.finished) {
      emitInstanceEvent('instance.approved', mapInstance(updated.row), actor);
      if (updated.row.parentTaskId) {
        void enqueueSubprocessJoin(updated.row).catch((err) => {
          logger.error('[subProcess] resume parent failed', { childId: updated.row.id, err });
        });
      }
    }
  }

  return { instance: mapInstance(updated.row), message: '已驳回' };
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
  attachments?: Array<{ name: string; url: string; size?: number }>,
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
      attachments: attachments ?? null,
      actionAt: new Date(),
    }).where(and(eq(workflowTasks.id, task.id), eq(workflowTasks.status, task.status))).returning();
    if (!closedTask) throw new HTTPException(409, { message: '任务已被处理，请刷新后重试' });
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
export async function transferTask(taskId: number, targetUserId: number, comment?: string, attachments?: WorkflowTaskAttachment[]) {
  const { task, inst, actor } = await getOwnPendingTask(taskId);
  assertActionUploadRequirement(inst, task.nodeKey, 'transfer', attachments);
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
      attachments: attachments ?? null,
      transferChain: nextChain,
      originalAssigneeId: task.originalAssigneeId ?? task.assigneeId ?? null,
    })
    .where(and(eq(workflowTasks.id, task.id), eq(workflowTasks.status, 'pending')))
    .returning();
  if (!updated) throw new HTTPException(409, { message: '任务状态已变化，无法转办' });
  emitTaskEvent('task.transferred', mapTask(updated, target.nickname),
    { definitionId: inst.definitionId, tenantId: inst.tenantId, actor, comment: transferComment });
  return mapTask(updated, target.nickname);
}

/**
 * 系统级转交（超时升级专用）：将任务转交给上级，重置提醒计数并按超时配置重新计时。
 * 不做归属校验，由超时处理器以系统身份调用；上级解析失败时由调用方兜底。
 */
export async function systemTransferTaskToManager(
  task: typeof workflowTasks.$inferSelect,
  inst: typeof workflowInstances.$inferSelect,
  managerId: number,
  newTimeoutAt: Date | null,
  comment: string,
): Promise<void> {
  const [target] = await db.select({ nickname: users.nickname })
    .from(users).where(eq(users.id, managerId)).limit(1);
  const chain: number[] = Array.isArray(task.transferChain) ? task.transferChain : [];
  const nextChain = task.assigneeId ? [...new Set([...chain, task.assigneeId])] : chain;
  const [updated] = await db.update(workflowTasks)
    .set({
      assigneeId: managerId,
      comment,
      transferChain: nextChain,
      originalAssigneeId: task.originalAssigneeId ?? task.assigneeId ?? null,
    })
    .where(and(eq(workflowTasks.id, task.id), eq(workflowTasks.status, 'pending')))
    .returning();
  if (!updated) return;
  emitTaskEvent('task.transferred', mapTask(updated, target?.nickname ?? null), {
    definitionId: inst.definitionId,
    tenantId: inst.tenantId,
    actor: { userId: 0, name: 'system:timeout' },
    comment,
  });
}

/** 委派：与转办类似，但语义为"临时代办"，反馈后原 assignee 会接到回执确认任务 */
export async function delegateTask(taskId: number, targetUserId: number, comment?: string, attachments?: WorkflowTaskAttachment[]) {
  const { task, inst, actor } = await getOwnPendingTask(taskId);
  assertActionUploadRequirement(inst, task.nodeKey, 'delegate', attachments);
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
      attachments: attachments ?? null,
      transferChain: nextChain,
      originalAssigneeId: task.originalAssigneeId ?? task.assigneeId ?? null,
      delegatedFromId,
    })
    .where(and(eq(workflowTasks.id, task.id), eq(workflowTasks.status, 'pending')))
    .returning();
  if (!updated) throw new HTTPException(409, { message: '任务状态已变化，无法委派' });
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
  signMode?: 'and' | 'or',
  attachments?: WorkflowTaskAttachment[],
) {
  const { task, inst, actor } = await getOwnPendingTask(taskId);
  assertActionUploadRequirement(inst, task.nodeKey, 'addSign', attachments);
  if (targetUserIds.length === 0) throw new HTTPException(400, { message: '请选择加签人' });
  // 与现有同节点任务共用 approveMethod（保证完成判定一致）
  const [sibling] = await db.select().from(workflowTasks)
    .where(and(eq(workflowTasks.instanceId, inst.id), eq(workflowTasks.nodeKey, task.nodeKey)))
    .limit(1);
  // 并行加签可指定会签(and)/或签(or)模式，覆盖本节点完成判定；其余沿用同节点既有方式
  const overrideMethod = position === 'parallel' && signMode ? signMode : null;
  const approveMethod = overrideMethod ?? sibling?.approveMethod ?? 'and';
  const posLabelMap = { before: '前', after: '后', parallel: '并' } as const;
  const posLabel = posLabelMap[position];
  const modeLabel = overrideMethod ? (overrideMethod === 'or' ? '或签' : '会签') : '';
  const addSignSuffix = comment ? `：${comment}` : '';
  const addSignComment = `[加签-${posLabel}${modeLabel}] 由 ${actor.name ?? '系统'} 发起${addSignSuffix}`;

  const created = await db.transaction(async (tx) => {
    // 实例行级锁 + 锁内重校验：避免与并发审批（节点已完成/任务被跳过）竞态产生悬挂加签任务
    const [lockedInst] = await tx.select({ status: workflowInstances.status })
      .from(workflowInstances).where(eq(workflowInstances.id, inst.id)).for('update').limit(1);
    if (!lockedInst || lockedInst.status !== 'running') {
      throw new HTTPException(409, { message: '流程状态已变化，无法加签' });
    }
    const [freshTask] = await tx.select({ status: workflowTasks.status })
      .from(workflowTasks).where(eq(workflowTasks.id, task.id)).limit(1);
    if (!freshTask || freshTask.status !== 'pending') {
      throw new HTTPException(409, { message: '任务状态已变化，无法加签' });
    }
    // before：原任务先转为 waiting，加签任务为 pending；待加签人审批通过后由完成回调推进
    // after / parallel：原任务保持 pending，加签任务以 pending 与之并行（共享 approveMethod 判定完成）
    if (position === 'before') {
      await tx.update(workflowTasks).set({ status: 'waiting' }).where(eq(workflowTasks.id, task.id));
    }
    // 并行加签指定会签/或签时，同步本节点全部未结束任务的 approveMethod，保证完成判定一致
    if (overrideMethod) {
      await tx.update(workflowTasks).set({ approveMethod: overrideMethod })
        .where(and(
          eq(workflowTasks.instanceId, inst.id),
          eq(workflowTasks.nodeKey, task.nodeKey),
          inArray(workflowTasks.status, ['pending', 'waiting']),
        ));
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
        attachments: attachments ?? null,
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

  const result = await db.transaction(async (tx) => {
    // 实例行级锁：序列化与并发审批/驳回，确保减签后的节点完成判定与推进原子一致
    const [lockedInst] = await tx.select({ status: workflowInstances.status })
      .from(workflowInstances).where(eq(workflowInstances.id, inst.id)).for('update').limit(1);
    if (!lockedInst || lockedInst.status !== 'running') {
      throw new HTTPException(409, { message: '流程状态已变化，无法减签' });
    }
    const updated = await tx.update(workflowTasks).set({
      status: 'skipped',
      actionAt: new Date(),
      comment: reduceComment,
    }).where(and(
      inArray(workflowTasks.id, targetTaskIds),
      eq(workflowTasks.instanceId, inst.id),
      eq(workflowTasks.nodeKey, task.nodeKey),
      inArray(workflowTasks.status, ['pending', 'waiting']),
    )).returning();
    if (updated.length !== targetTaskIds.length) {
      throw new HTTPException(409, { message: '部分任务状态已变化，无法减签' });
    }
    // 复核节点完成状态（例如 ratio 比例会签减签后阈值已达成，需跳过余下任务并推进流程）
    const { completed } = await checkNodeCompletion(tx, inst.id, task.nodeKey, flowData);
    if (!completed || !flowData) {
      return { removed: updated, advanced: false, finished: false, rejected: false, row: inst, newTasks: [] as typeof workflowTasks.$inferSelect[] };
    }
    // 减签触发节点完成：推进流程（checkNodeCompletion 已跳过本节点剩余 pending/waiting 任务）
    const formData = (inst.formData ?? {}) as Record<string, unknown>;
    const starter = await buildStarterContext(inst.initiatorId, tx);
    const materialized = await advanceAndMaterialize({ kind: 'advanceNode', nodeKey: task.nodeKey }, {
      instanceId: inst.id,
      initiatorId: inst.initiatorId,
      executor: tx,
      flowData,
      formData,
      settings: flowData.settings,
      starter,
      tenantId: inst.tenantId,
    });
    if (materialized.rejected) {
      // 下游自动拒绝终止流程：清理实例其余未结束任务，保证 rejected 实例无残留待办
      await tx.update(workflowTasks).set({ status: 'skipped', actionAt: new Date() })
        .where(and(eq(workflowTasks.instanceId, inst.id), inArray(workflowTasks.status, ['pending', 'waiting'])));
      const [row] = await tx.update(workflowInstances).set({ status: 'rejected', currentNodeKey: null }).where(eq(workflowInstances.id, inst.id)).returning();
      return { removed: updated, advanced: true, finished: false, rejected: true, row, newTasks: materialized.createdTasks };
    }
    if (materialized.finished) {
      const [row] = await tx.update(workflowInstances).set({ status: 'approved', currentNodeKey: null }).where(eq(workflowInstances.id, inst.id)).returning();
      return { removed: updated, advanced: true, finished: true, rejected: false, row, newTasks: materialized.createdTasks };
    }
    const [row] = await tx.update(workflowInstances)
      .set({ currentNodeKey: materialized.currentNodeKeys[0] ?? null })
      .where(eq(workflowInstances.id, inst.id))
      .returning();
    return { removed: updated, advanced: true, finished: false, rejected: false, row, newTasks: materialized.createdTasks };
  });

  const { removed, row: instRow } = result;
  const meta = { definitionId: inst.definitionId, tenantId: inst.tenantId, actor };
  for (const t of removed) {
    emitTaskEvent('task.skipped', mapTask(t), meta);
    emitTaskEvent('task.reduceSigned', mapTask(t), { ...meta, comment: reduceComment });
  }
  if (result.advanced) {
    emitNodeEvent('node.left', { instanceId: inst.id, ...meta, nodeKey: task.nodeKey, nodeName: task.nodeName, nodeType: task.nodeType });
    for (const t of result.newTasks) {
      emitNodeEvent('node.entered', { instanceId: inst.id, ...meta, nodeKey: t.nodeKey, nodeName: t.nodeName, nodeType: t.nodeType });
      emitTaskEvent('task.created', mapTask(t), meta);
      if (t.assigneeId && t.status === 'pending') emitTaskEvent('task.assigned', mapTask(t), meta);
    }
    if (result.finished) emitInstanceEvent('instance.approved', mapInstance(instRow), actor);
    if (result.rejected) emitInstanceEvent('instance.rejected', mapInstance(instRow), actor);
  }
  const advanceNote = result.finished ? '，流程已完成' : (result.advanced ? '，流程已推进' : '');
  return { removed: removed.map((t) => mapTask(t)), message: `已减签 ${removed.length} 人${advanceNote}` };
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
  const tc = tenantCondition(workflowInstances, user);
  const instConditions = [eq(workflowInstances.id, task.instanceId)];
  if (tc) instConditions.push(tc);
  const [inst] = await db.select().from(workflowInstances)
    .where(and(...instConditions)).limit(1);
  if (!inst) throw new HTTPException(404, { message: '任务不存在或无权操作' });
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
  const tc = tenantCondition(workflowInstances, user);
  const conditions = [eq(workflowInstances.id, instanceId)];
  if (tc) conditions.push(tc);
  const [inst] = await db.select().from(workflowInstances)
    .where(and(...conditions)).limit(1);
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
  const tc = tenantCondition(workflowInstances, user);
  const conditions = [eq(workflowInstances.id, instanceId)];
  if (tc) conditions.push(tc);
  const [inst] = await db.select().from(workflowInstances)
    .where(and(...conditions)).limit(1);
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
export async function returnTask(taskId: number, targetNodeKeys: string[], comment: string, attachments?: WorkflowTaskAttachment[]) {
  const { task, inst, actor } = await getOwnPendingTask(taskId);
  assertActionUploadRequirement(inst, task.nodeKey, 'return', attachments);
  const flowData = (inst.definitionSnapshot as { flowData?: WorkflowFlowData } | null)?.flowData;
  if (!flowData) throw new HTTPException(500, { message: '流程快照数据异常' });
  if (!Array.isArray(targetNodeKeys) || targetNodeKeys.length === 0) {
    throw new HTTPException(400, { message: '请选择退回节点' });
  }
  const ancestorKeys = getAncestorNodeKeys(flowData, task.nodeKey);
  const approvedRows = await db.select({ nodeKey: workflowTasks.nodeKey }).from(workflowTasks)
    .where(and(
      eq(workflowTasks.instanceId, inst.id),
      inArray(workflowTasks.status, ['approved']),
    ));
  const approvedNodeKeys = new Set(approvedRows.map((row) => row.nodeKey));
  const uniqueKeys = Array.from(new Set(targetNodeKeys));
  const targets = uniqueKeys.map((k) => {
    const n = flowData.nodes.find((nd) => nd.data.key === k);
    if (!n) throw new HTTPException(400, { message: `退回目标节点不存在：${k}` });
    if (n.data.type !== 'approve' && n.data.type !== 'handler') {
      throw new HTTPException(400, { message: '只能退回到审批/办理节点' });
    }
    if (!ancestorKeys.has(k) || !approvedNodeKeys.has(k)) {
      throw new HTTPException(400, { message: '只能退回到当前节点之前已通过的审批/办理节点' });
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
  return rejectTaskCore(task, instOverridden, mergedComment, actor, attachments);
}

// ─── 草稿 / 提交 / 重新提交 ──────────────────────────────────────────────────
async function loadOwnDraft(id: number) {
  const user = currentUser();
  const tc = tenantCondition(workflowInstances, user);
  const conds = [eq(workflowInstances.id, id)];
  if (tc) conds.push(tc);
  const [inst] = await db.select().from(workflowInstances).where(and(...conds)).limit(1);
  if (!inst) throw new HTTPException(404, { message: '流程实例不存在' });
  if (inst.initiatorId !== user.userId) throw new HTTPException(403, { message: '只能操作自己的草稿' });
  return inst;
}

export async function updateInstanceDraft(id: number, input: { title?: string; formData?: Record<string, unknown> | null; priority?: import('@zenith/shared').WorkflowInstancePriority }) {
  const inst = await loadOwnDraft(id);
  if (inst.status !== 'draft') throw new HTTPException(400, { message: '仅草稿可编辑' });
  const patch: Partial<typeof workflowInstances.$inferInsert> = {};
  if (input.title !== undefined) patch.title = input.title;
  if (input.formData !== undefined) patch.formData = input.formData ?? {};
  if (input.priority !== undefined) patch.priority = input.priority;
  const [row] = await db.update(workflowInstances).set(patch).where(eq(workflowInstances.id, id)).returning();
  return mapInstance(row);
}

export async function submitDraftInstance(id: number, input: { selectedInitiatorApprovers?: SelectedApproverMap } = {}) {
  const user = currentUser();
  const inst = await loadOwnDraft(id);
  if (inst.status !== 'draft') throw new HTTPException(400, { message: '仅草稿可提交' });
  const [def] = await db.select().from(workflowDefinitions)
    .where(and(eq(workflowDefinitions.id, inst.definitionId), eq(workflowDefinitions.status, 'published'))).limit(1);
  if (!def) throw new HTTPException(400, { message: '流程定义不存在或已停用，无法提交' });
  const baseFlowData = def.flowData as WorkflowFlowData;
  if (!baseFlowData?.nodes?.length) throw new HTTPException(400, { message: '流程定义无效' });
  const flowData = await applyInitiatorSelectedApprovers(baseFlowData, input.selectedInitiatorApprovers);
  const definitionSnapshot = { ...def, flowData };
  const validation = validateFlowData(flowData);
  if (!validation.valid) throw new HTTPException(400, { message: validation.errors[0] });
  const formData = sanitizeFormByStartPerms(flowData, (inst.formData ?? {}) as Record<string, unknown>);
  assertLaunchMatchesFormType(def, { bizType: inst.bizType, bizId: inst.bizId });
  const resolvedFormSnapshot = await resolveFormSnapshot(def.formId);
  const formSnapshot = buildInstanceFormSnapshot(def, resolvedFormSnapshot);
  const starter = await buildStarterContext(user.userId);
  if (!hasExecutableEntry(flowData, formData, starter)) {
    throw new HTTPException(400, { message: '流程定义中无可执行节点' });
  }
  const serialConfig = flowData.settings?.serialNo;
  const instance = await db.transaction(async (tx) => {
    const serialNo = await generateSerialNo(tx, def.id, serialConfig);
    await tx.update(workflowInstances).set({
      definitionSnapshot,
      formSnapshot,
      serialNo,
      status: 'running',
      currentNodeKey: null,
    }).where(eq(workflowInstances.id, id));
    const materialized = await advanceAndMaterialize({ kind: 'seed' }, {
      instanceId: id,
      initiatorId: user.userId,
      executor: tx,
      flowData,
      formData,
      settings: flowData.settings,
      starter,
      tenantId: inst.tenantId,
    });
    const [updatedInstance] = await tx.update(workflowInstances).set({
      status: materialized.rejected ? 'rejected' : (materialized.finished ? 'approved' : 'running'),
      currentNodeKey: materialized.rejected || materialized.finished ? null : materialized.currentNodeKeys[0] ?? null,
    }).where(eq(workflowInstances.id, id)).returning();
    await emitInstanceStartEvents(mapInstance(updatedInstance), updatedInstance, materialized.createdTasks, { userId: user.userId, name: user.username }, tx);
    return updatedInstance;
  });
  return mapInstance(instance);
}

/** 重新提交：将已驳回/已撤回的实例克隆为一份新草稿，供发起人编辑后再次提交 */
export async function resubmitInstance(id: number) {
  const user = currentUser();
  const tc = tenantCondition(workflowInstances, user);
  const conds = [eq(workflowInstances.id, id)];
  if (tc) conds.push(tc);
  const [inst] = await db.select().from(workflowInstances).where(and(...conds)).limit(1);
  if (!inst) throw new HTTPException(404, { message: '流程实例不存在' });
  if (inst.initiatorId !== user.userId) throw new HTTPException(403, { message: '只有发起人可以重新提交' });
  if (inst.status !== 'rejected' && inst.status !== 'withdrawn') {
    throw new HTTPException(400, { message: '只有已驳回或已撤回的申请可重新提交' });
  }
  const resubmitSettings = (inst.definitionSnapshot as { flowData?: WorkflowFlowData } | null)?.flowData?.settings;
  if (resubmitSettings?.allowResubmit === false) {
    throw new HTTPException(400, { message: '该流程不允许重新提交' });
  }
  if (inst.bizType && inst.bizId) {
    throw new HTTPException(400, { message: '业务系统主导流程请在对应业务模块中重新提交' });
  }
  return createInstance({
    definitionId: inst.definitionId,
    title: inst.title,
    formData: (inst.formData ?? {}) as Record<string, unknown>,
    asDraft: true,
  });
}

// ─── 批量审批 ────────────────────────────────────────────────────────────────
export async function batchApproveTasks(taskIds: number[], comment?: string): Promise<WorkflowBatchActionResult[]> {
  const results: WorkflowBatchActionResult[] = [];
  for (const taskId of taskIds) {
    try {
      await approveTask(taskId, comment);
      results.push({ taskId, success: true });
    } catch (err) {
      results.push({ taskId, success: false, message: err instanceof HTTPException ? err.message : '处理失败' });
    }
  }
  return results;
}

export async function batchRejectTasks(taskIds: number[], comment: string): Promise<WorkflowBatchActionResult[]> {
  const results: WorkflowBatchActionResult[] = [];
  for (const taskId of taskIds) {
    try {
      await rejectTask(taskId, comment);
      results.push({ taskId, success: true });
    } catch (err) {
      results.push({ taskId, success: false, message: err instanceof HTTPException ? err.message : '处理失败' });
    }
  }
  return results;
}

// ─── G8 跨实例批量撤回 / 批量催办 ──────────────────────────────────────────────
export async function batchWithdrawInstances(instanceIds: number[], _comment?: string): Promise<import('@zenith/shared').WorkflowInstanceBatchActionResult[]> {
  const results: import('@zenith/shared').WorkflowInstanceBatchActionResult[] = [];
  for (const instanceId of instanceIds) {
    try {
      await withdrawInstance(instanceId);
      results.push({ instanceId, success: true });
    } catch (err) {
      results.push({ instanceId, success: false, message: err instanceof HTTPException ? err.message : '撤回失败' });
    }
  }
  return results;
}

export async function batchUrgeInstances(instanceIds: number[], message?: string): Promise<import('@zenith/shared').WorkflowInstanceBatchActionResult[]> {
  const results: import('@zenith/shared').WorkflowInstanceBatchActionResult[] = [];
  for (const instanceId of instanceIds) {
    try {
      const r = await urgeInstance(instanceId, message);
      results.push({ instanceId, success: true, message: r.message });
    } catch (err) {
      results.push({ instanceId, success: false, message: err instanceof HTTPException ? err.message : '催办失败' });
    }
  }
  return results;
}

// ─── 管理员强制操作 ──────────────────────────────────────────────────────────
/** 强制跳转：终止当前活动任务，直接推进到指定审批/办理节点 */
export async function jumpInstance(id: number, targetNodeKey: string, comment?: string) {
  const user = currentUser();
  const tc = tenantCondition(workflowInstances, user);
  const conds = [eq(workflowInstances.id, id)];
  if (tc) conds.push(tc);
  const [inst] = await db.select().from(workflowInstances).where(and(...conds)).limit(1);
  if (!inst) throw new HTTPException(404, { message: '流程实例不存在' });
  if (inst.status !== 'running') throw new HTTPException(400, { message: '仅审批中的流程可强制跳转' });
  const snapshot = inst.definitionSnapshot as { flowData?: WorkflowFlowData } | null;
  const flowData = snapshot?.flowData;
  if (!flowData?.nodes?.length) throw new HTTPException(400, { message: '流程数据异常' });
  const targetNode = flowData.nodes.find((n) => n.data.key === targetNodeKey);
  if (!targetNode) throw new HTTPException(400, { message: '目标节点不存在' });
  if (targetNode.data.type !== 'approve' && targetNode.data.type !== 'handler') {
    throw new HTTPException(400, { message: '只能强制跳转到审批/办理节点' });
  }
  const formData = (inst.formData ?? {}) as Record<string, unknown>;
  const starter = await buildStarterContext(inst.initiatorId);
  const note = `[管理员强制跳转至「${targetNode.data.label}」]${comment ? ' ' + comment : ''}`;
  const instance = await db.transaction(async (tx) => {
    const [locked] = await tx.select({ status: workflowInstances.status })
      .from(workflowInstances).where(eq(workflowInstances.id, id)).for('update').limit(1);
    if (!locked || locked.status !== 'running') {
      throw new HTTPException(409, { message: '流程状态已变化，无法跳转' });
    }
    await tx.update(workflowTasks).set({ status: 'skipped', actionAt: new Date(), comment: note })
      .where(and(eq(workflowTasks.instanceId, id), inArray(workflowTasks.status, ['pending', 'waiting'])));
    await killInstanceTokens(tx, id);
    const materialized = await advanceAndMaterialize({ kind: 'enterNode', nodeKey: targetNode.data.key }, {
      instanceId: id,
      initiatorId: inst.initiatorId,
      executor: tx,
      flowData,
      formData,
      settings: flowData.settings,
      starter,
      tenantId: inst.tenantId,
    });
    const [updatedInstance] = await tx.update(workflowInstances).set({
      status: materialized.rejected ? 'rejected' : (materialized.finished ? 'approved' : 'running'),
      currentNodeKey: materialized.rejected || materialized.finished ? null : (materialized.currentNodeKeys[0] ?? targetNode.data.key),
    }).where(eq(workflowInstances.id, id)).returning();
    await emitInstanceStartEvents(mapInstance(updatedInstance), updatedInstance, materialized.createdTasks, { userId: user.userId, name: user.username }, tx);
    return updatedInstance;
  });
  return mapInstance(instance);
}

/** 管理员改派：将未处理任务的处理人替换为指定用户 */
export async function reassignTask(taskId: number, targetUserId: number, comment?: string) {
  const user = currentUser();
  const [task] = await db.select().from(workflowTasks).where(eq(workflowTasks.id, taskId)).limit(1);
  if (!task) throw new HTTPException(404, { message: '任务不存在' });
  if (task.status !== 'pending' && task.status !== 'waiting') {
    throw new HTTPException(400, { message: '仅未处理的任务可改派' });
  }
  const [tgt] = await db.select({ id: users.id }).from(users).where(eq(users.id, targetUserId)).limit(1);
  if (!tgt) throw new HTTPException(400, { message: '目标处理人不存在' });
  const tc = tenantCondition(workflowInstances, user);
  const instConditions = [eq(workflowInstances.id, task.instanceId)];
  if (tc) instConditions.push(tc);
  const [inst] = await db.select().from(workflowInstances).where(and(...instConditions)).limit(1);
  if (!inst) throw new HTTPException(404, { message: '任务不存在或无权操作' });
  const chain = Array.isArray(task.transferChain) ? task.transferChain : [];
  const note = `[管理员改派]${comment ? ' ' + comment : ''}`;
  const [updated] = await db.update(workflowTasks).set({
    assigneeId: targetUserId,
    delegatedFromId: null,
    transferChain: [...new Set([...chain, task.assigneeId].filter((v): v is number => v != null))],
    comment: note,
  }).where(and(eq(workflowTasks.id, taskId), inArray(workflowTasks.status, ['pending', 'waiting']))).returning();
  if (!updated) throw new HTTPException(409, { message: '任务状态已变化，无法改派' });
  const actor = { userId: user.userId, name: user.username };
  emitTaskEvent('task.transferred', mapTask(updated), { definitionId: inst.definitionId, tenantId: inst.tenantId, actor });
  return mapTask(updated);
}

// ─── 撤回已办（T3-7）──────────────────────────────────────────────────────────
/** 审批人撤回刚做的通过/驳回：要求后续节点均未被处理，流程仍可回退 */
export async function recallTask(taskId: number, comment?: string) {
  const user = currentUser();
  const [task] = await db.select().from(workflowTasks).where(eq(workflowTasks.id, taskId)).limit(1);
  if (!task) throw new HTTPException(404, { message: '任务不存在' });
  if (task.assigneeId !== user.userId) throw new HTTPException(403, { message: '只能撤回自己处理的任务' });
  if (task.status !== 'approved' && task.status !== 'rejected') {
    throw new HTTPException(400, { message: '只有已处理的任务可撤回' });
  }
  const tc = tenantCondition(workflowInstances, user);
  const instConditions = [eq(workflowInstances.id, task.instanceId)];
  if (tc) instConditions.push(tc);
  const [inst] = await db.select().from(workflowInstances).where(and(...instConditions)).limit(1);
  if (!inst) throw new HTTPException(404, { message: '任务不存在或无权操作' });
  if (inst.status === 'withdrawn' || inst.status === 'cancelled' || inst.status === 'approved' || inst.status === 'rejected') {
    throw new HTTPException(400, { message: '流程已结束，无法撤回' });
  }
  // 本任务之后创建的任务：若已有被处理（approved/rejected）的，则不允许撤回
  const laterTasks = await db.select().from(workflowTasks)
    .where(and(eq(workflowTasks.instanceId, task.instanceId), gt(workflowTasks.id, task.id)));
  const actionedLater = laterTasks.filter((t) => t.status === 'approved' || t.status === 'rejected');
  if (actionedLater.length > 0) {
    throw new HTTPException(400, { message: '后续节点已被处理，无法撤回' });
  }

  const reopened = await db.transaction(async (tx) => {
    // 实例行级锁 + 锁内重校验：防止与并发审批/驳回竞态（撤回时后续任务正被处理）
    const [lockedInst] = await tx.select({ status: workflowInstances.status })
      .from(workflowInstances).where(eq(workflowInstances.id, task.instanceId)).for('update').limit(1);
    if (!lockedInst || lockedInst.status === 'withdrawn' || lockedInst.status === 'cancelled' || lockedInst.status === 'approved' || lockedInst.status === 'rejected') {
      throw new HTTPException(400, { message: '流程已结束，无法撤回' });
    }
    const [freshTask] = await tx.select().from(workflowTasks).where(eq(workflowTasks.id, task.id)).limit(1);
    if (!freshTask || (freshTask.status !== 'approved' && freshTask.status !== 'rejected')) {
      throw new HTTPException(409, { message: '任务状态已变化，无法撤回' });
    }
    const laterInTx = await tx.select().from(workflowTasks)
      .where(and(eq(workflowTasks.instanceId, task.instanceId), gt(workflowTasks.id, task.id)));
    if (laterInTx.some((t) => t.status === 'approved' || t.status === 'rejected')) {
      throw new HTTPException(400, { message: '后续节点已被处理，无法撤回' });
    }
    if (laterInTx.length > 0) {
      await tx.delete(workflowTasks).where(and(eq(workflowTasks.instanceId, task.instanceId), gt(workflowTasks.id, task.id)));
    }
    const [row] = await tx.update(workflowTasks).set({
      status: 'pending',
      comment: comment ? `[撤回重审] ${comment}` : null,
      signature: null,
      actionAt: null,
    }).where(eq(workflowTasks.id, task.id)).returning();
    await tx.update(workflowInstances).set({ status: 'running', currentNodeKey: task.nodeKey }).where(eq(workflowInstances.id, task.instanceId));
    // Token 一致性：撤回重审清场后，在被重开节点重建单一 active token（后续路径 token 已随删除/清场失效）
    await killInstanceTokens(tx, task.instanceId);
    await tx.insert(workflowTokens).values({
      instanceId: task.instanceId,
      nodeKey: task.nodeKey,
      status: 'active',
      branchPath: [],
      parentTokenId: null,
      tenantId: inst.tenantId,
    });
    return row;
  });

  const actor = { userId: user.userId, name: user.username };
  const meta = { definitionId: inst.definitionId, tenantId: inst.tenantId, actor };
  emitTaskEvent('task.created', mapTask(reopened), meta);
  if (reopened.assigneeId) emitTaskEvent('task.assigned', mapTask(reopened), meta);
  return getInstanceDetail(task.instanceId);
}

// ─── Token 运营恢复操作（admin，需 workflow:instance:monitor + 审计）─────────────

/** 加载指定 Token 及其所属实例（含租户校验），供运营恢复操作复用 */
async function loadTokenForOps(tokenId: number) {
  const user = currentUser();
  const [tok] = await db.select().from(workflowTokens).where(eq(workflowTokens.id, tokenId)).limit(1);
  if (!tok) throw new HTTPException(404, { message: '执行 Token 不存在' });
  const tc = tenantCondition(workflowInstances, user);
  const conds = [eq(workflowInstances.id, tok.instanceId)];
  if (tc) conds.push(tc);
  const [inst] = await db.select().from(workflowInstances).where(and(...conds)).limit(1);
  if (!inst) throw new HTTPException(404, { message: '实例不存在或无权操作' });
  return { user, tok, inst };
}

/**
 * 跳过卡死的执行 Token：消费该 Token、跳过其节点未结束任务，并从该节点推进流程。
 * 用于等待节点（trigger / subProcess / external）派发失败卡死等场景的外科式修复。
 */
export async function skipStuckToken(tokenId: number, reason?: string) {
  const { user, tok, inst } = await loadTokenForOps(tokenId);
  if (tok.status !== 'active') throw new HTTPException(400, { message: '仅活动 Token 可跳过' });
  if (inst.status !== 'running') throw new HTTPException(400, { message: '仅运行中实例可操作' });
  const flowData = (inst.definitionSnapshot as { flowData?: WorkflowFlowData } | null)?.flowData;
  if (!flowData) throw new HTTPException(500, { message: '流程快照数据异常' });
  const nodeCfg = flowData.nodes.find((n) => n.data.key === tok.nodeKey)?.data;
  const nodeName = nodeCfg?.label ?? tok.nodeKey;
  const note = `[运营·跳过卡死 Token #${tokenId}]${reason ? ' ' + reason : ''}`;

  const result = await db.transaction(async (tx) => {
    const [locked] = await tx.select({ status: workflowInstances.status }).from(workflowInstances).where(eq(workflowInstances.id, inst.id)).for('update').limit(1);
    if (!locked || locked.status !== 'running') throw new HTTPException(409, { message: '实例状态已变化，请刷新后重试' });
    await tx.update(workflowTasks).set({ status: 'skipped', actionAt: new Date(), comment: note })
      .where(and(eq(workflowTasks.instanceId, inst.id), eq(workflowTasks.nodeKey, tok.nodeKey), inArray(workflowTasks.status, ['pending', 'waiting'])));
    const formData = (inst.formData ?? {}) as Record<string, unknown>;
    const starter = await buildStarterContext(inst.initiatorId, tx);
    const materialized = await advanceAndMaterialize({ kind: 'advanceNode', nodeKey: tok.nodeKey }, {
      instanceId: inst.id, initiatorId: inst.initiatorId, executor: tx, flowData, formData, settings: flowData.settings, starter, tenantId: inst.tenantId,
    });
    let status: 'running' | 'approved' | 'rejected' = 'running';
    if (materialized.rejected) {
      status = 'rejected';
      await tx.update(workflowTasks).set({ status: 'skipped', actionAt: new Date() })
        .where(and(eq(workflowTasks.instanceId, inst.id), inArray(workflowTasks.status, ['pending', 'waiting'])));
    } else if (materialized.finished) {
      status = 'approved';
    }
    const [row] = await tx.update(workflowInstances).set({
      status, currentNodeKey: status === 'running' ? (materialized.currentNodeKeys[0] ?? null) : null,
    }).where(eq(workflowInstances.id, inst.id)).returning();
    return { row, newTasks: materialized.createdTasks, status };
  });

  const actor = { userId: user.userId, name: user.username };
  const meta = { definitionId: result.row.definitionId, tenantId: result.row.tenantId, actor };
  emitNodeEvent('node.left', { instanceId: result.row.id, ...meta, nodeKey: tok.nodeKey, nodeName, nodeType: nodeCfg?.type ?? null });
  for (const t of result.newTasks) {
    emitNodeEvent('node.entered', { instanceId: result.row.id, ...meta, nodeKey: t.nodeKey, nodeName: t.nodeName, nodeType: t.nodeType });
    emitTaskEvent('task.created', mapTask(t), meta);
    if (t.assigneeId && t.status === 'pending') emitTaskEvent('task.assigned', mapTask(t), meta);
  }
  if (result.status === 'approved') emitInstanceEvent('instance.approved', mapInstance(result.row), actor);
  if (result.status === 'rejected') emitInstanceEvent('instance.rejected', mapInstance(result.row), actor);
  return getInstanceDetail(inst.id);
}

/**
 * 从指定 Token 的节点重放流程：清场全部活动 Token + 在该节点重建执行路径
 * （等价强制跳转到该 Token 所在节点，支持从历史/已消费 Token 处重跑；目标须为审批/办理节点）。
 */
export async function replayFromToken(tokenId: number, reason?: string) {
  const { tok, inst } = await loadTokenForOps(tokenId);
  if (inst.status !== 'running') throw new HTTPException(400, { message: '仅运行中实例可重放' });
  return jumpInstance(inst.id, tok.nodeKey, `[运营·从 Token #${tokenId} 重放]${reason ? ' ' + reason : ''}`);
}

const BATCH_RECOVERY_CAP = 200;

/**
 * 批量推进卡在指定节点的运行中实例：找出该流程定义下停在 nodeKey 的活动 Token，逐个 skipStuckToken 推进。
 * 用于某节点配置错误 / 外部派发失败导致多实例集体卡死时的批量外科恢复（按候选逐个隔离，单个失败不影响其它）。
 */
export async function batchSkipStuckTokens(input: { definitionId: number; nodeKey: string; olderThanMinutes?: number; reason?: string }): Promise<WorkflowRecoveryBatchResult> {
  const user = currentUser();
  const tc = tenantCondition(workflowInstances, user);
  const conds = [
    eq(workflowTokens.status, 'active'),
    eq(workflowTokens.nodeKey, input.nodeKey),
    eq(workflowInstances.status, 'running'),
    eq(workflowInstances.definitionId, input.definitionId),
  ];
  if (tc) conds.push(tc);
  if (input.olderThanMinutes && input.olderThanMinutes > 0) {
    conds.push(lte(workflowTokens.createdAt, new Date(Date.now() - input.olderThanMinutes * 60_000)));
  }
  const rows = await db.select({ tokenId: workflowTokens.id })
    .from(workflowTokens)
    .innerJoin(workflowInstances, eq(workflowTokens.instanceId, workflowInstances.id))
    .where(and(...conds))
    .orderBy(asc(workflowTokens.id))
    .limit(BATCH_RECOVERY_CAP);
  let success = 0;
  let failed = 0;
  for (const r of rows) {
    try {
      await skipStuckToken(r.tokenId, input.reason ?? '批量推进卡死实例');
      success += 1;
    } catch (err) {
      failed += 1;
      logger.warn('[workflow-recovery] 批量跳过卡死 Token 失败', { tokenId: r.tokenId, err });
    }
  }
  return { total: rows.length, success, failed };
}

/** 导出实例诊断包（诊断 + 轨迹 + 执行 Token），供离线分析 / 工单留档 */
export async function exportInstanceDiagnosticBundle(instanceId: number) {
  const [diagnostics, trace, tokens] = await Promise.all([
    getInstanceRuntimeDiagnostics(instanceId),
    getInstanceTrace(instanceId),
    getInstanceExecutionTokens(instanceId),
  ]);
  return { instanceId, generatedAt: formatDateTime(new Date()), diagnostics, trace, tokens };
}
