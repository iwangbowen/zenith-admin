import { http, HttpResponse } from 'msw';
import { OPEN_WEBHOOK_EVENTS, OPEN_WEBHOOK_EVENT_LABELS } from '@zenith/shared';
import type { AppWebhookSubscription, AppWebhookDelivery } from '@zenith/shared';
import { mockWebhookSubscriptions, mockWebhookDeliveries } from '@/mocks/data/app-webhooks';
import { mockDateTime } from '@/mocks/utils/date';

const subs: AppWebhookSubscription[] = mockWebhookSubscriptions.map((s) => ({ ...s }));
let deliveries: AppWebhookDelivery[] = mockWebhookDeliveries.map((d) => ({ ...d }));
let nextSubId = Math.max(0, ...subs.map((s) => s.id)) + 1;
let nextDeliveryId = Math.max(0, ...deliveries.map((d) => d.id)) + 1;
const BASE = '/api/app-webhooks';

const ok = (data: unknown, message = 'success') => HttpResponse.json({ code: 0, message, data });
const notFound = (m = '资源不存在') => HttpResponse.json({ code: 404, message: m, data: null }, { status: 404 });
const randomSecret = () => `whsec_${Array.from({ length: 48 }, () => Math.floor(Math.random() * 16).toString(16)).join('')}`;

export const appWebhooksHandlers = [
  http.get(`${BASE}/events`, () => ok(OPEN_WEBHOOK_EVENTS.map((code) => ({ code, label: OPEN_WEBHOOK_EVENT_LABELS[code] ?? code })))),

  // 投递日志
  http.get(`${BASE}/deliveries`, ({ request }) => {
    const url = new URL(request.url);
    const subscriptionId = url.searchParams.get('subscriptionId');
    const status = url.searchParams.get('status');
    const eventType = url.searchParams.get('eventType');
    const page = Number(url.searchParams.get('page') ?? 1);
    const pageSize = Number(url.searchParams.get('pageSize') ?? 10);
    let filtered = [...deliveries].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
    if (subscriptionId) filtered = filtered.filter((d) => d.subscriptionId === Number(subscriptionId));
    if (status) filtered = filtered.filter((d) => d.status === status);
    if (eventType) filtered = filtered.filter((d) => d.eventType === eventType);
    const start = (page - 1) * pageSize;
    return ok({ list: filtered.slice(start, start + pageSize), total: filtered.length, page, pageSize });
  }),
  http.get(`${BASE}/deliveries/:id`, ({ params }) => {
    const found = deliveries.find((d) => d.id === Number(params.id));
    return found ? ok(found) : notFound('投递记录不存在');
  }),
  http.post(`${BASE}/deliveries/:id/retry`, ({ params }) => {
    const d = deliveries.find((x) => x.id === Number(params.id));
    if (!d) return notFound('投递记录不存在');
    d.status = 'success';
    d.attempt += 1;
    d.responseStatus = 200;
    d.responseBody = '{"received":true}';
    d.errorMessage = null;
    d.nextRetryAt = null;
    d.finishedAt = mockDateTime();
    return ok({ deliveryId: d.id }, '已触发重试');
  }),
  http.post(`${BASE}/deliveries/batch-retry`, async ({ request }) => {
    const body = await request.json() as { ids?: number[] };
    const ids = new Set(body.ids ?? []);
    let scheduled = 0;
    for (const delivery of deliveries) {
      if (ids.has(delivery.id) && delivery.status !== 'success') {
        delivery.status = 'retrying';
        delivery.nextRetryAt = mockDateTime();
        scheduled += 1;
      }
    }
    return ok({ scheduled }, '已加入重试队列');
  }),

  // 订阅 CRUD
  http.get(BASE, ({ request }) => {
    const url = new URL(request.url);
    const keyword = url.searchParams.get('keyword') ?? '';
    const clientId = url.searchParams.get('clientId') ?? '';
    const status = url.searchParams.get('status') ?? '';
    const page = Number(url.searchParams.get('page') ?? 1);
    const pageSize = Number(url.searchParams.get('pageSize') ?? 10);
    let filtered = subs;
    if (keyword) filtered = filtered.filter((s) => s.name.includes(keyword) || s.url.includes(keyword));
    if (clientId) filtered = filtered.filter((s) => s.clientId === clientId);
    if (status) filtered = filtered.filter((s) => s.status === status);
    const start = (page - 1) * pageSize;
    return ok({ list: filtered.slice(start, start + pageSize), total: filtered.length, page, pageSize });
  }),

  http.post(BASE, async ({ request }) => {
    const body = (await request.json()) as Partial<AppWebhookSubscription>;
    const signMode = body.signMode ?? 'hmacSha256';
    const secret = signMode === 'hmacSha256' ? randomSecret() : '';
    const now = mockDateTime();
    const created: AppWebhookSubscription = {
      id: nextSubId++,
      clientId: body.clientId ?? '',
      name: body.name ?? '',
      url: body.url ?? '',
      signMode,
      events: body.events ?? [],
      headers: body.headers ?? null,
      status: body.status ?? 'enabled',
      hasSecret: signMode === 'hmacSha256',
      secretMasked: signMode === 'hmacSha256' ? '••••••••' : null,
      lastDeliveryAt: null,
      consecutiveFailures: 0,
      autoDisabledAt: null,
      createdAt: now,
      updatedAt: now,
    };
    subs.unshift(created);
    return ok({ ...created, secret }, '创建成功');
  }),

  http.get(`${BASE}/:id`, ({ params }) => {
    const found = subs.find((s) => s.id === Number(params.id));
    return found ? ok(found) : notFound('Webhook 订阅不存在');
  }),

  http.put(`${BASE}/:id`, async ({ params, request }) => {
    const idx = subs.findIndex((s) => s.id === Number(params.id));
    if (idx === -1) return notFound('Webhook 订阅不存在');
    const body = (await request.json()) as Partial<AppWebhookSubscription>;
    subs[idx] = { ...subs[idx], ...body, clientId: subs[idx].clientId, updatedAt: mockDateTime() };
    return ok(subs[idx], '更新成功');
  }),

  http.post(`${BASE}/:id/regenerate-secret`, ({ params }) => {
    const found = subs.find((s) => s.id === Number(params.id));
    if (!found) return notFound('Webhook 订阅不存在');
    found.signMode = 'hmacSha256';
    found.hasSecret = true;
    found.secretMasked = '••••••••';
    return ok({ id: found.id, secret: randomSecret() }, '新 secret 仅返回一次');
  }),

  http.post(`${BASE}/:id/test`, ({ params }) => {
    const sub = subs.find((s) => s.id === Number(params.id));
    if (!sub) return notFound('Webhook 订阅不存在');
    const now = mockDateTime();
    const delivery: AppWebhookDelivery = {
      id: nextDeliveryId++, subscriptionId: sub.id, clientId: sub.clientId,
      eventType: 'app.test', eventId: `evt-test-${Date.now()}`, status: 'success', attempt: 1,
      requestUrl: sub.url, responseStatus: 200, responseBody: '{"received":true}', errorMessage: null,
      durationMs: 35, nextRetryAt: null, finishedAt: now, createdAt: now,
    };
    deliveries.unshift(delivery);
    sub.lastDeliveryAt = now;
    return ok({ deliveryId: delivery.id }, '已发送测试投递');
  }),

  http.delete(`${BASE}/:id`, ({ params }) => {
    const idx = subs.findIndex((s) => s.id === Number(params.id));
    if (idx === -1) return notFound('Webhook 订阅不存在');
    subs.splice(idx, 1);
    deliveries = deliveries.filter((d) => d.subscriptionId !== Number(params.id));
    return ok(null, '删除成功');
  }),
];
