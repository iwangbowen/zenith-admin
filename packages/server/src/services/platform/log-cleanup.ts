import { sql, type SQL } from 'drizzle-orm';
import { db } from '../../db';
import type { DbExecutor } from '../../db/types';
import { apiAccessLogs, cronJobLogs, loginLogs, operationLogs, systemSchedulerRuns } from '../../db/schema';

type LogTable = typeof apiAccessLogs | typeof operationLogs | typeof loginLogs | typeof cronJobLogs | typeof systemSchedulerRuns;
const BATCH_SIZE = 5000;

/** Freeze the initial ID boundary: clear all matching logs without chasing concurrent new writes. */
export async function deleteLogRows(table: LogTable, where: SQL | undefined, executor: DbExecutor = db): Promise<number> {
  const [boundary] = await executor.select({ id: sql<number>`coalesce(max(${table.id}), 0)` }).from(table).where(where);
  if (!boundary?.id) return 0;
  let total = 0;
  for (;;) {
    const removed = await executor.execute<{ id: number }>(sql`
      delete from ${table} where ${table.id} in (
        select ${table.id} from ${table}
        where ${where ?? sql`true`} and ${table.id} <= ${boundary.id}
        order by ${table.id} limit ${BATCH_SIZE}
      ) returning ${table.id}
    `);
    total += removed.length;
    if (removed.length < BATCH_SIZE) return total;
  }
}
