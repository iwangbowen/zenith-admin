import { HTTPException } from 'hono/http-exception';
import { aggregateReportRows, compare as compareReportValue } from '@zenith/shared';
import { and, desc, eq, ilike, inArray, isNotNull, lte, or } from 'drizzle-orm';
import { db } from '../../db';
import { reportAlertRules, reportDeliveryRuns } from '../../db/schema';
import { pageOffset } from '../../lib/pagination';
import { escapeLike } from '../../lib/where-helpers';
import { formatDateTime, formatNullableDateTime } from '../../lib/datetime';
import { rethrowPgUniqueViolation } from '../../lib/db-errors';
import { currentUserOrNull } from '../../lib/context';
import { assertDatasetEvaluableGlobally, ensureDatasetExists, getDatasetData } from './report-dataset.service';
import {
  buildRunIdempotencyKey,
  claimRetryDeliveryRun,
  computeScheduleClaim,
  dispatchNotificationChannels,
  ensureDeliveryRun,
  ensureValidReportSchedule,
  finalizeDeliveryRun,
  listDueRetryRunIds,
  loadLatestAlertRuns,
  markDeliveryRunRetryable,
  parseRecipientEmails,
  REPORT_DEFAULT_TIMEZONE,
  requestedByUserId,
  resolveNextRunAt,
  startManualDeliveryRun,
  validateNotifyChannels,
} from './report-delivery.service';
import { reportCreateTenantId, reportScopedWhere, reportTenantScope } from './report-access';
import { maskReportSecret, prepareReportSecret } from './report-secrets';
import type { ReportAlertRuleRow, ReportDeliveryRunRow } from '../../db/schema';
import type {
  CreateReportAlertInput,
  ReportAlertAggregate,
  ReportAlertEvalHit,
  ReportAlertEvalResult,
  ReportAlertOp,
  ReportAlertRule,
  ReportDeliveryStatus,
  ReportNotifyChannel,
  UpdateReportAlertInput,
} from '@zenith/shared';

type AlertRowExt = ReportAlertRuleRow & {
  dataset?: { name: string } | null;
  latestDelivery?: Pick<ReportAlertRule, 'lastDeliveryAt' | 'lastDeliveryStatus' | 'lastDeliveryError'> | null;
};

type AlertEventType = 'trigger' | 'recover' | 'manual' | 'scheduled';

const OP_LABEL: Record<ReportAlertOp, string> = { gt: '>', gte: '≥', lt: '<', lte: '≤', eq: '=', neq: '≠' };
const SCHEDULE_MAX_ATTEMPTS = 3;

function trimText(value: unknown, maxLength = 512): string | null {
  if (value == null) return null;
  const text = String(value).trim();
  return text ? text.slice(0, maxLength) : null;
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function datasetFieldSet(
  fields: Array<{ name: string; type?: string; format?: { kind?: string } }> | undefined,
  computedFields: Array<{ name: string; type?: string; format?: { kind?: string } }> | undefined,
): Map<string, { type?: string; format?: { kind?: string } }> {
  const map = new Map<string, { type?: string; format?: { kind?: string } }>();
  for (const field of fields ?? []) map.set(field.name, field);
  for (const field of computedFields ?? []) map.set(field.name, field);
  return map;
}

function isNumericField(field: { type?: string; format?: { kind?: string } } | undefined): boolean {
  if (!field) return false;
  return field.type === 'number' || ['number', 'percent', 'currency'].includes(String(field.format?.kind ?? ''));
}

async function validateAlertDefinition(
  datasetId: number,
  field: string | null | undefined,
  groupByField: string | null | undefined,
  aggregate: ReportAlertAggregate,
): Promise<void> {
  await assertDatasetEvaluableGlobally(datasetId);
  const dataset = await ensureDatasetExists(datasetId);
  const fieldMap = datasetFieldSet(
    (dataset.fields ?? []) as Array<{ name: string; type?: string; format?: { kind?: string } }>,
    (dataset.computedFields ?? []) as Array<{ name: string; type?: string; format?: { kind?: string } }>,
  );
  if (groupByField && !fieldMap.has(groupByField)) {
    throw new HTTPException(400, { message: `分组字段不存在：${groupByField}` });
  }
  if (aggregate !== 'count') {
    if (!field) throw new HTTPException(400, { message: '非 count 聚合必须指定字段' });
    const meta = fieldMap.get(field);
    if (!meta) throw new HTTPException(400, { message: `聚合字段不存在：${field}` });
    if (!isNumericField(meta)) throw new HTTPException(400, { message: '非 count 聚合字段必须可数值化' });
  }
}

export function mapAlert(row: AlertRowExt): ReportAlertRule {
  return {
    id: row.id,
    name: row.name,
    datasetId: row.datasetId,
    datasetName: row.dataset?.name ?? null,
    field: row.field ?? null,
    groupByField: row.groupByField ?? null,
    aggregate: row.aggregate as ReportAlertAggregate,
    op: row.op as ReportAlertOp,
    threshold: row.threshold ?? 0,
    cron: row.cron ?? null,
    timezone: row.timezone ?? REPORT_DEFAULT_TIMEZONE,
    misfirePolicy: row.misfirePolicy,
    nextRunAt: formatNullableDateTime(row.nextRunAt),
    channels: (row.channels ?? []) as ReportNotifyChannel[],
    recipients: row.recipients ?? null,
    webhookUrl: maskReportSecret(row.webhookUrl),
    silenceMins: row.silenceMins ?? 60,
    notifyOnRecover: row.notifyOnRecover ?? false,
    enabled: row.enabled,
    lastCheckedAt: formatNullableDateTime(row.lastCheckedAt),
    lastTriggered: row.lastTriggered ?? null,
    lastValue: row.lastValue ?? null,
    lastNotifiedAt: formatNullableDateTime(row.lastNotifiedAt),
    lastDeliveryAt: row.latestDelivery?.lastDeliveryAt ?? formatNullableDateTime(row.lastDeliveryAt),
    lastDeliveryStatus: row.latestDelivery?.lastDeliveryStatus ?? row.lastDeliveryStatus ?? null,
    lastDeliveryError: row.latestDelivery?.lastDeliveryError ?? row.lastDeliveryError ?? null,
    remark: row.remark ?? null,
    createdBy: row.createdBy ?? null,
    createdAt: formatDateTime(row.createdAt),
    updatedAt: formatDateTime(row.updatedAt),
  };
}

export async function ensureAlertExists(id: number): Promise<ReportAlertRuleRow> {
  const [row] = await db.select().from(reportAlertRules)
    .where(reportScopedWhere(reportAlertRules, eq(reportAlertRules.id, id)))
    .limit(1);
  if (!row) throw new HTTPException(404, { message: '预警规则不存在' });
  return row;
}

export async function getAlert(id: number): Promise<ReportAlertRule> {
  const row = await db.query.reportAlertRules.findFirst({
    where: reportScopedWhere(reportAlertRules, eq(reportAlertRules.id, id)),
    with: { dataset: { columns: { name: true } } },
  });
  if (!row) throw new HTTPException(404, { message: '预警规则不存在' });
  const latestRunMap = await loadLatestAlertRuns([row.id]);
  return mapAlert({ ...row, latestDelivery: latestRunMap.get(row.id) ?? null });
}

export async function listAlerts(query: { page?: number; pageSize?: number; keyword?: string; datasetId?: number; enabled?: boolean }) {
  const { page = 1, pageSize = 20, keyword, datasetId, enabled } = query;
  const conds = [];
  const tenantScope = reportTenantScope(reportAlertRules);
  if (tenantScope) conds.push(tenantScope);
  if (keyword) {
    const kw = `%${escapeLike(keyword)}%`;
    conds.push(or(ilike(reportAlertRules.name, kw), ilike(reportAlertRules.remark, kw)));
  }
  if (datasetId) conds.push(eq(reportAlertRules.datasetId, datasetId));
  if (enabled !== undefined) conds.push(eq(reportAlertRules.enabled, enabled));
  const where = conds.length ? and(...conds) : undefined;
  const [total, rows] = await Promise.all([
    db.$count(reportAlertRules, where),
    db.query.reportAlertRules.findMany({
      where,
      with: { dataset: { columns: { name: true } } },
      orderBy: desc(reportAlertRules.id),
      limit: pageSize,
      offset: pageOffset(page, pageSize),
    }),
  ]);
  const latestRunMap = await loadLatestAlertRuns(rows.map((row) => row.id));
  return { list: rows.map((row) => mapAlert({ ...row, latestDelivery: latestRunMap.get(row.id) ?? null })), total, page, pageSize };
}

export async function createAlert(input: CreateReportAlertInput): Promise<ReportAlertRule> {
  await validateAlertDefinition(input.datasetId, input.field, input.groupByField, input.aggregate ?? 'sum');
  ensureValidReportSchedule(input.cron, input.timezone ?? REPORT_DEFAULT_TIMEZONE);
  validateNotifyChannels(input.channels as ReportNotifyChannel[] | undefined ?? [], input.recipients, input.webhookUrl, currentUserOrNull()?.userId ?? null);
  const webhookUrl = prepareReportSecret(input.webhookUrl, null);
  try {
    const [row] = await db.insert(reportAlertRules).values({
      tenantId: reportCreateTenantId(),
      name: input.name,
      datasetId: input.datasetId,
      field: input.field ?? null,
      groupByField: input.groupByField ?? null,
      aggregate: input.aggregate ?? 'sum',
      op: input.op ?? 'gt',
      threshold: input.threshold,
      cron: input.cron ?? null,
      timezone: input.timezone ?? REPORT_DEFAULT_TIMEZONE,
      misfirePolicy: input.misfirePolicy ?? 'fire_once',
      nextRunAt: resolveNextRunAt(input.cron ?? null, input.enabled ?? true, input.timezone ?? REPORT_DEFAULT_TIMEZONE),
      channels: (input.channels ?? []) as ReportNotifyChannel[],
      recipients: input.recipients,
      webhookUrl: webhookUrl ?? null,
      silenceMins: input.silenceMins ?? 60,
      notifyOnRecover: input.notifyOnRecover ?? false,
      enabled: input.enabled ?? true,
      remark: input.remark,
    }).returning();
    return mapAlert(row);
  } catch (error) {
    rethrowPgUniqueViolation(error, '预警规则名称已存在');
    throw error;
  }
}

export async function updateAlert(id: number, input: UpdateReportAlertInput): Promise<ReportAlertRule> {
  const current = await ensureAlertExists(id);
  const datasetId = input.datasetId ?? current.datasetId;
  const aggregate = (input.aggregate ?? current.aggregate) as ReportAlertAggregate;
  const field = input.field === undefined ? current.field : input.field;
  const groupByField = input.groupByField === undefined ? current.groupByField : input.groupByField;
  const cron = input.cron === undefined ? current.cron : input.cron;
  const timezone = input.timezone ?? current.timezone ?? REPORT_DEFAULT_TIMEZONE;
  const enabled = input.enabled ?? current.enabled;
  await validateAlertDefinition(datasetId, field, groupByField, aggregate);
  ensureValidReportSchedule(cron, timezone);
  validateNotifyChannels(
    (input.channels ?? current.channels ?? []) as ReportNotifyChannel[],
    input.recipients === undefined ? current.recipients : input.recipients,
    input.webhookUrl === undefined ? current.webhookUrl : input.webhookUrl,
    current.createdBy ?? null,
  );
  const webhookUrl = prepareReportSecret(input.webhookUrl, current.webhookUrl);
  const [row] = await db.update(reportAlertRules).set({
    name: input.name,
    datasetId: input.datasetId,
    field: input.field,
    groupByField: input.groupByField,
    aggregate: input.aggregate,
    op: input.op,
    threshold: input.threshold,
    cron: input.cron,
    timezone: input.timezone,
    misfirePolicy: input.misfirePolicy,
    nextRunAt: resolveNextRunAt(cron, enabled, timezone),
    channels: input.channels as ReportNotifyChannel[] | undefined,
    recipients: input.recipients,
    webhookUrl,
    silenceMins: input.silenceMins,
    notifyOnRecover: input.notifyOnRecover,
    enabled: input.enabled,
    remark: input.remark,
  }).where(eq(reportAlertRules.id, id)).returning();
  if (!row) throw new HTTPException(404, { message: '预警规则不存在' });
  return mapAlert(row);
}

export async function deleteAlert(id: number): Promise<void> {
  await ensureAlertExists(id);
  await db.delete(reportAlertRules).where(eq(reportAlertRules.id, id));
}

export async function batchSetAlertEnabled(ids: number[], enabled: boolean): Promise<number> {
  if (ids.length === 0) return 0;
  const rows = await db.query.reportAlertRules.findMany({
    where: reportScopedWhere(reportAlertRules, inArray(reportAlertRules.id, ids)),
  });
  for (const row of rows) {
    await db.update(reportAlertRules).set({
      enabled,
      nextRunAt: resolveNextRunAt(row.cron ?? null, enabled, row.timezone ?? REPORT_DEFAULT_TIMEZONE),
    }).where(eq(reportAlertRules.id, row.id));
  }
  return rows.length;
}

function runtimeHasNumericValue(rows: Record<string, unknown>[], field: string): boolean {
  return rows.some((row) => {
    const value = row[field];
    if (typeof value === 'number') return Number.isFinite(value);
    if (typeof value === 'string' && value.trim()) {
      const parsed = Number(value.trim());
      return Number.isFinite(parsed);
    }
    return false;
  });
}

export function evaluateGroups(
  rows: Record<string, unknown>[],
  groupByField: string,
  field: string | null | undefined,
  agg: ReportAlertAggregate,
  op: ReportAlertOp,
  threshold: number,
): { value: number; triggered: boolean; hits: ReportAlertEvalHit[] } {
  const groups = new Map<string, Record<string, unknown>[]>();
  for (const row of rows) {
    const key = String(row[groupByField] ?? '（空）');
    const bucket = groups.get(key);
    if (bucket) bucket.push(row);
    else groups.set(key, [row]);
  }
  const hits: ReportAlertEvalHit[] = [];
  const preferMax = op === 'gt' || op === 'gte';
  let extreme: number | null = null;
  for (const [group, groupRows] of groups) {
    const value = aggregateReportRows(groupRows, field, agg);
    if (compareReportValue(value, op, threshold)) hits.push({ group, value });
    if (extreme === null || (preferMax ? value > extreme : value < extreme)) extreme = value;
  }
  const value = hits.length
    ? (preferMax ? Math.max(...hits.map((item) => item.value)) : Math.min(...hits.map((item) => item.value)))
    : (extreme ?? 0);
  return { value, triggered: hits.length > 0, hits };
}

export function shouldNotifyTrigger(wasTriggered: boolean, silenceMins: number, lastNotifiedAt: Date | null, now: Date): boolean {
  if (!wasTriggered) return true;
  const silenceMs = Math.max(0, silenceMins) * 60_000;
  if (silenceMs === 0 || !lastNotifiedAt) return true;
  return now.getTime() - lastNotifiedAt.getTime() >= silenceMs;
}

function buildCondition(rule: ReportAlertRuleRow): string {
  const scope = rule.groupByField ? `按「${rule.groupByField}」分组，` : '';
  return `${scope}${rule.aggregate}(${rule.field ?? '行数'}) ${OP_LABEL[rule.op as ReportAlertOp] ?? rule.op} ${rule.threshold ?? 0}`;
}

function buildAlertMessage(summary: {
  ruleName: string;
  eventType: AlertEventType;
  value: number;
  condition: string;
  hitCount: number;
  checkedAt: string;
}): { title: string; text: string; html: string; inAppType: 'warning' | 'info' } {
  if (summary.eventType === 'recover') {
    const text = `预警规则「${summary.ruleName}」已恢复正常。\n当前值：${summary.value}\n条件：${summary.condition}\n恢复时间：${summary.checkedAt}`;
    return {
      title: `预警恢复 · ${summary.ruleName}`,
      text,
      html: `<h3 style="margin:0 0 12px">${escapeHtml(summary.ruleName)}</h3><p>状态已恢复正常。</p><p>当前值：${summary.value}</p><p>条件：${escapeHtml(summary.condition)}</p><p>恢复时间：${escapeHtml(summary.checkedAt)}</p>`,
      inAppType: 'info',
    };
  }
  const hitText = summary.hitCount > 0 ? `\n命中分组数：${summary.hitCount}` : '';
  const text = `预警规则「${summary.ruleName}」已触发。\n实际值：${summary.value}\n条件：${summary.condition}${hitText}\n触发时间：${summary.checkedAt}`;
  return {
    title: `数据预警 · ${summary.ruleName}`,
    text,
    html: `<h3 style="margin:0 0 12px">${escapeHtml(summary.ruleName)}</h3><p>预警已触发。</p><p>实际值：${summary.value}</p><p>条件：${escapeHtml(summary.condition)}</p>${summary.hitCount > 0 ? `<p>命中分组数：${summary.hitCount}</p>` : ''}<p>触发时间：${escapeHtml(summary.checkedAt)}</p>`,
    inAppType: 'warning',
  };
}

async function evaluateAlertState(row: ReportAlertRuleRow): Promise<{
  value: number;
  triggered: boolean;
  hits: ReportAlertEvalHit[];
  condition: string;
}> {
  await validateAlertDefinition(row.datasetId, row.field, row.groupByField, row.aggregate as ReportAlertAggregate);
  const data = await getDatasetData(row.datasetId, undefined, 5000, { scene: 'alert', sourceRefId: row.id });
  const fieldNames = new Set((data.fields ?? []).map((field) => field.name));
  if (row.groupByField && !fieldNames.has(row.groupByField)) {
    throw new HTTPException(400, { message: `分组字段不存在：${row.groupByField}` });
  }
  if (row.aggregate !== 'count' && row.field) {
    if (!fieldNames.has(row.field)) throw new HTTPException(400, { message: `聚合字段不存在：${row.field}` });
    if (data.rows.length > 0 && !runtimeHasNumericValue(data.rows, row.field)) {
      throw new HTTPException(400, { message: '非 count 聚合字段必须可数值化' });
    }
  }
  const agg = row.aggregate as ReportAlertAggregate;
  const op = row.op as ReportAlertOp;
  const threshold = row.threshold ?? 0;
  if (row.groupByField) {
    const grouped = evaluateGroups(data.rows, row.groupByField, row.field, agg, op, threshold);
    return { ...grouped, condition: buildCondition(row) };
  }
  const value = aggregateReportRows(data.rows, row.field, agg);
  return {
    value,
    triggered: compareReportValue(value, op, threshold),
    hits: [],
    condition: buildCondition(row),
  };
}

async function markAlertEvaluation(row: ReportAlertRuleRow, input: {
  checkedAt: Date;
  value: number;
  triggered: boolean;
  lastNotifiedAt?: Date | null;
  lastDeliveryAt?: Date;
  lastDeliveryStatus?: ReportDeliveryStatus;
  lastDeliveryError?: string | null;
}): Promise<void> {
  await db.update(reportAlertRules).set({
    lastCheckedAt: input.checkedAt,
    lastTriggered: input.triggered,
    lastValue: input.value,
    ...(input.lastNotifiedAt !== undefined ? { lastNotifiedAt: input.lastNotifiedAt } : {}),
    ...(input.lastDeliveryAt ? { lastDeliveryAt: input.lastDeliveryAt } : {}),
    ...(input.lastDeliveryStatus ? { lastDeliveryStatus: input.lastDeliveryStatus } : {}),
    ...(input.lastDeliveryError !== undefined ? { lastDeliveryError: input.lastDeliveryError } : {}),
  }).where(eq(reportAlertRules.id, row.id));
}

async function performAlertNotification(
  row: ReportAlertRuleRow,
  run: ReportDeliveryRunRow,
  summary: {
    eventType: AlertEventType;
    checkedAt: Date;
    value: number;
    triggered: boolean;
    condition: string;
    hitCount: number;
  },
  options?: { isCancelRequested?: () => Promise<boolean> },
): Promise<{ status: ReportDeliveryStatus; errorMessage: string | null }> {
  const message = buildAlertMessage({
    ruleName: row.name,
    eventType: summary.eventType,
    value: summary.value,
    condition: summary.condition,
    hitCount: summary.hitCount,
    checkedAt: formatDateTime(summary.checkedAt),
  });
  const payloadSummary = {
    ruleName: row.name,
    datasetId: row.datasetId,
    eventType: summary.eventType,
    checkedAt: formatDateTime(summary.checkedAt),
    value: summary.value,
    triggered: summary.triggered,
    hitCount: summary.hitCount,
    condition: summary.condition,
    channelCount: (row.channels ?? []).length,
    recipientCount: parseRecipientEmails(row.recipients, false).length,
  };
  const channelResult = await dispatchNotificationChannels({
    tenantId: row.tenantId ?? null,
    runId: run.id,
    attempt: run.attempt,
    channels: (row.channels ?? []) as ReportNotifyChannel[],
    recipients: row.recipients ?? null,
    webhookUrl: row.webhookUrl ?? null,
    createdBy: row.createdBy ?? null,
    title: message.title,
    text: message.text,
    html: message.html,
    inAppType: message.inAppType,
    payloadSummary,
    isCancelRequested: options?.isCancelRequested,
  });
  await finalizeDeliveryRun({
    runId: run.id,
    status: channelResult.status,
    errorMessage: channelResult.errorMessage,
    payloadSummary,
    lastValue: summary.value,
    triggered: summary.triggered,
  });
  return channelResult;
}

async function finalizeNoopAlertRun(
  row: ReportAlertRuleRow,
  input: {
    source: 'manual' | 'scheduled';
    checkedAt: Date;
    value: number;
    triggered: boolean;
    condition: string;
    hitCount: number;
    requestedBy: number | null;
    idempotencyKey: string;
  },
): Promise<ReportDeliveryRunRow> {
  const run = await ensureDeliveryRun({
    tenantId: row.tenantId ?? null,
    targetType: 'alert',
    triggerType: input.source,
    alertRuleId: row.id,
    datasetId: row.datasetId,
    targetName: row.name,
    idempotencyKey: input.idempotencyKey,
    requestedBy: input.requestedBy,
    payloadSummary: {
      source: input.source,
      eventType: input.triggered ? 'triggered_without_delivery' : 'normal',
      checkedAt: formatDateTime(input.checkedAt),
      value: input.value,
      hitCount: input.hitCount,
      condition: input.condition,
    },
    maxAttempts: 1,
  });
  const running = await startManualDeliveryRun({
    runId: run.id,
    attempt: 1,
    maxAttempts: 1,
    triggerType: input.source,
    payloadSummary: run.payloadSummary as Record<string, unknown>,
  });
  return finalizeDeliveryRun({
    runId: running.id,
    status: 'success',
    payloadSummary: {
      source: input.source,
      checkedAt: formatDateTime(input.checkedAt),
      value: input.value,
      triggered: input.triggered,
      hitCount: input.hitCount,
      condition: input.condition,
      suppressed: input.triggered,
    },
    lastValue: input.value,
    triggered: input.triggered,
  });
}

async function evaluateAndMaybeNotify(
  row: ReportAlertRuleRow,
  source: 'manual' | 'scheduled',
  idempotencyKey: string,
  requestedBy: number | null,
  options?: { isCancelRequested?: () => Promise<boolean>; maxAttempts?: number; taskAttempt?: number },
): Promise<ReportAlertEvalResult> {
  validateNotifyChannels((row.channels ?? []) as ReportNotifyChannel[], row.recipients, row.webhookUrl, row.createdBy);
  const evaluation = await evaluateAlertState(row);
  const now = new Date();
  const wasTriggered = row.lastTriggered === true;
  const shouldNotify = evaluation.triggered
    ? shouldNotifyTrigger(wasTriggered, row.silenceMins ?? 0, row.lastNotifiedAt ?? null, now)
    : Boolean(wasTriggered && row.notifyOnRecover);

  await markAlertEvaluation(row, {
    checkedAt: now,
    value: evaluation.value,
    triggered: evaluation.triggered,
  });

  if (!shouldNotify) {
    const run = await finalizeNoopAlertRun(row, {
      source,
      checkedAt: now,
      value: evaluation.value,
      triggered: evaluation.triggered,
      condition: evaluation.condition,
      hitCount: evaluation.hits.length,
      requestedBy,
      idempotencyKey,
    });
    await markAlertEvaluation(row, {
      checkedAt: now,
      value: evaluation.value,
      triggered: evaluation.triggered,
      lastDeliveryAt: now,
      lastDeliveryStatus: 'success',
      lastDeliveryError: null,
    });
    return {
      value: evaluation.value,
      triggered: evaluation.triggered,
      ...(row.groupByField ? { hits: evaluation.hits.slice(0, 10) } : {}),
      status: 'success',
      deliveryRunId: run.id,
    };
  }

  const eventType: AlertEventType = evaluation.triggered ? 'trigger' : 'recover';
  const run = await ensureDeliveryRun({
    tenantId: row.tenantId ?? null,
    targetType: 'alert',
    triggerType: eventType,
    alertRuleId: row.id,
    datasetId: row.datasetId,
    targetName: row.name,
    idempotencyKey,
    requestedBy,
    payloadSummary: {
      checkedAt: formatDateTime(now),
      eventType,
      value: evaluation.value,
      hitCount: evaluation.hits.length,
      condition: evaluation.condition,
    },
    maxAttempts: options?.maxAttempts ?? 1,
  });
  const running = await startManualDeliveryRun({
    runId: run.id,
    attempt: options?.taskAttempt ?? 1,
    maxAttempts: options?.maxAttempts ?? 1,
    triggerType: eventType,
    payloadSummary: run.payloadSummary as Record<string, unknown>,
  });
  const channelResult = await performAlertNotification(row, running, {
    eventType,
    checkedAt: now,
    value: evaluation.value,
    triggered: evaluation.triggered,
    condition: evaluation.condition,
    hitCount: evaluation.hits.length,
  }, { isCancelRequested: options?.isCancelRequested });
  if (channelResult.status === 'success') {
    await markAlertEvaluation(row, {
      checkedAt: now,
      value: evaluation.value,
      triggered: evaluation.triggered,
      lastNotifiedAt: now,
      lastDeliveryAt: now,
      lastDeliveryStatus: 'success',
      lastDeliveryError: null,
    });
  } else {
    await markAlertEvaluation(row, {
      checkedAt: now,
      value: evaluation.value,
      triggered: evaluation.triggered,
      lastDeliveryAt: now,
      lastDeliveryStatus: channelResult.status,
      lastDeliveryError: channelResult.errorMessage,
    });
  }
  return {
    value: evaluation.value,
    triggered: evaluation.triggered,
    ...(row.groupByField ? { hits: evaluation.hits.slice(0, 10) } : {}),
    status: channelResult.status,
    deliveryRunId: running.id,
  };
}

export async function runAlertTask(
  id: number,
  context: { taskId: number; attempt: number; maxAttempts: number; isCancelRequested?: () => Promise<boolean> },
): Promise<ReportAlertEvalResult> {
  const row = await ensureAlertExists(id);
  try {
    const result = await evaluateAndMaybeNotify(
      row,
      'manual',
      buildRunIdempotencyKey(['report-alert-evaluate', context.taskId]),
      requestedByUserId(),
      { isCancelRequested: context.isCancelRequested, maxAttempts: context.maxAttempts, taskAttempt: context.attempt },
    );
    if (result.status !== 'success') {
      const retryRow = await markDeliveryRunRetryable({
        runId: result.deliveryRunId!,
        attempt: context.attempt,
        maxAttempts: context.maxAttempts,
        errorMessage: '预警投递失败',
      });
      await db.update(reportAlertRules).set({
        lastDeliveryStatus: retryRow.status,
        lastDeliveryError: '预警投递失败',
      }).where(eq(reportAlertRules.id, row.id));
      throw new Error('预警投递失败');
    }
    return result;
  } catch (error) {
    const latest = await db.query.reportDeliveryRuns.findFirst({
      where: and(eq(reportDeliveryRuns.targetType, 'alert'), eq(reportDeliveryRuns.alertRuleId, row.id)),
      orderBy: desc(reportDeliveryRuns.id),
    });
    if (latest && latest.status === 'running') {
      const retryRow = await markDeliveryRunRetryable({
        runId: latest.id,
        attempt: context.attempt,
        maxAttempts: context.maxAttempts,
        errorMessage: error instanceof Error ? error.message : String(error),
      });
      await db.update(reportAlertRules).set({
        lastDeliveryAt: new Date(),
        lastDeliveryStatus: retryRow.status,
        lastDeliveryError: trimText(error) ?? '预警评估失败',
      }).where(eq(reportAlertRules.id, row.id));
    }
    throw error;
  }
}

async function processScheduledAlert(row: ReportAlertRuleRow, scheduledFor: Date): Promise<boolean> {
  const idempotencyKey = buildRunIdempotencyKey(['report-alert-evaluate', row.id, scheduledFor.getTime()]);
  try {
    const result = await evaluateAndMaybeNotify(
      row,
      'scheduled',
      idempotencyKey,
      null,
      { maxAttempts: SCHEDULE_MAX_ATTEMPTS, taskAttempt: 1 },
    );
    if (result.status === 'success') return result.triggered;
    const retryRow = await markDeliveryRunRetryable({
      runId: result.deliveryRunId!,
      attempt: 1,
      maxAttempts: SCHEDULE_MAX_ATTEMPTS,
      errorMessage: '预警投递失败',
    });
    await db.update(reportAlertRules).set({
      lastDeliveryStatus: retryRow.status,
      lastDeliveryError: '预警投递失败',
    }).where(eq(reportAlertRules.id, row.id));
    return result.triggered;
  } catch (error) {
    const [deliveryRun] = await db.select().from(reportDeliveryRuns)
      .where(eq(reportDeliveryRuns.idempotencyKey, idempotencyKey))
      .limit(1);
    const retryRow = deliveryRun?.status === 'running'
      ? await markDeliveryRunRetryable({
          runId: deliveryRun.id,
          attempt: Math.max(1, deliveryRun.attempt),
          maxAttempts: SCHEDULE_MAX_ATTEMPTS,
          errorMessage: error instanceof Error ? error.message : String(error),
        })
      : deliveryRun;
    await db.update(reportAlertRules).set({
      lastDeliveryAt: new Date(),
      lastDeliveryStatus: retryRow?.status ?? 'failed',
      lastDeliveryError: trimText(error) ?? '预警评估失败',
    }).where(eq(reportAlertRules.id, row.id));
    return false;
  }
}

async function retryAlertRun(runId: number): Promise<boolean> {
  const [run] = await db.select().from(reportDeliveryRuns).where(eq(reportDeliveryRuns.id, runId)).limit(1);
  if (!run?.alertRuleId) return false;
  const row = await ensureAlertExists(run.alertRuleId);
  const running = await claimRetryDeliveryRun(runId);
  if (!running) return false;
  const eventType = running.triggerType as AlertEventType;
  const payload = (running.payloadSummary ?? {}) as Record<string, unknown>;
  const checkedAt = new Date(String(payload.checkedAt ?? new Date().toISOString()));
  const value = Number(payload.value ?? 0);
  const hitCount = Number(payload.hitCount ?? 0);
  const condition = String(payload.condition ?? buildCondition(row));
  const channelResult = await performAlertNotification(row, running, {
    eventType,
    checkedAt,
    value,
    triggered: Boolean(running.triggered),
    condition,
    hitCount,
  });
  if (channelResult.status === 'success') {
    await markAlertEvaluation(row, {
      checkedAt,
      value,
      triggered: Boolean(running.triggered),
      lastNotifiedAt: new Date(),
      lastDeliveryAt: new Date(),
      lastDeliveryStatus: 'success',
      lastDeliveryError: null,
    });
    return Boolean(running.triggered);
  }
  const retryRow = await markDeliveryRunRetryable({
    runId,
    attempt: running.attempt,
    maxAttempts: running.maxAttempts,
    errorMessage: channelResult.errorMessage ?? '预警投递失败',
  });
  await db.update(reportAlertRules).set({
    lastDeliveryAt: new Date(),
    lastDeliveryStatus: retryRow.status,
    lastDeliveryError: channelResult.errorMessage ?? '预警投递失败',
  }).where(eq(reportAlertRules.id, row.id));
  return Boolean(running.triggered);
}

export async function dispatchDueAlerts(): Promise<{ checked: number; triggered: number }> {
  const now = new Date();
  const baseWhere = and(
    eq(reportAlertRules.enabled, true),
    isNotNull(reportAlertRules.nextRunAt),
    lte(reportAlertRules.nextRunAt, now),
  )!;
  const dueWhere = reportScopedWhere(reportAlertRules, baseWhere) ?? baseWhere;
  const rows = await db.select().from(reportAlertRules)
    .where(dueWhere);
  const retryRunIds = await listDueRetryRunIds('alert');
  let triggered = 0;
  let checked = 0;
  for (const retryRunId of retryRunIds) {
    if (await retryAlertRun(retryRunId)) triggered++;
  }
  for (const row of rows) {
    checked++;
    const nextRunAt = row.nextRunAt;
    if (!nextRunAt || !row.cron) continue;
    const claim = computeScheduleClaim({
      cron: row.cron,
      timezone: row.timezone ?? REPORT_DEFAULT_TIMEZONE,
      misfirePolicy: row.misfirePolicy ?? 'fire_once',
      nextRunAt,
      now,
    });
    const [claimed] = await db.update(reportAlertRules).set({ nextRunAt: claim.nextRunAt })
      .where(and(eq(reportAlertRules.id, row.id), eq(reportAlertRules.enabled, true), eq(reportAlertRules.nextRunAt, nextRunAt)))
      .returning();
    if (!claimed || !claim.shouldExecute) continue;
    if (await processScheduledAlert(row, nextRunAt)) triggered++;
  }
  return { checked, triggered };
}
