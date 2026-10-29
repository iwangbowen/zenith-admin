import { randomUUID } from 'node:crypto';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const connection = process.env.TEST_DATABASE_URL;
describe.skipIf(!connection)('durable events real PostgreSQL transactions', () => {
  let database: typeof import('../../db');
  let tables: typeof import('../../db/schema/event-outbox');
  let publish: typeof import('./publish').publishEventInTx;
  let claim: typeof import('./engine').claimEventConsumers;
  let execute: typeof import('./engine').executeEventConsumer;
  let retry: typeof import('./engine').retryEventConsumer;
  const prefix = randomUUID(); const ids: number[] = []; let failures = 1;
  beforeAll(async () => {
    const url = new URL(connection!);
    if (!['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) || url.pathname !== '/zenith_review') throw new Error('Requires local zenith_review');
    vi.stubEnv('DATABASE_URL', connection!);
    database = await import('../../db'); tables = await import('../../db/schema/event-outbox');
    ({ publishEventInTx: publish } = await import('./publish'));
    ({ claimEventConsumers: claim, executeEventConsumer: execute, retryEventConsumer: retry } = await import('./engine'));
    const { registerEventConsumer } = await import('./registry');
    registerEventConsumer({ key: `integration:${prefix}`, matches: (event) => event.domain === prefix,
      handle: async (tx, event) => {
        await tx.execute(sql`insert into outbox_test_effects (key) values (${event.eventId})`);
        if (event.payload.fail && failures-- > 0) throw new Error('injected failure after effect');
        if (event.payload.expire) await tx.update(tables.eventConsumerDeliveries).set({ leaseUntil: sql`clock_timestamp() - interval '1 second'` }).where(eq(tables.eventConsumerDeliveries.eventId, event.id));
        return { outcome: 'completed' };
      },
    });
    await database.db.execute(sql`create table if not exists outbox_test_effects (key uuid primary key)`);
  }, 120_000);
  afterAll(async () => {
    if (database) {
      if (ids.length) {
        await database.db.execute(sql`delete from outbox_test_effects where key in (select event_id from event_outbox where domain = ${prefix})`);
        await database.db.delete(tables.eventOutbox).where(inArray(tables.eventOutbox.id, ids));
      }
      await database.closeDb();
    }
    vi.unstubAllEnvs();
  });
  const input = (key: string, payload = {}) => ({ domain: prefix, eventType: `${prefix}.created`, tenantId: null,
    businessKey: key, orderingKey: `${prefix}:${key}`, subjectRefs: [{ type: 'workflow.instance', key, role: 'primary' as const }], payload });
  it('rolls back event and receipts with the source business write', async () => {
    await expect(database.db.transaction(async (tx) => { await publish(tx, input('rollback')); throw new Error('rollback'); })).rejects.toThrow('rollback');
    expect(await database.db.$count(tables.eventOutbox, and(eq(tables.eventOutbox.domain, prefix), eq(tables.eventOutbox.businessKey, 'rollback')))).toBe(0);
  });
  it('reuses stable identity and rejects a conflicting semantic fact', async () => {
    const first = await database.db.transaction((tx) => publish(tx, input('same'))); ids.push(first.id);
    const again = await database.db.transaction((tx) => publish(tx, input('same')));
    expect(again.eventId).toBe(first.eventId);
    await expect(database.db.transaction((tx) => publish(tx, input('same', { changed: true })))).rejects.toThrow('conflicts');
  });
  it('rolls back an effect on failure and applies it once after retry', async () => {
    const event = await database.db.transaction((tx) => publish(tx, input('retry', { fail: true }))); ids.push(event.id);
    const delivery = (await claim(32)).find((row) => row.eventId === event.id)!;
    expect(delivery).toBeDefined(); await execute(delivery);
    expect((await database.db.execute<{ n: number }>(sql`select count(*)::int n from outbox_test_effects where key = ${event.eventId}`))[0].n).toBe(0);
    await retry(delivery.id); const next = (await claim(32)).find((row) => row.id === delivery.id)!; await execute(next); await execute(next);
    expect((await database.db.execute<{ n: number }>(sql`select count(*)::int n from outbox_test_effects where key = ${event.eventId}`))[0].n).toBe(1);
    expect(await database.db.$count(tables.eventConsumerAttempts, eq(tables.eventConsumerAttempts.deliveryId, delivery.id))).toBe(2);
  });
  it('rolls back local effects when the lease expires before receipt confirmation', async () => {
    const event = await database.db.transaction((tx) => publish(tx, input('lost', { expire: true }))); ids.push(event.id);
    const delivery = (await claim(32)).find((row) => row.eventId === event.id)!; await execute(delivery);
    expect((await database.db.execute<{ n: number }>(sql`select count(*)::int n from outbox_test_effects where key = ${event.eventId}`))[0].n).toBe(0);
  });
});
