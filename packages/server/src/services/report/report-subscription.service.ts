import { requireRow } from '../../lib/db-assert';
import { buildListResult } from '../../lib/list-query';
import { HTTPException } from 'hono/http-exception';
import { and, desc, eq, inArray, lte, isNotNull, sql } from 'drizzle-orm';
import { aggregateReportRows, reportSubscriptionContract } from '@zenith/shared/report';
import type { QueryOutputOf } from '@zenith/shared/core';
import { db } from '../../db';
import { reportDashboardSubscriptions, reportDeliveryRuns } from '../../db/schema';
import { pageOffset } from '../../lib/pagination';
import { buildWhere, keywordCondition } from '../../lib/where-helpers';
import { formatDateTime, formatNullableDateTime } from '../../lib/datetime';
import { currentUserOrNull } from '../../lib/context';
import { escapeHtml } from '@zenith/shared/core';
import { trimNullableText } from '../../lib/text-utils';
import { assertDashboardEvaluableGlobally, ensureDashboardExists, getDashboardData } from './report-dashboard.service';
import { ensureDatasetExists } from './report-dataset.service';
import {
  buildRunIdempotencyKey,
  claimRetryDeliveryRun,
  computeScheduleClaim,
  ensureDeliveryRun,
  ensureValidReportSchedule,
  listDueRetryRunIds,
  loadLatestSubscriptionRuns,
  REPORT_DEFAULT_TIMEZONE,
  resolveNextRunAt,
  finalizeDeliveryRun,
  markDeliveryRunRetryable,
  parseRecipientEmails,
  requestedByUserId,
  startManualDeliveryRun,
  validateNotifyChannels,
} from './report-delivery.service';
import { dispatchReportNotification } from './report-delivery-dispatch';
import { reportCreateTenantId, reportScopedWhere, reportTenantScope } from './report-access';
import {
  maskReportSecret,
  prepareReportSecret,
} from './report-secrets';
import type { ReportDashboardSubscriptionRow, ReportDeliveryRunRow } from '../../db/schema';
import type { ReportDashboardSubscription, ReportWidget, ReportNotifyChannel, CreateReportSubscriptionInput, UpdateReportSubscriptionInput, ReportDeliveryStatus } from '@zenith/shared/report';
import {
  buildReportFieldMetadataMap,
  isNumericReportField,
} from './report-field-metadata';
import { runtimeHasNumericValue } from './report-dataset-shared';

type SubRowExt = ReportDashboardSubscriptionRow & {
  dashboard?: { name: string } | null;
  latestDelivery?: Pick<ReportDashboardSubscription, 'lastDeliveryAt' | 'lastDeliveryStatus' | 'lastDeliveryError'> | null;
};

interface SummaryLine {
  title: string;
  value: number;
  unit: string;
  deltaPct: number | null;
}

const SCHEDULE_MAX_ATTEMPTS = 3;

async function validateSubscriptionRuntimeConfig(dashboardId: number): Promise<void> {
  const dashboard = await ensureDashboardExists(dashboardId);
  await assertDashboardEvaluableGlobally(dashboardId);
  const datasetIds = Array.from(new Set(
    ((dashboard.widgets ?? []) as ReportWidget[])
      .map((widget) => widget.datasetId)
      .filter((id): id is number => typeof id === 'number' && Number.isInteger(id) && id > 0),
  ));
  const datasets = await Promise.all(datasetIds.map((id) => ensureDatasetExists(id)));
  const datasetMap = new Map(datasets.map((dataset) => [dataset.id, dataset]));
  for (const widget of (dashboard.widgets ?? []) as ReportWidget[]) {
    if (widget.type !== 'kpi' || !widget.datasetId) continue;
    const maybeDataset = datasetMap.get(widget.datasetId);
    const dataset = requireRow(maybeDataset, `订阅组件「${widget.title || widget.i}」绑定的数据集不存在`, 400);
    const fieldMap = buildReportFieldMetadataMap(
      dataset.fields as Array<{ name: string; type?: string; format?: { kind?: string } }> | undefined,
      dataset.computedFields as Array<{ name: string; type?: string; format?: { kind?: string } }> | undefined,
    );
    const aggregate = String(widget.options?.aggregate ?? 'sum');
    const validateField = (fieldName: string | undefined, label: string) => {
      if (aggregate === 'count' || !fieldName) return;
      if (!fieldMap.has(fieldName)) {
        throw new HTTPException(400, { message: `订阅组件「${widget.title || widget.i}」的${label}不存在：${fieldName}` });
      }
      if (!isNumericReportField(fieldMap.get(fieldName))) {
        throw new HTTPException(400, { message: `订阅组件「${widget.title || widget.i}」的${label}必须是可数值化字段` });
      }
    };
    validateField(widget.options?.valueField as string | undefined, '指标字段');
    validateField(widget.options?.compareField as string | undefined, '对比字段');
  }
}

export function mapSubscription(row: SubRowExt): ReportDashboardSubscription {
  return {
    id: row.id,
    dashboardId: row.dashboardId,
    dashboardName: row.dashboard?.name ?? null,
    cron: row.cron,
    timezone: row.timezone ?? REPORT_DEFAULT_TIMEZONE,
    misfirePolicy: row.misfirePolicy,
    channels: (row.channels ?? []) as ReportNotifyChannel[],
    recipients: row.recipients ?? null,
    webhookUrl: maskReportSecret(row.webhookUrl),
    enabled: row.enabled,
    remark: row.remark ?? null,
    lastRunAt: formatNullableDateTime(row.lastRunAt),
    nextRunAt: formatNullableDateTime(row.nextRunAt),
    lastDeliveryAt: row.latestDelivery?.lastDeliveryAt ?? formatNullableDateTime(row.lastDeliveryAt),
    lastDeliveryStatus: row.latestDelivery?.lastDeliveryStatus ?? row.lastDeliveryStatus ?? null,
    lastDeliveryError: row.latestDelivery?.lastDeliveryError ?? row.lastDeliveryError ?? null,
    createdBy: row.createdBy ?? null,
    createdAt: formatDateTime(row.createdAt),
    updatedAt: formatDateTime(row.updatedAt),
  };
}

export async function ensureSubscriptionExists(id: number): Promise<ReportDashboardSubscriptionRow> {
  const [rowOrUndefined] = await db.select().from(reportDashboardSubscriptions)
    .where(reportScopedWhere(reportDashboardSubscriptions, eq(reportDashboardSubscriptions.id, id)))
    .limit(1);
  const row = requireRow(rowOrUndefined, '订阅不存在');
  return row;
}

export async function listSubscriptions(query: QueryOutputOf<typeof reportSubscriptionContract.list>) {
  const { page, pageSize, keyword, dashboardId } = query;
  const conds = [];
  const tenantScope = reportTenantScope(reportDashboardSubscriptions);
  if (tenantScope) conds.push(tenantScope);
  conds.push(keywordCondition(keyword, [reportDashboardSubscriptions.cron, reportDashboardSubscriptions.remark], 'ilike'));
  if (dashboardId) conds.push(eq(reportDashboardSubscriptions.dashboardId, dashboardId));
  if (query.enabled !== undefined) conds.push(eq(reportDashboardSubscriptions.enabled, query.enabled));
  const where = buildWhere(...conds);
  return buildListResult({
    page,
    pageSize,
    count: () => db.$count(reportDashboardSubscriptions, where),
    rows: async () => {
      const rows = await db.query.reportDashboardSubscriptions.findMany({
      where,
      with: { dashboard: { columns: { name: true } } },
      orderBy: desc(reportDashboardSubscriptions.id),
      limit: pageSize,
      offset: pageOffset(page, pageSize),
      });
      const latestRunMap = await loadLatestSubscriptionRuns(rows.map((row) => row.id));
      return rows.map((row) => mapSubscription({ ...row, latestDelivery: latestRunMap.get(row.id) ?? null }));
    },
  });
}

export async function createSubscription(input: CreateReportSubscriptionInput): Promise<ReportDashboardSubscription> {
  await ensureDashboardExists(input.dashboardId);
  await validateSubscriptionRuntimeConfig(input.dashboardId);
  ensureValidReportSchedule(input.cron, input.timezone ?? REPORT_DEFAULT_TIMEZONE);
  validateNotifyChannels(input.channels as ReportNotifyChannel[] | undefined ?? [], input.recipients, input.webhookUrl, currentUserOrNull()?.userId ?? null);
  const webhookUrl = prepareReportSecret(input.webhookUrl, null);
  const [row] = await db.insert(reportDashboardSubscriptions).values({
    tenantId: reportCreateTenantId(),
    dashboardId: input.dashboardId,
    cron: input.cron,
    timezone: input.timezone ?? REPORT_DEFAULT_TIMEZONE,
    misfirePolicy: input.misfirePolicy ?? 'fire_once',
    nextRunAt: resolveNextRunAt(input.cron, input.enabled ?? true, input.timezone ?? REPORT_DEFAULT_TIMEZONE),
    channels: (input.channels ?? []) as ReportNotifyChannel[],
    recipients: input.recipients,
    webhookUrl: webhookUrl ?? null,
    enabled: input.enabled ?? true,
    remark: input.remark,
  }).returning();
  return mapSubscription(row);
}

export async function updateSubscription(id: number, input: UpdateReportSubscriptionInput): Promise<ReportDashboardSubscription> {
  const current = await ensureSubscriptionExists(id);
  const dashboardId = input.dashboardId ?? current.dashboardId;
  const timezone = input.timezone ?? current.timezone ?? REPORT_DEFAULT_TIMEZONE;
  const cron = input.cron ?? current.cron;
  const enabled = input.enabled ?? current.enabled;
  await ensureDashboardExists(dashboardId);
  await validateSubscriptionRuntimeConfig(dashboardId);
  ensureValidReportSchedule(cron, timezone);
  validateNotifyChannels(
    (input.channels ?? current.channels ?? []) as ReportNotifyChannel[],
    input.recipients === undefined ? current.recipients : input.recipients,
    input.webhookUrl === undefined ? current.webhookUrl : input.webhookUrl,
    current.createdBy ?? currentUserOrNull()?.userId ?? null,
  );
  const webhookUrl = prepareReportSecret(input.webhookUrl, current.webhookUrl);
  const [rowOrUndefined] = await db.update(reportDashboardSubscriptions).set({
    dashboardId: input.dashboardId,
    cron: input.cron,
    timezone: input.timezone,
    misfirePolicy: input.misfirePolicy,
    nextRunAt: resolveNextRunAt(cron, enabled, timezone),
    channels: input.channels as ReportNotifyChannel[] | undefined,
    recipients: input.recipients,
    webhookUrl,
    enabled: input.enabled,
    remark: input.remark,
  }).where(eq(reportDashboardSubscriptions.id, id)).returning();
  const row = requireRow(rowOrUndefined, '订阅不存在');
  return mapSubscription(row);
}

export async function deleteSubscription(id: number): Promise<void> {
  await ensureSubscriptionExists(id);
  await db.delete(reportDashboardSubscriptions).where(eq(reportDashboardSubscriptions.id, id));
}

export async function batchSetSubscriptionEnabled(ids: number[], enabled: boolean): Promise<number> {
  if (ids.length === 0) return 0;
  const scoped = reportScopedWhere(reportDashboardSubscriptions, inArray(reportDashboardSubscriptions.id, ids));
  // 停用：所有行取值一致（nextRunAt 恒为 null），单条 UPDATE 原子完成，审计列由 drizzle 自动维护
  if (!enabled) {
    const rows = await db.update(reportDashboardSubscriptions)
      .set({ enabled: false, nextRunAt: null })
      .where(scoped)
      .returning({ id: reportDashboardSubscriptions.id });
    return rows.length;
  }
  const rows = await db.query.reportDashboardSubscriptions.findMany({ where: scoped });
  if (rows.length === 0) return 0;
  // 启用：每行 nextRunAt 由各自 cron/时区决定，单条 UPDATE ... FROM (VALUES ...) 原子写入，替代逐条 UPDATE。
  // 手写 SQL 不经过 drizzle 的 $onUpdate 与审计 Proxy，updated_at / updated_by 必须显式赋值
  const user = currentUserOrNull();
  const values = sql.join(rows.map((row) => sql`(${row.id}::int, ${
    resolveNextRunAt(row.cron, true, row.timezone ?? REPORT_DEFAULT_TIMEZONE)
  }::timestamptz)`), sql`, `);
  await db.execute(sql`
    update ${reportDashboardSubscriptions} as s
    set enabled = true, next_run_at = v.next_run_at, updated_at = now(), updated_by = ${user?.userId ?? null}
    from (values ${values}) as v(id, next_run_at)
    where s.id = v.id
  `);
  return rows.length;
}

function trendText(deltaPct: number | null): string {
  if (deltaPct === null) return '';
  if (deltaPct > 0) return `（较上期 ↑ ${deltaPct.toFixed(1)}%）`;
  if (deltaPct < 0) return `（较上期 ↓ ${Math.abs(deltaPct).toFixed(1)}%）`;
  return '（较上期持平）';
}

function trendHtml(deltaPct: number | null): string {
  if (deltaPct === null) return '';
  if (deltaPct > 0) return ` <span style="color:#f5222d">▲ ${deltaPct.toFixed(1)}%</span>`;
  if (deltaPct < 0) return ` <span style="color:#52c41a">▼ ${Math.abs(deltaPct).toFixed(1)}%</span>`;
  return ' <span style="color:#8c8c8c">— 持平</span>';
}

async function buildSummary(row: ReportDashboardSubscriptionRow): Promise<{
  title: string;
  text: string;
  html: string;
  snapshot: Record<string, number>;
  payloadSummary: Record<string, unknown>;
}> {
  await validateSubscriptionRuntimeConfig(row.dashboardId);
  const dashboard = await ensureDashboardExists(row.dashboardId);
  const widgets = (dashboard.widgets ?? []) as ReportWidget[];
  const data = await getDashboardData(widgets, {}, undefined, undefined, row.id);
  const failedWidget = Object.values(data).find((item) => item.error);
  if (failedWidget?.error) {
    throw new HTTPException(400, { message: `订阅取数失败：${failedWidget.error.message}` });
  }
  const prevSnapshot = (row.lastSummary ?? {}) as Record<string, number>;
  const lines: SummaryLine[] = [];
  const snapshot: Record<string, number> = {};
  for (const widget of widgets) {
    if (widget.type !== 'kpi' || !widget.datasetId) continue;
    const widgetData = data[widget.i]?.data;
    if (!widgetData) continue;
    const aggregate = String(widget.options?.aggregate ?? 'sum');
    const valueField = widget.options?.valueField as string | undefined;
    const compareField = widget.options?.compareField as string | undefined;
    const resultFieldNames = new Set((widgetData.fields ?? []).map((field) => field.name));
    const validateRuntimeField = (fieldName: string | undefined, label: string) => {
      if (aggregate === 'count' || !fieldName) return;
      if (!resultFieldNames.has(fieldName)) {
        throw new HTTPException(400, { message: `订阅组件「${widget.title || widget.i}」的${label}不存在：${fieldName}` });
      }
      if (widgetData.rows.length > 0 && !runtimeHasNumericValue(widgetData.rows, fieldName)) {
        throw new HTTPException(400, { message: `订阅组件「${widget.title || widget.i}」的${label}不是可数值化字段` });
      }
    };
    validateRuntimeField(valueField, '指标字段');
    validateRuntimeField(compareField, '对比字段');
    const value = aggregateReportRows(widgetData.rows, valueField, aggregate as never);
    const compareValue = compareField ? aggregateReportRows(widgetData.rows, compareField, aggregate as never) : undefined;
    const prev = prevSnapshot[widget.i];
    const deltaPct = typeof prev === 'number' && prev !== 0 ? ((value - prev) / Math.abs(prev)) * 100 : null;
    lines.push({ title: widget.title, value, unit: String(widget.options?.unit ?? ''), deltaPct });
    snapshot[widget.i] = value;
    if (compareValue !== undefined) snapshot[`${widget.i}:compare`] = compareValue;
  }
  const baseUrl = (process.env.APP_URL ?? process.env.VITE_API_BASE_URL ?? '').replace(/\/$/, '');
  const link = `${baseUrl}/report/dashboards/${dashboard.id}/view`;
  const title = `报表推送 · ${dashboard.name}`;
  const text = lines.length
    ? `${lines.map((line) => `· ${line.title}：${line.value}${line.unit}${trendText(line.deltaPct)}`).join('\n')}\n\n查看完整报表：${link}`
    : `（该报表暂无指标卡）\n\n查看完整报表：${link}`;
  const html = [
    `<h3 style="margin:0 0 12px">${escapeHtml(dashboard.name)}</h3>`,
    lines.length
      ? `<table style="border-collapse:collapse">${lines.map((line) =>
        `<tr><td style="padding:4px 16px 4px 0;color:#595959">${escapeHtml(line.title)}</td>` +
        `<td style="padding:4px 0;font-weight:600">${line.value}${escapeHtml(line.unit)}${trendHtml(line.deltaPct)}</td></tr>`).join('')}</table>`
      : '<p style="color:#8c8c8c">（该报表暂无指标卡）</p>',
    `<p style="margin-top:16px"><a href="${escapeHtml(link)}">查看完整报表 →</a></p>`,
  ].join('');
  return {
    title,
    text,
    html,
    snapshot,
    payloadSummary: {
      dashboardId: dashboard.id,
      dashboardName: dashboard.name,
      widgetCount: lines.length,
      channelCount: (row.channels ?? []).length,
      recipientCount: parseRecipientEmails(row.recipients, false).length,
    },
  };
}

async function performSubscriptionDelivery(
  row: ReportDashboardSubscriptionRow,
  run: ReportDeliveryRunRow,
  options?: { isCancelRequested?: () => Promise<boolean> },
): Promise<{ status: ReportDeliveryStatus; errorMessage: string | null; snapshot?: Record<string, number> }> {
  const summary = await buildSummary(row);
  const channelResult = await dispatchReportNotification({
    tenantId: row.tenantId ?? null,
    runId: run.id,
    attempt: run.attempt,
    channels: (row.channels ?? []) as ReportNotifyChannel[],
    recipients: row.recipients ?? null,
    webhookUrl: row.webhookUrl ?? null,
    createdBy: row.createdBy ?? null,
    title: summary.title,
    text: summary.text,
    html: summary.html,
    inAppType: 'info',
    payloadSummary: summary.payloadSummary,
    isCancelRequested: options?.isCancelRequested,
  });
  await finalizeDeliveryRun({
    runId: run.id,
    status: channelResult.status,
    errorMessage: channelResult.errorMessage,
    payloadSummary: { ...summary.payloadSummary, status: channelResult.status },
  });
  const now = new Date();
  await db.update(reportDashboardSubscriptions).set({
    lastDeliveryAt: now,
    lastDeliveryStatus: channelResult.status,
    lastDeliveryError: channelResult.errorMessage,
    ...(channelResult.status === 'success'
      ? { lastRunAt: now, lastSummary: summary.snapshot }
      : {}),
  }).where(eq(reportDashboardSubscriptions.id, row.id));
  return { status: channelResult.status, errorMessage: channelResult.errorMessage, snapshot: summary.snapshot };
}

export async function runSubscriptionTask(
  id: number,
  context: { taskId: number; attempt: number; maxAttempts: number; isCancelRequested?: () => Promise<boolean> },
): Promise<{ runId: number; status: ReportDeliveryStatus; message: string }> {
  const row = await ensureSubscriptionExists(id);
  validateNotifyChannels((row.channels ?? []) as ReportNotifyChannel[], row.recipients, row.webhookUrl, row.createdBy);
  const run = await ensureDeliveryRun({
    tenantId: row.tenantId ?? null,
    targetType: 'subscription',
    triggerType: 'manual',
    subscriptionId: row.id,
    dashboardId: row.dashboardId,
    targetName: `订阅 · ${row.id}`,
    idempotencyKey: buildRunIdempotencyKey(['report-subscription-deliver', context.taskId]),
    requestedBy: requestedByUserId(),
    payloadSummary: {
      dashboardId: row.dashboardId,
      channelCount: (row.channels ?? []).length,
      recipientCount: parseRecipientEmails(row.recipients, false).length,
    },
    maxAttempts: context.maxAttempts,
  });
  const runningRun = await startManualDeliveryRun({
    runId: run.id,
    attempt: context.attempt,
    maxAttempts: context.maxAttempts,
    triggerType: 'manual',
    payloadSummary: run.payloadSummary as Record<string, unknown>,
  });
  try {
    const delivery = await performSubscriptionDelivery(row, runningRun, { isCancelRequested: context.isCancelRequested });
    if (delivery.status !== 'success') {
      const retryRow = await markDeliveryRunRetryable({
        runId: runningRun.id,
        attempt: runningRun.attempt,
        maxAttempts: context.maxAttempts,
        errorMessage: delivery.errorMessage ?? '订阅推送失败',
        payloadSummary: { status: delivery.status },
      });
      await db.update(reportDashboardSubscriptions).set({
        lastDeliveryStatus: retryRow.status,
        lastDeliveryError: delivery.errorMessage ?? '订阅推送失败',
      }).where(eq(reportDashboardSubscriptions.id, row.id));
      throw new Error(delivery.errorMessage ?? '订阅推送失败');
    }
    return { runId: runningRun.id, status: delivery.status, message: '订阅推送成功' };
  } catch (error) {
    if (error instanceof Error && (error.message === '任务已取消' || error.name === 'AbortError')) {
      await finalizeDeliveryRun({ runId: runningRun.id, status: 'cancelled', errorMessage: '任务已取消' });
      await db.update(reportDashboardSubscriptions).set({
        lastDeliveryAt: new Date(),
        lastDeliveryStatus: 'cancelled',
        lastDeliveryError: '任务已取消',
      }).where(eq(reportDashboardSubscriptions.id, row.id));
      throw error;
    }
    const retryRow = await markDeliveryRunRetryable({
      runId: runningRun.id,
      attempt: runningRun.attempt,
      maxAttempts: context.maxAttempts,
      errorMessage: error instanceof Error ? error.message : String(error),
    });
    await db.update(reportDashboardSubscriptions).set({
      lastDeliveryAt: new Date(),
      lastDeliveryStatus: retryRow.status,
      lastDeliveryError: trimNullableText(error) ?? '订阅推送失败',
    }).where(eq(reportDashboardSubscriptions.id, row.id));
    throw error;
  }
}

async function claimScheduledSubscription(row: ReportDashboardSubscriptionRow, now: Date): Promise<{ runId: number } | null> {
  if (!row.nextRunAt || !row.cron) return null;
  const claim = computeScheduleClaim({
    cron: row.cron,
    timezone: row.timezone ?? REPORT_DEFAULT_TIMEZONE,
    misfirePolicy: row.misfirePolicy ?? 'fire_once',
    nextRunAt: row.nextRunAt,
    now,
  });
  const [claimed] = await db.update(reportDashboardSubscriptions).set({
    nextRunAt: claim.nextRunAt,
  }).where(and(
    eq(reportDashboardSubscriptions.id, row.id),
    eq(reportDashboardSubscriptions.enabled, true),
    eq(reportDashboardSubscriptions.nextRunAt, row.nextRunAt),
  )).returning();
  if (!claimed) return null;
  if (!claim.shouldExecute) return { runId: 0 };
  const run = await ensureDeliveryRun({
    tenantId: row.tenantId ?? null,
    targetType: 'subscription',
    triggerType: 'scheduled',
    subscriptionId: row.id,
    dashboardId: row.dashboardId,
    targetName: `订阅 · ${row.id}`,
    idempotencyKey: buildRunIdempotencyKey(['report-subscription-deliver', row.id, 'scheduled', row.nextRunAt.getTime()]),
    requestedBy: null,
    payloadSummary: {
      scheduledFor: formatDateTime(row.nextRunAt),
      dashboardId: row.dashboardId,
      channelCount: (row.channels ?? []).length,
      recipientCount: parseRecipientEmails(row.recipients, false).length,
    },
    maxAttempts: SCHEDULE_MAX_ATTEMPTS,
  });
  return { runId: run.id };
}

async function processScheduledRun(runId: number, row: ReportDashboardSubscriptionRow): Promise<boolean> {
  const [existingRun] = await db.select().from(reportDeliveryRuns).where(eq(reportDeliveryRuns.id, runId)).limit(1);
  const runningRun = existingRun?.attempt
    ? await claimRetryDeliveryRun(runId)
    : await startManualDeliveryRun({
      runId,
      attempt: 1,
      maxAttempts: existingRun?.maxAttempts ?? SCHEDULE_MAX_ATTEMPTS,
      triggerType: 'scheduled',
      payloadSummary: (existingRun?.payloadSummary ?? {}) as Record<string, unknown>,
    });
  if (!runningRun) return false;
  try {
    validateNotifyChannels((row.channels ?? []) as ReportNotifyChannel[], row.recipients, row.webhookUrl, row.createdBy);
    const delivery = await performSubscriptionDelivery(row, runningRun);
    if (delivery.status !== 'success') {
      const retryRow = await markDeliveryRunRetryable({
        runId,
        attempt: runningRun.attempt,
        maxAttempts: runningRun.maxAttempts,
        errorMessage: delivery.errorMessage ?? '订阅推送失败',
        payloadSummary: { status: delivery.status },
      });
      await db.update(reportDashboardSubscriptions).set({
        lastDeliveryAt: new Date(),
        lastDeliveryStatus: retryRow.status,
        lastDeliveryError: delivery.errorMessage ?? '订阅推送失败',
      }).where(eq(reportDashboardSubscriptions.id, row.id));
      return false;
    }
    return true;
  } catch (error) {
    await markDeliveryRunRetryable({
      runId,
      attempt: runningRun.attempt,
      maxAttempts: runningRun.maxAttempts,
      errorMessage: error instanceof Error ? error.message : String(error),
    });
    await db.update(reportDashboardSubscriptions).set({
      lastDeliveryAt: new Date(),
      lastDeliveryStatus: runningRun.attempt >= runningRun.maxAttempts ? 'failed' : 'pending',
      lastDeliveryError: trimNullableText(error) ?? '订阅推送失败',
    }).where(eq(reportDashboardSubscriptions.id, row.id));
    return false;
  }
}

export async function dispatchDueSubscriptions(): Promise<{ checked: number; pushed: number }> {
  const now = new Date();
  const baseWhere = and(
    eq(reportDashboardSubscriptions.enabled, true),
    isNotNull(reportDashboardSubscriptions.nextRunAt),
    lte(reportDashboardSubscriptions.nextRunAt, now),
  )!;
  const dueWhere = reportScopedWhere(reportDashboardSubscriptions, baseWhere) ?? baseWhere;
  const dueSubscriptions = await db.select()
    .from(reportDashboardSubscriptions)
    .where(dueWhere);
  const retryRunIds = await listDueRetryRunIds('subscription');
  let pushed = 0;
  for (const retryRunId of retryRunIds) {
    const [run] = await db.select().from(reportDeliveryRuns).where(eq(reportDeliveryRuns.id, retryRunId)).limit(1);
    if (!run?.subscriptionId) continue;
    const row = await ensureSubscriptionExists(run.subscriptionId);
    if (await processScheduledRun(retryRunId, row)) pushed++;
  }
  let checked = 0;
  for (const row of dueSubscriptions) {
    if (!row.nextRunAt || row.nextRunAt.getTime() > now.getTime()) continue;
    checked++;
    const claimed = await claimScheduledSubscription(row, now);
    if (!claimed || claimed.runId === 0) continue;
    if (await processScheduledRun(claimed.runId, row)) pushed++;
  }
  return { checked, pushed };
}
