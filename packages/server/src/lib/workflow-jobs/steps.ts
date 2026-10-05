import { and, eq } from 'drizzle-orm';
import { workflowJobEffects } from '../../db/schema';
import { db } from '../../db';
import type { DbTransaction } from '../../db/types';
import { currentWorkflowJobContext, withWorkflowJobTransaction, workflowTransaction } from './lease';

/** Read a previously committed operation before repeating mutable launch preconditions. */
export async function readWorkflowJobStepResult<T extends Record<string, unknown>>(effectKey: string): Promise<T | undefined> {
  const context = currentWorkflowJobContext();
  if (!context) return undefined;
  const [receipt] = await db.select({ result: workflowJobEffects.result }).from(workflowJobEffects)
    .where(and(eq(workflowJobEffects.operationKey, context.operationKey), eq(workflowJobEffects.effectKey, effectKey))).limit(1);
  return receipt?.result as T | undefined;
}

/** Replay a committed internal step result when the same operation is retried. */
export function runWorkflowJobStep<T extends Record<string, unknown>>(
  effectKey: string,
  fn: (tx: DbTransaction) => Promise<T>,
): Promise<T> {
  const context = currentWorkflowJobContext();
  if (!context) return workflowTransaction(fn);
  return withWorkflowJobTransaction(context, async (tx) => {
    const [receipt] = await tx.select({ result: workflowJobEffects.result }).from(workflowJobEffects)
      .where(and(
        eq(workflowJobEffects.operationKey, context.operationKey),
        eq(workflowJobEffects.effectKey, effectKey),
      )).limit(1);
    if (receipt) return receipt.result as T;
    const result = await fn(tx);
    await tx.insert(workflowJobEffects).values({
      jobId: context.job.id,
      operationKey: context.operationKey,
      effectKey,
      result,
    });
    return result;
  });
}
