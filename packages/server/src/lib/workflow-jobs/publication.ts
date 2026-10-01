import type { DbExecutor } from '../../db/types';
import { sendSystemJob } from '../pg-boss-scheduler';
import logger from '../logger';
import { WORKFLOW_JOB_QUEUE, WORKFLOW_OUTBOUND_JOB_QUEUE } from './types';

const pendingPickups = new WeakSet<DbExecutor>();
const options = { retryLimit: 0, expireInSeconds: 60, retentionSeconds: 60 };
let pendingPublication: Promise<boolean> | null = null;

export function rememberWorkflowJobPickup(executor: DbExecutor, _id: number, _runAt: Date): void {
  pendingPickups.add(executor);
}

export function publishWorkflowJobPickup(): Promise<boolean> {
  if (pendingPublication) return pendingPublication;
  pendingPublication = Promise.resolve().then(async () => {
    try {
      await Promise.all([WORKFLOW_JOB_QUEUE, WORKFLOW_OUTBOUND_JOB_QUEUE].map((name) => sendSystemJob(name, {}, options)));
      return true; // null means another pending hint already covers this wakeup.
    } catch (err) {
      logger.warn('[workflow-jobs] wakeup failed; ledger polling will retry', { err });
      return false;
    } finally { pendingPublication = null; }
  });
  return pendingPublication;
}

export function scheduleJobPickup(_id: number, _runAt: Date): void {
  void publishWorkflowJobPickup();
}

/** Call only after the associated transaction has committed. Rolled-back executors are never flushed. */
export async function flushWorkflowJobPickups(executor: DbExecutor): Promise<void> {
  const hasJobs = pendingPickups.has(executor);
  pendingPickups.delete(executor);
  if (hasJobs) await publishWorkflowJobPickup();
}
