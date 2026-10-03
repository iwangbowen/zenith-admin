import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PgDialect, QueryBuilder } from 'drizzle-orm/pg-core';
import { eq } from 'drizzle-orm';
const mocks = vi.hoisted(() => ({ select: vi.fn(), update: vi.fn(), count: vi.fn(), transaction: vi.fn(), findRun: vi.fn(), tenantScope: vi.fn() }));
vi.mock('../../db', () => ({ db: { select: mocks.select, update: mocks.update, $count: mocks.count, transaction: mocks.transaction } }));
vi.mock('../../lib/tenant', async (importOriginal) => ({ ...await importOriginal<Record<string, unknown>>(), tenantScope: mocks.tenantScope }));
import { getDirectorySyncHealth, listStuckDirectorySyncRuns, markDirectorySyncRunFailed, stuckDirectorySyncRunCondition } from './directory-sync.service';
import { finalizeDirectorySyncRun } from './directory-sync-engine';
import { directorySyncSources } from '../../db/schema';

const dialect = new PgDialect({ casing: 'snake_case' });
const now = new Date('2026-10-03T08:00:00Z');
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function chain(rows: unknown[]): any {
  const builder: Record<string, unknown> = {};
  for (const method of ['from', 'where', 'innerJoin', 'orderBy', 'limit', 'set', 'returning']) builder[method] = vi.fn(() => builder);
  builder.then = (resolve: (value: unknown) => unknown) => Promise.resolve(rows).then(resolve);
  return builder;
}
const run = { id: 1, sourceId: 9, triggerType: 'schedule', dryRun: false, status: 'running', startedAt: new Date(now.getTime() - 7_200_000), finishedAt: null, createdAt: now, triggeredBy: null, totalFetched: 0, deptCreated: 0, deptUpdated: 0, userCreated: 0, userLinked: 0, userUpdated: 0, userDisabled: 0, skipped: 0, conflictCount: 0, failedCount: 0, message: '同步中', errorMessage: null };
const source = { id: 9, name: '企业目录', cronExpression: '* * * * *' };

describe('directory sync monitor and terminal result protection', () => {
  beforeEach(() => {
    vi.clearAllMocks(); vi.useFakeTimers(); vi.setSystemTime(now);
    mocks.tenantScope.mockReturnValue(undefined);
    mocks.transaction.mockImplementation((callback) => callback({ update: mocks.update, select: mocks.select, query: { directorySyncRuns: { findFirst: mocks.findRun } } }));
  });
  afterEach(() => vi.useRealTimers());

  it('only running records older than one hour are stuck', () => {
    const compiled = dialect.sqlToQuery(stuckDirectorySyncRunCondition(now)!);
    expect(compiled.params).toEqual(['running', new Date(now.getTime() - 3_600_000).toISOString()]);
    expect(compiled.sql).toContain('"started_at" <');
  });

  it('exposes late sources, failed sources and partial runs as domain issues', async () => {
    mocks.select.mockReturnValue(chain([{ running: 1, stuck: 1, failed24h: 2, succeeded24h: 8, partial24h: 1, failed1h: 1 }]));
    mocks.count.mockResolvedValueOnce(2).mockResolvedValueOnce(1);
    const health = await getDirectorySyncHealth();
    expect(health.counts).toMatchObject({ pending: 0, running: 1, stuck: 1, dead: null, failed24h: 2 });
    expect(health.issues).toHaveLength(3);
    expect(health.issues.every((issue) => issue.level === 'warn')).toBe(true);
    expect(dialect.sqlToQuery(mocks.select.mock.calls[0][0].failed24h).sql).toContain('"finished_at" >=');
  });

  it('lists stuck records with the same predicate and a running source-page filter', async () => {
    const builder = chain([{ ...run, sourceName: source.name }]);
    mocks.select.mockReturnValue(builder);
    const [item] = await listStuckDirectorySyncRuns(21);
    expect(dialect.sqlToQuery(builder.where.mock.calls[0][0])).toEqual(dialect.sqlToQuery(stuckDirectorySyncRunCondition(now)!));
    expect(builder.limit).toHaveBeenCalledWith(21);
    expect(item).toMatchObject({ source: 'directory-sync', refId: '1', title: '企业目录', ageSec: 7200 });
    expect(item.drillDown?.path).toContain('logs?status=running');
  });

  it('atomically marks a stuck run and source failed after checking the source tenant scope', async () => {
    mocks.select.mockReturnValueOnce(chain([run])).mockReturnValueOnce(chain([source]));
    const runUpdate = chain([{ ...run, status: 'failed', finishedAt: now }]);
    const sourceUpdate = chain([]);
    mocks.update.mockReturnValueOnce(runUpdate).mockReturnValueOnce(sourceUpdate);
    const result = await markDirectorySyncRunFailed(1);
    expect(result.status).toBe('failed');
    expect(result.sourceName).toBe('企业目录');
    expect(mocks.tenantScope).toHaveBeenCalledWith(directorySyncSources);
    expect(mocks.transaction).toHaveBeenCalledOnce();
    expect(sourceUpdate.set.mock.calls[0][0]).toMatchObject({ lastRunStatus: 'failed', lastRunAt: run.startedAt });
    expect(dialect.sqlToQuery(runUpdate.where.mock.calls[0][0]).params).toContain(new Date(now.getTime() - 3_600_000).toISOString());
  });

  it('normal, completed or concurrently finalized records cannot be marked and do not update the source', async () => {
    mocks.select.mockReturnValueOnce(chain([run])).mockReturnValueOnce(chain([source]));
    mocks.update.mockReturnValue(chain([]));
    await expect(markDirectorySyncRunFailed(1)).rejects.toMatchObject({ status: 409 });
    expect(mocks.update).toHaveBeenCalledOnce();
  });

  it('retains source tenant scoping in both record lookup and the transactional state update', async () => {
    mocks.tenantScope.mockReturnValue(eq(directorySyncSources.tenantId, 8));
    const runLookup = chain([run]);
    const sourceLookup = chain([source]);
    const lookups = [runLookup, sourceLookup];
    // 只有作用域子查询使用真实 SQL builder；行查询仍为固定数据库替身。
    mocks.select.mockImplementation((projection) => projection ? new QueryBuilder().select(projection) : lookups.shift());
    const runUpdate = chain([{ ...run, status: 'failed', finishedAt: now }]);
    mocks.update.mockReturnValueOnce(runUpdate).mockReturnValueOnce(chain([]));
    await markDirectorySyncRunFailed(1);
    for (const predicate of [runLookup.where.mock.calls[0][0], runUpdate.where.mock.calls[0][0]]) {
      const compiled = dialect.sqlToQuery(predicate);
      expect(compiled.sql).toContain('"tenant_id" =');
      expect(compiled.params).toContain(8);
    }
  });

  it('missing or tenant-invisible runs are rejected before a write transaction', async () => {
    mocks.select.mockReturnValue(chain([]));
    await expect(markDirectorySyncRunFailed(1)).rejects.toMatchObject({ status: 404 });
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it('preview finalization never modifies the source status', async () => {
    mocks.select.mockReturnValueOnce(chain([{ ...run, dryRun: true }])).mockReturnValueOnce(chain([source]));
    mocks.update.mockReturnValue(chain([{ ...run, dryRun: true, status: 'failed', finishedAt: now }]));
    await markDirectorySyncRunFailed(1);
    expect(mocks.update).toHaveBeenCalledOnce();
  });

  it('a late successful executor preserves manual failure and does not overwrite source state', async () => {
    mocks.update.mockReturnValue(chain([]));
    mocks.findRun.mockResolvedValue({ status: 'failed', message: '管理员手动标记卡死同步为失败' });
    const result = await finalizeDirectorySyncRun(run, '* * * * *', 'success', { userCreated: 10 }, '同步完成');
    expect(result).toEqual({ runId: 1, status: 'failed', message: '管理员手动标记卡死同步为失败' });
    expect(mocks.update).toHaveBeenCalledOnce();
    expect(dialect.sqlToQuery(mocks.update.mock.results[0].value.where.mock.calls[0][0]).params).toContain('running');
  });

  it('an accepted executor completion updates its source in the same transaction', async () => {
    const runUpdate = chain([{ id: 1 }]);
    const sourceUpdate = chain([]);
    mocks.update.mockReturnValueOnce(runUpdate).mockReturnValueOnce(sourceUpdate);
    await expect(finalizeDirectorySyncRun(run, '* * * * *', 'success', {}, '完成')).resolves.toMatchObject({ status: 'success' });
    expect(sourceUpdate.set.mock.calls[0][0]).toMatchObject({ lastRunStatus: 'success' });
    expect(mocks.findRun).not.toHaveBeenCalled();
  });
});
