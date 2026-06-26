/**
 * 报表运营 Service —— 分类 / 版本 / 收藏 / 公开分享。
 */
import { HTTPException } from 'hono/http-exception';
import { and, asc, desc, eq } from 'drizzle-orm';
import bcrypt from 'bcryptjs';
import { randomBytes } from 'node:crypto';
import { db } from '../db';
import {
  reportDashboardCategories, reportDashboardVersions, reportDashboardShares, reportDashboardFavorites, reportDashboards,
} from '../db/schema';
import { formatDateTime, formatNullableDateTime, parseDateTimeInput } from '../lib/datetime';
import { rethrowPgUniqueViolation } from '../lib/db-errors';
import { currentUserId } from '../lib/context';
import { ensureDashboardExists, getDashboardData } from './report-dashboard.service';
import type {
  ReportDashboardCategoryRow, ReportDashboardVersionRow, ReportDashboardShareRow,
} from '../db/schema';
import type {
  ReportDashboardCategory, ReportDashboardVersion, ReportDashboardShare, ReportPublicDashboard,
  ReportDashboardVersionSnapshot, ReportGridItem, ReportWidget, ReportFilter, ReportDashboardConfig, ReportDataResult,
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
    layout: (dash.layout ?? []) as ReportGridItem[], widgets: (dash.widgets ?? []) as ReportWidget[],
    filters: (dash.filters ?? []) as ReportFilter[], config: (dash.config ?? {}) as ReportDashboardConfig,
  };
  const [row] = await db.insert(reportDashboardVersions).values({ dashboardId, version, snapshot, remark }).returning();
  return mapVersion(row);
}
export async function restoreVersion(dashboardId: number, versionId: number): Promise<void> {
  const [ver] = await db.select().from(reportDashboardVersions).where(and(eq(reportDashboardVersions.id, versionId), eq(reportDashboardVersions.dashboardId, dashboardId))).limit(1);
  if (!ver) throw new HTTPException(404, { message: '版本不存在' });
  const s = (ver.snapshot ?? {}) as ReportDashboardVersionSnapshot;
  await db.update(reportDashboards).set({ layout: s.layout ?? [], widgets: s.widgets ?? [], filters: s.filters ?? [], config: s.config ?? {} }).where(eq(reportDashboards.id, dashboardId));
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
export function mapShare(row: ReportDashboardShareRow): ReportDashboardShare {
  return {
    id: row.id, dashboardId: row.dashboardId, token: row.token, enabled: row.enabled,
    hasPassword: !!row.passwordHash, expireAt: formatNullableDateTime(row.expireAt),
    createdBy: row.createdBy ?? null, createdAt: formatDateTime(row.createdAt), updatedAt: formatDateTime(row.updatedAt),
  };
}
export async function listShares(dashboardId: number): Promise<ReportDashboardShare[]> {
  const rows = await db.select().from(reportDashboardShares).where(eq(reportDashboardShares.dashboardId, dashboardId)).orderBy(desc(reportDashboardShares.id));
  return rows.map(mapShare);
}
export async function createShare(dashboardId: number, input: CreateReportShareInput): Promise<ReportDashboardShare> {
  await ensureDashboardExists(dashboardId);
  const token = randomBytes(16).toString('hex');
  const passwordHash = input.password ? await bcrypt.hash(input.password, 10) : null;
  const expireAt = input.expireAt ? parseDateTimeInput(input.expireAt) : null;
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

async function resolveShare(token: string, password?: string): Promise<ReportDashboardShareRow> {
  const [share] = await db.select().from(reportDashboardShares).where(eq(reportDashboardShares.token, token)).limit(1);
  if (!share || !share.enabled) throw new HTTPException(404, { message: '链接不存在或已停用' });
  if (share.expireAt && new Date(share.expireAt).getTime() < Date.now()) throw new HTTPException(403, { message: '链接已过期' });
  if (share.passwordHash) {
    if (!password || !(await bcrypt.compare(password, share.passwordHash))) {
      throw new HTTPException(401, { message: '访问密码错误' });
    }
  }
  return share;
}

/** 公开渲染：返回精简仪表盘（无敏感字段）*/
export async function resolvePublicDashboard(token: string, password?: string): Promise<ReportPublicDashboard> {
  const share = await resolveShare(token, password);
  const dash = await ensureDashboardExists(share.dashboardId);
  return {
    name: dash.name,
    layout: (dash.layout ?? []) as ReportGridItem[],
    widgets: (dash.widgets ?? []) as ReportWidget[],
    filters: (dash.filters ?? []) as ReportFilter[],
    config: (dash.config ?? {}) as ReportDashboardConfig,
  };
}

/** 公开取数：按 token 验证后解析整个仪表盘数据 */
export async function resolvePublicData(token: string, password: string | undefined, filterValues: Record<string, unknown>): Promise<Record<string, ReportDataResult>> {
  const share = await resolveShare(token, password);
  const dash = await ensureDashboardExists(share.dashboardId);
  return getDashboardData((dash.widgets ?? []) as ReportWidget[], filterValues ?? {});
}
