import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';
import { jobStuckItemSchema } from '@zenith/shared/platform';
const mocks = vi.hoisted(() => ({ select: vi.fn(), site: vi.fn(), channels: vi.fn() }));
vi.mock('../../db', () => ({ db: { select: mocks.select } }));
vi.mock('./cms-sites.service', () => ({ ensureCmsSiteExists: vi.fn(), assertSiteAccess: mocks.site }));
vi.mock('./cms-channels.service', () => ({ assertAllCmsSiteChannelsAccess: mocks.channels }));
import { getCmsTelemetryOutboxHealth, listStuckCmsTelemetryOutbox, stuckCmsTelemetryOutboxCondition } from './cms-telemetry-deliveries.service';

const dialect = new PgDialect({ casing: 'snake_case' });
const now = new Date('2026-10-03T08:00:00Z');
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function chain(rows: unknown[]): any {
  const result: Record<string, unknown> = {};
  for (const method of ['from', 'where', 'orderBy', 'limit']) result[method] = vi.fn(() => result);
  result.then = (resolve: (value: unknown) => unknown) => Promise.resolve(rows).then(resolve);
  return result;
}
describe('CMS telemetry platform outbox health', () => {
  beforeEach(() => { vi.clearAllMocks(); vi.useFakeTimers(); vi.setSystemTime(now); });
  afterEach(() => vi.useRealTimers());
  it('leaves one minute after lease expiry and excludes delivered or dead records', () => {
    const compiled = dialect.sqlToQuery(stuckCmsTelemetryOutboxCondition(now)!);
    expect(compiled.sql).toContain('"delivered_at" is null');
    expect(compiled.sql).toContain('"dead_letter_at" is null');
    expect(compiled.sql).toContain('"lease_expires_at" <');
    expect(compiled.params).toContain(new Date(now.getTime() - 60_000).toISOString());
  });
  it('aggregates all sites without request access checks and counts actual outcome timestamps', async () => {
    const builder = chain([{ pending: 2, running: 3, stuck: 1, dead: 4, failed24h: 2, succeeded24h: 15, failed1h: 1, oldestPendingAgeSec: 400 }]);
    mocks.select.mockReturnValue(builder);
    const result = await getCmsTelemetryOutboxHealth();
    expect(result.counts).toEqual({ pending: 2, running: 3, stuck: 1, dead: 4, failed24h: 2, succeeded24h: 15 });
    expect(mocks.site).not.toHaveBeenCalled();
    expect(mocks.channels).not.toHaveBeenCalled();
    expect(dialect.sqlToQuery(builder.where.mock.calls[0][0]).sql).not.toContain('"site_id"');
    const fields = mocks.select.mock.calls[0][0];
    expect(dialect.sqlToQuery(fields.failed24h).sql).toContain('"dead_letter_at" >=');
    expect(dialect.sqlToQuery(fields.succeeded24h).sql).toContain('"delivered_at" >=');
    expect(dialect.sqlToQuery(fields.pending).sql).toContain('"next_attempt_at" <=');
  });
  it('lists expired claims with no visitor payload or signed context', async () => {
    const builder = chain([{ id: 9, siteId: 15, lastAttemptAt: new Date(now.getTime() - 180_000), leaseExpiresAt: new Date(now.getTime() - 90_000), lastError: null }]);
    mocks.select.mockReturnValue(builder);
    const [item] = await listStuckCmsTelemetryOutbox(8);
    expect(builder.limit).toHaveBeenCalledWith(8);
    expect(dialect.sqlToQuery(builder.where.mock.calls[0][0])).toEqual(dialect.sqlToQuery(stuckCmsTelemetryOutboxCondition(now)!));
    expect(item).toMatchObject({ source: 'cms-telemetry-outbox', refId: '9', ageSec: 180, drillDown: null });
    expect(jobStuckItemSchema.safeParse(item).success).toBe(true);
    expect(mocks.select.mock.calls[0][0]).not.toHaveProperty('payload');
  });
});
