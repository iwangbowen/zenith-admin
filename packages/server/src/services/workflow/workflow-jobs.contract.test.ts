import { beforeEach, describe, expect, expectTypeOf, it, vi } from 'vitest';
import {
  workflowEngineContract,
  workflowJobChainSchema,
  workflowJobDetailSchema,
  type WorkflowJob,
  type WorkflowJobExecution,
} from '@zenith/shared/workflow';

const { select, transaction, drain, wakeEventConsumers, currentUser, isPlatformAdmin } = vi.hoisted(() => ({
  select: vi.fn(),
  transaction: vi.fn(),
  drain: vi.fn(),
  wakeEventConsumers: vi.fn(),
  currentUser: vi.fn(() => ({ userId: 7, username: 'operator', roles: [], tenantId: 1 })),
  isPlatformAdmin: vi.fn(() => false),
}));
vi.mock('../../db', () => ({ db: { select, transaction } }));
vi.mock('../../lib/context', () => ({ currentUser }));
vi.mock('../../lib/tenant', () => ({ isPlatformAdmin }));
vi.mock('../../lib/domain-events', () => ({ wakeEventConsumers }));
vi.mock('../../lib/workflow-jobs', () => ({ retryJob: vi.fn(), skipJob: vi.fn(), drainWorkflowJobs: drain }));
vi.mock('../../lib/workflow-jobs/engine', () => ({ expiredWorkflowJobCondition: vi.fn() }));
vi.mock('./workflow-engine-introspection.service', () => ({
  getWorkflowEngineIntrospection: vi.fn(), getWorkflowEngineThresholds: vi.fn(), severityFromHealth: vi.fn(),
}));

import { getWorkflowJobChain, getWorkflowJobDetail } from './workflow-jobs.service';
import { previewWorkflowEngineAction, runWorkflowEngineAction } from './workflow-engine-ops.service';
import { formatDateTime } from '../../lib/datetime';

function queryResult(rows: unknown[]) {
  return {
    from: vi.fn().mockReturnThis(), leftJoin: vi.fn().mockReturnThis(), innerJoin: vi.fn().mockReturnThis(), where: vi.fn().mockReturnThis(),
    limit: vi.fn().mockResolvedValue(rows), orderBy: vi.fn().mockResolvedValue(rows),
  };
}

const startedAt = new Date('2026-09-08T00:00:00Z');
const leaseUntil = new Date('2026-09-08T00:01:00Z');
const executionDeadline = new Date('2026-09-08T00:10:00Z');
const job = {
  id: 1, jobType: 'webhook_delivery', status: 'running', instanceId: 2, taskId: null, nodeKey: null,
  idempotencyKey: 'job-1', traceId: 'trace-1', payload: {}, priority: 0, attempts: 2, maxAttempts: 5,
  generation: 3, executionTimeoutMs: 600_000, leaseToken: 'private-lease', leaseUntil, executionDeadline,
  runAt: startedAt, lockedAt: startedAt, lockedBy: 'worker-1', lastError: null, result: null, tenantId: 1,
  createdAt: startedAt, updatedAt: startedAt,
};
const execution = {
  id: 10, jobId: 1, jobType: 'webhook_delivery', attempt: 2, generation: 3, leaseToken: 'private-lease',
  status: 'running', startedAt, finishedAt: null, createdAt: startedAt,
};

beforeEach(() => {
  select.mockReset();
  transaction.mockReset();
  drain.mockReset();
  wakeEventConsumers.mockReset();
  currentUser.mockReset();
  currentUser.mockReturnValue({ userId: 7, username: 'operator', roles: [], tenantId: 1 });
  isPlatformAdmin.mockReset();
  isPlatformAdmin.mockReturnValue(false);
});

describe('workflow job API mapping', () => {
  it('maps lease timing and execution generation without exposing the lease token', async () => {
    select.mockReturnValueOnce(queryResult([{ job, instanceTitle: 'Instance', definitionName: 'Definition' }]))
      .mockReturnValueOnce(queryResult([execution]));

    const detail = await getWorkflowJobDetail(1);

    expect(workflowJobDetailSchema.safeParse(detail).success).toBe(true);
    expect(detail).toMatchObject({ generation: 3, executionTimeoutMs: 600_000,
      leaseUntil: formatDateTime(leaseUntil), executionDeadline: formatDateTime(executionDeadline) });
    expect(detail.executions[0]).toMatchObject({ generation: 3, attempt: 2 });
    expect(detail).not.toHaveProperty('leaseToken');
    expect(detail.executions[0]).not.toHaveProperty('leaseToken');
    expectTypeOf<WorkflowJob['generation']>().toEqualTypeOf<number>();
    expectTypeOf<WorkflowJob['leaseUntil']>().toEqualTypeOf<string | null>();
    expectTypeOf<WorkflowJobExecution['generation']>().toEqualTypeOf<number>();
  });

  it('includes paused jobs in chain totals and preserves their execution history', async () => {
    select.mockReturnValueOnce(queryResult([{ job: { ...job, status: 'paused', leaseUntil: null, executionDeadline: null } }]))
      .mockReturnValueOnce(queryResult([execution]));

    const chain = await getWorkflowJobChain('trace-1');

    expect(workflowJobChainSchema.safeParse(chain).success).toBe(true);
    expect(chain.stats).toMatchObject({ total: 1, paused: 1, running: 0 });
    expect(chain.jobs[0].executions[0].generation).toBe(3);
  });
});

describe('workflow recovery response', () => {
  it('reports reconciliation and submitted wakeups rather than completed execution', async () => {
    drain.mockResolvedValue({ recovered: 2, requeued: 1, dead: 1 });

    const result = await runWorkflowEngineAction('recover-webhooks', { instanceId: 2, limit: 3 });

    expect(drain).toHaveBeenCalledWith({ jobTypes: ['webhook_delivery'], instanceId: 2, olderThanMinutes: undefined, limit: 3 });
    expect(result).toMatchObject({ ok: true, detail: { recovered: 2, requeued: 1, dead: 1 } });
    expect(result.message).toContain('已提交补投');
    expect(result.detail).not.toHaveProperty('processed');
  });

  it('requires a platform administrator before replaying event consumers', async () => {
    await expect(runWorkflowEngineAction('replay-outbox', {})).rejects.toMatchObject({
      status: 403,
      message: '仅平台超管可以恢复领域事件消费者',
    });
    expect(transaction).not.toHaveBeenCalled();
    expect(wakeEventConsumers).not.toHaveBeenCalled();
  });

  it('requires a platform administrator before previewing event consumers', async () => {
    await expect(previewWorkflowEngineAction('replay-outbox', {})).rejects.toMatchObject({
      status: 403,
      message: '仅平台超管可以恢复领域事件消费者',
    });
    expect(select).not.toHaveBeenCalled();
  });

  it('allows the platform administrator path and wakes consumers after recovery', async () => {
    isPlatformAdmin.mockReturnValue(true);
    const tx = {
      select: vi.fn(() => ({
        from: vi.fn().mockReturnThis(),
        innerJoin: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        orderBy: vi.fn().mockReturnThis(),
        limit: vi.fn().mockResolvedValue([{ id: 11 }]),
      })),
      update: vi.fn(),
    };
    const updateChain = {
      set: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      returning: vi.fn().mockResolvedValue([]),
    };
    tx.update.mockReturnValue(updateChain);
    transaction.mockImplementation(async (callback: (executor: typeof tx) => unknown) => callback(tx));

    const result = await runWorkflowEngineAction('replay-outbox', { limit: 1 });

    expect(result).toMatchObject({ ok: true, detail: { recovered: 0, requeued: 0, dead: 0 } });
    expect(transaction).toHaveBeenCalledTimes(1);
    expect(wakeEventConsumers).toHaveBeenCalledTimes(1);
  });

  it('keeps the shared action permission unchanged while service-scoping replay-outbox', () => {
    expect(workflowEngineContract.runAction.access).toEqual({
      permission: 'workflow:engine:operate',
    });
  });
});
