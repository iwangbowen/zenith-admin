import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';
import { jobStuckItemSchema } from '@zenith/shared/platform';

const { select } = vi.hoisted(() => ({ select: vi.fn() }));
vi.mock('../../db', () => ({ db: { select } }));
import { getWorkflowJobHealth, listStuckWorkflowJobs, stuckWorkflowJobCondition } from './workflow-jobs.service';

const dialect = new PgDialect({ casing: 'snake_case' });
const now = new Date('2026-10-03T08:00:00Z');
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function chain(rows: unknown[]): any {
  const result: Record<string, unknown> = {};
  for (const method of ['from', 'where', 'leftJoin', 'orderBy', 'limit']) result[method] = vi.fn(() => result);
  result.then = (resolve: (value: unknown) => unknown) => Promise.resolve(rows).then(resolve);
  return result;
}

describe('workflow job monitor health', () => {
  beforeEach(() => { vi.clearAllMocks(); vi.useFakeTimers(); vi.setSystemTime(now); });
  afterEach(() => vi.useRealTimers());

  it('gives expired leases and execution deadlines one minute to recover, including missing leases', () => {
    const compiled = dialect.sqlToQuery(stuckWorkflowJobCondition(now)!);
    expect(compiled.sql).toContain('"lease_until" <');
    expect(compiled.sql).toContain('"execution_deadline" <');
    expect(compiled.sql).toContain('"lease_until" is null');
    const cutoff = new Date(now.getTime() - 60_000).toISOString();
    expect(compiled.params.filter((value) => value === cutoff || (value instanceof Date && value.toISOString() === cutoff))).toHaveLength(3);
  });

  it('counts due ledger jobs and completed execution attempts independently', async () => {
    select.mockReturnValueOnce(chain([{ pending: 3, running: 2, stuck: 1, dead: 4, oldestPendingAgeSec: 180 }]))
      .mockReturnValueOnce(chain([{ failed24h: 5, succeeded24h: 9, failed1h: 2 }]));
    const result = await getWorkflowJobHealth();
    expect(result.counts).toEqual({ pending: 3, running: 2, stuck: 1, dead: 4, failed24h: 5, succeeded24h: 9 });
    expect(result.failed1h).toBe(2);
    expect(dialect.sqlToQuery(select.mock.calls[0][0].pending).sql).toContain('"run_at" <=');
    expect(dialect.sqlToQuery(select.mock.calls[1][0].failed1h).sql).toContain('"finished_at" >=');
  });

  it('stuck drilldown shares the lease predicate and projects context without execution payloads', async () => {
    const builder = chain([{ id: 9, jobType: 'trigger_dispatch', status: 'running', lockedAt: new Date(now.getTime() - 600_000), updatedAt: new Date(now.getTime() - 300_000), createdAt: new Date(now.getTime() - 900_000), lockedBy: 'worker-a', lastError: '租约已过期', nodeKey: 'node-1', instanceTitle: '请假申请' }]);
    select.mockReturnValue(builder);
    const [item] = await listStuckWorkflowJobs(12);
    expect(dialect.sqlToQuery(builder.where.mock.calls[0][0])).toEqual(dialect.sqlToQuery(stuckWorkflowJobCondition(now)!));
    expect(builder.limit).toHaveBeenCalledWith(12);
    expect(item).toMatchObject({ source: 'workflow-job', refId: '9', title: '请假申请 / trigger_dispatch', ageSec: 600, nodeId: 'worker-a', detail: '租约已过期' });
    expect(item.drillDown?.path).toContain('tab=jobs&status=running');
    expect(jobStuckItemSchema.safeParse(item).success).toBe(true);
    expect(select.mock.calls[0][0]).not.toHaveProperty('payload');
  });
});
