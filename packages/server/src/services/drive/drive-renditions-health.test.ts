import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';
import { jobStuckItemSchema } from '@zenith/shared/platform';
const { select } = vi.hoisted(() => ({ select: vi.fn() }));
vi.mock('../../db', () => ({ db: { select } }));
vi.mock('../../lib/file-storage', () => ({ readStoredFile: vi.fn() }));
vi.mock('../../lib/pg-boss-scheduler', () => ({ registerSystemQueueWorker: vi.fn(), registerSystemRecurringJob: vi.fn(), sendSystemJob: vi.fn() }));
vi.mock('../files/files.service', () => ({ getRestrictedFileForRead: vi.fn(), saveGeneratedManagedFile: vi.fn() }));
vi.mock('../files/file-gc.service', () => ({ releaseManagedFiles: vi.fn(), retainManagedFiles: vi.fn() }));
import { getDriveRenditionHealth, listStuckDriveRenditions, stuckDriveRenditionCondition } from './drive-renditions.service';

const dialect = new PgDialect({ casing: 'snake_case' });
const now = new Date('2026-10-03T08:00:00Z');
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function chain(rows: unknown[]): any {
  const result: Record<string, unknown> = {};
  for (const method of ['from', 'where', 'orderBy', 'limit']) result[method] = vi.fn(() => result);
  result.then = (resolve: (value: unknown) => unknown) => Promise.resolve(rows).then(resolve);
  return result;
}
describe('drive rendition health', () => {
  beforeEach(() => { vi.clearAllMocks(); vi.useFakeTimers(); vi.setSystemTime(now); });
  afterEach(() => vi.useRealTimers());
  it('allows three five minute reconciliation periods before reporting pending artifacts', () => {
    const where = dialect.sqlToQuery(stuckDriveRenditionCondition(now)!);
    expect(where.params).toContain('pending');
    expect(where.params).toContain(new Date(now.getTime() - 900_000).toISOString());
    expect(where.sql).toContain('"updated_at" <');
  });
  it('keeps execution queue counts at zero to avoid counting pg-boss twice', async () => {
    select.mockReturnValue(chain([{ stuck: 2, failed24h: 4, succeeded24h: 30, failed1h: 1 }]));
    expect(await getDriveRenditionHealth()).toEqual({ counts: { pending: 0, running: 0, stuck: 2, dead: null, failed24h: 4, succeeded24h: 30 }, oldestPendingAgeSec: null, failed1h: 1, issues: [] });
  });
  it('lists the same stale artifacts in oldest activity order', async () => {
    const builder = chain([{ id: 13, nodeId: 9, kind: 'thumbnail', createdAt: new Date(now.getTime() - 3_600_000), updatedAt: new Date(now.getTime() - 1_200_000), error: null }]);
    select.mockReturnValue(builder);
    const [item] = await listStuckDriveRenditions(9);
    expect(builder.limit).toHaveBeenCalledWith(9);
    expect(dialect.sqlToQuery(builder.where.mock.calls[0][0])).toEqual(dialect.sqlToQuery(stuckDriveRenditionCondition(now)!));
    expect(item).toMatchObject({ source: 'drive-rendition', refId: '13', ageSec: 1200, drillDown: null });
    expect(jobStuckItemSchema.safeParse(item).success).toBe(true);
  });
});
