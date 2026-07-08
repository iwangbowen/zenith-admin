/**
 * pg-boss 调度器
 * 基于 PostgreSQL SKIP LOCKED 实现精确一次执行和多进程安全。
 *
 * 用户可配置 Cron 与系统启动任务共用 pg-boss 执行，但日志与注册元数据分离。
 */
import os from 'node:os';
import { PgBoss, type QueueOptions, type SendOptions, type WorkHandler } from 'pg-boss';
import { eq, and, isNull, desc, sql } from 'drizzle-orm';
import { db } from '../db';
import { cronJobs, cronJobLogs, dbBackups, systemSchedulerNodes, systemSchedulerRuns, systemSchedulerTaskConfigs, users } from '../db/schema';
import logger from './logger';
import { cleanExpiredCaptchas } from './captcha';
import { cleanExpiredSessions } from './session-manager';
import { createPgDumpBackup, createDrizzleExportBackup } from './db-backup';
import { formatFileTimestamp, formatDateTime } from './datetime';
import { config } from '../config';
import { notifyUsersWithCard } from '../services/chat/chat-notify.service';
import type {
  ChatCard,
  SystemSchedulerTaskBase,
  SystemSchedulerTaskType,
  SystemSchedulerRunStatus,
  SystemSchedulerTriggerType,
  SystemSchedulerAlertChannel,
} from '@zenith/shared';
import { sendMail } from './email';
import { httpPost } from './http-client';

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
const schedulerNodeHostname = os.hostname();
const schedulerNodePid = process.pid;
const schedulerNodeId = `${schedulerNodeHostname}:${schedulerNodePid}`;

export type { SystemSchedulerTaskType, SystemSchedulerRunStatus, SystemSchedulerTriggerType, SystemSchedulerAlertChannel };

export interface SystemSchedulerTaskPolicy {
  enabled: boolean;
  logRetentionDays: number;
  logRetentionRuns: number;
  timeoutMs: number | null;
  failureAlertThreshold: number;
  alertEnabled: boolean;
  alertChannels: SystemSchedulerAlertChannel[];
  alertUserIds: number[];
  alertEmails: string[];
  alertWebhookUrl: string | null;
  manualSingleton: boolean;
}

export interface SystemSchedulerQueueMetrics {
  queuedCount: number;
  activeCount: number;
  deferredCount: number;
  totalCount: number;
  failedCount: number;
  completedCount: number;
  stateCounts: Record<string, number>;
}

export type SystemSchedulerTaskInfo = SystemSchedulerTaskBase;

interface SystemRecurringJobInfo extends SystemSchedulerTaskInfo {
  taskType: 'recurring';
  cronExpression: string;
}

interface SystemQueueWorkerInfo extends SystemSchedulerTaskInfo {
  taskType: 'queue';
  cronExpression: null;
  allowManualRun: false;
}

export interface SystemRecurringJobRegistration {
  name: string;
  title: string;
  module: string;
  cronExpression: string;
  description?: string;
  allowManualRun?: boolean;
  logRetentionDays?: number;
  logRetentionRuns?: number;
  timeoutMs?: number | null;
  failureAlertThreshold?: number;
  alertEnabled?: boolean;
  alertChannels?: SystemSchedulerAlertChannel[];
  alertUserIds?: number[];
  alertEmails?: string[];
  alertWebhookUrl?: string | null;
  manualSingleton?: boolean;
  run: () => Promise<unknown>;
}

export interface SystemQueueWorkerRegistration<T extends object> {
  name: string;
  title: string;
  module: string;
  description?: string;
  logRetentionDays?: number;
  logRetentionRuns?: number;
  timeoutMs?: number | null;
  failureAlertThreshold?: number;
  alertEnabled?: boolean;
  alertChannels?: SystemSchedulerAlertChannel[];
  alertUserIds?: number[];
  alertEmails?: string[];
  alertWebhookUrl?: string | null;
  handler: (data: T) => Promise<unknown>;
  queueOptions?: Omit<QueueOptions, 'name'>;
}

interface SystemRecurringJobPayload {
  __systemSchedulerTrigger?: 'schedule' | 'manual';
  runId?: number;
  triggeredBy?: number | null;
}

interface ExecuteSystemTaskOptions {
  runId?: number;
  jobId?: string | null;
  triggeredBy?: number | null;
}

const DEFAULT_SYSTEM_TASK_POLICY: SystemSchedulerTaskPolicy = {
  enabled: true,
  logRetentionDays: 30,
  logRetentionRuns: 1000,
  timeoutMs: null,
  failureAlertThreshold: 1,
  alertEnabled: true,
  alertChannels: ['inapp'],
  alertUserIds: [],
  alertEmails: [],
  alertWebhookUrl: null,
  manualSingleton: true,
};

const systemRecurringJobs = new Map<string, SystemRecurringJobInfo>();
const systemRecurringJobHandlers = new Map<string, () => Promise<unknown>>();
const systemQueueWorkers = new Map<string, SystemQueueWorkerInfo>();
let schedulerHeartbeatTimer: NodeJS.Timeout | null = null;
const schedulerStartedAt = new Date();

function getBoss(): PgBoss {
  if (!boss) throw new Error('pg-boss not initialized. Call initCronScheduler() first.');
  return boss;
}

function limitText(value: string, maxLength = 8192): string {
  return value.length > maxLength ? value.slice(0, maxLength) : value;
}

function stringifyRunResult(result: unknown): string {
  if (result == null || result === '') return '执行完成';
  if (typeof result === 'string') return result;
  if (typeof result === 'number' || typeof result === 'boolean') return String(result);
  try {
    return JSON.stringify(result);
  } catch {
    return String(result);
  }
}

function normalizeAlertChannels(value: unknown): SystemSchedulerAlertChannel[] {
  const raw = Array.isArray(value) ? value : DEFAULT_SYSTEM_TASK_POLICY.alertChannels;
  const channels = raw.filter((item): item is SystemSchedulerAlertChannel => item === 'inapp' || item === 'email' || item === 'webhook');
  return channels.length > 0 ? Array.from(new Set(channels)) : ['inapp'];
}

function normalizeNumberArray(value: unknown): number[] {
  if (!Array.isArray(value)) return [];
  return Array.from(new Set(value.map((item) => Number(item)).filter((item) => Number.isInteger(item) && item > 0)));
}

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return Array.from(new Set(value.map((item) => String(item ?? '').trim()).filter(Boolean)));
}

function normalizeSystemTaskPolicy(input: Partial<SystemSchedulerTaskPolicy> = {}): SystemSchedulerTaskPolicy {
  return {
    enabled: input.enabled ?? DEFAULT_SYSTEM_TASK_POLICY.enabled,
    logRetentionDays: Math.max(1, input.logRetentionDays ?? DEFAULT_SYSTEM_TASK_POLICY.logRetentionDays),
    logRetentionRuns: Math.max(1, input.logRetentionRuns ?? DEFAULT_SYSTEM_TASK_POLICY.logRetentionRuns),
    timeoutMs: input.timeoutMs && input.timeoutMs > 0 ? input.timeoutMs : null,
    failureAlertThreshold: Math.max(1, input.failureAlertThreshold ?? DEFAULT_SYSTEM_TASK_POLICY.failureAlertThreshold),
    alertEnabled: input.alertEnabled ?? DEFAULT_SYSTEM_TASK_POLICY.alertEnabled,
    alertChannels: normalizeAlertChannels(input.alertChannels),
    alertUserIds: normalizeNumberArray(input.alertUserIds),
    alertEmails: normalizeStringArray(input.alertEmails),
    alertWebhookUrl: input.alertWebhookUrl?.trim() || null,
    manualSingleton: input.manualSingleton ?? DEFAULT_SYSTEM_TASK_POLICY.manualSingleton,
  };
}

async function ensureSystemSchedulerTaskConfig(name: string, policy: SystemSchedulerTaskPolicy): Promise<void> {
  await db.insert(systemSchedulerTaskConfigs).values({
    taskName: name,
    ...policy,
  }).onConflictDoUpdate({
    target: systemSchedulerTaskConfigs.taskName,
    set: {
      updatedAt: new Date(),
    },
  });
}

function registeredSystemTaskCount(): number {
  return systemRecurringJobs.size + systemQueueWorkers.size;
}

async function heartbeatSystemSchedulerNode(active = true): Promise<void> {
  const now = new Date();
  await db.insert(systemSchedulerNodes).values({
    nodeId: schedulerNodeId,
    hostname: schedulerNodeHostname,
    pid: schedulerNodePid,
    version: config.otel.serviceVersion,
    startedAt: schedulerStartedAt,
    lastHeartbeatAt: now,
    registeredTaskCount: registeredSystemTaskCount(),
    runningJobCount: getRunningJobCount(),
    active,
    metadata: {
      wip: boss?.getWipData().map((item) => ({ name: item.name, count: item.count })) ?? [],
    },
  }).onConflictDoUpdate({
    target: systemSchedulerNodes.nodeId,
    set: {
      hostname: schedulerNodeHostname,
      pid: schedulerNodePid,
      version: config.otel.serviceVersion,
      startedAt: schedulerStartedAt,
      lastHeartbeatAt: now,
      registeredTaskCount: registeredSystemTaskCount(),
      runningJobCount: getRunningJobCount(),
      active,
      metadata: {
        wip: boss?.getWipData().map((item) => ({ name: item.name, count: item.count })) ?? [],
      },
      updatedAt: now,
    },
  });
}

function startSchedulerHeartbeat(): void {
  if (schedulerHeartbeatTimer) return;
  void heartbeatSystemSchedulerNode(true).catch((err) => logger.warn('[system-scheduler] 节点心跳上报失败', err));
  schedulerHeartbeatTimer = setInterval(() => {
    void heartbeatSystemSchedulerNode(true).catch((err) => logger.warn('[system-scheduler] 节点心跳上报失败', err));
  }, 30_000);
  schedulerHeartbeatTimer.unref?.();
}

function updateRecurringJobInfoPolicy(name: string, policy: SystemSchedulerTaskPolicy): void {
  const current = systemRecurringJobs.get(name);
  if (current) systemRecurringJobs.set(name, { ...current, ...policy });
}

function updateQueueWorkerInfoPolicy(name: string, policy: SystemSchedulerTaskPolicy): void {
  const current = systemQueueWorkers.get(name);
  if (current) systemQueueWorkers.set(name, { ...current, ...policy, enabled: true, manualSingleton: false });
}

async function getRuntimeSystemTaskPolicy(task: Pick<SystemSchedulerTaskInfo, 'name'> & Partial<SystemSchedulerTaskPolicy>): Promise<SystemSchedulerTaskPolicy> {
  const [row] = await db.select().from(systemSchedulerTaskConfigs).where(eq(systemSchedulerTaskConfigs.taskName, task.name)).limit(1);
  return normalizeSystemTaskPolicy({
    enabled: row?.enabled ?? task.enabled,
    logRetentionDays: row?.logRetentionDays ?? task.logRetentionDays,
    logRetentionRuns: row?.logRetentionRuns ?? task.logRetentionRuns,
    timeoutMs: row?.timeoutMs ?? task.timeoutMs,
    failureAlertThreshold: row?.failureAlertThreshold ?? task.failureAlertThreshold,
    alertEnabled: row?.alertEnabled ?? task.alertEnabled,
    alertChannels: row?.alertChannels ?? task.alertChannels,
    alertUserIds: row?.alertUserIds ?? task.alertUserIds,
    alertEmails: row?.alertEmails ?? task.alertEmails,
    alertWebhookUrl: row?.alertWebhookUrl ?? task.alertWebhookUrl,
    manualSingleton: row?.manualSingleton ?? task.manualSingleton,
  });
}

async function defaultSystemAlertUserIds(): Promise<number[]> {
  const [admin] = await db.select({ id: users.id }).from(users)
    .where(and(eq(users.username, 'admin'), isNull(users.tenantId))).limit(1);
  return admin ? [admin.id] : [];
}

async function buildSystemTaskAlert(
  taskName: string,
  status: SystemSchedulerRunStatus,
  durationMs: number,
  message: string,
  policy: SystemSchedulerTaskPolicy,
): Promise<string | null> {
  if (!policy.alertEnabled) return null;
  if (policy.timeoutMs && durationMs > policy.timeoutMs) {
    return `执行耗时 ${durationMs} ms 超过阈值 ${policy.timeoutMs} ms`;
  }
  if (status !== 'failed') return null;

  const recentRows = await db.select({ status: systemSchedulerRuns.status })
    .from(systemSchedulerRuns)
    .where(eq(systemSchedulerRuns.taskName, taskName))
    .orderBy(desc(systemSchedulerRuns.startedAt), desc(systemSchedulerRuns.id))
    .limit(policy.failureAlertThreshold);

  if (recentRows.length >= policy.failureAlertThreshold && recentRows.every((row) => row.status === 'failed')) {
    return `连续失败 ${policy.failureAlertThreshold} 次：${message.slice(0, 200)}`;
  }
  return null;
}

async function dispatchSystemTaskAlert(
  task: Pick<SystemSchedulerTaskInfo, 'name' | 'title' | 'module'>,
  runId: number,
  alertMessage: string,
  policy: SystemSchedulerTaskPolicy,
): Promise<SystemSchedulerAlertChannel[]> {
  const sentChannels: SystemSchedulerAlertChannel[] = [];
  const channels = policy.alertChannels;
  const now = formatDateTime(new Date());
  const subject = `[系统调度告警] ${task.title}`;
  const html = `<h3>系统调度告警</h3><p><b>任务：</b>${task.title} (${task.name})</p><p><b>模块：</b>${task.module}</p><p><b>运行日志：</b>#${runId}</p><p><b>详情：</b>${alertMessage}</p><p><b>发生时间：</b>${now}</p>`;

  if (channels.includes('inapp')) {
    const targetIds = policy.alertUserIds.length > 0 ? policy.alertUserIds : await defaultSystemAlertUserIds();
    if (targetIds.length > 0) {
      const card: ChatCard = {
        title: subject,
        text: alertMessage,
        fields: [
          { label: '任务', value: `${task.title} (${task.name})` },
          { label: '模块', value: task.module },
          { label: '运行日志', value: `#${runId}` },
          { label: '发生时间', value: now },
        ],
        source: '系统调度',
      };
      await notifyUsersWithCard(targetIds, card);
      sentChannels.push('inapp');
    }
  }

  if (channels.includes('email') && policy.alertEmails.length > 0) {
    const results = await Promise.allSettled(policy.alertEmails.map((email) => sendMail(email, subject, html)));
    if (results.some((item) => item.status === 'fulfilled')) sentChannels.push('email');
  }

  if (channels.includes('webhook') && policy.alertWebhookUrl) {
    await httpPost(policy.alertWebhookUrl, {
      type: 'system_scheduler_alert',
      taskName: task.name,
      taskTitle: task.title,
      module: task.module,
      runId,
      message: alertMessage,
      timestamp: now,
    }, { timeout: 8000 });
    sentChannels.push('webhook');
  }

  return sentChannels;
}

async function updateSystemRunAlert(
  task: Pick<SystemSchedulerTaskInfo, 'name' | 'title' | 'module'>,
  runId: number,
  alertMessage: string | null,
  policy: SystemSchedulerTaskPolicy,
): Promise<void> {
  if (!alertMessage) return;
  let sentChannels: SystemSchedulerAlertChannel[] = [];
  try {
    sentChannels = await dispatchSystemTaskAlert(task, runId, alertMessage, policy);
  } catch (err) {
    logger.warn('[system-scheduler] 告警派发失败', { taskName: task.name, runId, err });
  }
  await db.update(systemSchedulerRuns).set({
    alertedAt: new Date(),
    alertMessage: limitText(alertMessage, 2048),
    alertSentAt: sentChannels.length > 0 ? new Date() : null,
    alertChannels: sentChannels,
  }).where(eq(systemSchedulerRuns.id, runId));
  logger.warn(`[system-scheduler] ${alertMessage}`);
}

function updateSystemTaskRunSnapshot(
  name: string,
  taskType: SystemSchedulerTaskType,
  patch: Pick<SystemSchedulerTaskInfo, 'lastRunAt' | 'lastRunStatus' | 'lastRunMessage' | 'lastDurationMs'>,
): void {
  if (taskType === 'recurring') {
    const current = systemRecurringJobs.get(name);
    if (current) systemRecurringJobs.set(name, { ...current, ...patch });
    return;
  }
  const current = systemQueueWorkers.get(name);
  if (current) systemQueueWorkers.set(name, { ...current, ...patch });
}

async function executeSystemTask(
  task: Pick<
    SystemSchedulerTaskInfo,
    'name' | 'title' | 'taskType' | 'module' | 'enabled' | 'logRetentionDays' | 'logRetentionRuns' | 'timeoutMs' | 'failureAlertThreshold' | 'alertEnabled' | 'alertChannels' | 'alertUserIds' | 'alertEmails' | 'alertWebhookUrl' | 'manualSingleton'
  >,
  triggerType: SystemSchedulerTriggerType,
  fn: () => Promise<unknown>,
  options: ExecuteSystemTaskOptions = {},
): Promise<string> {
  const startedAt = new Date();
  const startedAtText = formatDateTime(startedAt);
  const policy = await getRuntimeSystemTaskPolicy(task);
  if (!policy.enabled && task.taskType === 'recurring') {
    const skippedMessage = triggerType === 'manual' ? '任务已停用，拒绝手动执行' : '任务已停用，跳过自动调度';
    if (options.runId) {
      await db.update(systemSchedulerRuns).set({
        status: 'failed',
        startedAt,
        endedAt: startedAt,
        durationMs: 0,
        errorMessage: skippedMessage,
        jobId: options.jobId ?? null,
        nodeId: schedulerNodeId,
        nodeHostname: schedulerNodeHostname,
        nodePid: schedulerNodePid,
        triggeredBy: options.triggeredBy ?? null,
      }).where(eq(systemSchedulerRuns.id, options.runId));
    } else {
      await db.insert(systemSchedulerRuns).values({
        taskName: task.name,
        taskTitle: task.title,
        taskType: task.taskType,
        module: task.module,
        triggerType,
        status: 'failed',
        startedAt,
        endedAt: startedAt,
        durationMs: 0,
        errorMessage: skippedMessage,
        jobId: options.jobId ?? null,
        nodeId: schedulerNodeId,
        nodeHostname: schedulerNodeHostname,
        nodePid: schedulerNodePid,
        triggeredBy: options.triggeredBy ?? null,
      });
    }
    updateSystemTaskRunSnapshot(task.name, task.taskType, {
      lastRunAt: startedAtText,
      lastRunStatus: 'failed',
      lastRunMessage: skippedMessage,
      lastDurationMs: 0,
    });
    return skippedMessage;
  }
  updateSystemTaskRunSnapshot(task.name, task.taskType, {
    lastRunAt: startedAtText,
    lastRunStatus: 'running',
    lastRunMessage: null,
    lastDurationMs: null,
  });

  let runId = options.runId;
  if (runId) {
    await db.update(systemSchedulerRuns).set({
      status: 'running',
      startedAt,
      endedAt: null,
      durationMs: null,
      resultMessage: null,
      errorMessage: null,
      alertMessage: null,
      alertedAt: null,
      jobId: options.jobId ?? null,
      nodeId: schedulerNodeId,
      nodeHostname: schedulerNodeHostname,
      nodePid: schedulerNodePid,
      triggeredBy: options.triggeredBy ?? null,
    }).where(eq(systemSchedulerRuns.id, runId));
  } else {
    const [run] = await db.insert(systemSchedulerRuns).values({
      taskName: task.name,
      taskTitle: task.title,
      taskType: task.taskType,
      module: task.module,
      triggerType,
      status: 'running',
      startedAt,
      jobId: options.jobId ?? null,
      nodeId: schedulerNodeId,
      nodeHostname: schedulerNodeHostname,
      nodePid: schedulerNodePid,
      triggeredBy: options.triggeredBy ?? null,
    }).returning({ id: systemSchedulerRuns.id });
    runId = run.id;
  }

  try {
    const result = await fn();
    const endedAt = new Date();
    const durationMs = endedAt.getTime() - startedAt.getTime();
    const resultMessage = limitText(stringifyRunResult(result));
    await db.update(systemSchedulerRuns).set({
      status: 'success',
      endedAt,
      durationMs,
      resultMessage,
    }).where(eq(systemSchedulerRuns.id, runId));
    const alertMessage = await buildSystemTaskAlert(task.name, 'success', durationMs, resultMessage, policy);
    await updateSystemRunAlert(task, runId, alertMessage, policy);
    updateSystemTaskRunSnapshot(task.name, task.taskType, {
      lastRunAt: startedAtText,
      lastRunStatus: 'success',
      lastRunMessage: resultMessage,
      lastDurationMs: durationMs,
    });
    return resultMessage;
  } catch (err) {
    const endedAt = new Date();
    const durationMs = endedAt.getTime() - startedAt.getTime();
    const errorMessage = limitText(err instanceof Error ? err.message : String(err));
    await db.update(systemSchedulerRuns).set({
      status: 'failed',
      endedAt,
      durationMs,
      errorMessage,
    }).where(eq(systemSchedulerRuns.id, runId));
    const alertMessage = await buildSystemTaskAlert(task.name, 'failed', durationMs, errorMessage, policy);
    await updateSystemRunAlert(task, runId, alertMessage, policy);
    updateSystemTaskRunSnapshot(task.name, task.taskType, {
      lastRunAt: startedAtText,
      lastRunStatus: 'failed',
      lastRunMessage: errorMessage,
      lastDurationMs: durationMs,
    });
    logger.error(`System scheduler task "${task.name}" failed:`, err);
    throw err;
  }
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

handlerRegistry.set('publishScheduledAnnouncements', async () => {
  const { publishScheduledAnnouncements } = await import('../services/messaging/announcements.service');
  const count = await publishScheduledAnnouncements();
  return `自动发布了 ${count} 条定时公告`;
});

handlerRegistry.set('cleanupTerminalRecordings', async () => {
  const { cleanupRecordings } = await import('../services/ops/terminal-recordings.service');
  const r = await cleanupRecordings();
  return `清理终端录屏：按保留天数删除 ${r.deletedByAge} 条、按容量删除 ${r.deletedBySize} 条，释放约 ${(r.freedBytes / 1024 / 1024).toFixed(2)} MB`;
});

handlerRegistry.set('closeExpiredPaymentOrders', async () => {
  const { closeExpiredOrders } = await import('../services/payment/payment-reconciliation.service');
  const count = await closeExpiredOrders();
  return `关闭过期支付订单 ${count} 笔`;
});

handlerRegistry.set('paymentReconciliation', async () => {
  const { runReconciliation } = await import('../services/payment/payment-reconciliation.service');
  const r = await runReconciliation();
  return `支付对账完成：核对 ${r.checked} 笔，纠正 ${r.fixed} 笔`;
});

handlerRegistry.set('dispatchPaymentEvents', async () => {
  const { dispatchPendingPaymentEvents } = await import('../services/payment/payment-outbox.service');
  const count = await dispatchPendingPaymentEvents();
  return `补投支付事件 ${count} 条`;
});

handlerRegistry.set('retryPaymentWebhooks', async () => {
  const { retryPendingDeliveries } = await import('../services/payment/payment-webhook.service');
  const count = await retryPendingDeliveries();
  return `重试支付 Webhook 投递 ${count} 条`;
});

handlerRegistry.set('retryFailedSharing', async () => {
  const { retryFailedSharingOrders, syncProcessingSharingOrders } = await import('../services/payment/payment-sharing.service');
  const r = await retryFailedSharingOrders();
  const s = await syncProcessingSharingOrders();
  return `重试失败分账单 ${r.scanned} 条（成功 ${r.succeeded}），同步处理中分账单 ${s.scanned} 条（完结 ${s.finished}）`;
});

handlerRegistry.set('generateDailySettlements', async () => {
  const { generateDailySettlements } = await import('../services/payment/payment-settlement.service');
  const r = await generateDailySettlements();
  return `T+1 自动结算：生成 ${r.generated} 个批次，跳过 ${r.skipped} 个（已存在）`;
});

handlerRegistry.set('syncPaymentTransfers', async () => {
  const { syncProcessingTransfers } = await import('../services/payment/payment-transfer.service');
  const r = await syncProcessingTransfers();
  return `同步处理中转账单 ${r.scanned} 条，完结 ${r.finished} 条`;
});

handlerRegistry.set('autoPaymentRecon', async () => {
  const { autoReconcileYesterday } = await import('../services/payment/payment-recon.service');
  const r = await autoReconcileYesterday();
  return `自动对账：生成 ${r.generated} 个批次，跳过 ${r.skipped} 个`;
});

handlerRegistry.set('rebuildPaymentReportDaily', async (params) => {
  const { rebuildPaymentReportDaily } = await import('../services/payment/payment-report.service');
  const days = Number(params) || 2;
  const n = await rebuildPaymentReportDaily(days);
  return `重建支付报表日切快照 ${n} 条（近 ${days} 天）`;
});

handlerRegistry.set('analyticsRollupDaily', async (params) => {
  const { rebuildRollup } = await import('../services/analytics/analytics-rollup.service');
  const days = Number(params) || 2;
  const n = await rebuildRollup(days);
  return `重建每日聚合 ${n} 条`;
});

handlerRegistry.set('analyticsRetention', async () => {
  const { runAnalyticsRetention } = await import('../services/analytics/analytics-rollup.service');
  const r = await runAnalyticsRetention();
  return `数据保留清理：埋点 ${r.events} 条、会话 ${r.sessions} 条、错误 ${r.errors} 条`;
});

handlerRegistry.set('evaluateErrorAlerts', async () => {
  const { evaluateAlerts } = await import('../services/analytics/error-alert.service');
  const r = await evaluateAlerts();
  return `错误告警评估：规则 ${r.evaluated} 条，触发 ${r.triggered} 条`;
});

handlerRegistry.set('sampleSystemMetrics', async () => {
  const { persistMetricSample } = await import('../services/platform/monitor-history.service');
  const ok = await persistMetricSample();
  return ok ? '已记录系统指标采样' : '采样器未预热，跳过';
});

handlerRegistry.set('evaluateMonitorAlerts', async () => {
  const { evaluateMonitorAlerts } = await import('../services/platform/monitor-alert.service');
  const r = await evaluateMonitorAlerts();
  return `监控告警评估：规则 ${r.evaluated} 条，触发 ${r.fired} 条，恢复 ${r.resolved} 条`;
});

handlerRegistry.set('cleanupSystemMetrics', async (params) => {
  const { cleanupMetricSamples } = await import('../services/platform/monitor-history.service');
  const days = Number(params) || 7;
  const n = await cleanupMetricSamples(days);
  return `清理系统指标采样：删除 ${n} 条（保留 ${days} 天）`;
});

handlerRegistry.set('cleanupUploadSessions', async () => {
  const { cleanupStaleUploadSessions } = await import('../services/files/upload-sessions.service');
  const r = await cleanupStaleUploadSessions();
  return `清理分片上传：过期会话 ${r.staleSessions} 个、孤儿临时目录 ${r.orphanDirs} 个，释放约 ${(r.freedBytes / 1024 / 1024).toFixed(2)} MB`;
});

handlerRegistry.set('dispatchReportSubscriptions', async () => {
  const { dispatchDueSubscriptions } = await import('../services/report/report-subscription.service');
  const r = await dispatchDueSubscriptions();
  return `报表订阅分发：检查 ${r.checked} 个，推送 ${r.pushed} 个`;
});

handlerRegistry.set('refreshReportMaterializations', async () => {
  const { dispatchDueMaterializations } = await import('../services/report/report-dataset.service');
  const r = await dispatchDueMaterializations();
  return `报表物化刷新：检查 ${r.checked} 个，刷新 ${r.refreshed} 个`;
});

handlerRegistry.set('dispatchReportAlerts', async () => {
  const { dispatchDueAlerts } = await import('../services/report/report-alert.service');
  const r = await dispatchDueAlerts();
  return `报表预警分发：检查 ${r.checked} 个，触发 ${r.triggered} 个`;
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
  startSchedulerHeartbeat();

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
    if (schedulerHeartbeatTimer) {
      clearInterval(schedulerHeartbeatTimer);
      schedulerHeartbeatTimer = null;
    }
    await heartbeatSystemSchedulerNode(false).catch((err) => logger.warn('[system-scheduler] 节点离线标记失败', err));
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
  node: { id: string; hostname: string; pid: number };
  registeredHandlers: string[];
  systemRecurringJobs: SystemRecurringJobInfo[];
  systemQueueWorkers: SystemQueueWorkerInfo[];
  wip: Array<{ name: string; count: number }>;
} {
  const wip = boss?.getWipData().map((item) => ({ name: item.name, count: item.count })) ?? [];
  return {
    initialized: boss !== null,
    runningJobCount: wip.filter((item) => item.count > 0).reduce((sum, item) => sum + item.count, 0),
    node: { id: schedulerNodeId, hostname: schedulerNodeHostname, pid: schedulerNodePid },
    registeredHandlers: getRegisteredHandlers(),
    systemRecurringJobs: [...systemRecurringJobs.values()],
    systemQueueWorkers: [...systemQueueWorkers.values()],
    wip,
  };
}

export async function getSystemQueueMetrics(names: string[]): Promise<Record<string, SystemSchedulerQueueMetrics>> {
  const b = boss;
  const result: Record<string, SystemSchedulerQueueMetrics> = {};
  let stateRows: Array<{ name: string; state: string; count: number }> = [];
  if (names.length > 0) {
    try {
      const nameList = sql.join(names.map((name) => sql`${name}`), sql`, `);
      stateRows = await db.execute(sql`
        select name, state::text as state, count(*)::int as count
        from pgboss.job
        where name in (${nameList})
        group by name, state
      `) as unknown as Array<{ name: string; state: string; count: number }>;
    } catch (err) {
      logger.warn('pg-boss: failed to load queue state counts', err);
    }
  }
  const stateMap = new Map<string, Record<string, number>>();
  for (const row of stateRows) {
    const current = stateMap.get(row.name) ?? {};
    current[row.state] = Number(row.count) || 0;
    stateMap.set(row.name, current);
  }
  for (const name of names) {
    try {
      const stats = await b?.getQueueStats(name);
      const stateCounts = stateMap.get(name) ?? {};
      result[name] = {
        queuedCount: stats?.queuedCount ?? 0,
        activeCount: stats?.activeCount ?? 0,
        deferredCount: stats?.deferredCount ?? 0,
        totalCount: stats?.totalCount ?? 0,
        failedCount: stateCounts.failed ?? 0,
        completedCount: stateCounts.completed ?? 0,
        stateCounts,
      };
    } catch (err) {
      logger.warn(`pg-boss: failed to load queue stats for "${name}"`, err);
      const stateCounts = stateMap.get(name) ?? {};
      result[name] = {
        queuedCount: (stateCounts.created ?? 0) + (stateCounts.retry ?? 0),
        activeCount: stateCounts.active ?? 0,
        deferredCount: 0,
        totalCount: Object.values(stateCounts).reduce((sum, count) => sum + count, 0),
        failedCount: stateCounts.failed ?? 0,
        completedCount: stateCounts.completed ?? 0,
        stateCounts,
      };
    }
  }
  return result;
}

/**
 * 注册系统级周期任务（不写入 cron_jobs / cron_job_logs），用于启动时固定注册的内部调度。
 * 运行结果写入 system_scheduler_runs，并在系统调度页面统一展示。
 */
export async function registerSystemRecurringJob(registration: SystemRecurringJobRegistration): Promise<void> {
  const b = getBoss();
  const now = formatDateTime(new Date());
  const policy = normalizeSystemTaskPolicy(registration);
  await ensureSystemSchedulerTaskConfig(registration.name, policy);
  const runtimePolicy = await getRuntimeSystemTaskPolicy({ name: registration.name, ...policy });
  const info: SystemRecurringJobInfo = {
    name: registration.name,
    title: registration.title,
    module: registration.module,
    description: registration.description ?? null,
    taskType: 'recurring',
    cronExpression: registration.cronExpression,
    registeredAt: now,
    registeredNodeId: schedulerNodeId,
    registeredHostname: schedulerNodeHostname,
    registeredPid: schedulerNodePid,
    allowManualRun: registration.allowManualRun ?? false,
    ...runtimePolicy,
    lastRunAt: null,
    lastRunStatus: null,
    lastRunMessage: null,
    lastDurationMs: null,
  };

  await b.createQueue(registration.name, { retentionSeconds: 60 * 60 * 24 * 14, deleteAfterSeconds: 60 * 60 * 24 * 7 });
  await b.work<SystemRecurringJobPayload>(registration.name, async (jobs) => {
    for (const job of jobs) {
      const payload = job.data ?? {};
      const triggerType = payload.__systemSchedulerTrigger === 'manual' ? 'manual' : 'schedule';
      await executeSystemTask(info, triggerType, registration.run, {
        runId: payload.runId,
        triggeredBy: payload.triggeredBy ?? null,
        jobId: job.id,
      });
    }
  });
  systemRecurringJobs.set(registration.name, info);
  systemRecurringJobHandlers.set(registration.name, registration.run);
  if (runtimePolicy.enabled) {
    await b.schedule(registration.name, registration.cronExpression, { __systemSchedulerTrigger: 'schedule' } satisfies SystemRecurringJobPayload, { tz: 'Asia/Shanghai' });
    logger.info(`pg-boss: system recurring job "${registration.name}" scheduled (${registration.cronExpression})`);
  } else {
    await b.unschedule(registration.name).catch(() => undefined);
    logger.info(`pg-boss: system recurring job "${registration.name}" registered but disabled`);
  }
  await heartbeatSystemSchedulerNode(true).catch((err) => logger.warn('[system-scheduler] 节点心跳上报失败', err));
}

export async function runSystemRecurringJobNow(name: string, triggeredBy?: number | null): Promise<{ message: string; runId: number; jobId: string | null }> {
  const b = getBoss();
  const info = systemRecurringJobs.get(name);
  if (!info || !systemRecurringJobHandlers.has(name)) throw new Error('系统周期任务不存在或尚未注册');
  if (!info.allowManualRun) throw new Error('该系统周期任务不允许手动执行');
  const policy = await getRuntimeSystemTaskPolicy(info);
  if (!policy.enabled) throw new Error('该系统周期任务已停用');
  if (policy.manualSingleton) {
    const running = await db.$count(systemSchedulerRuns, and(eq(systemSchedulerRuns.taskName, name), eq(systemSchedulerRuns.status, 'running')));
    if (running > 0) throw new Error('该系统周期任务已有运行中的实例，请稍后再试');
  }

  const [run] = await db.insert(systemSchedulerRuns).values({
    taskName: info.name,
    taskTitle: info.title,
    taskType: info.taskType,
    module: info.module,
    triggerType: 'manual',
    status: 'running',
    startedAt: new Date(),
    resultMessage: '手动执行已投递，等待后台 worker 处理',
    nodeId: schedulerNodeId,
    nodeHostname: schedulerNodeHostname,
    nodePid: schedulerNodePid,
    triggeredBy: triggeredBy ?? null,
  }).returning({ id: systemSchedulerRuns.id });

  const jobId = await b.send(name, {
    __systemSchedulerTrigger: 'manual',
    runId: run.id,
    triggeredBy: triggeredBy ?? null,
  } satisfies SystemRecurringJobPayload, {
    retryLimit: 0,
    singletonKey: policy.manualSingleton ? `manual-${name}` : undefined,
    retentionSeconds: 60 * 60 * 24,
    deleteAfterSeconds: 60 * 60 * 24 * 7,
  });

  if (!jobId) {
    await db.update(systemSchedulerRuns).set({
      status: 'failed',
      endedAt: new Date(),
      durationMs: 0,
      errorMessage: '任务投递失败，请检查队列状态或稍后重试',
    }).where(eq(systemSchedulerRuns.id, run.id));
    throw new Error('任务投递失败，请检查队列状态或稍后重试');
  }

  await db.update(systemSchedulerRuns).set({ jobId }).where(eq(systemSchedulerRuns.id, run.id));
  return { message: `任务已投递后台执行，运行日志 #${run.id} 可跟踪结果`, runId: run.id, jobId };
}

export async function updateSystemTaskRuntimePolicy(name: string, policy: SystemSchedulerTaskPolicy): Promise<void> {
  const b = getBoss();
  const recurring = systemRecurringJobs.get(name);
  if (recurring) {
    updateRecurringJobInfoPolicy(name, policy);
    if (policy.enabled) {
      await b.schedule(name, recurring.cronExpression, { __systemSchedulerTrigger: 'schedule' } satisfies SystemRecurringJobPayload, { tz: 'Asia/Shanghai' });
    } else {
      await b.unschedule(name);
    }
    await heartbeatSystemSchedulerNode(true).catch((err) => logger.warn('[system-scheduler] 节点心跳上报失败', err));
    return;
  }
  if (systemQueueWorkers.has(name)) {
    updateQueueWorkerInfoPolicy(name, policy);
    await heartbeatSystemSchedulerNode(true).catch((err) => logger.warn('[system-scheduler] 节点心跳上报失败', err));
  }
}

export async function registerSystemQueueWorker<T extends object>(registration: SystemQueueWorkerRegistration<T>): Promise<void> {
  const b = getBoss();
  const now = formatDateTime(new Date());
  const policy = normalizeSystemTaskPolicy({
    enabled: true,
    logRetentionDays: registration.logRetentionDays,
    logRetentionRuns: registration.logRetentionRuns,
    timeoutMs: registration.timeoutMs,
    failureAlertThreshold: registration.failureAlertThreshold,
    alertEnabled: registration.alertEnabled,
    manualSingleton: false,
  });
  await ensureSystemSchedulerTaskConfig(registration.name, policy);
  const runtimePolicy = await getRuntimeSystemTaskPolicy({ name: registration.name, ...policy });
  const info: SystemQueueWorkerInfo = {
    name: registration.name,
    title: registration.title,
    module: registration.module,
    description: registration.description ?? null,
    taskType: 'queue',
    cronExpression: null,
    registeredNodeId: schedulerNodeId,
    registeredHostname: schedulerNodeHostname,
    registeredPid: schedulerNodePid,
    registeredAt: now,
    allowManualRun: false,
    ...runtimePolicy,
    enabled: true,
    manualSingleton: false,
    lastRunAt: null,
    lastRunStatus: null,
    lastRunMessage: null,
    lastDurationMs: null,
  };

  await b.createQueue(registration.name, registration.queueOptions);
  await b.work<T>(registration.name, async (jobs) => {
    for (const job of jobs) {
      await executeSystemTask(info, 'queue', () => registration.handler(job.data), { jobId: job.id });
    }
  });
  systemQueueWorkers.set(registration.name, info);
  logger.info(`pg-boss: system queue worker "${registration.name}" registered`);
  await heartbeatSystemSchedulerNode(true).catch((err) => logger.warn('[system-scheduler] 节点心跳上报失败', err));
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
