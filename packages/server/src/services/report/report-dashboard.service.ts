/**
 * 报表仪表盘 Service
 * - draft = 当前设计草稿
 * - publishedSnapshot = 已发布只读快照（查看/公开/嵌入默认读取）
 */
import { HTTPException } from 'hono/http-exception';
import { and, desc, eq, ilike, inArray, or, sql } from 'drizzle-orm';
import { db } from '../../db';
import { config } from '../../config';
import {
  reportDashboardCategories,
  reportDashboards,
  reportDashboardFavorites,
} from '../../db/schema';
import { pageOffset } from '../../lib/pagination';
import { escapeLike } from '../../lib/where-helpers';
import { formatDateTime, formatNullableDateTime } from '../../lib/datetime';
import { rethrowPgUniqueViolation } from '../../lib/db-errors';
import { currentUserOrNull, hasPermission } from '../../lib/context';
import { mapWithConcurrency } from '../../lib/concurrency';
import { assertDatasetEvaluableGlobally, ensureDatasetExists, getDatasetDataExecution } from './report-dataset.service';
import {
  buildDashboardSnapshot,
} from './report-dashboard-runtime';
import {
  reportCreateTenantId,
  reportScopedWhere,
  reportTenantScope,
} from './report-access';
import type { ReportDashboardRow } from '../../db/schema';
import type {
  CreateReportDashboardInput,
  ReportCanvasItem,
  ReportDashboard,
  ReportDashboardConfig,
  ReportDashboardLifecycleStatus,
  ReportDashboardSnapshot,
  ReportDatasetQueryOptions,
  ReportFilter,
  ReportGridItem,
  ReportLookupOption,
  ReportWidget,
  ReportWidgetDataResult,
  UpdateReportDashboardInput,
} from '@zenith/shared';

type DashboardRowExt = ReportDashboardRow & {
  category?: { name: string } | null;
  publishedByUser?: { nickname: string | null; username: string } | null;
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

async function canPreviewDraft(): Promise<boolean> {
  if (!currentUserOrNull()) return false;
  return hasPermission('report:dashboard:update');
}

export async function resolveDashboardSnapshotForMode(
  row: DashboardRowExt,
  mode: 'auto' | 'draft' | 'published',
  options?: { allowOfflinePublished?: boolean },
): Promise<ReportDashboardSnapshot> {
  if (mode === 'draft') {
    if (!(await canPreviewDraft())) {
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
  if (row.lifecycleStatus === 'draft' && await canPreviewDraft()) return draftSnapshotFromRow(row);
  throw new HTTPException(404, { message: '仪表盘未发布' });
}

export async function ensureDashboardExists(id: number): Promise<ReportDashboardRow> {
  const [row] = await db.select().from(reportDashboards)
    .where(reportScopedWhere(reportDashboards, eq(reportDashboards.id, id)))
    .limit(1);
  if (!row) throw new HTTPException(404, { message: '仪表盘不存在' });
  return row;
}

export async function getDashboard(
  id: number,
  options?: { mode?: 'auto' | 'draft' | 'published'; allowOfflinePublished?: boolean },
): Promise<ReportDashboard> {
  const row = await db.query.reportDashboards.findFirst({
    where: reportScopedWhere(reportDashboards, eq(reportDashboards.id, id)),
    with: {
      category: { columns: { name: true } },
      publishedByUser: { columns: { nickname: true, username: true } },
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
  status?: string;
  lifecycleStatus?: ReportDashboardLifecycleStatus;
  categoryId?: number;
  favorited?: boolean;
}) {
  const {
    page = 1,
    pageSize = 20,
    keyword,
    status,
    lifecycleStatus,
    categoryId,
    favorited,
  } = query;
  const uid = currentUserOrNull()?.userId;
  const conds = [];
  const tenantScope = reportTenantScope(reportDashboards);
  if (tenantScope) conds.push(tenantScope);
  if (keyword) {
    const kw = `%${escapeLike(keyword)}%`;
    conds.push(or(ilike(reportDashboards.name, kw), ilike(reportDashboards.remark, kw)));
  }
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
  const where = conds.length ? and(...conds) : undefined;
  const [total, rows] = await Promise.all([
    db.$count(reportDashboards, where),
    db.query.reportDashboards.findMany({
      where,
      with: {
        category: { columns: { name: true } },
        publishedByUser: { columns: { nickname: true, username: true } },
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
  if (keyword) {
    const kw = `%${escapeLike(keyword)}%`;
    conds.push(or(ilike(reportDashboards.name, kw), ilike(reportDashboards.remark, kw)));
  }
  if (status) conds.push(eq(reportDashboards.status, status));
  if (excludeId) conds.push(sql`${reportDashboards.id} <> ${excludeId}`);
  const where = conds.length ? and(...conds) : undefined;
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

function buildCopyName(baseName: string, existingNames: Set<string>): string {
  const normalized = new Set(Array.from(existingNames).map((name) => name.trim().toLowerCase()));
  const base = baseName.trim() || '未命名副本';
  const direct = `${base} 副本`;
  if (!normalized.has(direct.toLowerCase())) return direct;
  for (let index = 2; index <= 200; index += 1) {
    const candidate = `${base} 副本 ${index}`;
    if (!normalized.has(candidate.toLowerCase())) return candidate;
  }
  return `${base} 副本 ${Date.now()}`;
}

export async function batchSetDashboardStatus(ids: number[], status: 'enabled' | 'disabled'): Promise<number> {
  if (ids.length === 0) return 0;
  const result = await db.update(reportDashboards).set({ status }).where(reportScopedWhere(reportDashboards, inArray(reportDashboards.id, ids))).returning({ id: reportDashboards.id });
  return result.length;
}

export async function cloneDashboard(id: number, input?: { name?: string | null }): Promise<ReportDashboard> {
  const current = await ensureDashboardExists(id);
  const rows = await db.select({ name: reportDashboards.name }).from(reportDashboards).where(reportTenantScope(reportDashboards));
  const name = input?.name?.trim() || buildCopyName(current.name, new Set(rows.map((row) => row.name)));
  const snapshot = draftSnapshotFromRow(current);
  await ensureDashboardReferences(snapshot.widgets, snapshot.filters, snapshot.categoryId ?? null);
  try {
    const [row] = await db.insert(reportDashboards).values({
      tenantId: current.tenantId ?? reportCreateTenantId(),
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
  await ensureDashboardReferences(
    (input.widgets ?? []) as ReportWidget[],
    (input.filters ?? []) as ReportFilter[],
    input.categoryId ?? null,
  );
  try {
    const [row] = await db.insert(reportDashboards).values({
      tenantId: reportCreateTenantId(),
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
  const current = await ensureDashboardExists(id);
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
  );

  try {
    const [row] = await db.update(reportDashboards).set({
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
  await ensureDashboardExists(id);
  await db.delete(reportDashboards).where(eq(reportDashboards.id, id));
}

export async function ensureDashboardReferences(
  widgets: ReportWidget[],
  filters: ReportFilter[],
  categoryId: number | null | undefined,
  dashboardId?: number,
): Promise<void> {
  const datasetIds = new Set<number>();
  const targetDashboardIds = new Set<number>();
  for (const widget of widgets) {
    if (widget.datasetId) datasetIds.add(widget.datasetId);
    const targetId = widget.drilldown?.targetDashboardId;
    if (targetId && targetId !== dashboardId) targetDashboardIds.add(targetId);
  }
  for (const filter of filters) {
    if (filter.optionSource?.kind === 'dataset' && filter.optionSource.datasetId) {
      datasetIds.add(filter.optionSource.datasetId);
    }
  }
  await Promise.all([
    ...[...datasetIds].map((datasetId) => ensureDatasetExists(datasetId)),
    ...[...targetDashboardIds].map((targetId) => ensureDashboardExists(targetId)),
  ]);
  if (categoryId) {
    const [category] = await db.select({ id: reportDashboardCategories.id })
      .from(reportDashboardCategories)
      .where(reportScopedWhere(reportDashboardCategories, eq(reportDashboardCategories.id, categoryId)))
      .limit(1);
    if (!category) throw new HTTPException(404, { message: '仪表盘分类不存在' });
  }
}

export async function assertDashboardEvaluableGlobally(id: number): Promise<void> {
  const dashboard = await ensureDashboardExists(id);
  await assertDashboardSnapshotEvaluableGlobally(draftSnapshotFromRow(dashboard));
}

export async function assertDashboardSnapshotEvaluableGlobally(
  snapshot: ReportDashboardSnapshot,
): Promise<void> {
  const datasetIds = new Set<number>();
  for (const widget of snapshot.widgets ?? []) {
    if (widget.datasetId) datasetIds.add(widget.datasetId);
  }
  for (const filter of snapshot.filters ?? []) {
    if (filter.optionSource?.kind === 'dataset' && filter.optionSource.datasetId) {
      datasetIds.add(filter.optionSource.datasetId);
    }
  }
  await Promise.all([...datasetIds].map((datasetId) => assertDatasetEvaluableGlobally(datasetId)));
}

function computeWidgetParams(widget: ReportWidget, filterValues: Record<string, unknown>): Record<string, unknown> {
  const params: Record<string, unknown> = {};
  for (const binding of widget.paramBindings ?? []) {
    if (binding.filterId && binding.param) params[binding.param] = filterValues[binding.filterId];
  }
  return params;
}

const DASHBOARD_DATA_CONCURRENCY = config.report.dashboardMaxConcurrent;

function toWidgetDataError(err: unknown): { code: number; message: string } {
  if (err instanceof HTTPException) return { code: err.status, message: err.message };
  if (err instanceof Error) return { code: 500, message: err.message };
  return { code: 500, message: String(err) };
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
  for (const widget of widgets ?? []) {
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
