import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { drizzle } from 'drizzle-orm/postgres-js';
import { eq, sql } from 'drizzle-orm';
import { integer, jsonb, pgTable, text } from 'drizzle-orm/pg-core';
import { createPgClient } from './client';
import { idColumn, timestamptz } from './schema/common';
import { instrumentPostgresClient, withDbQueryObserver } from './query-metrics';

// The verification runner creates, migrates and drops this isolated database.
const connection = process.env.PG_DRIVER_TEST_DATABASE_URL;
const samples = pgTable('driver_upgrade_samples', {
  id: idColumn(), label: text().notNull(), at: timestamptz().notNull(), values: integer().array().notNull(),
  document: jsonb().$type<{ enabled: boolean; nested: { count: number } }>().notNull(),
});

describe.skipIf(!connection)('Postgres.js driver contract on an isolated PostgreSQL database', () => {
  const client = connection ? instrumentPostgresClient(createPgClient(connection, { max: 3, onnotice: () => undefined })) : null;
  const notifier = connection ? createPgClient(connection, { max: 1, onnotice: () => undefined }) : null;
  const database = client ? drizzle(client, { casing: 'snake_case' }) : null;
  const at = new Date('2026-11-13T07:30:45.123Z');

  beforeAll(async () => {
    const url = new URL(connection!);
    if (!['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) || !/^\/zenith_numbering_qa_\d+$/.test(url.pathname)) {
      throw new Error('Requires the isolated database created by verify-numbering.mts');
    }
    await client!`create table driver_upgrade_samples (
      id integer generated always as identity primary key, label text not null, at timestamptz not null,
      "values" integer[] not null, document jsonb not null
    )`;
  });
  afterAll(async () => { await client?.end(); await notifier?.end(); });

  it('keeps UTC and preserves dates, arrays and JSON through Drizzle reads and writes', async () => {
    const [zone] = await notifier!`show timezone`;
    expect(zone.TimeZone).toBe('UTC');
    const [created] = await database!.insert(samples).values({ label: 'typed roundtrip', at, values: [0, -3, 42], document: { enabled: false, nested: { count: 7 } } }).returning();
    const [read] = await database!.select().from(samples).where(eq(samples.id, created.id));
    expect(read.at.toISOString()).toBe(at.toISOString());
    expect(read.values).toEqual([0, -3, 42]);
    expect(read.document).toEqual({ enabled: false, nested: { count: 7 } });
    const [raw] = await notifier!`select ${at}::timestamptz as at, ${[1, 2]}::int[] as "values", ${true}::boolean as enabled`;
    expect(raw.at.toISOString()).toBe(at.toISOString());
    expect(raw.values).toEqual([1, 2]);
    expect(raw.enabled).toBe(true);
  });

  it('commits the outer transaction, rolls back a savepoint, and records query metrics', async () => {
    const elapsed: number[] = [];
    const row = { label: 'outer commit', at, values: [], document: { enabled: true, nested: { count: 1 } } };
    await withDbQueryObserver(ms => elapsed.push(ms), () => database!.transaction(async tx => {
      await tx.insert(samples).values(row);
      await expect(tx.transaction(async nested => {
        await nested.insert(samples).values({ ...row, label: 'inner rollback' });
        throw new Error('rollback nested transaction');
      })).rejects.toThrow('rollback nested transaction');
      await tx.execute(sql`select 1`);
    }));
    expect(await database!.select().from(samples).where(eq(samples.label, 'outer commit'))).toHaveLength(1);
    expect(await database!.select().from(samples).where(eq(samples.label, 'inner rollback'))).toHaveLength(0);
    expect(elapsed.length).toBeGreaterThanOrEqual(3);
  });

  it('rolls back all writes when the transaction callback fails', async () => {
    await expect(database!.transaction(async tx => {
      await tx.insert(samples).values({ label: 'outer rollback', at, values: [9], document: { enabled: true, nested: { count: 2 } } });
      throw new Error('rollback entire transaction');
    })).rejects.toThrow('rollback entire transaction');
    expect(await database!.select().from(samples).where(eq(samples.label, 'outer rollback'))).toHaveLength(0);
  });

  it('delivers LISTEN/NOTIFY and releases the listening connection', async () => {
    let resolveNotification!: (payload: string) => void;
    const notified = new Promise<string>(resolve => { resolveNotification = resolve; });
    const listener = await client!.listen('zenith_driver_upgrade', payload => resolveNotification(payload));
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await notifier!.notify('zenith_driver_upgrade', 'driver-4-notification');
      const timeout = new Promise<never>((_resolve, reject) => { timer = setTimeout(() => reject(new Error('LISTEN/NOTIFY timed out')), 5000); });
      await expect(Promise.race([notified, timeout])).resolves.toBe('driver-4-notification');
    } finally {
      clearTimeout(timer);
      await listener.unlisten();
    }
    const [row] = await client!`select 1::int as value`;
    expect(row.value).toBe(1);
  });
});
