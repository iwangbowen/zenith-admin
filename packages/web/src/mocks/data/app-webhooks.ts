import type { AppWebhookSubscription, AppWebhookDelivery } from '@zenith/shared';

export const mockWebhookSubscriptions: AppWebhookSubscription[] = [
  {
    id: 1,
    clientId: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
    name: '调用异常告警',
    url: 'https://demo-app.example.com/webhook',
    signMode: 'hmacSha256',
    events: ['app.call.failed', 'app.quota.exceeded'],
    headers: null,
    status: 'enabled',
    hasSecret: true,
    secretMasked: '••••••••',
    lastDeliveryAt: '2026-06-20 10:00:01',
    consecutiveFailures: 0,
    autoDisabledAt: null,
    createdAt: '2026-06-01 10:00:00',
    updatedAt: '2026-06-01 10:00:00',
  },
  {
    id: 2,
    clientId: 'f0e1d2c3-b4a5-6789-0abc-de1234567891',
    name: '全事件监听',
    url: 'https://hooks.example.com/zenith',
    signMode: 'hmacSha256',
    events: [],
    headers: { 'X-Env': 'prod' },
    status: 'enabled',
    hasSecret: true,
    secretMasked: '••••••••',
    lastDeliveryAt: null,
    consecutiveFailures: 2,
    autoDisabledAt: null,
    createdAt: '2026-06-02 09:00:00',
    updatedAt: '2026-06-02 09:00:00',
  },
];

export const mockWebhookDeliveries: AppWebhookDelivery[] = [
  {
    id: 1, subscriptionId: 1, clientId: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
    eventType: 'app.call.failed', eventId: 'evt-20260620-0001', status: 'success', attempt: 1,
    requestUrl: 'https://demo-app.example.com/webhook', responseStatus: 200, responseBody: '{"received":true}',
    errorMessage: null, durationMs: 48, nextRetryAt: null, finishedAt: '2026-06-20 10:00:01', createdAt: '2026-06-20 10:00:00',
  },
  {
    id: 2, subscriptionId: 1, clientId: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
    eventType: 'app.quota.exceeded', eventId: 'evt-20260620-0002', status: 'retrying', attempt: 2,
    requestUrl: 'https://demo-app.example.com/webhook', responseStatus: 503, responseBody: 'Service Unavailable',
    errorMessage: 'HTTP 503', durationMs: 120, nextRetryAt: '2026-06-20 10:35:00', finishedAt: null, createdAt: '2026-06-20 10:05:00',
  },
  {
    id: 3, subscriptionId: 1, clientId: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
    eventType: 'app.test', eventId: 'evt-20260619-0009', status: 'failed', attempt: 5,
    requestUrl: 'https://demo-app.example.com/webhook', responseStatus: null, responseBody: null,
    errorMessage: 'connect ETIMEDOUT', durationMs: 10000, nextRetryAt: null, finishedAt: '2026-06-19 18:00:10', createdAt: '2026-06-19 18:00:00',
  },
];
