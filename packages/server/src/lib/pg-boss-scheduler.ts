/**
 * pg-boss 调度器
 * 基于 PostgreSQL SKIP LOCKED 实现精确一次执行和多进程安全。
 *
 * 用户可配置 Cron 与系统启动任务共用 pg-boss 执行，但日志与注册元数据分离。
 */
import { uniquePositiveInts } from '@zenith/shared/core';
import os from 'node:os';
import { PgBoss, type JobWithMetadata, type Queue, type QueueOptions, type SendOptions, type Warning } from 'pg-boss';
import { eq, and, gte, inArray, isNull, or, desc, notInArray, sql } from 'drizzle-orm';
import { db } from '../db';
import { cronJobs, cronJobLogs, dbBackups, systemSchedulerNodes, systemSchedulerRuns, systemSchedulerTaskConfigs, users } from '../db/schema';
import logger from './logger';
import { cleanExpiredCaptchas } from './captcha';
import { createPgDumpBackup, createDrizzleExportBackup } from './db-backup';
import { formatFileTimestamp, formatDateTime } from './datetime';
import { config } from '../config';
import { dispatchAlertChannels } from './alert-dispatch';
import type { SystemSchedulerAlertChannel } from '@zenith/shared/chat';
import type { CronRunStatus, CronRunTrigger, SystemSchedulerTaskBase, SystemSchedulerTaskType, SystemSchedulerRunStatus, SystemSchedulerTriggerType } from '@zenith/shared/platform';
import { CRON_HEALTH_RULES, SCHEDULER_WARNING_SEVERE_TYPES, schedulerWarningLabel, toMinuteCron } from '@zenith/shared/platform';
import { notify } from '../services/messaging/notification-outbox.service';

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
    await notify('ops.scheduler.job_failed', {
      recipients: [{ type: 'user', id: targetId }],
      vars: { jobName, errorMessage: message.slice(0, 200) },
      tenantId: null,
      // 历史行为是聊天卡片，收口后保持同一渠道，避免告警投递位置发生漂移
      channelPolicy: { only: ['chat'] },
      link: '/system/cron-jobs',
    });
  } catch (err) {
    logger.error('[cron] 失败告警卡片推送异常', err);
  }
}
import { CronExpressionParser } from 'cron-parser';

/** 业务定时任务的 Cron 求值时区（pg-boss 调度与统计侧的下次执行 / 漏跑判定共用） */
export const CRON_SCHEDULE_TZ = 'Asia/Shanghai';

// ─── pg-boss 实例（单例）─────────────────────────────────────────────────────

let boss: PgBoss | null = null;

/** pg-boss 运维警告（队列积压 / vacuum 受阻 / 索引膨胀等）的本进程环形缓冲，随心跳同步到节点表 */
export interface SchedulerWarningRecord {
  type: string;
  message: string;
  at: string;
}
const SCHEDULER_WARNINGS_LIMIT = 20;
const recentSchedulerWarnings: SchedulerWarningRecord[] = [];

function recordSchedulerWarning(warning: Warning): void {
  const data = (warning.data ?? {}) as { type?: unknown };
  const type = typeof data.type === 'string' ? data.type : 'unknown';
  const record: SchedulerWarningRecord = { type, message: warning.message, at: formatDateTime(new Date()) };
  // 同类同文案只保留最新一条，避免每个维护周期重复刷屏
  const existing = recentSchedulerWarnings.findIndex((w) => w.type === type && w.message === warning.message);
  if (existing >= 0) recentSchedulerWarnings.splice(existing, 1);
  recentSchedulerWarnings.unshift(record);
  if (recentSchedulerWarnings.length > SCHEDULER_WARNINGS_LIMIT) recentSchedulerWarnings.length = SCHEDULER_WARNINGS_LIMIT;
  const severe = (SCHEDULER_WARNING_SEVERE_TYPES as readonly string[]).includes(type);
  const log = severe ? logger.warn.bind(logger) : logger.info.bind(logger);
  log({ pgBossWarning: warning.data }, `pg-boss[${schedulerWarningLabel(type)}]: ${warning.message}`);
}

/** 本进程最近的 pg-boss 运维警告（新 → 旧） */
export function getRecentSchedulerWarnings(): SchedulerWarningRecord[] {
  return [...recentSchedulerWarnings];
}

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
  return uniquePositiveInts(value);
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

/** 按队列聚合 pg-boss WIP：localConcurrency > 1 时同一队列有多个轮询 worker，逐条上报只会重复 */
function getWipByQueue(): Array<{ name: string; count: number }> {
  if (!boss) return [];
  const byName = new Map<string, number>();
  for (const item of boss.getWipData()) byName.set(item.name, (byName.get(item.name) ?? 0) + item.count);
  return [...byName].map(([name, count]) => ({ name, count }));
}

async function heartbeatSystemSchedulerNode(active = true): Promise<void> {
  const now = new Date();
  const metadata = {
    wip: getWipByQueue(),
    warnings: getRecentSchedulerWarnings(),
    health: schedulerHealth,
  };
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
    metadata,
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
      metadata,
      updatedAt: now,
    },
  });
}

const SCHEDULER_HEALTH_REFRESH_MS = 10 * 60_000;
let schedulerHealthCheckedAtMs = 0;

function startSchedulerHeartbeat(): void {
  if (schedulerHeartbeatTimer) return;
  void heartbeatSystemSchedulerNode(true).catch((err) => logger.warn('[system-scheduler] 节点心跳上报失败', err));
  schedulerHeartbeatTimer = setInterval(() => {
    // schema 漂移 / 版本检查只查 catalog，代价很小，随心跳每 10 分钟复检一次
    if (boss && Date.now() - schedulerHealthCheckedAtMs >= SCHEDULER_HEALTH_REFRESH_MS) {
      void refreshSchedulerHealth().catch((err) => logger.warn('pg-boss: schema 健康检查失败', err));
    }
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
  const channels = policy.alertChannels;
  const now = formatDateTime(new Date());
  const html = `<h3>系统调度告警</h3><p><b>任务：</b>${task.title} (${task.name})</p><p><b>模块：</b>${task.module}</p><p><b>运行日志：</b>#${runId}</p><p><b>详情：</b>${alertMessage}</p><p><b>发生时间：</b>${now}</p>`;

  // 策略里的 inapp 历史上投递的是系统号聊天卡片而非站内信，此处保持不变；
  // 返回值仍用策略侧的 inapp 命名，避免调度详情页的渠道标签发生漂移
  const dispatchChannels: string[] = [];
  if (channels.includes('inapp')) dispatchChannels.push('chat');
  if (channels.includes('email') && policy.alertEmails.length > 0) dispatchChannels.push('email');
  if (channels.includes('webhook') && policy.alertWebhookUrl) dispatchChannels.push('webhook');
  if (dispatchChannels.length === 0) return [];

  const alertUserIds = channels.includes('inapp')
    ? (policy.alertUserIds.length > 0 ? policy.alertUserIds : await defaultSystemAlertUserIds())
    : [];

  const result = await dispatchAlertChannels(
    {
      channels: dispatchChannels,
      webhookUrl: policy.alertWebhookUrl,
      recipientUserIds: alertUserIds,
      recipientEmails: policy.alertEmails,
      tenantId: null,
    },
    {
      eventKey: 'ops.scheduler.task_alert',
      vars: {
        taskTitle: task.title,
        taskName: task.name,
        module: task.module,
        runId,
        alertMessage,
      },
      html,
      inAppType: 'error',
      webhookBody: {
        type: 'system_scheduler_alert',
        taskName: task.name,
        taskTitle: task.title,
        module: task.module,
        runId,
        message: alertMessage,
        timestamp: now,
      },
      logTag: 'SystemSchedulerAlert',
    },
  );

  const failedChannels = new Set(
    (result.error ?? '').split('；').map((item) => item.split(':')[0].trim()).filter(Boolean),
  );
  const sentChannels: SystemSchedulerAlertChannel[] = [];
  if (dispatchChannels.includes('chat') && !failedChannels.has('chat')) sentChannels.push('inapp');
  if (dispatchChannels.includes('email') && !failedChannels.has('email')) sentChannels.push('email');
  if (dispatchChannels.includes('webhook') && !failedChannels.has('webhook')) sentChannels.push('webhook');
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

handlerRegistry.set('finalizeStaleReplays', async () => {
  const { finalizeStaleReplays } = await import('../services/analytics/session-replays.service');
  const count = await finalizeStaleReplays();
  return `收尾闲置回放会话 ${count} 个`;
});

handlerRegistry.set('sslCertificateInspection', async () => {
  const { inspectExpiringSslCertificates } = await import('../services/ops/ssl-certificates.service');
  const r = await inspectExpiringSslCertificates();
  return `SSL 证书巡检：即将过期 ${r.expiring} 张、已过期 ${r.expired} 张${r.notified ? '，已通知管理员' : ''}`;
});

handlerRegistry.set('probeOpsHosts', async () => {
  const { probeAllOpsHosts } = await import('../services/ops/hosts.service');
  const r = await probeAllOpsHosts();
  return `运维主机探测：共 ${r.total} 台，在线 ${r.online}、离线 ${r.offline}`;
});

handlerRegistry.set('closeExpiredPaymentOrders', async () => {
  const { closeExpiredOrders } = await import('../services/payment/payment-reconciliation.service');
  const count = await closeExpiredOrders();
  return `关闭过期支付订单 ${count} 笔`;
});

handlerRegistry.set('executeDueDeductions', async () => {
  const { executeDueDeductions } = await import('../services/payment/payment-contract.service');
  const count = await executeDueDeductions();
  return `执行到期代扣 ${count} 笔`;
});

handlerRegistry.set('syncPaymentDisputes', async () => {
  const { syncPaymentDisputes } = await import('../services/payment/payment-dispute.service');
  const count = await syncPaymentDisputes();
  return `同步渠道投诉 ${count} 条`;
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

handlerRegistry.set('dispatchNotifications', async () => {
  const { dispatchPendingNotifications } = await import('../services/messaging/notification-outbox.service');
  const count = await dispatchPendingNotifications();
  return `补投通知事件 ${count} 条`;
});

handlerRegistry.set('aggregateNotificationDigests', async () => {
  const { aggregateNotificationDigests } = await import('../services/messaging/notification-outbox.service');
  const r = await aggregateNotificationDigests();
  return `聚合通知摘要 ${r.groups} 组（${r.items} 条）`;
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

handlerRegistry.set('analyticsRollupDaily', async (params) => {
  const { rebuildRollup } = await import('../services/analytics/analytics-rollup.service');
  const days = Number(params) || 2;
  const n = await rebuildRollup(days);
  return `重建每日聚合 ${n} 条`;
});

handlerRegistry.set('analyticsSegmentRefresh', async () => {
  const { refreshAllSegments } = await import('../services/analytics/analytics-segments.service');
  const r = await refreshAllSegments();
  return `分群定时刷新：共 ${r.total} 个，成功 ${r.succeeded} 个，失败 ${r.failed} 个`;
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
  /** 投递来源；缺省视为计划触发（兼容升级前已入队的任务） */
  trigger?: CronRunTrigger;
  /** 手动执行的操作人 */
  triggeredBy?: number | null;
}

type CronJobWithMetadata = JobWithMetadata<JobData>;

/** 执行结果落库：日志行 + 任务最近状态一次写完 */
async function settleCronRun(
  logId: number,
  jobId: number,
  startedAt: Date,
  status: Extract<CronRunStatus, 'success' | 'fail' | 'timeout'>,
  message: string,
): Promise<void> {
  const endedAt = new Date();
  const durationMs = endedAt.getTime() - startedAt.getTime();
  const isSuccess = status === 'success';
  await Promise.all([
    db.update(cronJobs).set({ lastRunStatus: status, lastRunMessage: message.slice(0, 1024) }).where(eq(cronJobs.id, jobId)),
    db.update(cronJobLogs).set({
      endedAt,
      durationMs,
      status,
      output: isSuccess ? message.slice(0, 2048) : null,
      errorMessage: isSuccess ? null : message.slice(0, 2048),
    }).where(eq(cronJobLogs.id, logId)),
  ]);
}

/** 按 monitorTimeout（秒）给 handler 计时；超时时先落库再抛错，handler 本身无法被打断 */
function raceWithTimeout<T>(promise: Promise<T>, timeoutSeconds: number | null): Promise<T> {
  if (!timeoutSeconds || timeoutSeconds <= 0) return promise;
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new CronRunTimeoutError(timeoutSeconds)), timeoutSeconds * 1000);
    timer.unref?.();
    promise.then(
      (value) => { clearTimeout(timer); resolve(value); },
      (err: unknown) => { clearTimeout(timer); reject(err instanceof Error ? err : new Error(String(err))); },
    );
  });
}

class CronRunTimeoutError extends Error {
  constructor(readonly timeoutSeconds: number) {
    super(`执行超过 ${timeoutSeconds} 秒仍未完成，已按超时处理`);
    this.name = 'CronRunTimeoutError';
  }
}

/** 单条业务定时任务队列上执行一条作业（jobs 数组按 batchSize=1 只有一项） */
async function runCronJob(jobs: CronJobWithMetadata[]): Promise<void> {
  const job = jobs[0];
  const { handlerName, params, jobId } = job.data;
  const fn = handlerRegistry.get(handlerName);
  const startedAt = new Date();
  // 重试由 pg-boss 发起，此时 retryCount > 0；首次执行按投递方声明的来源记录
  const attempt = job.retryCount ?? 0;
  const trigger: CronRunTrigger = attempt > 0 ? 'retry' : (job.data.trigger ?? 'schedule');
  const scheduledAt = job.startAfter ?? job.createdOn ?? null;
  const runContext = {
    trigger,
    attempt,
    scheduledAt,
    nodeId: schedulerNodeId,
    triggeredBy: job.data.triggeredBy ?? null,
  };

  const [jobRow] = await db.select({ name: cronJobs.name, monitorTimeout: cronJobs.monitorTimeout })
    .from(cronJobs).where(eq(cronJobs.id, jobId)).limit(1);
  const jobName = jobRow?.name ?? `job_${jobId}`;
  const executionCount = await db.$count(cronJobLogs, eq(cronJobLogs.jobId, jobId)) + 1;

  if (!fn) {
    const msg = `Handler "${handlerName}" not found`;
    await Promise.all([
      db.update(cronJobs).set({ lastRunAt: startedAt, lastRunStatus: 'fail', lastRunMessage: msg }).where(eq(cronJobs.id, jobId)),
      db.insert(cronJobLogs).values({
        jobId, jobName, executionCount, startedAt, endedAt: new Date(), durationMs: 0, status: 'fail', errorMessage: msg, ...runContext,
      }),
    ]);
    void pushCronFailureAlert(jobId, jobName, msg);
    throw new Error(msg);
  }

  const [logRow] = await db.insert(cronJobLogs).values({
    jobId, jobName, executionCount, startedAt, status: 'running', ...runContext,
  }).returning();
  await db.update(cronJobs).set({ lastRunAt: startedAt, lastRunStatus: 'running', lastRunMessage: null }).where(eq(cronJobs.id, jobId));

  // 超时后 handler 仍在后台运行，迟到的结果只记日志、不再回写，避免把 timeout 覆盖成 success
  const execution = fn(params);
  let resultMessage: string;
  try {
    resultMessage = await raceWithTimeout(execution, jobRow?.monitorTimeout ?? null);
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    const status = err instanceof CronRunTimeoutError ? 'timeout' : 'fail';
    await settleCronRun(logRow.id, jobId, startedAt, status, errorMessage);
    if (status === 'timeout') {
      execution.then(
        () => logger.warn(`Cron job ${jobId} (${jobName}) finished after timeout was recorded`),
        (lateErr: unknown) => logger.warn(`Cron job ${jobId} (${jobName}) failed after timeout was recorded:`, lateErr),
      );
    }
    logger.error(`Cron job ${jobId} (${jobName}) ${status}:`, err);
    void pushCronFailureAlert(jobId, jobName, errorMessage);
    throw err;
  }
  await settleCronRun(logRow.id, jobId, startedAt, 'success', resultMessage);
}

// ─── 业务定时任务队列：一条队列 + 按任务 key 的 schedule ─────────────────────────
// pg-boss 的 work() 每调用一次就多一个轮询 worker，且队列参数只在建队列时生效。
// 因此所有业务定时任务共用一条队列，每个进程只注册一次 worker（localConcurrency 决定并发），
// 每个任务是该队列上的一条 keyed schedule；stately 策略 + singletonKey=jobId 保证同一任务
// 最多「1 条排队 + 1 条执行中」：不重叠执行，执行超过周期时也只补跑一次而不是无限积压。

export const CRON_JOBS_QUEUE = 'cron-jobs';
const CRON_QUEUE_POLICY = 'stately';
const CRON_WORKER_LOCAL_CONCURRENCY = 8;
/** 旧版「每任务一条队列」的命名，启动对账时清理 */
const LEGACY_CRON_QUEUE_PATTERN = /^cron-job-\d+$/;
/** worker 崩溃后多久判定该次执行失联并交给 pg-boss 重试（文档建议 ≥ monitorIntervalSeconds） */
const CRON_QUEUE_HEARTBEAT_SECONDS = 60;
const CRON_QUEUE_OPTIONS: Omit<Queue, 'name' | 'policy' | 'partition' | 'deadLetter'> = {
  heartbeatSeconds: CRON_QUEUE_HEARTBEAT_SECONDS,
  // 排队作业最多保留 7 天；执行记录以 cron_job_logs 为准，pg-boss 侧完成的作业 1 天后清理以保持 job 表精简
  retentionSeconds: 60 * 60 * 24 * 7,
  deleteAfterSeconds: 60 * 60 * 24,
  warningQueueSize: 200,
};

let cronWorkerId: string | null = null;
let cronQueueEnsured = false;

function cronScheduleKey(jobId: number): string {
  return String(jobId);
}

/** 任务自身的重试 / 超时配置显式下发到每条作业，不再依赖队列默认值（默认会重试 2 次、15 分钟过期） */
function cronJobSendOptions(job: Pick<typeof cronJobs.$inferSelect, 'id' | 'retryCount' | 'retryInterval' | 'retryBackoff' | 'monitorTimeout'>): SendOptions {
  return {
    singletonKey: cronScheduleKey(job.id),
    retryLimit: Math.max(job.retryCount, 0),
    retryDelay: Math.max(job.retryInterval, 0),
    retryBackoff: job.retryBackoff,
    // 超时由 worker 内的 monitorTimeout 计时器判定并记为 timeout；pg-boss 自己的过期只作兜底，
    // 比 monitorTimeout 多留 30 秒以免抢先把作业判失败。未配置超时的任务给到上限（1 ≤ expireInSeconds ≤ 86400），
    // 否则 15 分钟默认过期会把仍在正常执行的作业判死、释放 stately 锁而导致重叠执行；进程崩溃由队列心跳兜底。
    expireInSeconds: job.monitorTimeout ? Math.min(Math.max(job.monitorTimeout, 1) + 30, 86_400) : 86_400,
  };
}

function cronJobPayload(job: Pick<typeof cronJobs.$inferSelect, 'id' | 'handler' | 'params'>, trigger: CronRunTrigger, triggeredBy: number | null = null): JobData {
  return { handlerName: job.handler, params: job.params, jobId: job.id, trigger, triggeredBy };
}

async function ensureCronQueue(): Promise<void> {
  if (cronQueueEnsured) return;
  const b = getBoss();
  // policy 建队后不可修改：策略不一致时重建（排队中的作业由 schedule 在下一个周期重新产生）
  const existing = await b.getQueue(CRON_JOBS_QUEUE);
  if (existing && existing.policy !== CRON_QUEUE_POLICY) {
    logger.warn(`pg-boss: 队列 ${CRON_JOBS_QUEUE} 策略为 ${existing.policy}，按代码要求重建为 ${CRON_QUEUE_POLICY}`);
    await b.deleteQueue(CRON_JOBS_QUEUE);
  }
  await b.createQueue(CRON_JOBS_QUEUE, { policy: CRON_QUEUE_POLICY, ...CRON_QUEUE_OPTIONS });
  // createQueue 对已存在的队列不更新参数，心跳 / 保留期等以代码为准同步一次
  await b.updateQueue(CRON_JOBS_QUEUE, CRON_QUEUE_OPTIONS);
  cronQueueEnsured = true;
}

async function ensureCronWorker(): Promise<string> {
  if (cronWorkerId) return cronWorkerId;
  const b = getBoss();
  cronWorkerId = await b.work<JobData, void, { includeMetadata: true; localConcurrency: number }>(
    CRON_JOBS_QUEUE,
    { includeMetadata: true, localConcurrency: CRON_WORKER_LOCAL_CONCURRENCY },
    runCronJob,
  );
  return cronWorkerId;
}

/**
 * 启动期对账：上一进程在执行中崩溃 / 重启时留下的 `running` 记录永远不会被收尾，
 * 会让「运行中」长期虚高并误报运行超时。把不属于任何在线节点的运行中记录标为失败。
 * 本节点在此之前已上报心跳，因此自己刚写入的记录不会被误伤。
 */
async function closeOrphanRunningLogs(): Promise<void> {
  const staleBefore = new Date(Date.now() - CRON_HEALTH_RULES.schedulerHeartbeatStaleMs);
  const activeNodeIds = (await db.select({ nodeId: systemSchedulerNodes.nodeId })
    .from(systemSchedulerNodes)
    .where(and(eq(systemSchedulerNodes.active, true), gte(systemSchedulerNodes.lastHeartbeatAt, staleBefore))))
    .map((r) => r.nodeId);
  // notInArray([]) 求值为 true，会把全部运行中记录关掉；无在线节点时只处理无归属的旧记录
  const orphanCondition = activeNodeIds.length > 0
    ? or(isNull(cronJobLogs.nodeId), notInArray(cronJobLogs.nodeId, activeNodeIds))
    : isNull(cronJobLogs.nodeId);
  const closed = await db.update(cronJobLogs)
    .set({
      status: 'fail',
      endedAt: sql`now()`,
      // 真实执行时长未知（进程何时消失无从得知），保持 null 以免拉高耗时均值
      durationMs: null,
      errorMessage: '调度节点重启，执行被中断',
    })
    .where(and(eq(cronJobLogs.status, 'running'), orphanCondition))
    .returning({ id: cronJobLogs.id, jobId: cronJobLogs.jobId });
  if (closed.length === 0) return;
  // 任务表的最近状态若仍停在 running，同样收尾（只改被关闭记录对应的任务）
  const jobIds = [...new Set(closed.map((r) => r.jobId))];
  await db.update(cronJobs)
    .set({ lastRunStatus: 'fail', lastRunMessage: '调度节点重启，执行被中断' })
    .where(and(inArray(cronJobs.id, jobIds), eq(cronJobs.lastRunStatus, 'running')));
  logger.warn(`pg-boss: 已关闭 ${closed.length} 条无归属节点的运行中执行记录`);
}

/** 旧版每任务一条队列（cron-job-{id}）：连同其 schedule 与作业一起删除，执行历史在 cron_job_logs 不受影响 */
async function purgeLegacyCronQueues(): Promise<void> {
  const b = getBoss();
  const queues = await b.getQueues();
  const legacy = queues.filter((q) => LEGACY_CRON_QUEUE_PATTERN.test(q.name));
  for (const queue of legacy) {
    await b.unschedule(queue.name).catch(() => undefined);
    await b.offWork(queue.name, { wait: false }).catch(() => undefined);
    await b.deleteQueue(queue.name);
  }
  if (legacy.length > 0) logger.warn(`pg-boss: 已删除 ${legacy.length} 条旧版每任务队列（cron-job-*），业务定时任务统一到队列 ${CRON_JOBS_QUEUE}`);
}

export interface CronScheduleReconcileResult {
  /** 启用中却没有 schedule 的任务 ID */
  missing: number[];
  /** 有 schedule 但任务已停用 / 不存在的 key */
  orphans: string[];
}

/** 对账 pg-boss schedule 与 cron_jobs：启用任务必须各有一条 keyed schedule，多余的 schedule 删除 */
async function reconcileCronSchedules(enabledJobs: Array<typeof cronJobs.$inferSelect>): Promise<CronScheduleReconcileResult> {
  const b = getBoss();
  const schedules = await b.getSchedules(CRON_JOBS_QUEUE);
  const desired = new Map(enabledJobs.map((job) => [cronScheduleKey(job.id), job]));
  const orphans = schedules.map((s) => s.key ?? '').filter((key) => !desired.has(key));
  for (const key of orphans) {
    await b.unschedule(CRON_JOBS_QUEUE, key || undefined).catch((err) => logger.warn(`pg-boss: 删除孤儿 schedule ${key} 失败`, err));
  }
  for (const job of enabledJobs) {
    await _scheduleOne(job);
  }
  return { missing: [], orphans };
}

/** 只读对账（供健康状态查询）：不修改任何 schedule */
export async function inspectCronSchedules(): Promise<CronScheduleReconcileResult> {
  if (!boss) return { missing: [], orphans: [] };
  const [schedules, enabledJobs] = await Promise.all([
    boss.getSchedules(CRON_JOBS_QUEUE),
    db.select({ id: cronJobs.id }).from(cronJobs).where(eq(cronJobs.status, 'enabled')),
  ]);
  const scheduled = new Set(schedules.map((s) => s.key ?? ''));
  const enabled = new Set(enabledJobs.map((j) => cronScheduleKey(j.id)));
  return {
    missing: enabledJobs.filter((j) => !scheduled.has(cronScheduleKey(j.id))).map((j) => j.id),
    orphans: [...scheduled].filter((key) => !enabled.has(key)),
  };
}

// ─── pg-boss 自身健康：schema 版本 / 漂移 / 异步迁移 ─────────────────────────────

export interface SchedulerHealthSnapshot {
  schemaVersion: number | null;
  schemaDriftOk: boolean | null;
  schemaDriftIssues: number;
  checkedAt: string | null;
}

let schedulerHealth: SchedulerHealthSnapshot = { schemaVersion: null, schemaDriftOk: null, schemaDriftIssues: 0, checkedAt: null };

/** 读取 schema 版本并做一次 catalog 级漂移检查（无锁、无表扫描）；结果缓存供状态接口读取 */
async function refreshSchedulerHealth(): Promise<void> {
  const b = getBoss();
  schedulerHealthCheckedAtMs = Date.now();
  const schemaVersion = await b.schemaVersion();
  const drift = await b.detectSchemaDrift();
  const issues = drift.missingTables.length + drift.missing.length + drift.invalid.length + drift.mismatched.length
    + drift.missingFunctions.length + drift.mismatchedFunctions.length + drift.columnDrift.length + drift.constraintDrift.length
    + (drift.enumDrift ? 1 : 0);
  schedulerHealth = { schemaVersion, schemaDriftOk: drift.ok, schemaDriftIssues: issues, checkedAt: formatDateTime(new Date()) };
  if (!drift.ok) {
    const summary = [
      drift.missingTables.length ? `缺表 ${drift.missingTables.join('、')}` : '',
      drift.missing.length ? `缺索引 ${drift.missing.map((i) => i.name).join('、')}` : '',
      drift.invalid.length ? `无效索引 ${drift.invalid.map((i) => i.name).join('、')}` : '',
      drift.mismatched.length ? `索引定义不一致 ${drift.mismatched.map((i) => i.name).join('、')}` : '',
      drift.missingFunctions.length || drift.mismatchedFunctions.length ? `函数漂移 ${drift.missingFunctions.length + drift.mismatchedFunctions.length} 个` : '',
      drift.columnDrift.length ? `列漂移 ${drift.columnDrift.map((c) => c.table).join('、')}` : '',
      drift.constraintDrift.length ? `约束漂移 ${drift.constraintDrift.map((c) => c.table).join('、')}` : '',
      drift.enumDrift ? 'job_state 枚举漂移' : '',
    ].filter(Boolean).join('；');
    recordSchedulerWarning({ message: `pg-boss schema v${schemaVersion} 存在漂移：${summary}（运行 npx pg-boss doctor 查看修复语句）`, data: { type: 'schema_drift', issues } });
  } else {
    logger.info(`pg-boss: schema v${schemaVersion}，漂移检查通过`);
  }
}

export function getSchedulerHealth(): SchedulerHealthSnapshot {
  return schedulerHealth;
}

/** 异步迁移（BAM）状态：pending / in_progress / failed 计数 */
export async function getSchedulerBamSummary(): Promise<{ pending: number; failed: number }> {
  if (!boss) return { pending: 0, failed: 0 };
  const rows = await boss.getBamStatus();
  const count = (status: string) => rows.filter((r) => r.status === status).reduce((sum, r) => sum + r.count, 0);
  return { pending: count('pending') + count('in_progress'), failed: count('failed') };
}

export function isSchedulerMaintaining(): boolean {
  return boss?.isMaintaining() ?? false;
}

// ─── 公开 API ────────────────────────────────────────────────────────────────

export async function initCronScheduler(): Promise<void> {
  boss = new PgBoss({
    connectionString: config.databaseUrl,
    schema: 'pgboss',
    supervise: true,
    superviseIntervalSeconds: 30,
    // 运维警告落到 pgboss 自己的表里保留 7 天，多实例可回溯；实时信号仍走 warning 事件
    persistWarnings: true,
    warningRetentionDays: 7,
  });

  boss.on('error', (err: unknown) => logger.error('pg-boss error:', err));
  // warning 事件没有监听者时会被静默丢弃：队列积压、vacuum 受阻、索引膨胀等都在这里上报
  boss.on('warning', recordSchedulerWarning);
  // 异步索引迁移（BAM）进度：失败进警告缓冲，其余记日志
  boss.on('bam', (event) => {
    if (event.status === 'failed') {
      recordSchedulerWarning({ message: `异步迁移 ${event.name}（${event.table}）失败：${event.error ?? '未知错误'}`, data: { type: 'bam_failed', ...event } });
    } else {
      logger.info(`pg-boss BAM ${event.name} ${event.status}${event.table ? ` (${event.table})` : ''}`);
    }
  });

  logger.info('pg-boss: starting...');
  await boss.start();
  logger.info('pg-boss started');
  startSchedulerHeartbeat();
  await refreshSchedulerHealth().catch((err) => logger.warn('pg-boss: schema 健康检查失败', err));

  await purgeOrphanCronJobs();
  await closeOrphanRunningLogs().catch((err) => logger.warn('pg-boss: 关闭无归属运行中记录失败', err));
  await purgeLegacyCronQueues().catch((err) => logger.warn('pg-boss: 清理旧版每任务队列失败', err));

  await ensureCronQueue();
  await ensureCronWorker();
  const jobs = await db.select().from(cronJobs).where(eq(cronJobs.status, 'enabled'));
  const reconciled = await reconcileCronSchedules(jobs);
  logger.info(`pg-boss: ${jobs.length} enabled job(s) scheduled on ${CRON_JOBS_QUEUE}`
    + (reconciled.orphans.length ? `，清理孤儿 schedule ${reconciled.orphans.length} 条` : ''));
}

/**
 * 清理 handler 已从代码中移除的业务定时任务。
 *
 * 这类任务留在库里会按 cron 持续触发，每次都以 `Handler "xxx" not found` 失败并推送告警。
 * 启动时对账删除，保证「代码里的 handler 注册表」是任务存在与否的唯一依据。
 */
async function purgeOrphanCronJobs(): Promise<void> {
  const known = [...handlerRegistry.keys()];
  // 注册表为空说明 handler 模块尚未加载完成，此时对账会误删全部任务
  if (known.length === 0) return;
  const orphans = await db.delete(cronJobs)
    .where(notInArray(cronJobs.handler, known))
    .returning({ id: cronJobs.id, name: cronJobs.name, handler: cronJobs.handler });
  if (orphans.length === 0) return;
  for (const job of orphans) {
    await getBoss().unschedule(CRON_JOBS_QUEUE, cronScheduleKey(job.id)).catch(() => undefined);
  }
  logger.warn(
    `pg-boss: 已清理 ${orphans.length} 个 handler 失效的定时任务：`
    + orphans.map((job) => `${job.name}(${job.handler})`).join('、'),
  );
}

async function _scheduleOne(job: typeof cronJobs.$inferSelect): Promise<boolean> {
  const b = getBoss();
  // 同名 key 的 schedule 已存在时 pg-boss 直接更新表达式与选项
  await b.schedule(CRON_JOBS_QUEUE, toMinuteCron(job.cronExpression), cronJobPayload(job, 'schedule'), {
    tz: CRON_SCHEDULE_TZ,
    key: cronScheduleKey(job.id),
    ...cronJobSendOptions(job),
  });
  return true;
}

/** 注册 / 更新一个任务的 schedule（任务保存或启用时调用） */
export async function scheduleJob(job: typeof cronJobs.$inferSelect): Promise<boolean> {
  await ensureCronQueue();
  await ensureCronWorker();
  return _scheduleOne(job);
}

/** 停用 / 删除任务：删掉 schedule，并取消该任务尚未开始的排队作业 */
export async function stopJob(jobId: number): Promise<void> {
  try {
    const b = getBoss();
    await b.unschedule(CRON_JOBS_QUEUE, cronScheduleKey(jobId));
    const queued = await b.findJobs(CRON_JOBS_QUEUE, { key: cronScheduleKey(jobId), queued: true });
    if (queued.length > 0) await b.cancel(CRON_JOBS_QUEUE, queued.map((j) => j.id));
  } catch (err) {
    logger.warn(`pg-boss: failed to unschedule job ${jobId}:`, err);
  }
}

export async function runJobOnce(jobId: number, triggeredBy: number | null = null): Promise<{ success: boolean; message: string }> {
  const [job] = await db.select().from(cronJobs).where(eq(cronJobs.id, jobId)).limit(1);
  if (!job) return { success: false, message: '任务不存在' };

  const b = getBoss();
  await ensureCronQueue();
  const workerId = await ensureCronWorker();

  const logsBefore = await db.$count(cronJobLogs, eq(cronJobLogs.jobId, jobId));
  const sentId = await b.send(CRON_JOBS_QUEUE, cronJobPayload(job, 'manual', triggeredBy), cronJobSendOptions(job));
  // stately 策略下同一任务已有一条排队作业时插入被吞掉（返回 null），本次触发与之合并
  if (!sentId) {
    return { success: true, message: '该任务已有一次待执行的作业，本次手动触发已与其合并' };
  }
  // 跳过本轮轮询间隔，让 worker 立刻去取
  b.notifyWorker(workerId);

  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    const logsNow = await db.$count(cronJobLogs, eq(cronJobLogs.jobId, jobId));
    if (logsNow > logsBefore) {
      const [latestLog] = await db.select()
        .from(cronJobLogs)
        .where(eq(cronJobLogs.jobId, jobId))
        .orderBy(desc(cronJobLogs.id))
        .limit(1);
      if (latestLog && latestLog.status !== 'running') {
        return { success: latestLog.status === 'success', message: latestLog.output ?? latestLog.errorMessage ?? '' };
      }
    }
    await new Promise<void>((r) => setTimeout(r, 500));
  }

  return { success: true, message: '任务已投递，正在后台执行（同一任务不重叠执行，可能在排队）' };
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
    cronWorkerId = null;
    cronQueueEnsured = false;
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
  warnings: SchedulerWarningRecord[];
} {
  const wip = getWipByQueue();
  return {
    initialized: boss !== null,
    runningJobCount: wip.filter((item) => item.count > 0).reduce((sum, item) => sum + item.count, 0),
    node: { id: schedulerNodeId, hostname: schedulerNodeHostname, pid: schedulerNodePid },
    registeredHandlers: getRegisteredHandlers(),
    systemRecurringJobs: [...systemRecurringJobs.values()],
    systemQueueWorkers: [...systemQueueWorkers.values()],
    wip,
    warnings: getRecentSchedulerWarnings(),
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
      // pg-boss v12.26 起 getQueueStats 返回快照序列（按 capturedOn 倒序），
      // 未开启 persistQueueStats 时为单元素数组，取首项即当前读数。
      const stats = (await b?.getQueueStats(name))?.at(0);
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

/**
 * 清理代码中已移除的系统周期任务。
 *
 * 残留的 pg-boss 调度会继续投递作业但无 worker 承接，同时配置行会在「系统调度」
 * 页面上显示为幽灵任务。全部系统任务注册完成后调用一次即可。
 */
export async function purgeOrphanSystemTasks(): Promise<void> {
  const known = [...systemRecurringJobs.keys(), ...systemQueueWorkers.keys()];
  // 一个任务都没注册说明注册流程异常中断，此时对账会误删全部配置
  if (known.length === 0) return;
  const orphans = await db.delete(systemSchedulerTaskConfigs)
    .where(notInArray(systemSchedulerTaskConfigs.taskName, known))
    .returning({ taskName: systemSchedulerTaskConfigs.taskName });
  if (orphans.length === 0) return;
  const b = getBoss();
  for (const task of orphans) {
    await b.unschedule(task.taskName).catch(() => undefined);
  }
  await db.delete(systemSchedulerRuns).where(notInArray(systemSchedulerRuns.taskName, known));
  logger.warn(
    `[system-scheduler] 已清理 ${orphans.length} 个代码中已移除的系统任务：`
    + orphans.map((task) => task.taskName).join('、'),
  );
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
