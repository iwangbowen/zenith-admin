/**
 * pg-boss 调度器
 * 基于 PostgreSQL SKIP LOCKED 实现精确一次执行和多进程安全。
 *
 * 用户可配置 Cron 与系统启动任务共用 pg-boss 执行，但日志与注册元数据分离。
 *
 * ─── 进程角色（config.roles）────────────────────────────────────────────────
 * 「声明」与「执行」在此分离，调用方（bootstrap / 各业务模块的 register*）不感知角色：
 * - 声明：注册表元数据、任务策略落库、createQueue / updateQueue、schedule / unschedule 写入。
 *   每个角色都做——api 要能校验任务类型、投递作业、在后台改启停、展示执行概览。
 * - 执行：work()（轮询领取作业）、pg-boss 的 supervise / cron monitor、孤儿清理与队列对账。
 *   只有 worker 角色做。api 角色的 boss 是「只发不执行」实例（supervise / schedule 关闭、小连接池）。
 * 例外：`forceLocal` 的系统队列 worker（节点亲和的任务中心队列）在任何角色都激活。
 */
import { uniquePositiveInts } from '@zenith/shared/core';
import { PgBoss, type JobWithMetadata, type Queue, type QueueOptions, type SendOptions, type Warning } from 'pg-boss';
import { eq, and, gte, inArray, isNull, or, desc, notInArray, sql, type SQL } from 'drizzle-orm';
import { db } from '../db';
import { cronJobs, cronJobLogs, dbBackups, systemSchedulerNodes, systemSchedulerRuns, systemSchedulerTaskConfigs, users } from '../db/schema';
import logger from './logger';
import { cleanExpiredCaptchas } from './captcha';
import { createPgDumpBackup, createDrizzleExportBackup } from './db-backup';
import { formatFileTimestamp, formatDateTime } from './datetime';
import { config } from '../config';
import { PROCESS_HOSTNAME, PROCESS_ID, PROCESS_PID } from './process-identity';
import { dispatchAlertChannels } from './alert-dispatch';
import type { SystemSchedulerAlertChannel } from '@zenith/shared/chat';
import type { CronRunStatus, CronRunTrigger, ProcessRole, SystemSchedulerTaskBase, SystemSchedulerTaskType, SystemSchedulerRunStatus, SystemSchedulerTriggerType } from '@zenith/shared/platform';
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

const schedulerNodeHostname = PROCESS_HOSTNAME;
const schedulerNodePid = PROCESS_PID;
const schedulerNodeId = PROCESS_ID;

/** 本进程是否执行作业（work / cron monitor / 对账）；false = 只发不执行的 api 角色 */
export function schedulerExecutesJobs(): boolean {
  return config.roles.worker;
}

/** 只允许 worker 角色调用的入口（孤儿清理 / 队列对账）：api 误调用会删掉别的进程正在服务的声明 */
function assertExecutesJobs(operation: string): void {
  if (!schedulerExecutesJobs()) {
    throw new Error(`pg-boss: ${operation} 只能在 worker 角色执行（当前 ZENITH_ROLES=${config.roles.label}）`);
  }
}

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
  /**
   * 在任何角色都激活本地 worker（默认只有 worker 角色执行）。
   * 仅限绑定本进程资源的队列（节点亲和的任务中心队列）；普通业务队列不得设置，否则 api 又回到执行作业的老路。
   */
  forceLocal?: boolean;
}

interface SystemRecurringJobPayload {
  taskName: string;
  trigger: 'schedule' | 'manual';
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
    roles: config.roles.list,
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
      roles: config.roles.list,
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
  /** 投递来源 */
  trigger: CronRunTrigger;
  /** 手动执行的操作人 */
  triggeredBy: number | null;
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

/** 在调度队列上执行一条业务定时任务作业 */
async function runCronJob(job: CronJobWithMetadata): Promise<void> {
  const { handlerName, params, jobId } = job.data;
  const fn = handlerRegistry.get(handlerName);
  const startedAt = new Date();
  // 重试由 pg-boss 发起，此时 retryCount > 0；首次执行按投递方声明的来源记录
  const attempt = job.retryCount ?? 0;
  const trigger: CronRunTrigger = attempt > 0 ? 'retry' : job.data.trigger;
  const scheduledAt = job.startAfter ?? job.createdOn ?? null;
  const runContext = {
    trigger,
    attempt,
    scheduledAt,
    nodeId: schedulerNodeId,
    triggeredBy: job.data.triggeredBy,
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

// ─── 调度队列：业务定时任务与系统周期任务各占一条 stately 队列 ──────────────────
// pg-boss 的 work() 每调用一次就多一个轮询 worker，队列参数只在建队列时生效。
// 因此同类任务共用一条队列，每个进程只注册一次 worker（localConcurrency 决定并发）；
// 每个任务是该队列上的一条 keyed schedule，作业带 singletonKey=key，stately 策略保证同一任务
// 最多「1 条排队 + 1 条执行中」：不重叠执行，执行超过周期时也只补跑一次而不是无限积压。

export const CRON_JOBS_QUEUE = 'cron-jobs';
export const SYSTEM_RECURRING_QUEUE = 'system-recurring';
const SCHEDULED_QUEUE_POLICY = 'stately';
const SCHEDULED_WORKER_LOCAL_CONCURRENCY = 8;
/** worker 崩溃后多久判定该次执行失联并按重试策略处理（文档建议 ≥ monitorIntervalSeconds） */
const SCHEDULED_QUEUE_HEARTBEAT_SECONDS = 60;
/** pg-boss 允许的 expireInSeconds 上限 */
const MAX_EXPIRE_SECONDS = 86_400;
const SCHEDULED_QUEUE_OPTIONS: Omit<Queue, 'name' | 'policy' | 'partition' | 'deadLetter'> = {
  heartbeatSeconds: SCHEDULED_QUEUE_HEARTBEAT_SECONDS,
  // 排队作业最多保留 7 天；执行记录以 cron_job_logs / system_scheduler_runs 为准，pg-boss 侧完成的作业 1 天后清理
  retentionSeconds: 60 * 60 * 24 * 7,
  deleteAfterSeconds: 60 * 60 * 24,
  warningQueueSize: 200,
};

const ensuredScheduledQueues = new Set<string>();
const scheduledQueueWorkerIds = new Map<string, string>();

/** pg-boss 内部队列（如 __pgboss__send-it）不参与对账 */
function isPgBossInternalQueue(name: string): boolean {
  return name.startsWith('__pgboss__');
}

/** 按代码声明建队 / 同步参数；policy 建队后不可修改，不一致时重建（排队中的作业由 schedule 在下一个周期重新产生） */
async function ensureScheduledQueue(name: string): Promise<void> {
  if (ensuredScheduledQueues.has(name)) return;
  const b = getBoss();
  const existing = await b.getQueue(name);
  if (existing && existing.policy !== SCHEDULED_QUEUE_POLICY) {
    logger.warn(`pg-boss: 队列 ${name} 策略为 ${existing.policy}，按代码要求重建为 ${SCHEDULED_QUEUE_POLICY}`);
    await b.deleteQueue(name);
  }
  await b.createQueue(name, { policy: SCHEDULED_QUEUE_POLICY, ...SCHEDULED_QUEUE_OPTIONS });
  // createQueue 对已存在的队列不更新参数，心跳 / 保留期等以代码为准同步一次
  await b.updateQueue(name, SCHEDULED_QUEUE_OPTIONS);
  ensuredScheduledQueues.add(name);
}

/**
 * 每个进程对同一队列只注册一次 worker，返回 workerId 供 notifyWorker 唤醒。
 * 非执行角色（api）返回 null：队列已声明，作业由 worker 进程轮询领取。
 */
async function ensureScheduledWorker<T extends object>(name: string, handler: (job: JobWithMetadata<T>) => Promise<void>): Promise<string | null> {
  if (!schedulerExecutesJobs()) return null;
  const existing = scheduledQueueWorkerIds.get(name);
  if (existing) return existing;
  const workerId = await getBoss().work<T, void, { includeMetadata: true; localConcurrency: number }>(
    name,
    { includeMetadata: true, localConcurrency: SCHEDULED_WORKER_LOCAL_CONCURRENCY },
    // batchSize 为 1，每次回调只有一条作业
    async (jobs) => handler(jobs[0]),
  );
  scheduledQueueWorkerIds.set(name, workerId);
  return workerId;
}

/**
 * 作业级参数显式下发，不依赖队列默认值（默认会重试 2 次、15 分钟过期）。
 * 超时判定由 worker 内的计时器负责，pg-boss 的过期只作兜底：比业务超时多留 30 秒，未配置超时时取上限，
 * 否则默认过期会把仍在正常执行的作业判死、释放 stately 锁而导致重叠执行；进程崩溃由队列心跳兜底。
 */
function scheduledSendOptions(key: string, retry: { retryLimit: number; retryDelay?: number; retryBackoff?: boolean }, timeoutSeconds: number | null): SendOptions {
  return {
    singletonKey: key,
    retryLimit: Math.max(retry.retryLimit, 0),
    retryDelay: Math.max(retry.retryDelay ?? 0, 0),
    retryBackoff: retry.retryBackoff ?? false,
    expireInSeconds: timeoutSeconds ? Math.min(Math.max(timeoutSeconds, 1) + 30, MAX_EXPIRE_SECONDS) : MAX_EXPIRE_SECONDS,
  };
}

/** 取消某个 key 尚未开始的排队作业（停用 / 删除任务时调用） */
async function cancelQueuedJobs(queue: string, key: string): Promise<void> {
  const b = getBoss();
  const queued = await b.findJobs(queue, { key, queued: true });
  if (queued.length > 0) await b.cancel(queue, queued.map((j) => j.id));
}

/** 队列上的 schedule 必须与声明的 key 集合一致：多余的删除，返回删掉的 key */
async function pruneSchedules(queue: string, declaredKeys: ReadonlySet<string>): Promise<string[]> {
  const b = getBoss();
  const schedules = await b.getSchedules(queue);
  const orphans = schedules.map((s) => s.key ?? '').filter((key) => !declaredKeys.has(key));
  for (const key of orphans) {
    await b.unschedule(queue, key || undefined).catch((err) => logger.warn(`pg-boss: 删除多余 schedule ${queue}/${key} 失败`, err));
    if (key) await cancelQueuedJobs(queue, key).catch(() => undefined);
  }
  return orphans;
}

/** 代码声明的队列集合：两条调度队列 + 已注册的系统队列 worker */
function declaredQueueNames(): Set<string> {
  return new Set([CRON_JOBS_QUEUE, SYSTEM_RECURRING_QUEUE, ...systemQueueWorkers.keys()]);
}

// ─── 节点亲和队列：只由创建它的进程消费 ──────────────────────────────────────
// 名称形如 `<base>/node/<hostname_pid>`，不进系统任务注册表（每个进程独有，worker 对账不能把别的进程的队列当孤儿删掉）；
// 进程下线后由 worker 启动对账按节点心跳回收。

const NODE_QUEUE_MARKER = '/node/';
const localNodeQueues = new Set<string>();

function nodeQueueSuffix(nodeId: string): string {
  // pg-boss 队列名只允许 [\w.-/]，hostname:pid 里的冒号等一律折成下划线
  return nodeId.replace(/[^\w.-]+/g, '_');
}

/** 某进程独有的节点亲和队列名 */
export function nodeQueueName(base: string, nodeId: string = PROCESS_ID): string {
  return `${base}${NODE_QUEUE_MARKER}${nodeQueueSuffix(nodeId)}`;
}

function isNodeQueue(name: string): boolean {
  return name.includes(NODE_QUEUE_MARKER);
}

/** 最近仍在上报心跳的节点 ID 集合（任何角色都上报心跳） */
async function activeSchedulerNodeIds(): Promise<Set<string>> {
  const staleBefore = new Date(Date.now() - CRON_HEALTH_RULES.schedulerHeartbeatStaleMs);
  const rows = await db.select({ nodeId: systemSchedulerNodes.nodeId })
    .from(systemSchedulerNodes)
    .where(and(eq(systemSchedulerNodes.active, true), gte(systemSchedulerNodes.lastHeartbeatAt, staleBefore)));
  return new Set(rows.map((r) => r.nodeId));
}

/** 目标进程是否仍在线（节点亲和任务能否被执行的判据） */
export async function isSchedulerNodeAlive(nodeId: string): Promise<boolean> {
  if (nodeId === PROCESS_ID) return true;
  return (await activeSchedulerNodeIds()).has(nodeId);
}

/**
 * 注册本进程独有的节点亲和队列并立即消费——无论角色。这是 api 角色唯一允许执行作业的地方：
 * 队列里只有本进程自己提交、且必须在本机执行的任务（见 task-center 的 affinity: 'node'）。
 */
export async function registerLocalNodeQueueWorker<T extends object>(
  base: string,
  handler: (data: T) => Promise<void>,
  queueOptions?: Omit<QueueOptions, 'name'>,
): Promise<string> {
  const b = getBoss();
  const name = nodeQueueName(base);
  if (localNodeQueues.has(name)) return name;
  await b.createQueue(name, queueOptions);
  await b.work<T>(name, async (jobs) => {
    for (const job of jobs) await handler(job.data);
  });
  localNodeQueues.add(name);
  logger.info(`pg-boss: local node queue "${name}" registered`);
  return name;
}

/** 回收已下线进程遗留的节点亲和队列（其作业已无人能执行；对应任务由任务中心兜底扫描标记失败） */
async function purgeDeadNodeQueues(queues: Array<{ name: string }>): Promise<void> {
  const nodeQueues = queues.filter((q) => isNodeQueue(q.name));
  if (nodeQueues.length === 0) return;
  const alive = new Set([...await activeSchedulerNodeIds()].map(nodeQueueSuffix));
  const b = getBoss();
  for (const queue of nodeQueues) {
    const suffix = queue.name.slice(queue.name.indexOf(NODE_QUEUE_MARKER) + NODE_QUEUE_MARKER.length);
    if (alive.has(suffix) || localNodeQueues.has(queue.name)) continue;
    await b.deleteQueue(queue.name).catch((err) => logger.warn(`pg-boss: 删除下线节点队列 ${queue.name} 失败`, err));
    logger.info(`pg-boss: 已回收下线节点的队列 ${queue.name}`);
  }
}

/**
 * 队列对账：pg-boss 里只允许存在代码声明的队列。未声明的队列连同其 schedule 与作业一起删除，
 * 执行历史在 cron_job_logs / system_scheduler_runs 中不受影响。须在全部 worker 注册完成后调用。
 * 节点亲和队列不在声明集合里（每个进程独有），只按节点心跳回收已下线进程的。
 */
export async function reconcileSchedulerQueues(): Promise<void> {
  assertExecutesJobs('队列对账');
  const b = getBoss();
  const declared = declaredQueueNames();
  const queues = await b.getQueues();
  const undeclared = queues.filter((q) => !declared.has(q.name) && !isPgBossInternalQueue(q.name) && !isNodeQueue(q.name));
  for (const queue of undeclared) {
    const schedules = await b.getSchedules(queue.name).catch(() => []);
    for (const s of schedules) await b.unschedule(queue.name, s.key || undefined).catch(() => undefined);
    await b.offWork(queue.name, { wait: false }).catch(() => undefined);
    await b.deleteQueue(queue.name);
  }
  if (undeclared.length > 0) {
    logger.warn(`pg-boss: 已删除 ${undeclared.length} 条代码未声明的队列：${undeclared.map((q) => q.name).join('、')}`);
  }
  const orphanSystemSchedules = await pruneSchedules(SYSTEM_RECURRING_QUEUE, new Set(systemRecurringJobs.keys()));
  if (orphanSystemSchedules.length > 0) {
    logger.warn(`pg-boss: 已删除 ${orphanSystemSchedules.length} 条无对应系统任务的 schedule：${orphanSystemSchedules.join('、')}`);
  }
  await purgeDeadNodeQueues(queues).catch((err) => logger.warn('pg-boss: 回收下线节点队列失败', err));
}

// ─── 业务定时任务（cron_jobs）在调度队列上的映射 ─────────────────────────────────

function cronScheduleKey(jobId: number): string {
  return String(jobId);
}

function cronJobSendOptions(job: Pick<typeof cronJobs.$inferSelect, 'id' | 'retryCount' | 'retryInterval' | 'retryBackoff' | 'monitorTimeout'>): SendOptions {
  return scheduledSendOptions(
    cronScheduleKey(job.id),
    { retryLimit: job.retryCount, retryDelay: job.retryInterval, retryBackoff: job.retryBackoff },
    job.monitorTimeout,
  );
}

function cronJobPayload(job: Pick<typeof cronJobs.$inferSelect, 'id' | 'handler' | 'params'>, trigger: CronRunTrigger, triggeredBy: number | null = null): JobData {
  return { handlerName: job.handler, params: job.params, jobId: job.id, trigger, triggeredBy };
}

async function ensureCronQueue(): Promise<string | null> {
  await ensureScheduledQueue(CRON_JOBS_QUEUE);
  return ensureScheduledWorker<JobData>(CRON_JOBS_QUEUE, runCronJob);
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

export interface CronScheduleReconcileResult {
  /** 启用中却没有 schedule 的任务 ID */
  missing: number[];
  /** 有 schedule 但任务已停用 / 不存在的 key */
  orphans: string[];
}

/** 对账 pg-boss schedule 与 cron_jobs：启用任务必须各有一条 keyed schedule，多余的 schedule 删除 */
async function reconcileCronSchedules(enabledJobs: Array<typeof cronJobs.$inferSelect>): Promise<CronScheduleReconcileResult> {
  const orphans = await pruneSchedules(CRON_JOBS_QUEUE, new Set(enabledJobs.map((job) => cronScheduleKey(job.id))));
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
  const executes = schedulerExecutesJobs();
  boss = new PgBoss({
    connectionString: config.databaseUrl,
    schema: 'pgboss',
    // api 角色只投递不执行：关闭维护（过期 / 归档 / 心跳判死）与 cron monitor，两者都由 worker 承担；
    // schedule() / unschedule() 是纯 SQL 写入，不受 schedule 开关影响，后台改启停仍可在 api 上生效
    supervise: executes,
    superviseIntervalSeconds: 30,
    schedule: executes,
    // 只发不执行的实例只需要极少的连接：send / schedule 都是单条 SQL
    ...(executes ? {} : { max: 2 }),
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

  logger.info(`pg-boss: starting (${executes ? 'executes jobs' : 'send-only'})...`);
  await boss.start();
  logger.info('pg-boss started');
  startSchedulerHeartbeat();
  await refreshSchedulerHealth().catch((err) => logger.warn('pg-boss: schema 健康检查失败', err));

  // 两条调度队列是代码声明的一部分：api 也要建好，否则全新库上 worker 启动前的 send() 会因队列不存在失败
  await ensureScheduledQueue(CRON_JOBS_QUEUE);
  await ensureScheduledQueue(SYSTEM_RECURRING_QUEUE);
  if (!executes) {
    logger.info('pg-boss: 本进程不执行作业，跳过孤儿清理与 schedule 对账');
    return;
  }

  await purgeOrphanCronJobs();
  await closeOrphanRunningLogs().catch((err) => logger.warn('pg-boss: 关闭无归属运行中记录失败', err));

  await ensureCronQueue();
  const jobs = await db.select().from(cronJobs).where(eq(cronJobs.status, 'enabled'));
  const reconciled = await reconcileCronSchedules(jobs);
  logger.info(`pg-boss: ${jobs.length} enabled job(s) scheduled on ${CRON_JOBS_QUEUE}`
    + (reconciled.orphans.length ? `，删除多余 schedule ${reconciled.orphans.length} 条` : ''));
}

/**
 * 清理 handler 已从代码中移除的业务定时任务。
 *
 * 这类任务留在库里会按 cron 持续触发，每次都以 `Handler "xxx" not found` 失败并推送告警。
 * 启动时对账删除，保证「代码里的 handler 注册表」是任务存在与否的唯一依据。
 */
async function purgeOrphanCronJobs(): Promise<void> {
  assertExecutesJobs('清理 handler 失效的定时任务');
  const known = [...handlerRegistry.keys()];
  // 注册表为空说明 handler 模块尚未加载完成，此时对账会误删全部任务
  if (known.length === 0) return;
  const orphans = await db.delete(cronJobs)
    .where(notInArray(cronJobs.handler, known))
    .returning({ id: cronJobs.id, name: cronJobs.name, handler: cronJobs.handler });
  if (orphans.length === 0) return;
  for (const job of orphans) {
    await getBoss().unschedule(CRON_JOBS_QUEUE, cronScheduleKey(job.id)).catch(() => undefined);
    await cancelQueuedJobs(CRON_JOBS_QUEUE, cronScheduleKey(job.id)).catch(() => undefined);
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
  return _scheduleOne(job);
}

/** 停用 / 删除任务：删掉 schedule，并取消该任务尚未开始的排队作业 */
export async function stopJob(jobId: number): Promise<void> {
  try {
    await getBoss().unschedule(CRON_JOBS_QUEUE, cronScheduleKey(jobId));
    await cancelQueuedJobs(CRON_JOBS_QUEUE, cronScheduleKey(jobId));
  } catch (err) {
    logger.warn(`pg-boss: failed to unschedule job ${jobId}:`, err);
  }
}

export async function runJobOnce(jobId: number, triggeredBy: number | null = null): Promise<{ success: boolean; message: string }> {
  const [job] = await db.select().from(cronJobs).where(eq(cronJobs.id, jobId)).limit(1);
  if (!job) return { success: false, message: '任务不存在' };

  const b = getBoss();
  const workerId = await ensureCronQueue();

  const logsBefore = await db.$count(cronJobLogs, eq(cronJobLogs.jobId, jobId));
  const sentId = await b.send(CRON_JOBS_QUEUE, cronJobPayload(job, 'manual', triggeredBy), cronJobSendOptions(job));
  // stately 策略下同一任务已有一条排队作业时插入被吞掉（返回 null），本次触发与之合并
  if (!sentId) {
    return { success: true, message: '该任务已有一次待执行的作业，本次手动触发已与其合并' };
  }
  // 跳过本轮轮询间隔，让 worker 立刻去取；api 角色没有本地 worker，由 worker 进程按轮询间隔领取
  if (workerId) b.notifyWorker(workerId);

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
    // 本进程独有的节点队列随进程消失：先等该队列在飞作业收尾，再删队列（stop 之后连接已关，不能再操作）。
    // 尚未领取的作业对应的任务保持 pending，由任务中心兜底扫描按「节点已下线」标记失败。
    for (const name of localNodeQueues) {
      await boss.offWork(name, { wait: true }).catch(() => undefined);
      await boss.deleteQueue(name).catch((err) => logger.warn(`pg-boss: 删除本进程节点队列 ${name} 失败`, err));
    }
    await boss.stop();
    boss = null;
    localNodeQueues.clear();
    scheduledQueueWorkerIds.clear();
    ensuredScheduledQueues.clear();
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
  node: { id: string; hostname: string; pid: number; roles: ProcessRole[] };
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
    node: { id: schedulerNodeId, hostname: schedulerNodeHostname, pid: schedulerNodePid, roles: config.roles.list },
    registeredHandlers: getRegisteredHandlers(),
    systemRecurringJobs: [...systemRecurringJobs.values()],
    systemQueueWorkers: [...systemQueueWorkers.values()],
    wip,
    warnings: getRecentSchedulerWarnings(),
  };
}

/**
 * 系统任务的 pg-boss 作业读数：周期任务是 system-recurring 队列上 singletonKey = 任务名的作业，
 * 队列型任务则拥有以任务名命名的独立队列；两类一次 SQL 一起统计。
 */
export async function getSystemQueueMetrics(names: string[]): Promise<Record<string, SystemSchedulerQueueMetrics>> {
  const emptyMetrics = (): SystemSchedulerQueueMetrics => ({
    queuedCount: 0, activeCount: 0, deferredCount: 0, totalCount: 0, failedCount: 0, completedCount: 0, stateCounts: {},
  });
  const result: Record<string, SystemSchedulerQueueMetrics> = Object.fromEntries(names.map((name) => [name, emptyMetrics()]));
  if (names.length === 0) return result;
  const recurringNames = names.filter((name) => systemRecurringJobs.has(name));
  const queueNames = names.filter((name) => !systemRecurringJobs.has(name));
  const conditions = [
    recurringNames.length > 0
      ? sql`(name = ${SYSTEM_RECURRING_QUEUE} and singleton_key in (${sql.join(recurringNames.map((n) => sql`${n}`), sql`, `)}))`
      : null,
    queueNames.length > 0 ? sql`name in (${sql.join(queueNames.map((n) => sql`${n}`), sql`, `)})` : null,
  ].filter((c): c is SQL => c !== null);
  let rows: Array<{ task: string; state: string; count: number; deferred: number }> = [];
  try {
    rows = await db.execute(sql`
      select case when name = ${SYSTEM_RECURRING_QUEUE} then singleton_key else name end as task,
             state::text as state,
             count(*)::int as count,
             count(*) filter (where state = 'created' and start_after > now())::int as deferred
      from pgboss.job
      where ${sql.join(conditions, sql` or `)}
      group by 1, 2
    `) as unknown as typeof rows;
  } catch (err) {
    logger.warn('pg-boss: failed to load job state counts', err);
    return result;
  }
  for (const row of rows) {
    const metrics = result[row.task];
    if (!metrics) continue;
    const count = Number(row.count) || 0;
    metrics.stateCounts[row.state] = count;
    metrics.totalCount += count;
    if (row.state === 'created' || row.state === 'retry') metrics.queuedCount += count;
    if (row.state === 'created') metrics.deferredCount += Number(row.deferred) || 0;
    if (row.state === 'active') metrics.activeCount += count;
    if (row.state === 'failed') metrics.failedCount += count;
    if (row.state === 'completed') metrics.completedCount += count;
  }
  return result;
}

// ─── 系统级周期任务在调度队列上的映射 ──────────────────────────────────────────

/** 系统周期任务都是幂等扫描：失败不重试，等下一个周期；超时只作为告警阈值，不打断执行 */
function systemRecurringSendOptions(taskName: string): SendOptions {
  return scheduledSendOptions(taskName, { retryLimit: 0 }, null);
}

/** 在调度队列上执行一条系统周期任务作业 */
async function runSystemRecurringJob(job: JobWithMetadata<SystemRecurringJobPayload>): Promise<void> {
  const { taskName, trigger, runId, triggeredBy } = job.data;
  const info = systemRecurringJobs.get(taskName);
  const run = systemRecurringJobHandlers.get(taskName);
  if (!info || !run) {
    throw new Error(`系统周期任务 "${taskName}" 未在本节点注册`);
  }
  await executeSystemTask(info, trigger, run, { runId, triggeredBy: triggeredBy ?? null, jobId: job.id });
}

async function ensureSystemRecurringQueue(): Promise<string | null> {
  await ensureScheduledQueue(SYSTEM_RECURRING_QUEUE);
  return ensureScheduledWorker<SystemRecurringJobPayload>(SYSTEM_RECURRING_QUEUE, runSystemRecurringJob);
}

async function scheduleSystemRecurringJob(taskName: string, cronExpression: string): Promise<void> {
  await getBoss().schedule(SYSTEM_RECURRING_QUEUE, toMinuteCron(cronExpression), { taskName, trigger: 'schedule' } satisfies SystemRecurringJobPayload, {
    tz: CRON_SCHEDULE_TZ,
    key: taskName,
    ...systemRecurringSendOptions(taskName),
  });
}

async function unscheduleSystemRecurringJob(taskName: string): Promise<void> {
  await getBoss().unschedule(SYSTEM_RECURRING_QUEUE, taskName).catch(() => undefined);
  await cancelQueuedJobs(SYSTEM_RECURRING_QUEUE, taskName).catch(() => undefined);
}

/**
 * 注册系统级周期任务（不写入 cron_jobs / cron_job_logs），用于启动时固定注册的内部调度。
 * 每个任务是 system-recurring 队列上 key = 任务名的一条 schedule；运行结果写入 system_scheduler_runs，
 * 并在系统调度页面统一展示。
 */
export async function registerSystemRecurringJob(registration: SystemRecurringJobRegistration): Promise<void> {
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

  await ensureSystemRecurringQueue();
  systemRecurringJobs.set(registration.name, info);
  systemRecurringJobHandlers.set(registration.name, registration.run);
  if (runtimePolicy.enabled) {
    await scheduleSystemRecurringJob(registration.name, registration.cronExpression);
    logger.info(`pg-boss: system recurring job "${registration.name}" scheduled (${registration.cronExpression})`);
  } else {
    await unscheduleSystemRecurringJob(registration.name);
    logger.info(`pg-boss: system recurring job "${registration.name}" registered but disabled`);
  }
  await heartbeatSystemSchedulerNode(true).catch((err) => logger.warn('[system-scheduler] 节点心跳上报失败', err));
}

export async function runSystemRecurringJobNow(name: string, triggeredBy?: number | null): Promise<{ message: string; runId: number | null; jobId: string | null }> {
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
  const workerId = await ensureSystemRecurringQueue();
  // stately 策略下同一任务只允许一条排队作业：已有排队时本次触发与之合并，不再另记一次运行
  const queued = await b.findJobs(SYSTEM_RECURRING_QUEUE, { key: name, queued: true });
  if (queued.length > 0) {
    return { message: '该任务已有一次待执行的作业，本次手动触发已与其合并', runId: null, jobId: queued[0].id };
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

  const jobId = await b.send(SYSTEM_RECURRING_QUEUE, {
    taskName: name,
    trigger: 'manual',
    runId: run.id,
    triggeredBy: triggeredBy ?? null,
  } satisfies SystemRecurringJobPayload, systemRecurringSendOptions(name));

  if (!jobId) {
    // 与上面的排队检查之间恰好有计划作业入队：本次触发合并到它
    await db.delete(systemSchedulerRuns).where(eq(systemSchedulerRuns.id, run.id));
    return { message: '该任务已有一次待执行的作业，本次手动触发已与其合并', runId: null, jobId: null };
  }

  await db.update(systemSchedulerRuns).set({ jobId }).where(eq(systemSchedulerRuns.id, run.id));
  // 跳过本轮轮询间隔，让 worker 立刻去取；api 角色没有本地 worker，由 worker 进程按轮询间隔领取
  if (workerId) b.notifyWorker(workerId);
  return { message: `任务已投递后台执行，运行日志 #${run.id} 可跟踪结果`, runId: run.id, jobId };
}

export async function updateSystemTaskRuntimePolicy(name: string, policy: SystemSchedulerTaskPolicy): Promise<void> {
  const recurring = systemRecurringJobs.get(name);
  if (recurring) {
    updateRecurringJobInfoPolicy(name, policy);
    if (policy.enabled) {
      await scheduleSystemRecurringJob(name, recurring.cronExpression);
    } else {
      await unscheduleSystemRecurringJob(name);
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
  // 声明到此为止；轮询领取只在执行角色（或显式要求本地执行的节点亲和队列）激活
  if (schedulerExecutesJobs() || registration.forceLocal) {
    await b.work<T>(registration.name, async (jobs) => {
      for (const job of jobs) {
        await executeSystemTask(info, 'queue', () => registration.handler(job.data), { jobId: job.id });
      }
    });
  }
  systemQueueWorkers.set(registration.name, info);
  logger.info(`pg-boss: system queue worker "${registration.name}" ${schedulerExecutesJobs() || registration.forceLocal ? 'registered' : 'declared (not executing in this role)'}`);
  await heartbeatSystemSchedulerNode(true).catch((err) => logger.warn('[system-scheduler] 节点心跳上报失败', err));
}

/**
 * 系统任务对账（全部系统任务注册完成后调用一次）：
 * 删除代码中已移除任务的配置、运行日志与 schedule，并让 pg-boss 里的队列 / schedule 与代码声明一致。
 */
export async function purgeOrphanSystemTasks(): Promise<void> {
  assertExecutesJobs('系统任务对账');
  const known = [...systemRecurringJobs.keys(), ...systemQueueWorkers.keys()];
  // 一个任务都没注册说明注册流程异常中断，此时对账会误删全部配置
  if (known.length === 0) return;
  const orphans = await db.delete(systemSchedulerTaskConfigs)
    .where(notInArray(systemSchedulerTaskConfigs.taskName, known))
    .returning({ taskName: systemSchedulerTaskConfigs.taskName });
  if (orphans.length > 0) {
    for (const task of orphans) {
      await unscheduleSystemRecurringJob(task.taskName);
    }
    await db.delete(systemSchedulerRuns).where(notInArray(systemSchedulerRuns.taskName, known));
    logger.warn(
      `[system-scheduler] 已清理 ${orphans.length} 个代码中已移除的系统任务：`
      + orphans.map((task) => task.taskName).join('、'),
    );
  }
  await reconcileSchedulerQueues().catch((err) => logger.warn('pg-boss: 队列对账失败', err));
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
