import { and, desc, eq, gte, inArray, lte, sql } from 'drizzle-orm';
import { HTTPException } from 'hono/http-exception';
import { CronExpressionParser } from 'cron-parser';
import { z } from 'zod';
import { db } from '../../db';
import {
  reportDeliveryAttempts,
  reportDeliveryRuns,
  users,
} from '../../db/schema';
import { currentUser, currentUserOrNull, hasPermission } from '../../lib/context';
import { formatDateTime, formatNullableDateTime } from '../../lib/datetime';
import { pageOffset } from '../../lib/pagination';
import { sendWebhookNotification } from '../../lib/webhook-notify';
import { sendEmail } from '../messaging/email-send-logs.service';
import { sendInApp } from '../messaging/in-app-messages.service';
import { reportScopedWhere, reportTenantScope } from './report-access';
import { resolveReportSecret } from './report-secrets';
import type {
  ReportAlertRule,
  ReportDashboardSubscription,
  ReportDeliveryAttempt,
  ReportDeliveryRun,
  ReportDeliveryStatus,
  ReportDeliveryTriggerType,
  ReportNotifyChannel,
  ReportScheduleMisfirePolicy,
} from '@zenith/shared';

const emailSchema = z.email('邮箱格式不正确');

export const REPORT_DEFAULT_TIMEZONE = 'Asia/Shanghai';
export const REPORT_DELIVERY_TASK_MAX_ATTEMPTS = 3;
export const REPORT_DELIVERY_RETRY_BASE_MS = 60_000;

type DeliveryRunQueryRow = typeof reportDeliveryRuns.$inferSelect & {
  acknowledgedByName: string | null;
};

function trimMessage(message: unknown, maxLength = 512): string | null {
  if (message == null) return null;
  const text = String(message).trim();
  return text ? text.slice(0, maxLength) : null;
}

function deliveryAt(row: typeof reportDeliveryRuns.$inferSelect): string | null {
  return formatNullableDateTime(row.completedAt ?? row.updatedAt ?? null);
}

export function ensureValidReportTimezone(timezone: string): void {
  const value = timezone.trim();
  if (!value) throw new HTTPException(400, { message: '时区不能为空' });
  try {
    new Intl.DateTimeFormat('zh-CN', { timeZone: value }).format(new Date());
  } catch {
    throw new HTTPException(400, { message: '时区必须是合法的 IANA Timezone' });
  }
}

export function computeReportNextRun(
  cron: string | null | undefined,
  timezone: string,
  from: Date = new Date(),
): Date | null {
  if (!cron?.trim()) return null;
  ensureValidReportTimezone(timezone);
  try {
    return CronExpressionParser.parse(cron.trim(), { currentDate: from, tz: timezone }).next().toDate();
  } catch {
    return null;
  }
}

export function ensureValidReportSchedule(cron: string | null | undefined, timezone: string): void {
  if (!cron?.trim()) return;
  if (computeReportNextRun(cron, timezone) === null) {
    throw new HTTPException(400, { message: 'Cron 表达式无效' });
  }
}

export function resolveNextRunAt(
  cron: string | null | undefined,
  enabled: boolean,
  timezone: string,
): Date | null {
  if (!enabled || !cron?.trim()) return null;
  return computeReportNextRun(cron, timezone);
}

export function parseRecipientEmails(recipients: string | null | undefined, required: boolean): string[] {
  const list = (recipients ?? '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
  if (required && list.length === 0) {
    throw new HTTPException(400, { message: '选择邮件通道时必须填写收件人邮箱' });
  }
  for (const email of list) {
    if (!emailSchema.safeParse(email).success) {
      throw new HTTPException(400, { message: `邮箱格式不正确：${email}` });
    }
  }
  return Array.from(new Set(list));
}

export function validateNotifyChannels(
  channels: ReportNotifyChannel[],
  recipients: string | null | undefined,
  webhookUrl: string | null | undefined,
  createdBy: number | null | undefined,
): void {
  if (channels.includes('email')) parseRecipientEmails(recipients, true);
  if (channels.includes('webhook') && !webhookUrl) {
    throw new HTTPException(400, { message: '选择 Webhook 通道时必须填写 Webhook 地址' });
  }
  if (channels.includes('inApp') && !createdBy) {
    throw new HTTPException(400, { message: '选择站内信通道时必须存在创建者' });
  }
}

export function computeScheduledRetryAt(attempt: number, baseMs = REPORT_DELIVERY_RETRY_BASE_MS): Date {
  const delayMs = Math.min(baseMs * 2 ** Math.max(attempt - 1, 0), 15 * 60_000);
  return new Date(Date.now() + delayMs);
}

function mapDeliveryAttempt(row: typeof reportDeliveryAttempts.$inferSelect): ReportDeliveryAttempt {
  return {
    id: row.id,
    runId: row.runId,
    channel: row.channel,
    attempt: row.attempt,
    status: row.status,
    durationMs: row.durationMs ?? null,
    errorMessage: row.errorMessage ?? null,
    payloadSummary: (row.payloadSummary ?? {}) as Record<string, unknown>,
    startedAt: formatNullableDateTime(row.startedAt),
    completedAt: formatNullableDateTime(row.completedAt),
    createdAt: formatDateTime(row.createdAt),
    updatedAt: formatDateTime(row.updatedAt),
  };
}

function mapDeliveryRun(row: DeliveryRunQueryRow, attempts?: ReportDeliveryAttempt[]): ReportDeliveryRun {
  return {
    id: row.id,
    targetType: row.targetType,
    subscriptionId: row.subscriptionId ?? null,
    alertRuleId: row.alertRuleId ?? null,
    slaRuleId: row.slaRuleId ?? null,
    dashboardId: row.dashboardId ?? null,
    datasetId: row.datasetId ?? null,
    targetName: row.targetName ?? null,
    triggerType: row.triggerType,
    status: row.status,
    idempotencyKey: row.idempotencyKey,
    attempt: row.attempt,
    maxAttempts: row.maxAttempts,
    durationMs: row.durationMs ?? null,
    errorMessage: row.errorMessage ?? null,
    payloadSummary: (row.payloadSummary ?? {}) as Record<string, unknown>,
    lastValue: row.lastValue ?? null,
    triggered: row.triggered ?? null,
    acknowledgedAt: formatNullableDateTime(row.acknowledgedAt),
    acknowledgedBy: row.acknowledgedBy ?? null,
    acknowledgedByName: row.acknowledgedByName ?? null,
    acknowledgeNote: row.acknowledgeNote ?? null,
    startedAt: formatNullableDateTime(row.startedAt),
    completedAt: formatNullableDateTime(row.completedAt),
    nextRetryAt: formatNullableDateTime(row.nextRetryAt),
    attempts,
    createdAt: formatDateTime(row.createdAt),
    updatedAt: formatDateTime(row.updatedAt),
  };
}

async function listAttemptsForRunIds(runIds: number[]): Promise<Map<number, ReportDeliveryAttempt[]>> {
  if (runIds.length === 0) return new Map();
  const rows = await db.select()
    .from(reportDeliveryAttempts)
    .where(inArray(reportDeliveryAttempts.runId, runIds))
    .orderBy(desc(reportDeliveryAttempts.attempt), reportDeliveryAttempts.id);
  const map = new Map<number, ReportDeliveryAttempt[]>();
  for (const row of rows) {
    const list = map.get(row.runId);
    if (list) list.push(mapDeliveryAttempt(row));
    else map.set(row.runId, [mapDeliveryAttempt(row)]);
  }
  return map;
}

export async function listDeliveryRuns(query: {
  page?: number;
  pageSize?: number;
  targetType?: 'subscription' | 'alert' | 'sla';
  subscriptionId?: number;
  alertRuleId?: number;
  slaRuleId?: number;
  status?: ReportDeliveryStatus;
  triggerType?: ReportDeliveryTriggerType;
  startAt?: Date;
  endAt?: Date;
  includeAttempts?: boolean;
}) {
  const { page = 1, pageSize = 20, includeAttempts = true } = query;
  const conds = [];
  const tenantScope = reportTenantScope(reportDeliveryRuns);
  if (tenantScope) conds.push(tenantScope);
  if (query.targetType) conds.push(eq(reportDeliveryRuns.targetType, query.targetType));
  if (query.subscriptionId) conds.push(eq(reportDeliveryRuns.subscriptionId, query.subscriptionId));
  if (query.alertRuleId) conds.push(eq(reportDeliveryRuns.alertRuleId, query.alertRuleId));
  if (query.slaRuleId) conds.push(eq(reportDeliveryRuns.slaRuleId, query.slaRuleId));
  if (query.status) conds.push(eq(reportDeliveryRuns.status, query.status));
  if (query.triggerType) conds.push(eq(reportDeliveryRuns.triggerType, query.triggerType));
  if (query.startAt) conds.push(gte(reportDeliveryRuns.createdAt, query.startAt));
  if (query.endAt) conds.push(lte(reportDeliveryRuns.createdAt, query.endAt));
  const where = conds.length ? and(...conds) : undefined;
  const [total, rows] = await Promise.all([
    db.$count(reportDeliveryRuns, where),
    db.select({
      row: reportDeliveryRuns,
      acknowledgedByName: users.nickname,
    })
      .from(reportDeliveryRuns)
      .leftJoin(users, eq(users.id, reportDeliveryRuns.acknowledgedBy))
      .where(where)
      .orderBy(desc(reportDeliveryRuns.id))
      .limit(pageSize)
      .offset(pageOffset(page, pageSize)),
  ]);
  const runIds = rows.map((item) => item.row.id);
  const attemptsMap = includeAttempts ? await listAttemptsForRunIds(runIds) : new Map<number, ReportDeliveryAttempt[]>();
  return {
    list: rows.map((item) => mapDeliveryRun({ ...item.row, acknowledgedByName: item.acknowledgedByName ?? null }, attemptsMap.get(item.row.id))),
    total,
    page,
    pageSize,
  };
}

export async function listAccessibleDeliveryRuns(query: Parameters<typeof listDeliveryRuns>[0]) {
  const [canViewAlerts, canViewSubscriptions] = await Promise.all([
    hasPermission('report:alert:list'),
    hasPermission('report:subscription:list'),
  ]);
  if (query.targetType === 'alert' && !canViewAlerts) {
    throw new HTTPException(403, { message: '无权查看预警投递历史' });
  }
  if (query.targetType === 'subscription' && !canViewSubscriptions) {
    throw new HTTPException(403, { message: '无权查看订阅投递历史' });
  }
  if (!query.targetType) {
    if (canViewAlerts && !canViewSubscriptions) return listDeliveryRuns({ ...query, targetType: 'alert' });
    if (!canViewAlerts && canViewSubscriptions) return listDeliveryRuns({ ...query, targetType: 'subscription' });
    if (!canViewAlerts && !canViewSubscriptions) {
      throw new HTTPException(403, { message: '无权查看报表投递历史' });
    }
  }
  return listDeliveryRuns(query);
}

export async function acknowledgeAlertDeliveryRun(id: number, note: string | null | undefined): Promise<ReportDeliveryRun> {
  const existing = await db.select({
    row: reportDeliveryRuns,
    acknowledgedByName: users.nickname,
  })
    .from(reportDeliveryRuns)
    .leftJoin(users, eq(users.id, reportDeliveryRuns.acknowledgedBy))
    .where(reportScopedWhere(reportDeliveryRuns, eq(reportDeliveryRuns.id, id)))
    .limit(1);
  const current = existing[0];
  if (!current || current.row.targetType !== 'alert') {
    throw new HTTPException(404, { message: '告警投递记录不存在' });
  }
  const user = currentUser();
  const [row] = await db.update(reportDeliveryRuns)
    .set({
      acknowledgedAt: new Date(),
      acknowledgedBy: user.userId,
      acknowledgeNote: trimMessage(note, 500),
    })
    .where(eq(reportDeliveryRuns.id, id))
    .returning();
  const attempts = await listAttemptsForRunIds([id]);
  return mapDeliveryRun({ ...row, acknowledgedByName: user.username }, attempts.get(id));
}

async function recordChannelAttempt(input: {
  tenantId: number | null;
  runId: number;
  channel: ReportNotifyChannel;
  attempt: number;
  status: ReportDeliveryStatus;
  durationMs: number;
  errorMessage?: string | null;
  payloadSummary?: Record<string, unknown>;
}): Promise<void> {
  const now = new Date();
  await db.insert(reportDeliveryAttempts).values({
    tenantId: input.tenantId,
    runId: input.runId,
    channel: input.channel,
    attempt: input.attempt,
    status: input.status,
    durationMs: input.durationMs,
    errorMessage: trimMessage(input.errorMessage),
    payloadSummary: input.payloadSummary ?? {},
    startedAt: new Date(now.getTime() - input.durationMs),
    completedAt: now,
  }).onConflictDoUpdate({
    target: [reportDeliveryAttempts.runId, reportDeliveryAttempts.channel, reportDeliveryAttempts.attempt],
    set: {
      status: sql`excluded.status`,
      durationMs: sql`excluded.duration_ms`,
      errorMessage: sql`excluded.error_message`,
      payloadSummary: sql`excluded.payload_summary`,
      startedAt: sql`excluded.started_at`,
      completedAt: sql`excluded.completed_at`,
      updatedAt: now,
    },
  });
}

async function getSuccessfulChannels(runId: number): Promise<Set<ReportNotifyChannel>> {
  const rows = await db.select({ channel: reportDeliveryAttempts.channel })
    .from(reportDeliveryAttempts)
    .where(and(eq(reportDeliveryAttempts.runId, runId), eq(reportDeliveryAttempts.status, 'success')));
  return new Set(rows.map((row) => row.channel));
}

async function pendingEmailRecipients(
  runId: number,
  recipients: string[],
): Promise<Array<{ email: string; index: number }>> {
  const [latest] = await db.select({
    status: reportDeliveryAttempts.status,
    payloadSummary: reportDeliveryAttempts.payloadSummary,
  }).from(reportDeliveryAttempts)
    .where(and(eq(reportDeliveryAttempts.runId, runId), eq(reportDeliveryAttempts.channel, 'email')))
    .orderBy(desc(reportDeliveryAttempts.attempt), desc(reportDeliveryAttempts.id))
    .limit(1);
  if (!latest || latest.status === 'success') return recipients.map((email, index) => ({ email, index }));
  const failedIndexes = (latest.payloadSummary as { failedRecipientIndexes?: unknown } | null)?.failedRecipientIndexes;
  if (!Array.isArray(failedIndexes)) return recipients.map((email, index) => ({ email, index }));
  const indexes = new Set(failedIndexes.filter((value): value is number => Number.isInteger(value) && value >= 0));
  return recipients.flatMap((email, index) => indexes.has(index) ? [{ email, index }] : []);
}

export async function ensureDeliveryRun(input: {
  tenantId: number | null;
  targetType: 'subscription' | 'alert' | 'sla';
  triggerType: ReportDeliveryTriggerType;
  idempotencyKey: string;
  subscriptionId?: number | null;
  alertRuleId?: number | null;
  slaRuleId?: number | null;
  dashboardId?: number | null;
  datasetId?: number | null;
  targetName?: string | null;
  requestedBy?: number | null;
  payloadSummary?: Record<string, unknown>;
  maxAttempts?: number;
}): Promise<typeof reportDeliveryRuns.$inferSelect> {
  const [inserted] = await db.insert(reportDeliveryRuns).values({
    tenantId: input.tenantId,
    targetType: input.targetType,
    triggerType: input.triggerType,
    idempotencyKey: input.idempotencyKey.slice(0, 128),
    subscriptionId: input.subscriptionId ?? null,
    alertRuleId: input.alertRuleId ?? null,
    slaRuleId: input.slaRuleId ?? null,
    dashboardId: input.dashboardId ?? null,
    datasetId: input.datasetId ?? null,
    targetName: input.targetName ?? null,
    payloadSummary: input.payloadSummary ?? {},
    requestedBy: input.requestedBy ?? null,
    maxAttempts: input.maxAttempts ?? REPORT_DELIVERY_TASK_MAX_ATTEMPTS,
  }).onConflictDoNothing({ target: reportDeliveryRuns.idempotencyKey }).returning();
  if (inserted) return inserted;
  const [existing] = await db.select().from(reportDeliveryRuns)
    .where(eq(reportDeliveryRuns.idempotencyKey, input.idempotencyKey.slice(0, 128)))
    .limit(1);
  if (!existing) throw new HTTPException(500, { message: '投递记录创建失败，请重试' });
  return existing;
}

export async function startManualDeliveryRun(input: {
  runId: number;
  attempt: number;
  maxAttempts: number;
  triggerType: ReportDeliveryTriggerType;
  payloadSummary?: Record<string, unknown>;
}): Promise<typeof reportDeliveryRuns.$inferSelect> {
  const [row] = await db.update(reportDeliveryRuns)
    .set({
      triggerType: input.triggerType,
      status: 'running',
      attempt: input.attempt,
      maxAttempts: input.maxAttempts,
      errorMessage: null,
      nextRetryAt: null,
      startedAt: sql`coalesce(${reportDeliveryRuns.startedAt}, now())`,
      completedAt: null,
      payloadSummary: input.payloadSummary ?? {},
    })
    .where(eq(reportDeliveryRuns.id, input.runId))
    .returning();
  if (!row) throw new HTTPException(404, { message: '投递记录不存在' });
  return row;
}

export async function claimRetryDeliveryRun(runId: number): Promise<typeof reportDeliveryRuns.$inferSelect | null> {
  const now = new Date();
  const [row] = await db.update(reportDeliveryRuns)
    .set({
      status: 'running',
      attempt: sql`${reportDeliveryRuns.attempt} + 1`,
      startedAt: sql`coalesce(${reportDeliveryRuns.startedAt}, now())`,
      completedAt: null,
      errorMessage: null,
      nextRetryAt: null,
      updatedAt: now,
    })
    .where(and(
      eq(reportDeliveryRuns.id, runId),
      eq(reportDeliveryRuns.status, 'pending'),
      lte(reportDeliveryRuns.nextRetryAt, now),
    ))
    .returning();
  return row ?? null;
}

export async function finalizeDeliveryRun(input: {
  runId: number;
  status: ReportDeliveryStatus;
  errorMessage?: string | null;
  payloadSummary?: Record<string, unknown>;
  lastValue?: number | null;
  triggered?: boolean | null;
}): Promise<typeof reportDeliveryRuns.$inferSelect> {
  const now = new Date();
  // sql 模板裸插值 Date 无列编码器会导致驱动序列化失败，需绑定格式化串并显式 cast（started_at 为 timestamptz）
  const nowText = formatDateTime(now);
  const [row] = await db.update(reportDeliveryRuns)
    .set({
      status: input.status,
      errorMessage: trimMessage(input.errorMessage),
      ...(input.payloadSummary !== undefined ? { payloadSummary: input.payloadSummary } : {}),
      ...(input.lastValue !== undefined ? { lastValue: input.lastValue } : {}),
      ...(input.triggered !== undefined ? { triggered: input.triggered } : {}),
      completedAt: now,
      durationMs: sql`greatest(0, extract(epoch from (${nowText}::timestamptz - coalesce(${reportDeliveryRuns.startedAt}, ${nowText}::timestamptz))) * 1000)::int`,
      nextRetryAt: null,
    })
    .where(eq(reportDeliveryRuns.id, input.runId))
    .returning();
  if (!row) throw new HTTPException(404, { message: '投递记录不存在' });
  return row;
}

export async function markDeliveryRunRetryable(input: {
  runId: number;
  attempt: number;
  maxAttempts: number;
  errorMessage: string;
  payloadSummary?: Record<string, unknown>;
}): Promise<typeof reportDeliveryRuns.$inferSelect> {
  if (input.attempt >= input.maxAttempts) {
    return finalizeDeliveryRun({
      runId: input.runId,
      status: 'failed',
      errorMessage: input.errorMessage,
      payloadSummary: input.payloadSummary,
    });
  }
  const nextRetryAt = computeScheduledRetryAt(input.attempt);
  const [row] = await db.update(reportDeliveryRuns)
    .set({
      status: 'pending',
      errorMessage: trimMessage(input.errorMessage),
      ...(input.payloadSummary !== undefined ? { payloadSummary: input.payloadSummary } : {}),
      nextRetryAt,
      completedAt: null,
    })
    .where(eq(reportDeliveryRuns.id, input.runId))
    .returning();
  if (!row) throw new HTTPException(404, { message: '投递记录不存在' });
  return row;
}

export async function listDueRetryRunIds(targetType: 'subscription' | 'alert' | 'sla'): Promise<number[]> {
  const rows = await db.select({ id: reportDeliveryRuns.id })
    .from(reportDeliveryRuns)
    .where(and(
      eq(reportDeliveryRuns.targetType, targetType),
      eq(reportDeliveryRuns.status, 'pending'),
      sql`${reportDeliveryRuns.nextRetryAt} is not null`,
      lte(reportDeliveryRuns.nextRetryAt, new Date()),
    ))
    .orderBy(reportDeliveryRuns.id);
  return rows.map((row) => row.id);
}

export async function loadLatestSubscriptionRuns(ids: number[]): Promise<Map<number, Pick<ReportDashboardSubscription, 'lastDeliveryAt' | 'lastDeliveryStatus' | 'lastDeliveryError'>>> {
  if (ids.length === 0) return new Map();
  const rows = await db.select()
    .from(reportDeliveryRuns)
    .where(and(eq(reportDeliveryRuns.targetType, 'subscription'), inArray(reportDeliveryRuns.subscriptionId, ids)))
    .orderBy(desc(reportDeliveryRuns.id));
  const map = new Map<number, Pick<ReportDashboardSubscription, 'lastDeliveryAt' | 'lastDeliveryStatus' | 'lastDeliveryError'>>();
  for (const row of rows) {
    if (!row.subscriptionId || map.has(row.subscriptionId)) continue;
    map.set(row.subscriptionId, {
      lastDeliveryAt: deliveryAt(row),
      lastDeliveryStatus: row.status,
      lastDeliveryError: row.errorMessage ?? null,
    });
  }
  return map;
}

export async function loadLatestAlertRuns(ids: number[]): Promise<Map<number, Pick<ReportAlertRule, 'lastDeliveryAt' | 'lastDeliveryStatus' | 'lastDeliveryError'>>> {
  if (ids.length === 0) return new Map();
  const rows = await db.select()
    .from(reportDeliveryRuns)
    .where(and(eq(reportDeliveryRuns.targetType, 'alert'), inArray(reportDeliveryRuns.alertRuleId, ids)))
    .orderBy(desc(reportDeliveryRuns.id));
  const map = new Map<number, Pick<ReportAlertRule, 'lastDeliveryAt' | 'lastDeliveryStatus' | 'lastDeliveryError'>>();
  for (const row of rows) {
    if (!row.alertRuleId || map.has(row.alertRuleId)) continue;
    map.set(row.alertRuleId, {
      lastDeliveryAt: deliveryAt(row),
      lastDeliveryStatus: row.status,
      lastDeliveryError: row.errorMessage ?? null,
    });
  }
  return map;
}

export function computeAlertRunTriggerType(
  source: 'manual' | 'scheduled',
  wasTriggered: boolean,
  triggered: boolean,
): ReportDeliveryTriggerType {
  if (!wasTriggered && triggered) return 'trigger';
  if (wasTriggered && !triggered) return 'recover';
  return source;
}

export function computeScheduleClaim(input: {
  cron: string;
  timezone: string;
  misfirePolicy: ReportScheduleMisfirePolicy;
  nextRunAt: Date;
  now?: Date;
}): { shouldExecute: boolean; nextRunAt: Date | null } {
  const now = input.now ?? new Date();
  const nextAfterStored = computeReportNextRun(input.cron, input.timezone, input.nextRunAt);
  const futureNextRunAt = computeReportNextRun(input.cron, input.timezone, now);
  const isMisfire = nextAfterStored !== null && nextAfterStored.getTime() <= now.getTime();
  if (isMisfire && input.misfirePolicy === 'skip') {
    return { shouldExecute: false, nextRunAt: futureNextRunAt };
  }
  return { shouldExecute: true, nextRunAt: futureNextRunAt };
}

export async function dispatchNotificationChannels(input: {
  tenantId: number | null;
  runId: number;
  attempt: number;
  channels: ReportNotifyChannel[];
  recipients?: string | null;
  webhookUrl?: string | null;
  createdBy?: number | null;
  title: string;
  text: string;
  html?: string | null;
  inAppType: 'info' | 'warning';
  payloadSummary?: Record<string, unknown>;
  isCancelRequested?: () => Promise<boolean>;
}): Promise<{ status: ReportDeliveryStatus; errorMessage: string | null }> {
  validateNotifyChannels(input.channels, input.recipients, input.webhookUrl, input.createdBy);
  const emailRecipients = input.channels.includes('email')
    ? parseRecipientEmails(input.recipients, true)
    : [];
  const emailTargets = await pendingEmailRecipients(input.runId, emailRecipients);
  const successfulChannels = await getSuccessfulChannels(input.runId);
  let anySuccess = false;
  let anyFailure = false;
  const errors: string[] = [];

  for (const channel of input.channels) {
    if (successfulChannels.has(channel)) {
      anySuccess = true;
      continue;
    }
    if (await input.isCancelRequested?.()) {
      return { status: anyFailure || anySuccess ? 'partial' : 'cancelled', errorMessage: anyFailure ? errors.join('；') : '任务已取消' };
    }
    const startedAt = Date.now();
    try {
      let status: ReportDeliveryStatus = 'success';
      let errorMessage: string | null = null;
      if (channel === 'inApp') {
        await sendInApp({ userIds: [input.createdBy!], title: input.title, content: input.text, type: input.inAppType });
      } else if (channel === 'email') {
        let successCount = 0;
        const failedRecipientIndexes: number[] = [];
        for (const target of emailTargets) {
          try {
            await sendEmail({ toEmail: target.email, subject: input.title, content: input.html ?? input.text });
            successCount++;
          } catch {
            failedRecipientIndexes.push(target.index);
          }
        }
        if (failedRecipientIndexes.length > 0) {
          status = successCount > 0 ? 'partial' : 'failed';
          errorMessage = failedRecipientIndexes.length === emailTargets.length
            ? '邮件发送全部失败'
            : `邮件部分失败：${failedRecipientIndexes.length}/${emailTargets.length}`;
        }
        input.payloadSummary = {
          ...(input.payloadSummary ?? {}),
          failedRecipientIndexes,
        };
      } else if (channel === 'webhook') {
        const webhookUrl = resolveReportSecret(input.webhookUrl);
        if (!webhookUrl) throw new Error('Webhook 地址无法解密');
        await sendWebhookNotification(webhookUrl, input.title, input.text);
      }
      await recordChannelAttempt({
        tenantId: input.tenantId,
        runId: input.runId,
        channel,
        attempt: input.attempt,
        status,
        durationMs: Math.max(0, Date.now() - startedAt),
        errorMessage,
        payloadSummary: {
          ...(input.payloadSummary ?? {}),
          ...(channel === 'email' ? {
            recipientCount: emailRecipients.length,
            attemptedRecipientCount: emailTargets.length,
            failedRecipientIndexes: (input.payloadSummary as { failedRecipientIndexes?: number[] } | undefined)?.failedRecipientIndexes ?? [],
          } : {}),
        },
      });
      if (status === 'success') anySuccess = true;
      else {
        anyFailure = true;
        if (errorMessage) errors.push(`${channel}：${errorMessage}`);
      }
    } catch (error) {
      anyFailure = true;
      const message = error instanceof Error ? error.message : String(error);
      errors.push(`${channel}：${message}`);
      await recordChannelAttempt({
        tenantId: input.tenantId,
        runId: input.runId,
        channel,
        attempt: input.attempt,
        status: 'failed',
        durationMs: Math.max(0, Date.now() - startedAt),
        errorMessage: message,
        payloadSummary: {
          ...(input.payloadSummary ?? {}),
          ...(channel === 'email' ? {
            recipientCount: emailRecipients.length,
            attemptedRecipientCount: emailTargets.length,
            failedRecipientIndexes: emailTargets.map((target) => target.index),
          } : {}),
        },
      });
    }
  }

  if (!anyFailure) return { status: 'success', errorMessage: null };
  return {
    status: anySuccess ? 'partial' : 'failed',
    errorMessage: errors.join('；').slice(0, 512),
  };
}

export function buildRunIdempotencyKey(parts: Array<string | number | null | undefined>): string {
  return parts.filter((part) => part !== null && part !== undefined && String(part) !== '').join(':').slice(0, 128);
}

export function requestedByUserId(): number | null {
  try {
    return currentUserOrNull()?.userId ?? null;
  } catch {
    return null;
  }
}
