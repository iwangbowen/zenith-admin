import { and, eq, gt, sql } from 'drizzle-orm';
import { db } from '../../db';
import { workflowInstances, workflowJobs } from '../../db/schema';
import type { DbTransaction } from '../../db/types';
import { WorkflowJobLeaseLostError } from './errors';
import type { WorkflowJobContext } from './types';
import { currentWorkflowJobContext } from './execution-context';
import { flushWorkflowJobPickups } from './publication';
export { currentWorkflowJobContext, runWithWorkflowJobContext } from './execution-context';

export function ownedJobCondition(context: WorkflowJobContext, requireLive = true) {
  return and(
    eq(workflowJobs.id, context.job.id),
    eq(workflowJobs.status, 'running'),
    eq(workflowJobs.generation, context.generation),
    eq(workflowJobs.leaseToken, context.leaseToken),
    requireLive ? gt(workflowJobs.leaseUntil, sql`clock_timestamp()`) : undefined,
    requireLive ? gt(workflowJobs.executionDeadline, sql`clock_timestamp()`) : undefined,
  );
}

/** Business transactions share the instance -> job lock order with cancellation. */
export async function assertWorkflowJobOwnership(tx: DbTransaction, context = currentWorkflowJobContext()): Promise<void> {
  if (!context) return;
  context.signal.throwIfAborted();
  if (context.job.instanceId != null) {
    await tx.select({ id: workflowInstances.id }).from(workflowInstances)
      .where(eq(workflowInstances.id, context.job.instanceId)).for('update');
  }
  const [owned] = await tx.select({ id: workflowJobs.id }).from(workflowJobs)
    .where(ownedJobCondition(context)).for('update');
  if (!owned) throw new WorkflowJobLeaseLostError();
  context.signal.throwIfAborted();
}

export async function withWorkflowJobTransaction<T>(
  context: WorkflowJobContext,
  fn: (tx: DbTransaction) => Promise<T>,
): Promise<T> {
  return commitWorkflowTransaction(async (tx) => {
    await assertWorkflowJobOwnership(tx, context);
    const result = await fn(tx);
    await assertWorkflowJobOwnership(tx, context);
    return result;
  });
}

async function commitWorkflowTransaction<T>(fn: (tx: DbTransaction) => Promise<T>): Promise<T> {
  let committedExecutor: DbTransaction | undefined;
  const result = await db.transaction((tx) => { committedExecutor = tx; return fn(tx); });
  await flushWorkflowJobPickups(committedExecutor!);
  return result;
}

export function workflowTransaction<T>(fn: (tx: DbTransaction) => Promise<T>): Promise<T> {
  const context = currentWorkflowJobContext();
  return context ? withWorkflowJobTransaction(context, fn) : commitWorkflowTransaction(fn);
}
