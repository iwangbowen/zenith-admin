import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';
import { jobStuckItemSchema } from '@zenith/shared/platform';

const { select } = vi.hoisted(() => ({ select: vi.fn() }));
vi.mock('../../db', () => ({ db: { select } }));
vi.mock('../../lib/notification/dispatch', () => ({ deliverOutboxRow: vi.fn() }));
import { getNotificationOutboxHealth, listStuckOutbox, stuckNotificationOutboxCondition } from './notification-outbox.service';

const dialect = new PgDialect({ casing: 'snake_case' });
const now = new Date('2026-10-03T08:00:00Z');
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function chain(rows: unknown[]): any {
  const result: Record<string, unknown> = {};
  for (const method of ['from', 'where', 'orderBy', 'limit']) result[method] = vi.fn(() => result);
  result.then = (resolve: (value: unknown) => unknown) => Promise.resolve(rows).then(resolve);
  return result;
}

describe('notification outbox job health', () => {
  beforeEach(() => { vi.clearAllMocks(); vi.useFakeTimers(); vi.setSystemTime(now); });
  afterEach(() => vi.useRealTimers());

  it('allows two normal claim recovery windows before reporting a stuck event', () => {
    const query = dialect.sqlToQuery(stuckNotificationOutboxCondition(now)!);
    expect(query.sql).toContain('"claimed_at" <');
    expect(query.params).toContain('pending');
    expect(query.params).toContainEqual(new Date(now.getTime() - 10 * 60_000).toISOString());
  });

  it('counts due rows without excluding digests and uses real terminal times for recent outcomes', async () => {
    select.mockReturnValue(chain([{ pending: 3, running: 2, stuck: 1, dead: 7, failed24h: 4, succeeded24h: 12, failed1h: 2, oldestPendingAgeSec: 620 }]));
    const summary = await getNotificationOutboxHealth();
    expect(summary).toMatchObject({ counts: { pending: 3, running: 2, stuck: 1, dead: 7, failed24h: 4, succeeded24h: 12 }, failed1h: 2, oldestPendingAgeSec: 620 });
    const fields = select.mock.calls[0][0];
    const due = dialect.sqlToQuery(fields.pending);
    expect(due.sql).toContain('"scheduled_at" <=');
    expect(due.sql).toContain('"claimed_at" is null');
    expect(due.sql).not.toContain('"digest_key"');
    for (const key of ['failed24h', 'succeeded24h', 'failed1h']) {
      const compiled = dialect.sqlToQuery(fields[key]);
      expect(compiled.sql).toContain('"finished_at" >=');
      expect(compiled.sql).not.toContain('"created_at"');
    }
  });

  it('returns zeros and a null pending age for an empty outbox', async () => {
    select.mockReturnValue(chain([]));
    expect(await getNotificationOutboxHealth()).toEqual({ counts: { pending: 0, running: 0, stuck: 0, dead: 0, failed24h: 0, succeeded24h: 0 }, oldestPendingAgeSec: null, failed1h: 0, issues: [] });
  });

  it('lists only safe outbox metadata using the same stuck predicate and caller limit', async () => {
    const builder = chain([{ id: 42, eventKey: 'workflow.instance.approved', status: 'pending', claimedAt: new Date(now.getTime() - 900_000), attempts: 3, lastError: '补投暂不可用' }]);
    select.mockReturnValue(builder);
    const [item] = await listStuckOutbox(7);
    expect(dialect.sqlToQuery(builder.where.mock.calls[0][0])).toEqual(dialect.sqlToQuery(stuckNotificationOutboxCondition(now)!));
    expect(builder.limit).toHaveBeenCalledWith(7);
    expect(item).toMatchObject({ source: 'notification-outbox', refId: '42', ageSec: 900, detail: '补投暂不可用', nodeId: null, drillDown: null });
    expect(jobStuckItemSchema.safeParse(item).success).toBe(true);
    for (const field of ['recipients', 'vars', 'channelOptions']) expect(select.mock.calls[0][0]).not.toHaveProperty(field);
  });
});
