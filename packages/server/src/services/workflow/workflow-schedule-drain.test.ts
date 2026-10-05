import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';
import type { SQL } from 'drizzle-orm';
import type { WorkflowScheduleRow } from '../../db/schema';

const model = vi.hoisted(() => ({ rows: [] as WorkflowScheduleRow[], jobs: [] as Record<string, unknown>[],
  transaction: vi.fn(), enqueue: vi.fn(), locks: vi.fn(), costMs: 0, failEnqueue: false, roundSizes: [] as number[] }));
vi.mock('../../lib/workflow-jobs/lease', () => ({ workflowTransaction: model.transaction }));
vi.mock('../../lib/workflow-jobs/engine', () => ({ enqueueJob: model.enqueue }));
import { runDueWorkflowSchedules } from './workflow-schedules.service';

const dialect = new PgDialect({ casing: 'snake_case' });
const now = new Date('2026-10-06T04:00:00Z');
function rule(id: number, due: string): WorkflowScheduleRow {
  return { id, definitionId: 5, initiatorId: 4, tenantId: null, name: '定时补货', cronExpression: '* * * * *', timezone: 'Asia/Shanghai',
    status: 'enabled', nextRunAt: new Date(due), titleTemplate: '补货 {{datetime}}', formData: { quantity: 12 } } as WorkflowScheduleRow;
}
beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(now); vi.clearAllMocks();
  model.rows = []; model.jobs = []; model.costMs = 0; model.failEnqueue = false; model.roundSizes = [];
  model.enqueue.mockImplementation(async (job) => {
    if (model.failEnqueue) throw new Error('ledger unavailable');
    model.jobs.push(job);
    vi.setSystemTime(Date.now() + model.costMs);
    return { ...job, id: model.jobs.length };
  });
  model.transaction.mockImplementation(async (callback) => {
    const beforeRows = structuredClone(model.rows), beforeJobs = [...model.jobs];
    const tx = {
      select: () => ({ from: () => ({ where: () => ({ orderBy: () => ({ limit: (size: number) => ({ for: async (...lockArgs: unknown[]) => {
        model.roundSizes.push(size); model.locks(...lockArgs);
        return model.rows.filter((r) => r.status === 'enabled' && r.nextRunAt && r.nextRunAt <= now)
          .sort((a, b) => a.nextRunAt!.getTime() - b.nextRunAt!.getTime() || a.id - b.id).slice(0, size).map((r) => structuredClone(r));
      } }) }) }) }) }),
      update: () => ({ set: (patch: Partial<WorkflowScheduleRow>) => ({ where: async (condition: SQL) => {
        const id = dialect.sqlToQuery(condition).params[0];
        Object.assign(model.rows.find((r) => r.id === id)!, patch);
      } }) }),
    };
    try { return await callback(tx); }
    catch (error) { model.rows = beforeRows; model.jobs = beforeJobs; throw error; }
  });
});
afterEach(() => vi.useRealTimers());

describe('bounded original-period catch-up', () => {
  it('drains an hour outage within one tick without skipping or repeating original minutes', async () => {
    model.rows = [rule(1, '2026-10-06T03:00:00Z')];
    await runDueWorkflowSchedules();
    expect(model.jobs).toHaveLength(61);
    const times = model.jobs.map((j) => (j.payload as Record<string, unknown>).scheduledAt);
    expect(times[0]).toBe('2026-10-06T03:00:00.000Z');
    expect(times.at(-1)).toBe('2026-10-06T04:00:00.000Z');
    expect(new Set(model.jobs.map((j) => j.idempotencyKey)).size).toBe(61);
    expect(model.rows[0].nextRunAt).toEqual(new Date('2026-10-06T04:01:00Z'));
    await runDueWorkflowSchedules();
    expect(model.jobs).toHaveLength(61);
    expect(model.locks).toHaveBeenCalledWith('update', { skipLocked: true });
  });

  it('caps total occurrences and leaves the oldest remainder for the next tick', async () => {
    model.rows = [rule(1, '2026-10-06T01:00:00Z')];
    await runDueWorkflowSchedules();
    expect(model.jobs).toHaveLength(100);
    expect(model.rows[0].nextRunAt).toEqual(new Date('2026-10-06T02:40:00Z'));
    expect(model.roundSizes.every((size) => size <= 20)).toBe(true);
  });

  it('stops at the time budget and gives other due rules a turn before revisiting a backlog', async () => {
    model.rows = [rule(1, '2026-10-06T02:00:00Z'), rule(2, '2026-10-06T04:00:00Z')];
    model.costMs = 600;
    await runDueWorkflowSchedules();
    expect(model.jobs).toHaveLength(9);
    expect((model.jobs[1].payload as Record<string, unknown>).scheduleId).toBe(2);
    expect(model.rows[1].nextRunAt).toEqual(new Date('2026-10-06T04:01:00Z'));
    expect(Date.now() - now.getTime()).toBe(5400); // One in-flight operation may finish after the deadline.
  });

  it('a ledger write failure cannot advance the plan without its durable occurrence', async () => {
    model.rows = [rule(1, '2026-10-06T04:00:00Z')]; model.failEnqueue = true;
    await expect(runDueWorkflowSchedules()).rejects.toThrow('ledger unavailable');
    expect(model.jobs).toEqual([]);
    expect(model.rows[0].nextRunAt).toEqual(now);
  });
});
