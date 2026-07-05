/**
 * 报表运营 Service —— 分类 / 版本 / 收藏 / 公开分享。
 * 公开分享安全策略：默认 30 天有效期、访问日志审计（含被拒绝的尝试）、公开取数列裁剪（数据最小化）；
 * 接口级限流由内置规则 report_public_share（middleware/rate-limit.ts + 种子数据）按路径 /api/report/public/* 生效。
 */
import { HTTPException } from 'hono/http-exception';
import { and, asc, count, desc, eq, inArray, max } from 'drizzle-orm';
import bcrypt from 'bcryptjs';
import { randomBytes } from 'node:crypto';
import { db } from '../../db';
import {
  reportDashboardCategories, reportDashboardVersions, reportDashboardShares, reportDashboardFavorites, reportDashboards, reportShareAccessLogs,
} from '../../db/schema';
import { formatDateTime, formatNullableDateTime, parseDateTimeInput } from '../../lib/datetime';
import { rethrowPgUniqueViolation } from '../../lib/db-errors';
import { currentUserId, getCtx } from '../../lib/context';
import { getClientIp } from '../../lib/request-helpers';
import logger from '../../lib/logger';
import { ensureDashboardExists, getDashboardData } from './report-dashboard.service';
import type {
  ReportDashboardCategoryRow, ReportDashboardVersionRow, ReportDashboardShareRow,
} from '../../db/schema';
import type {
  ReportDashboardCategory, ReportDashboardVersion, ReportDashboardShare, ReportPublicDashboard,
  ReportDashboardVersionSnapshot, ReportGridItem, ReportCanvasItem, ReportWidget, ReportFilter, ReportDashboardConfig, ReportDataResult,
  CreateReportCategoryInput, UpdateReportCategoryInput, CreateReportShareInput, UpdateReportShareInput,
} from '@zenith/shared';

// ─── 分类 ──────────────────────────────────────────────────────────────────────
export function mapCategory(row: ReportDashboardCategoryRow): ReportDashboardCategory {
  return { id: row.id, name: row.name, sort: row.sort, remark: row.remark ?? null, createdAt: formatDateTime(row.createdAt), updatedAt: formatDateTime(row.updatedAt) };
}
export async function listCategories(): Promise<ReportDashboardCategory[]> {
  const rows = await db.select().from(reportDashboardCategories).orderBy(asc(reportDashboardCategories.sort), asc(reportDashboardCategories.id));
  return rows.map(mapCategory);
}
export async function ensureCategoryExists(id: number): Promise<ReportDashboardCategoryRow> {
  const [row] = await db.select().from(reportDashboardCategories).where(eq(reportDashboardCategories.id, id)).limit(1);
  if (!row) throw new HTTPException(404, { message: '分类不存在' });
  return row;
}
export async function createCategory(input: CreateReportCategoryInput): Promise<ReportDashboardCategory> {
  try {
    const [row] = await db.insert(reportDashboardCategories).values({ name: input.name, sort: input.sort ?? 0, remark: input.remark }).returning();
    return mapCategory(row);
  } catch (err) { rethrowPgUniqueViolation(err, '分类名称已存在'); throw err; }
}
export async function updateCategory(id: number, input: UpdateReportCategoryInput): Promise<ReportDashboardCategory> {
  try {
    const [row] = await db.update(reportDashboardCategories).set({ name: input.name, sort: input.sort, remark: input.remark }).where(eq(reportDashboardCategories.id, id)).returning();
    if (!row) throw new HTTPException(404, { message: '分类不存在' });
    return mapCategory(row);
  } catch (err) { rethrowPgUniqueViolation(err, '分类名称已存在'); throw err; }
}
export async function deleteCategory(id: number): Promise<void> {
  await ensureCategoryExists(id);
  await db.delete(reportDashboardCategories).where(eq(reportDashboardCategories.id, id));
}

// ─── 版本 ──────────────────────────────────────────────────────────────────────
export function mapVersion(row: ReportDashboardVersionRow): ReportDashboardVersion {
  return {
    id: row.id, dashboardId: row.dashboardId, version: row.version,
    snapshot: (row.snapshot ?? {}) as ReportDashboardVersionSnapshot,
    remark: row.remark ?? null, createdBy: row.createdBy ?? null, createdAt: formatDateTime(row.createdAt),
  };
}
export async function listVersions(dashboardId: number): Promise<ReportDashboardVersion[]> {
  const rows = await db.select().from(reportDashboardVersions).where(eq(reportDashboardVersions.dashboardId, dashboardId)).orderBy(desc(reportDashboardVersions.version));
  return rows.map(mapVersion);
}
export async function createVersion(dashboardId: number, remark?: string): Promise<ReportDashboardVersion> {
  const dash = await ensureDashboardExists(dashboardId);
  const [last] = await db.select({ v: reportDashboardVersions.version }).from(reportDashboardVersions).where(eq(reportDashboardVersions.dashboardId, dashboardId)).orderBy(desc(reportDashboardVersions.version)).limit(1);
  const version = (last?.v ?? 0) + 1;
  const snapshot: ReportDashboardVersionSnapshot = {
    layout: (dash.layout ?? []) as ReportGridItem[], canvasLayout: (dash.canvasLayout ?? []) as ReportCanvasItem[],
    widgets: (dash.widgets ?? []) as ReportWidget[],
    filters: (dash.filters ?? []) as ReportFilter[], config: (dash.config ?? {}) as ReportDashboardConfig,
  };
  const [row] = await db.insert(reportDashboardVersions).values({ dashboardId, version, snapshot, remark }).returning();
  return mapVersion(row);
}
export async function restoreVersion(dashboardId: number, versionId: number): Promise<void> {
  const [ver] = await db.select().from(reportDashboardVersions).where(and(eq(reportDashboardVersions.id, versionId), eq(reportDashboardVersions.dashboardId, dashboardId))).limit(1);
  if (!ver) throw new HTTPException(404, { message: '版本不存在' });
  const s = (ver.snapshot ?? {}) as ReportDashboardVersionSnapshot;
  await db.update(reportDashboards).set({ layout: s.layout ?? [], canvasLayout: s.canvasLayout ?? [], widgets: s.widgets ?? [], filters: s.filters ?? [], config: s.config ?? {} }).where(eq(reportDashboards.id, dashboardId));
}

// ─── 收藏 ──────────────────────────────────────────────────────────────────────
export async function toggleFavorite(dashboardId: number): Promise<{ favorited: boolean }> {
  await ensureDashboardExists(dashboardId);
  const uid = currentUserId();
  const existing = await db.$count(reportDashboardFavorites, and(eq(reportDashboardFavorites.userId, uid), eq(reportDashboardFavorites.dashboardId, dashboardId)));
  if (existing > 0) {
    await db.delete(reportDashboardFavorites).where(and(eq(reportDashboardFavorites.userId, uid), eq(reportDashboardFavorites.dashboardId, dashboardId)));
    return { favorited: false };
  }
  await db.insert(reportDashboardFavorites).values({ userId: uid, dashboardId }).onConflictDoNothing();
  return { favorited: true };
}

// ─── 公开分享 ────────────────────────────────────────────────────────────────────

/** 未显式指定过期时间时的默认有效期（天）：公开链接不默认永久有效 */
const DEFAULT_SHARE_TTL_DAYS = 30;

export function mapShare(row: ReportDashboardShareRow, stats?: { accessCount: number; lastAccessAt: Date | null }): ReportDashboardShare {
  return {
    id: row.id, dashboardId: row.dashboardId, token: row.token, enabled: row.enabled,
    hasPassword: !!row.passwordHash, expireAt: formatNullableDateTime(row.expireAt),
    accessCount: stats?.accessCount ?? 0, lastAccessAt: formatNullableDateTime(stats?.lastAccessAt ?? null),
    createdBy: row.createdBy ?? null, createdAt: formatDateTime(row.createdAt), updatedAt: formatDateTime(row.updatedAt),
  };
}
export async function listShares(dashboardId: number): Promise<ReportDashboardShare[]> {
  const rows = await db.select().from(reportDashboardShares).where(eq(reportDashboardShares.dashboardId, dashboardId)).orderBy(desc(reportDashboardShares.id));
  if (rows.length === 0) return [];
  const stats = await db.select({
    shareId: reportShareAccessLogs.shareId,
    accessCount: count(),
    lastAccessAt: max(reportShareAccessLogs.createdAt),
  }).from(reportShareAccessLogs)
    .where(inArray(reportShareAccessLogs.shareId, rows.map((r) => r.id)))
    .groupBy(reportShareAccessLogs.shareId);
  const statMap = new Map(stats.map((s) => [s.shareId, { accessCount: s.accessCount, lastAccessAt: s.lastAccessAt }]));
  return rows.map((r) => mapShare(r, statMap.get(r.id)));
}
export async function createShare(dashboardId: number, input: CreateReportShareInput): Promise<ReportDashboardShare> {
  await ensureDashboardExists(dashboardId);
  const token = randomBytes(16).toString('hex');
  const passwordHash = input.password ? await bcrypt.hash(input.password, 10) : null;
  // 未传 expireAt = 默认 30 天；显式 null = 永久（由创建者主动选择）
  const expireAt = input.expireAt === undefined
    ? new Date(Date.now() + DEFAULT_SHARE_TTL_DAYS * 24 * 60 * 60 * 1000)
    : (input.expireAt ? parseDateTimeInput(input.expireAt) : null);
  const [row] = await db.insert(reportDashboardShares).values({ dashboardId, token, passwordHash, expireAt, enabled: input.enabled ?? true }).returning();
  return mapShare(row);
}
export async function ensureShareExists(id: number): Promise<ReportDashboardShareRow> {
  const [row] = await db.select().from(reportDashboardShares).where(eq(reportDashboardShares.id, id)).limit(1);
  if (!row) throw new HTTPException(404, { message: '分享链接不存在' });
  return row;
}
export async function updateShare(id: number, input: UpdateReportShareInput): Promise<ReportDashboardShare> {
  const passwordHash = input.password === undefined ? undefined : (input.password ? await bcrypt.hash(input.password, 10) : null);
  const expireAt = input.expireAt === undefined ? undefined : (input.expireAt ? parseDateTimeInput(input.expireAt) : null);
  const [row] = await db.update(reportDashboardShares).set({ enabled: input.enabled, passwordHash, expireAt }).where(eq(reportDashboardShares.id, id)).returning();
  if (!row) throw new HTTPException(404, { message: '分享链接不存在' });
  return mapShare(row);
}
export async function deleteShare(id: number): Promise<void> {
  await ensureShareExists(id);
  await db.delete(reportDashboardShares).where(eq(reportDashboardShares.id, id));
}

/** 记录公开访问日志（fire-and-forget，失败不阻断访问） */
function logShareAccess(share: Pick<ReportDashboardShareRow, 'id' | 'dashboardId'>, action: 'view' | 'data', ok: boolean): void {
  let clientIp: string | null = null;
  try { clientIp = getClientIp(getCtx()); } catch { /* 无请求上下文（理论上不会发生） */ }
  void db.insert(reportShareAccessLogs)
    .values({ shareId: share.id, dashboardId: share.dashboardId, action, clientIp, ok })
    .catch((err) => logger.warn('公开分享访问日志写入失败', { shareId: share.id, err: err instanceof Error ? err.message : String(err) }));
}

async function resolveShare(token: string, password: string | undefined, action: 'view' | 'data'): Promise<ReportDashboardShareRow> {
  const [share] = await db.select().from(reportDashboardShares).where(eq(reportDashboardShares.token, token)).limit(1);
  if (!share || !share.enabled) throw new HTTPException(404, { message: '链接不存在或已停用' });
  if (share.expireAt && new Date(share.expireAt).getTime() < Date.now()) {
    logShareAccess(share, action, false);
    throw new HTTPException(403, { message: '链接已过期' });
  }
  if (share.passwordHash) {
    if (!password || !(await bcrypt.compare(password, share.passwordHash))) {
      logShareAccess(share, action, false);
      throw new HTTPException(401, { message: '访问密码错误' });
    }
  }
  logShareAccess(share, action, true);
  return share;
}

/** 公开渲染：返回精简仪表盘（无敏感字段）*/
export async function resolvePublicDashboard(token: string, password?: string): Promise<ReportPublicDashboard> {
  const share = await resolveShare(token, password, 'view');
  const dash = await ensureDashboardExists(share.dashboardId);
  return {
    name: dash.name,
    layout: (dash.layout ?? []) as ReportGridItem[],
    canvasLayout: (dash.canvasLayout ?? []) as ReportCanvasItem[],
    widgets: (dash.widgets ?? []) as ReportWidget[],
    filters: (dash.filters ?? []) as ReportFilter[],
    config: (dash.config ?? {}) as ReportDashboardConfig,
  };
}

/** 深度遍历配置对象，收集所有字符串值（组件对字段的引用都是字符串/字符串数组） */
function collectConfigStrings(value: unknown, into: Set<string>): void {
  if (typeof value === 'string') {
    if (value) into.add(value);
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectConfigStrings(item, into);
    return;
  }
  if (value && typeof value === 'object') {
    for (const item of Object.values(value)) collectConfigStrings(item, into);
  }
}

/**
 * 公开取数数据最小化：每个组件仅保留其配置实际引用的列，未被任何配置引用的敏感列不出公网。
 * table/pivot 未显式配置列（= 全列展示）时不裁剪，避免破坏公开页渲染。
 */
function minimizePublicData(widgets: ReportWidget[], data: Record<string, ReportDataResult>): Record<string, ReportDataResult> {
  const widgetById = new Map(widgets.map((w) => [w.i, w]));
  const out: Record<string, ReportDataResult> = {};
  for (const [widgetId, result] of Object.entries(data)) {
    const widget = widgetById.get(widgetId);
    if (!widget) { out[widgetId] = result; continue; }
    if (widget.type === 'table' || widget.type === 'pivot') {
      const columns = (widget.options as { columns?: unknown[] } | undefined)?.columns;
      if (!Array.isArray(columns) || columns.length === 0) { out[widgetId] = result; continue; }
    }
    const referenced = new Set<string>();
    collectConfigStrings(widget.options, referenced);
    collectConfigStrings(widget.drilldown, referenced);
    const keep = result.columns.filter((c) => referenced.has(c));
    if (keep.length === 0 || keep.length === result.columns.length) { out[widgetId] = result; continue; }
    const keepSet = new Set(keep);
    out[widgetId] = {
      columns: keep,
      rows: result.rows.map((row) => Object.fromEntries(Object.entries(row).filter(([k]) => keepSet.has(k)))),
      total: result.total,
    };
  }
  return out;
}

/** 公开取数：按 token 验证后解析整个仪表盘数据（列裁剪最小化输出） */
export async function resolvePublicData(token: string, password: string | undefined, filterValues: Record<string, unknown>): Promise<Record<string, ReportDataResult>> {
  const share = await resolveShare(token, password, 'data');
  const dash = await ensureDashboardExists(share.dashboardId);
  const widgets = (dash.widgets ?? []) as ReportWidget[];
  const data = await getDashboardData(widgets, filterValues ?? {});
  return minimizePublicData(widgets, data);
}
