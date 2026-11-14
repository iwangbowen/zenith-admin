import { AsyncLocalStorage } from 'node:async_hooks';
import { and, eq, gt, sql } from 'drizzle-orm';
import { db } from '../../db';
import { asyncTasks } from '../../db/schema';
import type { DbTransaction } from '../../db/types';
import { flushTransactionEffects } from '../transaction-effects';
import { HEARTBEAT_STALE_MS } from './types';

export interface TaskExecution {
  taskId: number;
  dispatchToken: string;
  deadline: Date;
}
export class TaskExecutionLostError extends Error {
  constructor() { super('任务执行权已失效、已取消或超过执行期限'); }
}
const executions = new AsyncLocalStorage<TaskExecution>();
export function runWithTaskExecution<T>(execution: TaskExecution, fn: () => Promise<T>): Promise<T> {
  return executions.run(execution, fn);
}

/** Lock order: task -> workflow aggregate (when required) -> domain aggregate. */
export async function assertTaskExecution(tx: DbTransaction, execution: TaskExecution): Promise<void> {
  const [owned] = await tx.select({ id: asyncTasks.id }).from(asyncTasks).where(and(
    eq(asyncTasks.id, execution.taskId), eq(asyncTasks.status, 'running'),
    eq(asyncTasks.dispatchToken, execution.dispatchToken), eq(asyncTasks.cancelRequested, false),
    gt(asyncTasks.heartbeatAt, sql`clock_timestamp() - ${HEARTBEAT_STALE_MS} * interval '1 millisecond'`),
    sql`clock_timestamp() < ${execution.deadline.toISOString()}::timestamptz`,
  )).for('update').limit(1);
  if (!owned) throw new TaskExecutionLostError();
}

/** Every business commit is fenced, including short commits in a batched handler. */
export async function taskTransaction<T>(fn: (tx: DbTransaction) => Promise<T>): Promise<T> {
  const execution = executions.getStore();
  let committed: DbTransaction | undefined;
  const result = await db.transaction(async tx => {
    if (execution) await assertTaskExecution(tx, execution);
    const value = await fn(tx);
    if (execution) await assertTaskExecution(tx, execution);
    committed = tx;
    return value;
  });
  await flushTransactionEffects(committed!);
  return result;
}
