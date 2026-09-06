import { appWebhookContract, paymentWebhookContract, OPEN_WEBHOOK_EVENTS, OPEN_WEBHOOK_EVENT_LABELS, PAYMENT_WEBHOOK_EVENTS } from '@zenith/shared/open-platform';
import type { AppWebhookContract, AppWebhookSubscription, AppWebhookDelivery } from '@zenith/shared/open-platform';
import { mock } from '@/mocks/utils/contract';
import { badRequest, notFound, nextIdFrom } from '@/mocks/utils/handlers';
import { mockWebhookSubscriptions, mockWebhookDeliveries } from '@/mocks/data/app-webhooks';
import { mockDateTime } from '@/mocks/utils/date';
import { filterByKeyword } from '@/mocks/utils/filter';

const subs: AppWebhookSubscription[] = mockWebhookSubscriptions.map((s) => ({ ...s }));
let deliveries: AppWebhookDelivery[] = mockWebhookDeliveries.map((d) => ({ ...d }));
let nextSubId = nextIdFrom(subs);
let nextDeliveryId = nextIdFrom(deliveries);
const randomSecret = () => `whsec_${Array.from({ length: 48 }, () => Math.floor(Math.random() * 16).toString(16)).join('')}`;
const sensitiveEvents = new Set<string>(PAYMENT_WEBHOOK_EVENTS);

function isPaymentSubscription(subscription: AppWebhookSubscription): boolean {
  return subscription.events.length > 0 && subscription.events.every((event) => sensitiveEvents.has(event));
}

function policyError(input: {
  events?: readonly string[];
  signMode?: AppWebhookSubscription['signMode'];
  headers?: Record<string, string> | null;
  hasSecret?: boolean;
}): string | null {
  const reservedHeader = Object.keys(input.headers ?? {}).find((key) => {
    const normalized = key.trim().toLowerCase();
    return normalized === 'content-type' || normalized.startsWith('x-zenith-');
  });
  if (reservedHeader) return `自定义请求头不能覆盖保留头：${reservedHeader}`;
  if ((input.events ?? []).some((event) => sensitiveEvents.has(event)) && input.signMode !== 'hmacSha256') {
    return '支付与退款事件必须使用 HMAC-SHA256 签名';
  }
  if (input.signMode === 'hmacSha256' && !input.hasSecret) return 'HMAC 签名密钥不可用，请先重置 Webhook 密钥';
  return null;
}

/**
 * 同一份订阅 / 投递内存数据同时服务开放平台与支付中心两套契约：
 * 支付中心视图只看得到「全部事件都是支付 / 退款事件」的订阅。
 */
function createAppWebhookHandlers(contract: AppWebhookContract, paymentScope = false) {
  const inScope = (subscription: AppWebhookSubscription) => !paymentScope || isPaymentSubscription(subscription);
  const scopedSub = (id: number) => subs.find((subscription) => subscription.id === id && inScope(subscription));
  const scopedEvents = paymentScope ? PAYMENT_WEBHOOK_EVENTS : OPEN_WEBHOOK_EVENTS;

  return [
    mock(contract.events, ({ ok }) => ok(scopedEvents.map((code) => ({ code, label: OPEN_WEBHOOK_EVENT_LABELS[code] ?? code })))),

    // 投递日志
    mock(contract.deliveries, ({ query, ok, paginate }) => {
      const scopedIds = new Set(subs.filter(inScope).map((subscription) => subscription.id));
      let filtered = deliveries.filter((delivery) => scopedIds.has(delivery.subscriptionId)).sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
      if (query.subscriptionId) filtered = filtered.filter((d) => d.subscriptionId === query.subscriptionId);
      if (query.clientId) filtered = filtered.filter((d) => d.clientId === query.clientId);
      if (query.status) filtered = filtered.filter((d) => d.status === query.status);
      if (query.eventType) filtered = filtered.filter((d) => d.eventType === query.eventType);
      return ok(paginate(filtered));
    }),
    mock(contract.deliveryDetail, ({ params, ok }) => {
      const found = deliveries.find((d) => d.id === params.id && scopedSub(d.subscriptionId));
      return found ? ok(found) : notFound('投递记录不存在', { status: 404 });
    }),
    mock(contract.retryDelivery, ({ params, ok }) => {
      const d = deliveries.find((x) => x.id === params.id && scopedSub(x.subscriptionId));
      if (!d) return notFound('投递记录不存在', { status: 404 });
      if (d.status !== 'failed') {
        return badRequest('仅最终失败的投递可手动重试', { status: 400 });
      }
      d.status = 'success';
      d.attempt += 1;
      d.responseStatus = 200;
      d.responseBody = '{"received":true}';
      d.errorMessage = null;
      d.nextRetryAt = null;
      d.finishedAt = mockDateTime();
      return ok({ deliveryId: d.id }, '已触发重试');
    }),
    mock(contract.batchRetryDeliveries, ({ body, ok }) => {
      const ids = new Set(body.ids);
      let scheduled = 0;
      for (const delivery of deliveries) {
        if (ids.has(delivery.id) && delivery.status === 'failed' && scopedSub(delivery.subscriptionId)) {
          delivery.status = 'retrying';
          delivery.nextRetryAt = mockDateTime();
          scheduled += 1;
        }
      }
      return ok({ scheduled }, '已加入重试队列');
    }),

    // 订阅 CRUD
    mock(contract.list, ({ query, ok, paginate }) => {
      let filtered = subs.filter(inScope);
      if (query.keyword) filtered = filterByKeyword(filtered, query.keyword, [(s) => s.name, (s) => s.url]);
      if (query.clientId) filtered = filtered.filter((s) => s.clientId === query.clientId);
      if (query.status) filtered = filtered.filter((s) => s.status === query.status);
      return ok(paginate(filtered));
    }),

    mock(contract.create, ({ body, ok }) => {
      if (paymentScope && (body.events.length === 0 || body.events.some((event) => !sensitiveEvents.has(event)))) {
        return badRequest('支付中心 Webhook 必须显式选择支付或退款事件', { status: 400 });
      }
      const secret = body.signMode === 'hmacSha256' ? randomSecret() : '';
      const error = policyError({ events: body.events, signMode: body.signMode, headers: body.headers, hasSecret: Boolean(secret) });
      if (error) return badRequest(error, { status: 400 });
      const now = mockDateTime();
      const created: AppWebhookSubscription = {
        id: nextSubId++,
        clientId: body.clientId,
        tenantId: null,
        name: body.name,
        url: body.url,
        signMode: body.signMode,
        events: body.events,
        headers: body.headers ?? null,
        status: body.status,
        hasSecret: body.signMode === 'hmacSha256',
        secretMasked: body.signMode === 'hmacSha256' ? '••••••••' : null,
        lastDeliveryAt: null,
        consecutiveFailures: 0,
        autoDisabledAt: null,
        createdAt: now,
        updatedAt: now,
      };
      subs.unshift(created);
      return ok({ ...created, secret }, '创建成功');
    }),

    mock(contract.detail, ({ params, ok }) => {
      const found = scopedSub(params.id);
      return found ? ok(found) : notFound('Webhook 订阅不存在', { status: 404 });
    }),

    mock(contract.update, ({ params, body, ok }) => {
      const idx = subs.findIndex((s) => s.id === params.id && inScope(s));
      if (idx === -1) return notFound('Webhook 订阅不存在', { status: 404 });
      const signMode = body.signMode ?? subs[idx].signMode;
      const nextEvents = body.events ?? subs[idx].events;
      if (paymentScope && (nextEvents.length === 0 || nextEvents.some((event) => !sensitiveEvents.has(event)))) {
        return badRequest('支付中心 Webhook 必须显式选择支付或退款事件', { status: 400 });
      }
      const hasSecret = signMode === 'hmacSha256' && subs[idx].hasSecret;
      const error = policyError({
        events: nextEvents,
        signMode,
        headers: body.headers ?? subs[idx].headers,
        hasSecret,
      });
      if (error) return badRequest(error, { status: 400 });
      subs[idx] = { ...subs[idx], ...body, updatedAt: mockDateTime() };
      if (body.signMode === 'none') {
        subs[idx].hasSecret = false;
        subs[idx].secretMasked = null;
      }
      return ok(subs[idx], '更新成功');
    }),

    mock(contract.regenerateSecret, ({ params, ok }) => {
      const found = scopedSub(params.id);
      if (!found) return notFound('Webhook 订阅不存在', { status: 404 });
      found.signMode = 'hmacSha256';
      found.hasSecret = true;
      found.secretMasked = '••••••••';
      return ok({ id: found.id, secret: randomSecret() }, '新 secret 仅返回一次');
    }),

    mock(contract.test, ({ params, ok }) => {
      const sub = scopedSub(params.id);
      if (!sub) return notFound('Webhook 订阅不存在', { status: 404 });
      const now = mockDateTime();
      const delivery: AppWebhookDelivery = {
        id: nextDeliveryId++, subscriptionId: sub.id, clientId: sub.clientId,
        tenantId: sub.tenantId,
        eventType: 'app.test', eventId: `evt-test-${Date.now()}`, status: 'success', attempt: 1,
        requestUrl: sub.url, responseStatus: 200, responseBody: '{"received":true}', errorMessage: null,
        durationMs: 35, nextRetryAt: null, finishedAt: now, createdAt: now,
      };
      deliveries.unshift(delivery);
      sub.lastDeliveryAt = now;
      return ok({ deliveryId: delivery.id }, '已发送测试投递');
    }),

    mock(contract.remove, ({ params, ok }) => {
      const idx = subs.findIndex((s) => s.id === params.id && inScope(s));
      if (idx === -1) return notFound('Webhook 订阅不存在', { status: 404 });
      subs.splice(idx, 1);
      deliveries = deliveries.filter((d) => d.subscriptionId !== params.id);
      return ok(null, '删除成功');
    }),
  ];
}

export const appWebhooksHandlers = [
  ...createAppWebhookHandlers(appWebhookContract),
  ...createAppWebhookHandlers(paymentWebhookContract, true),
];
