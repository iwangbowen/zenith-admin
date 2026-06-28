import { http, HttpResponse } from 'msw';
import type {
  WorkflowEventDelivery,
  WorkflowEventDeliveryStatus,
  WorkflowEventSubscription,
  WorkflowEventType,
} from '@zenith/shared';
import { mockWorkflowDefinitions } from '@/mocks/data/workflow';
import { mockDateTime, mockDateTimeOffset } from '@/mocks/utils/date';

function ok<T>(data: T, message = 'ok') {
  return HttpResponse.json({ code: 0, message, data });
}

function err(message: string, code = 400) {
  return HttpResponse.json({ code, message });
}

type StoredSubscription = WorkflowEventSubscription & { secret: string | null };

const now = mockDateTime();
const mockSubscriptions: StoredSubscription[] = [
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

const mockDeliveries: WorkflowEventDelivery[] = [
  {
    id: 1,
    subscriptionId: 1,
    subscriptionName: '审批事件回调',
    instanceId: 1,
    taskId: 1,
    eventId: 'evt_demo_001',
    eventType: 'instance.approved',
    payload: null,
    attempt: 1,
    status: 'success',
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
    subscriptionId: 2,
    subscriptionName: '全局任务事件订阅',
    instanceId: 2,
    taskId: 3,
    eventId: 'evt_demo_002',
    eventType: 'task.transferred',
    payload: null,
    attempt: 2,
    status: 'failed',
    requestUrl: 'https://ops.example.com/workflow/events',
    requestHeaders: null,
    responseStatus: 500,
    responseBody: '{"error":"temporary unavailable"}',
    errorMessage: '外部服务暂不可用',
    durationMs: 315,
    nextRetryAt: mockDateTimeOffset(5 * 60 * 1000),
    startedAt: mockDateTimeOffset(-10 * 60 * 1000),
    finishedAt: mockDateTimeOffset(-10 * 60 * 1000 + 315),
    tenantId: 1,
    createdAt: mockDateTimeOffset(-10 * 60 * 1000),
  },
];

function maskSecret(secret: string | null | undefined): string | null {
  if (!secret) return null;
  if (secret.length <= 8) return '****';
  return `${secret.slice(0, 4)}****${secret.slice(-4)}`;
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

function paginate<T>(list: T[], page: number, pageSize: number) {
  return list.slice((page - 1) * pageSize, page * pageSize);
}

export const workflowEventSubscriptionsHandlers = [
  http.get('/api/workflows/event-subscriptions/deliveries/list', ({ request }) => {
    const url = new URL(request.url);
    const page = Number(url.searchParams.get('page')) || 1;
    const pageSize = Number(url.searchParams.get('pageSize')) || 20;
    const subscriptionId = url.searchParams.get('subscriptionId');
    const instanceId = url.searchParams.get('instanceId');
    const status = url.searchParams.get('status') as WorkflowEventDeliveryStatus | null;

    let list = [...mockDeliveries];
    if (subscriptionId) list = list.filter((item) => item.subscriptionId === Number(subscriptionId));
    if (instanceId) list = list.filter((item) => item.instanceId === Number(instanceId));
    if (status) list = list.filter((item) => item.status === status);
    list.sort((a, b) => b.id - a.id);

    return ok({ list: paginate(list, page, pageSize), total: list.length, page, pageSize });
  }),

  http.post('/api/workflows/event-subscriptions/deliveries/batch-retry', async ({ request }) => {
    const body = await request.json() as { ids?: number[] };
    let count = 0;
    for (const id of body.ids ?? []) {
      const row = mockDeliveries.find((item) => item.id === id);
      if (row && (row.status === 'failed' || row.status === 'retrying')) {
        row.status = 'retrying';
        row.nextRetryAt = mockDateTime();
        count += 1;
      }
    }
    return ok({ count }, '已加入重试队列');
  }),

  http.post('/api/workflows/event-subscriptions/deliveries/:id/retry', ({ params }) => {
    const row = mockDeliveries.find((item) => item.id === Number(params.id));
    if (!row) return err('投递记录不存在', 404);
    row.status = 'retrying';
    row.nextRetryAt = mockDateTime();
    row.attempt += 1;
    return ok(row, '已加入重试队列');
  }),

  http.get('/api/workflows/event-subscriptions/deliveries/:id', ({ params }) => {
    const row = mockDeliveries.find((item) => item.id === Number(params.id));
    if (!row) return err('投递记录不存在', 404);
    return ok(row);
  }),

  http.get('/api/workflows/event-subscriptions', ({ request }) => {
    const url = new URL(request.url);
    const page = Number(url.searchParams.get('page')) || 1;
    const pageSize = Number(url.searchParams.get('pageSize')) || 20;
    const keyword = (url.searchParams.get('keyword') ?? '').trim().toLowerCase();
    const definitionId = url.searchParams.get('definitionId');
    const enabled = url.searchParams.get('enabled');

    let list = mockSubscriptions.map(toPublicSubscription);
    if (keyword) {
      list = list.filter((item) =>
        item.name.toLowerCase().includes(keyword) ||
        item.url.toLowerCase().includes(keyword),
      );
    }
    if (definitionId) list = list.filter((item) => item.definitionId === Number(definitionId));
    if (enabled === 'true' || enabled === 'false') {
      list = list.filter((item) => item.enabled === (enabled === 'true'));
    }
    list.sort((a, b) => b.id - a.id);

    return ok({ list: paginate(list, page, pageSize), total: list.length, page, pageSize });
  }),

  http.post('/api/workflows/event-subscriptions', async ({ request }) => {
    const body = await request.json() as Partial<WorkflowEventSubscription> & { secret?: string | null };
    if (!body.name?.trim()) return err('请输入名称');
    if (!body.url?.trim()) return err('请输入回调 URL');
    if (!/^https?:\/\//i.test(body.url.trim())) return err('URL 必须以 http:// 或 https:// 开头');
    if (!body.events || body.events.length === 0) return err('至少订阅一个事件类型');

    const createdAt = mockDateTime();
    const row: StoredSubscription = {
      id: nextSubscriptionId++,
      name: body.name.trim(),
      description: body.description ?? null,
      definitionId: body.definitionId ?? null,
      definitionName: resolveDefinitionName(body.definitionId ?? null),
      events: body.events as WorkflowEventType[],
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

  http.get('/api/workflows/event-subscriptions/:id/secret', ({ params }) => {
    const row = mockSubscriptions.find((item) => item.id === Number(params.id));
    if (!row) return err('事件订阅不存在', 404);
    return ok({ id: row.id, secret: row.secret });
  }),

  http.patch('/api/workflows/event-subscriptions/:id/toggle', async ({ params, request }) => {
    const row = mockSubscriptions.find((item) => item.id === Number(params.id));
    if (!row) return err('事件订阅不存在', 404);
    const body = await request.json() as { enabled?: boolean };
    row.enabled = body.enabled ?? !row.enabled;
    row.updatedAt = mockDateTime();
    return ok(toPublicSubscription(row), '已切换');
  }),

  http.get('/api/workflows/event-subscriptions/:id', ({ params }) => {
    const row = mockSubscriptions.find((item) => item.id === Number(params.id));
    if (!row) return err('事件订阅不存在', 404);
    return ok(toPublicSubscription(row));
  }),

  http.put('/api/workflows/event-subscriptions/:id', async ({ params, request }) => {
    const idx = mockSubscriptions.findIndex((item) => item.id === Number(params.id));
    if (idx === -1) return err('事件订阅不存在', 404);
    const body = await request.json() as Partial<WorkflowEventSubscription> & { secret?: string | null };
    if (body.url !== undefined && !/^https?:\/\//i.test(body.url.trim())) return err('URL 必须以 http:// 或 https:// 开头');
    const current = mockSubscriptions[idx];
    const nextSecret = body.secret?.trim() ? body.secret.trim() : current.secret;
    mockSubscriptions[idx] = {
      ...current,
      name: body.name?.trim() ?? current.name,
      description: body.description !== undefined ? body.description : current.description,
      definitionId: body.definitionId !== undefined ? body.definitionId : current.definitionId,
      definitionName: resolveDefinitionName(body.definitionId !== undefined ? body.definitionId : current.definitionId),
      events: body.events ? body.events as WorkflowEventType[] : current.events,
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

  http.delete('/api/workflows/event-subscriptions/:id', ({ params }) => {
    const idx = mockSubscriptions.findIndex((item) => item.id === Number(params.id));
    if (idx === -1) return err('事件订阅不存在', 404);
    mockSubscriptions.splice(idx, 1);
    return ok(null, '已删除');
  }),
];
