import { cancelMockApprovalActivations, createMockActivation, getMockApprovalActivations, resetMockApprovalInstance, settleMockApprovalSeat, synchronizeMockApprovalTaskRefs, transferMockApprovalSeat } from '@/mocks/utils/workflow-approval';
import { bindMockWorkflowAttachments, bindMockWorkflowFormAttachments } from '@/mocks/utils/workflow-attachments';
import { mock, MockHttpError } from '@/mocks/utils/contract';
import { mockTaskWorkflowContext, resolveMockTaskSignature, resolveMockWorkflowFormSignatures } from '@/mocks/utils/workflow-signature';
import { syncMockWorkflowBusinessResult } from '@/mocks/utils/workflow-business';
import { removeByIds, requireItem } from '@/mocks/utils/crud';
import { badRequest, forbidden, notFound } from '@/mocks/utils/handlers';
import { resolveIdempotent } from '@/mocks/utils/idempotency';
import {
  workflowDefinitionContract,
  workflowDelegationContract,
  workflowInstanceContract,
  workflowInstanceOpsContract,
  workflowQuickPhraseContract,
  workflowSavedViewContract,
  workflowScheduleContract,
  workflowTaskContract,
  workflowTemplateContract,
  clearWorkflowFormSignaturesData,
  computeWorkflowDerivedValues,
  planWorkflowPath,
  workflowTaskActivationKey,
  workflowTaskActivationRounds,
  type WorkflowAnalytics,
  type WorkflowApproverPreviewNode,
  type WorkflowBatchActionResponse,
  type WorkflowComment,
  type WorkflowCompensation,
  type WorkflowCompensationDetail,
  type WorkflowCompensationLog,
  type WorkflowDefinition,
  type WorkflowDelegation,
  type WorkflowFlowData,
  type WorkflowFormField,
  type WorkflowInstance,
  type WorkflowHandledInstanceItem,
  type WorkflowInstanceStatus,
  type WorkflowInstanceMigration,
  type WorkflowOverdueTask,
  type WorkflowQuickPhrase,
  type WorkflowSavedView,
  type WorkflowSchedule,
  type WorkflowScheduleRunDetail,
  type WorkflowTask,
  type WorkflowTaskConsult,
  type WorkflowTemplate,
  type WorkflowVersionDiffSide,
  type WorkflowVersionEdgeChange,
  type WorkflowVersionNodeChange,
} from '@zenith/shared/workflow';
import { SEED_WORKFLOW_TEMPLATES } from '@zenith/shared/seed';
import { advanceMockWorkflowGraph, applyMockInitiatorSelections, buildMockApprovalTasks, getNextTaskId, mockWorkflowInstances, mockWorkflowTasks, mockWorkflowDefinitions, getNextInstanceId, getNextDefinitionId, mockWorkflowSelectionCandidates, mockWorkflowStarter, resetMockWorkflowGraph, resolveMockWorkflowAssignees } from '@/mocks/data/workflow';
import { mockUsers } from '@/mocks/data/users';
import { mockDateTime } from '@/mocks/utils/date';
import { filterByKeyword } from '@/mocks/utils/filter';
import { mockResource } from '@/mocks/utils/resource';
import { getNextWorkflowFormId, mockWorkflowForms } from '@/mocks/data/workflow-forms';
import { currentMockSession } from '@/mocks/utils/auth';

/** 批量审批的幂等缓存：同一 X-Idempotency-Key 重复提交时原样回放首次结果 */
const batchActionCache = new Map<string, { data: WorkflowBatchActionResponse; message: string }>();

const mockInstanceMigrations: WorkflowInstanceMigration[] = [];

// ── 内存态数据 ──
const mockComments: WorkflowComment[] = [];
let nextCommentId = 1;

const mockQuickPhrases: WorkflowQuickPhrase[] = [
  { id: 1, userId: null, content: '同意，请继续推进。', sort: 0, createdAt: mockDateTime(), updatedAt: mockDateTime() },
  { id: 2, userId: null, content: '情况属实，予以通过。', sort: 1, createdAt: mockDateTime(), updatedAt: mockDateTime() },
  { id: 3, userId: null, content: '材料不齐，请补充后再提交。', sort: 2, createdAt: mockDateTime(), updatedAt: mockDateTime() },
];
let nextPhraseId = 100;

const mockDelegations: WorkflowDelegation[] = [];

const mockTemplates: WorkflowTemplate[] = SEED_WORKFLOW_TEMPLATES.map((t) => ({
  id: t.id,
  name: t.name,
  code: t.code,
  description: t.description,
  categoryName: t.categoryName,
  icon: t.icon,
  color: t.color,
  // seed 模板的 flowData / formSchema 是未收窄的 JSON 字面量，按契约实体类型使用
  flowData: t.flowData as unknown as WorkflowTemplate['flowData'],
  formSchema: t.formSchema as unknown as WorkflowTemplate['formSchema'],
  sort: t.sort,
  builtin: t.builtin,
  createdAt: t.createdAt,
  updatedAt: t.updatedAt,
}));
let nextTemplateId = 100;

const mockConsults: WorkflowTaskConsult[] = [];
let nextConsultId = 1;

function getMockUserName(userId: number | null | undefined): string | null {
  if (userId == null) return null;
  const user = mockUsers.find((item) => item.id === userId);
  return user?.nickname ?? user?.username ?? `用户#${userId}`;
}

function getMockDefinitionName(definitionId: number | null | undefined): string | null {
  if (definitionId == null) return null;
  return mockWorkflowDefinitions.find((item) => item.id === definitionId)?.name ?? `流程#${definitionId}`;
}

function prepareExtraApprovalState(inst: WorkflowInstance): void {
  const tasks = mockWorkflowTasks.filter(task => task.instanceId === inst.id);
  if (synchronizeMockApprovalTaskRefs(inst.id, tasks)) return;
  resetMockApprovalInstance(inst.id);
  const groups = new Map<string, WorkflowTask[]>();
  for (const task of tasks) if ((task.nodeType === 'approve' || task.nodeType === 'handler') && task.taskKind !== 'suggestion' && task.signPosition == null) {
    const key = task.nodeKey+':'+(task.activationId ?? 'legacy'), rows = groups.get(key) ?? []; rows.push(task); groups.set(key, rows);
  }
  for (const rows of groups.values()) {
    const first = rows[0], config = mockTaskWorkflowContext(first).node ?? { key: first.nodeKey, label: first.nodeName, type: first.nodeType === 'handler' ? 'handler' as const : 'approve' as const };
    createMockActivation(inst, config, rows, { now: first.createdAt });
  }
}
function extraApprovalView(inst: WorkflowInstance): WorkflowInstance {
  prepareExtraApprovalState(inst);
  return { ...inst, tasks: mockWorkflowTasks.filter(task => task.instanceId === inst.id), approvalActivations: getMockApprovalActivations(inst.id) };
}
function cleanupExtraApprovalWork(inst: WorkflowInstance, now: string, reason: string): void {
  prepareExtraApprovalState(inst); cancelMockApprovalActivations(inst.id, now, reason);
  for (const task of mockWorkflowTasks) if (task.instanceId === inst.id && (task.status === 'pending' || task.status === 'waiting')) {
    task.status = 'skipped'; task.waitReason = null; task.actionAt = now; task.comment = reason;
  }
}
function syncInstanceApprovedIfComplete(instanceId: number, now: string) {
  const inst = mockWorkflowInstances.find(item => item.id === instanceId);
  if (!inst || inst.status !== 'running') return;
  advanceMockWorkflowGraph(inst, now); syncMockWorkflowBusinessResult(inst);
}
function settleExtraTask(task: WorkflowTask, decision: 'approved' | 'rejected', now: string, comment?: string) {
  const inst = requireItem(mockWorkflowInstances, task.instanceId, '流程实例不存在');
  prepareExtraApprovalState(inst);
  if (inst.status !== 'running') throw new Error('流程不在运行中');
  const suggestion = task.taskKind === 'suggestion';
  const receipt: WorkflowTask | undefined = suggestion ? { ...task, id: getNextTaskId(), assigneeId: task.delegatedFromId ?? task.originalAssigneeId ?? null,
    assigneeName: getMockUserName(task.delegatedFromId), taskKind: 'approval', status: 'pending', waitReason: null, activatedAt: null,
    comment: '[委派回执] '+(decision === 'approved' ? '建议同意' : '建议拒绝')+'：'+(comment ?? ''),
    delegatedFromId: null, delegationMode: null, signature: null, signatureEvidence: null, attachments: [], decision: null, actionAt: null, createdAt: now } : undefined;
  const result = settleMockApprovalSeat(task, decision, { now, receiptTask: receipt });
  task.comment = comment ?? null; task.decision = { action: decision === 'rejected' ? 'reject' : task.nodeType === 'handler' ? 'complete' : 'approve', targetNodeKey: null, targetNodeName: null };
  if (receipt) mockWorkflowTasks.push(receipt);
  if (!suggestion && result.failed) {
    const returned = mockTaskWorkflowContext(task).node?.rejectStrategy === 'returnStart';
    cleanupExtraApprovalWork(inst, now, returned ? '[退回发起人] 未办审批作废' : '[流程驳回] 未办审批作废');
    inst.status = returned ? 'returned' : 'rejected'; inst.currentNodeKey = null; inst.updatedAt = now;
    if (returned) task.decision = { action: 'returnInitiator', targetNodeKey: null, targetNodeName: null };
  } else if (!suggestion && result.completed) syncInstanceApprovedIfComplete(inst.id, now);
  syncMockWorkflowBusinessResult(inst); return result;
}

function mockMigrationPreflight(inst: WorkflowInstance) {
  prepareExtraApprovalState(inst);
  const definition = mockWorkflowDefinitions.find(item => item.id === inst.definitionId);
  const fromVersion = inst.definitionSnapshot?.version ?? definition?.version ?? 1, toVersion = definition?.version ?? fromVersion;
  const activations = getMockApprovalActivations(inst.id).filter(activation => activation.status === 'active');
  const openTasks = mockWorkflowTasks.filter(task => task.instanceId === inst.id && (task.status === 'pending' || task.status === 'waiting'));
  const keys = [...new Set([...activations.map(activation => activation.nodeKey), ...openTasks.map(task => task.nodeKey)])];
  const nodes = keys.map(nodeKey => ({ nodeKey, label: openTasks.find(task => task.nodeKey === nodeKey)?.nodeName ?? nodeKey,
    inNew: !!definition?.flowData?.nodes.some(node => node.data.key === nodeKey), activeTasks: openTasks.filter(task => task.nodeKey === nodeKey).length,
    activeTokens: activations.filter(activation => activation.nodeKey === nodeKey).length }));
  const blocked = nodes.filter(node => !node.inNew).map(node => node.nodeKey);
  return { instanceId: inst.id, fromVersion, toVersion, migratable: inst.status === 'running' && definition?.status === 'published' && toVersion > fromVersion && !blocked.length, blocked, nodes };
}

/** 批量任务动作骨架：逐个对 pending 任务执行 act（各动作副作用自理），汇总成功 / 失败与提示 */
async function runBatchTaskAction(taskIds: number[], act: (task: WorkflowTask, now: string) => void): Promise<{ data: WorkflowBatchActionResponse; message: string }> {
  const results = [];
  for (const taskId of taskIds) {
    const task = mockWorkflowTasks.find((t) => t.id === taskId);
    if (task) {
      try {
        const inst = requireItem(mockWorkflowInstances, task.instanceId, '流程实例不存在'); prepareExtraApprovalState(inst);
        if (task.status !== 'pending' || inst.status !== 'running') throw new Error('任务尚未激活或已处理');
        act(task, mockDateTime());
        results.push({ taskId, success: true });
      } catch (error) {
        const body = error instanceof MockHttpError ? await error.response.json() as { message?: string } : null;
        results.push({ taskId, success: false, message: body?.message ?? (error instanceof Error ? error.message : '任务处理失败') });
      }
    } else {
      results.push({ taskId, success: false, message: '任务不存在或已处理' });
    }
  }
  const succeeded = results.filter((r) => r.success).length;
  return { data: { succeeded, failed: results.length - succeeded, results }, message: `成功 ${succeeded} 条` };
}

// ── 抄送已读 / 保存视图 / 定时发起 内存态 ──
const ccReadState = new Set<number>();
const mockSavedViews: WorkflowSavedView[] = [];
export const mockSchedules: WorkflowSchedule[] = [];
function requireMockScheduleConfiguration(definitionId: number, initiatorId: number) {
  const definition = requireItem(mockWorkflowDefinitions, definitionId, '流程定义不存在', { status: 404 });
  if (definition.status !== 'published' || definition.formType === 'external') {
    throw new MockHttpError(badRequest('定时发起只能选择已发布的普通流程', { status: 400 }));
  }
  const initiator = mockUsers.find(user => user.id === initiatorId && user.status === 'enabled');
  if (!initiator) throw new MockHttpError(badRequest('发起人不存在或已停用', { status: 400 }));
  return { definition, initiator };
}
export const mockScheduleRuns: WorkflowScheduleRunDetail[] = [];
let nextScheduleId = 1;
let nextScheduleRunId = 1;

function createScheduleRun(schedule: WorkflowSchedule): WorkflowScheduleRunDetail {
  const now = mockDateTime();
  const title = (schedule.titleTemplate || schedule.name).replace(/\{\{\s*date\s*\}\}/g, now.slice(0, 10)).replace(/\{\{\s*datetime\s*\}\}/g, now);
  const run: WorkflowScheduleRunDetail = {
    id: nextScheduleRunId++, jobType: 'schedule_launch', status: 'pending', instanceId: null, instanceTitle: null,
    definitionName: schedule.definitionName ?? null, taskId: null, nodeKey: null, idempotencyKey: null, traceId: null,
    payload: { scheduleId: schedule.id, definitionId: schedule.definitionId, initiatorId: schedule.initiatorId, title,
      formData: structuredClone(schedule.formData ?? {}), scheduledAt: now, trigger: 'manual' },
    priority: 100, attempts: 0, maxAttempts: 5, generation: 0, executionTimeoutMs: 600000, runAt: now,
    lockedAt: null, lockedBy: null, leaseUntil: null, executionDeadline: null, lastError: null, result: null,
    tenantId: schedule.tenantId, createdAt: now, updatedAt: now, scheduleId: schedule.id, scheduledAt: now, trigger: 'manual', executions: [],
  };
  mockScheduleRuns.push(run);
  return run;
}

/** Demo executes queued work on observation; it keeps the frozen occurrence and all attempt records. */
function observeScheduleRun(run: WorkflowScheduleRunDetail): void {
  if (run.status !== 'pending' || Date.parse(run.runAt.replace(' ', 'T')) > Date.now()) return;
  const now = mockDateTime();
  const definition = mockWorkflowDefinitions.find((d) => d.id === run.payload.definitionId);
  const starter = mockUsers.find((u) => u.id === run.payload.initiatorId);
  run.attempts += 1;
  run.updatedAt = now;
  const error = run.instanceId !== null ? null : !definition || definition.status !== 'published' ? '流程定义不存在或未发布' : !starter ? '发起人不存在' : starter.status !== 'enabled' ? '发起人已停用' : null;
  run.executions.push({ id: run.id * 100 + run.executions.length, jobId: run.id, jobType: 'schedule_launch', attempt: run.attempts,
    generation: run.generation, status: error ? 'failed' : 'succeeded', requestUrl: null, requestMethod: null, requestBody: null,
    responseStatus: null, responseBody: null, errorMessage: error, durationMs: 10, startedAt: now, finishedAt: now, createdAt: now });
  run.lastError = error;
  if (error) {
    run.status = run.attempts < run.maxAttempts ? 'pending' : 'dead';
    run.runAt = mockDateTime(new Date(Date.now() + Math.min(900000, 30000 * 2 ** (run.attempts - 1))));
  } else {
    if (run.instanceId === null && definition && starter) {
      const instance: WorkflowInstance = { id: getNextInstanceId(), definitionId: definition.id, definitionName: definition.name,
        title: String(run.payload.title), formData: structuredClone(run.payload.formData as Record<string, unknown>), formSnapshot: null,
        status: 'running', currentNodeKey: null, initiatorId: starter.id, initiatorName: starter.nickname ?? starter.username,
        initiatorAvatar: null, tenantId: run.tenantId, tasks: [], createdAt: now, updatedAt: now,
        definitionSnapshot: { id: definition.id, name: definition.name, description: definition.description,
          categoryId: definition.categoryId ?? null, formId: definition.formId ?? null, flowData: definition.flowData,
          formType: definition.formType, customForm: definition.customForm, status: definition.status, version: definition.version, tenantId: definition.tenantId } };
      mockWorkflowInstances.push(instance);
      advanceMockWorkflowGraph(instance, now);
      run.instanceId = instance.id; run.instanceTitle = instance.title;
    }
    run.status = 'succeeded';
    run.result = { instanceId: run.instanceId, title: run.payload.title, scheduledAt: run.payload.scheduledAt };
  }
  const schedule = mockSchedules.find((s) => s.id === run.scheduleId);
  if (schedule) { schedule.lastRunAt = now; schedule.lastRunStatus = error ? 'fail' : 'success'; schedule.lastRunMessage = error ?? `已发起：${run.payload.title}`; }
}

// ── 补偿 / 人工修复工单 内存态 ──
const mockCompensations: WorkflowCompensation[] = [
  { id: 1, instanceId: 1001, nodeKey: 'trigger1', nodeName: '扣减库存', errorMessage: '库存服务 500', action: 'compensate', status: 'pending', compensationActionStatus: 'succeeded', failedNodeKey: 'trigger1', resolution: null, resolvedBy: null, resolvedAt: null, createdAt: mockDateTime() },
  { id: 2, instanceId: 1002, nodeKey: 'catch1', nodeName: '异常捕获', errorMessage: '外部审批回调超时', action: 'toAdmin', status: 'resolved', compensationActionStatus: 'none', failedNodeKey: null, resolution: '已重派', resolvedBy: 1, resolvedAt: mockDateTime(), createdAt: mockDateTime() },
  { id: 3, instanceId: 1003, nodeKey: 'notify1', nodeName: '通知供应商', errorMessage: 'Webhook 连接被拒', action: 'fallback', status: 'pending', compensationActionStatus: 'failed', failedNodeKey: 'notify1', resolution: null, resolvedBy: null, resolvedAt: null, createdAt: mockDateTime() },
];
const mockCompensationLogs: WorkflowCompensationLog[] = [];
let nextCompensationLogId = 100;

/** 工单不在内存列表中时，按 id 合成一条演示工单（库存扣减补偿场景） */
function resolveCompensation(id: number): WorkflowCompensation {
  const existing = mockCompensations.find((c) => c.id === id);
  if (existing) return existing;
  const created: WorkflowCompensation = {
    id, instanceId: 1000 + id, nodeKey: 'trigger1', nodeName: '扣减库存', errorMessage: '库存服务 500',
    action: 'compensate', status: 'pending', compensationActionStatus: 'succeeded', failedNodeKey: 'trigger1',
    resolution: null, resolvedBy: null, resolvedAt: null, createdAt: mockDateTime(),
  };
  mockCompensations.push(created);
  return created;
}

function buildCompensationDetail(id: number): WorkflowCompensationDetail {
  const row = resolveCompensation(id);
  const logs: WorkflowCompensationLog[] = [
    { id: 1, compensationId: id, action: 'auto', note: '自动动作成功：已回滚库存锁定', attachments: null, operatorId: null, operatorName: null, createdAt: mockDateTime() },
    { id: 2, compensationId: id, action: 'note', note: '已联系库存组确认，可放行', attachments: null, operatorId: 1, operatorName: '管理员', createdAt: mockDateTime() },
    ...mockCompensationLogs.filter((log) => log.compensationId === id),
  ];
  return { ...row, logs };
}

function buildAnalytics(): WorkflowAnalytics {
  const insts = mockWorkflowInstances;
  const statusMap = new Map<string, number>();
  for (const i of insts) statusMap.set(i.status, (statusMap.get(i.status) ?? 0) + 1);
  const statusCounts = [...statusMap.entries()].map(([status, count]) => ({ status: status as WorkflowInstanceStatus, count }));
  const pending = mockWorkflowTasks.filter((t) => t.status === 'pending');

  // 各流程定义统计
  const defMap = new Map<number, { name: string; total: number; running: number; approved: number; rejected: number }>();
  for (const i of insts) {
    const e = defMap.get(i.definitionId) ?? { name: i.definitionName ?? `流程#${i.definitionId}`, total: 0, running: 0, approved: 0, rejected: 0 };
    e.total += 1;
    if (i.status === 'running') e.running += 1;
    if (i.status === 'approved') e.approved += 1;
    if (i.status === 'rejected') e.rejected += 1;
    defMap.set(i.definitionId, e);
  }
  const definitionStats = [...defMap.entries()].map(([definitionId, e]) => ({
    definitionId, definitionName: e.name, total: e.total, running: e.running, approved: e.approved, rejected: e.rejected,
    avgDurationSec: 3600 * 6,
  }));

  // 节点瓶颈
  const nodeMap = new Map<string, { nodeName: string; pending: number; done: number }>();
  for (const t of mockWorkflowTasks) {
    const e = nodeMap.get(t.nodeKey) ?? { nodeName: t.nodeName, pending: 0, done: 0 };
    if (t.status === 'pending') e.pending += 1;
    if (t.status === 'approved' || t.status === 'rejected') e.done += 1;
    nodeMap.set(t.nodeKey, e);
  }
  const nodeBottlenecks = [...nodeMap.entries()].slice(0, 10).map(([nodeKey, e]) => ({
    definitionId: 0, definitionName: '—', nodeKey, nodeName: e.nodeName,
    avgHandleSec: 3600 * 2, pendingCount: e.pending, doneCount: e.done,
  }));

  // 审批人工作量
  const approverMap = new Map<number, { name: string; count: number }>();
  for (const t of pending) {
    if (t.assigneeId == null) continue;
    const e = approverMap.get(t.assigneeId) ?? { name: t.assigneeName ?? `用户#${t.assigneeId}`, count: 0 };
    e.count += 1;
    approverMap.set(t.assigneeId, e);
  }
  const approverWorkloads = [...approverMap.entries()].map(([userId, e]) => ({
    userId, userName: e.name, pendingCount: e.count, handledCount: Math.floor(Math.random() * 12) + e.count, oldestPendingSec: 3600 * 12,
  }));

  // 近 14 天趋势
  const trend = Array.from({ length: 14 }, (_, idx) => {
    const date = new Date(Date.now() - (13 - idx) * 86400000).toISOString().slice(0, 10);
    return { date, created: Math.floor(Math.random() * 4), completed: Math.floor(Math.random() * 3), pending: 5 + Math.floor(Math.random() * 6) };
  });

  const approvedN = statusCounts.find((s) => s.status === 'approved')?.count ?? 0;
  const rejectedN = statusCounts.find((s) => s.status === 'rejected')?.count ?? 0;
  const decidedN = approvedN + rejectedN;
  const overdueN = Math.min(pending.length, 2);

  return {
    statusCounts,
    total: insts.length,
    avgDurationSec: 3600 * 8,
    pendingTaskCount: pending.length,
    overdueTaskCount: overdueN,
    dueSoonTaskCount: pending.length > 2 ? 1 : 0,
    recentCreated: insts.length,
    rejectionRate: decidedN > 0 ? rejectedN / decidedN : null,
    timeoutRate: pending.length > 0 ? overdueN / pending.length : null,
    definitionStats,
    nodeBottlenecks,
    approverWorkloads,
    automation: { jobsTotal: 24, jobsFailed: 1, jobsDead: 0, jobFailRate: 1 / 24, webhookTotal: 8, webhookSuccessRate: 0.875, subprocessTotal: 3, subprocessFailRate: 0 },
    trend,
  };
}

function buildOverdueList(): WorkflowOverdueTask[] {
  return mockWorkflowTasks
    .filter((t) => t.status === 'pending')
    .slice(0, 2)
    .map((t, idx) => {
      const inst = mockWorkflowInstances.find((i) => i.id === t.instanceId);
      return {
        taskId: t.id,
        instanceId: t.instanceId,
        instanceTitle: inst?.title ?? `实例#${t.instanceId}`,
        serialNo: inst?.serialNo ?? null,
        definitionName: inst?.definitionName ?? '—',
        nodeName: t.nodeName,
        assigneeId: t.assigneeId ?? null,
        assigneeName: t.assigneeName ?? null,
        timeoutAt: mockDateTime(),
        overdueSec: (idx + 1) * 3600 * 26,
      };
    });
}

/** 按实际定义展示可解析的处理人；只有真实的发起人自选节点要求填写，不额外制造审批节点。 */
function configuredApproverPreview(definition: WorkflowDefinition, initiatorId: number, formData: Record<string, unknown>): WorkflowApproverPreviewNode[] {
  const users = mockUsers.filter((user) => user.status === 'enabled');
  const refs = (ids: number[]) => users.filter((user) => ids.includes(user.id)).map((user) => ({ id: user.id, name: user.nickname ?? user.username }));
  if (!definition.flowData) return [];
  const plan = planWorkflowPath(definition.flowData, { formData, formFields: definition.formFields ?? [], starter: mockWorkflowStarter(initiatorId), recomputeDerivedValues: true });
  return (definition.flowData?.nodes ?? []).filter(({ data }) => ['start', 'approve', 'handler', 'ccNode', 'subProcess'].includes(data.type)).map(({ data }) => {
    const planned = plan.nodes.find(node => node.nodeKey === data.key);
    const selectionRequired = planned?.status !== 'excluded' && (data.assigneeType === 'initiatorSelect' || data.assigneeType === 'initiatorSelectScope');
    const candidates = mockWorkflowSelectionCandidates(data);
    const approvers = data.approveMethod === 'random' || selectionRequired ? [] : refs(resolveMockWorkflowAssignees(data, initiatorId));
    return { nodeKey: data.key, nodeName: data.label, nodeType: data.type, approvers,
      status: planned?.status ?? 'excluded', reason: planned?.reason ?? '不在本次路径中',
      approverReason: data.approveMethod === 'random' ? '到达节点后随机分配，当前不预选' : selectionRequired ? '发起前预选审批人，实际经过时启用' : approvers.length ? '按当前人员配置解析' : '处理人将在到达节点时确定',
      approveMethod: data.approveMethod ?? null, empty: approvers.length === 0,
      ...(selectionRequired ? { selectionRequired: true, selectableApprovers: candidates.map((user) => ({ id: user.id, name: user.nickname ?? user.username })) } : {}),
    };
  });
}

export const workflowExtraHandlers = [
  // ── 数据分析（必须在 /instances/:id 之前注册）──
  mock(workflowInstanceContract.analytics, ({ ok }) => ok(buildAnalytics())),

  // ── 抄送我的（必须在 /instances/:id 之前注册）──
  mock(workflowInstanceContract.ccMine, ({ query, ok, paginate }) => {
    const keyword = (query.keyword ?? '').toLowerCase();
    let all = mockWorkflowInstances.filter((i) => i.status !== 'draft');
    if (keyword) all = filterByKeyword(all, keyword, [(i) => i.title, (i) => i.definitionName], { caseInsensitive: true });
    const list: WorkflowInstance[] = all.map((i, idx) => {
      const ccTaskId = 90000 + idx;
      return { ...i, ccTaskId, ccReadAt: ccReadState.has(ccTaskId) ? mockDateTime() : null };
    });
    return ok(paginate(list));
  }),
  mock(workflowInstanceContract.ccUnreadCount, ({ ok }) => {
    const total = mockWorkflowInstances.filter((i) => i.status !== 'draft').length;
    return ok({ count: Math.max(0, total - ccReadState.size) });
  }),
  // ── 发起工作台概览：与上面各口径同源（Demo 用户 id=1，全部权限）──
  mock(workflowInstanceContract.workbenchSummary, ({ ok }) => {
    const myPendingTasks = mockWorkflowTasks.filter((t) => {
      if (t.assigneeId !== 1 || t.status !== 'pending') return false;
      return mockWorkflowInstances.find((i) => i.id === t.instanceId)?.status === 'running';
    });
    const mine = (status: WorkflowInstance['status']) => mockWorkflowInstances.filter((i) => i.initiatorId === 1 && i.status === status).length;
    return ok({
      pending: myPendingTasks.length,
      // 待办列表 Demo SLA 按 4 档轮换，第一档即「已超时」
      pendingOverdue: Math.ceil(myPendingTasks.length / 4),
      consultsPending: mockConsults.filter((c) => c.consulteeId === 1 && c.status === 'pending').length,
      ccUnread: Math.max(0, mockWorkflowInstances.filter((i) => i.status !== 'draft').length - ccReadState.size),
      myReturned: mine('returned'),
      myDrafts: mine('draft'),
      myRunning: mine('running'),
    });
  }),
  mock(workflowInstanceContract.ccRead, ({ params, ok }) => {
    ccReadState.add(params.ccTaskId);
    return ok(null, '已标记已读');
  }),

  // ── 我已办（必须在 /instances/:id 之前注册）──
  mock(workflowInstanceContract.handledMine, ({ query, ok, paginate, request }) => {
    const keyword = (query.keyword ?? '').toLowerCase();
    const sessionUserId = currentMockSession(request)?.user.id ?? 1;
    const tasks = mockWorkflowTasks.map((task) => ({ ...task, activationId: task.activationId ?? `seed-${task.instanceId}-${task.nodeKey}` }));
    const rounds = workflowTaskActivationRounds([...tasks].sort((a, b) => a.id - b.id));
    let list: WorkflowHandledInstanceItem[] = tasks.flatMap((task) => {
      if (task.assigneeId !== sessionUserId || (task.status !== 'approved' && task.status !== 'rejected')) return [];
      const inst = mockWorkflowInstances.find((item) => item.id === task.instanceId);
      if (!inst) return [];
      return [{ ...inst, myTaskStatus: task.status, myActionAt: task.actionAt, handledTask: {
        id: task.id, nodeKey: task.nodeKey, nodeName: task.nodeName, nodeType: task.nodeType,
        activationId: task.activationId, round: rounds.get(workflowTaskActivationKey(task))!,
        status: task.status, actionAt: task.actionAt, decision: task.decision ?? null,
      } }];
    });
    if (keyword) list = filterByKeyword(list, keyword, [(i) => i.title, (i) => i.definitionName], { caseInsensitive: true });
    list.sort((a, b) => (b.myActionAt ?? '').localeCompare(a.myActionAt ?? '') || b.handledTask.id - a.handledTask.id);
    return ok(paginate(list));
  }),

  // ── 批量撤回 / 批量催办（必须在 /instances/:id 之前注册）──
  mock(workflowInstanceContract.batchWithdraw, ({ body, ok }) => {
    const results = body.instanceIds.map((instanceId) => {
      const inst = mockWorkflowInstances.find((i) => i.id === instanceId);
      if (!inst) return { instanceId, success: false, message: '流程实例不存在' };
      if (inst.status !== 'running') return { instanceId, success: false, message: '只能撤回进行中的申请' };
      const now = mockDateTime(); cleanupExtraApprovalWork(inst, now, '[批量撤回] 未办审批已取消');
      inst.status = 'withdrawn'; inst.currentNodeKey = null; inst.updatedAt = now; syncMockWorkflowBusinessResult(inst);
      return { instanceId, success: true };
    });
    const succeeded = results.filter((r) => r.success).length;
    return ok({ succeeded, failed: results.length - succeeded, results }, `成功 ${succeeded} 条，失败 ${results.length - succeeded} 条`);
  }),
  mock(workflowInstanceContract.batchUrge, ({ body, ok }) => {
    const results = body.instanceIds.map((instanceId) => {
      const inst = mockWorkflowInstances.find((i) => i.id === instanceId);
      if (!inst) return { instanceId, success: false, message: '流程不存在' };
      if (inst.status !== 'running') return { instanceId, success: false, message: '流程已结束，无需催办' };
      return { instanceId, success: true, message: '已催办 1 人' };
    });
    const succeeded = results.filter((r) => r.success).length;
    return ok({ succeeded, failed: results.length - succeeded, results }, `成功 ${succeeded} 条，失败 ${results.length - succeeded} 条`);
  }),

  // ── 复制流程 / 导出导入 / 版本对比（必须在 /definitions/:id 之前注册）──
  mock(workflowDefinitionContract.duplicate, ({ params, ok }) => {
    const src = requireItem(mockWorkflowDefinitions, params.id, '流程定义不存在');
    const now = mockDateTime();
    const def: WorkflowDefinition = { ...src, id: getNextDefinitionId(), name: `${src.name} 副本`, status: 'draft', version: 0, createdAt: now, updatedAt: now };
    mockWorkflowDefinitions.push(def);
    return ok(def, '已复制为新草稿');
  }),
  mock(workflowDefinitionContract.export, ({ params, ok }) => {
    const src = requireItem(mockWorkflowDefinitions, params.id, '流程定义不存在');
    return ok({
      name: src.name,
      description: src.description ?? null,
      categoryName: src.categoryName ?? null,
      flowData: src.flowData ?? null,
      formType: src.formType,
      customForm: src.customForm,
      form: src.formFields ? { name: `${src.name}表单`, description: null, schema: { fields: src.formFields, settings: src.formSettings ?? {} } } : null,
      exportedAt: mockDateTime(),
      schemaVersion: 1,
    });
  }),
  mock(workflowDefinitionContract.import, ({ body, ok }) => {
    const formType = body.formType ?? 'designer';
    const now = mockDateTime();
    // 导入 JSON 中的 flowData / 表单字段按契约声明为 unknown，演示环境直接按引擎结构采用
    const flowData = (body.flowData as WorkflowFlowData | null | undefined) ?? null;
    const formFields = (body.form?.schema as { fields?: WorkflowFormField[] } | null | undefined)?.fields ?? null;
    const def: WorkflowDefinition = {
      ...mockWorkflowDefinitions[0],
      id: getNextDefinitionId(),
      name: body.name,
      description: body.description ?? null,
      status: 'draft',
      version: 0,
      flowData,
      formId: formType === 'designer' ? (mockWorkflowDefinitions[0]?.formId ?? null) : null,
      formFields: formType === 'designer' ? formFields : null,
      formType,
      customForm: formType === 'designer' ? null : body.customForm ?? null,
      createdAt: now,
      updatedAt: now,
    };
    mockWorkflowDefinitions.push(def);
    return ok(def, '已导入为新草稿');
  }),
  mock(workflowDefinitionContract.diff, ({ params, query, ok }) => {
    const src = requireItem(mockWorkflowDefinitions, params.id, '流程定义不存在');
    const side = (v: number): WorkflowVersionDiffSide => ({
      version: v === 0 ? (src.version ?? 1) : v,
      name: src.name,
      label: v === 0 ? `当前（v${src.version ?? 1}）` : `v${v}`,
      flowData: src.flowData ?? null,
      publishedAt: v === 0 ? null : mockDateTime(),
    });
    const nodeChanges: WorkflowVersionNodeChange[] = [
      { kind: 'added', nodeKey: 'cc_finance', nodeName: '抄送财务', nodeType: '抄送', fields: [] },
      { kind: 'modified', nodeKey: 'approver_1', nodeName: '审批人', nodeType: '审批', fields: [
        { field: '审批人', before: '角色(1)', after: '指定成员(2)' },
        { field: '超时策略', before: '关闭', after: '24小时 · 提醒' },
      ] },
    ];
    const edgeChanges: WorkflowVersionEdgeChange[] = [
      { kind: 'added', from: '审批人', to: '抄送财务', before: null, after: '无条件' },
      { kind: 'modified', from: '条件分支', to: '结束', before: 'amount gt 1000', after: 'amount gt 5000' },
    ];
    return ok({
      left: side(query.left ?? 0),
      right: side(query.right ?? 0),
      summary: { nodesAdded: 1, nodesRemoved: 0, nodesModified: 1, edgesAdded: 1, edgesRemoved: 0, edgesModified: 1 },
      nodeChanges,
      edgeChanges,
    });
  }),

  // ── 提交前审批链路预览 ──
  mock(workflowDefinitionContract.preview, ({ params, body, request, ok }) => {
    const definition = requireItem(mockWorkflowDefinitions, params.id, '流程定义不存在');
    return ok(configuredApproverPreview(definition, currentMockSession(request)?.user.id ?? 1, body.formData ?? {}));
  }),

  // ── 主动抄送 / 转发 ──
  mock(workflowInstanceContract.forward, ({ body, ok }) => ok(null, `已抄送 ${body.userIds.length} 人`)),

  // ── 关联审批单候选 ──
  mock(workflowInstanceContract.relationOptions, ({ query, ok }) => {
    const keyword = (query.keyword ?? '').toLowerCase();
    let all = mockWorkflowInstances.filter((i) => i.status !== 'draft');
    if (query.definitionId) all = all.filter((i) => i.definitionId === query.definitionId);
    if (keyword) all = filterByKeyword(all, keyword, [(i) => i.title, (i) => i.serialNo], { caseInsensitive: true });
    return ok(all.slice(0, 20).map((i) => ({
      instanceId: i.id, title: i.title, serialNo: i.serialNo ?? null,
      definitionName: i.definitionName ?? null, status: i.status, createdAt: i.createdAt,
    })));
  }),

  // ── 列表保存视图 ──
  mock(workflowSavedViewContract.list, ({ query, ok }) => ok(mockSavedViews.filter((v) => v.pageKey === query.pageKey))),
  ...mockResource(workflowSavedViewContract, {
    store: mockSavedViews,
    notFound: '视图不存在',
    create: (body, id, now): WorkflowSavedView => ({ id, userId: 1, pageKey: body.pageKey, name: body.name, filters: body.filters, isDefault: body.isDefault ?? false, sort: body.sort ?? 0, createdAt: now, updatedAt: now }),
    messages: { create: '已保存', update: '已更新', remove: '已删除' },
    exclude: ['list'],
  }),

  // ── 定时发起 ──
  mock(workflowScheduleContract.list, ({ ok, paginate }) => ok(paginate(mockSchedules))),
  mock(workflowScheduleContract.create, ({ body, ok }) => {
    const { definition: def, initiator } = requireMockScheduleConfiguration(body.definitionId, body.initiatorId);
    const now = mockDateTime();
    const s: WorkflowSchedule = {
      id: nextScheduleId++, definitionId: body.definitionId, definitionName: def?.name ?? null,
      name: body.name, cronExpression: body.cronExpression, timezone: body.timezone ?? null, initiatorId: body.initiatorId, initiatorName: initiator.nickname ?? initiator.username,
      titleTemplate: body.titleTemplate ?? null, formData: body.formData ?? null, status: body.status,
      lastRunAt: null, lastRunStatus: null, lastRunMessage: null, nextRunAt: body.status === 'disabled' ? null : mockDateTime(), tenantId: null, createdAt: now, updatedAt: now,
    };
    mockSchedules.push(s);
    return ok(s, '已创建');
  }),
  mock(workflowScheduleContract.update, ({ params, body, ok }) => {
    const s = requireItem(mockSchedules, params.id, '定时规则不存在');
    if (body.status !== 'disabled' && (body.initiatorId !== undefined || body.status === 'enabled' || body.definitionId !== undefined)) {
      requireMockScheduleConfiguration(body.definitionId ?? s.definitionId, body.initiatorId ?? s.initiatorId);
    }
    const reschedule = (body.status !== undefined && body.status !== s.status)
      || (body.cronExpression !== undefined && body.cronExpression.trim() !== s.cronExpression.trim())
      || (body.timezone !== undefined && body.timezone !== s.timezone);
    Object.assign(s, body, { updatedAt: mockDateTime() });
    if (reschedule) s.nextRunAt = s.status === 'disabled' ? null : mockDateTime();
    if (body.definitionId) s.definitionName = mockWorkflowDefinitions.find((d) => d.id === body.definitionId)?.name ?? null;
    return ok(s, '已更新');
  }),
  mock(workflowScheduleContract.remove, ({ params, ok }) => {
    requireItem(mockSchedules, params.id, '定时规则不存在');
    removeByIds(mockSchedules, [params.id]);
    return ok(null, '已删除');
  }),
  mock(workflowScheduleContract.run, ({ params, ok }) => {
    const s = requireItem(mockSchedules, params.id, '定时规则不存在');
    requireMockScheduleConfiguration(s.definitionId, s.initiatorId);
    createScheduleRun(s);
    return ok(s, '已加入执行队列');
  }),
  mock(workflowScheduleContract.runs, ({ params, ok, paginate }) => {
    requireItem(mockSchedules, params.id, '定时规则不存在');
    const runs = mockScheduleRuns.filter((r) => r.scheduleId === params.id);
    runs.forEach(observeScheduleRun);
    return ok(paginate([...runs].reverse()));
  }),
  mock(workflowScheduleContract.runDetail, ({ params, ok }) => {
    requireItem(mockSchedules, params.id, '定时规则不存在');
    const run = mockScheduleRuns.find((r) => r.id === params.jobId && r.scheduleId === params.id);
    if (!run) return notFound('定时执行记录不存在', { status: 404 });
    observeScheduleRun(run);
    return ok(run);
  }),
  mock(workflowScheduleContract.retryRun, ({ params, ok }) => {
    requireItem(mockSchedules, params.id, '定时规则不存在');
    const run = mockScheduleRuns.find((r) => r.id === params.jobId && r.scheduleId === params.id);
    if (!run) return notFound('定时执行记录不存在', { status: 404 });
    if (!['failed', 'dead', 'canceled'].includes(run.status)) return badRequest('仅失败、死信或已取消的定时执行可补发', { status: 400 });
    run.status = 'pending'; run.generation += 1; run.attempts = 0; run.runAt = mockDateTime();
    run.lastError = null; run.updatedAt = mockDateTime();
    return ok(run, '已补发原周期');
  }),

  // ── 我的协办（必须在 /instances/:id 之前注册）──
  mock(workflowTaskContract.myConsults, ({ ok, paginate }) => {
    const all = mockConsults.filter((c) => c.consulteeId === 1);
    return ok(paginate(all));
  }),
  mock(workflowTaskContract.replyConsult, ({ params, body, ok }) => {
    const c = requireItem(mockConsults, params.id, '协办记录不存在');
    c.opinion = body.opinion; c.status = 'replied'; c.repliedAt = mockDateTime();
    return ok(c, '已回复');
  }),

  // ── 流程模板 ──
  mock(workflowTemplateContract.list, ({ ok }) => ok(mockTemplates)),
  mock(workflowTemplateContract.saveAs, ({ body, ok }) => {
    const src = mockWorkflowDefinitions.find((item) => item.id === body.definitionId);
    if (src && src.formType !== 'designer') {
      return badRequest('模板库暂仅支持表单库设计器流程；自定义业务表单或业务系统主导流程请使用复制流程或导出导入复用');
    }
    const now = mockDateTime();
    const tpl: WorkflowTemplate = {
      id: nextTemplateId++,
      name: body.name,
      code: null,
      description: body.description ?? src?.description ?? null,
      categoryName: src?.categoryName ?? null,
      icon: body.icon ?? src?.customForm?.icon ?? null,
      color: body.color ?? null,
      flowData: src?.flowData ?? mockWorkflowDefinitions[0]?.flowData ?? null,
      formSchema: src?.formFields ? { fields: src.formFields, settings: src.formSettings ?? {} } : null,
      sort: 0,
      builtin: false,
      createdAt: now,
      updatedAt: now,
    };
    mockTemplates.push(tpl);
    return ok(tpl, '已保存为模板');
  }),
  mock(workflowTemplateContract.clone, ({ params, body, ok }) => {
    const tpl = requireItem(mockTemplates, params.id, '模板不存在');
    const name = body.name || tpl.name;
    const description: string | null = body.description !== undefined ? (body.description?.trim() || null) : (tpl.description ?? null);
    const categoryId: number | null = body.categoryId ?? null;
    const now = mockDateTime();
    const formSchema = tpl.formSchema ? structuredClone(tpl.formSchema) : null;
    const formId = formSchema ? getNextWorkflowFormId() : null;
    const formName = formSchema ? `${name}表单` : null;
    if (formSchema && formId != null) {
      mockWorkflowForms.push({ ...mockWorkflowForms[0], id: formId, name: formName!, code: `template_${tpl.id}_${formId}`, description,
        schema: formSchema, revision: 1, status: 'enabled', usageCount: 1, createdAt: now, updatedAt: now });
    }
    const def: WorkflowDefinition = { ...mockWorkflowDefinitions[0], id: getNextDefinitionId(), name, description, categoryId,
      status: 'draft', version: 1, flowData: structuredClone(tpl.flowData), formType: 'designer', customForm: null,
      formId, formName, formFields: formSchema?.fields ?? null, formSettings: formSchema?.settings ?? null, createdAt: now, updatedAt: now };
    mockWorkflowDefinitions.push(def);
    return ok(def, '已创建');
  }),
  mock(workflowTemplateContract.update, ({ params, body, ok }) => {
    const idx = mockTemplates.findIndex((t) => t.id === params.id);
    if (idx === -1) return notFound('模板不存在');
    mockTemplates[idx] = {
      ...mockTemplates[idx],
      ...(body.name !== undefined ? { name: body.name } : {}),
      ...(body.code !== undefined ? { code: body.code ?? null } : {}),
      ...(body.description !== undefined ? { description: body.description ?? null } : {}),
      ...(body.categoryName !== undefined ? { categoryName: body.categoryName ?? null } : {}),
      ...(body.icon !== undefined ? { icon: body.icon ?? null } : {}),
      ...(body.color !== undefined ? { color: body.color ?? null } : {}),
      ...(body.sort !== undefined ? { sort: body.sort } : {}),
      updatedAt: mockDateTime(),
    };
    return ok(mockTemplates[idx], '已更新');
  }),
  mock(workflowTemplateContract.remove, ({ params, ok }) => {
    const item = requireItem(mockTemplates, params.id, '模板不存在');
    if (item.builtin) return badRequest('系统内置模板不可删除');
    removeByIds(mockTemplates, [params.id]);
    return ok(null, '已删除');
  }),

  // ── 协办 / 撤回 ──
  mock(workflowTaskContract.consult, ({ params, body, ok }) => {
    const task = mockWorkflowTasks.find((t) => t.id === params.taskId);
    const created = body.consulteeIds.map((cid) => {
      const c: WorkflowTaskConsult = { id: nextConsultId++, taskId: params.taskId, instanceId: task?.instanceId ?? 0, nodeName: task?.nodeName ?? null, inviterId: 1, inviterName: '张三', consulteeId: cid, consulteeName: `用户#${cid}`, question: body.question ?? null, opinion: null, status: 'pending', repliedAt: null, createdAt: mockDateTime() };
      mockConsults.push(c);
      return c;
    });
    return ok(created, '已发起协办');
  }),
  mock(workflowTaskContract.recall, ({ params, ok, request }) => {
    const task = requireItem(mockWorkflowTasks, params.taskId, '任务不存在'), inst = requireItem(mockWorkflowInstances, task.instanceId, '流程实例不存在');
    prepareExtraApprovalState(inst);
    if (task.assigneeId !== (currentMockSession(request)?.user.id ?? 1)) return forbidden('只能撤回自己处理的任务');
    if (inst.status !== 'running') return badRequest('流程已结束，无法撤回正式意见');
    if (!['approved', 'rejected'].includes(task.status) || task.taskKind !== 'approval') return badRequest('仅已处理正式意见可撤回');
    const activations = getMockApprovalActivations(inst.id), index = activations.findIndex(activation => activation.slots.some(slot => slot.currentTaskId === task.id));
    if (index < 0) return badRequest('该意见没有正式审批轮次');
    if (activations.slice(index+1).some(activation => activation.slots.some(slot => slot.status === 'approved' || slot.status === 'rejected'))) return badRequest('后续节点已被处理，无法撤回');
    if (activations[index].signGroups.some(group => group.slots.some(slot => slot.currentTaskId !== task.id && (slot.status === 'approved' || slot.status === 'rejected')))) return badRequest('补充审批已有正式意见，不能撤回其前置审批');
    const config = mockTaskWorkflowContext(task).node;
    if (!config) return badRequest('流程节点快照不存在');
    const now = mockDateTime(); cleanupExtraApprovalWork(inst, now, '[撤回重审] 原轮次未办审批作废');
    task.comment = '[已撤回] '+(task.comment ?? '');
    resetMockWorkflowGraph(inst, [config.key]);
    mockWorkflowTasks.push(...buildMockApprovalTasks(config, inst.id, now, inst.initiatorId ?? 1));
    inst.currentNodeKey = task.nodeKey; inst.updatedAt = now;
    return ok(extraApprovalView(inst), '已创建重新审批轮次');
  }),

  // ── 超时待办预警 ──
  mock(workflowInstanceContract.overdue, ({ ok, paginate }) => ok(paginate(buildOverdueList()))),

  // ── 流程评论 ──
  mock(workflowInstanceContract.comments, ({ params, ok }) => ok(mockComments.filter((c) => c.instanceId === params.id))),
  mock(workflowInstanceContract.addComment, ({ params, body, ok, request }) => {
    // 回复引用：父评论须属于同一实例
    const parent = body.parentId
      ? mockComments.find((c) => c.id === body.parentId && c.instanceId === params.id) ?? null
      : null;
    if (body.parentId && !parent) return badRequest('被回复的评论不存在');
    const commentId = nextCommentId++;
    const comment: WorkflowComment = {
      id: commentId,
      instanceId: params.id,
      taskId: body.taskId ?? null,
      parentId: parent?.id ?? null,
      parentSummary: parent
        ? { userName: parent.userName ?? `用户#${parent.userId}`, content: parent.content.length > 60 ? `${parent.content.slice(0, 60)}…` : parent.content }
        : null,
      userId: 1,
      userName: '张三',
      userAvatar: null,
      content: body.content,
      mentions: body.mentions ?? [],
      mentionNames: (body.mentions ?? []).map((m) => `用户#${m}`),
      attachments: bindMockWorkflowAttachments(request, params.id, { commentId }, body.attachments),
      createdAt: mockDateTime(),
    };
    mockComments.push(comment);
    return ok(comment, '已评论');
  }),

  // ── 草稿：编辑 / 提交 / 重新提交 ──
  mock(workflowInstanceContract.updateDraft, async ({ params, body, ok, request }) => {
    const inst = requireItem(mockWorkflowInstances, params.id, '流程实例不存在');
    if (inst.status !== 'draft' && inst.status !== 'returned') return badRequest('仅草稿或已退回的申请可编辑');
    const formData = body.formData === undefined ? undefined : await resolveMockWorkflowFormSignatures(request, inst.formSnapshot?.fields ?? [], body.formData ?? {}, inst.formData ?? {});
    if (body.title !== undefined) inst.title = body.title;
    if (formData !== undefined) inst.formData = await bindMockWorkflowFormAttachments(request, inst.id, inst.formSnapshot?.fields ?? [], formData);
    inst.updatedAt = mockDateTime();
    return ok(inst, '草稿已保存');
  }),
  mock(workflowInstanceContract.submitDraft, async ({ params, body, ok, request }) => {
    const inst = requireItem(mockWorkflowInstances, params.id, '流程实例不存在');
    if (inst.status !== 'draft' && inst.status !== 'returned') return badRequest('仅草稿或已退回的申请可提交');
    inst.formData = computeWorkflowDerivedValues(inst.formSnapshot?.fields ?? [], await resolveMockWorkflowFormSignatures(request, inst.formSnapshot?.fields ?? [], inst.formData ?? {}, inst.formData ?? {}));
    const definition = mockWorkflowDefinitions.find((item) => item.id === inst.definitionId);
    if (!definition) return notFound('流程定义不存在');
    let flowData: WorkflowFlowData | null;
    try { flowData = applyMockInitiatorSelections(definition, inst.formData ?? {}, inst.initiatorId ?? 1, body.selectedInitiatorApprovers); }
    catch (error) { return badRequest(error instanceof Error ? error.message : '审批人选择不完整'); }
    const now = mockDateTime(); cleanupExtraApprovalWork(inst, now, '[重新提交] 原轮次未办审批取消');
    inst.definitionSnapshot = structuredClone({ ...definition, flowData, formFields: definition.formFields ?? null });
    inst.status = 'running'; resetMockWorkflowGraph(inst); advanceMockWorkflowGraph(inst, now); syncMockWorkflowBusinessResult(inst);
    return ok(extraApprovalView(inst), '申请已提交');
  }),
  mock(workflowInstanceContract.resubmit, ({ params, ok }) => {
    const src = requireItem(mockWorkflowInstances, params.id, '流程实例不存在');
    const now = mockDateTime();
    const clone: WorkflowInstance = {
      ...src,
      id: getNextInstanceId(),
      serialNo: null,
      status: 'draft',
      currentNodeKey: null,
      tasks: [],
      approvalActivations: [],
      formData: clearWorkflowFormSignaturesData(src.formSnapshot?.fields ?? [], src.formData ?? {}),
      createdAt: now,
      updatedAt: now,
    };
    mockWorkflowInstances.push(clone);
    return ok(clone, '已生成草稿');
  }),

  // ── 补偿 / 人工修复工单 ──
  mock(workflowInstanceOpsContract.compensations, ({ query, ok, paginate }) => {
    const list = query.status ? mockCompensations.filter((c) => c.status === query.status) : mockCompensations;
    return ok(paginate(list));
  }),
  mock(workflowInstanceOpsContract.compensationDetail, ({ params, ok }) => ok(buildCompensationDetail(params.id))),
  mock(workflowInstanceOpsContract.resolveCompensation, ({ params, body, ok }) => {
    const row = resolveCompensation(params.id);
    row.status = body.action === 'terminate' ? 'terminated' : 'resolved';
    row.resolution = body.resolution ?? null;
    row.resolvedBy = 1;
    row.resolvedAt = mockDateTime();
    return ok(row, '已处理');
  }),
  mock(workflowInstanceOpsContract.addCompensationNote, ({ params, body, ok }) => {
    mockCompensationLogs.push({
      id: nextCompensationLogId++,
      compensationId: params.id,
      action: body.attachments?.length ? 'attachment' : 'note',
      note: body.note ?? null,
      attachments: body.attachments ?? null,
      operatorId: 1,
      operatorName: '管理员',
      createdAt: mockDateTime(),
    });
    return ok(buildCompensationDetail(params.id), '已记录');
  }),
  mock(workflowInstanceOpsContract.retryCompensation, ({ params, ok }) => {
    resolveCompensation(params.id).compensationActionStatus = 'pending';
    return ok(buildCompensationDetail(params.id), '已重新入队');
  }),
  mock(workflowInstanceOpsContract.resumeCompensation, ({ params, ok }) => {
    resolveCompensation(params.id).status = 'resolved';
    return ok(buildCompensationDetail(params.id), '已恢复推进');
  }),

  // ── 实例迁移 ──
  mock(workflowInstanceOpsContract.migratePreflight, ({ params, ok }) => {
    const inst = requireItem(mockWorkflowInstances, params.id, '流程实例不存在');
    return ok(mockMigrationPreflight(inst));
  }),
  mock(workflowInstanceOpsContract.migrate, ({ params, ok }) => {
    const inst = requireItem(mockWorkflowInstances, params.id, '流程实例不存在'), preflight = mockMigrationPreflight(inst);
    if (!preflight.migratable) return badRequest(preflight.blocked.length ? '新版本缺少活动节点，迁移预检未通过' : '没有更高的可迁移版本或实例不在运行中', { status: 400 });
    const definition = requireItem(mockWorkflowDefinitions, inst.definitionId!, '流程定义不存在');
    // A version migration replaces future graph/config only. Current formal seats and frozen thresholds survive.
    inst.definitionSnapshot = structuredClone({ ...definition, formFields: definition.formFields ?? null }); inst.updatedAt = mockDateTime();
    mockInstanceMigrations.push({ id: mockInstanceMigrations.length+1, instanceId: inst.id, fromVersion: preflight.fromVersion, toVersion: preflight.toVersion,
      status: 'succeeded', note: '当前审批轮次和基础阈值保留，仅更新后续流程快照', createdAt: inst.updatedAt });
    return ok(null, '已迁移并保留当前审批轮次');
  }),
  mock(workflowInstanceOpsContract.migrations, ({ params, ok }) => ok(mockInstanceMigrations.filter(row => row.instanceId === params.id))),

  // ── 管理员强制操作 ──
  mock(workflowInstanceOpsContract.jump, ({ params, body, ok }) => {
    const inst = requireItem(mockWorkflowInstances, params.id, '流程实例不存在');
    if (inst.status !== 'running') return badRequest('仅审批中的流程可强制跳转');
    const flow = inst.definitionSnapshot?.flowData ?? mockWorkflowDefinitions.find(def => def.id === inst.definitionId)?.flowData;
    const target = flow?.nodes.find(node => node.data.key === body.targetNodeKey && (node.data.type === 'approve' || node.data.type === 'handler'));
    if (!target) return badRequest('只能跳转至审批或办理节点');
    const now = mockDateTime(); cleanupExtraApprovalWork(inst, now, '[强制跳转] 原轮次未办审批作废');
    resetMockWorkflowGraph(inst, [target.data.key]);
    mockWorkflowTasks.push(...buildMockApprovalTasks(target.data, inst.id, now, inst.initiatorId ?? 1));
    inst.currentNodeKey = target.data.key; inst.updatedAt = now;
    return ok(extraApprovalView(inst), '已跳转并创建新审批轮次');
  }),
  mock(workflowTaskContract.reassign, ({ params, body, ok }) => {
    const task = requireItem(mockWorkflowTasks, params.taskId, '任务不存在'), inst = requireItem(mockWorkflowInstances, task.instanceId, '流程实例不存在');
    prepareExtraApprovalState(inst);
    if (inst.status !== 'running') return badRequest('流程不在运行中');
    try { transferMockApprovalSeat(task, body.targetUserId, { targetName: getMockUserName(body.targetUserId) ?? undefined, allowWaiting: true }); return ok(task, '已改派同一正式席位'); }
    catch(error) { return badRequest(error instanceof Error ? error.message : '改派失败', { status: 400 }); }
  }),

  // ── 批量审批 ──
  mock(workflowTaskContract.batchApprove, async ({ body, request, ok }) => {
    const { taskIds, comment } = body;
    const { data, message } = await resolveIdempotent({
      request,
      cache: batchActionCache,
      run: () => runBatchTaskAction(taskIds, (task, now) => {
        const signature = resolveMockTaskSignature(request, task, body.signature, true);
        if (mockTaskWorkflowContext(task).node?.operations?.includes('opinionRequired') && !comment?.trim()) {
          throw new MockHttpError(badRequest('请填写审批意见', { status: 400 }));
        }
        Object.assign(task, signature);
        task.decision = { action: task.nodeType === 'handler' ? 'complete' : 'approve', targetNodeKey: null, targetNodeName: null };
        settleExtraTask(task, 'approved', now, comment ?? undefined);
      }),
    });
    return ok(data, message);
  }),
  mock(workflowTaskContract.batchReject, async ({ body, request, ok }) => {
    const { taskIds, comment } = body;
    const { data, message } = await resolveIdempotent({
      request,
      cache: batchActionCache,
      run: () => runBatchTaskAction(taskIds, (task, now) => {
        settleExtraTask(task, 'rejected', now, comment);
      }),
    });
    return ok(data, message);
  }),

  // ── 审批意见常用语 ──
  mock(workflowQuickPhraseContract.list, ({ ok }) => ok(mockQuickPhrases)),
  mock(workflowQuickPhraseContract.create, ({ body, ok }) => {
    const phrase: WorkflowQuickPhrase = { id: nextPhraseId++, userId: 1, content: body.content, sort: body.sort, createdAt: mockDateTime(), updatedAt: mockDateTime() };
    mockQuickPhrases.push(phrase);
    return ok(phrase, '已新增');
  }),
  mock(workflowQuickPhraseContract.update, ({ params, body, ok }) => {
    const p = requireItem(mockQuickPhrases, params.id, '常用语不存在');
    if (body.content !== undefined) p.content = body.content;
    if (body.sort !== undefined) p.sort = body.sort;
    p.updatedAt = mockDateTime();
    return ok(p, '已更新');
  }),
  mock(workflowQuickPhraseContract.remove, ({ params, ok }) => {
    requireItem(mockQuickPhrases, params.id, '常用语不存在');
    removeByIds(mockQuickPhrases, [params.id]);
    return ok(null, '已删除');
  }),

  // ── 审批代理 / 离岗委托 ──
  mock(workflowDelegationContract.list, ({ ok, paginate }) => ok(paginate(mockDelegations))),
  ...mockResource(workflowDelegationContract, {
    store: mockDelegations,
    notFound: '委托规则不存在',
    create: (body, id, now): WorkflowDelegation => ({ id, principalId: body.principalId ?? 1, principalName: getMockUserName(body.principalId ?? 1), delegateId: body.delegateId, delegateName: getMockUserName(body.delegateId), definitionId: body.definitionId ?? null, definitionName: getMockDefinitionName(body.definitionId), mode: body.mode, reason: body.reason ?? null, startAt: body.startAt ?? null, endAt: body.endAt ?? null, enabled: body.enabled, active: body.enabled, createdAt: now, updatedAt: now }),
    messages: { create: '已新增', remove: '已删除' },
    exclude: ['list', 'update'],
  }),
  mock(workflowDelegationContract.update, ({ params, body, ok }) => {
    const row = requireItem(mockDelegations, params.id, '委托规则不存在');
    Object.assign(row, body, { updatedAt: mockDateTime() });
    if (body.enabled !== undefined) row.active = body.enabled;
    return ok(row, '已更新');
  }),
];
