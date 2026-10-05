import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';
import { workflowEventDeliverySchema } from '@zenith/shared/workflow';
import { formatDateTime } from '../../lib/datetime';

const mocks = vi.hoisted(() => ({ select: vi.fn(), retryJob: vi.fn(), enqueueJob: vi.fn(), scheduleJobPickup: vi.fn() }));
vi.mock('../../db', () => ({ db: { select: mocks.select } }));
vi.mock('../../lib/context', () => ({ currentUser: () => ({ userId: 1, roles: ['super_admin'], tenantId: null }) }));
vi.mock('../../lib/workflow-jobs/engine', () => ({ retryJob: mocks.retryJob, enqueueJob: mocks.enqueueJob, scheduleJobPickup: mocks.scheduleJobPickup }));
vi.mock('./workflow-connectors.service', () => ({ invokeConnector: vi.fn(), getConnectorRowById: vi.fn(), ensureConnector: vi.fn() }));

import { mapDelivery, replayDeliveriesByFilter, retryDelivery } from './workflow-event-subscriptions.service';

const at = new Date('2026-10-05T11:00:00Z');
const row: Parameters<typeof mapDelivery>[0] = {
  execution: { id: 10, jobId: 1, jobType: 'webhook_delivery', attempt: 1, generation: 0,
    leaseToken: 'private-token', status: 'failed', requestUrl: 'https://erp.example/hook', requestMethod: 'POST',
    requestBody: '{}', responseStatus: null, responseBody: null, errorMessage: 'connection failed', durationMs: 100,
    scheduledAt: at, startedAt: at, finishedAt: at, tenantId: null, createdAt: at },
  job: { id: 1, jobType: 'webhook_delivery', status: 'pending', instanceId: 46, taskId: null, nodeKey: null,
    idempotencyKey: 'webhook:event-1:1', traceId: 'event-1', parentRef: null,
    payload: { subscriptionId: 1, event: { eventId: 'event-1', type: 'instance.approved' } },
    priority: 100, attempts: 1, maxAttempts: 5, generation: 0, operationKey: 'operation-1', executionTimeoutMs: 10000,
    runAt: at, lockedAt: null, lockedBy: null, leaseToken: null, leaseUntil: null, executionDeadline: null,
    pausedRemainingMs: null, lastError: 'connection failed', result: null, tenantId: null,
    createdBy: null, updatedBy: null, createdAt: at, updatedAt: at },
  subscriptionName: 'ERP', subscriptionEnabled: true, latestExecutionId: 10, latestExecutionStatus: 'failed',
};

function query(rows: unknown[]) {
  return { from: vi.fn().mockReturnThis(), innerJoin: vi.fn().mockReturnThis(), leftJoin: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(), orderBy: vi.fn().mockReturnThis(), limit: vi.fn().mockResolvedValue(rows) };
}

beforeEach(() => { vi.clearAllMocks(); });

describe('event delivery read model', () => {
  it('preserves attempt facts while exposing the actual scheduled retry', () => {
    const result = mapDelivery(row);
    expect(workflowEventDeliverySchema.safeParse(result).success).toBe(true);
    expect(result).toMatchObject({ jobId: 1, status: 'failed', jobStatus: 'retrying', nextRetryAt: formatDateTime(at), canRetry: false });
  });

  it('does not replace historical outcomes or errors when a later attempt is skipped', () => {
    const result = mapDelivery({ ...row, latestExecutionId: 11, latestExecutionStatus: 'skipped', job: { ...row.job, status: 'succeeded', lastError: 'subscription disabled' } });
    expect(result).toMatchObject({ status: 'failed', jobStatus: 'skipped', errorMessage: 'connection failed', isLatestExecution: false, nextRetryAt: null });
    expect(mapDelivery({ ...row, execution: { ...row.execution, status: 'succeeded', errorMessage: null }, job: { ...row.job, status: 'dead' } }).errorMessage).toBeNull();
  });

  it('rejects manual retry while the same job is already scheduled automatically', async () => {
    mocks.select.mockReturnValue(query([row]));
    await expect(retryDelivery(10)).rejects.toMatchObject({ status: 409 });
    expect(mocks.retryJob).not.toHaveBeenCalled();
  });

  it('rejects stale history and disabled subscriptions even if the job is dead', async () => {
    mocks.select.mockReturnValueOnce(query([{ ...row, latestExecutionId: 11, job: { ...row.job, status: 'dead' } }]))
      .mockReturnValueOnce(query([{ ...row, subscriptionEnabled: false, job: { ...row.job, status: 'dead' } }]));
    await expect(retryDelivery(10)).rejects.toMatchObject({ status: 409 });
    await expect(retryDelivery(10)).rejects.toMatchObject({ status: 409 });
    expect(mocks.retryJob).not.toHaveBeenCalled();
  });
});

describe('event replay selection', () => {
  it('selects nested event.type and restricts replay to enabled subscriptions', async () => {
    const q = query([{ ...row.job, status: 'dead' }]);
    mocks.select.mockReturnValue(q); mocks.retryJob.mockResolvedValue(row.job);
    expect(await replayDeliveriesByFilter({ subscriptionId: 1, eventType: 'instance.approved', status: 'failed' })).toEqual({ count: 1 });
    const where = new PgDialect().sqlToQuery(q.where.mock.calls[0][0]);
    expect(where.sql).toContain("->'event'->>'type'");
    expect(where.params).toContain('instance.approved');
    expect(where.sql).toContain('exists');
    expect(where.sql).toContain('"workflow_event_subscriptions"."enabled" = true');
  });

  it('does not classify a skipped completion as a successful HTTP delivery', async () => {
    const q = query([]); mocks.select.mockReturnValue(q);
    expect(await replayDeliveriesByFilter({ subscriptionId: 1, status: 'success' })).toEqual({ count: 0 });
    const where = new PgDialect().sqlToQuery(q.where.mock.calls[0][0]);
    expect(where.sql).toContain('event_delivery_latest_execution');
    expect(where.sql).toContain('from "workflow_job_executions" as "event_delivery_latest_execution"');
    expect(where.sql).toContain("= 'succeeded'");
  });
});
