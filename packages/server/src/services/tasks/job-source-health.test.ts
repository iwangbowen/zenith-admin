import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';
import { type SQL } from 'drizzle-orm';

const { select, execute, getQueueDepths } = vi.hoisted(() => ({ select: vi.fn(), execute: vi.fn(), getQueueDepths: vi.fn() }));
vi.mock('../../db', () => ({ db: { select, execute } }));
vi.mock('../../lib/pg-boss-scheduler', async (importOriginal) => ({
  ...await importOriginal<Record<string, unknown>>(), getQueueDepths,
}));

import { getAsyncTaskHealth, stuckAsyncTaskCondition } from './async-tasks.service';
import { getExportJobHealth, stuckExportJobCondition } from './export-jobs.service';
import { getSchedulerRunHealth, overdueSchedulerRunCondition } from './system-scheduler.service';
import { getCronJobHealth, stuckCronRunCondition } from './cron-jobs.service';

const dialect = new PgDialect({ casing: 'snake_case' });
const now = new Date('2026-10-03T08:00:00Z');
function query(fragment: SQL) { return dialect.sqlToQuery(fragment); }
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function chain(rows: unknown[]): any {
  const result: Record<string, unknown> = {};
  for (const method of ['from', 'where', 'innerJoin', 'leftJoin']) result[method] = vi.fn(() => result);
  result.then = (resolve: (value: unknown) => unknown) => Promise.resolve(rows).then(resolve);
  return result;
}

describe('core job source health semantics', () => {
  beforeEach(() => { vi.clearAllMocks(); vi.useFakeTimers(); vi.setSystemTime(now); });
  afterEach(() => vi.useRealTimers());

  it('task heartbeat has two recovery windows and falls back to updatedAt when no heartbeat exists', () => {
    const compiled = query(stuckAsyncTaskCondition(now)!);
    expect(compiled.sql).toContain('"heartbeat_at" <');
    expect(compiled.sql).toContain('"heartbeat_at" is null');
    expect(compiled.sql).toContain('"updated_at" <');
    const cutoff = new Date(now.getTime() - 180_000).toISOString();
    expect(compiled.params.filter((value) => value === cutoff)).toHaveLength(2);
  });

  it('task backlog excludes future nextRunAt and failures use completedAt rather than submission time', async () => {
    select.mockReturnValue(chain([{ pending: 2, running: 1, stuck: 0, failed24h: 3, succeeded24h: 7, failed1h: 1, oldestPendingAgeSec: 90 }]));
    const result = await getAsyncTaskHealth();
    const projection = select.mock.calls[0][0];
    expect(query(projection.pending).sql).toMatch(/"next_run_at" is null.*"next_run_at" <=/);
    expect(query(projection.failed24h).sql).toContain('"completed_at" >=');
    expect(query(projection.failed24h).sql).not.toContain('"created_at"');
    expect(result.counts).toEqual({ pending: 2, running: 1, stuck: 0, dead: null, failed24h: 3, succeeded24h: 7 });
    expect(result.failed1h).toBe(1);
  });

  it('exports use thirty minutes without relying on an unavailable heartbeat', async () => {
    const compiled = query(stuckExportJobCondition(now)!);
    expect(compiled.sql).toContain('"started_at" <');
    expect(compiled.params).toContain(new Date(now.getTime() - 1_800_000).toISOString());
    select.mockReturnValue(chain([]));
    expect(await getExportJobHealth()).toEqual({ counts: { pending: 0, running: 0, stuck: 0, dead: null, failed24h: 0, succeeded24h: 0 }, oldestPendingAgeSec: null, failed1h: 0, issues: [] });
  });

  it('scheduler pending uses ready counts so deferred requests are excluded', async () => {
    getQueueDepths.mockResolvedValue([{ ready: 4, deferred: 99, active: 1 }, { ready: 2, deferred: 50, active: 0 }]);
    select.mockReturnValue(chain([{ running: 1, stuck: 1, failed24h: 2, succeeded24h: 8, failed1h: 1 }]));
    execute.mockResolvedValue([{ age: 45 }]);
    const result = await getSchedulerRunHealth();
    expect(result.counts.pending).toBe(6);
    expect(result.oldestPendingAgeSec).toBe(45);
    expect(query(overdueSchedulerRunCondition(now)!).sql).toContain('coalesce("system_scheduler_task_configs"."timeout_ms", 1800000)');
    expect(query(select.mock.calls[0][0].failed24h).sql).toContain('"ended_at" >=');
  });

  it('cron uses seconds for timeout and existing missed-run/consecutive-failure rules', async () => {
    const job = { id: 1, name: 'missed', handler: 'test', cronExpression: '* * * * *', status: 'enabled', monitorTimeout: 300, lastRunAt: null, lastRunStatus: 'fail', createdAt: new Date('2026-10-01T00:00:00Z'), updatedAt: new Date('2026-10-01T00:00:00Z') };
    select.mockReturnValueOnce(chain([{ running: 2, stuck: 1, failed24h: 2, succeeded24h: 4, failed1h: 1 }])).mockReturnValueOnce(chain([job]));
    execute.mockResolvedValue([{ jobId: 1, statuses: ['timeout', 'fail'] }]);
    const result = await getCronJobHealth();
    expect(result.issues).toEqual(expect.arrayContaining([{ level: 'warn', message: expect.stringContaining('至今无执行记录') }, { level: 'critical', message: 'missed 连续失败 2 次' }]));
    expect(query(stuckCronRunCondition(now)!).sql).toContain("interval '1 second'");
    expect(query(select.mock.calls[0][0].failed24h).sql).toContain("in ('fail', 'timeout')");
    expect(result.counts.pending).toBe(0);
  });
});
