import type { DbExecutor } from '../../db/types';
import { sendSystemJobAfter } from '../pg-boss-scheduler';
import logger from '../logger';
import { WORKFLOW_JOB_QUEUE } from './types';

const pendingPickups = new WeakMap<DbExecutor, Map<number, Date>>();
const options = { retryLimit: 0, expireInSeconds: 7200, retentionSeconds: 86400 };

export function rememberWorkflowJobPickup(executor: DbExecutor, id: number, runAt: Date): void {
  let jobs = pendingPickups.get(executor);
  if (!jobs) { jobs = new Map(); pendingPickups.set(executor, jobs); }
  jobs.set(id, runAt);
}

export async function publishWorkflowJobPickup(id: number, runAt: Date): Promise<boolean> {
  try {
    await sendSystemJobAfter(WORKFLOW_JOB_QUEUE, { jobId: id }, runAt, options);
    return true;
  } catch (err) {
    logger.warn('[workflow-jobs] wakeup failed; pending reconciliation will retry', { jobId: id, err });
    return false;
  }
}

export function scheduleJobPickup(id: number, runAt: Date): void {
  void publishWorkflowJobPickup(id, runAt);
}

/** Call only after the associated transaction has committed. Rolled-back executors are never flushed. */
export async function flushWorkflowJobPickups(executor: DbExecutor): Promise<void> {
  const jobs = pendingPickups.get(executor);
  pendingPickups.delete(executor);
  if (jobs) await Promise.all([...jobs].map(([id, runAt]) => publishWorkflowJobPickup(id, runAt)));
}
