import cron, { type ScheduledTask } from 'node-cron';
import { eq } from 'drizzle-orm';
import { db } from '../db';
import { cronJobs, cronJobLogs } from '../db/schema';
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

  // 获取任务名称（用于日志记录）
  const [jobRow] = await db.select({ name: cronJobs.name }).from(cronJobs).where(eq(cronJobs.id, jobId)).limit(1);
  const jobName = jobRow?.name ?? `job_${jobId}`;
  const startedAt = new Date();

  if (!fn) {
    const msg = `Handler "${handler}" not found`;
    await Promise.all([
      db.update(cronJobs).set({
        lastRunAt: startedAt,
        lastRunStatus: 'fail',
        lastRunMessage: msg,
        updatedAt: new Date(),
      }).where(eq(cronJobs.id, jobId)),
      db.insert(cronJobLogs).values({
        jobId,
        jobName,
        startedAt,
        endedAt: new Date(),
        durationMs: 0,
        status: 'fail',
        output: msg,
      }),
    ]);
    return { success: false, message: msg };
  }

  // 插入运行中日志，同时更新任务状态
  const [logRow] = await db.insert(cronJobLogs).values({
    jobId,
    jobName,
    startedAt,
    status: 'running',
  }).returning();

  await db.update(cronJobs).set({
    lastRunAt: startedAt,
    lastRunStatus: 'running',
    lastRunMessage: null,
    updatedAt: new Date(),
  }).where(eq(cronJobs.id, jobId));

  try {
    const message = await fn(params);
    const endedAt = new Date();
    const durationMs = endedAt.getTime() - startedAt.getTime();
    await Promise.all([
      db.update(cronJobs).set({
        lastRunStatus: 'success',
        lastRunMessage: message.slice(0, 1024),
        updatedAt: new Date(),
      }).where(eq(cronJobs.id, jobId)),
      db.update(cronJobLogs).set({
        endedAt,
        durationMs,
        status: 'success',
        output: message.slice(0, 2048),
      }).where(eq(cronJobLogs.id, logRow.id)),
    ]);
    return { success: true, message };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const endedAt = new Date();
    const durationMs = endedAt.getTime() - startedAt.getTime();
    await Promise.all([
      db.update(cronJobs).set({
        lastRunStatus: 'fail',
        lastRunMessage: message.slice(0, 1024),
        updatedAt: new Date(),
      }).where(eq(cronJobs.id, jobId)),
      db.update(cronJobLogs).set({
        endedAt,
        durationMs,
        status: 'fail',
        output: message.slice(0, 2048),
      }).where(eq(cronJobLogs.id, logRow.id)),
    ]);
    logger.error(`Cron job ${jobId} failed:`, err);
    return { success: false, message };
  }
}
