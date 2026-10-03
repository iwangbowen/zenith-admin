import { reportDqContract, reportDqRuleSchema, reportDqRunSchema, reportDqScoreSchema, reportDqAnomalySchema } from '@zenith/shared/report';
import type { QueryOutputOf } from '@zenith/shared/core';
import { requireRow } from '../../lib/db-assert';
import { buildListResult, emptyListResult, listRows } from '../../lib/list-query';
import { createHash } from 'node:crypto';
import { CronExpressionParser } from 'cron-parser';
import dayjs from 'dayjs';
import { HTTPException } from 'hono/http-exception';
import { and, desc, eq, gte, inArray, isNotNull, isNull, lt, lte, or, sql } from 'drizzle-orm';
import type { CreateReportDqRuleInput, ReportDqAnomaly, ReportDqRule, ReportDqRuleConfig, ReportDqRuleType, ReportDqRun, ReportDqScore, ReportField, RunReportDqRuleInput, UpdateReportDqAnomalyStatusInput, UpdateReportDqRuleInput } from '@zenith/shared/report';
import { db } from '../../db';
import {
  reportDatasets,
  reportDqAnomalies,
  reportDqRules,
  reportDqRuns,
  reportDqScores,
} from '../../db/schema';
import { currentUserId, runWithCurrentUser } from '../../lib/context';
import { rethrowPgUniqueViolation } from '../../lib/db-errors';
import { applyReadonlyTransactionGuards } from '../../lib/db-readonly-role';
import { normalizeReadonlyReportSql } from '../../lib/report-sql-safety';
import { mapAsyncTask, submitAsyncTask } from '../../lib/task-center';
import { ensureDatasetExists, getDatasetData } from './report-dataset.service';
import { reportScopedWhere, reportTenantScope } from './report-access';
import { ensureReportResourceAccess, accessibleReportResourceCondition } from './report-resource-acl.service';
import { dueCronFireTime, loadScheduleActor } from './report-schedule-shared';
import { buildWhere, withPagination } from '../../lib/where-helpers';
import { pickEntity } from '../../lib/entity-map';
import type { JobStuckItem } from '@zenith/shared/platform';
import type { JobSourceRawSummary } from '../../lib/job-monitor/registry';
import { orphanRunCondition } from '../../lib/job-monitor/orphan';
import { formatDateTime, formatNullableDateTime } from '../../lib/datetime';

export function stuckReportDqRunCondition(asOf = new Date()) {
  return or(orphanRunCondition({ table: reportDqRuns, statusColumn: reportDqRuns.status, activeStatuses: ['pending', 'running'],
    taskIdColumn: reportDqRuns.taskId, startedAtColumn: sql`coalesce(${reportDqRuns.startedAt}, ${reportDqRuns.createdAt})`, asOf }),
  and(eq(reportDqRuns.status, 'running'), lt(reportDqRuns.startedAt, new Date(asOf.getTime() - 30 * 60_000))));
}

export async function getReportDqHealth(): Promise<JobSourceRawSummary> {
  const now = new Date();
  const since = new Date(now.getTime() - 86_400_000);
  const hour = new Date(now.getTime() - 3_600_000);
  const [row] = await db.select({
    stuck: sql<number>`count(*) filter (where ${stuckReportDqRunCondition(now)})::int`,
    failed24h: sql<number>`count(*) filter (where ${reportDqRuns.status} = 'failed' and ${reportDqRuns.completedAt} >= ${sql.param(since, reportDqRuns.completedAt)})::int`,
    succeeded24h: sql<number>`count(*) filter (where ${reportDqRuns.status} = 'succeeded' and ${reportDqRuns.completedAt} >= ${sql.param(since, reportDqRuns.completedAt)})::int`,
    failed1h: sql<number>`count(*) filter (where ${reportDqRuns.status} = 'failed' and ${reportDqRuns.completedAt} >= ${sql.param(hour, reportDqRuns.completedAt)})::int`,
  }).from(reportDqRuns).where(or(inArray(reportDqRuns.status, ['pending', 'running']), and(inArray(reportDqRuns.status, ['succeeded', 'failed']), gte(reportDqRuns.completedAt, since))));
  return {
    counts: { pending: 0, running: 0, stuck: row?.stuck ?? 0, dead: null, failed24h: row?.failed24h ?? 0, succeeded24h: row?.succeeded24h ?? 0 },
    oldestPendingAgeSec: null, failed1h: row?.failed1h ?? 0, issues: [],
  };
}

export async function listStuckReportDqRuns(limit: number): Promise<JobStuckItem[]> {
  const now = new Date();
  const rows = await db.select({ id: reportDqRuns.id, status: reportDqRuns.status, startedAt: reportDqRuns.startedAt, createdAt: reportDqRuns.createdAt,
    updatedAt: reportDqRuns.updatedAt, errorMessage: reportDqRuns.errorMessage, ruleName: reportDqRules.name,
  }).from(reportDqRuns).innerJoin(reportDqRules, eq(reportDqRules.id, reportDqRuns.ruleId))
    .where(stuckReportDqRunCondition(now)).orderBy(reportDqRuns.createdAt, reportDqRuns.id).limit(limit);
  return rows.map(row => ({
    source: 'report-dq', refId: String(row.id), title: row.ruleName, status: row.status,
    startedAt: formatNullableDateTime(row.startedAt), lastSeenAt: formatDateTime(row.updatedAt), ageSec: Math.max(0, Math.floor((now.getTime() - (row.startedAt ?? row.createdAt).getTime()) / 1000)),
    nodeId: null, detail: row.errorMessage ?? '关联任务已失联或运行超过 30 分钟',
    drillDown: { path: `/report/quality?tab=runs&status=${row.status}`, label: '查看质量检查记录' },
  }));
}

const DQ_QUERY_LIMIT = 10_000;
const MAX_SAMPLE_ROWS = 100;
const MAX_SAMPLE_BYTES = 64 * 1024;
const CUSTOM_SQL_TIMEOUT_MS = 5_000;

interface EvaluationResult {
  checkedRows: number;
  failedRows: Record<string, unknown>[];
  failedCount: number;
}

function valueKey(value: unknown): string {
  if (value === null) return 'null';
  if (value === undefined) return 'undefined';
  if (typeof value === 'object') {
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }
  return `${typeof value}:${String(value)}`;
}

export function evaluateBuiltinDqRule(
  type: Exclude<ReportDqRuleType, 'custom_sql'>,
  rows: Record<string, unknown>[],
  field: string | null,
  config: ReportDqRuleConfig,
  now = dayjs(),
): EvaluationResult {
  if (type === 'row_count') {
    const tooFew = config.minRows != null && rows.length < config.minRows;
    const tooMany = config.maxRows != null && rows.length > config.maxRows;
    return { checkedRows: rows.length, failedRows: [], failedCount: tooFew || tooMany ? rows.length || 1 : 0 };
  }
  const requiredField = requireRow(field, '质量规则缺少字段', 400);

  if (type === 'uniqueness') {
    const counts = new Map<string, number>();
    for (const row of rows) {
      const key = valueKey(row[requiredField]);
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    const failedRows = rows.filter((row) => (counts.get(valueKey(row[requiredField])) ?? 0) > 1);
    return { checkedRows: rows.length, failedRows, failedCount: failedRows.length };
  }

  let pattern: RegExp | null = null;
  if (type === 'pattern') {
    try {
      pattern = new RegExp(config.pattern ?? '');
    } catch {
      throw new HTTPException(400, { message: '质量规则正则表达式无效' });
    }
  }
  const failedRows = rows.filter((row) => {
    const value = row[requiredField];
    switch (type) {
      case 'not_null':
        return value === null || value === undefined || value === '';
      case 'range': {
        const numeric = typeof value === 'number' ? value : Number(value);
        return !Number.isFinite(numeric)
          || (config.min != null && numeric < config.min)
          || (config.max != null && numeric > config.max);
      }
      case 'pattern':
        return value == null || !pattern!.test(String(value));
      case 'freshness': {
        const parsed = dayjs(value as string | number | Date);
        return !parsed.isValid() || now.diff(parsed, 'minute', true) > (config.maxAgeMinutes ?? 0);
      }
    }
  });
  return { checkedRows: rows.length, failedRows, failedCount: failedRows.length };
}

export function boundFailureSamples(
  rows: Record<string, unknown>[],
  rowLimit = 20,
  byteLimit = MAX_SAMPLE_BYTES,
): { rows: Record<string, unknown>[]; bytes: number } {
  const out: Record<string, unknown>[] = [];
  let bytes = 2;
  for (const row of rows.slice(0, Math.min(Math.max(rowLimit, 0), MAX_SAMPLE_ROWS))) {
    const rowBytes = Buffer.byteLength(JSON.stringify(row), 'utf8') + (out.length ? 1 : 0);
    if (bytes + rowBytes > byteLimit) break;
    out.push(row);
    bytes += rowBytes;
  }
  return { rows: out, bytes };
}

export function validateCustomDqSql(input: string): string {
  const normalized = normalizeReadonlyReportSql(input);
  const masked = normalized
    .replace(/(\$(?:[A-Za-z_][A-Za-z0-9_]*)?\$)[\s\S]*?\1/g, (value) => ' '.repeat(value.length))
    .replace(/'(?:''|\\.|[^'])*'/g, (value) => ' '.repeat(value.length))
    .replace(/--[^\n]*/g, (value) => ' '.repeat(value.length))
    .replace(/\/\*[\s\S]*?\*\//g, (value) => value.replace(/[^\n]/g, ' '));

  if (['"', '`', '[', ']'].some((character) => masked.includes(character))) {
    throw new HTTPException(400, { message: '自定义质量 SQL 不允许使用带引号的标识符' });
  }
  const selectCount = masked.match(/\bselect\b/gi)?.length ?? 0;
  const fromCount = masked.match(/\bfrom\b/gi)?.length ?? 0;
  if (selectCount !== 1 || fromCount !== 1 || /\b(?:with|join|union|intersect|except|lateral|values|table)\b/i.test(masked)) {
    throw new HTTPException(400, { message: '自定义质量 SQL 只能读取当前数据集 CTE（dataset）' });
  }

  const statement = /^\s*select\s+(?:([A-Za-z_][\w$]*)\.)?row\s+from\s+dataset(?:\s+(?:as\s+)?((?!(?:where)\b)[A-Za-z_][\w$]*))?(?:\s+where\s+[\s\S]+)?\s*$/i.exec(masked);
  if (!statement) {
    throw new HTTPException(400, { message: '自定义质量 SQL 只能读取当前数据集 CTE（dataset），并必须使用 SELECT row FROM dataset [WHERE ...] 格式' });
  }
  const projectionAlias = statement[1]?.toLowerCase();
  const sourceAlias = statement[2]?.toLowerCase() ?? 'dataset';
  if (projectionAlias && projectionAlias !== sourceAlias) {
    throw new HTTPException(400, { message: '自定义质量 SQL 的数据集别名不一致' });
  }

  const allowedFunctions = new Set([
    'abs', 'btrim', 'cast', 'ceil', 'coalesce', 'floor', 'jsonb_array_length',
    'jsonb_typeof', 'length', 'lower', 'ltrim', 'nullif', 'replace', 'round',
    'rtrim', 'substring', 'trim', 'upper',
  ]);
  const unsafeFunction = [...masked.matchAll(/\b([A-Za-z_][\w$]*)\s*\(/g)]
    .map((match) => match[1].toLowerCase())
    .find((name) => !allowedFunctions.has(name));
  if (unsafeFunction) {
    throw new HTTPException(400, { message: `自定义质量 SQL 包含未允许的函数：${unsafeFunction}` });
  }
  return normalized;
}

async function evaluateCustomSql(
  rows: Record<string, unknown>[],
  query: string,
): Promise<EvaluationResult> {
  const normalized = validateCustomDqSql(query);
  const result = await db.transaction(async (tx) => {
    await applyReadonlyTransactionGuards((s) => tx.execute(sql.raw(s)), { timeout: CUSTOM_SQL_TIMEOUT_MS });
    return tx.execute<Record<string, unknown>>(sql`
      WITH dataset(row) AS (
        SELECT value FROM jsonb_array_elements(${JSON.stringify(rows)}::jsonb)
      )
      SELECT * FROM (${sql.raw(normalized)}) AS _dq_failures
      LIMIT ${DQ_QUERY_LIMIT + 1}
    `);
  });
  const failedRows = Array.from(result);
  if (failedRows.length > DQ_QUERY_LIMIT) {
    throw new HTTPException(400, { message: `自定义质量 SQL 失败结果不能超过 ${DQ_QUERY_LIMIT} 行` });
  }
  return { checkedRows: rows.length, failedRows, failedCount: failedRows.length };
}

function schemaSignature(rows: Record<string, unknown>[], columns: string[]): string {
  const first = rows[0];
  const shape = [...columns].sort().map((name) => [name, first?.[name] === null ? 'null' : typeof first?.[name]]);
  return createHash('sha256').update(JSON.stringify(shape)).digest('hex');
}

type DqRuleRow = typeof reportDqRules.$inferSelect;
type DqRunRow = typeof reportDqRuns.$inferSelect;
type DqScoreRow = typeof reportDqScores.$inferSelect;
type DqAnomalyRow = typeof reportDqAnomalies.$inferSelect;

export function mapReportDqRule(row: DqRuleRow, datasetName?: string | null): ReportDqRule {
  return pickEntity(reportDqRuleSchema, row, {
    datasetName: datasetName ?? null,
  });
}

export function mapReportDqRun(row: DqRunRow, names?: { ruleName?: string | null; datasetName?: string | null }): ReportDqRun {
  return pickEntity(reportDqRunSchema, row, {
    ruleName: names?.ruleName ?? null,
    datasetName: names?.datasetName ?? null,
  });
}

export function mapReportDqScore(row: DqScoreRow): ReportDqScore {
  return pickEntity(reportDqScoreSchema, row);
}

export function mapReportDqAnomaly(row: DqAnomalyRow, names?: { ruleName?: string | null; datasetName?: string | null }): ReportDqAnomaly {
  return pickEntity(reportDqAnomalySchema, row, {
    datasetName: names?.datasetName ?? null,
    ruleName: names?.ruleName ?? null,
  });
}

async function validateRuleInput(input: CreateReportDqRuleInput | UpdateReportDqRuleInput, existing?: DqRuleRow) {
  const datasetId = input.datasetId ?? existing?.datasetId;
  const type = input.type ?? existing?.type;
  const field = input.field === undefined ? existing?.field : input.field;
  const config = { ...(existing?.config ?? {}), ...(input.config ?? {}) };
  if (!datasetId || !type) throw new HTTPException(400, { message: '质量规则缺少数据集或类型' });
  const dataset = await ensureDatasetExists(datasetId);
  await ensureReportResourceAccess('dataset', datasetId, 'editor');
  const fields = (dataset.fields ?? []) as ReportField[];
  const declared = field ? fields.find((item) => item.name === field) : undefined;
  if (field && fields.length && !declared) throw new HTTPException(400, { message: `数据集字段不存在：${field}` });
  if (type === 'range' && declared && declared.type !== 'number') {
    throw new HTTPException(400, { message: '范围质量规则只能用于数值字段' });
  }
  if (type === 'pattern' && declared && declared.type !== 'string') {
    throw new HTTPException(400, { message: '模式质量规则只能用于文本字段' });
  }
  if (type === 'freshness' && declared && declared.type !== 'date') {
    throw new HTTPException(400, { message: '新鲜度质量规则只能用于日期字段' });
  }
  if (type === 'pattern' && config.pattern) {
    try {
      new RegExp(config.pattern);
    } catch {
      throw new HTTPException(400, { message: '质量规则正则表达式无效' });
    }
  }
  if (type === 'custom_sql' && config.sql) validateCustomDqSql(config.sql);
  if (input.cron) {
    try {
      CronExpressionParser.parse(input.cron, { tz: input.timezone ?? existing?.timezone ?? 'Asia/Shanghai' });
    } catch {
      throw new HTTPException(400, { message: '质量规则 Cron 表达式无效' });
    }
  }
  return dataset;
}

async function ensureRule(id: number, role: 'viewer' | 'editor' = 'viewer') {
  const rowOrUndefined = await db.query.reportDqRules.findFirst({
    where: reportScopedWhere(reportDqRules, eq(reportDqRules.id, id)),
  });
  const row = requireRow(rowOrUndefined, '质量规则不存在');
  await ensureReportResourceAccess('dataset', row.datasetId, role);
  return row;
}

export async function listReportDqRules(query: QueryOutputOf<typeof reportDqContract.rules>) {
  const { page, pageSize } = query;
  const scope = reportTenantScope(reportDqRules);
  const visible = await accessibleReportResourceCondition('dataset', reportDqRules.datasetId, { pinnedId: query.datasetId });
  if (visible === null) return emptyListResult(page, pageSize);
  const where = buildWhere(
    scope,
    visible,
    query.type ? eq(reportDqRules.type, query.type) : undefined,
    query.enabled !== undefined ? eq(reportDqRules.enabled, query.enabled) : undefined,
  );
  return buildListResult({
    page,
    pageSize,
    count: () => db.$count(reportDqRules, where),
    rows: () => withPagination(db.select({ rule: reportDqRules, datasetName: reportDatasets.name })
            .from(reportDqRules)
            .innerJoin(reportDatasets, eq(reportDatasets.id, reportDqRules.datasetId))
            .where(where)
            .orderBy(desc(reportDqRules.id)).$dynamic(), page, pageSize),
    map: (row) => mapReportDqRule(row.rule, row.datasetName),
  });
}

export async function getReportDqRule(id: number): Promise<ReportDqRule> {
  const row = await ensureRule(id);
  const dataset = await ensureDatasetExists(row.datasetId);
  return mapReportDqRule(row, dataset.name);
}

export async function createReportDqRule(input: CreateReportDqRuleInput): Promise<ReportDqRule> {
  const dataset = await validateRuleInput(input);
  try {
    const [row] = await db.insert(reportDqRules).values({
      tenantId: dataset.tenantId,
      datasetId: input.datasetId,
      name: input.name,
      type: input.type,
      field: input.field ?? null,
      severity: input.severity,
      config: input.config,
      cron: input.cron ?? null,
      timezone: input.timezone,
      enabled: input.enabled,
      createdBy: currentUserId(),
      updatedBy: currentUserId(),
    }).returning();
    return mapReportDqRule(row!, dataset.name);
  } catch (error) {
    rethrowPgUniqueViolation(error, '同一数据集下质量规则名称不能重复');
  }
}

export async function updateReportDqRule(id: number, input: UpdateReportDqRuleInput): Promise<ReportDqRule> {
  const existing = await ensureRule(id, 'editor');
  const dataset = await validateRuleInput(input, existing);
  try {
    const [row] = await db.update(reportDqRules).set({
      ...input,
      field: input.field === undefined ? undefined : input.field ?? null,
      cron: input.cron === undefined ? undefined : input.cron ?? null,
      updatedBy: currentUserId(),
    }).where(eq(reportDqRules.id, id)).returning();
    return mapReportDqRule(row!, dataset.name);
  } catch (error) {
    rethrowPgUniqueViolation(error, '同一数据集下质量规则名称不能重复');
  }
}

export async function deleteReportDqRule(id: number): Promise<void> {
  await ensureRule(id, 'editor');
  await db.delete(reportDqRules).where(eq(reportDqRules.id, id));
}

export async function toggleReportDqRule(id: number): Promise<ReportDqRule> {
  const existing = await ensureRule(id, 'editor');
  const [row] = await db.update(reportDqRules).set({
    enabled: !existing.enabled,
    updatedBy: currentUserId(),
  }).where(eq(reportDqRules.id, id)).returning();
  return mapReportDqRule(row!);
}

async function recomputeDatasetScore(datasetId: number, tenantId: number | null, measuredAt: Date): Promise<void> {
  const rules = await db.select().from(reportDqRules)
    .where(and(eq(reportDqRules.datasetId, datasetId), eq(reportDqRules.enabled, true)));
  const latest = await Promise.all(rules.map((rule) => db.query.reportDqRuns.findFirst({
    where: and(eq(reportDqRuns.ruleId, rule.id), inArray(reportDqRuns.status, ['succeeded', 'failed'])),
    orderBy: desc(reportDqRuns.createdAt),
  })));
  const completed = latest.filter((run): run is DqRunRow => Boolean(run));
  const passed = completed.filter((run) => run.status === 'succeeded').length;
  const dimensions: Record<string, number> = {};
  for (const severity of ['low', 'medium', 'high', 'critical'] as const) {
    const severityRuns = completed.filter((run) => rules.find((rule) => rule.id === run.ruleId)?.severity === severity);
    dimensions[severity] = severityRuns.length
      ? severityRuns.reduce((sum, run) => sum + (run.passRate ?? 0), 0) / severityRuns.length
      : 100;
  }
  await db.insert(reportDqScores).values({
    tenantId,
    datasetId,
    score: completed.length ? completed.reduce((sum, run) => sum + (run.passRate ?? 0), 0) / completed.length : 100,
    passedRules: passed,
    failedRules: completed.length - passed,
    totalRules: rules.length,
    dimensions,
    measuredAt,
  });
}

export async function executeReportDqRule(
  ruleId: number,
  input: {
    taskId: number;
    sampleLimit?: number;
    triggerType: 'manual' | 'scheduled' | 'dataset_refresh';
    runId?: number;
    onRunStarted?: (runId: number) => Promise<void>;
    isCancelRequested?: () => Promise<boolean>;
  },
): Promise<ReportDqRun> {
  const rule = await ensureRule(ruleId);
  const requestedBy = currentUserId();
  let run = input.runId
    ? await db.query.reportDqRuns.findFirst({ where: eq(reportDqRuns.id, input.runId) })
    : undefined;
  if (run && (
    run.status === 'succeeded'
    || run.status === 'cancelled'
    || (run.status === 'failed' && !run.errorMessage)
  )) return mapReportDqRun(run);
  if (!run) {
    [run] = await db.insert(reportDqRuns).values({
      taskId: input.taskId,
      tenantId: rule.tenantId,
      ruleId: rule.id,
      datasetId: rule.datasetId,
      triggerType: input.triggerType,
      status: 'pending',
      requestedBy,
    }).returning();
    await input.onRunStarted?.(run!.id);
  }
  const startedAt = new Date();
  [run] = await db.update(reportDqRuns).set({ status: 'running', taskId: input.taskId, startedAt, errorMessage: null })
    .where(eq(reportDqRuns.id, run!.id)).returning();
  const cancelRun = async (): Promise<ReportDqRun> => {
    const completedAt = new Date();
    [run] = await db.update(reportDqRuns).set({
      status: 'cancelled',
      completedAt,
      durationMs: completedAt.getTime() - startedAt.getTime(),
      errorMessage: '质量检查已取消',
    }).where(eq(reportDqRuns.id, run!.id)).returning();
    await db.update(reportDqRules).set({ lastRunAt: completedAt, lastStatus: 'cancelled' })
      .where(eq(reportDqRules.id, rule.id));
    return mapReportDqRun(run!);
  };
  try {
    if (await input.isCancelRequested?.()) return cancelRun();
    const data = await getDatasetData(rule.datasetId, {}, { limit: DQ_QUERY_LIMIT });
    if (await input.isCancelRequested?.()) return cancelRun();
    const signature = schemaSignature(data.rows, data.columns);
    const evaluation = rule.type === 'custom_sql'
      ? await evaluateCustomSql(data.rows, rule.config.sql ?? '')
      : evaluateBuiltinDqRule(rule.type, data.rows, rule.field ?? null, rule.config);
    const samples = boundFailureSamples(evaluation.failedRows, input.sampleLimit ?? 20);
    const completedAt = new Date();
    const status = evaluation.failedCount > 0 ? 'failed' : 'succeeded';
    const passRate = evaluation.checkedRows
      ? Math.max(0, ((evaluation.checkedRows - evaluation.failedCount) / evaluation.checkedRows) * 100)
      : (evaluation.failedCount ? 0 : 100);
    const previous = await db.query.reportDqRuns.findFirst({
      where: and(
        eq(reportDqRuns.ruleId, rule.id),
        inArray(reportDqRuns.status, ['succeeded', 'failed']),
        isNotNull(reportDqRuns.completedAt),
      ),
      orderBy: desc(reportDqRuns.completedAt),
    });
    [run] = await db.update(reportDqRuns).set({
      status,
      checkedRows: evaluation.checkedRows,
      failedRows: evaluation.failedCount,
      passRate,
      sampleRows: samples.rows,
      sampleRowCount: samples.rows.length,
      sampleBytes: samples.bytes,
      schemaSignature: signature,
      completedAt,
      durationMs: completedAt.getTime() - startedAt.getTime(),
    }).where(eq(reportDqRuns.id, run!.id)).returning();
    await db.update(reportDqRules).set({ lastRunAt: completedAt, lastStatus: status }).where(eq(reportDqRules.id, rule.id));
    const anomalies: Array<typeof reportDqAnomalies.$inferInsert> = [];
    if (status === 'failed') {
      anomalies.push({
        tenantId: rule.tenantId,
        datasetId: rule.datasetId,
        ruleId: rule.id,
        runId: run!.id,
        severity: rule.severity,
        title: `质量规则未通过：${rule.name}`,
        detail: `失败 ${evaluation.failedCount} / 检查 ${evaluation.checkedRows} 行`,
        sample: { rows: samples.rows },
        sampleRowCount: samples.rows.length,
        sampleBytes: samples.bytes,
      });
    }
    if (previous?.passRate != null && previous.passRate - passRate >= 20) {
      anomalies.push({
        tenantId: rule.tenantId,
        datasetId: rule.datasetId,
        ruleId: rule.id,
        runId: run!.id,
        severity: rule.severity,
        title: `质量基线显著下降：${rule.name}`,
        detail: `通过率从 ${previous.passRate.toFixed(2)}% 降至 ${passRate.toFixed(2)}%`,
        sample: {},
      });
    }
    if (previous?.schemaSignature && previous.schemaSignature !== signature) {
      anomalies.push({
        tenantId: rule.tenantId,
        datasetId: rule.datasetId,
        ruleId: rule.id,
        runId: run!.id,
        severity: 'high',
        title: `数据集结构发生漂移：${rule.name}`,
        detail: '字段名称或运行时类型与上一次质量检查不一致',
        sample: { previous: previous.schemaSignature, current: signature },
      });
    }
    if (anomalies.length) await db.insert(reportDqAnomalies).values(anomalies);
    await recomputeDatasetScore(rule.datasetId, rule.tenantId, completedAt);
    return mapReportDqRun(run!);
  } catch (error) {
    const completedAt = new Date();
    const message = error instanceof Error ? error.message : String(error);
    [run] = await db.update(reportDqRuns).set({
      status: 'failed',
      completedAt,
      durationMs: completedAt.getTime() - startedAt.getTime(),
      errorMessage: message.slice(0, 1000),
    }).where(eq(reportDqRuns.id, run!.id)).returning();
    await db.update(reportDqRules).set({ lastRunAt: completedAt, lastStatus: 'failed' }).where(eq(reportDqRules.id, rule.id));
    throw error;
  }
}

export async function submitReportDqRuleRun(id: number, input: RunReportDqRuleInput) {
  const rule = await ensureRule(id);
  return mapAsyncTask(await submitAsyncTask({
    taskType: 'report-dq-rule-run',
    title: `质量检查 · ${rule.name}`,
    payload: { ruleId: id, sampleLimit: input.sampleLimit, triggerType: 'manual' },
    idempotencyKey: `report-dq-rule-run:${id}:manual:${rule.updatedAt.getTime()}:${rule.lastRunAt?.getTime() ?? 0}`,
  }));
}

/** 批量解析规则/数据集名称，避免列表页只显示裸 ID */
async function resolveDqNames(rows: Array<{ ruleId?: number | null; datasetId: number }>) {
  const ruleIds = [...new Set(rows.map((row) => row.ruleId).filter((id): id is number => !!id))];
  const datasetIds = [...new Set(rows.map((row) => row.datasetId))];
  const [rules, datasets] = await Promise.all([
    ruleIds.length
      ? db.select({ id: reportDqRules.id, name: reportDqRules.name }).from(reportDqRules).where(inArray(reportDqRules.id, ruleIds))
      : Promise.resolve([]),
    datasetIds.length
      ? db.select({ id: reportDatasets.id, name: reportDatasets.name }).from(reportDatasets).where(inArray(reportDatasets.id, datasetIds))
      : Promise.resolve([]),
  ]);
  return {
    ruleNames: new Map(rules.map((item) => [item.id, item.name])),
    datasetNames: new Map(datasets.map((item) => [item.id, item.name])),
  };
}

export async function listReportDqRuns(query: QueryOutputOf<typeof reportDqContract.runs>) {
  const { page, pageSize } = query;
  const scope = reportTenantScope(reportDqRuns);
  const visible = await accessibleReportResourceCondition('dataset', reportDqRuns.datasetId, { pinnedId: query.datasetId });
  if (visible === null) return emptyListResult(page, pageSize);
  let ruleId: number | undefined;
  if (query.ruleId) {
    const rule = await ensureRule(query.ruleId);
    ruleId = rule.id;
  }
  const where = buildWhere(
    scope,
    visible,
    ruleId ? eq(reportDqRuns.ruleId, ruleId) : undefined,
    query.status ? eq(reportDqRuns.status, query.status) : undefined,
  );
  const { list: rows, total } = await listRows({
    page,
    pageSize,
    table: reportDqRuns,
    where,
    orderBy: [desc(reportDqRuns.id)],
  });
  const { ruleNames, datasetNames } = await resolveDqNames(rows);
  return {
    list: rows.map((row) => mapReportDqRun(row, {
      ruleName: ruleNames.get(row.ruleId) ?? null,
      datasetName: datasetNames.get(row.datasetId) ?? null,
    })),
    total, page, pageSize,
  };
}

export async function listReportDqScores(datasetId: number, query: QueryOutputOf<typeof reportDqContract.scores>) {
  const { page, pageSize } = query;
  await ensureReportResourceAccess('dataset', datasetId, 'viewer');
  const where = reportScopedWhere(reportDqScores, eq(reportDqScores.datasetId, datasetId));
  return listRows({
    page,
    pageSize,
    table: reportDqScores,
    where,
    orderBy: [desc(reportDqScores.measuredAt)],
    map: mapReportDqScore,
  });
}

export async function getCurrentReportDqScore(datasetId: number): Promise<ReportDqScore | null> {
  await ensureReportResourceAccess('dataset', datasetId, 'viewer');
  const row = await db.query.reportDqScores.findFirst({
    where: reportScopedWhere(reportDqScores, eq(reportDqScores.datasetId, datasetId)),
    orderBy: desc(reportDqScores.measuredAt),
  });
  return row ? mapReportDqScore(row) : null;
}

export async function listReportDqAnomalies(query: QueryOutputOf<typeof reportDqContract.anomalies>) {
  const { page, pageSize } = query;
  const scope = reportTenantScope(reportDqAnomalies);
  const visible = await accessibleReportResourceCondition('dataset', reportDqAnomalies.datasetId, { pinnedId: query.datasetId });
  if (visible === null) return emptyListResult(page, pageSize);
  const where = buildWhere(
    scope,
    visible,
    query.status ? eq(reportDqAnomalies.status, query.status) : undefined,
  );
  const { list: rows, total } = await listRows({
    page,
    pageSize,
    table: reportDqAnomalies,
    where,
    orderBy: [desc(reportDqAnomalies.id)],
  });
  const { ruleNames, datasetNames } = await resolveDqNames(rows);
  return {
    list: rows.map((row) => mapReportDqAnomaly(row, {
      ruleName: row.ruleId ? ruleNames.get(row.ruleId) ?? null : null,
      datasetName: datasetNames.get(row.datasetId) ?? null,
    })),
    total, page, pageSize,
  };
}

export async function updateReportDqAnomalyStatus(
  id: number,
  input: UpdateReportDqAnomalyStatusInput,
): Promise<ReportDqAnomaly> {
  const rowOrUndefined = await db.query.reportDqAnomalies.findFirst({
    where: reportScopedWhere(reportDqAnomalies, eq(reportDqAnomalies.id, id)),
  });
  const row = requireRow(rowOrUndefined, '质量异常不存在');
  await ensureReportResourceAccess('dataset', row.datasetId, 'editor');
  const now = new Date();
  const [updated] = await db.update(reportDqAnomalies).set({
    status: input.status,
    acknowledgementNote: input.note ?? row.acknowledgementNote,
    acknowledgedAt: input.status === 'acknowledged' ? now : row.acknowledgedAt,
    acknowledgedBy: input.status === 'acknowledged' ? currentUserId() : row.acknowledgedBy,
    resolvedAt: input.status === 'resolved' || input.status === 'ignored' ? now : null,
    resolvedBy: input.status === 'resolved' || input.status === 'ignored' ? currentUserId() : null,
  }).where(eq(reportDqAnomalies.id, id)).returning();
  return mapReportDqAnomaly(updated!);
}

export async function dispatchDueReportDqRules(now = new Date()): Promise<{ checked: number; submitted: number }> {
  const rows = await db.select().from(reportDqRules).where(and(
    eq(reportDqRules.enabled, true),
    isNotNull(reportDqRules.cron),
    isNotNull(reportDqRules.createdBy),
    or(isNull(reportDqRules.lastRunAt), lte(reportDqRules.lastRunAt, now)),
  ));
  let submitted = 0;
  for (const rule of rows) {
    if (!rule.cron || !rule.createdBy) continue;
    const previous = dueCronFireTime({ cron: rule.cron, timezone: rule.timezone, lastRunAt: rule.lastRunAt }, now);
    if (!previous) continue;
    const creator = await loadScheduleActor(rule.createdBy);
    if (!creator) continue;
    await runWithCurrentUser(creator, async () => {
      await submitAsyncTask({
        taskType: 'report-dq-rule-run',
        title: `定时质量检查 · ${rule.name}`,
        payload: { ruleId: rule.id, sampleLimit: 20, triggerType: 'scheduled' },
        idempotencyKey: `report-dq-rule-run:${rule.id}:scheduled:${previous.getTime()}`,
      });
    });
    submitted++;
  }
  return { checked: rows.length, submitted };
}
