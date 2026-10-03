import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';
const mocks = vi.hoisted(() => ({ select: vi.fn(), update: vi.fn(), findFirst: vi.fn() }));
vi.mock('../../db', () => ({ db: { select: mocks.select, update: mocks.update, query: { dbBackups: { findFirst: mocks.findFirst } } } }));
vi.mock('../../lib/db-backup', () => ({ createPgDumpBackup: vi.fn(), createDrizzleExportBackup: vi.fn() }));
vi.mock('../files/files.service', () => ({ getRestrictedFileForRead: vi.fn() }));
import { getDbBackupHealth, listStuckDbBackups, markDbBackupFailed, stuckDbBackupCondition } from './db-admin-backups.service';

const dialect = new PgDialect({ casing: 'snake_case' });
const now = new Date('2026-10-03T08:00:00Z');
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function chain(rows: unknown[]): any {
  const builder: Record<string, unknown> = {};
  for (const method of ['from', 'where', 'orderBy', 'limit', 'set', 'returning']) builder[method] = vi.fn(() => builder);
  builder.then = (resolve: (value: unknown) => unknown) => Promise.resolve(rows).then(resolve);
  return builder;
}
const backup = { id: 1, name: '数据库备份', type: 'pg_dump', status: 'running', startedAt: new Date(now.getTime() - 10_000_000), createdAt: new Date(now.getTime() - 10_001_000), updatedAt: now, completedAt: null, durationMs: null, errorMessage: null, fileId: null, fileSize: null, tables: null, createdBy: 1, updatedBy: 1, createdByUser: { nickname: '管理员' } };

describe('database backup monitoring and manual finalization', () => {
  beforeEach(() => { vi.clearAllMocks(); vi.useFakeTimers(); vi.setSystemTime(now); });
  afterEach(() => vi.useRealTimers());

  it('pending has ten minutes to start and running has two hours to complete', () => {
    const compiled = dialect.sqlToQuery(stuckDbBackupCondition(now)!);
    expect(compiled.params).toContain(new Date(now.getTime() - 600_000).toISOString());
    expect(compiled.params).toContain(new Date(now.getTime() - 7_200_000).toISOString());
    expect(compiled.sql).toContain('"created_at" <');
    expect(compiled.sql).toContain('coalesce("db_backups"."started_at", "db_backups"."created_at")');
  });

  it('failures count completion time and cause a warning issue', async () => {
    mocks.select.mockReturnValue(chain([{ pending: 1, running: 2, stuck: 1, failed24h: 3, succeeded24h: 7, failed1h: 1, oldestPendingAgeSec: 900 }]));
    const health = await getDbBackupHealth();
    expect(health.counts).toEqual({ pending: 1, running: 2, stuck: 1, dead: null, failed24h: 3, succeeded24h: 7 });
    expect(health.issues).toEqual([{ level: 'warn', message: '近 24 小时 3 次数据库备份失败' }]);
    expect(dialect.sqlToQuery(mocks.select.mock.calls[0][0].failed24h).sql).toContain('"completed_at" >=');
  });

  it('pending stuck rows and counts share the same predicate and expose the pending drilldown', async () => {
    const builder = chain([{ ...backup, status: 'pending', startedAt: null }]);
    mocks.select.mockReturnValue(builder);
    const [item] = await listStuckDbBackups(23);
    expect(dialect.sqlToQuery(builder.where.mock.calls[0][0])).toEqual(dialect.sqlToQuery(stuckDbBackupCondition(now)!));
    expect(builder.limit).toHaveBeenCalledWith(23);
    expect(item).toMatchObject({ source: 'db-backup', refId: '1', status: 'pending', startedAt: null, ageSec: 10001 });
    expect(item.drillDown?.path).toContain('tab=backups&status=pending');
  });

  it('marks only a still-stuck row as failed with completedAt and a bounded duration', async () => {
    mocks.findFirst.mockResolvedValue(backup);
    const builder = chain([{ ...backup, status: 'failed', completedAt: now, errorMessage: '管理员手动标记卡死备份为失败' }]);
    mocks.update.mockReturnValue(builder);
    const result = await markDbBackupFailed(1);
    expect(result.status).toBe('failed');
    expect(result.createdByName).toBe('管理员');
    expect(builder.set.mock.calls[0][0]).toMatchObject({ status: 'failed', completedAt: now, durationMs: 10_000_000 });
    const condition = dialect.sqlToQuery(builder.where.mock.calls[0][0]);
    expect(condition.params).toContain('pending');
    expect(condition.params).toContain('running');
    expect(condition.params).toContain(new Date(now.getTime() - 600_000).toISOString());
  });

  it('rejects a healthy, completed or concurrently finalized backup with 409', async () => {
    mocks.findFirst.mockResolvedValue(backup);
    mocks.update.mockReturnValue(chain([]));
    await expect(markDbBackupFailed(1)).rejects.toMatchObject({ status: 409 });
  });

  it('rejects missing backup records before any update', async () => {
    mocks.findFirst.mockResolvedValue(undefined);
    await expect(markDbBackupFailed(99)).rejects.toMatchObject({ status: 404 });
    expect(mocks.update).not.toHaveBeenCalled();
  });
});
