import { mock } from '@/mocks/utils/contract';
import { badRequest, fail, forbidden, notFound } from '@/mocks/utils/handlers';
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
  type WorkflowInstanceStatus,
  type WorkflowOverdueTask,
  type WorkflowQuickPhrase,
  type WorkflowSavedView,
  type WorkflowSchedule,
  type WorkflowTaskConsult,
  type WorkflowTemplate,
  type WorkflowVersionDiffSide,
  type WorkflowVersionEdgeChange,
  type WorkflowVersionNodeChange,
} from '@zenith/shared/workflow';
import { SEED_WORKFLOW_TEMPLATES } from '@zenith/shared/seed';
import { mockWorkflowInstances, mockWorkflowTasks, mockWorkflowDefinitions, getNextInstanceId, getNextDefinitionId } from '@/mocks/data/workflow';
import { mockUsers } from '@/mocks/data/users';
import { mockDateTime } from '@/mocks/utils/date';

/** 批量审批的幂等缓存：同一 X-Idempotency-Key 重复提交时原样回放首次结果 */
const batchActionCache = new Map<string, { data: WorkflowBatchActionResponse; message: string }>();

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
let nextDelegationId = 1;

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

function syncInstanceApprovedIfComplete(instanceId: number, now: string) {
  const inst = mockWorkflowInstances.find((item) => item.id === instanceId);
  if (!inst || inst.status !== 'running') return;
  const hasPendingTask = mockWorkflowTasks.some((task) =>
    task.instanceId === instanceId && (task.status === 'pending' || task.status === 'waiting'),
  );
  if (!hasPendingTask) {
    inst.status = 'approved';
    inst.currentNodeKey = null;
    inst.updatedAt = now;
  }
}

// ── 抄送已读 / 保存视图 / 定时发起 内存态 ──
const ccReadState = new Set<number>();
const mockSavedViews: WorkflowSavedView[] = [];
let nextSavedViewId = 1;
const mockSchedules: WorkflowSchedule[] = [];
let nextScheduleId = 1;

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

const APPROVER_PREVIEW: WorkflowApproverPreviewNode[] = [
  { nodeKey: '__initiator__', nodeName: '发起人', nodeType: 'start', approvers: [{ id: 1, name: '张三' }], approveMethod: null, branchLabel: null, empty: false },
  { nodeKey: 'approve_manager', nodeName: '直属主管审批', nodeType: 'approve', approvers: [{ id: 2, name: '李四' }], approveMethod: 'or', branchLabel: null, empty: false },
  { nodeKey: 'approve_pick', nodeName: '指定审批人', nodeType: 'approve', approvers: [], approveMethod: 'or', branchLabel: null, empty: true, selectionRequired: true, selectableApprovers: [{ id: 2, name: '李四' }, { id: 3, name: '王五' }, { id: 4, name: '赵六' }] },
  { nodeKey: 'approve_dept_head', nodeName: '部门负责人审批', nodeType: 'approve', approvers: [{ id: 3, name: '王五' }], approveMethod: 'and', branchLabel: null, empty: false },
  { nodeKey: 'cc_initiator', nodeName: '抄送发起人', nodeType: 'ccNode', approvers: [{ id: 1, name: '张三' }], approveMethod: null, branchLabel: null, empty: false },
];

export const workflowExtraHandlers = [
  // ── 数据分析（必须在 /instances/:id 之前注册）──
  mock(workflowInstanceContract.analytics, ({ ok }) => ok(buildAnalytics())),

  // ── 抄送我的（必须在 /instances/:id 之前注册）──
  mock(workflowInstanceContract.ccMine, ({ query, ok, paginate }) => {
    const keyword = (query.keyword ?? '').toLowerCase();
    let all = mockWorkflowInstances.filter((i) => i.status !== 'draft');
    if (keyword) all = all.filter((i) => i.title.toLowerCase().includes(keyword) || (i.definitionName ?? '').toLowerCase().includes(keyword));
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
  mock(workflowInstanceContract.ccRead, ({ params, ok }) => {
    ccReadState.add(params.ccTaskId);
    return ok(null, '已标记已读');
  }),

  // ── 我已办（必须在 /instances/:id 之前注册）──
  mock(workflowInstanceContract.handledMine, ({ query, ok, paginate }) => {
    const keyword = (query.keyword ?? '').toLowerCase();
    let all = mockWorkflowInstances.filter((i) => i.status === 'approved' || i.status === 'rejected');
    if (keyword) all = all.filter((i) => i.title.toLowerCase().includes(keyword) || (i.definitionName ?? '').toLowerCase().includes(keyword));
    const list: WorkflowInstance[] = all.map((i) => ({
      ...i,
      myTaskStatus: i.status === 'approved' ? 'approved' : 'rejected',
      myActionAt: i.updatedAt,
    }));
    return ok(paginate(list));
  }),

  // ── 批量撤回 / 批量催办（必须在 /instances/:id 之前注册）──
  mock(workflowInstanceContract.batchWithdraw, ({ body, ok }) => {
    const results = body.instanceIds.map((instanceId) => {
      const inst = mockWorkflowInstances.find((i) => i.id === instanceId);
      if (!inst) return { instanceId, success: false, message: '流程实例不存在' };
      if (inst.status !== 'running') return { instanceId, success: false, message: '只能撤回进行中的申请' };
      inst.status = 'withdrawn'; inst.updatedAt = mockDateTime();
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
    const src = mockWorkflowDefinitions.find((d) => d.id === params.id);
    if (!src) return notFound('流程定义不存在');
    const now = mockDateTime();
    const def: WorkflowDefinition = { ...src, id: getNextDefinitionId(), name: `${src.name} 副本`, status: 'draft', version: 0, createdAt: now, updatedAt: now };
    mockWorkflowDefinitions.push(def);
    return ok(def, '已复制为新草稿');
  }),
  mock(workflowDefinitionContract.export, ({ params, ok }) => {
    const src = mockWorkflowDefinitions.find((d) => d.id === params.id);
    if (!src) return notFound('流程定义不存在');
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
    const src = mockWorkflowDefinitions.find((d) => d.id === params.id);
    if (!src) return notFound('流程定义不存在');
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
  mock(workflowDefinitionContract.preview, ({ ok }) => ok(APPROVER_PREVIEW)),

  // ── 主动抄送 / 转发 ──
  mock(workflowInstanceContract.forward, ({ body, ok }) => ok(null, `已抄送 ${body.userIds.length} 人`)),

  // ── 关联审批单候选 ──
  mock(workflowInstanceContract.relationOptions, ({ query, ok }) => {
    const keyword = (query.keyword ?? '').toLowerCase();
    let all = mockWorkflowInstances.filter((i) => i.status !== 'draft');
    if (query.definitionId) all = all.filter((i) => i.definitionId === query.definitionId);
    if (keyword) all = all.filter((i) => i.title.toLowerCase().includes(keyword) || (i.serialNo ?? '').toLowerCase().includes(keyword));
    return ok(all.slice(0, 20).map((i) => ({
      instanceId: i.id, title: i.title, serialNo: i.serialNo ?? null,
      definitionName: i.definitionName ?? null, status: i.status, createdAt: i.createdAt,
    })));
  }),

  // ── 列表保存视图 ──
  mock(workflowSavedViewContract.list, ({ query, ok }) => ok(mockSavedViews.filter((v) => v.pageKey === query.pageKey))),
  mock(workflowSavedViewContract.create, ({ body, ok }) => {
    const now = mockDateTime();
    const view: WorkflowSavedView = { id: nextSavedViewId++, userId: 1, pageKey: body.pageKey, name: body.name, filters: body.filters, isDefault: body.isDefault ?? false, sort: body.sort ?? 0, createdAt: now, updatedAt: now };
    mockSavedViews.push(view);
    return ok(view, '已保存');
  }),
  mock(workflowSavedViewContract.update, ({ params, body, ok }) => {
    const v = mockSavedViews.find((x) => x.id === params.id);
    if (!v) return notFound('视图不存在');
    Object.assign(v, body, { updatedAt: mockDateTime() });
    return ok(v, '已更新');
  }),
  mock(workflowSavedViewContract.remove, ({ params, ok }) => {
    const idx = mockSavedViews.findIndex((x) => x.id === params.id);
    if (idx === -1) return notFound('视图不存在');
    mockSavedViews.splice(idx, 1);
    return ok(null, '已删除');
  }),

  // ── 定时发起 ──
  mock(workflowScheduleContract.list, ({ ok, paginate }) => ok(paginate(mockSchedules))),
  mock(workflowScheduleContract.create, ({ body, ok }) => {
    const def = mockWorkflowDefinitions.find((d) => d.id === body.definitionId);
    const now = mockDateTime();
    const s: WorkflowSchedule = {
      id: nextScheduleId++, definitionId: body.definitionId, definitionName: def?.name ?? null,
      name: body.name, cronExpression: body.cronExpression, timezone: body.timezone ?? null, initiatorId: body.initiatorId, initiatorName: `用户#${body.initiatorId}`,
      titleTemplate: body.titleTemplate ?? null, formData: body.formData ?? null, status: body.status,
      lastRunAt: null, lastRunStatus: null, lastRunMessage: null, nextRunAt: mockDateTime(), tenantId: null, createdAt: now, updatedAt: now,
    };
    mockSchedules.push(s);
    return ok(s, '已创建');
  }),
  mock(workflowScheduleContract.update, ({ params, body, ok }) => {
    const s = mockSchedules.find((x) => x.id === params.id);
    if (!s) return notFound('定时规则不存在');
    Object.assign(s, body, { updatedAt: mockDateTime() });
    if (body.definitionId) s.definitionName = mockWorkflowDefinitions.find((d) => d.id === body.definitionId)?.name ?? null;
    return ok(s, '已更新');
  }),
  mock(workflowScheduleContract.remove, ({ params, ok }) => {
    const idx = mockSchedules.findIndex((x) => x.id === params.id);
    if (idx === -1) return notFound('定时规则不存在');
    mockSchedules.splice(idx, 1);
    return ok(null, '已删除');
  }),
  mock(workflowScheduleContract.run, ({ params, ok }) => {
    const s = mockSchedules.find((x) => x.id === params.id);
    if (!s) return notFound('定时规则不存在');
    s.lastRunAt = mockDateTime(); s.lastRunStatus = 'success'; s.lastRunMessage = `已发起：${s.name}`;
    return ok(s, '已触发一次执行');
  }),

  // ── 我的协办（必须在 /instances/:id 之前注册）──
  mock(workflowTaskContract.myConsults, ({ ok, paginate }) => {
    const all = mockConsults.filter((c) => c.consulteeId === 1);
    return ok(paginate(all));
  }),
  mock(workflowTaskContract.replyConsult, ({ params, body, ok }) => {
    const c = mockConsults.find((x) => x.id === params.id);
    if (!c) return notFound('协办记录不存在');
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
    const tpl = mockTemplates.find((t) => t.id === params.id);
    if (!tpl) return notFound('模板不存在');
    const name = body.name || tpl.name;
    const description: string | null = body.description !== undefined ? (body.description?.trim() || null) : (tpl.description ?? null);
    const categoryId: number | null = body.categoryId ?? null;
    const now = mockDateTime();
    const def: WorkflowDefinition = { ...mockWorkflowDefinitions[0], id: getNextDefinitionId(), name, description, categoryId, status: 'draft', version: 1, flowData: tpl.flowData, createdAt: now, updatedAt: now };
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
    const idx = mockTemplates.findIndex((t) => t.id === params.id);
    if (idx === -1) return notFound('模板不存在');
    if (mockTemplates[idx].builtin) return badRequest('系统内置模板不可删除');
    mockTemplates.splice(idx, 1);
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
  mock(workflowTaskContract.recall, ({ params, ok }) => {
    const task = mockWorkflowTasks.find((t) => t.id === params.taskId);
    if (!task) return notFound('任务不存在');
    if (task.assigneeId !== 1) return forbidden('只能撤回自己处理的任务');
    if (task.status !== 'approved' && task.status !== 'rejected') return badRequest('只有已处理的任务可撤回');
    task.status = 'pending'; task.comment = null; task.signature = null; task.actionAt = null;
    const inst = mockWorkflowInstances.find((i) => i.id === task.instanceId);
    if (inst) { inst.status = 'running'; inst.updatedAt = mockDateTime(); return ok(inst, '已撤回'); }
    return fail(500, '流程数据异常');
  }),

  // ── 超时待办预警 ──
  mock(workflowInstanceContract.overdue, ({ ok, paginate }) => ok(paginate(buildOverdueList()))),

  // ── 流程评论 ──
  mock(workflowInstanceContract.comments, ({ params, ok }) => ok(mockComments.filter((c) => c.instanceId === params.id))),
  mock(workflowInstanceContract.addComment, ({ params, body, ok }) => {
    // 回复引用：父评论须属于同一实例
    const parent = body.parentId
      ? mockComments.find((c) => c.id === body.parentId && c.instanceId === params.id) ?? null
      : null;
    if (body.parentId && !parent) return badRequest('被回复的评论不存在');
    const comment: WorkflowComment = {
      id: nextCommentId++,
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
      attachments: body.attachments ?? [],
      createdAt: mockDateTime(),
    };
    mockComments.push(comment);
    return ok(comment, '已评论');
  }),

  // ── 草稿：编辑 / 提交 / 重新提交 ──
  mock(workflowInstanceContract.updateDraft, ({ params, body, ok }) => {
    const inst = mockWorkflowInstances.find((i) => i.id === params.id);
    if (!inst) return notFound('流程实例不存在');
    if (inst.status !== 'draft') return badRequest('仅草稿可编辑');
    if (body.title !== undefined) inst.title = body.title;
    if (body.formData !== undefined) inst.formData = body.formData;
    inst.updatedAt = mockDateTime();
    return ok(inst, '草稿已保存');
  }),
  mock(workflowInstanceContract.submitDraft, ({ params, ok }) => {
    const inst = mockWorkflowInstances.find((i) => i.id === params.id);
    if (!inst) return notFound('流程实例不存在');
    if (inst.status !== 'draft') return badRequest('仅草稿可提交');
    inst.status = 'running';
    inst.updatedAt = mockDateTime();
    return ok(inst, '申请已提交');
  }),
  mock(workflowInstanceContract.resubmit, ({ params, ok }) => {
    const src = mockWorkflowInstances.find((i) => i.id === params.id);
    if (!src) return notFound('流程实例不存在');
    const now = mockDateTime();
    const clone: WorkflowInstance = {
      ...src,
      id: getNextInstanceId(),
      serialNo: null,
      status: 'draft',
      currentNodeKey: null,
      tasks: [],
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
    const inst = mockWorkflowInstances.find((i) => i.id === params.id);
    if (!inst) return notFound('流程实例不存在');
    return ok({ instanceId: inst.id, fromVersion: 1, toVersion: 1, migratable: false, blocked: [], nodes: [] });
  }),
  mock(workflowInstanceOpsContract.migrate, ({ params, ok }) => {
    const inst = mockWorkflowInstances.find((i) => i.id === params.id);
    if (!inst) return notFound('流程实例不存在');
    return ok(null, '迁移成功');
  }),
  mock(workflowInstanceOpsContract.migrations, ({ ok }) => ok([])),

  // ── 管理员强制操作 ──
  mock(workflowInstanceOpsContract.jump, ({ params, body, ok }) => {
    const inst = mockWorkflowInstances.find((i) => i.id === params.id);
    if (!inst) return notFound('流程实例不存在');
    if (inst.status !== 'running') return badRequest('仅审批中的流程可强制跳转');
    mockWorkflowTasks.filter((t) => t.instanceId === inst.id && (t.status === 'pending' || t.status === 'waiting'))
      .forEach((t) => { t.status = 'skipped'; t.actionAt = mockDateTime(); });
    inst.currentNodeKey = body.targetNodeKey;
    inst.updatedAt = mockDateTime();
    return ok(inst, '已跳转');
  }),
  mock(workflowTaskContract.reassign, ({ params, body, ok }) => {
    const task = mockWorkflowTasks.find((t) => t.id === params.taskId);
    if (!task) return notFound('任务不存在');
    task.assigneeId = body.targetUserId;
    task.assigneeName = getMockUserName(body.targetUserId);
    return ok(task, '已改派');
  }),

  // ── 批量审批 ──
  mock(workflowTaskContract.batchApprove, ({ body, request, ok }) => {
    const idempotencyKey = request.headers.get('X-Idempotency-Key');
    const cached = idempotencyKey ? batchActionCache.get(idempotencyKey) : undefined;
    if (cached) return ok(cached.data, cached.message);
    const { taskIds, comment } = body;
    const results = taskIds.map((taskId) => {
      const task = mockWorkflowTasks.find((t) => t.id === taskId);
      if (task && task.status === 'pending') {
        const now = mockDateTime();
        task.status = 'approved'; task.comment = comment ?? null; task.actionAt = now;
        syncInstanceApprovedIfComplete(task.instanceId, now);
        return { taskId, success: true };
      }
      return { taskId, success: false, message: '任务不存在或已处理' };
    });
    const succeeded = results.filter((r) => r.success).length;
    const data: WorkflowBatchActionResponse = { succeeded, failed: results.length - succeeded, results };
    const message = `成功 ${succeeded} 条`;
    if (idempotencyKey) batchActionCache.set(idempotencyKey, { data, message });
    return ok(data, message);
  }),
  mock(workflowTaskContract.batchReject, ({ body, request, ok }) => {
    const idempotencyKey = request.headers.get('X-Idempotency-Key');
    const cached = idempotencyKey ? batchActionCache.get(idempotencyKey) : undefined;
    if (cached) return ok(cached.data, cached.message);
    const { taskIds, comment } = body;
    const results = taskIds.map((taskId) => {
      const task = mockWorkflowTasks.find((t) => t.id === taskId);
      if (task && task.status === 'pending') {
        const now = mockDateTime();
        task.status = 'rejected'; task.comment = comment; task.actionAt = now;
        const inst = mockWorkflowInstances.find((i) => i.id === task.instanceId);
        if (inst) {
          inst.status = 'rejected';
          inst.currentNodeKey = null;
          inst.updatedAt = now;
          mockWorkflowTasks
            .filter((item) => item.instanceId === inst.id && (item.status === 'pending' || item.status === 'waiting'))
            .forEach((item) => {
              if (item.id !== task.id) {
                item.status = 'skipped';
                item.actionAt = now;
              }
            });
        }
        return { taskId, success: true };
      }
      return { taskId, success: false, message: '任务不存在或已处理' };
    });
    const succeeded = results.filter((r) => r.success).length;
    const data: WorkflowBatchActionResponse = { succeeded, failed: results.length - succeeded, results };
    const message = `成功 ${succeeded} 条`;
    if (idempotencyKey) batchActionCache.set(idempotencyKey, { data, message });
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
    const p = mockQuickPhrases.find((x) => x.id === params.id);
    if (!p) return notFound('常用语不存在');
    if (body.content !== undefined) p.content = body.content;
    if (body.sort !== undefined) p.sort = body.sort;
    p.updatedAt = mockDateTime();
    return ok(p, '已更新');
  }),
  mock(workflowQuickPhraseContract.remove, ({ params, ok }) => {
    const idx = mockQuickPhrases.findIndex((x) => x.id === params.id);
    if (idx === -1) return notFound('常用语不存在');
    mockQuickPhrases.splice(idx, 1);
    return ok(null, '已删除');
  }),

  // ── 审批代理 / 离岗委托 ──
  mock(workflowDelegationContract.list, ({ ok, paginate }) => ok(paginate(mockDelegations))),
  mock(workflowDelegationContract.create, ({ body, ok }) => {
    const now = mockDateTime();
    const row: WorkflowDelegation = {
      id: nextDelegationId++,
      principalId: body.principalId ?? 1,
      principalName: getMockUserName(body.principalId ?? 1),
      delegateId: body.delegateId,
      delegateName: getMockUserName(body.delegateId),
      definitionId: body.definitionId ?? null,
      definitionName: getMockDefinitionName(body.definitionId),
      mode: body.mode,
      reason: body.reason ?? null,
      startAt: body.startAt ?? null,
      endAt: body.endAt ?? null,
      enabled: body.enabled,
      active: body.enabled,
      createdAt: now,
      updatedAt: now,
    };
    mockDelegations.push(row);
    return ok(row, '已新增');
  }),
  mock(workflowDelegationContract.update, ({ params, body, ok }) => {
    const row = mockDelegations.find((x) => x.id === params.id);
    if (!row) return notFound('委托规则不存在');
    Object.assign(row, body, { updatedAt: mockDateTime() });
    if (body.enabled !== undefined) row.active = body.enabled;
    return ok(row, '已更新');
  }),
  mock(workflowDelegationContract.remove, ({ params, ok }) => {
    const idx = mockDelegations.findIndex((x) => x.id === params.id);
    if (idx === -1) return notFound('委托规则不存在');
    mockDelegations.splice(idx, 1);
    return ok(null, '已删除');
  }),
];
