import { workflowEventSubscriptionContract, workflowEventDeliveryState } from '@zenith/shared/workflow';
import type { WorkflowEventDelivery, WorkflowEventSubscription, WorkflowJobStatus, WorkflowJobExecutionStatus } from '@zenith/shared/workflow';
import { maskSecret as maskSecretValue } from '@zenith/shared/core';
import { mock } from '@/mocks/utils/contract';
import { badRequest, fail } from '@/mocks/utils/handlers';
import { mockWorkflowDefinitions } from '@/mocks/data/workflow';
import { mockDateTime, mockDateTimeOffset } from '@/mocks/utils/date';
import { filterByKeyword } from '@/mocks/utils/filter';
import { removeByIds, requireItem } from '../utils/crud';

type StoredSubscription = WorkflowEventSubscription & { secret: string | null };

const now = mockDateTime();
export const mockSubscriptions: StoredSubscription[] = [
  {
    id: 1,
    name: '审批事件回调',
    description: '将请假申请审批结果同步到外部系统',
    definitionId: 1,
    definitionName: '请假申请',
    events: ['instance.approved', 'instance.rejected', 'task.urged'],
    url: 'https://example.com/workflow/webhook',
    secret: 'leave-secret-demo',
    secretMasked: 'leav****demo',
    signMode: 'hmacSha256',
    headers: { 'X-Source': 'zenith-demo' },
    connectorId: null,
    enabled: true,
    tenantId: 1,
    createdAt: now,
    updatedAt: now,
  },
  {
    id: 2,
    name: '全局任务事件订阅',
    description: '订阅全部流程任务创建与转办事件',
    definitionId: null,
    definitionName: null,
    events: ['task.created', 'task.transferred'],
    url: 'https://ops.example.com/workflow/events',
    secret: 'global-event-secret',
    secretMasked: 'glob****cret',
    signMode: 'hmacSha256',
    headers: null,
    connectorId: null,
    enabled: false,
    tenantId: 1,
    createdAt: now,
    updatedAt: now,
  },
];

let nextSubscriptionId = 3;

export const mockDeliveries: WorkflowEventDelivery[] = [
  {
    id: 1,
    jobId: 1,
    subscriptionId: 1,
    subscriptionName: '审批事件回调',
    instanceId: 1,
    taskId: 1,
    eventId: 'evt_demo_001',
    eventType: 'instance.approved',
    payload: null,
    attempt: 1,
    status: 'success',
    jobStatus: 'success', isLatestExecution: true, canRetry: false, canReplay: true,
    requestUrl: 'https://example.com/workflow/webhook',
    requestHeaders: { 'X-Source': 'zenith-demo' },
    responseStatus: 200,
    responseBody: '{"ok":true}',
    errorMessage: null,
    durationMs: 128,
    nextRetryAt: null,
    startedAt: mockDateTimeOffset(-60 * 60 * 1000),
    finishedAt: mockDateTimeOffset(-60 * 60 * 1000 + 128),
    tenantId: 1,
    createdAt: mockDateTimeOffset(-60 * 60 * 1000),
  },
  {
    id: 2,
    jobId: 2,
    subscriptionId: 2,
    subscriptionName: '全局任务事件订阅',
    instanceId: 2,
    taskId: 3,
    eventId: 'evt_demo_002',
    eventType: 'task.transferred',
    payload: null,
    attempt: 2,
    status: 'failed',
    jobStatus: 'dead', isLatestExecution: true, canRetry: false, canReplay: false,
    requestUrl: 'https://ops.example.com/workflow/events',
    requestHeaders: null,
    responseStatus: 500,
    responseBody: '{"error":"temporary unavailable"}',
    errorMessage: '外部服务暂不可用',
    durationMs: 315,
    nextRetryAt: null,
    startedAt: mockDateTimeOffset(-10 * 60 * 1000),
    finishedAt: mockDateTimeOffset(-10 * 60 * 1000 + 315),
    tenantId: 1,
    createdAt: mockDateTimeOffset(-10 * 60 * 1000),
  },
];

type MockDeliveryJob = {
  id: number; subscriptionId: number; eventType: string; status: WorkflowJobStatus;
  attempts: number; runAt: string; createdAt: string;
};
export const mockDeliveryJobs = new Map<number, MockDeliveryJob>(mockDeliveries.map((row) => [row.jobId, {
  id: row.jobId, subscriptionId: row.subscriptionId, eventType: row.eventType,
  status: row.status === 'success' ? 'succeeded' : 'dead', attempts: row.attempt,
  runAt: row.createdAt, createdAt: row.createdAt,
}]));
const executionStatuses: Record<WorkflowEventDelivery['status'], WorkflowJobExecutionStatus> = {
  running: 'running', success: 'succeeded', failed: 'failed', skipped: 'skipped', cancelled: 'canceled',
};
function latestDelivery(jobId: number) {
  return mockDeliveries.filter((row) => row.jobId === jobId).sort((a, b) => b.id - a.id)[0];
}
function publicDelivery(row: WorkflowEventDelivery): WorkflowEventDelivery {
  const job = mockDeliveryJobs.get(row.jobId)!;
  const latest = latestDelivery(row.jobId);
  const state = workflowEventDeliveryState({
    executionId: row.id, executionStatus: executionStatuses[row.status],
    latestExecutionId: latest.id, latestExecutionStatus: executionStatuses[latest.status],
    jobStatus: job.status, jobAttempts: job.attempts,
    subscriptionEnabled: mockSubscriptions.some((sub) => sub.id === row.subscriptionId && sub.enabled),
  });
  return { ...row, ...state, nextRetryAt: state.jobStatus === 'retrying' ? job.runAt : null };
}
function retryDeliveryJob(job: MockDeliveryJob) {
  job.status = 'pending'; job.attempts = 0; job.runAt = mockDateTime();
}
function replayDeliveryJob(job: MockDeliveryJob): boolean {
  if (job.status === 'pending') return true;
  if (job.status === 'failed' || job.status === 'dead' || job.status === 'canceled') {
    retryDeliveryJob(job); return true;
  }
  if (job.status !== 'succeeded') return false;
  const id = Math.max(0, ...mockDeliveryJobs.keys()) + 1;
  mockDeliveryJobs.set(id, { ...job, id, status: 'pending', attempts: 0, runAt: mockDateTime(), createdAt: mockDateTime() });
  return true;
}

/** 与服务端一致：订阅密钥保留头尾 4 位（`@zenith/shared/core` 默认口径） */
function maskSecret(secret: string | null | undefined): string | null {
  return secret ? maskSecretValue(secret) : null;
}

function resolveDefinitionName(definitionId: number | null): string | null {
  if (definitionId === null) return null;
  return mockWorkflowDefinitions.find((item) => item.id === definitionId)?.name ?? null;
}

function toPublicSubscription(row: StoredSubscription): WorkflowEventSubscription {
  const { secret: _secret, ...publicRow } = row;
  return {
    ...publicRow,
    definitionName: resolveDefinitionName(row.definitionId),
    secretMasked: maskSecret(row.secret),
  };
}

export const workflowEventSubscriptionsHandlers = [
  mock(workflowEventSubscriptionContract.deliveries, ({ query, ok, paginate }) => {
    let list = mockDeliveries.map(publicDelivery);
    if (query.subscriptionId) list = list.filter((item) => item.subscriptionId === query.subscriptionId);
    if (query.instanceId) list = list.filter((item) => item.instanceId === query.instanceId);
    if (query.status) list = list.filter((item) => item.status === query.status);
    if (query.jobStatus) list = list.filter((item) => item.jobStatus === query.jobStatus);
    list.sort((a, b) => b.id - a.id);
    return ok(paginate(list));
  }),

  mock(workflowEventSubscriptionContract.batchRetryDeliveries, ({ body, ok }) => {
    let count = 0;
    const seen = new Set<number>();
    for (const id of body.ids) {
      const row = mockDeliveries.find((item) => item.id === id);
      if (row && publicDelivery(row).canRetry && !seen.has(row.jobId)) {
        retryDeliveryJob(mockDeliveryJobs.get(row.jobId)!);
        seen.add(row.jobId);
        count += 1;
      }
    }
    return ok({ count }, '已加入重试队列');
  }),

  // 按筛选批量重放（含补发已成功）
  mock(workflowEventSubscriptionContract.replayDeliveries, ({ body, ok }) => {
    let targets = [...mockDeliveryJobs.values()].filter((job) => mockSubscriptions.some((sub) => sub.id === job.subscriptionId && sub.enabled));
    if (body.subscriptionId) targets = targets.filter((job) => job.subscriptionId === body.subscriptionId);
    if (body.eventType) targets = targets.filter((job) => job.eventType === body.eventType);
    if (body.status === 'success') targets = targets.filter((job) => job.status === 'succeeded' && latestDelivery(job.id)?.status === 'success');
    else if (body.status === 'failed') targets = targets.filter((job) => job.status === 'failed' || job.status === 'dead');
    else if (body.status === 'pending') targets = targets.filter((job) => job.status === 'pending');
    if (body.startAt) targets = targets.filter((job) => job.createdAt >= body.startAt!);
    if (body.endAt) targets = targets.filter((job) => job.createdAt <= body.endAt!);
    const count = targets.slice(0, 500).filter(replayDeliveryJob).length;
    return ok({ count }, `已重放 ${count} 条投递`);
  }),

  mock(workflowEventSubscriptionContract.retryDelivery, ({ params, ok }) => {
    const row = mockDeliveries.find((item) => item.id === params.id);
    if (!row) return fail(404, '投递记录不存在');
    if (!publicDelivery(row).canRetry) return fail(409, '仅启用订阅的最新失败、死信或取消作业可以重试', { status: 409 });
    retryDeliveryJob(mockDeliveryJobs.get(row.jobId)!);
    return ok(publicDelivery(row), '已加入重试队列');
  }),

  mock(workflowEventSubscriptionContract.replayDelivery, ({ params, ok }) => {
    const row = mockDeliveries.find((item) => item.id === params.id);
    if (!row) return fail(404, '投递记录不存在');
    if (!publicDelivery(row).canReplay) return fail(409, '仅启用订阅的最新终态作业可以重新投递', { status: 409 });
    return ok({ count: replayDeliveryJob(mockDeliveryJobs.get(row.jobId)!) ? 1 : 0 }, '已加入投递队列');
  }),

  mock(workflowEventSubscriptionContract.deliveryDetail, ({ params, ok }) => {
    const row = mockDeliveries.find((item) => item.id === params.id);
    if (!row) return fail(404, '投递记录不存在');
    return ok(publicDelivery(row));
  }),

  mock(workflowEventSubscriptionContract.list, ({ query, ok, paginate }) => {
    const keyword = (query.keyword ?? '').trim().toLowerCase();

    let list = mockSubscriptions.map(toPublicSubscription);
    if (keyword) {
      list = filterByKeyword(list, keyword, [(item) => item.name, (item) => item.url], { caseInsensitive: true });
    }
    if (query.definitionId) list = list.filter((item) => item.definitionId === query.definitionId);
    if (query.enabled !== undefined) list = list.filter((item) => item.enabled === query.enabled);
    list.sort((a, b) => b.id - a.id);

    return ok(paginate(list));
  }),

  mock(workflowEventSubscriptionContract.create, ({ body, ok }) => {
    if (!body.name.trim()) return badRequest('请输入名称');
    if (!body.url.trim()) return badRequest('请输入回调 URL');

    const createdAt = mockDateTime();
    const row: StoredSubscription = {
      id: nextSubscriptionId++,
      name: body.name.trim(),
      description: body.description ?? null,
      definitionId: body.definitionId ?? null,
      definitionName: resolveDefinitionName(body.definitionId ?? null),
      events: body.events,
      url: body.url.trim(),
      secret: body.secret?.trim() || `workflow-secret-${nextSubscriptionId}`,
      secretMasked: null,
      signMode: body.signMode ?? 'hmacSha256',
      headers: body.headers ?? null,
      connectorId: body.connectorId ?? null,
      enabled: body.enabled ?? true,
      tenantId: 1,
      createdAt,
      updatedAt: createdAt,
    };
    row.secretMasked = maskSecret(row.secret);
    mockSubscriptions.push(row);
    return ok(toPublicSubscription(row), '已创建');
  }),

  mock(workflowEventSubscriptionContract.secret, ({ params, ok }) => {
    const row = mockSubscriptions.find((item) => item.id === params.id);
    if (!row) return fail(404, '事件订阅不存在');
    return ok({ id: row.id, secret: row.secret });
  }),

  mock(workflowEventSubscriptionContract.toggle, ({ params, body, ok }) => {
    const row = mockSubscriptions.find((item) => item.id === params.id);
    if (!row) return fail(404, '事件订阅不存在');
    row.enabled = body.enabled;
    row.updatedAt = mockDateTime();
    return ok(toPublicSubscription(row), '已切换');
  }),

  mock(workflowEventSubscriptionContract.detail, ({ params, ok }) => {
    const row = mockSubscriptions.find((item) => item.id === params.id);
    if (!row) return fail(404, '事件订阅不存在');
    return ok(toPublicSubscription(row));
  }),

  mock(workflowEventSubscriptionContract.update, ({ params, body, ok }) => {
    const idx = mockSubscriptions.findIndex((item) => item.id === params.id);
    if (idx === -1) return fail(404, '事件订阅不存在');
    const current = mockSubscriptions[idx];
    const nextSecret = body.secret?.trim() ? body.secret.trim() : current.secret;
    const definitionId = body.definitionId !== undefined ? body.definitionId : current.definitionId;
    mockSubscriptions[idx] = {
      ...current,
      name: body.name?.trim() ?? current.name,
      description: body.description !== undefined ? body.description : current.description,
      definitionId,
      definitionName: resolveDefinitionName(definitionId),
      events: body.events ?? current.events,
      url: body.url?.trim() ?? current.url,
      secret: nextSecret,
      secretMasked: maskSecret(nextSecret),
      signMode: body.signMode ?? current.signMode,
      headers: body.headers !== undefined ? body.headers : current.headers,
      connectorId: body.connectorId !== undefined ? body.connectorId : current.connectorId,
      enabled: body.enabled ?? current.enabled,
      updatedAt: mockDateTime(),
    };
    return ok(toPublicSubscription(mockSubscriptions[idx]), '已更新');
  }),

  mock(workflowEventSubscriptionContract.remove, ({ params, ok }) => {
    requireItem(mockSubscriptions, params.id, '事件订阅不存在');
    removeByIds(mockSubscriptions, [params.id]);
    return ok(null, '已删除');
  }),
];
