import { and, eq, isNotNull } from 'drizzle-orm';
import { db } from '../db';
import { workflowTasks } from '../db/schema';
import logger from './logger';

/** 单次 setTimeout 最大延时（24h），超过分段重排 */
const MAX_TIMEOUT_MS = 24 * 60 * 60 * 1000;

const timers = new Map<number, NodeJS.Timeout>();

function clearTimer(taskId: number) {
  const t = timers.get(taskId);
  if (t) {
    clearTimeout(t);
    timers.delete(taskId);
  }
}

function scheduleAt(taskId: number, wakeAt: Date) {
  clearTimer(taskId);
  const remaining = wakeAt.getTime() - Date.now();
  const delay = Math.max(0, Math.min(remaining, MAX_TIMEOUT_MS));
  const t = setTimeout(() => {
    timers.delete(taskId);
    if (remaining > MAX_TIMEOUT_MS) {
      scheduleAt(taskId, wakeAt);
      return;
    }
    void fireWake(taskId);
  }, delay);
  timers.set(taskId, t);
}

function cancelScheduled(taskId: number) {
  clearTimer(taskId);
}

async function fireWake(taskId: number) {
  try {
    const { resumeDelayTask } = await import('../services/workflow-resume.service');
    await resumeDelayTask(taskId);
  } catch (err) {
    logger.error(`Delay scheduler: failed to wake task ${taskId}`, err);
  }
}

async function initialize() {
  const rows = await db.select({ id: workflowTasks.id, wakeAt: workflowTasks.wakeAt }).from(workflowTasks)
    .where(and(
      eq(workflowTasks.status, 'waiting'),
      eq(workflowTasks.nodeType, 'delay'),
      isNotNull(workflowTasks.wakeAt),
    ));
  for (const row of rows) {
    if (row.wakeAt) scheduleAt(row.id, row.wakeAt);
  }
  logger.info(`Delay scheduler initialized: ${rows.length} pending delay task(s) scheduled`);
}

export const delayScheduler = { initialize, scheduleAt, cancelScheduled };
