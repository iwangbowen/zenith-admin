import { reportSlaContract } from '@zenith/shared/report';
import type { QueryOutputOf } from '@zenith/shared/core';
import { requireRow } from '../../lib/db-assert';
import { buildListResult } from '../../lib/list-query';
import dayjs from 'dayjs';
import { and, desc, eq, gte, inArray, isNotNull, isNull, lte, or, sql } from 'drizzle-orm';
import type { CreateReportSlaRuleInput, ReportSlaRule, ReportSlaType, ReportSlaViolation, UpdateReportSlaRuleInput, UpdateReportSlaViolationInput } from '@zenith/shared/report';
import { db } from '../../db';
import {
  reportDatasetExecutionLogs,
  reportDqScores,
  reportMaterializationSnapshots,
  reportSlaRules,
  reportSlaViolations,
} from '../../db/schema';
import { currentUserId, runWithCurrentUser } from '../../lib/context';
import { rethrowPgUniqueViolation } from '../../lib/db-errors';
import { formatDateTime, formatNullableDateTime, formatTimestamps } from '../../lib/datetime';
import { pageOffset } from '../../lib/pagination';
import { mapAsyncTask, submitAsyncTask } from '../../lib/task-center';
import { ensureDatasetExists } from './report-dataset.service';
import { dueCronFireTime, loadScheduleActor } from './report-schedule-shared';
import {
  dispatchNotificationChannels,
  ensureDeliveryRun,
  ensureValidReportSchedule,
  ensureValidReportTimezone,
  finalizeDeliveryRun,
  startManualDeliveryRun,
  validateNotifyChannels,
} from './report-delivery.service';
import { reportScopedWhere, reportTenantScope } from './report-access';
import { ensureReportResourceAccess, listAccessibleReportResourceIds } from './report-resource-acl.service';
import { maskReportSecret, prepareReportSecret } from './report-secrets';
import { buildWhere } from '../../lib/where-helpers';

type SlaRuleRow = typeof reportSlaRules.$inferSelect;
type SlaViolationRow = typeof reportSlaViolations.$inferSelect;

export function isSlaThresholdViolated(type: ReportSlaType, observedValue: number, targetValue: number): boolean {
  return type === 'freshness' || type === 'query_latency_p95'
    ? observedValue > targetValue
    : observedValue < targetValue;
}

export function shouldNotifySlaViolation(
  lastNotifiedAt: Date | null,
  silenceMins: number,
  now = new Date(),
): boolean {
  return !lastNotifiedAt || silenceMins === 0 || dayjs(now).diff(lastNotifiedAt, 'minute', true) >= silenceMins;
}

export function mapReportSlaRule(row: SlaRuleRow): ReportSlaRule {
  return {
    id: row.id,
    tenantId: row.tenantId ?? null,
    datasetId: row.datasetId,
    name: row.name,
    type: row.type,
    targetValue: row.targetValue,
    warningValue: row.warningValue ?? null,
    windowMinutes: row.windowMinutes,
    cron: row.cron ?? null,
    timezone: row.timezone,
    severity: row.severity,
    channels: row.channels,
    recipients: row.recipients ?? null,
    webhookUrl: maskReportSecret(row.webhookUrl),
    silenceMins: row.silenceMins,
    enabled: row.enabled,
    lastEvaluatedAt: formatNullableDateTime(row.lastEvaluatedAt),
    lastNotifiedAt: formatNullableDateTime(row.lastNotifiedAt),
    createdBy: row.createdBy ?? null,
    updatedBy: row.updatedBy ?? null,
    ...formatTimestamps(row),
  };
}

export function mapReportSlaViolation(row: SlaViolationRow): ReportSlaViolation {
  return {
    id: row.id,
    tenantId: row.tenantId ?? null,
    ruleId: row.ruleId,
    datasetId: row.datasetId,
    status: row.status,
    observedValue: row.observedValue,
    targetValue: row.targetValue,
    windowStartedAt: formatDateTime(row.windowStartedAt),
    windowEndedAt: formatDateTime(row.windowEndedAt),
    detail: row.detail ?? null,
    acknowledgedAt: formatNullableDateTime(row.acknowledgedAt),
    acknowledgedBy: row.acknowledgedBy ?? null,
    resolvedAt: formatNullableDateTime(row.resolvedAt),
    resolvedBy: row.resolvedBy ?? null,
    resolutionNote: row.resolutionNote ?? null,
    ...formatTimestamps(row),
  };
}

async function ensureSlaRule(id: number, role: 'viewer' | 'editor' = 'viewer'): Promise<SlaRuleRow> {
  const rowOrUndefined = await db.query.reportSlaRules.findFirst({
    where: reportScopedWhere(reportSlaRules, eq(reportSlaRules.id, id)),
  });
  const row = requireRow(rowOrUndefined, 'SLA 规则不存在');
  await ensureReportResourceAccess('dataset', row.datasetId, role);
  return row;
}

async function validateSlaInput(input: CreateReportSlaRuleInput | UpdateReportSlaRuleInput, existing?: SlaRuleRow) {
  const datasetIdOrUndefined = input.datasetId ?? existing?.datasetId;
  const datasetId = requireRow(datasetIdOrUndefined, 'SLA 规则缺少数据集', 400);
  const dataset = await ensureDatasetExists(datasetId);
  await ensureReportResourceAccess('dataset', datasetId, 'editor');
  const timezone = input.timezone ?? existing?.timezone ?? 'Asia/Shanghai';
  ensureValidReportTimezone(timezone);
  ensureValidReportSchedule(input.cron === undefined ? existing?.cron : input.cron, timezone);
  const channels = input.channels ?? existing?.channels ?? [];
  const recipients = input.recipients === undefined ? existing?.recipients : input.recipients;
  const webhookUrl = input.webhookUrl === undefined || input.webhookUrl === '******'
    ? existing?.webhookUrl
    : input.webhookUrl;
  validateNotifyChannels(channels, recipients, webhookUrl, existing?.createdBy ?? currentUserId());
  return dataset;
}

export async function listReportSlaRules(query: QueryOutputOf<typeof reportSlaContract.rules>) {
  const { page, pageSize } = query;
  const scope = reportTenantScope(reportSlaRules);
  let accessibleIds: number[] | null | undefined;
  if (query.datasetId) {
    await ensureReportResourceAccess('dataset', query.datasetId, 'viewer');
  } else {
    accessibleIds = await listAccessibleReportResourceIds('dataset');
    if (accessibleIds?.length === 0) return { list: [], total: 0, page, pageSize };
  }
  const where = buildWhere(
    scope,
    query.datasetId ? eq(reportSlaRules.datasetId, query.datasetId) : undefined,
    accessibleIds ? inArray(reportSlaRules.datasetId, accessibleIds) : undefined,
    query.type ? eq(reportSlaRules.type, query.type) : undefined,
    query.enabled !== undefined ? eq(reportSlaRules.enabled, query.enabled) : undefined,
  );
  return buildListResult({
    page,
    pageSize,
    count: () => db.$count(reportSlaRules, where),
    rows: () => db.select().from(reportSlaRules).where(where).orderBy(desc(reportSlaRules.id))
            .limit(pageSize).offset(pageOffset(page, pageSize)),
    map: mapReportSlaRule,
  });
}

export async function getReportSlaRule(id: number): Promise<ReportSlaRule> {
  return mapReportSlaRule(await ensureSlaRule(id));
}

export async function createReportSlaRule(input: CreateReportSlaRuleInput): Promise<ReportSlaRule> {
  const dataset = await validateSlaInput(input);
  try {
    const [row] = await db.insert(reportSlaRules).values({
      tenantId: dataset.tenantId,
      datasetId: input.datasetId,
      name: input.name,
      type: input.type,
      targetValue: input.targetValue,
      warningValue: input.warningValue ?? null,
      windowMinutes: input.windowMinutes,
      cron: input.cron ?? null,
      timezone: input.timezone,
      severity: input.severity,
      channels: input.channels,
      recipients: input.recipients ?? null,
      webhookUrl: prepareReportSecret(input.webhookUrl, null),
      silenceMins: input.silenceMins,
      enabled: input.enabled,
      createdBy: currentUserId(),
      updatedBy: currentUserId(),
    }).returning();
    return mapReportSlaRule(row!);
  } catch (error) {
    rethrowPgUniqueViolation(error, '同一数据集下 SLA 规则名称不能重复');
  }
}

export async function updateReportSlaRule(id: number, input: UpdateReportSlaRuleInput): Promise<ReportSlaRule> {
  const existing = await ensureSlaRule(id, 'editor');
  await validateSlaInput(input, existing);
  try {
    const [row] = await db.update(reportSlaRules).set({
      ...input,
      cron: input.cron === undefined ? undefined : input.cron ?? null,
      recipients: input.recipients === undefined ? undefined : input.recipients ?? null,
      webhookUrl: prepareReportSecret(input.webhookUrl, existing.webhookUrl),
      updatedBy: currentUserId(),
    }).where(eq(reportSlaRules.id, id)).returning();
    return mapReportSlaRule(row!);
  } catch (error) {
    rethrowPgUniqueViolation(error, '同一数据集下 SLA 规则名称不能重复');
  }
}

export async function deleteReportSlaRule(id: number): Promise<void> {
  await ensureSlaRule(id, 'editor');
  await db.delete(reportSlaRules).where(eq(reportSlaRules.id, id));
}

async function observeSla(rule: SlaRuleRow, now: Date): Promise<{ value: number; detail: string }> {
  const windowStart = dayjs(now).subtract(rule.windowMinutes, 'minute').toDate();
  if (rule.type === 'freshness') {
    const [execution, snapshot] = await Promise.all([
      db.query.reportDatasetExecutionLogs.findFirst({
        where: and(eq(reportDatasetExecutionLogs.datasetId, rule.datasetId), eq(reportDatasetExecutionLogs.success, true)),
        orderBy: desc(reportDatasetExecutionLogs.executedAt),
      }),
      db.query.reportMaterializationSnapshots.findFirst({
        where: and(eq(reportMaterializationSnapshots.datasetId, rule.datasetId), eq(reportMaterializationSnapshots.status, 'ready')),
        orderBy: desc(reportMaterializationSnapshots.completedAt),
      }),
    ]);
    const latest = [execution?.executedAt, snapshot?.completedAt].filter((value): value is Date => Boolean(value))
      .sort((left, right) => right.getTime() - left.getTime())[0];
    const value = latest ? Math.max(0, dayjs(now).diff(latest, 'minute', true)) : 1_000_000_000;
    return { value, detail: latest ? `最近成功数据时间：${formatDateTime(latest)}` : '窗口内没有成功数据' };
  }
  if (rule.type === 'dq_score') {
    const score = await db.query.reportDqScores.findFirst({
      where: eq(reportDqScores.datasetId, rule.datasetId),
      orderBy: desc(reportDqScores.measuredAt),
    });
    return { value: score?.score ?? 0, detail: score ? `最近质量评分时间：${formatDateTime(score.measuredAt)}` : '尚无质量评分' };
  }
  if (rule.type === 'query_latency_p95') {
    const [result] = await db.select({
      value: sql<number | null>`percentile_cont(0.95) within group (order by ${reportDatasetExecutionLogs.durationMs})`,
    }).from(reportDatasetExecutionLogs).where(and(
      eq(reportDatasetExecutionLogs.datasetId, rule.datasetId),
      eq(reportDatasetExecutionLogs.success, true),
      gte(reportDatasetExecutionLogs.executedAt, windowStart),
      lte(reportDatasetExecutionLogs.executedAt, now),
    ));
    return { value: Number(result?.value ?? 0), detail: `统计窗口 ${rule.windowMinutes} 分钟` };
  }
  const [result] = await db.select({
    total: sql<number>`count(*)::int`,
    successful: sql<number>`sum(case when ${reportDatasetExecutionLogs.success} then 1 else 0 end)::int`,
  }).from(reportDatasetExecutionLogs).where(and(
    eq(reportDatasetExecutionLogs.datasetId, rule.datasetId),
    gte(reportDatasetExecutionLogs.executedAt, windowStart),
    lte(reportDatasetExecutionLogs.executedAt, now),
  ));
  const total = Number(result?.total ?? 0);
  const successful = Number(result?.successful ?? 0);
  return { value: total ? successful / total * 100 : 0, detail: `窗口内成功 ${successful} / 总计 ${total} 次` };
}

async function notifySla(rule: SlaRuleRow, violation: SlaViolationRow, now: Date): Promise<void> {
  if (!rule.channels.length || !shouldNotifySlaViolation(rule.lastNotifiedAt, rule.silenceMins, now)) return;
  const idempotencyKey = `sla:${rule.id}:${violation.id}:${dayjs(now).startOf('minute').valueOf()}`;
  const delivery = await ensureDeliveryRun({
    tenantId: rule.tenantId,
    targetType: 'sla',
    triggerType: 'scheduled',
    idempotencyKey,
    slaRuleId: rule.id,
    datasetId: rule.datasetId,
    targetName: rule.name,
    requestedBy: rule.createdBy,
    payloadSummary: { violationId: violation.id, observedValue: violation.observedValue, targetValue: violation.targetValue },
  });
  if (delivery.status === 'success') return;
  const running = await startManualDeliveryRun({
    runId: delivery.id,
    attempt: Math.max(1, delivery.attempt || 1),
    maxAttempts: delivery.maxAttempts,
    triggerType: 'scheduled',
  });
  const result = await dispatchNotificationChannels({
    tenantId: rule.tenantId,
    runId: running.id,
    attempt: running.attempt,
    channels: rule.channels,
    recipients: rule.recipients,
    webhookUrl: rule.webhookUrl,
    createdBy: rule.createdBy,
    title: `SLA 违规：${rule.name}`,
    text: `${violation.detail ?? ''}；观测值 ${violation.observedValue}，目标 ${violation.targetValue}`,
    inAppType: 'warning',
    payloadSummary: { violationId: violation.id },
  });
  await finalizeDeliveryRun({
    runId: running.id,
    status: result.status,
    errorMessage: result.errorMessage,
    lastValue: violation.observedValue,
    triggered: true,
  });
  if (result.status === 'success' || result.status === 'partial') {
    await db.update(reportSlaRules).set({ lastNotifiedAt: now }).where(eq(reportSlaRules.id, rule.id));
  }
}

export async function evaluateReportSlaRule(id: number, now = new Date()): Promise<{
  violated: boolean;
  observedValue: number;
  violation: ReportSlaViolation | null;
}> {
  const rule = await ensureSlaRule(id);
  const observation = await observeSla(rule, now);
  const windowStartedAt = dayjs(now).subtract(rule.windowMinutes, 'minute').toDate();
  const violated = isSlaThresholdViolated(rule.type, observation.value, rule.targetValue);
  const active = await db.query.reportSlaViolations.findFirst({
    where: and(eq(reportSlaViolations.ruleId, rule.id), inArray(reportSlaViolations.status, ['open', 'acknowledged'])),
    orderBy: desc(reportSlaViolations.createdAt),
  });
  let violation: SlaViolationRow | null = null;
  if (violated) {
    if (active) {
      [violation] = await db.update(reportSlaViolations).set({
        observedValue: observation.value,
        targetValue: rule.targetValue,
        windowStartedAt,
        windowEndedAt: now,
        detail: observation.detail,
      }).where(eq(reportSlaViolations.id, active.id)).returning();
    } else {
      [violation] = await db.insert(reportSlaViolations).values({
        tenantId: rule.tenantId,
        ruleId: rule.id,
        datasetId: rule.datasetId,
        observedValue: observation.value,
        targetValue: rule.targetValue,
        windowStartedAt,
        windowEndedAt: now,
        detail: observation.detail,
      }).returning();
    }
    await notifySla(rule, violation!, now);
  } else if (active) {
    [violation] = await db.update(reportSlaViolations).set({
      status: 'resolved',
      observedValue: observation.value,
      windowEndedAt: now,
      resolvedAt: now,
      resolvedBy: null,
      resolutionNote: '指标已恢复，系统自动解决',
    }).where(eq(reportSlaViolations.id, active.id)).returning();
  }
  await db.update(reportSlaRules).set({ lastEvaluatedAt: now }).where(eq(reportSlaRules.id, rule.id));
  return { violated, observedValue: observation.value, violation: violation ? mapReportSlaViolation(violation) : null };
}

export async function submitReportSlaEvaluation(id: number) {
  const rule = await ensureSlaRule(id);
  return mapAsyncTask(await submitAsyncTask({
    taskType: 'report-sla-rule-evaluate',
    title: `SLA 评估 · ${rule.name}`,
    payload: { ruleId: id, triggerType: 'manual' },
    idempotencyKey: `report-sla-rule-evaluate:${id}:manual:${rule.updatedAt.getTime()}:${rule.lastEvaluatedAt?.getTime() ?? 0}`,
  }));
}

export async function listReportSlaViolations(query: QueryOutputOf<typeof reportSlaContract.violations>) {
  const { page, pageSize } = query;
  const scope = reportTenantScope(reportSlaViolations);
  let accessibleIds: number[] | null | undefined;
  if (query.datasetId) {
    await ensureReportResourceAccess('dataset', query.datasetId, 'viewer');
  } else {
    accessibleIds = await listAccessibleReportResourceIds('dataset');
    if (accessibleIds?.length === 0) return { list: [], total: 0, page, pageSize };
  }
  let ruleId: number | undefined;
  if (query.ruleId) {
    await ensureSlaRule(query.ruleId);
    ruleId = query.ruleId;
  }
  const where = buildWhere(
    scope,
    query.datasetId ? eq(reportSlaViolations.datasetId, query.datasetId) : undefined,
    accessibleIds ? inArray(reportSlaViolations.datasetId, accessibleIds) : undefined,
    ruleId ? eq(reportSlaViolations.ruleId, ruleId) : undefined,
    query.status ? eq(reportSlaViolations.status, query.status) : undefined,
  );
  return buildListResult({
    page,
    pageSize,
    count: () => db.$count(reportSlaViolations, where),
    rows: () => db.select().from(reportSlaViolations).where(where).orderBy(desc(reportSlaViolations.id))
            .limit(pageSize).offset(pageOffset(page, pageSize)),
    map: mapReportSlaViolation,
  });
}

export async function updateReportSlaViolation(
  id: number,
  input: UpdateReportSlaViolationInput,
): Promise<ReportSlaViolation> {
  const rowOrUndefined = await db.query.reportSlaViolations.findFirst({
    where: reportScopedWhere(reportSlaViolations, eq(reportSlaViolations.id, id)),
  });
  const row = requireRow(rowOrUndefined, 'SLA 违规记录不存在');
  await ensureReportResourceAccess('dataset', row.datasetId, 'editor');
  const now = new Date();
  const [updated] = await db.update(reportSlaViolations).set({
    status: input.status,
    acknowledgedAt: input.status === 'acknowledged' ? now : row.acknowledgedAt,
    acknowledgedBy: input.status === 'acknowledged' ? currentUserId() : row.acknowledgedBy,
    resolvedAt: input.status === 'resolved' ? now : null,
    resolvedBy: input.status === 'resolved' ? currentUserId() : null,
    resolutionNote: input.note ?? row.resolutionNote,
  }).where(eq(reportSlaViolations.id, id)).returning();
  return mapReportSlaViolation(updated!);
}

export async function dispatchDueReportSlaRules(now = new Date()): Promise<{ checked: number; submitted: number }> {
  const rows = await db.select().from(reportSlaRules).where(and(
    eq(reportSlaRules.enabled, true),
    isNotNull(reportSlaRules.cron),
    isNotNull(reportSlaRules.createdBy),
    or(isNull(reportSlaRules.lastEvaluatedAt), lte(reportSlaRules.lastEvaluatedAt, now)),
  ));
  let submitted = 0;
  for (const rule of rows) {
    if (!rule.cron || !rule.createdBy) continue;
    const previous = dueCronFireTime({ cron: rule.cron, timezone: rule.timezone, lastRunAt: rule.lastEvaluatedAt }, now);
    if (!previous) continue;
    const creator = await loadScheduleActor(rule.createdBy);
    if (!creator) continue;
    await runWithCurrentUser(creator, () => submitAsyncTask({
      taskType: 'report-sla-rule-evaluate',
      title: `定时 SLA 评估 · ${rule.name}`,
      payload: { ruleId: rule.id, triggerType: 'scheduled' },
      idempotencyKey: `report-sla-rule-evaluate:${rule.id}:scheduled:${previous.getTime()}`,
    }));
    submitted++;
  }
  return { checked: rows.length, submitted };
}
