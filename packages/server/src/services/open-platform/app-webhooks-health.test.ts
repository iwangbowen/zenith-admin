import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';

const { select } = vi.hoisted(() => ({ select: vi.fn() }));
vi.mock('../../db', () => ({ db: { select } }));
vi.mock('../messaging/notification-outbox.service', () => ({ notify: vi.fn() }));
import { getWebhookDeliveryHealth, stuckWebhookDeliveryCondition } from './app-webhooks.service';

const dialect = new PgDialect({ casing: 'snake_case' });
const now = new Date('2026-10-03T08:00:00Z');
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function chain(rows: unknown[]): any {
  const result: Record<string, unknown> = {};
  for (const method of ['from', 'where']) result[method] = vi.fn(() => result);
  result.then = (resolve: (value: unknown) => unknown) => Promise.resolve(rows).then(resolve);
  return result;
}

describe('webhook delivery job health', () => {
  beforeEach(() => { vi.clearAllMocks(); vi.useFakeTimers(); vi.setSystemTime(now); });
  afterEach(() => vi.useRealTimers());

  it('detects both overdue retries and unrecovered pending attempts while leaving recovery grace', () => {
    const query = dialect.sqlToQuery(stuckWebhookDeliveryCondition(now)!);
    expect(query.params).toContain('retrying');
    expect(query.params).toContain('pending');
    expect(query.sql).toContain('"next_retry_at" <');
    expect(query.sql).toContain('"started_at" is null');
    expect(query.sql).toContain('"created_at" <');
    expect(query.params).toContainEqual(new Date(now.getTime() - 10 * 60_000).toISOString());
    expect(query.params).toContainEqual(new Date(now.getTime() - 12 * 60_000).toISOString());
  });

  it('excludes future retry slots from backlog and measures outcomes by finishedAt', async () => {
    select.mockReturnValue(chain([{ pending: 8, running: 3, stuck: 2, dead: 5, failed24h: 4, succeeded24h: 26, failed1h: 1, oldestPendingAgeSec: 800 }]));
    const result = await getWebhookDeliveryHealth();
    expect(result).toMatchObject({ counts: { pending: 8, running: 3, stuck: 2, dead: 5, failed24h: 4, succeeded24h: 26 }, failed1h: 1, oldestPendingAgeSec: 800 });
    const fields = select.mock.calls[0][0];
    expect(dialect.sqlToQuery(fields.pending).sql).toContain('"next_retry_at" <=');
    expect(dialect.sqlToQuery(fields.running).sql).toContain('"started_at" >');
    for (const key of ['failed24h', 'succeeded24h', 'failed1h']) {
      const compiled = dialect.sqlToQuery(fields[key]);
      expect(compiled.sql).toContain('"finished_at" >=');
      expect(compiled.sql).not.toContain('"created_at"');
    }
  });

  it('returns an empty health summary when no records exist', async () => {
    select.mockReturnValue(chain([]));
    expect(await getWebhookDeliveryHealth()).toEqual({ counts: { pending: 0, running: 0, stuck: 0, dead: 0, failed24h: 0, succeeded24h: 0 }, oldestPendingAgeSec: null, failed1h: 0, issues: [] });
  });
});
