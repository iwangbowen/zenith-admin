import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';
import { jobStuckItemSchema } from '@zenith/shared/platform';
const { select } = vi.hoisted(() => ({ select: vi.fn() }));
vi.mock('../../db', () => ({ db: { select } }));
vi.mock('./entity-watch-access', () => ({ authorizeWatchedEvent: vi.fn(), getCurrentWatch: vi.fn() }));
vi.mock('../messaging/notification-outbox.service', () => ({ notifyWithin: vi.fn() }));
import { getEntityWatchDeliveryHealth, listStuckEntityWatchEvents, stuckEntityWatchEventCondition } from './entity-watch-worker';

const dialect = new PgDialect({ casing: 'snake_case' });
const now = new Date('2026-10-03T08:00:00Z');
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function chain(rows: unknown[]): any {
  const result: Record<string, unknown> = {};
  for (const method of ['from', 'where', 'leftJoin', 'orderBy', 'limit']) result[method] = vi.fn(() => result);
  result.then = (resolve: (value: unknown) => unknown) => Promise.resolve(rows).then(resolve);
  return result;
}
describe('entity watch delivery health', () => {
  beforeEach(() => { vi.clearAllMocks(); vi.useFakeTimers(); vi.setSystemTime(now); });
  afterEach(() => vi.useRealTimers());
  it('reports an expired claim only after two lease windows', () => {
    const compiled = dialect.sqlToQuery(stuckEntityWatchEventCondition(now));
    expect(compiled.sql).toContain('"claimed_at" <');
    expect(compiled.params).toContain(new Date(now.getTime() - 240_000).toISOString());
  });
  it('reports repeated failures while leaving unavailable completion history at zero', async () => {
    select.mockReturnValue(chain([{ pending: 3, running: 2, stuck: 1, repeatedFailures: 4, oldestPendingAgeSec: 300 }]));
    const health = await getEntityWatchDeliveryHealth();
    expect(health.counts).toEqual({ pending: 3, running: 2, stuck: 1, dead: null, failed24h: 0, succeeded24h: 0 });
    expect(health.issues).toEqual([{ level: 'warn', message: expect.stringContaining('4 个') }]);
    const pending = dialect.sqlToQuery(select.mock.calls[0][0].pending);
    expect(pending.sql).toContain('"next_attempt_at" <=');
    expect(pending.sql).toContain('"claimed_at" is null');
  });
  it('uses the same lease rule for safe stuck details without event payloads', async () => {
    const builder = chain([{ eventId: 7, eventType: 'payment.order_paid', claimedAt: new Date(now.getTime() - 600_000), attempts: 6, lastError: null }]);
    select.mockReturnValue(builder);
    const [item] = await listStuckEntityWatchEvents(12);
    expect(builder.limit).toHaveBeenCalledWith(12);
    expect(dialect.sqlToQuery(builder.where.mock.calls[0][0])).toEqual(dialect.sqlToQuery(stuckEntityWatchEventCondition(now)));
    expect(item).toMatchObject({ source: 'entity-watch-delivery', refId: '7', ageSec: 600, drillDown: null });
    expect(jobStuckItemSchema.safeParse(item).success).toBe(true);
    expect(select.mock.calls[0][0]).not.toHaveProperty('payload');
  });
});
