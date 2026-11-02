import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';
import { jobStuckItemSchema } from '@zenith/shared/platform';
const { select } = vi.hoisted(() => ({ select: vi.fn() }));
vi.mock('../../db', () => ({ db: { select } }));
import { getPaymentEventHealth, listStuckPaymentEvents, stuckPaymentEventCondition } from './payment-events.service';

const dialect = new PgDialect({ casing: 'snake_case' });
const now = new Date('2026-10-03T08:00:00Z');
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function chain(rows: unknown[]): any {
  const result: Record<string, unknown> = {};
  for (const method of ['from', 'innerJoin', 'where', 'orderBy', 'limit']) result[method] = vi.fn(() => result);
  result.then = (resolve: (value: unknown) => unknown) => Promise.resolve(rows).then(resolve);
  return result;
}

describe('payment durable consumer health', () => {
  beforeEach(() => { vi.clearAllMocks(); vi.useFakeTimers(); vi.setSystemTime(now); });
  afterEach(() => vi.useRealTimers());

  it('counts shared delivery states and uses the five minute backlog boundary', async () => {
    select.mockReturnValue(chain([{ pending: 3, running: 1, stuck: 2, dead: 4, failed24h: 1, succeeded24h: 7, failed1h: 1, oldestPendingAgeSec: 900 }]));
    const result = await getPaymentEventHealth();
    expect(result.counts).toEqual({ pending: 3, running: 1, stuck: 2, dead: 4, failed24h: 1, succeeded24h: 7 });
    const query = dialect.sqlToQuery(stuckPaymentEventCondition(now)!);
    expect(query.params).toContain(new Date(now.getTime() - 300_000).toISOString());
    expect(query.sql).toContain('"domain" =');
    expect(query.sql).toContain('"status" in');
  });

  it.each([undefined, null, 23])('preserves global, platform and tenant scopes: %s', async tenantId => {
    const builder = chain([]); select.mockReturnValue(builder);
    await getPaymentEventHealth(tenantId);
    const where = dialect.sqlToQuery(builder.where.mock.calls[0][0]);
    expect(where.sql).toContain('"domain" =');
    if (tenantId === undefined) expect(where.sql).not.toContain('"tenant_id"');
    else if (tenantId === null) expect(where.sql).toContain('"tenant_id" is null');
    else { expect(where.sql).toContain('"tenant_id" ='); expect(where.params).toContain(23); }
  });

  it('lists overdue or dead consumers without exposing payment payloads', async () => {
    const builder = chain([{ id: 8, type: 'payment.succeeded', orderNo: 'P123', consumerKey: 'payment.local-settlement',
      createdAt: new Date(now.getTime() - 600_000), runAt: new Date(now.getTime() - 600_000), lastError: '投递等待重试', status: 'retrying' }]);
    select.mockReturnValue(builder);
    const [item] = await listStuckPaymentEvents(11);
    expect(builder.limit).toHaveBeenCalledWith(11);
    expect(item).toMatchObject({ source: 'payment-event-outbox', refId: '8', ageSec: 600, status: 'retrying' });
    expect(item.title).toContain('payment.local-settlement');
    expect(jobStuckItemSchema.safeParse(item).success).toBe(true);
    expect(select.mock.calls[0][0]).not.toHaveProperty('payload');
  });
});
