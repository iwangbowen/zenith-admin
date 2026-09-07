import { sql } from 'drizzle-orm';
import { db } from '../../db';
import type { DbExecutor } from '../../db/types';
import { registerSystemRecurringJob } from '../../lib/pg-boss-scheduler';

const TABLES = ['drive_activities', 'drive_share_access_logs'] as const;
const ready = new Set<string>();

export function driveLogMonth(date: Date) {
  if (!Number.isFinite(date.getTime())) throw new Error('Invalid drive log date');
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth();
  const literal = (value: Date) => `${value.getUTCFullYear()}-${String(value.getUTCMonth() + 1).padStart(2, '0')}-01 00:00:00`;
  return {
    suffix: `${year}${String(month + 1).padStart(2, '0')}`,
    from: literal(new Date(Date.UTC(year, month, 1))),
    to: literal(new Date(Date.UTC(year, month + 1, 1))),
  };
}

export async function ensureDriveLogPartitions(date = new Date(), executor: DbExecutor = db): Promise<void> {
  const month = driveLogMonth(date);
  if (ready.has(month.suffix)) return;
  const create = async (tx: DbExecutor) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('drive-log-partitions'))`);
    for (const table of TABLES) {
      await tx.execute(sql.raw(
        `CREATE TABLE IF NOT EXISTS "${table}_p${month.suffix}" PARTITION OF "${table}" `
        + `FOR VALUES FROM ('${month.from}') TO ('${month.to}')`,
      ));
    }
  };
  if (executor === db) {
    await db.transaction(create);
    ready.add(month.suffix);
  } else {
    // An outer transaction may roll back its DDL; only cache our own committed work.
    await create(executor);
  }
}

export async function registerDrivePartitionJob(): Promise<void> {
  const prepare = async () => {
    const now = new Date();
    for (let offset = -1; offset <= 2; offset++) {
      await ensureDriveLogPartitions(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + offset, 1)));
    }
    return '网盘日志月分区已就绪';
  };
  await prepare();
  await registerSystemRecurringJob({
    name: 'drive-log-partitions',
    title: '网盘日志分区维护',
    module: '企业网盘',
    cronExpression: '5 * * * *',
    allowManualRun: true,
    run: prepare,
  });
}

async function expiredPartitionNames(table: typeof TABLES[number], days: number): Promise<string[]> {
  if (days <= 0) return [];
  const cutoff = new Date(Date.now() - days * 86_400_000);
  const rows = await db.execute(sql`
    SELECT child.relname AS name FROM pg_inherits i
    JOIN pg_class child ON child.oid = i.inhrelid
    WHERE i.inhparent = ${table}::regclass
  `);
  const names: string[] = [];
  for (const row of rows) {
    if (typeof row.name !== 'string') throw new Error('Invalid partition metadata');
    const suffix = row.name.slice(`${table}_p`.length);
    if (row.name !== `${table}_p${suffix}` || !/^\d{6}$/.test(suffix)) continue;
    const month = Number(suffix.slice(4));
    if (month < 1 || month > 12) continue;
    const upper = new Date(Date.UTC(Number(suffix.slice(0, 4)), month, 1));
    if (upper <= cutoff) names.push(row.name);
  }
  return names.sort();
}

export async function cleanDriveLogPartitions(table: typeof TABLES[number], days: number, preview = false): Promise<number> {
  let count = 0;
  for (const name of await expiredPartitionNames(table, days)) {
    count += await db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('drive-log-partitions'))`);
      const exists = await tx.execute(sql`SELECT to_regclass(${name}) AS relation`);
      if (!exists[0]?.relation) return 0;
      const rows = await tx.execute(sql.raw(`SELECT count(*)::bigint AS count FROM "${name}"`));
      if (!preview) await tx.execute(sql.raw(`DROP TABLE "${name}"`));
      return Number(rows[0].count);
    });
    if (!preview) ready.delete(name.slice(`${table}_p`.length));
  }
  return count;
}
