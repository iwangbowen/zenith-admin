import { sql } from 'drizzle-orm';
import { cmsDeployments } from '../../db/schema';
import { withoutDbExecutor } from '../../db';
import type { TaskRunContext } from '../../lib/task-center/types';
import type { FullBuildProgress } from './cms-static.service';

/** Append a static-build checkpoint as a JSONB value to the candidate deployment plan. */
export function appendCmsDeploymentBuildCheckpoint(checkpoint: FullBuildProgress['checkpoint']) {
  return sql`${cmsDeployments.buildPlan} || jsonb_build_object('lastCheckpoint', ${JSON.stringify(checkpoint)}::jsonb)`;
}

/**
 * The static-build callback runs inside the candidate projection transaction. Report through
 * async_tasks only: updating cms_deployments from another connection would block on the row
 * lock held by this transaction, while this transaction waits for the callback to return.
 */
export function cmsStaticBuildResumeAfterKey(checkpoint: TaskRunContext['checkpoint']): string | null {
  return typeof checkpoint?.lastKey === 'string' ? checkpoint.lastKey : null;
}

export function reportCmsStaticBuildProgress(
  ctx: Pick<TaskRunContext, 'progress'>,
  progress: FullBuildProgress,
) {
  return withoutDbExecutor(() => ctx.progress({
    processed: progress.processed,
    total: progress.total,
    note: progress.note,
    checkpoint: { ...progress.checkpoint },
  }));
}
