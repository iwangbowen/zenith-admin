import { afterEach, describe, expect, it } from 'vitest';
import { fillPath, type AnyOperation, type ApiResponse, type InputOf, type OutputOf } from '@zenith/shared/core';
import { workflowEventSubscriptionContract, workflowEventDeliverySchema } from '@zenith/shared/workflow';
import { workflowEventSubscriptionsHandlers, mockSubscriptions, mockDeliveries, mockDeliveryJobs } from './handlers/workflow-event-subscriptions';
import { mockWorkflowConnectors } from './data/workflow-connectors';

const subscriptions = structuredClone(mockSubscriptions);
const deliveries = structuredClone(mockDeliveries);
const jobs = structuredClone([...mockDeliveryJobs.entries()]);
const connectors = structuredClone(mockWorkflowConnectors);
afterEach(() => {
  mockSubscriptions.splice(0, mockSubscriptions.length, ...structuredClone(subscriptions));
  mockDeliveries.splice(0, mockDeliveries.length, ...structuredClone(deliveries));
  mockDeliveryJobs.clear(); for (const [id, job] of structuredClone(jobs)) mockDeliveryJobs.set(id, job);
  mockWorkflowConnectors.splice(0, mockWorkflowConnectors.length, ...structuredClone(connectors));
});

describe('event subscription Demo configuration', () => {
  function connector(type: 'http' | 'webhook' | 'email' = 'http') {
    mockWorkflowConnectors.push({ ...mockWorkflowConnectors[0], id: 999, type, code: 'test-erp', config: { baseUrl: 'https://1.1.1.1/v1' }, status: 'disabled' });
  }
  it('generates a random HMAC key without disclosing it in normal responses', async () => {
    const created = await call(workflowEventSubscriptionContract.create, { body: { name: '合同归档', url: 'https://1.1.1.1/events', events: ['instance.approved'], secret: '', enabled: false } });
    const id = created.body.data.id;
    const secret = await call(workflowEventSubscriptionContract.secret, { params: { id } });
    expect(secret.body.data.secret).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(JSON.stringify(created.body.data)).not.toContain(secret.body.data.secret);
    const edited = await call(workflowEventSubscriptionContract.update, { params: { id }, body: { secret: '', description: '不更换密钥' } });
    expect(edited.body.data.secretMasked).toBe(created.body.data.secretMasked);
    expect((await call(workflowEventSubscriptionContract.secret, { params: { id } })).body.data.secret).toBe(secret.body.data.secret);
  });
  it('generates the first key when an unsigned subscription switches to HMAC', async () => {
    const created = await call(workflowEventSubscriptionContract.create, { body: { name: '无签名归档', url: 'https://1.1.1.1/events', events: ['instance.approved'], signMode: 'none', enabled: false } });
    expect(created.body.data.secretMasked).toBeNull();
    const edited = await call(workflowEventSubscriptionContract.update, { params: { id: created.body.data.id }, body: { signMode: 'hmacSha256' } });
    expect(edited.body.data.secretMasked).not.toBeNull();
  });
  it('supports connector paths and rejects clearing their origin without replacing the URL', async () => {
    connector('webhook');
    const created = await call(workflowEventSubscriptionContract.create, { body: { name: 'ERP归档', url: '/contracts', connectorId: 999, events: ['instance.approved'], enabled: false } });
    expect(created.status).toBe(200);
    const id = created.body.data.id;
    expect((await call(workflowEventSubscriptionContract.update, { params: { id }, body: { url: '/archived-contracts' } })).status).toBe(200);
    const cleared = await call(workflowEventSubscriptionContract.update, { params: { id }, body: { connectorId: null } });
    expect(cleared.status).toBe(400);
    expect(cleared.body.message).toContain('清除连接器');
    expect((await call(workflowEventSubscriptionContract.update, { params: { id }, body: { connectorId: null, url: 'https://1.1.1.1/contracts' } })).status).toBe(200);
  });
  it('rejects cross-origin URLs and notification adapters before saving', async () => {
    connector();
    const crossOrigin = await call(workflowEventSubscriptionContract.create, { body: { name: '非法目标', url: 'https://8.8.8.8/events', connectorId: 999, events: ['instance.approved'] } });
    expect(crossOrigin.status).toBe(400);
    mockWorkflowConnectors.find((item) => item.id === 999)!.type = 'email';
    const email = await call(workflowEventSubscriptionContract.create, { body: { name: '非法通道', url: '/events', connectorId: 999, events: ['instance.approved'] } });
    expect(email.status).toBe(400);
  });
  it('refuses a test delivery when a HMAC key is absent', async () => {
    mockSubscriptions[0].secret = null;
    const result = await call(workflowEventSubscriptionContract.test, { params: { id: 1 } });
    expect(result.body.data).toMatchObject({ ok: false, httpStatus: null, error: expect.stringContaining('已拒绝发送') });
  });
});

async function call<Op extends AnyOperation>(operation: Op, input: InputOf<Op>) {
  const { params, query, body } = input as { params?: Record<string, unknown>; query?: Record<string, unknown>; body?: unknown };
  const url = new URL(fillPath(operation.fullPath, params), window.location.origin);
  for (const [key, value] of Object.entries(query ?? {})) url.searchParams.set(key, String(value));
  for (const handler of workflowEventSubscriptionsHandlers) {
    const request = new Request(url, { method: operation.method.toUpperCase(), headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
    const result = await (handler as unknown as { run: (args: unknown) => Promise<{ response?: Response } | null> }).run({ request, requestId: 'event-delivery-test' });
    if (result?.response) return { status: result.response.status, body: await result.response.json() as ApiResponse<OutputOf<Op>> };
  }
  throw new Error('No event subscription handler matched');
}

describe('event delivery Demo contract', () => {
  it('preserves failed attempts when queuing a manual retry and blocks double submission', async () => {
    mockSubscriptions[1].enabled = true;
    const before = structuredClone(mockDeliveries[1]);
    const result = await call(workflowEventSubscriptionContract.retryDelivery, { params: { id: 2 } });
    expect(result.status).toBe(200);
    expect(workflowEventDeliverySchema.safeParse(result.body.data).success).toBe(true);
    expect(result.body.data).toMatchObject({ status: 'failed', attempt: 2, jobStatus: 'pending', canRetry: false });
    expect(mockDeliveries[1]).toEqual(before);
    expect((await call(workflowEventSubscriptionContract.retryDelivery, { params: { id: 2 } })).status).toBe(409);
  });

  it('shows the retry time and separates outcome and scheduling filters', async () => {
    const job = mockDeliveryJobs.get(2)!; job.status = 'pending'; job.attempts = 2; job.runAt = '2026-10-06 09:00:00';
    const result = await call(workflowEventSubscriptionContract.deliveries, { query: { status: 'failed', jobStatus: 'retrying' } });
    expect(result.body.data.list).toHaveLength(1);
    expect(result.body.data.list[0]).toMatchObject({ status: 'failed', jobStatus: 'retrying', nextRetryAt: job.runAt, canRetry: false });
  });

  it('does not turn an old failure into success after a skipped retry', async () => {
    mockDeliveries.push({ ...mockDeliveries[1], id: 3, status: 'skipped', attempt: 3, errorMessage: '订阅已被禁用' });
    mockDeliveryJobs.get(2)!.status = 'succeeded';
    const failed = await call(workflowEventSubscriptionContract.deliveries, { query: { status: 'failed', jobStatus: 'skipped' } });
    expect(failed.body.data.list).toHaveLength(1);
    expect(failed.body.data.list[0]).toMatchObject({ id: 2, status: 'failed', isLatestExecution: false, errorMessage: '外部服务暂不可用' });
    const skipped = await call(workflowEventSubscriptionContract.deliveries, { query: { status: 'skipped' } });
    expect(skipped.body.data.list[0]).toMatchObject({ id: 3, status: 'skipped', canReplay: false });
  });

  it('replays a successful completion as a new job without rewriting its old execution', async () => {
    const before = structuredClone(mockDeliveries[0]);
    const result = await call(workflowEventSubscriptionContract.replayDelivery, { params: { id: 1 } });
    expect(result.body.data).toEqual({ count: 1 });
    expect(mockDeliveries[0]).toEqual(before);
    expect(mockDeliveryJobs.get(3)).toMatchObject({ status: 'pending', attempts: 0 });
  });

  it('honors event filtering, ignores disabled subscriptions and counts jobs once', async () => {
    const disabled = await call(workflowEventSubscriptionContract.replayDeliveries, { body: { subscriptionId: 2, eventType: 'task.transferred', status: 'failed' } });
    expect(disabled.body.data.count).toBe(0);
    mockSubscriptions[1].enabled = true;
    const wrongType = await call(workflowEventSubscriptionContract.replayDeliveries, { body: { subscriptionId: 2, eventType: 'instance.approved', status: 'failed' } });
    expect(wrongType.body.data.count).toBe(0);
    const matching = await call(workflowEventSubscriptionContract.replayDeliveries, { body: { subscriptionId: 2, eventType: 'task.transferred', status: 'failed' } });
    expect(matching.body.data.count).toBe(1);
    expect(mockDeliveries[1].status).toBe('failed');
  });
});
