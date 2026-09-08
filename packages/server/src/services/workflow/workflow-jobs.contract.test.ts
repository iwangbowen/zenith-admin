import { beforeEach, describe, expect, expectTypeOf, it, vi } from 'vitest';
import { workflowJobChainSchema, workflowJobDetailSchema, type WorkflowJob, type WorkflowJobExecution } from '@zenith/shared/workflow';

const { select, drain } = vi.hoisted(() => ({ select: vi.fn(), drain: vi.fn() }));
vi.mock('../../db', () => ({ db: { select } }));
vi.mock('../../lib/workflow-jobs', () => ({ retryJob: vi.fn(), skipJob: vi.fn(), drainWorkflowJobs: drain }));
vi.mock('../../lib/workflow-jobs/engine', () => ({ expiredWorkflowJobCondition: vi.fn() }));
vi.mock('./workflow-engine-introspection.service', () => ({
  getWorkflowEngineIntrospection: vi.fn(), getWorkflowEngineThresholds: vi.fn(), severityFromHealth: vi.fn(),
}));

import { getWorkflowJobChain, getWorkflowJobDetail } from './workflow-jobs.service';
import { runWorkflowEngineAction } from './workflow-engine-ops.service';
import { formatDateTime } from '../../lib/datetime';

function queryResult(rows: unknown[]) {
  return {
    from: vi.fn().mockReturnThis(), leftJoin: vi.fn().mockReturnThis(), where: vi.fn().mockReturnThis(),
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
  drain.mockReset();
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
});
