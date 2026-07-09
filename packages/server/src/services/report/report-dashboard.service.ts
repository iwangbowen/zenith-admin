/**
 * 报表仪表盘 Service
 * CRUD —— 布局（react-grid-layout）与组件配置以 jsonb 存储。
 */
import { HTTPException } from 'hono/http-exception';
import { and, desc, eq, ilike, inArray, or } from 'drizzle-orm';
import { db } from '../../db';
import { reportDashboardCategories, reportDashboards, reportDashboardFavorites } from '../../db/schema';
import { pageOffset } from '../../lib/pagination';
import { escapeLike } from '../../lib/where-helpers';
import { formatDateTime } from '../../lib/datetime';
import { rethrowPgUniqueViolation } from '../../lib/db-errors';
import { currentUserOrNull } from '../../lib/context';
import { mapWithConcurrency } from '../../lib/concurrency';
import { assertDatasetEvaluableGlobally, ensureDatasetExists, getDatasetData } from './report-dataset.service';
import {
  reportCreateTenantId,
  reportScopedWhere,
  reportTenantScope,
} from './report-access';
import type { ReportDashboardRow } from '../../db/schema';
import type {
  ReportDashboard, ReportGridItem, ReportWidget, ReportFilter, ReportDashboardConfig, ReportDataResult,
  ReportCanvasItem, CreateReportDashboardInput, UpdateReportDashboardInput,
} from '@zenith/shared';

type DashboardRowExt = ReportDashboardRow & { category?: { name: string } | null };

export function mapDashboard(row: DashboardRowExt, favorited?: boolean): ReportDashboard {
  return {
    id: row.id,
    name: row.name,
    layout: (row.layout ?? []) as ReportGridItem[],
    canvasLayout: (row.canvasLayout ?? []) as ReportCanvasItem[],
    widgets: (row.widgets ?? []) as ReportWidget[],
    filters: (row.filters ?? []) as ReportFilter[],
    config: (row.config ?? {}) as ReportDashboardConfig,
    categoryId: row.categoryId ?? null,
    categoryName: row.category?.name ?? null,
    favorited,
    status: row.status,
    remark: row.remark ?? null,
    createdBy: row.createdBy ?? null,
    updatedBy: row.updatedBy ?? null,
    createdAt: formatDateTime(row.createdAt),
    updatedAt: formatDateTime(row.updatedAt),
  };
}

export async function ensureDashboardExists(id: number): Promise<ReportDashboardRow> {
  const [row] = await db.select().from(reportDashboards)
    .where(reportScopedWhere(reportDashboards, eq(reportDashboards.id, id)))
    .limit(1);
  if (!row) throw new HTTPException(404, { message: '仪表盘不存在' });
  return row;
}

export async function getDashboard(id: number): Promise<ReportDashboard> {
  const row = await db.query.reportDashboards.findFirst({
    where: reportScopedWhere(reportDashboards, eq(reportDashboards.id, id)),
    with: { category: { columns: { name: true } } },
  });
  if (!row) throw new HTTPException(404, { message: '仪表盘不存在' });
  const uid = currentUserOrNull()?.userId;
  let favorited: boolean | undefined;
  if (uid) {
    favorited = (await db.$count(reportDashboardFavorites, and(eq(reportDashboardFavorites.userId, uid), eq(reportDashboardFavorites.dashboardId, id)))) > 0;
  }
  return mapDashboard(row, favorited);
}

export async function listDashboards(query: {
  page?: number; pageSize?: number; keyword?: string; status?: string; categoryId?: number; favorited?: boolean;
}) {
  const { page = 1, pageSize = 20, keyword, status, categoryId, favorited } = query;
  const uid = currentUserOrNull()?.userId;
  const conds = [];
  const tenantScope = reportTenantScope(reportDashboards);
  if (tenantScope) conds.push(tenantScope);
  if (keyword) {
    const kw = `%${escapeLike(keyword)}%`;
    conds.push(or(ilike(reportDashboards.name, kw), ilike(reportDashboards.remark, kw)));
  }
  if (status === 'enabled' || status === 'disabled') conds.push(eq(reportDashboards.status, status));
  if (categoryId) conds.push(eq(reportDashboards.categoryId, categoryId));
  if (favorited && uid) {
    const favRows = await db.select({ id: reportDashboardFavorites.dashboardId }).from(reportDashboardFavorites).where(eq(reportDashboardFavorites.userId, uid));
    const ids = favRows.map((r) => r.id);
    if (ids.length === 0) return { list: [], total: 0, page, pageSize };
    conds.push(inArray(reportDashboards.id, ids));
  }
  const where = conds.length ? and(...conds) : undefined;
  const [total, rows] = await Promise.all([
    db.$count(reportDashboards, where),
    db.query.reportDashboards.findMany({
      where,
      with: { category: { columns: { name: true } } },
      orderBy: desc(reportDashboards.id),
      limit: pageSize,
      offset: pageOffset(page, pageSize),
    }),
  ]);
  let favSet = new Set<number>();
  if (uid && rows.length) {
    const favRows = await db.select({ id: reportDashboardFavorites.dashboardId }).from(reportDashboardFavorites)
      .where(and(eq(reportDashboardFavorites.userId, uid), inArray(reportDashboardFavorites.dashboardId, rows.map((r) => r.id))));
    favSet = new Set(favRows.map((r) => r.id));
  }
  return { list: rows.map((r) => mapDashboard(r, uid ? favSet.has(r.id) : undefined)), total, page, pageSize };
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
      remark: input.remark,
    }).returning();
    return mapDashboard(row);
  } catch (err) {
    rethrowPgUniqueViolation(err, '仪表盘名称已存在');
    throw err;
  }
}

export async function updateDashboard(id: number, input: UpdateReportDashboardInput): Promise<ReportDashboard> {
  const current = await ensureDashboardExists(id);
  await ensureDashboardReferences(
    (input.widgets ?? current.widgets ?? []) as ReportWidget[],
    (input.filters ?? current.filters ?? []) as ReportFilter[],
    input.categoryId === undefined ? current.categoryId : input.categoryId,
    id,
  );
  try {
    const [row] = await db.update(reportDashboards).set({
      name: input.name,
      layout: input.layout as ReportGridItem[] | undefined,
      canvasLayout: input.canvasLayout as ReportCanvasItem[] | undefined,
      widgets: input.widgets as ReportWidget[] | undefined,
      filters: input.filters as ReportFilter[] | undefined,
      config: input.config as ReportDashboardConfig | undefined,
      categoryId: input.categoryId,
      status: input.status,
      remark: input.remark,
    }).where(eq(reportDashboards.id, id)).returning();
    if (!row) throw new HTTPException(404, { message: '仪表盘不存在' });
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
    ...[...datasetIds].map((id) => ensureDatasetExists(id)),
    ...[...targetDashboardIds].map((id) => ensureDashboardExists(id)),
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
  const datasetIds = new Set<number>();
  for (const widget of (dashboard.widgets ?? []) as ReportWidget[]) {
    if (widget.datasetId) datasetIds.add(widget.datasetId);
  }
  for (const filter of (dashboard.filters ?? []) as ReportFilter[]) {
    if (filter.optionSource?.kind === 'dataset' && filter.optionSource.datasetId) {
      datasetIds.add(filter.optionSource.datasetId);
    }
  }
  await Promise.all([...datasetIds].map((datasetId) => assertDatasetEvaluableGlobally(datasetId)));
}

// ─── 批量取数（按全局筛选器值解析每个组件的参数）────────────────────────────────
function computeWidgetParams(widget: ReportWidget, filterValues: Record<string, unknown>): Record<string, unknown> {
  const params: Record<string, unknown> = {};
  for (const b of widget.paramBindings ?? []) {
    if (b.filterId && b.param) params[b.param] = filterValues[b.filterId];
  }
  return params;
}

/** 单次仪表盘批量取数的最大并发子查询数（防大盘扇出打爆连接池/外部库） */
const DASHBOARD_DATA_CONCURRENCY = 5;

/** 解析整个仪表盘的数据：返回 { [widgetId]: ReportDataResult }，相同(dataset+params)只取一次，取数并发受限 */
export async function getDashboardData(
  widgets: ReportWidget[],
  filterValues: Record<string, unknown>,
  limit?: number,
): Promise<Record<string, ReportDataResult>> {
  const out: Record<string, ReportDataResult> = {};
  const entryMap = new Map<string, { datasetId: number; params: Record<string, unknown>; widgetIds: string[] }>();
  for (const w of widgets ?? []) {
    if (!w.datasetId) continue;
    const params = computeWidgetParams(w, filterValues);
    const key = `${w.datasetId}:${JSON.stringify(params)}:${limit ?? ''}`;
    const entry = entryMap.get(key);
    if (entry) entry.widgetIds.push(w.i);
    else entryMap.set(key, { datasetId: w.datasetId, params, widgetIds: [w.i] });
  }
  await mapWithConcurrency([...entryMap.values()], DASHBOARD_DATA_CONCURRENCY, async (entry) => {
    let result: ReportDataResult;
    try {
      result = await getDatasetData(entry.datasetId, entry.params, limit);
    } catch {
      result = { columns: [], rows: [], total: 0 };
    }
    for (const id of entry.widgetIds) out[id] = result;
  });
  return out;
}
