import { afterEach, describe, expect, it } from 'vitest';
import { fillPath, type AnyOperation, type ApiResponse, type InputOf, type OutputOf } from '@zenith/shared/core';
import { workflowEventSubscriptionContract, workflowEventDeliverySchema } from '@zenith/shared/workflow';
import { workflowEventSubscriptionsHandlers, mockSubscriptions, mockDeliveries, mockDeliveryJobs } from './handlers/workflow-event-subscriptions';

const subscriptions = structuredClone(mockSubscriptions);
const deliveries = structuredClone(mockDeliveries);
const jobs = structuredClone([...mockDeliveryJobs.entries()]);
afterEach(() => {
  mockSubscriptions.splice(0, mockSubscriptions.length, ...structuredClone(subscriptions));
  mockDeliveries.splice(0, mockDeliveries.length, ...structuredClone(deliveries));
  mockDeliveryJobs.clear(); for (const [id, job] of structuredClone(jobs)) mockDeliveryJobs.set(id, job);
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
