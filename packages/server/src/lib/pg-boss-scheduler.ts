/**
 * pg-boss 调度器
 * 基于 PostgreSQL SKIP LOCKED 实现精确一次执行和多进程安全。
 *
 * 对外 API 与原 cron-scheduler.ts 保持一致，以最小化调用方改动。
 */
import { PgBoss, type QueueOptions, type SendOptions, type WorkHandler } from 'pg-boss';
import { eq, and, isNull } from 'drizzle-orm';
import { db } from '../db';
import { cronJobs, cronJobLogs, dbBackups, users } from '../db/schema';
import logger from './logger';
import { cleanExpiredCaptchas } from './captcha';
import { cleanExpiredSessions } from './session-manager';
import { createPgDumpBackup, createDrizzleExportBackup } from './db-backup';
import { formatFileTimestamp, formatDateTime } from './datetime';
import { config } from '../config';
import { notifyUsersWithCard } from '../services/chat-notify.service';
import type { ChatCard } from '@zenith/shared';

/** 定时任务失败 → 推送告警卡片给任务创建者（无则推给系统管理员） */
async function pushCronFailureAlert(jobId: number, jobName: string, message: string): Promise<void> {
  try {
    const [job] = await db.select({ createdBy: cronJobs.createdBy }).from(cronJobs).where(eq(cronJobs.id, jobId)).limit(1);
    let targetId = job?.createdBy ?? null;
    if (!targetId) {
      const [admin] = await db.select({ id: users.id }).from(users)
        .where(and(eq(users.username, 'admin'), isNull(users.tenantId))).limit(1);
      targetId = admin?.id ?? null;
    }
    if (!targetId) return;
    const card: ChatCard = {
      title: '定时任务执行失败',
      text: `任务「${jobName}」执行失败，请及时排查`,
      fields: [
        { label: '错误信息', value: message.slice(0, 200) },
        { label: '发生时间', value: formatDateTime(new Date()) },
      ],
      source: '系统告警',
    };
    await notifyUsersWithCard([targetId], card);
  } catch (err) {
    logger.error('[cron] 失败告警卡片推送异常', err);
  }
}
import { CronExpressionParser } from 'cron-parser';

// ─── 队列名工具 ───────────────────────────────────────────────────────────────
// pg-boss 队列名只允许：字母数字、连字符、句点、斜杠
// cron_jobs.name 可能包含中文，故改用 "cron-job-{id}" 作为队列名

function queueName(jobId: number): string {
  return `cron-job-${jobId}`;
}

// ─── pg-boss 实例（单例）─────────────────────────────────────────────────────

let boss: PgBoss | null = null;
const systemRecurringJobs = new Map<string, { name: string; cronExpression: string; registeredAt: string }>();
const systemQueueWorkers = new Map<string, { name: string; registeredAt: string }>();

function getBoss(): PgBoss {
  if (!boss) throw new Error('pg-boss not initialized. Call initCronScheduler() first.');
  return boss;
}

// ─── Handler 注册表 ──────────────────────────────────────────────────────────

type HandlerFn = (params?: string | null) => Promise<string>;
const handlerRegistry = new Map<string, HandlerFn>();

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

handlerRegistry.set('databaseBackup', async (params) => {
  const type = params === 'drizzle_export' ? 'drizzle_export' : 'pg_dump';
  const timestamp = formatFileTimestamp();
  const [backup] = await db.insert(dbBackups).values({ name: `cron-${type}-${timestamp}`, type, status: 'pending' }).returning();
  const run = type === 'pg_dump' ? createPgDumpBackup : createDrizzleExportBackup;
  await run(backup.id);
  return `数据库备份完成 (${type}), ID: ${backup.id}`;
});

handlerRegistry.set('retryWorkflowEventDeliveries', async () => {
  const { retryWorkflowEventDeliveries } = await import('./workflow-subscribers/webhook');
  const { retried } = await retryWorkflowEventDeliveries();
  return `重试了 ${retried} 个事件投递`;
});

handlerRegistry.set('replayWorkflowEventOutbox', async () => {
  const { replayWorkflowEventOutbox } = await import('./workflow-event-bus');
  const r = await replayWorkflowEventOutbox();
  return `工作流事件 outbox：扫描 ${r.scanned}，重放成功 ${r.dispatched}，失败 ${r.failed}`;
});

handlerRegistry.set('processWorkflowTaskTimeouts', async () => {
  const { processWorkflowTaskTimeouts } = await import('./workflow-timeout-processor');
  const r = await processWorkflowTaskTimeouts();
  return `扫描 ${r.processed} 个超时任务：提醒 ${r.reminded}，自动通过 ${r.approved}，自动拒绝 ${r.rejected}，升级转交 ${r.escalated}`;
});

handlerRegistry.set('recoverStuckWorkflowSubProcesses', async () => {
  const { recoverStuckSubProcesses } = await import('./workflow-subprocess-recovery');
  const r = await recoverStuckSubProcesses();
  return `子流程恢复扫描：重新发起 ${r.spawned} 个、重新唤醒 ${r.resumed} 个、多实例汇聚对账 ${r.reconciled} 个`;
});

handlerRegistry.set('recoverWorkflowRuntimeSideEffects', async () => {
  const { recoverPendingExternalApprovals } = await import('./workflow-subscribers/external-approver');
  const { recoverPendingWorkflowTriggers } = await import('./workflow-subscribers/trigger');
  const external = await recoverPendingExternalApprovals();
  const trigger = await recoverPendingWorkflowTriggers();
  return `工作流运行时副作用恢复：外部审批扫描 ${external.scanned}/派发 ${external.dispatched}；触发器扫描 ${trigger.scanned}/派发 ${trigger.dispatched}/跳过 ${trigger.skipped}`;
});

handlerRegistry.set('publishScheduledAnnouncements', async () => {
  const { publishScheduledAnnouncements } = await import('../services/announcements.service');
  const count = await publishScheduledAnnouncements();
  return `自动发布了 ${count} 条定时公告`;
});

handlerRegistry.set('cleanupTerminalRecordings', async () => {
  const { cleanupRecordings } = await import('../services/terminal-recordings.service');
  const r = await cleanupRecordings();
  return `清理终端录屏：按保留天数删除 ${r.deletedByAge} 条、按容量删除 ${r.deletedBySize} 条，释放约 ${(r.freedBytes / 1024 / 1024).toFixed(2)} MB`;
});

handlerRegistry.set('closeExpiredPaymentOrders', async () => {
  const { closeExpiredOrders } = await import('../services/payment-reconciliation.service');
  const count = await closeExpiredOrders();
  return `关闭过期支付订单 ${count} 笔`;
});

handlerRegistry.set('paymentReconciliation', async () => {
  const { runReconciliation } = await import('../services/payment-reconciliation.service');
  const r = await runReconciliation();
  return `支付对账完成：核对 ${r.checked} 笔，纠正 ${r.fixed} 笔`;
});

handlerRegistry.set('dispatchPaymentEvents', async () => {
  const { dispatchPendingPaymentEvents } = await import('../services/payment-outbox.service');
  const count = await dispatchPendingPaymentEvents();
  return `补投支付事件 ${count} 条`;
});

handlerRegistry.set('retryPaymentWebhooks', async () => {
  const { retryPendingDeliveries } = await import('../services/payment-webhook.service');
  const count = await retryPendingDeliveries();
  return `重试支付 Webhook 投递 ${count} 条`;
});

handlerRegistry.set('analyticsRollupDaily', async (params) => {
  const { rebuildRollup } = await import('../services/analytics-rollup.service');
  const days = Number(params) || 2;
  const n = await rebuildRollup(days);
  return `重建每日聚合 ${n} 条`;
});

handlerRegistry.set('analyticsRetention', async () => {
  const { runAnalyticsRetention } = await import('../services/analytics-rollup.service');
  const r = await runAnalyticsRetention();
  return `数据保留清理：埋点 ${r.events} 条、会话 ${r.sessions} 条、错误 ${r.errors} 条`;
});

handlerRegistry.set('evaluateErrorAlerts', async () => {
  const { evaluateAlerts } = await import('../services/error-alert.service');
  const r = await evaluateAlerts();
  return `错误告警评估：规则 ${r.evaluated} 条，触发 ${r.triggered} 条`;
});

handlerRegistry.set('sampleSystemMetrics', async () => {
  const { persistMetricSample } = await import('../services/monitor-history.service');
  const ok = await persistMetricSample();
  return ok ? '已记录系统指标采样' : '采样器未预热，跳过';
});

handlerRegistry.set('evaluateMonitorAlerts', async () => {
  const { evaluateMonitorAlerts } = await import('../services/monitor-alert.service');
  const r = await evaluateMonitorAlerts();
  return `监控告警评估：规则 ${r.evaluated} 条，触发 ${r.fired} 条，恢复 ${r.resolved} 条`;
});

handlerRegistry.set('cleanupSystemMetrics', async (params) => {
  const { cleanupMetricSamples } = await import('../services/monitor-history.service');
  const days = Number(params) || 7;
  const n = await cleanupMetricSamples(days);
  return `清理系统指标采样：删除 ${n} 条（保留 ${days} 天）`;
});

handlerRegistry.set('cleanupUploadSessions', async () => {
  const { cleanupStaleUploadSessions } = await import('../services/upload-sessions.service');
  const r = await cleanupStaleUploadSessions();
  return `清理分片上传：过期会话 ${r.staleSessions} 个、孤儿临时目录 ${r.orphanDirs} 个，释放约 ${(r.freedBytes / 1024 / 1024).toFixed(2)} MB`;
});

handlerRegistry.set('dispatchReportSubscriptions', async () => {
  const { dispatchDueSubscriptions } = await import('../services/report-subscription.service');
  const r = await dispatchDueSubscriptions();
  return `报表订阅分发：检查 ${r.checked} 个，推送 ${r.pushed} 个`;
});

handlerRegistry.set('refreshReportMaterializations', async () => {
  const { dispatchDueMaterializations } = await import('../services/report-dataset.service');
  const r = await dispatchDueMaterializations();
  return `报表物化刷新：检查 ${r.checked} 个，刷新 ${r.refreshed} 个`;
});

/** 已注册 handler 名称列表（供前端下拉选择） */
export function getRegisteredHandlers(): string[] {
  return Array.from(handlerRegistry.keys());
}

// ─── pg-boss 通用 Worker ────────────────────────────────────────────────────

interface JobData {
  handlerName: string;
  params: string | null;
  jobId: number;
}

async function registerWorker(queue: string): Promise<void> {
  const b = getBoss();
  await b.work<JobData>(queue, async (jobs: Parameters<WorkHandler<JobData>>[0]) => {
    const job = jobs[0];
    const { handlerName, params, jobId } = job.data;
    const fn = handlerRegistry.get(handlerName);
    const startedAt = new Date();

    const [jobRow] = await db.select({ name: cronJobs.name }).from(cronJobs).where(eq(cronJobs.id, jobId)).limit(1);
    const jobName = jobRow?.name ?? `job_${jobId}`;
    const executionCount = await db.$count(cronJobLogs, eq(cronJobLogs.jobId, jobId)) + 1;

    if (!fn) {
      const msg = `Handler "${handlerName}" not found`;
      await Promise.all([
        db.update(cronJobs).set({ lastRunAt: startedAt, lastRunStatus: 'fail', lastRunMessage: msg }).where(eq(cronJobs.id, jobId)),
        db.insert(cronJobLogs).values({ jobId, jobName, executionCount, startedAt, endedAt: new Date(), durationMs: 0, status: 'fail', output: msg }),
      ]);
      void pushCronFailureAlert(jobId, jobName, msg);
      throw new Error(msg);
    }

    const [logRow] = await db.insert(cronJobLogs).values({
      jobId, jobName, executionCount, startedAt, status: 'running',
    }).returning();
    await db.update(cronJobs).set({ lastRunAt: startedAt, lastRunStatus: 'running', lastRunMessage: null }).where(eq(cronJobs.id, jobId));

    let resultMessage: string;
    try {
      resultMessage = await fn(params);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      const endedAt = new Date();
      const durationMs = endedAt.getTime() - startedAt.getTime();
      await Promise.all([
        db.update(cronJobs).set({ lastRunStatus: 'fail', lastRunMessage: errorMessage.slice(0, 1024) }).where(eq(cronJobs.id, jobId)),
        db.update(cronJobLogs).set({ endedAt, durationMs, status: 'fail', output: errorMessage.slice(0, 2048) }).where(eq(cronJobLogs.id, logRow.id)),
      ]);
      logger.error(`Cron job ${jobId} (${jobName}) failed:`, err);
      void pushCronFailureAlert(jobId, jobName, errorMessage);
      throw err;
    }

    const endedAt = new Date();
    const durationMs = endedAt.getTime() - startedAt.getTime();
    await Promise.all([
      db.update(cronJobs).set({ lastRunStatus: 'success', lastRunMessage: resultMessage.slice(0, 1024) }).where(eq(cronJobs.id, jobId)),
      db.update(cronJobLogs).set({ endedAt, durationMs, status: 'success', output: resultMessage.slice(0, 2048) }).where(eq(cronJobLogs.id, logRow.id)),
    ]);
  });
}

// ─── 公开 API ────────────────────────────────────────────────────────────────

export async function initCronScheduler(): Promise<void> {
  boss = new PgBoss({
    connectionString: config.databaseUrl,
    schema: 'pgboss',
    supervise: true,
    superviseIntervalSeconds: 30,
  });

  boss.on('error', (err: unknown) => logger.error('pg-boss error:', err));

  logger.info('pg-boss: starting...');
  await boss.start();
  logger.info('pg-boss started');

  const jobs = await db.select().from(cronJobs).where(eq(cronJobs.status, 'enabled'));
  for (const job of jobs) {
    await _scheduleOne(job);
  }
  logger.info(`pg-boss: ${jobs.length} enabled job(s) scheduled`);
}

async function _scheduleOne(job: typeof cronJobs.$inferSelect): Promise<boolean> {
  const b = getBoss();
  const queue = queueName(job.id);

  await b.createQueue(queue, { retentionSeconds: 60 * 60 * 24 * 7 });
  await registerWorker(queue);

  const retryOptions: { retryLimit?: number; retryDelay?: number; retryBackoff?: boolean } = {};
  if (job.retryCount > 0) {
    retryOptions.retryLimit = job.retryCount;
    retryOptions.retryDelay = Math.max(job.retryInterval, 0);
    retryOptions.retryBackoff = job.retryBackoff;
  }

  await b.schedule(queue, job.cronExpression, {
    handlerName: job.handler,
    params: job.params,
    jobId: job.id,
  } satisfies JobData, {
    tz: 'Asia/Shanghai',
    ...retryOptions,
    ...(job.monitorTimeout ? { expireInSeconds: job.monitorTimeout } : {}),
  });

  return true;
}

interface ScheduleOptions {
  retryCount?: number;
  retryDelay?: number;
  retryBackoff?: boolean;
  monitorTimeout?: number | null;
}

export async function scheduleJob(
  jobId: number,
  _jobName: string,
  expression: string,
  handler: string,
  params: string | null,
  opts: ScheduleOptions = {},
): Promise<boolean> {
  const { retryCount = 0, retryDelay = 0, retryBackoff = false, monitorTimeout } = opts;
  const b = getBoss();
  const queue = queueName(jobId);

  await b.createQueue(queue);
  await registerWorker(queue);

  await b.schedule(queue, expression, {
    handlerName: handler,
    params,
    jobId,
  } satisfies JobData, {
    tz: 'Asia/Shanghai',
    ...(retryCount > 0 ? { retryLimit: retryCount, retryDelay, retryBackoff } : {}),
    ...(monitorTimeout ? { expireInSeconds: monitorTimeout } : {}),
  });

  return true;
}

export async function stopJob(jobId: number, _jobName: string): Promise<void> {
  try {
    const b = getBoss();
    await b.unschedule(queueName(jobId));
  } catch (err) {
    logger.warn(`pg-boss: failed to unschedule job ${jobId}:`, err);
  }
}

export async function runJobOnce(jobId: number): Promise<{ success: boolean; message: string }> {
  const [job] = await db.select().from(cronJobs).where(eq(cronJobs.id, jobId)).limit(1);
  if (!job) return { success: false, message: '任务不存在' };

  const b = getBoss();
  const queue = queueName(jobId);

  await b.createQueue(queue);
  await registerWorker(queue);

  await b.send(queue, {
    handlerName: job.handler,
    params: job.params,
    jobId,
  } satisfies JobData);

  const deadline = Date.now() + 30_000;
  const logsBefore = await db.$count(cronJobLogs, eq(cronJobLogs.jobId, jobId));
  while (Date.now() < deadline) {
    const logsNow = await db.$count(cronJobLogs, eq(cronJobLogs.jobId, jobId));
    if (logsNow > logsBefore) {
      const [latestLog] = await db.select()
        .from(cronJobLogs)
        .where(eq(cronJobLogs.jobId, jobId))
        .orderBy(cronJobLogs.id)
        .limit(1);
      if (latestLog && latestLog.status !== 'running') {
        return { success: latestLog.status === 'success', message: latestLog.output ?? '' };
      }
    }
    await new Promise<void>((r) => setTimeout(r, 500));
  }

  return { success: true, message: '任务已投递，正在后台执行' };
}

export async function stopAllJobs(): Promise<void> {
  if (boss) {
    await boss.stop();
    boss = null;
    logger.info('pg-boss stopped');
  }
}

/** 获取当前正在运行中的 job 数（基于 pg-boss worker WIP 数据） */
export function getRunningJobCount(): number {
  if (!boss) return 0;
  return boss.getWipData().filter(w => w.count > 0).reduce((sum, w) => sum + w.count, 0);
}

export function getSchedulerIntrospection(): {
  initialized: boolean;
  runningJobCount: number;
  registeredHandlers: string[];
  systemRecurringJobs: Array<{ name: string; cronExpression: string; registeredAt: string }>;
  systemQueueWorkers: Array<{ name: string; registeredAt: string }>;
  wip: Array<{ name: string; count: number }>;
} {
  const wip = boss?.getWipData().map((item) => ({ name: item.name, count: item.count })) ?? [];
  return {
    initialized: boss !== null,
    runningJobCount: wip.filter((item) => item.count > 0).reduce((sum, item) => sum + item.count, 0),
    registeredHandlers: getRegisteredHandlers(),
    systemRecurringJobs: [...systemRecurringJobs.values()],
    systemQueueWorkers: [...systemQueueWorkers.values()],
    wip,
  };
}

/**
 * 注册系统级周期任务（不写入 cron_jobs / cron_job_logs），用于工作流定时发起等内部调度。
 * 与用户可配置的 cron 任务隔离，避免污染任务日志。
 */
export async function registerSystemRecurringJob(
  name: string,
  cronExpr: string,
  fn: () => Promise<void>,
): Promise<void> {
  const b = getBoss();
  await b.createQueue(name);
  await b.work(name, async () => { await fn(); });
  await b.schedule(name, cronExpr, {}, { tz: 'Asia/Shanghai' });
  systemRecurringJobs.set(name, { name, cronExpression: cronExpr, registeredAt: formatDateTime(new Date()) });
  logger.info(`pg-boss: system recurring job "${name}" scheduled (${cronExpr})`);
}

export async function registerSystemQueueWorker<T extends object>(
  name: string,
  handler: (data: T) => Promise<void>,
  queueOptions?: Omit<QueueOptions, 'name'>,
): Promise<void> {
  const b = getBoss();
  await b.createQueue(name, queueOptions);
  await b.work<T>(name, async (jobs) => {
    for (const job of jobs) {
      await handler(job.data);
    }
  });
  systemQueueWorkers.set(name, { name, registeredAt: formatDateTime(new Date()) });
  logger.info(`pg-boss: system queue worker "${name}" registered`);
}

export async function sendSystemJobAfter<T extends object>(
  name: string,
  data: T,
  runAt: Date,
  options?: SendOptions,
): Promise<string | null> {
  return getBoss().sendAfter(name, data, options ?? null, runAt);
}

export async function sendSystemJob<T extends object>(
  name: string,
  data: T,
  options?: SendOptions,
): Promise<string | null> {
  return getBoss().send(name, data, options);
}

export async function deleteSystemJob(name: string, id: string): Promise<void> {
  await getBoss().deleteJob(name, id);
}

/** 校验 cron 表达式（兼容 5 段标准格式和带秒的 6 段格式） */
export function validateCronExpression(expression: string): boolean {
  try {
    CronExpressionParser.parse(expression.trim());
    return true;
  } catch {
    return false;
  }
}
