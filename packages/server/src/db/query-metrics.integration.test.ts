import { createPgClient } from './client';
import { drizzle } from 'drizzle-orm/postgres-js';
import { sql } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';
import { instrumentPostgresClient, withDbQueryObserver } from './query-metrics';

const connection = process.env.TEST_DATABASE_URL;
const client = connection ? instrumentPostgresClient(createPgClient(connection, { max: 2, onnotice: () => undefined })) : null;
afterAll(async () => { await client?.end(); });
describe.skipIf(!connection)('postgres query execution metrics integration', () => {
  it('measures real driver latency through Drizzle raw queries, transactions and savepoints', async () => {
    const url = new URL(connection!);
    if (!['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) || url.pathname !== '/zenith_review') throw new Error('Requires local disposable zenith_review');
    const db = drizzle(client!); const elapsed: number[] = [];
    const rows = await withDbQueryObserver(ms => elapsed.push(ms), () => db.transaction(async tx => {
      const [row] = await tx.execute<{ value: number }>(sql`select 7::int as value, pg_sleep(0.02)`);
      await tx.transaction(async nested => { await nested.execute(sql`select 9`); });
      return row;
    }));
    expect(rows.value).toBe(7); expect(elapsed.length).toBeGreaterThanOrEqual(2); expect(elapsed.some(ms => ms >= 20)).toBe(true);
    const error = new Error('rollback identity');
    await expect(withDbQueryObserver(() => undefined, () => db.transaction(async () => { throw error; }))).rejects.toBe(error);
  });
});
