import { and, eq } from 'drizzle-orm';
import { workflowJobExecutions } from '../../db/schema';
import { currentWorkflowJobContext, workflowTransaction } from './lease';
import { WorkflowJobError, WorkflowJobLeaseLostError } from './errors';
import type { WorkflowJobResult } from './types';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

export function isIndeterminateExternalStatus(status: number | null | undefined): boolean {
  return status == null || status === 408 || status === 429 || status >= 500;
}

/** Persist uncertainty before external I/O; recovery must not blindly replay it. */
export async function markWorkflowExternalEffect(method: string, target: string): Promise<void> {
  const context = currentWorkflowJobContext();
  if (!context || SAFE_METHODS.has(method.toUpperCase())) return;
  await workflowTransaction(async (tx) => {
    const [row] = await tx.update(workflowJobExecutions)
      .set({ requestMethod: method.toUpperCase(), requestUrl: target })
      .where(and(
        eq(workflowJobExecutions.id, context.executionId),
        eq(workflowJobExecutions.jobId, context.job.id),
        eq(workflowJobExecutions.generation, context.generation),
        eq(workflowJobExecutions.status, 'running'),
      )).returning({ id: workflowJobExecutions.id });
    if (!row) throw new WorkflowJobLeaseLostError();
  });
}

/** Stop retry/fallback while an unsafe external write may already have taken effect. */
export async function throwIfWorkflowExternalEffectUncertain(
  message: string,
  detail: WorkflowJobResult,
): Promise<void> {
  const context = currentWorkflowJobContext();
  if (!context || !isIndeterminateExternalStatus(detail.responseStatus)) return;
  const marked = await workflowTransaction(async (tx) => {
    const [row] = await tx.select({ requestMethod: workflowJobExecutions.requestMethod })
      .from(workflowJobExecutions)
      .where(and(
        eq(workflowJobExecutions.id, context.executionId),
        eq(workflowJobExecutions.jobId, context.job.id),
        eq(workflowJobExecutions.generation, context.generation),
        eq(workflowJobExecutions.status, 'running'),
      )).limit(1);
    return row?.requestMethod && !SAFE_METHODS.has(row.requestMethod.toUpperCase());
  });
  if (marked) throw new WorkflowJobError(message, { detail, permanent: true });
}
