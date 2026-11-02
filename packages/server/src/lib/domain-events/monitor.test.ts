import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';
import { jobStuckItemSchema } from '@zenith/shared/platform';
const { select } = vi.hoisted(() => ({ select: vi.fn() }));
vi.mock('../../db', () => ({ db: { select } }));
import { getDomainEventConsumerHealth, listStuckDomainEventConsumers } from './monitor';

const now = new Date('2026-11-02T02:00:00Z');
const dialect = new PgDialect({ casing: 'snake_case' });
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function chain(rows: unknown[]): any {
  const result: Record<string, unknown> = {};
  for (const method of ['from', 'innerJoin', 'where', 'orderBy', 'limit']) result[method] = vi.fn(() => result);
  result.then = (resolve: (value: unknown) => unknown) => Promise.resolve(rows).then(resolve);
  return result;
}

describe('domain event consumer job monitor', () => {
  beforeEach(() => { vi.clearAllMocks(); vi.useFakeTimers(); vi.setSystemTime(now); });
  afterEach(() => vi.useRealTimers());

  it('reports active, stuck, dead and completed delivery counts', async () => {
    const builder = chain([{ pending: 2, running: 1, stuck: 1, dead: 3, failed24h: 2, succeeded24h: 20, failed1h: 1, oldestPendingAgeSec: 600 }]);
    select.mockReturnValue(builder);
    const result = await getDomainEventConsumerHealth();
    expect(result.counts).toEqual({ pending: 2, running: 1, stuck: 1, dead: 3, failed24h: 2, succeeded24h: 20 });
    expect(result.oldestPendingAgeSec).toBe(600);
    const where = dialect.sqlToQuery(builder.where.mock.calls[0][0]);
    expect(where.sql).toContain('"status" in');
  });

  it('lists the consumer key and event type without payload data', async () => {
    const builder = chain([{ id: 7, consumerKey: 'workflow.notification', status: 'dead', runAt: new Date(now.getTime() - 600_000),
      lastError: 'template failed', eventType: 'workflow.task.created', domain: 'workflow', occurredAt: new Date(now.getTime() - 700_000) }]);
    select.mockReturnValue(builder);
    const [item] = await listStuckDomainEventConsumers(10);
    expect(item).toMatchObject({ source: 'domain-event-consumer', refId: '7', status: 'dead', ageSec: 600 });
    expect(item.title).toContain('workflow.notification');
    expect(jobStuckItemSchema.safeParse(item).success).toBe(true);
    expect(select.mock.calls[0][0]).not.toHaveProperty('payload');
  });
});
