/**
 * 报表仪表盘 Service
 * - draft = 当前设计草稿
 * - publishedSnapshot = 已发布只读快照（查看/公开/嵌入默认读取）
 */
import { HTTPException } from 'hono/http-exception';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { db } from '../../db';
import { config } from '../../config';
import {
  reportDashboardCategories,
  reportDashboards,
  reportDashboardFavorites,
} from '../../db/schema';
import { pageOffset } from '../../lib/pagination';
import { buildWhere, keywordCondition } from '../../lib/where-helpers';
import { formatDateTime, formatNullableDateTime } from '../../lib/datetime';
import { rethrowPgUniqueViolation } from '../../lib/db-errors';
import { currentUserOrNull, hasPermission } from '../../lib/context';
import { mapWithConcurrency } from '../../lib/concurrency';
import { buildReportCopyName } from './report-copy-name';
import { assertDatasetEvaluableGlobally, ensureDatasetExists, getDatasetDataExecution } from './report-dataset.service';
import {
  buildDashboardSnapshot,
} from './report-dashboard-runtime';
import {
  assertReportMetricEvaluableGlobally,
  ensureReportMetricExists,
  evaluateReportMetric,
} from './report-metric.service';
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
import type { ReportDashboardRow } from '../../db/schema';
import { computeWidgetParams, type CreateReportDashboardInput, type ReportCanvasItem, type ReportDashboard, type ReportDashboardConfig, type ReportDashboardLifecycleStatus, type ReportDashboardSnapshot, type ReportDatasetQueryOptions, type ReportFilter, type ReportGridItem, type ReportLookupOption, type ReportMetricEvaluation, type ReportWidget, type ReportWidgetDataResult, type UpdateReportDashboardInput } from '@zenith/shared/report';

type DashboardRowExt = ReportDashboardRow & {
  category?: { name: string } | null;
  publishedByUser?: { nickname: string | null; username: string } | null;
  folder?: { name: string } | null;
  owner?: { nickname: string | null; username: string } | null;
};

export class DashboardRevisionConflictError extends Error {
  constructor(
    message: string,
    readonly currentRevision: number,
    readonly currentDashboard: ReportDashboard,
  ) {
    super(message);
  }
}

function snapshotOrRowValue<T>(
  snapshot: ReportDashboardSnapshot | null | undefined,
  key: keyof ReportDashboardSnapshot,
  fallback: T,
): T {
  if (!snapshot) return fallback;
  return ((snapshot[key] as T | undefined) ?? fallback);
}

export function mapDashboard(
  row: DashboardRowExt,
  favorited?: boolean,
  snapshot?: ReportDashboardSnapshot | null,
): ReportDashboard {
  return {
    id: row.id,
    ownerId: row.ownerId ?? null,
    ownerName: row.owner?.nickname || row.owner?.username || null,
    folderId: row.folderId ?? null,
    folderName: row.folder?.name ?? null,
    name: snapshotOrRowValue(snapshot, 'name', row.name),
    layout: snapshotOrRowValue(snapshot, 'layout', (row.layout ?? []) as ReportGridItem[]),
    canvasLayout: snapshotOrRowValue(snapshot, 'canvasLayout', (row.canvasLayout ?? []) as ReportCanvasItem[]),
    widgets: snapshotOrRowValue(snapshot, 'widgets', (row.widgets ?? []) as ReportWidget[]),
    filters: snapshotOrRowValue(snapshot, 'filters', (row.filters ?? []) as ReportFilter[]),
    config: snapshotOrRowValue(snapshot, 'config', (row.config ?? {}) as ReportDashboardConfig),
    categoryId: snapshotOrRowValue(snapshot, 'categoryId', row.categoryId ?? null),
    categoryName: row.category?.name ?? null,
    favorited,
    status: row.status,
    lifecycleStatus: row.lifecycleStatus,
    revision: row.revision,
    publishedSnapshot: (row.publishedSnapshot ?? null) as ReportDashboardSnapshot | null,
    publishedAt: formatNullableDateTime(row.publishedAt),
    publishedBy: row.publishedBy ?? null,
    publishedByName: row.publishedByUser?.nickname || row.publishedByUser?.username || null,
    remark: snapshotOrRowValue(snapshot, 'remark', row.remark ?? null),
    createdBy: row.createdBy ?? null,
    updatedBy: row.updatedBy ?? null,
    createdAt: formatDateTime(row.createdAt),
    updatedAt: formatDateTime(row.updatedAt),
  };
}

function draftSnapshotFromRow(row: ReportDashboardRow): ReportDashboardSnapshot {
  return buildDashboardSnapshot({
    name: row.name,
    layout: (row.layout ?? []) as ReportGridItem[],
    canvasLayout: (row.canvasLayout ?? []) as ReportCanvasItem[],
    widgets: (row.widgets ?? []) as ReportWidget[],
    filters: (row.filters ?? []) as ReportFilter[],
    config: (row.config ?? {}) as ReportDashboardConfig,
    categoryId: row.categoryId ?? null,
    remark: row.remark ?? null,
  });
}

async function canPreviewDraft(dashboardId: number): Promise<boolean> {
  if (!currentUserOrNull()) return false;
  if (!(await hasPermission('report:dashboard:update'))) return false;
  try {
    await ensureReportResourceAccess('dashboard', dashboardId, 'editor');
    return true;
  } catch (error) {
    if (error instanceof HTTPException && error.status === 403) return false;
    throw error;
  }
}

export async function resolveDashboardSnapshotForMode(
  row: DashboardRowExt,
  mode: 'auto' | 'draft' | 'published',
  options?: { allowOfflinePublished?: boolean },
): Promise<ReportDashboardSnapshot> {
  if (mode === 'draft') {
    if (!(await canPreviewDraft(row.id))) {
      throw new HTTPException(403, { message: '仅有编辑权限的用户可预览草稿' });
    }
    return draftSnapshotFromRow(row);
  }

  const published = (row.publishedSnapshot ?? null) as ReportDashboardSnapshot | null;
  const publishedAccessible = published
    && (row.lifecycleStatus === 'published' || (options?.allowOfflinePublished && row.lifecycleStatus === 'offline'));

  if (mode === 'published') {
    if (!publishedAccessible) throw new HTTPException(404, { message: '仪表盘未发布或已下线' });
    return published;
  }

  if (publishedAccessible) return published;
  if (row.lifecycleStatus === 'draft' && await canPreviewDraft(row.id)) return draftSnapshotFromRow(row);
  throw new HTTPException(404, { message: '仪表盘未发布' });
}

export async function ensureDashboardExists(id: number): Promise<ReportDashboardRow> {
  const [row] = await db.select().from(reportDashboards)
    .where(reportScopedWhere(reportDashboards, eq(reportDashboards.id, id)))
    .limit(1);
  if (!row) throw new HTTPException(404, { message: '仪表盘不存在' });
  if (currentUserOrNull()) await ensureReportResourceAccess('dashboard', id, 'viewer');
  return row;
}

export async function getDashboard(
  id: number,
  options?: { mode?: 'auto' | 'draft' | 'published'; allowOfflinePublished?: boolean },
): Promise<ReportDashboard> {
  if (currentUserOrNull()) await ensureReportResourceAccess('dashboard', id, 'viewer');
  const row = await db.query.reportDashboards.findFirst({
    where: reportScopedWhere(reportDashboards, eq(reportDashboards.id, id)),
    with: {
      category: { columns: { name: true } },
      publishedByUser: { columns: { nickname: true, username: true } },
      folder: { columns: { name: true } },
      owner: { columns: { nickname: true, username: true } },
    },
  });
  if (!row) throw new HTTPException(404, { message: '仪表盘不存在' });
  const uid = currentUserOrNull()?.userId;
  let favorited: boolean | undefined;
  if (uid) {
    favorited = (await db.$count(
      reportDashboardFavorites,
      and(eq(reportDashboardFavorites.userId, uid), eq(reportDashboardFavorites.dashboardId, id)),
    )) > 0;
  }
  const snapshot = await resolveDashboardSnapshotForMode(row, options?.mode ?? 'auto', {
    allowOfflinePublished: options?.allowOfflinePublished,
  });
  return mapDashboard(row, favorited, snapshot);
}

export async function listDashboards(query: {
  page?: number;
  pageSize?: number;
  keyword?: string;
  folderId?: number;
  ownerId?: number;
  status?: string;
  lifecycleStatus?: ReportDashboardLifecycleStatus;
  categoryId?: number;
  favorited?: boolean;
}) {
  const {
    page = 1,
    pageSize = 20,
    keyword,
    folderId,
    ownerId,
    status,
    lifecycleStatus,
    categoryId,
    favorited,
  } = query;
  const uid = currentUserOrNull()?.userId;
  const conds = [];
  const tenantScope = reportTenantScope(reportDashboards);
  if (tenantScope) conds.push(tenantScope);
  const accessibleIds = await listAccessibleReportResourceIds('dashboard');
  if (accessibleIds && accessibleIds.length === 0) return { list: [], total: 0, page, pageSize };
  if (accessibleIds) conds.push(inArray(reportDashboards.id, accessibleIds));
  if (folderId) conds.push(eq(reportDashboards.folderId, folderId));
  if (ownerId) conds.push(eq(reportDashboards.ownerId, ownerId));
  conds.push(keywordCondition(keyword, [reportDashboards.name, reportDashboards.remark], 'ilike'));
  if (status === 'enabled' || status === 'disabled') conds.push(eq(reportDashboards.status, status));
  if (lifecycleStatus) conds.push(eq(reportDashboards.lifecycleStatus, lifecycleStatus));
  if (categoryId) conds.push(eq(reportDashboards.categoryId, categoryId));
  if (favorited && uid) {
    const favRows = await db.select({ id: reportDashboardFavorites.dashboardId })
      .from(reportDashboardFavorites)
      .where(eq(reportDashboardFavorites.userId, uid));
    const ids = favRows.map((row) => row.id);
    if (ids.length === 0) return { list: [], total: 0, page, pageSize };
    conds.push(inArray(reportDashboards.id, ids));
  }
  const where = buildWhere(...conds);
  const [total, rows] = await Promise.all([
    db.$count(reportDashboards, where),
    db.query.reportDashboards.findMany({
      where,
      with: {
        category: { columns: { name: true } },
        publishedByUser: { columns: { nickname: true, username: true } },
        folder: { columns: { name: true } },
        owner: { columns: { nickname: true, username: true } },
      },
      orderBy: desc(reportDashboards.id),
      limit: pageSize,
      offset: pageOffset(page, pageSize),
    }),
  ]);
  let favSet = new Set<number>();
  if (uid && rows.length > 0) {
    const favRows = await db.select({ id: reportDashboardFavorites.dashboardId }).from(reportDashboardFavorites)
      .where(and(
        eq(reportDashboardFavorites.userId, uid),
        inArray(reportDashboardFavorites.dashboardId, rows.map((row) => row.id)),
      ));
    favSet = new Set(favRows.map((row) => row.id));
  }
  return {
    list: rows.map((row) => mapDashboard(row, uid ? favSet.has(row.id) : undefined)),
    total,
    page,
    pageSize,
  };
}

export async function listDashboardLookup(query: {
  keyword?: string;
  status?: 'enabled' | 'disabled';
  limit?: number;
  excludeId?: number;
}): Promise<ReportLookupOption[]> {
  const { keyword, status, limit = 20, excludeId } = query;
  const conds = [];
  const tenantScope = reportTenantScope(reportDashboards);
  if (tenantScope) conds.push(tenantScope);
  const accessibleIds = await listAccessibleReportResourceIds('dashboard');
  if (accessibleIds && accessibleIds.length === 0) return [];
  if (accessibleIds) conds.push(inArray(reportDashboards.id, accessibleIds));
  conds.push(keywordCondition(keyword, [reportDashboards.name, reportDashboards.remark], 'ilike'));
  if (status) conds.push(eq(reportDashboards.status, status));
  if (excludeId) conds.push(sql`${reportDashboards.id} <> ${excludeId}`);
  const where = buildWhere(...conds);
  const rows = await db.select({
    id: reportDashboards.id,
    name: reportDashboards.name,
    status: reportDashboards.status,
    categoryId: reportDashboards.categoryId,
    categoryName: reportDashboardCategories.name,
  }).from(reportDashboards)
    .leftJoin(reportDashboardCategories, eq(reportDashboardCategories.id, reportDashboards.categoryId))
    .where(where)
    .orderBy(desc(reportDashboards.id))
    .limit(Math.min(Math.max(limit, 1), 50));
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    status: row.status,
    categoryId: row.categoryId ?? null,
    categoryName: row.categoryName ?? null,
  }));
}

export async function batchSetDashboardStatus(ids: number[], status: 'enabled' | 'disabled'): Promise<number> {
  if (ids.length === 0) return 0;
  const accessible = await listAccessibleReportResourceIds('dashboard', 'editor');
  const allowedIds = accessible ? ids.filter((id) => accessible.includes(id)) : ids;
  if (allowedIds.length === 0) return 0;
  const result = await db.update(reportDashboards).set({ status }).where(reportScopedWhere(reportDashboards, inArray(reportDashboards.id, allowedIds))).returning({ id: reportDashboards.id });
  return result.length;
}

export async function cloneDashboard(id: number, input?: { name?: string | null }): Promise<ReportDashboard> {
  await ensureReportResourceAccess('dashboard', id, 'editor');
  const current = await ensureDashboardExists(id);
  const rows = await db.select({ name: reportDashboards.name }).from(reportDashboards).where(reportTenantScope(reportDashboards));
  const name = input?.name?.trim() || buildReportCopyName(current.name, new Set(rows.map((row) => row.name)));
  const snapshot = draftSnapshotFromRow(current);
  await ensureDashboardReferences(
    snapshot.widgets,
    snapshot.filters,
    snapshot.categoryId ?? null,
    undefined,
    current.tenantId ?? null,
  );
  const ownerId = defaultReportOwnerId();
  await validateReportResourcePlacement('dashboard', {
    ownerId,
    folderId: current.folderId,
    tenantId: current.tenantId ?? reportCreateTenantId(),
  });
  try {
    const [row] = await db.insert(reportDashboards).values({
      tenantId: current.tenantId ?? reportCreateTenantId(),
      ownerId,
      folderId: current.folderId ?? null,
      name,
      layout: snapshot.layout,
      canvasLayout: snapshot.canvasLayout ?? [],
      widgets: snapshot.widgets,
      filters: snapshot.filters,
      config: snapshot.config,
      categoryId: snapshot.categoryId ?? null,
      status: current.status,
      lifecycleStatus: 'draft',
      lifecycleInitialized: true,
      revision: 1,
      publishedSnapshot: null,
      publishedAt: null,
      publishedBy: null,
      remark: snapshot.remark ?? null,
    }).returning();
    return mapDashboard(row);
  } catch (err) {
    rethrowPgUniqueViolation(err, '复制后的仪表盘名称已存在，请修改后重试');
    throw err;
  }
}

export async function createDashboard(input: CreateReportDashboardInput): Promise<ReportDashboard> {
  const tenantId = reportCreateTenantId();
  await ensureDashboardReferences(
    (input.widgets ?? []) as ReportWidget[],
    (input.filters ?? []) as ReportFilter[],
    input.categoryId ?? null,
    undefined,
    tenantId,
  );
  const ownerId = input.ownerId ?? defaultReportOwnerId();
  await validateReportResourcePlacement('dashboard', { ownerId, folderId: input.folderId, tenantId });
  try {
    const [row] = await db.insert(reportDashboards).values({
      tenantId,
      ownerId,
      folderId: input.folderId ?? null,
      name: input.name,
      layout: (input.layout ?? []) as ReportGridItem[],
      canvasLayout: (input.canvasLayout ?? []) as ReportCanvasItem[],
      widgets: (input.widgets ?? []) as ReportWidget[],
      filters: (input.filters ?? []) as ReportFilter[],
      config: (input.config ?? {}) as ReportDashboardConfig,
      categoryId: input.categoryId ?? null,
      status: input.status ?? 'enabled',
      lifecycleStatus: 'draft',
      lifecycleInitialized: true,
      revision: 1,
      remark: input.remark,
    }).returning();
    return mapDashboard(row);
  } catch (err) {
    rethrowPgUniqueViolation(err, '仪表盘名称已存在');
    throw err;
  }
}

export async function updateDashboardDraft(id: number, input: UpdateReportDashboardInput): Promise<ReportDashboard> {
  await ensureReportResourceAccess('dashboard', id, 'editor');
  const current = await ensureDashboardExists(id);
  if (input.ownerId !== undefined && input.ownerId !== current.ownerId) {
    await ensureReportResourceAccess('dashboard', id, 'owner');
  }
  if (input.expectedRevision !== current.revision) {
    throw new DashboardRevisionConflictError(
      '仪表盘草稿已被其他人更新，请先刷新后再保存',
      current.revision,
      mapDashboard(current),
    );
  }

  const nextSnapshot = buildDashboardSnapshot({
    name: input.name ?? current.name,
    layout: (input.layout ?? current.layout ?? []) as ReportGridItem[],
    canvasLayout: (input.canvasLayout ?? current.canvasLayout ?? []) as ReportCanvasItem[],
    widgets: (input.widgets ?? current.widgets ?? []) as ReportWidget[],
    filters: (input.filters ?? current.filters ?? []) as ReportFilter[],
    config: (input.config ?? current.config ?? {}) as ReportDashboardConfig,
    categoryId: input.categoryId === undefined ? current.categoryId ?? null : input.categoryId,
    remark: input.remark === undefined ? current.remark ?? null : input.remark ?? null,
  });
  await ensureDashboardReferences(
    nextSnapshot.widgets ?? [],
    nextSnapshot.filters ?? [],
    nextSnapshot.categoryId ?? null,
    id,
    current.tenantId ?? null,
  );
  await validateReportResourcePlacement('dashboard', {
    ownerId: input.ownerId,
    folderId: input.folderId,
    tenantId: current.tenantId ?? null,
  });

  try {
    const [row] = await db.update(reportDashboards).set({
      ownerId: input.ownerId,
      folderId: input.folderId,
      name: nextSnapshot.name,
      layout: nextSnapshot.layout as ReportGridItem[],
      canvasLayout: nextSnapshot.canvasLayout as ReportCanvasItem[] | undefined,
      widgets: nextSnapshot.widgets as ReportWidget[],
      filters: nextSnapshot.filters as ReportFilter[],
      config: nextSnapshot.config as ReportDashboardConfig,
      categoryId: nextSnapshot.categoryId ?? null,
      status: input.status ?? current.status,
      remark: nextSnapshot.remark ?? null,
      revision: current.revision + 1,
    }).where(and(eq(reportDashboards.id, id), eq(reportDashboards.revision, input.expectedRevision))).returning();
    if (!row) {
      const latest = await ensureDashboardExists(id);
      throw new DashboardRevisionConflictError(
        '仪表盘草稿已被其他人更新，请先刷新后再保存',
        latest.revision,
        mapDashboard(latest),
      );
    }
    return mapDashboard(row);
  } catch (err) {
    rethrowPgUniqueViolation(err, '仪表盘名称已存在');
    throw err;
  }
}

export async function deleteDashboard(id: number): Promise<void> {
  await ensureReportResourceAccess('dashboard', id, 'owner');
  await ensureDashboardExists(id);
  await db.delete(reportDashboards).where(eq(reportDashboards.id, id));
}

export async function ensureDashboardReferences(
  widgets: ReportWidget[],
  filters: ReportFilter[],
  categoryId: number | null | undefined,
  dashboardId?: number,
  tenantId?: number | null,
): Promise<void> {
  const datasetIds = new Set<number>();
  const metricIds = new Set<number>();
  const targetDashboardIds = new Set<number>();
  for (const widget of widgets) {
    if (widget.metricId && widget.datasetId) {
      throw new HTTPException(400, { message: `组件「${widget.title || widget.i}」不能同时绑定数据集和指标` });
    }
    if (widget.datasetId) datasetIds.add(widget.datasetId);
    if (widget.metricId) {
      if (!['kpi', 'gauge', 'flipper', 'liquid'].includes(widget.type)) {
        throw new HTTPException(400, { message: `组件「${widget.title || widget.i}」不支持指标数据源` });
      }
      metricIds.add(widget.metricId);
    }
    const targetId = widget.drilldown?.targetDashboardId;
    if (targetId && targetId !== dashboardId) targetDashboardIds.add(targetId);
  }
  for (const filter of filters) {
    if (filter.optionSource?.kind === 'dataset' && filter.optionSource.datasetId) {
      datasetIds.add(filter.optionSource.datasetId);
    }
  }
  const [datasets, metrics, targetDashboards] = await Promise.all([
    Promise.all([...datasetIds].map((datasetId) => ensureDatasetExists(datasetId))),
    Promise.all([...metricIds].map((metricId) => ensureReportMetricExists(metricId))),
    Promise.all([...targetDashboardIds].map((targetId) => ensureDashboardExists(targetId))),
  ]);
  if (tenantId !== undefined) {
    const crossTenant = [...datasets, ...metrics, ...targetDashboards]
      .some((resource) => (resource.tenantId ?? null) !== tenantId);
    if (crossTenant) throw new HTTPException(400, { message: '仪表盘引用了其他租户的报表资源' });
  }
  if (categoryId) {
    const [category] = await db.select({ id: reportDashboardCategories.id, tenantId: reportDashboardCategories.tenantId })
      .from(reportDashboardCategories)
      .where(reportScopedWhere(reportDashboardCategories, eq(reportDashboardCategories.id, categoryId)))
      .limit(1);
    if (!category) throw new HTTPException(404, { message: '仪表盘分类不存在' });
    if (tenantId !== undefined && (category.tenantId ?? null) !== tenantId) {
      throw new HTTPException(400, { message: '仪表盘与分类不属于同一租户' });
    }
  }
}

export async function assertDashboardEvaluableGlobally(id: number): Promise<void> {
  const dashboard = await ensureDashboardExists(id);
  await assertDashboardSnapshotEvaluableGlobally(draftSnapshotFromRow(dashboard), dashboard.tenantId ?? null);
}

export async function assertDashboardSnapshotEvaluableGlobally(
  snapshot: ReportDashboardSnapshot,
  tenantId?: number | null,
): Promise<void> {
  const datasetIds = new Set<number>();
  const metricIds = new Set<number>();
  for (const widget of snapshot.widgets ?? []) {
    if (widget.datasetId) datasetIds.add(widget.datasetId);
    if (widget.metricId) metricIds.add(widget.metricId);
  }
  for (const filter of snapshot.filters ?? []) {
    if (filter.optionSource?.kind === 'dataset' && filter.optionSource.datasetId) {
      datasetIds.add(filter.optionSource.datasetId);
    }
  }
  await Promise.all([
    ...[...datasetIds].map(async (datasetId) => {
      const dataset = await ensureDatasetExists(datasetId);
      if (tenantId !== undefined && (dataset.tenantId ?? null) !== tenantId) {
        throw new HTTPException(400, { message: '仪表盘引用了其他租户的数据集' });
      }
      await assertDatasetEvaluableGlobally(datasetId);
    }),
    ...[...metricIds].map(async (metricId) => {
      const metric = await ensureReportMetricExists(metricId);
      if (tenantId !== undefined && (metric.tenantId ?? null) !== tenantId) {
        throw new HTTPException(400, { message: '仪表盘引用了其他租户的指标' });
      }
      await assertReportMetricEvaluableGlobally(metricId);
    }),
  ]);
}

const DASHBOARD_DATA_CONCURRENCY = config.report.dashboardMaxConcurrent;

function toWidgetDataError(err: unknown): { code: number; message: string } {
  if (err instanceof HTTPException) return { code: err.status, message: err.message };
  if (err instanceof Error) return { code: 500, message: err.message };
  return { code: 500, message: String(err) };
}

export function buildMetricWidgetDataResult(metric: ReportMetricEvaluation): ReportWidgetDataResult {
  return {
    data: {
      columns: ['value'],
      fields: [{ name: 'value', label: metric.code, type: 'number' }],
      rows: [{ value: metric.value, formattedValue: metric.formattedValue, unit: metric.unit ?? null }],
      total: 1,
    },
    error: null,
    durationMs: metric.durationMs,
    cacheHit: metric.cacheHit,
  };
}

function resolveWidgetQuery(
  widget: ReportWidget,
  limit: number | undefined,
  widgetQueries: Record<string, ReportDatasetQueryOptions> | undefined,
): ReportDatasetQueryOptions {
  const override = widgetQueries?.[widget.i] ?? {};
  if (widget.type === 'table') {
    return {
      limit: override.limit,
      page: override.page,
      pageSize: override.pageSize ?? limit,
      sortField: override.sortField,
      sortOrder: override.sortOrder,
    };
  }
  return { limit: override.limit ?? limit };
}

export async function getDashboardData(
  widgets: ReportWidget[],
  filterValues: Record<string, unknown>,
  limit?: number,
  widgetQueries?: Record<string, ReportDatasetQueryOptions>,
  sourceRefId?: string | number | null,
): Promise<Record<string, ReportWidgetDataResult>> {
  const out: Record<string, ReportWidgetDataResult> = {};
  const entryMap = new Map<string, {
    datasetId: number;
    params: Record<string, unknown>;
    query: ReportDatasetQueryOptions;
    widgetIds: string[];
  }>();
  const metricEntryMap = new Map<string, {
    metricId: number;
    params: Record<string, unknown>;
    widgetIds: string[];
  }>();
  for (const widget of widgets ?? []) {
    if (widget.metricId) {
      if (!['kpi', 'gauge', 'flipper', 'liquid'].includes(widget.type)) {
        out[widget.i] = {
          data: null,
          error: { code: 400, message: '当前组件类型不支持指标数据源' },
          durationMs: 0,
          cacheHit: false,
        };
        continue;
      }
      const params = computeWidgetParams(widget, filterValues);
      const key = `${widget.metricId}:${JSON.stringify(params)}`;
      const entry = metricEntryMap.get(key);
      if (entry) entry.widgetIds.push(widget.i);
      else metricEntryMap.set(key, { metricId: widget.metricId, params, widgetIds: [widget.i] });
      continue;
    }
    if (!widget.datasetId) continue;
    const params = computeWidgetParams(widget, filterValues);
    const query = resolveWidgetQuery(widget, limit, widgetQueries);
    const key = `${widget.datasetId}:${JSON.stringify(params)}:${JSON.stringify(query)}`;
    const entry = entryMap.get(key);
    if (entry) entry.widgetIds.push(widget.i);
    else entryMap.set(key, { datasetId: widget.datasetId, params, query, widgetIds: [widget.i] });
  }
  await mapWithConcurrency([...entryMap.values()], DASHBOARD_DATA_CONCURRENCY, async (entry) => {
    let result: ReportWidgetDataResult;
    const startedAt = Date.now();
    try {
      const execution = await getDatasetDataExecution(entry.datasetId, entry.params, entry.query, {
        scene: 'dashboard',
        sourceRefId,
      });
      result = {
        data: execution.data,
        error: null,
        durationMs: execution.durationMs,
        cacheHit: execution.cacheHit,
      };
    } catch (err) {
      result = {
        data: null,
        error: toWidgetDataError(err),
        durationMs: Date.now() - startedAt,
        cacheHit: false,
      };
    }
    for (const widgetId of entry.widgetIds) out[widgetId] = result;
  });
  await mapWithConcurrency([...metricEntryMap.values()], DASHBOARD_DATA_CONCURRENCY, async (entry) => {
    let result: ReportWidgetDataResult;
    const startedAt = Date.now();
    try {
      const metric = await evaluateReportMetric(entry.metricId, entry.params);
      result = buildMetricWidgetDataResult(metric);
    } catch (err) {
      result = {
        data: null,
        error: toWidgetDataError(err),
        durationMs: Date.now() - startedAt,
        cacheHit: false,
      };
    }
    for (const widgetId of entry.widgetIds) out[widgetId] = result;
  });
  return out;
}

export async function getDashboardFilterOptionData(
  filters: ReportFilter[],
  sourceRefId?: string | number | null,
  params?: Record<string, unknown>,
): Promise<Record<string, ReportWidgetDataResult>> {
  const out: Record<string, ReportWidgetDataResult> = {};
  await mapWithConcurrency(
    filters.filter((filter) => (filter.type === 'select' || filter.type === 'multiSelect')
      && filter.optionSource?.kind === 'dataset'
      && filter.optionSource.datasetId),
    DASHBOARD_DATA_CONCURRENCY,
    async (filter) => {
      const source = filter.optionSource!;
      const startedAt = Date.now();
      try {
        const execution = await getDatasetDataExecution(source.datasetId!, params ?? {}, { limit: 500 }, {
          scene: 'dashboard',
          sourceRefId,
        });
        out[filter.id] = {
          data: execution.data,
          error: null,
          durationMs: execution.durationMs,
          cacheHit: execution.cacheHit,
        };
      } catch (err) {
        out[filter.id] = {
          data: null,
          error: toWidgetDataError(err),
          durationMs: Date.now() - startedAt,
          cacheHit: false,
        };
      }
    },
  );
  return out;
}
