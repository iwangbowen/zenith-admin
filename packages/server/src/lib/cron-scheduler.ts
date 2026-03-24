import cron, { type ScheduledTask } from 'node-cron';
import { eq } from 'drizzle-orm';
import { db } from '../db';
import { cronJobs } from '../db/schema';
import logger from './logger';
import { cleanExpiredCaptchas } from './captcha';
import { cleanExpiredSessions } from './session-manager';

type HandlerFn = (params?: string | null) => Promise<string>;

/** Registry of built-in task handlers */
const handlerRegistry = new Map<string, HandlerFn>();

/** Active cron tasks by job ID */
const activeTasks = new Map<number, ScheduledTask>();

// ─── Register built-in handlers ──────────────────────────────────
handlerRegistry.set('cleanExpiredCaptchas', async () => {
  const count = cleanExpiredCaptchas();
  return `清理了 ${count} 个过期验证码`;
});

handlerRegistry.set('cleanExpiredSessions', async () => {
  const count = await cleanExpiredSessions();
  return `清理了 ${count} 个过期会话（Redis TTL 自动清理）`;
});

handlerRegistry.set('echo', async (params) => {
  return `Echo: ${params ?? 'no params'}`;
});

// ─── Public API ────────────────────────────────────────────────

/** Get list of registered handler names */
export function getRegisteredHandlers(): string[] {
  return Array.from(handlerRegistry.keys());
}

/** Initialize: load all active jobs from DB and schedule them */
export async function initCronScheduler(): Promise<void> {
  const jobs = await db.select().from(cronJobs).where(eq(cronJobs.status, 'active'));
  for (const job of jobs) {
    scheduleJob(job.id, job.cronExpression, job.handler, job.params);
  }
  logger.info(`Cron scheduler initialized with ${jobs.length} active job(s)`);
}

/** Schedule a single job */
export function scheduleJob(jobId: number, expression: string, handler: string, params: string | null): boolean {
  if (!cron.validate(expression)) {
    logger.warn(`Invalid cron expression for job ${jobId}: ${expression}`);
    return false;
  }

  // Stop existing task if any
  stopJob(jobId);

  const task = cron.schedule(expression, async () => {
    await executeJob(jobId, handler, params);
  });

  activeTasks.set(jobId, task);
  return true;
}

/** Stop a scheduled job */
export function stopJob(jobId: number): void {
  const task = activeTasks.get(jobId);
  if (task) {
    task.stop();
    activeTasks.delete(jobId);
  }
}

/** Execute a job immediately (manual trigger) */
export async function runJobOnce(jobId: number): Promise<{ success: boolean; message: string }> {
  const [job] = await db.select().from(cronJobs).where(eq(cronJobs.id, jobId)).limit(1);
  if (!job) return { success: false, message: '任务不存在' };
  return executeJob(jobId, job.handler, job.params);
}

/** Validate a cron expression */
export function validateCronExpression(expression: string): boolean {
  return cron.validate(expression);
}

// ─── Internal ────────────────────────────────────────────────

async function executeJob(jobId: number, handler: string, params: string | null): Promise<{ success: boolean; message: string }> {
  const fn = handlerRegistry.get(handler);
  if (!fn) {
    const msg = `Handler "${handler}" not found`;
    await db.update(cronJobs).set({
      lastRunAt: new Date(),
      lastRunStatus: 'fail',
      lastRunMessage: msg,
      updatedAt: new Date(),
    }).where(eq(cronJobs.id, jobId));
    return { success: false, message: msg };
  }

  await db.update(cronJobs).set({
    lastRunAt: new Date(),
    lastRunStatus: 'running',
    lastRunMessage: null,
    updatedAt: new Date(),
  }).where(eq(cronJobs.id, jobId));

  try {
    const message = await fn(params);
    await db.update(cronJobs).set({
      lastRunStatus: 'success',
      lastRunMessage: message.slice(0, 1024),
      updatedAt: new Date(),
    }).where(eq(cronJobs.id, jobId));
    return { success: true, message };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await db.update(cronJobs).set({
      lastRunStatus: 'fail',
      lastRunMessage: message.slice(0, 1024),
      updatedAt: new Date(),
    }).where(eq(cronJobs.id, jobId));
    logger.error(`Cron job ${jobId} failed:`, err);
    return { success: false, message };
  }
}
