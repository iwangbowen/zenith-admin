import { db } from '../../db';
import { asyncTasks, type AsyncTaskRow } from '../../db/schema';
import type { DbTransaction } from '../../db/types';
import type { PgUpdateSetSource } from 'drizzle-orm/pg-core';
import type { SQL } from 'drizzle-orm';
import { getTaskHandler } from './registry';
import { flushTransactionEffects } from '../transaction-effects';

export async function commitTaskStateTransaction<T>(fn: (tx: DbTransaction) => Promise<T>): Promise<T> {
  let committed: DbTransaction | undefined;
  const value = await db.transaction(async tx => { const result = await fn(tx); committed = tx; return result; });
  await flushTransactionEffects(committed!);
  return value;
}

/** Task state and domain continuation share the task row lock and commit. */
export async function settleTaskState(tx: DbTransaction, rows: readonly AsyncTaskRow[]): Promise<void> {
  for (const row of rows) await getTaskHandler(row.taskType)?.settleInTransaction?.(tx, row);
}
export async function transitionAsyncTasks(values: PgUpdateSetSource<typeof asyncTasks>, where: SQL | undefined): Promise<AsyncTaskRow[]> {
  if (!where) throw new Error('Task state transition requires a condition');
  return commitTaskStateTransaction(async tx => {
    const rows = await tx.update(asyncTasks).set(values).where(where).returning();
    await settleTaskState(tx, rows);
    return rows;
  });
}
