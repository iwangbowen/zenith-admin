import { http, HttpResponse } from 'msw';
import type {
  WorkflowComment, WorkflowQuickPhrase, WorkflowDelegation, WorkflowAnalytics,
  WorkflowInstanceStatus, WorkflowOverdueTask, WorkflowTemplate, WorkflowTaskConsult,
  WorkflowDefinition, WorkflowInstance,
} from '@zenith/shared';
import { SEED_WORKFLOW_TEMPLATES } from '@zenith/shared';
import { mockWorkflowInstances, mockWorkflowTasks, getNextInstanceId, getNextDefinitionId } from '@/mocks/data/workflow';
import { mockWorkflowDefinitions } from '@/mocks/data/workflow';
import { mockUsers } from '@/mocks/data/users';
import { mockDateTime } from '@/mocks/utils/date';

function ok<T>(data: T, message = 'ok') {
  return HttpResponse.json({ code: 0, message, data });
}
function err(message: string, code = 400) {
  return HttpResponse.json({ code, message });
}

type MockApiPayload<T = unknown> = { code: number; message: string; data: T };
const idempotencyCache = new Map<string, MockApiPayload>();

function readIdempotentResponse(request: Request) {
  const key = request.headers.get('X-Idempotency-Key');
  const payload = key ? idempotencyCache.get(key) : undefined;
  return payload ? HttpResponse.json(payload) : null;
}

function okIdempotent<T>(request: Request, data: T, message = 'ok') {
  const payload: MockApiPayload<T> = { code: 0, message, data };
  const key = request.headers.get('X-Idempotency-Key');
  if (key) idempotencyCache.set(key, payload);
  return HttpResponse.json(payload);
}

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

// ── Round-3 内存态 ──
const ccReadState = new Set<number>();
interface MockSavedView { id: number; userId: number; pageKey: string; name: string; filters: Record<string, unknown>; isDefault: boolean; sort: number; createdAt: string; updatedAt: string }
const mockSavedViews: MockSavedView[] = [];
let nextSavedViewId = 1;
interface MockSchedule { id: number; definitionId: number; definitionName: string | null; name: string; cronExpression: string; initiatorId: number; initiatorName: string | null; titleTemplate: string | null; formData: Record<string, unknown> | null; status: 'enabled' | 'disabled'; lastRunAt: string | null; lastRunStatus: string | null; lastRunMessage: string | null; nextRunAt: string | null; tenantId: number | null; createdAt: string; updatedAt: string }
const mockSchedules: MockSchedule[] = [];
let nextScheduleId = 1;

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
    return { date, created: Math.floor(Math.random() * 4), completed: Math.floor(Math.random() * 3) };
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

export const workflowExtraHandlers = [
  // ── 数据分析（必须在 /instances/:id 之前注册）──
  http.get('/api/workflows/instances/analytics', () => ok(buildAnalytics())),

  // ── G1 抄送我的（必须在 /instances/:id 之前注册）──
  http.get('/api/workflows/instances/cc-mine', ({ request }) => {
    const url = new URL(request.url);
    const page = Number(url.searchParams.get('page') ?? 1);
    const pageSize = Number(url.searchParams.get('pageSize') ?? 20);
    const keyword = (url.searchParams.get('keyword') ?? '').toLowerCase();
    let all = mockWorkflowInstances.filter((i) => i.status !== 'draft');
    if (keyword) all = all.filter((i) => i.title.toLowerCase().includes(keyword) || (i.definitionName ?? '').toLowerCase().includes(keyword));
    const list = all.map((i, idx) => {
      const ccTaskId = 90000 + idx;
      return { ...i, ccTaskId, ccReadAt: ccReadState.has(ccTaskId) ? mockDateTime() : null } as WorkflowInstance;
    });
    return ok({ list: list.slice((page - 1) * pageSize, page * pageSize), total: list.length, page, pageSize });
  }),
  http.get('/api/workflows/instances/cc-mine/unread-count', () => {
    const total = mockWorkflowInstances.filter((i) => i.status !== 'draft').length;
    return ok({ count: Math.max(0, total - ccReadState.size) });
  }),
  http.post('/api/workflows/instances/cc/:ccTaskId/read', ({ params }) => {
    ccReadState.add(Number(params.ccTaskId));
    return ok(null, '已标记已读');
  }),

  // ── G2 我已办（必须在 /instances/:id 之前注册）──
  http.get('/api/workflows/instances/handled-mine', ({ request }) => {
    const url = new URL(request.url);
    const page = Number(url.searchParams.get('page') ?? 1);
    const pageSize = Number(url.searchParams.get('pageSize') ?? 20);
    const keyword = (url.searchParams.get('keyword') ?? '').toLowerCase();
    let all = mockWorkflowInstances.filter((i) => i.status === 'approved' || i.status === 'rejected');
    if (keyword) all = all.filter((i) => i.title.toLowerCase().includes(keyword) || (i.definitionName ?? '').toLowerCase().includes(keyword));
    const list = all.map((i) => ({
      ...i,
      myTaskStatus: i.status === 'approved' ? 'approved' : 'rejected',
      myActionAt: i.updatedAt,
    } as WorkflowInstance));
    return ok({ list: list.slice((page - 1) * pageSize, page * pageSize), total: list.length, page, pageSize });
  }),

  // ── G8 批量撤回 / 批量催办（必须在 /instances/:id 之前注册）──
  http.post('/api/workflows/instances/batch-withdraw', async ({ request }) => {
    const body = await request.json() as { instanceIds: number[]; comment?: string };
    const results = (body.instanceIds ?? []).map((instanceId) => {
      const inst = mockWorkflowInstances.find((i) => i.id === instanceId);
      if (!inst) return { instanceId, success: false, message: '流程实例不存在' };
      if (inst.status !== 'running') return { instanceId, success: false, message: '只能撤回进行中的申请' };
      inst.status = 'withdrawn'; inst.updatedAt = mockDateTime();
      return { instanceId, success: true };
    });
    const succeeded = results.filter((r) => r.success).length;
    return ok({ succeeded, failed: results.length - succeeded, results }, `成功 ${succeeded} 条，失败 ${results.length - succeeded} 条`);
  }),
  http.post('/api/workflows/instances/batch-urge', async ({ request }) => {
    const body = await request.json() as { instanceIds: number[]; message?: string };
    const results = (body.instanceIds ?? []).map((instanceId) => {
      const inst = mockWorkflowInstances.find((i) => i.id === instanceId);
      if (!inst) return { instanceId, success: false, message: '流程不存在' };
      if (inst.status !== 'running') return { instanceId, success: false, message: '流程已结束，无需催办' };
      return { instanceId, success: true, message: '已催办 1 人' };
    });
    const succeeded = results.filter((r) => r.success).length;
    return ok({ succeeded, failed: results.length - succeeded, results }, `成功 ${succeeded} 条，失败 ${results.length - succeeded} 条`);
  }),

  // ── G4 复制流程 / G5 导出导入 / G6 版本对比（必须在 /definitions/:id 之前注册）──
  http.post('/api/workflows/definitions/:id/duplicate', ({ params }) => {
    const src = mockWorkflowDefinitions.find((d) => d.id === Number(params.id));
    if (!src) return err('流程定义不存在', 404);
    const now = mockDateTime();
    const def = { ...src, id: getNextDefinitionId(), name: `${src.name} 副本`, status: 'draft' as const, version: 0, createdAt: now, updatedAt: now };
    mockWorkflowDefinitions.push(def as typeof mockWorkflowDefinitions[number]);
    return ok(def, '已复制为新草稿');
  }),
  http.get('/api/workflows/definitions/:id/export', ({ params }) => {
    const src = mockWorkflowDefinitions.find((d) => d.id === Number(params.id));
    if (!src) return err('流程定义不存在', 404);
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
  http.post('/api/workflows/definitions/import', async ({ request }) => {
    const body = await request.json() as { name: string; description?: string | null; categoryName?: string | null; flowData?: unknown; formType?: WorkflowDefinition['formType']; customForm?: WorkflowDefinition['customForm']; form?: { schema?: { fields?: unknown[] } } | null };
    const formType = body.formType ?? 'designer';
    const now = mockDateTime();
    const def = {
      ...(mockWorkflowDefinitions[0] ?? {}),
      id: getNextDefinitionId(),
      name: body.name,
      description: body.description ?? null,
      status: 'draft' as const,
      version: 0,
      flowData: body.flowData ?? null,
      formId: formType === 'designer' ? (mockWorkflowDefinitions[0]?.formId ?? null) : null,
      formFields: formType === 'designer' ? body.form?.schema?.fields ?? null : null,
      formType,
      customForm: formType === 'designer' ? null : body.customForm ?? null,
      createdAt: now,
      updatedAt: now,
    };
    mockWorkflowDefinitions.push(def as typeof mockWorkflowDefinitions[number]);
    return ok(def, '已导入为新草稿');
  }),
  http.get('/api/workflows/definitions/:id/diff', ({ params, request }) => {
    const src = mockWorkflowDefinitions.find((d) => d.id === Number(params.id));
    if (!src) return err('流程定义不存在', 404);
    const url = new URL(request.url);
    const leftV = Number(url.searchParams.get('left') ?? 0);
    const rightV = Number(url.searchParams.get('right') ?? 0);
    const side = (v: number) => ({
      version: v === 0 ? (src.version ?? 1) : v,
      name: src.name,
      label: v === 0 ? `当前（v${src.version ?? 1}）` : `v${v}`,
      flowData: src.flowData ?? null,
      publishedAt: v === 0 ? null : mockDateTime(),
    });
    return ok({
      left: side(leftV),
      right: side(rightV),
      summary: { nodesAdded: 1, nodesRemoved: 0, nodesModified: 1, edgesAdded: 1, edgesRemoved: 0, edgesModified: 1 },
      nodeChanges: [
        { kind: 'added', nodeKey: 'cc_finance', nodeName: '抄送财务', nodeType: '抄送', fields: [] },
        { kind: 'modified', nodeKey: 'approver_1', nodeName: '审批人', nodeType: '审批', fields: [
          { field: '审批人', before: '角色(1)', after: '指定成员(2)' },
          { field: '超时策略', before: '关闭', after: '24小时 · 提醒' },
        ] },
      ],
      edgeChanges: [
        { kind: 'added', from: '审批人', to: '抄送财务', before: null, after: '无条件' },
        { kind: 'modified', from: '条件分支', to: '结束', before: 'amount gt 1000', after: 'amount gt 5000' },
      ],
    });
  }),

  // ── T1-1 提交前审批链路预览 ──
  http.post('/api/workflows/definitions/:id/preview', () => ok([
    { nodeKey: '__initiator__', nodeName: '发起人', nodeType: 'start', approvers: [{ id: 1, name: '张三' }], approveMethod: null, branchLabel: null, empty: false },
    { nodeKey: 'approve_manager', nodeName: '直属主管审批', nodeType: 'approve', approvers: [{ id: 2, name: '李四' }], approveMethod: 'or', branchLabel: null, empty: false },
    { nodeKey: 'approve_dept_head', nodeName: '部门负责人审批', nodeType: 'approve', approvers: [{ id: 3, name: '王五' }], approveMethod: 'and', branchLabel: null, empty: false },
    { nodeKey: 'cc_initiator', nodeName: '抄送发起人', nodeType: 'ccNode', approvers: [{ id: 1, name: '张三' }], approveMethod: null, branchLabel: null, empty: false },
  ])),

  // ── T1-2 主动抄送 / 转发 ──
  http.post('/api/workflows/instances/:id/forward', async ({ request }) => {
    const body = await request.json().catch(() => ({})) as { userIds?: number[] };
    const n = (body.userIds ?? []).length;
    return ok(null, `已抄送 ${n} 人`);
  }),

  // ── T2-2 关联审批单候选 ──
  http.get('/api/workflows/instances/relation-options', ({ request }) => {
    const url = new URL(request.url);
    const keyword = (url.searchParams.get('keyword') ?? '').toLowerCase();
    const definitionId = url.searchParams.get('definitionId');
    let all = mockWorkflowInstances.filter((i) => i.status !== 'draft');
    if (definitionId) all = all.filter((i) => i.definitionId === Number(definitionId));
    if (keyword) all = all.filter((i) => i.title.toLowerCase().includes(keyword) || (i.serialNo ?? '').toLowerCase().includes(keyword));
    return ok(all.slice(0, 20).map((i) => ({
      instanceId: i.id, title: i.title, serialNo: i.serialNo ?? null,
      definitionName: i.definitionName ?? null, status: i.status, createdAt: i.createdAt,
    })));
  }),

  // ── T1-3 列表保存视图 ──
  http.get('/api/workflows/saved-views', ({ request }) => {
    const url = new URL(request.url);
    const pageKey = url.searchParams.get('pageKey') ?? '';
    return ok(mockSavedViews.filter((v) => v.pageKey === pageKey));
  }),
  http.post('/api/workflows/saved-views', async ({ request }) => {
    const body = await request.json() as { pageKey: string; name: string; filters?: Record<string, unknown>; isDefault?: boolean; sort?: number };
    const now = mockDateTime();
    const view: MockSavedView = { id: nextSavedViewId++, userId: 1, pageKey: body.pageKey, name: body.name, filters: body.filters ?? {}, isDefault: body.isDefault ?? false, sort: body.sort ?? 0, createdAt: now, updatedAt: now };
    mockSavedViews.push(view);
    return ok(view, '已保存');
  }),
  http.put('/api/workflows/saved-views/:id', async ({ params, request }) => {
    const v = mockSavedViews.find((x) => x.id === Number(params.id));
    if (!v) return err('视图不存在', 404);
    const body = await request.json() as Partial<MockSavedView>;
    Object.assign(v, body, { updatedAt: mockDateTime() });
    return ok(v, '已更新');
  }),
  http.delete('/api/workflows/saved-views/:id', ({ params }) => {
    const idx = mockSavedViews.findIndex((x) => x.id === Number(params.id));
    if (idx === -1) return err('视图不存在', 404);
    mockSavedViews.splice(idx, 1);
    return ok(null, '已删除');
  }),

  // ── T2-1 定时发起 ──
  http.get('/api/workflows/schedules', ({ request }) => {
    const url = new URL(request.url);
    const page = Number(url.searchParams.get('page') ?? 1);
    const pageSize = Number(url.searchParams.get('pageSize') ?? 20);
    return ok({ list: mockSchedules.slice((page - 1) * pageSize, page * pageSize), total: mockSchedules.length, page, pageSize });
  }),
  http.post('/api/workflows/schedules', async ({ request }) => {
    const body = await request.json() as { definitionId: number; name: string; cronExpression: string; initiatorId: number; titleTemplate?: string | null; formData?: Record<string, unknown> | null; status?: 'enabled' | 'disabled' };
    const def = mockWorkflowDefinitions.find((d) => d.id === body.definitionId);
    const now = mockDateTime();
    const s: MockSchedule = {
      id: nextScheduleId++, definitionId: body.definitionId, definitionName: def?.name ?? null,
      name: body.name, cronExpression: body.cronExpression, initiatorId: body.initiatorId, initiatorName: `用户#${body.initiatorId}`,
      titleTemplate: body.titleTemplate ?? null, formData: body.formData ?? null, status: body.status ?? 'enabled',
      lastRunAt: null, lastRunStatus: null, lastRunMessage: null, nextRunAt: mockDateTime(), tenantId: null, createdAt: now, updatedAt: now,
    };
    mockSchedules.push(s);
    return ok(s, '已创建');
  }),
  http.put('/api/workflows/schedules/:id', async ({ params, request }) => {
    const s = mockSchedules.find((x) => x.id === Number(params.id));
    if (!s) return err('定时规则不存在', 404);
    const body = await request.json() as Partial<MockSchedule>;
    Object.assign(s, body, { updatedAt: mockDateTime() });
    if (body.definitionId) s.definitionName = mockWorkflowDefinitions.find((d) => d.id === body.definitionId)?.name ?? null;
    return ok(s, '已更新');
  }),
  http.delete('/api/workflows/schedules/:id', ({ params }) => {
    const idx = mockSchedules.findIndex((x) => x.id === Number(params.id));
    if (idx === -1) return err('定时规则不存在', 404);
    mockSchedules.splice(idx, 1);
    return ok(null, '已删除');
  }),
  http.post('/api/workflows/schedules/:id/run', ({ params }) => {
    const s = mockSchedules.find((x) => x.id === Number(params.id));
    if (!s) return err('定时规则不存在', 404);
    s.lastRunAt = mockDateTime(); s.lastRunStatus = 'success'; s.lastRunMessage = `已发起：${s.name}`;
    return ok(s, '已触发一次执行');
  }),

  // ── 我的协办（必须在 /instances/:id 之前注册）──
  http.get('/api/workflows/instances/consults/mine', ({ request }) => {
    const url = new URL(request.url);
    const page = Number(url.searchParams.get('page') ?? 1);
    const pageSize = Number(url.searchParams.get('pageSize') ?? 20);
    const all = mockConsults.filter((c) => c.consulteeId === 1);
    return ok({ list: all.slice((page - 1) * pageSize, page * pageSize), total: all.length, page, pageSize });
  }),
  http.post('/api/workflows/instances/consults/:id/reply', async ({ params, request }) => {
    const body = await request.json() as { opinion: string };
    const c = mockConsults.find((x) => x.id === Number(params.id));
    if (!c) return err('协办记录不存在', 404);
    c.opinion = body.opinion; c.status = 'replied'; c.repliedAt = mockDateTime();
    return ok(c, '已回复');
  }),

  // ── 流程模板 ──
  http.get('/api/workflows/templates', () => ok(mockTemplates)),
  http.post('/api/workflows/templates/save-as', async ({ request }) => {
    const body = await request.json() as { definitionId?: number; name: string; description?: string; icon?: string; color?: string };
    const src = body.definitionId ? mockWorkflowDefinitions.find((item) => item.id === body.definitionId) : undefined;
    if (src && src.formType !== 'designer') {
      return err('模板库暂仅支持表单库设计器流程；自定义业务表单或业务系统主导流程请使用复制流程或导出导入复用');
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
  http.post('/api/workflows/templates/:id/clone', async ({ params, request }) => {
    const tpl = mockTemplates.find((t) => t.id === Number(params.id));
    if (!tpl) return err('模板不存在', 404);
    let name = tpl.name;
    let categoryId: number | null = null;
    try {
      const b = await request.json() as { name?: string; categoryId?: number | null };
      if (b?.name) name = b.name;
      categoryId = b?.categoryId ?? null;
    } catch { /* no body */ }
    const now = mockDateTime();
    const def = { ...(mockWorkflowDefinitions[0] ?? {}), id: getNextDefinitionId(), name, categoryId, status: 'draft' as const, version: 1, flowData: tpl.flowData, createdAt: now, updatedAt: now };
    mockWorkflowDefinitions.push(def as typeof mockWorkflowDefinitions[number]);
    return ok(def, '已创建');
  }),
  http.put('/api/workflows/templates/:id', async ({ params, request }) => {
    const idx = mockTemplates.findIndex((t) => t.id === Number(params.id));
    if (idx === -1) return err('模板不存在', 404);
    const body = await request.json() as Partial<WorkflowTemplate>;
    mockTemplates[idx] = {
      ...mockTemplates[idx],
      ...('name' in body ? { name: body.name ?? mockTemplates[idx].name } : {}),
      ...('code' in body ? { code: body.code ?? null } : {}),
      ...('description' in body ? { description: body.description ?? null } : {}),
      ...('categoryName' in body ? { categoryName: body.categoryName ?? null } : {}),
      ...('icon' in body ? { icon: body.icon ?? null } : {}),
      ...('color' in body ? { color: body.color ?? null } : {}),
      ...('sort' in body ? { sort: body.sort ?? 0 } : {}),
      updatedAt: mockDateTime(),
    };
    return ok(mockTemplates[idx], '已更新');
  }),
  http.delete('/api/workflows/templates/:id', ({ params }) => {
    const idx = mockTemplates.findIndex((t) => t.id === Number(params.id));
    if (idx === -1) return err('模板不存在', 404);
    if (mockTemplates[idx].builtin) return err('系统内置模板不可删除');
    mockTemplates.splice(idx, 1);
    return ok(null, '已删除');
  }),

  // ── 协办 / 撤回 ──
  http.post('/api/workflows/tasks/:taskId/consult', async ({ params, request }) => {
    const body = await request.json() as { consulteeIds: number[]; question?: string };
    const task = mockWorkflowTasks.find((t) => t.id === Number(params.taskId));
    const created = (body.consulteeIds ?? []).map((cid) => {
      const c: WorkflowTaskConsult = { id: nextConsultId++, taskId: Number(params.taskId), instanceId: task?.instanceId ?? 0, nodeName: task?.nodeName ?? null, inviterId: 1, inviterName: '张三', consulteeId: cid, consulteeName: `用户#${cid}`, question: body.question ?? null, opinion: null, status: 'pending', repliedAt: null, createdAt: mockDateTime() };
      mockConsults.push(c);
      return c;
    });
    return ok(created, '已发起协办');
  }),
  http.post('/api/workflows/tasks/:taskId/recall', ({ params }) => {
    const task = mockWorkflowTasks.find((t) => t.id === Number(params.taskId));
    if (!task) return err('任务不存在', 404);
    if (task.assigneeId !== 1) return err('只能撤回自己处理的任务', 403);
    if (task.status !== 'approved' && task.status !== 'rejected') return err('只有已处理的任务可撤回');
    task.status = 'pending'; task.comment = null; task.signature = null; task.actionAt = null;
    const inst = mockWorkflowInstances.find((i) => i.id === task.instanceId);
    if (inst) { inst.status = 'running'; inst.updatedAt = mockDateTime(); return ok(inst, '已撤回'); }
    return err('流程数据异常', 500);
  }),

  // ── 超时待办预警 ──
  http.get('/api/workflows/instances/overdue', ({ request }) => {
    const url = new URL(request.url);
    const page = Number(url.searchParams.get('page') ?? 1);
    const pageSize = Number(url.searchParams.get('pageSize') ?? 20);
    const all = buildOverdueList();
    return ok({ list: all.slice((page - 1) * pageSize, page * pageSize), total: all.length, page, pageSize });
  }),

  // ── 流程评论 ──
  http.get('/api/workflows/instances/:id/comments', ({ params }) => {
    const list = mockComments.filter((c) => c.instanceId === Number(params.id));
    return ok(list);
  }),
  http.post('/api/workflows/instances/:id/comments', async ({ params, request }) => {
    const body = await request.json() as { content: string; mentions?: number[]; taskId?: number | null };
    const comment: WorkflowComment = {
      id: nextCommentId++,
      instanceId: Number(params.id),
      taskId: body.taskId ?? null,
      userId: 1,
      userName: '张三',
      userAvatar: null,
      content: body.content,
      mentions: body.mentions ?? [],
      mentionNames: (body.mentions ?? []).map((m) => `用户#${m}`),
      attachments: [],
      createdAt: mockDateTime(),
    };
    mockComments.push(comment);
    return ok(comment, '已评论');
  }),

  // ── 草稿：编辑 / 提交 / 重新提交 ──
  http.put('/api/workflows/instances/:id/draft', async ({ params, request }) => {
    const body = await request.json() as { title?: string; formData?: Record<string, unknown> };
    const inst = mockWorkflowInstances.find((i) => i.id === Number(params.id));
    if (!inst) return err('流程实例不存在', 404);
    if (inst.status !== 'draft') return err('仅草稿可编辑');
    if (body.title !== undefined) inst.title = body.title;
    if (body.formData !== undefined) inst.formData = body.formData;
    inst.updatedAt = mockDateTime();
    return ok(inst, '草稿已保存');
  }),
  http.post('/api/workflows/instances/:id/submit', ({ params }) => {
    const inst = mockWorkflowInstances.find((i) => i.id === Number(params.id));
    if (!inst) return err('流程实例不存在', 404);
    if (inst.status !== 'draft') return err('仅草稿可提交');
    inst.status = 'running';
    inst.updatedAt = mockDateTime();
    return ok(inst, '申请已提交');
  }),
  http.post('/api/workflows/instances/:id/resubmit', ({ params }) => {
    const src = mockWorkflowInstances.find((i) => i.id === Number(params.id));
    if (!src) return err('流程实例不存在', 404);
    const now = mockDateTime();
    const clone = {
      ...src,
      id: getNextInstanceId(),
      serialNo: null,
      status: 'draft' as const,
      currentNodeKey: null,
      tasks: [],
      createdAt: now,
      updatedAt: now,
    };
    mockWorkflowInstances.push(clone);
    return ok(clone, '已生成草稿');
  }),

  // ── 管理员强制操作 ──
  http.post('/api/workflows/instances/:id/jump', async ({ params, request }) => {
    const body = await request.json() as { targetNodeKey: string };
    const inst = mockWorkflowInstances.find((i) => i.id === Number(params.id));
    if (!inst) return err('流程实例不存在', 404);
    if (inst.status !== 'running') return err('仅审批中的流程可强制跳转');
    mockWorkflowTasks.filter((t) => t.instanceId === inst.id && (t.status === 'pending' || t.status === 'waiting'))
      .forEach((t) => { t.status = 'skipped'; t.actionAt = mockDateTime(); });
    inst.currentNodeKey = body.targetNodeKey;
    inst.updatedAt = mockDateTime();
    return ok(inst, '已跳转');
  }),
  http.post('/api/workflows/tasks/:taskId/reassign', async ({ params, request }) => {
    const body = await request.json() as { targetUserId: number };
    const task = mockWorkflowTasks.find((t) => t.id === Number(params.taskId));
    if (!task) return err('任务不存在', 404);
    task.assigneeId = body.targetUserId;
    task.assigneeName = getMockUserName(body.targetUserId);
    return ok(task, '已改派');
  }),

  // ── 批量审批 ──
  http.post('/api/workflows/tasks/batch-approve', async ({ request }) => {
    const cached = readIdempotentResponse(request);
    if (cached) return cached;
    const { taskIds, comment } = await request.json() as { taskIds: number[]; comment?: string };
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
    return okIdempotent(request, { succeeded, failed: results.length - succeeded, results }, `成功 ${succeeded} 条`);
  }),
  http.post('/api/workflows/tasks/batch-reject', async ({ request }) => {
    const cached = readIdempotentResponse(request);
    if (cached) return cached;
    const { taskIds, comment } = await request.json() as { taskIds: number[]; comment: string };
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
    return okIdempotent(request, { succeeded, failed: results.length - succeeded, results }, `成功 ${succeeded} 条`);
  }),

  // ── 审批意见常用语 ──
  http.get('/api/workflows/quick-phrases', () => ok(mockQuickPhrases)),
  http.post('/api/workflows/quick-phrases', async ({ request }) => {
    const body = await request.json() as { content: string; sort?: number };
    const phrase: WorkflowQuickPhrase = { id: nextPhraseId++, userId: 1, content: body.content, sort: body.sort ?? 0, createdAt: mockDateTime(), updatedAt: mockDateTime() };
    mockQuickPhrases.push(phrase);
    return ok(phrase, '已新增');
  }),
  http.put('/api/workflows/quick-phrases/:id', async ({ params, request }) => {
    const body = await request.json() as { content?: string; sort?: number };
    const p = mockQuickPhrases.find((x) => x.id === Number(params.id));
    if (!p) return err('常用语不存在', 404);
    if (body.content !== undefined) p.content = body.content;
    if (body.sort !== undefined) p.sort = body.sort;
    p.updatedAt = mockDateTime();
    return ok(p, '已更新');
  }),
  http.delete('/api/workflows/quick-phrases/:id', ({ params }) => {
    const idx = mockQuickPhrases.findIndex((x) => x.id === Number(params.id));
    if (idx === -1) return err('常用语不存在', 404);
    mockQuickPhrases.splice(idx, 1);
    return ok(null, '已删除');
  }),

  // ── 审批代理 / 离岗委托 ──
  http.get('/api/workflows/delegations', ({ request }) => {
    const url = new URL(request.url);
    const page = Number(url.searchParams.get('page') ?? 1);
    const pageSize = Number(url.searchParams.get('pageSize') ?? 20);
    const list = mockDelegations.slice((page - 1) * pageSize, page * pageSize);
    return ok({ list, total: mockDelegations.length, page, pageSize });
  }),
  http.post('/api/workflows/delegations', async ({ request }) => {
    const body = await request.json() as Partial<WorkflowDelegation> & { delegateId: number };
    const now = mockDateTime();
    const row: WorkflowDelegation = {
      id: nextDelegationId++,
      principalId: body.principalId ?? 1,
      principalName: getMockUserName(body.principalId ?? 1),
      delegateId: body.delegateId,
      delegateName: getMockUserName(body.delegateId),
      definitionId: body.definitionId ?? null,
      definitionName: getMockDefinitionName(body.definitionId),
      reason: body.reason ?? null,
      startAt: body.startAt ?? null,
      endAt: body.endAt ?? null,
      enabled: body.enabled ?? true,
      active: body.enabled ?? true,
      createdAt: now,
      updatedAt: now,
    };
    mockDelegations.push(row);
    return ok(row, '已新增');
  }),
  http.put('/api/workflows/delegations/:id', async ({ params, request }) => {
    const body = await request.json() as Partial<WorkflowDelegation>;
    const row = mockDelegations.find((x) => x.id === Number(params.id));
    if (!row) return err('委托规则不存在', 404);
    Object.assign(row, body, { updatedAt: mockDateTime() });
    if (body.enabled !== undefined) row.active = body.enabled;
    return ok(row, '已更新');
  }),
  http.delete('/api/workflows/delegations/:id', ({ params }) => {
    const idx = mockDelegations.findIndex((x) => x.id === Number(params.id));
    if (idx === -1) return err('委托规则不存在', 404);
    mockDelegations.splice(idx, 1);
    return ok(null, '已删除');
  }),
];
