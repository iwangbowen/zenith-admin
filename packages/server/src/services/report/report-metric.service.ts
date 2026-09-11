import type { QueryOutputOf } from '@zenith/shared/core';
import { exactTenantCondition } from '../../lib/tenant';
import { requireRow } from '../../lib/db-assert';
import { buildListResult } from '../../lib/list-query';
import { HTTPException } from 'hono/http-exception';
import { and, desc, eq, inArray } from 'drizzle-orm';
import { reportMetricContract, formatReportValue } from '@zenith/shared/report';
import type { CreateReportMetricInput, ReportFieldFormat, ReportMetric, ReportMetricEvaluation, ReportMetricLifecycleActionInput, ReportMetricRefs, ReportMetricType, ReportWidget, ReportDashboardSnapshot, UpdateReportMetricInput } from '@zenith/shared/report';
import { db } from '../../db';
import {
  reportAlertRules,
  reportDashboards,
  reportMetrics,
} from '../../db/schema';
import { currentUserId, currentUserOrNull } from '../../lib/context';
import { rethrowPgUniqueViolation } from '../../lib/db-errors';
import { formatDateTime, formatNullableDateTime } from '../../lib/datetime';
import { pageOffset } from '../../lib/pagination';
import { buildWhere, keywordCondition } from '../../lib/where-helpers';
import {
  assertDatasetEvaluableGlobally,
  ensureDatasetExists,
  getDatasetDataExecution,
} from './report-dataset.service';
import { reportCreateTenantId, reportScopedWhere, reportTenantScope } from './report-access';
import {
  defaultReportOwnerId,
  resolveReportResource,
  validateReportResourcePlacement,
} from './report-resource.service';
import {
  ensureReportResourceAccess,
  listAccessibleReportResourceIds,
} from './report-resource-acl.service';
import {
  aggregateMetricRows,
  analyzeMetricFormula,
  evaluateMetricFormula,
} from './report-metric-formula';

type MetricRowExt = typeof reportMetrics.$inferSelect & {
  folder?: { name: string } | null;
  owner?: { nickname: string | null; username: string } | null;
  dataset?: { name: string } | null;
};

const MAX_METRIC_DEPTH = 10;

function metricTenantCondition(tenantId: number | null) {
  return exactTenantCondition(reportMetrics.tenantId, tenantId);
}

export function assertReportMetricRevision(currentRevision: number, expectedRevision: number): void {
  if (currentRevision !== expectedRevision) {
    throw new HTTPException(409, { message: '指标版本已变更，请刷新后重试' });
  }
}

export function assertReportMetricReferenceStack(metricId: number, stack: number[]): void {
  if (stack.includes(metricId)) {
    throw new HTTPException(400, { message: `指标存在循环引用：${[...stack, metricId].join(' -> ')}` });
  }
  if (stack.length >= MAX_METRIC_DEPTH) {
    throw new HTTPException(400, { message: `指标引用深度不能超过 ${MAX_METRIC_DEPTH} 层` });
  }
}

export function mapReportMetric(row: MetricRowExt): ReportMetric {
  return {
    id: row.id,
    tenantId: row.tenantId ?? null,
    folderId: row.folderId ?? null,
    folderName: row.folder?.name ?? null,
    ownerId: row.ownerId ?? null,
    ownerName: row.owner?.nickname || row.owner?.username || null,
    code: row.code,
    name: row.name,
    description: row.description ?? null,
    type: row.type,
    datasetId: row.datasetId,
    datasetName: row.dataset?.name ?? null,
    sourceField: row.sourceField ?? null,
    formula: row.formula ?? null,
    aggregate: row.aggregate as ReportMetric['aggregate'],
    dimensions: row.dimensions ?? [],
    timeField: row.timeField ?? null,
    unit: row.unit ?? null,
    format: row.format ?? null,
    caliber: row.caliber ?? null,
    lifecycleStatus: row.lifecycleStatus,
    revision: row.revision,
    publishedSnapshot: row.publishedSnapshot ?? null,
    publishedAt: formatNullableDateTime(row.publishedAt),
    publishedBy: row.publishedBy ?? null,
    deprecatedAt: formatNullableDateTime(row.deprecatedAt),
    deprecatedBy: row.deprecatedBy ?? null,
    deprecationReason: row.deprecationReason ?? null,
    createdBy: row.createdBy ?? null,
    updatedBy: row.updatedBy ?? null,
    createdAt: formatDateTime(row.createdAt),
    updatedAt: formatDateTime(row.updatedAt),
  };
}

async function ensureMetricAccess(id: number, role: 'viewer' | 'editor' | 'owner' = 'viewer') {
  if (currentUserOrNull()) await ensureReportResourceAccess('metric', id, role);
}

export async function ensureReportMetricExists(id: number) {
  const rowOrUndefined = await db.query.reportMetrics.findFirst({
    where: reportScopedWhere(reportMetrics, eq(reportMetrics.id, id)),
    with: {
      folder: { columns: { name: true } },
      owner: { columns: { nickname: true, username: true } },
      dataset: { columns: { name: true } },
    },
  });
  const row = requireRow(rowOrUndefined, '指标不存在');
  await ensureMetricAccess(id);
  return row;
}

export async function getReportMetric(id: number): Promise<ReportMetric> {
  await ensureMetricAccess(id);
  return mapReportMetric(await ensureReportMetricExists(id));
}

export async function listReportMetrics(query: QueryOutputOf<typeof reportMetricContract.list>) {
  const { page, pageSize, keyword, datasetId, folderId, ownerId, type, status } = query;
  const conds = [];
  const tenantScope = reportTenantScope(reportMetrics);
  if (tenantScope) conds.push(tenantScope);
  const accessibleIds = await listAccessibleReportResourceIds('metric');
  if (accessibleIds && accessibleIds.length === 0) return { list: [], total: 0, page, pageSize };
  if (accessibleIds) conds.push(inArray(reportMetrics.id, accessibleIds));
  conds.push(keywordCondition(keyword, [reportMetrics.name, reportMetrics.code], 'ilike'));
  if (datasetId) conds.push(eq(reportMetrics.datasetId, datasetId));
  if (folderId !== undefined) conds.push(exactTenantCondition(reportMetrics.folderId, folderId));
  if (ownerId !== undefined) conds.push(exactTenantCondition(reportMetrics.ownerId, ownerId));
  if (type) conds.push(eq(reportMetrics.type, type));
  if (status === 'draft' || status === 'published' || status === 'deprecated') {
    conds.push(eq(reportMetrics.lifecycleStatus, status));
  }
  const where = buildWhere(...conds);
  return buildListResult({
    page,
    pageSize,
    count: () => db.$count(reportMetrics, where),
    rows: () => db.query.reportMetrics.findMany({
            where,
            with: {
              folder: { columns: { name: true } },
              owner: { columns: { nickname: true, username: true } },
              dataset: { columns: { name: true } },
            },
            orderBy: desc(reportMetrics.id),
            limit: pageSize,
            offset: pageOffset(page, pageSize),
          }),
    map: mapReportMetric,
  });
}

export async function listReportMetricLookup(query: {
  keyword?: string;
  status?: 'draft' | 'published' | 'deprecated';
  limit?: number;
}) {
  const accessibleIds = await listAccessibleReportResourceIds('metric');
  if (accessibleIds && accessibleIds.length === 0) return [];
  const conds = [];
  const tenantScope = reportTenantScope(reportMetrics);
  if (tenantScope) conds.push(tenantScope);
  if (accessibleIds) conds.push(inArray(reportMetrics.id, accessibleIds));
  conds.push(keywordCondition(query.keyword, [reportMetrics.name, reportMetrics.code], 'ilike'));
  if (query.status) conds.push(eq(reportMetrics.lifecycleStatus, query.status));
  const rows = await db.select({
    id: reportMetrics.id,
    name: reportMetrics.name,
    code: reportMetrics.code,
    status: reportMetrics.lifecycleStatus,
    datasetId: reportMetrics.datasetId,
  }).from(reportMetrics)
    .where(buildWhere(...conds))
    .orderBy(desc(reportMetrics.id))
    .limit(Math.min(Math.max(query.limit ?? 20, 1), 200));
  return rows.map((row) => ({ ...row, type: 'metric' as const }));
}

function datasetFieldNames(row: Awaited<ReturnType<typeof ensureDatasetExists>>): Set<string> {
  return new Set([
    ...(row.fields ?? []).map((field) => field.name),
    ...(row.computedFields ?? []).map((field) => field.name),
  ]);
}

async function ensureFormulaGraph(
  code: string,
  formula: string,
  tenantId: number | null,
  currentId?: number,
): Promise<void> {
  const visit = async (currentCode: string, currentFormula: string, stack: string[], depth: number): Promise<void> => {
    if (depth > MAX_METRIC_DEPTH) throw new HTTPException(400, { message: `指标引用深度不能超过 ${MAX_METRIC_DEPTH} 层` });
    const { metricCodes } = analyzeMetricFormula(currentFormula);
    for (const refCode of metricCodes) {
      if (refCode === code || stack.includes(refCode)) {
        throw new HTTPException(400, { message: `指标公式存在循环引用：${[...stack, refCode].join(' -> ')}` });
      }
      const [ref] = await db.select({
        id: reportMetrics.id,
        code: reportMetrics.code,
        formula: reportMetrics.formula,
        type: reportMetrics.type,
      }).from(reportMetrics).where(and(
        eq(reportMetrics.code, refCode),
        metricTenantCondition(tenantId),
      )).limit(1);
      if (!ref || ref.id === currentId) throw new HTTPException(400, { message: `指标引用不存在：${refCode}` });
      await ensureMetricAccess(ref.id);
      if (ref.type !== 'simple' && ref.formula) {
        await visit(ref.code, ref.formula, [...stack, currentCode], depth + 1);
      }
    }
  };
  await visit(code, formula, [], 1);
}

async function validateMetricDefinition(
  input: {
    code: string;
    type: ReportMetricType;
    datasetId: number;
    sourceField?: string | null;
    formula?: string | null;
    dimensions?: string[];
    timeField?: string | null;
    tenantId: number | null;
  },
  currentId?: number,
): Promise<void> {
  const dataset = await ensureDatasetExists(input.datasetId);
  if ((dataset.tenantId ?? null) !== input.tenantId) {
    throw new HTTPException(400, { message: '指标与数据集不属于同一租户' });
  }
  const fields = datasetFieldNames(dataset);
  for (const field of [...(input.dimensions ?? []), ...(input.timeField ? [input.timeField] : [])]) {
    if (!fields.has(field)) throw new HTTPException(400, { message: `指标字段不存在：${field}` });
  }
  if (input.type === 'simple') {
    if (!input.sourceField || !fields.has(input.sourceField)) {
      throw new HTTPException(400, { message: `指标来源字段不存在：${input.sourceField ?? ''}` });
    }
    return;
  }
  if (!input.formula) throw new HTTPException(400, { message: '复合指标必须填写公式' });
  const analysis = analyzeMetricFormula(input.formula);
  for (const field of analysis.fields) {
    if (!fields.has(field)) throw new HTTPException(400, { message: `指标公式字段不存在：${field}` });
  }
  await ensureFormulaGraph(input.code, input.formula, input.tenantId, currentId);
}

export async function createReportMetric(input: CreateReportMetricInput): Promise<ReportMetric> {
  const tenantId = reportCreateTenantId();
  const ownerId = input.ownerId ?? defaultReportOwnerId();
  await Promise.all([
    validateMetricDefinition({
      code: input.code,
      type: input.type,
      datasetId: input.datasetId,
      sourceField: input.sourceField,
      formula: input.formula,
      dimensions: input.dimensions,
      timeField: input.timeField,
      tenantId,
    }),
    validateReportResourcePlacement('metric', { ownerId, folderId: input.folderId, tenantId }),
  ]);
  try {
    const [row] = await db.insert(reportMetrics).values({
      tenantId,
      ownerId,
      folderId: input.folderId ?? null,
      code: input.code,
      name: input.name,
      description: input.description ?? null,
      type: input.type,
      datasetId: input.datasetId,
      sourceField: input.sourceField ?? null,
      formula: input.formula ?? null,
      aggregate: input.aggregate ?? (input.type === 'simple' ? 'sum' : null),
      dimensions: input.dimensions ?? [],
      timeField: input.timeField ?? null,
      unit: input.unit ?? null,
      format: input.format ?? null,
      caliber: input.caliber ?? null,
    }).returning();
    return mapReportMetric(row);
  } catch (error) {
    rethrowPgUniqueViolation(error, '指标编码已存在');
    throw error;
  }
}

export async function updateReportMetric(id: number, input: UpdateReportMetricInput): Promise<ReportMetric> {
  await ensureMetricAccess(id, 'editor');
  const current = await ensureReportMetricExists(id);
  if (input.ownerId !== undefined && input.ownerId !== current.ownerId) {
    await ensureMetricAccess(id, 'owner');
  }
  assertReportMetricRevision(current.revision, input.expectedRevision);
  const next = {
    code: input.code ?? current.code,
    type: input.type ?? current.type,
    datasetId: input.datasetId ?? current.datasetId,
    sourceField: input.sourceField === undefined ? current.sourceField : input.sourceField,
    formula: input.formula === undefined ? current.formula : input.formula,
    dimensions: input.dimensions ?? current.dimensions,
    timeField: input.timeField === undefined ? current.timeField : input.timeField,
    tenantId: current.tenantId ?? null,
  };
  await Promise.all([
    validateMetricDefinition(next, id),
    validateReportResourcePlacement('metric', {
      ownerId: input.ownerId,
      folderId: input.folderId,
      tenantId: current.tenantId ?? null,
    }),
  ]);
  try {
    const [rowOrUndefined] = await db.update(reportMetrics).set({
      ownerId: input.ownerId,
      folderId: input.folderId,
      code: input.code,
      name: input.name,
      description: input.description,
      type: input.type,
      datasetId: input.datasetId,
      sourceField: input.sourceField,
      formula: input.formula,
      aggregate: input.aggregate,
      dimensions: input.dimensions,
      timeField: input.timeField,
      unit: input.unit,
      format: input.format,
      caliber: input.caliber,
      lifecycleStatus: 'draft',
      revision: current.revision + 1,
    }).where(and(eq(reportMetrics.id, id), eq(reportMetrics.revision, input.expectedRevision))).returning();
    const row = requireRow(rowOrUndefined, '指标已被其他人更新，请刷新后重试', 409);
    return mapReportMetric(row);
  } catch (error) {
    rethrowPgUniqueViolation(error, '指标编码已存在');
    throw error;
  }
}

interface MetricEvaluationInternal extends ReportMetricEvaluation {
  datasetId: number;
}

function metricFormat(format: string | null, unit: string | null): ReportFieldFormat | undefined {
  if (!format) return { kind: 'number', suffix: unit ?? undefined };
  if (format === 'percent') return { kind: 'percent', suffix: unit ?? undefined };
  if (format === 'currency') return { kind: 'currency', suffix: unit ?? undefined };
  const decimals = /^number:(\d)$/.exec(format)?.[1];
  return { kind: 'number', decimals: decimals ? Number(decimals) : 2, suffix: unit ?? undefined };
}

async function evaluateMetricRow(
  row: typeof reportMetrics.$inferSelect,
  params: Record<string, unknown> | undefined,
  stack: number[],
): Promise<MetricEvaluationInternal> {
  assertReportMetricReferenceStack(row.id, stack);
  const startedAt = Date.now();
  const execution = await getDatasetDataExecution(row.datasetId, params, { limit: 5000 }, {
    scene: 'metric',
    sourceRefId: row.id,
  });
  let value: number;
  let cacheHit = execution.cacheHit;
  if (row.type === 'simple') {
    value = aggregateMetricRows(
      execution.data.rows,
      row.sourceField,
      (row.aggregate ?? 'sum') as 'sum' | 'avg' | 'max' | 'min' | 'count' | 'distinct_count',
    );
  } else {
    if (!row.formula) throw new HTTPException(400, { message: '指标公式为空' });
    value = await evaluateMetricFormula(row.formula, execution.data.rows, async (code) => {
      const [maybeReference] = await db.select().from(reportMetrics)
        .where(and(eq(reportMetrics.code, code), metricTenantCondition(row.tenantId ?? null))).limit(1);
      const reference = requireRow(maybeReference, `指标引用不存在：${code}`, 400);
      if (currentUserOrNull()) await ensureReportResourceAccess('metric', reference.id, 'viewer');
      const result = await evaluateMetricRow(reference, params, [...stack, row.id]);
      cacheHit = cacheHit && result.cacheHit;
      return result.value;
    });
  }
  return {
    metricId: row.id,
    code: row.code,
    value,
    formattedValue: formatReportValue(value, metricFormat(row.format, row.unit)),
    unit: row.unit ?? null,
    durationMs: Date.now() - startedAt,
    cacheHit,
    datasetId: row.datasetId,
  };
}

export async function evaluateReportMetric(
  id: number,
  params?: Record<string, unknown>,
): Promise<ReportMetricEvaluation> {
  await ensureMetricAccess(id);
  const row = await ensureReportMetricExists(id);
  if (row.lifecycleStatus === 'deprecated') throw new HTTPException(400, { message: '指标已废弃，不能继续求值' });
  const { datasetId: _datasetId, ...result } = await evaluateMetricRow(row, params, []);
  return result;
}

export async function assertReportMetricEvaluableGlobally(
  id: number,
  stack: number[] = [],
): Promise<void> {
  const row = await ensureReportMetricExists(id);
  if (stack.includes(id)) throw new HTTPException(400, { message: '指标存在循环引用' });
  if (stack.length >= MAX_METRIC_DEPTH) throw new HTTPException(400, { message: `指标引用深度不能超过 ${MAX_METRIC_DEPTH} 层` });
  await assertDatasetEvaluableGlobally(row.datasetId);
  if (row.formula) {
    const { metricCodes } = analyzeMetricFormula(row.formula);
    for (const code of metricCodes) {
      const [maybeReference] = await db.select({ id: reportMetrics.id }).from(reportMetrics)
        .where(and(eq(reportMetrics.code, code), metricTenantCondition(row.tenantId ?? null))).limit(1);
      const reference = requireRow(maybeReference, `指标引用不存在：${code}`, 400);
      await assertReportMetricEvaluableGlobally(reference.id, [...stack, id]);
    }
  }
}

export async function publishReportMetric(
  id: number,
  input: ReportMetricLifecycleActionInput,
): Promise<ReportMetric> {
  await ensureMetricAccess(id, 'editor');
  const current = await ensureReportMetricExists(id);
  assertReportMetricRevision(current.revision, input.expectedRevision);
  await validateMetricDefinition({
    code: current.code,
    type: current.type,
    datasetId: current.datasetId,
    sourceField: current.sourceField,
    formula: current.formula,
    dimensions: current.dimensions,
    timeField: current.timeField,
    tenantId: current.tenantId ?? null,
  }, id);
  const snapshot = (await resolveReportResource('metric', id)).snapshot;
  const [rowOrUndefined] = await db.update(reportMetrics).set({
    lifecycleStatus: 'published',
    publishedSnapshot: snapshot,
    publishedAt: new Date(),
    publishedBy: currentUserId(),
    deprecatedAt: null,
    deprecatedBy: null,
    deprecationReason: null,
    revision: current.revision + 1,
  }).where(and(eq(reportMetrics.id, id), eq(reportMetrics.revision, input.expectedRevision))).returning();
  const row = requireRow(rowOrUndefined, '指标版本已变更，请刷新后重试', 409);
  return mapReportMetric(row);
}

export async function deprecateReportMetric(
  id: number,
  input: ReportMetricLifecycleActionInput,
): Promise<ReportMetric> {
  await ensureMetricAccess(id, 'editor');
  const current = await ensureReportMetricExists(id);
  assertReportMetricRevision(current.revision, input.expectedRevision);
  const [rowOrUndefined] = await db.update(reportMetrics).set({
    lifecycleStatus: 'deprecated',
    deprecatedAt: new Date(),
    deprecatedBy: currentUserId(),
    deprecationReason: input.reason ?? null,
    revision: current.revision + 1,
  }).where(and(eq(reportMetrics.id, id), eq(reportMetrics.revision, input.expectedRevision))).returning();
  const row = requireRow(rowOrUndefined, '指标版本已变更，请刷新后重试', 409);
  return mapReportMetric(row);
}

export async function collectReportMetricRefs(id: number): Promise<ReportMetricRefs> {
  await ensureMetricAccess(id);
  const metric = await ensureReportMetricExists(id);
  const [dashboards, alerts, metrics] = await Promise.all([
    db.select({
      id: reportDashboards.id,
      name: reportDashboards.name,
      widgets: reportDashboards.widgets,
      publishedSnapshot: reportDashboards.publishedSnapshot,
    }).from(reportDashboards).where(reportTenantScope(reportDashboards)),
    db.select({ id: reportAlertRules.id, name: reportAlertRules.name })
      .from(reportAlertRules).where(reportScopedWhere(reportAlertRules, eq(reportAlertRules.metricId, id))),
    db.select({ id: reportMetrics.id, code: reportMetrics.code, name: reportMetrics.name, formula: reportMetrics.formula })
      .from(reportMetrics).where(reportTenantScope(reportMetrics)),
  ]);
  const dashboardRefs = dashboards.map((dashboard) => {
    const draft = ((dashboard.widgets ?? []) as ReportWidget[])
      .filter((widget) => widget.metricId === id).map((widget) => widget.title || widget.i);
    const published = ((dashboard.publishedSnapshot ?? null) as ReportDashboardSnapshot | null)?.widgets
      ?.filter((widget) => widget.metricId === id).map((widget) => `${widget.title || widget.i}（已发布）`) ?? [];
    return { id: dashboard.id, name: dashboard.name, widgets: [...new Set([...draft, ...published])] };
  }).filter((dashboard) => dashboard.widgets.length > 0);
  const metricRefs = metrics.filter((candidate) => {
    if (candidate.id === id || !candidate.formula) return false;
    return analyzeMetricFormula(candidate.formula).metricCodes.includes(metric.code);
  }).map(({ id: refId, code, name }) => ({ id: refId, code, name }));
  return { dashboards: dashboardRefs, alerts, metrics: metricRefs };
}

export async function deleteReportMetric(id: number): Promise<void> {
  await ensureMetricAccess(id, 'owner');
  const refs = await collectReportMetricRefs(id);
  const parts = [];
  if (refs.dashboards.length) parts.push(`仪表盘 ${refs.dashboards.map((item) => `《${item.name}》`).join('、')}`);
  if (refs.alerts.length) parts.push(`预警 ${refs.alerts.map((item) => `《${item.name}》`).join('、')}`);
  if (refs.metrics.length) parts.push(`指标 ${refs.metrics.map((item) => `《${item.name}》`).join('、')}`);
  if (parts.length) throw new HTTPException(400, { message: `指标仍被引用，无法删除：${parts.join('；')}` });
  await db.delete(reportMetrics).where(eq(reportMetrics.id, id));
}

export async function publishMetricCapturedSnapshot(
  id: number,
  expectedRevision: number,
  snapshot: Record<string, unknown>,
): Promise<void> {
  const [rowOrUndefined] = await db.update(reportMetrics).set({
    lifecycleStatus: 'published',
    publishedSnapshot: snapshot,
    publishedAt: new Date(),
    publishedBy: currentUserId(),
    revision: expectedRevision + 1,
  }).where(and(eq(reportMetrics.id, id), eq(reportMetrics.revision, expectedRevision))).returning({ id: reportMetrics.id });
  requireRow(rowOrUndefined, '指标版本已变更，审批请求已失效', 409);
}
