import type { QueryOutputOf } from '@zenith/shared/core';
/**
 * 报表数据集 CRUD：映射、存在性/全局可求值校验、增删改查、复制、批量状态与血缘引用收集。
 * 对外统一经 report-dataset.service.ts facade 暴露。
 */
import { requireRow } from '../../lib/db-assert';
import { buildListResult } from '../../lib/list-query';
import { HTTPException } from 'hono/http-exception';
import { desc, eq, inArray } from 'drizzle-orm';
import { db } from '../../db';
import {
  reportAlertRules,
  reportDashboardEmbedTokens,
  reportDashboardShares,
  reportDashboardSubscriptions,
  reportDashboards,
  reportDatasets,
  reportDatasources,
  reportPrintTemplates,
  reportMetrics,
} from '../../db/schema';
import { pageOffset } from '../../lib/pagination';
import { buildWhere, keywordCondition } from '../../lib/where-helpers';
import { formatDateTime } from '../../lib/datetime';
import { rethrowPgUniqueViolation } from '../../lib/db-errors';
import { currentUserOrNull } from '../../lib/context';
import { buildReportCopyName } from './report-copy-name';
import { ensureDatasourceExists } from './report-datasource.service';
import {
  reportCreateTenantId,
  reportScopedWhere,
  reportTenantScope,
} from './report-access';
import {
  ensureReportResourceAccess,
  listAccessibleReportResourceIds,
} from './report-resource-acl.service';
import {
  defaultReportOwnerId,
  validateReportResourcePlacement,
} from './report-resource.service';
import { assertMaterializable, normalizeDatasetContent, normalizeIdentifier } from './report-dataset-shared';
import { clearDatasetCache } from './report-dataset-execution.service';
import { isSqlLikeType, REPORT_DATASOURCE_TYPES, reportDatasetContract } from '@zenith/shared/report';
import type { ReportDatasetRow } from '../../db/schema';
import type { ReportDataset, ReportField, ReportDatasetContent, ReportDatasetParam, ReportDatasourceType, ReportComputedField, ReportDatasetMaterialize, ReportRowRule, ReportDatasetRefs, ReportWidget, ReportFilter, ReportSqlDatasetContent, ReportDashboardSnapshot, ReportPrintContent, ReportLookupOption, CreateReportDatasetInput, UpdateReportDatasetInput } from '@zenith/shared/report';

type DatasetRowWithDs = ReportDatasetRow & {
  datasource?: { name: string } | null;
  folder?: { name: string } | null;
  owner?: { nickname: string | null; username: string } | null;
};

export function mapDataset(row: DatasetRowWithDs): ReportDataset {
  return {
    id: row.id,
    ownerId: row.ownerId ?? null,
    ownerName: row.owner?.nickname || row.owner?.username || null,
    folderId: row.folderId ?? null,
    folderName: row.folder?.name ?? null,
    name: row.name,
    datasourceId: row.datasourceId,
    datasourceName: row.datasource?.name ?? null,
    type: row.type,
    content: (row.content ?? {}) as ReportDatasetContent,
    fields: (row.fields ?? []) as ReportField[],
    params: (row.params ?? []) as ReportDatasetParam[],
    computedFields: (row.computedFields ?? []) as ReportComputedField[],
    cacheTtl: row.cacheTtl ?? 0,
    materialize: (row.materialize ?? {}) as ReportDatasetMaterialize,
    rowRules: (row.rowRules ?? []) as ReportRowRule[],
    status: row.status,
    remark: row.remark ?? null,
    createdBy: row.createdBy ?? null,
    updatedBy: row.updatedBy ?? null,
    createdAt: formatDateTime(row.createdAt),
    updatedAt: formatDateTime(row.updatedAt),
  };
}

function validateDatasetDefinitions(
  fields: ReportField[] | undefined,
  params: ReportDatasetParam[] | undefined,
  computedFields: ReportComputedField[] | undefined,
): void {
  const identRe = /^[A-Za-z_][A-Za-z0-9_]*$/;
  const fieldSet = new Set<string>();
  for (const field of fields ?? []) {
    if (!identRe.test(field.name) || field.name.startsWith('__')) {
      throw new HTTPException(400, { message: `字段名不合法：${field.name}` });
    }
    const key = normalizeIdentifier(field.name);
    if (fieldSet.has(key)) {
      throw new HTTPException(400, { message: `字段名重复：${field.name}` });
    }
    fieldSet.add(key);
  }
  const paramSet = new Set<string>();
  for (const param of params ?? []) {
    if (!identRe.test(param.name) || param.name.startsWith('__')) {
      throw new HTTPException(400, { message: `参数名不合法：${param.name}` });
    }
    const key = normalizeIdentifier(param.name);
    if (paramSet.has(key)) {
      throw new HTTPException(400, { message: `参数名重复：${param.name}` });
    }
    paramSet.add(key);
  }
  const computedSet = new Set<string>();
  const exprIdRe = /[A-Za-z_\u4e00-\u9fa5][A-Za-z0-9_\u4e00-\u9fa5.]*/g;
  const functions = new Set(['round', 'floor', 'ceil', 'abs', 'min', 'max', 'sqrt', 'pow', 'concat', 'upper', 'lower', 'trim', 'length', 'substr', 'number', 'string', 'coalesce', 'ifnull', 'if', 'now', 'true', 'false', 'null']);
  for (const item of computedFields ?? []) {
    if (!identRe.test(item.name) || item.name.startsWith('__')) {
      throw new HTTPException(400, { message: `计算字段名不合法：${item.name}` });
    }
    const key = normalizeIdentifier(item.name);
    if (fieldSet.has(key) || computedSet.has(key)) {
      throw new HTTPException(400, { message: `计算字段名重复：${item.name}` });
    }
    computedSet.add(key);
    for (const token of item.expression.match(exprIdRe) ?? []) {
      const lower = token.toLowerCase();
      if (functions.has(lower) || token.includes('.')) continue;
      if (!fieldSet.has(normalizeIdentifier(token)) && !computedSet.has(normalizeIdentifier(token))) {
        throw new HTTPException(400, { message: `计算字段 ${item.name} 引用了未声明字段：${token}` });
      }
    }
  }
}

export async function ensureDatasetExists(id: number): Promise<ReportDatasetRow> {
  const [rowOrUndefined] = await db.select().from(reportDatasets)
    .where(reportScopedWhere(reportDatasets, eq(reportDatasets.id, id)))
    .limit(1);
  const row = requireRow(rowOrUndefined, '数据集不存在');
  if (currentUserOrNull()) await ensureReportResourceAccess('dataset', id, 'viewer');
  return row;
}

/**
 * 校验数据集可在「无用户上下文 / 全局」场景安全求值（如数据预警 Cron、定时推送）。
 * 拒绝使用数据权限系统变量(${__userId} 等) 或含必填参数的数据集——否则全局评估会
 * 因缺少用户上下文/必填参数而得到错误或空结果，导致漏报/误报。
 */
export async function assertDatasetEvaluableGlobally(datasetId: number): Promise<void> {
  const row = await ensureDatasetExists(datasetId);
  const sqlText = isSqlLikeType(row.type) ? (((row.content ?? {}) as ReportSqlDatasetContent).sql ?? '') : '';
  if (/\$\{\s*__\w+\s*\}/.test(sqlText)) {
    throw new HTTPException(400, { message: '该数据集使用了数据权限系统变量（${__userId} 等），无法用于全局评估（如预警/定时任务），请改用无数据权限变量的数据集' });
  }
  const params = (row.params ?? []) as ReportDatasetParam[];
  if (params.some((p) => p.required)) {
    throw new HTTPException(400, { message: '该数据集含必填参数，无法用于全局评估（预警/定时任务无运行时参数），请改用无必填参数的数据集' });
  }
  const rowRules = (row.rowRules ?? []) as ReportRowRule[];
  if (rowRules.some((rule) => rule.enabled ?? true)) {
    throw new HTTPException(400, { message: '该数据集配置了行级权限，不能用于匿名分享或无身份定时任务' });
  }
}

export async function getDataset(id: number): Promise<ReportDataset> {
  const rowOrUndefined = await db.query.reportDatasets.findFirst({
    where: reportScopedWhere(reportDatasets, eq(reportDatasets.id, id)),
    with: {
      datasource: { columns: { name: true } },
      folder: { columns: { name: true } },
      owner: { columns: { nickname: true, username: true } },
    },
  });
  const row = requireRow(rowOrUndefined, '数据集不存在');
  return mapDataset(row);
}

export async function listDatasets(query: QueryOutputOf<typeof reportDatasetContract.list>) {
  const { page, pageSize, keyword, folderId, ownerId, datasourceId, type, status } = query;
  const conds = [];
  const tenantScope = reportTenantScope(reportDatasets);
  if (tenantScope) conds.push(tenantScope);
  const accessibleIds = await listAccessibleReportResourceIds('dataset');
  if (accessibleIds && accessibleIds.length === 0) return { list: [], total: 0, page, pageSize };
  if (accessibleIds) conds.push(inArray(reportDatasets.id, accessibleIds));
  if (folderId) conds.push(eq(reportDatasets.folderId, folderId));
  if (ownerId) conds.push(eq(reportDatasets.ownerId, ownerId));
  conds.push(keywordCondition(keyword, [reportDatasets.name, reportDatasets.remark], 'ilike'));
  if (datasourceId) conds.push(eq(reportDatasets.datasourceId, datasourceId));
  if (type && (REPORT_DATASOURCE_TYPES as readonly string[]).includes(type)) {
    conds.push(eq(reportDatasets.type, type as ReportDatasourceType));
  }
  if (status === 'enabled' || status === 'disabled') conds.push(eq(reportDatasets.status, status));
  const where = buildWhere(...conds);
  return buildListResult({
    page,
    pageSize,
    count: () => db.$count(reportDatasets, where),
    rows: () => db.query.reportDatasets.findMany({
            where,
            with: {
              datasource: { columns: { name: true } },
              folder: { columns: { name: true } },
              owner: { columns: { nickname: true, username: true } },
            },
            orderBy: desc(reportDatasets.id),
            limit: pageSize,
            offset: pageOffset(page, pageSize),
          }),
    map: mapDataset,
  });
}

export async function listDatasetLookup(query: {
  keyword?: string;
  status?: 'enabled' | 'disabled';
  limit?: number;
}): Promise<ReportLookupOption[]> {
  const { keyword, status, limit = 20 } = query;
  const conds = [];
  const tenantScope = reportTenantScope(reportDatasets);
  if (tenantScope) conds.push(tenantScope);
  const accessibleIds = await listAccessibleReportResourceIds('dataset');
  if (accessibleIds && accessibleIds.length === 0) return [];
  if (accessibleIds) conds.push(inArray(reportDatasets.id, accessibleIds));
  conds.push(keywordCondition(keyword, [reportDatasets.name, reportDatasets.remark], 'ilike'));
  if (status) conds.push(eq(reportDatasets.status, status));
  const where = buildWhere(...conds);
  const rows = await db.select({
    id: reportDatasets.id,
    name: reportDatasets.name,
    status: reportDatasets.status,
    datasourceId: reportDatasets.datasourceId,
    datasourceName: reportDatasources.name,
    type: reportDatasets.type,
  }).from(reportDatasets)
    .leftJoin(reportDatasources, eq(reportDatasources.id, reportDatasets.datasourceId))
    .where(where)
    .orderBy(desc(reportDatasets.id))
    .limit(Math.min(Math.max(limit, 1), 50));
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    status: row.status,
    datasourceId: row.datasourceId,
    datasourceName: row.datasourceName ?? null,
    type: row.type,
  }));
}

export async function batchSetDatasetStatus(ids: number[], status: 'enabled' | 'disabled'): Promise<number> {
  if (ids.length === 0) return 0;
  const accessible = await listAccessibleReportResourceIds('dataset', 'editor');
  const allowedIds = accessible ? ids.filter((id) => accessible.includes(id)) : ids;
  if (allowedIds.length === 0) return 0;
  const result = await db.update(reportDatasets).set({ status }).where(reportScopedWhere(reportDatasets, inArray(reportDatasets.id, allowedIds))).returning({ id: reportDatasets.id });
  return result.length;
}

export async function cloneDataset(id: number, input?: { name?: string | null }): Promise<ReportDataset> {
  await ensureReportResourceAccess('dataset', id, 'editor');
  const current = await ensureDatasetExists(id);
  const ownerId = defaultReportOwnerId();
  await validateReportResourcePlacement('dataset', {
    ownerId,
    folderId: current.folderId,
    tenantId: current.tenantId ?? reportCreateTenantId(),
  });
  const rows = await db.select({ name: reportDatasets.name }).from(reportDatasets).where(reportTenantScope(reportDatasets));
  const name = input?.name?.trim() || buildReportCopyName(current.name, new Set(rows.map((row) => row.name)));
  try {
    const [row] = await db.insert(reportDatasets).values({
      tenantId: current.tenantId ?? reportCreateTenantId(),
      ownerId,
      folderId: current.folderId ?? null,
      name,
      datasourceId: current.datasourceId,
      type: current.type,
      content: (current.content ?? {}) as ReportDatasetContent,
      fields: (current.fields ?? []) as ReportField[],
      params: (current.params ?? []) as ReportDatasetParam[],
      computedFields: (current.computedFields ?? []) as ReportComputedField[],
      cacheTtl: current.cacheTtl ?? 0,
      materialize: { ...(current.materialize ?? {}), enabled: false, refreshedAt: null, refreshedAtMs: null } as ReportDatasetMaterialize,
      rowRules: (current.rowRules ?? []) as ReportRowRule[],
      status: current.status,
      remark: current.remark ?? null,
    }).returning();
    return mapDataset(row);
  } catch (err) {
    rethrowPgUniqueViolation(err, '复制后的数据集名称已存在，请修改后重试');
    throw err;
  }
}

export async function createDataset(input: CreateReportDatasetInput): Promise<ReportDataset> {
  const ds = await ensureDatasourceExists(input.datasourceId);
  const content = normalizeDatasetContent(ds.type, input.content);
  validateDatasetDefinitions(input.fields as ReportField[] | undefined, input.params as ReportDatasetParam[] | undefined, input.computedFields as ReportComputedField[] | undefined);
  assertMaterializable(input.materialize as ReportDatasetMaterialize | undefined, ds.type, content, input.params as ReportDatasetParam[] | undefined, input.rowRules as ReportRowRule[] | undefined);
  const tenantId = reportCreateTenantId();
  if ((ds.tenantId ?? null) !== tenantId) throw new HTTPException(400, { message: '数据集与数据源不属于同一租户' });
  const ownerId = input.ownerId ?? defaultReportOwnerId();
  await validateReportResourcePlacement('dataset', { ownerId, folderId: input.folderId, tenantId });
  try {
    const [row] = await db.insert(reportDatasets).values({
      tenantId,
      ownerId,
      folderId: input.folderId ?? null,
      name: input.name,
      datasourceId: input.datasourceId,
      type: ds.type,
      content,
      fields: (input.fields ?? []) as ReportField[],
      params: (input.params ?? []) as ReportDatasetParam[],
      computedFields: (input.computedFields ?? []) as ReportComputedField[],
      cacheTtl: input.cacheTtl ?? 0,
      materialize: (input.materialize ?? {}) as ReportDatasetMaterialize,
      rowRules: (input.rowRules ?? []) as ReportRowRule[],
      status: input.status ?? 'enabled',
      remark: input.remark,
    }).returning();
    return mapDataset(row);
  } catch (err) {
    rethrowPgUniqueViolation(err, '数据集名称已存在');
    throw err;
  }
}

export async function updateDataset(id: number, input: UpdateReportDatasetInput): Promise<ReportDataset> {
  await ensureReportResourceAccess('dataset', id, 'editor');
  const current = await ensureDatasetExists(id);
  if (input.ownerId !== undefined && input.ownerId !== current.ownerId) {
    await ensureReportResourceAccess('dataset', id, 'owner');
  }
  let type: ReportDatasourceType = current.type;
  if (input.datasourceId && input.datasourceId !== current.datasourceId) {
    const ds = await ensureDatasourceExists(input.datasourceId);
    if ((ds.tenantId ?? null) !== (current.tenantId ?? null)) {
      throw new HTTPException(400, { message: '数据集与数据源不属于同一租户' });
    }
    type = ds.type;
  }
  const content = input.content !== undefined ? normalizeDatasetContent(type, input.content) : undefined;
  const typeChanged = input.datasourceId != null && input.datasourceId !== current.datasourceId;
  // 用合并后的最终态校验物化约束（部分更新时回退到现值）
  const effMaterialize = (input.materialize ?? current.materialize) as ReportDatasetMaterialize | undefined;
  const effContent = (content ?? current.content) as ReportDatasetContent;
  const effParams = (input.params ?? current.params) as ReportDatasetParam[] | undefined;
  const effFields = (input.fields ?? current.fields) as ReportField[] | undefined;
  const effComputed = (input.computedFields ?? current.computedFields) as ReportComputedField[] | undefined;
  const effRowRules = (input.rowRules ?? current.rowRules) as ReportRowRule[] | undefined;
  validateDatasetDefinitions(effFields, effParams, effComputed);
  assertMaterializable(effMaterialize, type, effContent, effParams, effRowRules);
  await validateReportResourcePlacement('dataset', {
    ownerId: input.ownerId,
    folderId: input.folderId,
    tenantId: current.tenantId ?? null,
  });
  try {
    const [rowOrUndefined] = await db.update(reportDatasets).set({
      ownerId: input.ownerId,
      folderId: input.folderId,
      name: input.name,
      datasourceId: input.datasourceId,
      type: typeChanged ? type : undefined,
      content,
      fields: input.fields as ReportField[] | undefined,
      params: input.params as ReportDatasetParam[] | undefined,
      computedFields: input.computedFields as ReportComputedField[] | undefined,
      cacheTtl: input.cacheTtl,
      materialize: input.materialize as ReportDatasetMaterialize | undefined,
      rowRules: input.rowRules as ReportRowRule[] | undefined,
      status: input.status,
      remark: input.remark,
    }).where(eq(reportDatasets.id, id)).returning();
    const row = requireRow(rowOrUndefined, '数据集不存在');
    await clearDatasetCache(id);
    return mapDataset(row);
  } catch (err) {
    rethrowPgUniqueViolation(err, '数据集名称已存在');
    throw err;
  }
}

// ─── 血缘（下游引用）────────────────────────────────────────────────────────────

/** 收集数据集的下游引用：仪表盘（组件绑定/筛选器动态选项）、打印模板、预警规则及间接分享链路 */
export async function collectDatasetRefs(id: number): Promise<ReportDatasetRefs> {
  if (currentUserOrNull()) await ensureReportResourceAccess('dataset', id, 'viewer');
  const datasetOrUndefined = await db.query.reportDatasets.findFirst({
    where: reportScopedWhere(reportDatasets, eq(reportDatasets.id, id)),
    with: { datasource: { columns: { id: true, name: true } } },
  });
  const dataset = requireRow(datasetOrUndefined, '数据集不存在');
  const [dashRows, printRows, metricRows, alertRows] = await Promise.all([
    db.select({
      id: reportDashboards.id,
      name: reportDashboards.name,
      widgets: reportDashboards.widgets,
      filters: reportDashboards.filters,
      publishedSnapshot: reportDashboards.publishedSnapshot,
      categoryId: reportDashboards.categoryId,
    })
      .from(reportDashboards).where(reportTenantScope(reportDashboards)),
    db.select({
      id: reportPrintTemplates.id,
      name: reportPrintTemplates.name,
      datasetId: reportPrintTemplates.datasetId,
      content: reportPrintTemplates.content,
    }).from(reportPrintTemplates).where(reportTenantScope(reportPrintTemplates)),
    db.select({ id: reportMetrics.id, code: reportMetrics.code, name: reportMetrics.name }).from(reportMetrics)
      .where(reportScopedWhere(reportMetrics, eq(reportMetrics.datasetId, id))),
    db.select({ id: reportAlertRules.id, name: reportAlertRules.name }).from(reportAlertRules)
      .where(reportScopedWhere(reportAlertRules, eq(reportAlertRules.datasetId, id))),
  ]);
  const printRefs = printRows
    .filter((item) => {
      if (item.datasetId === id) return true;
      const content = (item.content ?? {}) as ReportPrintContent;
      return (content.datasetBindings ?? []).some((binding) => binding.datasetId === id);
    })
    .map(({ id: printId, name }) => ({ id: printId, name }));
  const dashboards = dashRows
    .map((d) => {
      const draftWidgets = ((d.widgets ?? []) as ReportWidget[])
        .filter((w) => w.datasetId === id)
        .map((w) => w.title || w.i);
      const draftFilterIds = ((d.filters ?? []) as ReportFilter[])
        .filter((f) => f.optionSource?.kind === 'dataset' && f.optionSource.datasetId === id)
        .map((f) => f.label || f.id);
      const published = (d.publishedSnapshot ?? null) as ReportDashboardSnapshot | null;
      const publishedWidgets = (published?.widgets ?? [])
        .filter((w) => w.datasetId === id)
        .map((w) => `${w.title || w.i}（已发布）`);
      const publishedFilterIds = (published?.filters ?? [])
        .filter((f) => f.optionSource?.kind === 'dataset' && f.optionSource.datasetId === id)
        .map((f) => `${f.label || f.id}（已发布）`);
      const widgets = [...new Set([...draftWidgets, ...publishedWidgets])];
      const filterIds = [...new Set([...draftFilterIds, ...publishedFilterIds])];
      return { id: d.id, name: d.name, widgets, filterIds };
    })
    .filter((d) => d.widgets.length > 0 || d.filterIds.length > 0);
  const dashboardIds = dashboards.map((item) => item.id);
  const [subscriptionRows, shareRows, embedRows] = dashboardIds.length
    ? await Promise.all([
      db.select({ id: reportDashboardSubscriptions.id, dashboardId: reportDashboardSubscriptions.dashboardId, name: reportDashboards.name })
        .from(reportDashboardSubscriptions)
        .innerJoin(reportDashboards, eq(reportDashboards.id, reportDashboardSubscriptions.dashboardId))
        .where(reportScopedWhere(reportDashboardSubscriptions, inArray(reportDashboardSubscriptions.dashboardId, dashboardIds))),
      db.select({ id: reportDashboardShares.id, dashboardId: reportDashboardShares.dashboardId, name: reportDashboards.name })
        .from(reportDashboardShares)
        .innerJoin(reportDashboards, eq(reportDashboards.id, reportDashboardShares.dashboardId))
        .where(inArray(reportDashboardShares.dashboardId, dashboardIds)),
      db.select({ id: reportDashboardEmbedTokens.id, dashboardId: reportDashboardEmbedTokens.dashboardId, name: reportDashboards.name })
        .from(reportDashboardEmbedTokens)
        .innerJoin(reportDashboards, eq(reportDashboards.id, reportDashboardEmbedTokens.dashboardId))
        .where(inArray(reportDashboardEmbedTokens.dashboardId, dashboardIds)),
    ])
    : [[], [], []];

  const nodes: NonNullable<ReportDatasetRefs['nodes']> = [];
  const edges: NonNullable<ReportDatasetRefs['edges']> = [];
  const datasourceNodeId = `datasource:${dataset.datasourceId}`;
  const datasetNodeId = `dataset:${dataset.id}`;
  nodes.push({ id: datasourceNodeId, type: 'datasource', refId: dataset.datasourceId, label: dataset.datasource?.name ?? '数据源' });
  nodes.push({ id: datasetNodeId, type: 'dataset', refId: dataset.id, parentId: datasourceNodeId, label: dataset.name });
  edges.push({ id: `${datasourceNodeId}->${datasetNodeId}`, source: datasourceNodeId, target: datasetNodeId, label: '提供' });
  dashboards.forEach((dashboard) => {
    const dashboardNodeId = `dashboard:${dashboard.id}`;
    nodes.push({ id: dashboardNodeId, type: 'dashboard', refId: dashboard.id, parentId: datasetNodeId, label: dashboard.name });
    edges.push({ id: `${datasetNodeId}->${dashboardNodeId}`, source: datasetNodeId, target: dashboardNodeId, label: '驱动' });
    dashboard.widgets.forEach((widgetLabel, index) => {
      const widgetNodeId = `widget:${dashboard.id}:${index}`;
      nodes.push({ id: widgetNodeId, type: 'widget', parentId: dashboardNodeId, label: widgetLabel, meta: { dashboardId: dashboard.id } });
      edges.push({ id: `${dashboardNodeId}->${widgetNodeId}`, source: dashboardNodeId, target: widgetNodeId, label: '组件' });
    });
    dashboard.filterIds.forEach((filterLabel, index) => {
      const filterNodeId = `filter:${dashboard.id}:${index}`;
      nodes.push({ id: filterNodeId, type: 'filter', parentId: dashboardNodeId, label: filterLabel, meta: { dashboardId: dashboard.id } });
      edges.push({ id: `${dashboardNodeId}->${filterNodeId}`, source: dashboardNodeId, target: filterNodeId, label: '筛选器' });
    });
  });
  printRefs.forEach((item) => {
    const nodeId = `print:${item.id}`;
    nodes.push({ id: nodeId, type: 'print', refId: item.id, parentId: datasetNodeId, label: item.name });
    edges.push({ id: `${datasetNodeId}->${nodeId}`, source: datasetNodeId, target: nodeId, label: '打印' });
  });
  metricRows.forEach((item) => {
    const nodeId = `metric:${item.id}`;
    nodes.push({ id: nodeId, type: 'metric', refId: item.id, parentId: datasetNodeId, label: item.name });
    edges.push({ id: `${datasetNodeId}->${nodeId}`, source: datasetNodeId, target: nodeId, label: '定义' });
  });
  alertRows.forEach((item) => {
    const nodeId = `alert:${item.id}`;
    nodes.push({ id: nodeId, type: 'alert', refId: item.id, parentId: datasetNodeId, label: item.name });
    edges.push({ id: `${datasetNodeId}->${nodeId}`, source: datasetNodeId, target: nodeId, label: '预警' });
  });
  subscriptionRows.forEach((item) => {
    const dashboardNodeId = `dashboard:${item.dashboardId}`;
    const nodeId = `subscription:${item.id}`;
    nodes.push({ id: nodeId, type: 'subscription', refId: item.id, parentId: dashboardNodeId, label: `${item.name} · 订阅` });
    edges.push({ id: `${dashboardNodeId}->${nodeId}`, source: dashboardNodeId, target: nodeId, label: '订阅' });
  });
  shareRows.forEach((item) => {
    const dashboardNodeId = `dashboard:${item.dashboardId}`;
    const nodeId = `share:${item.id}`;
    nodes.push({ id: nodeId, type: 'share', refId: item.id, parentId: dashboardNodeId, label: `${item.name} · 分享` });
    edges.push({ id: `${dashboardNodeId}->${nodeId}`, source: dashboardNodeId, target: nodeId, label: '分享' });
  });
  embedRows.forEach((item) => {
    const dashboardNodeId = `dashboard:${item.dashboardId}`;
    const nodeId = `embed:${item.id}`;
    nodes.push({ id: nodeId, type: 'embed', refId: item.id, parentId: dashboardNodeId, label: `${item.name} · 嵌入` });
    edges.push({ id: `${dashboardNodeId}->${nodeId}`, source: dashboardNodeId, target: nodeId, label: '嵌入' });
  });
  return {
    dashboards,
    printTemplates: printRefs,
    metrics: metricRows,
    alerts: alertRows,
    subscriptions: subscriptionRows,
    shares: shareRows,
    embedTokens: embedRows,
    nodes,
    edges,
  };
}

/** 删除数据集：存在下游引用时拒绝（防仪表盘悄悄失效 / 预警被级联误删） */
export async function deleteDataset(id: number): Promise<void> {
  await ensureReportResourceAccess('dataset', id, 'owner');
  await ensureDatasetExists(id);
  const refs = await collectDatasetRefs(id);
  const parts: string[] = [];
  if (refs.dashboards.length) parts.push(`仪表盘 ${refs.dashboards.map((d) => `《${d.name}》`).join('、')}`);
  if (refs.printTemplates.length) parts.push(`打印报表 ${refs.printTemplates.map((t) => `《${t.name}》`).join('、')}`);
  if (refs.metrics.length) parts.push(`指标 ${refs.metrics.map((metric) => `《${metric.name}》`).join('、')}`);
  if (refs.alerts.length) parts.push(`预警规则 ${refs.alerts.map((a) => `《${a.name}》`).join('、')}`);
  if (refs.subscriptions?.length) parts.push(`订阅 ${refs.subscriptions.map((s) => `《${s.name}》`).join('、')}`);
  if (refs.shares?.length) parts.push(`分享 ${refs.shares.map((s) => `《${s.name}》`).join('、')}`);
  if (refs.embedTokens?.length) parts.push(`嵌入 ${refs.embedTokens.map((s) => `《${s.name}》`).join('、')}`);
  if (parts.length) {
    throw new HTTPException(400, { message: `该数据集正被引用，无法删除：${parts.join('；')}。请先在「血缘」中查看并解除引用` });
  }
  await db.delete(reportDatasets).where(eq(reportDatasets.id, id));
  await clearDatasetCache(id);
}
