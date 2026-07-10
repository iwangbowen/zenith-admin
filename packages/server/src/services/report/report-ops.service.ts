/**
 * 报表运营 Service —— 分类 / 生命周期版本 / 收藏 / 公开分享 / 嵌入令牌。
 */
import { HTTPException } from 'hono/http-exception';
import { and, asc, count, desc, eq, inArray, ilike, lt, max, or, sql } from 'drizzle-orm';
import bcrypt from 'bcryptjs';
import { createHash, randomBytes } from 'node:crypto';
import { db } from '../../db';
import type { DbExecutor } from '../../db/types';
import {
  reportDashboardCategories,
  reportDashboardEmbedTokens,
  reportDashboardFavorites,
  reportDashboardShares,
  reportDashboardVersions,
  reportDashboards,
  reportShareAccessLogs,
} from '../../db/schema';
import { formatDateTime, formatNullableDateTime, parseDateTimeInput } from '../../lib/datetime';
import { rethrowPgUniqueViolation } from '../../lib/db-errors';
import { currentUserId, getCtx } from '../../lib/context';
import { getClientIp } from '../../lib/request-helpers';
import logger from '../../lib/logger';
import { encryptField } from '../../lib/encryption';
import { config } from '../../config';
import redis from '../../lib/redis';
import {
  applyEmbedFilterScope,
  buildDashboardSnapshot,
  compareDashboardSnapshots,
  ensureAccessAllowedByIp,
  sanitizePublicFilterOptions,
} from './report-dashboard-runtime';
import {
  assertDashboardSnapshotEvaluableGlobally,
  DashboardRevisionConflictError,
  ensureDashboardExists,
  ensureDashboardReferences,
  getDashboardData,
  getDashboardFilterOptionData,
  mapDashboard,
} from './report-dashboard.service';
import { reportCreateTenantId, reportScopedWhere, reportTenantScope } from './report-access';
import type {
  ReportDashboardCategoryRow,
  ReportDashboardEmbedTokenRow,
  ReportDashboardShareRow,
  ReportDashboardVersionRow,
  ReportDashboardRow,
} from '../../db/schema';
import type {
  CreateReportCategoryInput,
  CreateReportEmbedTokenInput,
  CreateReportShareInput,
  CreateReportVersionInput,
  ReportDashboard,
  ReportDashboardCategory,
  ReportDashboardConfig,
  ReportDashboardEmbedToken,
  ReportDashboardLifecycleActionInput,
  ReportDashboardShare,
  ReportDashboardSnapshot,
  ReportDashboardVersion,
  ReportDashboardVersionDiff,
  ReportDashboardVersionSource,
  ReportFilter,
  ReportGridItem,
  ReportPublicAccessSession,
  ReportPublicDashboard,
  ReportWidget,
  ReportWidgetDataResult,
  ReportDatasetQueryOptions,
  UpdateReportCategoryInput,
  ReportLookupOption,
  UpdateReportShareInput,
} from '@zenith/shared';
import type { ReportWidgetOptions } from '@zenith/shared';
import { resolveReportSecret } from './report-secrets';

const DEFAULT_SHARE_TTL_DAYS = 30;
const SHARE_SESSION_TTL_SECONDS = 15 * 60;
const SHARE_SESSION_PREFIX = `${config.redis.keyPrefix}report:share-session:`;

type ShareSessionPayload = {
  shareId: number;
  dashboardId: number;
  shareSessionVersion: number;
  clientIp: string;
  createdAt: string;
  expiresAt: string;
};

// ─── 分类 ──────────────────────────────────────────────────────────────────────
export function mapCategory(row: ReportDashboardCategoryRow): ReportDashboardCategory {
  return {
    id: row.id,
    name: row.name,
    sort: row.sort,
    remark: row.remark ?? null,
    createdAt: formatDateTime(row.createdAt),
    updatedAt: formatDateTime(row.updatedAt),
  };
}

export async function listCategories(): Promise<ReportDashboardCategory[]> {
  const rows = await db.select({
    id: reportDashboardCategories.id,
    name: reportDashboardCategories.name,
    sort: reportDashboardCategories.sort,
    remark: reportDashboardCategories.remark,
    createdAt: reportDashboardCategories.createdAt,
    updatedAt: reportDashboardCategories.updatedAt,
    dashboardCount: sql<number>`count(${reportDashboards.id})::int`,
  }).from(reportDashboardCategories)
    .leftJoin(reportDashboards, eq(reportDashboards.categoryId, reportDashboardCategories.id))
    .where(reportTenantScope(reportDashboardCategories))
    .groupBy(
      reportDashboardCategories.id,
      reportDashboardCategories.name,
      reportDashboardCategories.sort,
      reportDashboardCategories.remark,
      reportDashboardCategories.createdAt,
      reportDashboardCategories.updatedAt,
    )
    .orderBy(asc(reportDashboardCategories.sort), asc(reportDashboardCategories.id));
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    sort: row.sort,
    remark: row.remark ?? null,
    dashboardCount: Number(row.dashboardCount ?? 0),
    createdAt: formatDateTime(row.createdAt),
    updatedAt: formatDateTime(row.updatedAt),
  }));
}

export async function listCategoryLookup(query: { keyword?: string; limit?: number }): Promise<ReportLookupOption[]> {
  const conds = [];
  const tenantScope = reportTenantScope(reportDashboardCategories);
  if (tenantScope) conds.push(tenantScope);
  if (query.keyword) {
    const kw = `%${query.keyword.trim().replace(/[%_]/g, '\\$&')}%`;
    conds.push(or(ilike(reportDashboardCategories.name, kw), ilike(reportDashboardCategories.remark, kw)));
  }
  const where = conds.length ? and(...conds) : undefined;
  const rows = await db.select({
    id: reportDashboardCategories.id,
    name: reportDashboardCategories.name,
    dashboardCount: sql<number>`count(${reportDashboards.id})::int`,
  }).from(reportDashboardCategories)
    .leftJoin(reportDashboards, eq(reportDashboards.categoryId, reportDashboardCategories.id))
    .where(where)
    .groupBy(reportDashboardCategories.id, reportDashboardCategories.name)
    .orderBy(asc(reportDashboardCategories.sort), asc(reportDashboardCategories.id))
    .limit(Math.min(Math.max(query.limit ?? 20, 1), 50));
  return rows.map((row) => ({ id: row.id, name: row.name, dashboardCount: Number(row.dashboardCount ?? 0) }));
}

export async function getCategoryDashboardRefCount(id: number): Promise<number> {
  return db.$count(reportDashboards, reportScopedWhere(reportDashboards, eq(reportDashboards.categoryId, id)));
}

export async function ensureCategoryExists(id: number): Promise<ReportDashboardCategoryRow> {
  const [row] = await db.select().from(reportDashboardCategories)
    .where(reportScopedWhere(reportDashboardCategories, eq(reportDashboardCategories.id, id)))
    .limit(1);
  if (!row) throw new HTTPException(404, { message: '分类不存在' });
  return row;
}

export async function createCategory(input: CreateReportCategoryInput): Promise<ReportDashboardCategory> {
  try {
    const [row] = await db.insert(reportDashboardCategories).values({
      tenantId: reportCreateTenantId(),
      name: input.name,
      sort: input.sort ?? 0,
      remark: input.remark,
    }).returning();
    return mapCategory(row);
  } catch (err) {
    rethrowPgUniqueViolation(err, '分类名称已存在');
    throw err;
  }
}

export async function updateCategory(id: number, input: UpdateReportCategoryInput): Promise<ReportDashboardCategory> {
  await ensureCategoryExists(id);
  try {
    const [row] = await db.update(reportDashboardCategories).set({
      name: input.name,
      sort: input.sort,
      remark: input.remark,
    }).where(eq(reportDashboardCategories.id, id)).returning();
    if (!row) throw new HTTPException(404, { message: '分类不存在' });
    return mapCategory(row);
  } catch (err) {
    rethrowPgUniqueViolation(err, '分类名称已存在');
    throw err;
  }
}

export async function deleteCategory(id: number): Promise<void> {
  await ensureCategoryExists(id);
  await db.delete(reportDashboardCategories).where(eq(reportDashboardCategories.id, id));
}

// ─── 版本 / 生命周期 ───────────────────────────────────────────────────────────

function draftSnapshotFromDashboard(row: ReportDashboardRow): ReportDashboardSnapshot {
  return buildDashboardSnapshot({
    name: row.name,
    layout: (row.layout ?? []) as ReportGridItem[],
    canvasLayout: (row.canvasLayout ?? []) as ReportDashboardSnapshot['canvasLayout'],
    widgets: (row.widgets ?? []) as ReportWidget[],
    filters: (row.filters ?? []) as ReportFilter[],
    config: (row.config ?? {}) as ReportDashboardConfig,
    categoryId: row.categoryId ?? null,
    remark: row.remark ?? null,
  });
}

export function mapVersion(row: ReportDashboardVersionRow): ReportDashboardVersion {
  return {
    id: row.id,
    dashboardId: row.dashboardId,
    version: row.version,
    snapshot: (row.snapshot ?? {}) as ReportDashboardSnapshot,
    source: row.source,
    remark: row.remark ?? null,
    createdBy: row.createdBy ?? null,
    createdAt: formatDateTime(row.createdAt),
  };
}

async function getNextVersion(executor: DbExecutor, dashboardId: number): Promise<number> {
  const [last] = await executor.select({ v: reportDashboardVersions.version })
    .from(reportDashboardVersions)
    .where(eq(reportDashboardVersions.dashboardId, dashboardId))
    .orderBy(desc(reportDashboardVersions.version))
    .limit(1);
  return (last?.v ?? 0) + 1;
}

async function createVersionFromSnapshot(
  executor: DbExecutor,
  dashboardId: number,
  snapshot: ReportDashboardSnapshot,
  source: ReportDashboardVersionSource,
  remark?: string | null,
): Promise<ReportDashboardVersion> {
  const version = await getNextVersion(executor, dashboardId);
  const [row] = await executor.insert(reportDashboardVersions).values({
    dashboardId,
    version,
    snapshot,
    source,
    remark: remark ?? null,
  }).returning();
  return mapVersion(row);
}

export async function listVersions(dashboardId: number): Promise<ReportDashboardVersion[]> {
  await ensureDashboardExists(dashboardId);
  const rows = await db.select().from(reportDashboardVersions)
    .where(eq(reportDashboardVersions.dashboardId, dashboardId))
    .orderBy(desc(reportDashboardVersions.version));
  return rows.map(mapVersion);
}

export async function createVersion(dashboardId: number, input?: CreateReportVersionInput): Promise<ReportDashboardVersion> {
  await ensureDashboardExists(dashboardId);
  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT ${reportDashboards.id} FROM ${reportDashboards} WHERE ${reportDashboards.id} = ${dashboardId} FOR UPDATE`);
    const [locked] = await tx.select().from(reportDashboards)
      .where(eq(reportDashboards.id, dashboardId))
      .limit(1);
    if (!locked) throw new HTTPException(404, { message: '仪表盘不存在' });
    return createVersionFromSnapshot(tx, dashboardId, draftSnapshotFromDashboard(locked), 'manual', input?.remark);
  });
}

async function ensureLifecycleRevision(dashboardId: number, expectedRevision: number): Promise<ReportDashboardRow> {
  const dashboard = await ensureDashboardExists(dashboardId);
  if (dashboard.revision !== expectedRevision) {
    throw new DashboardRevisionConflictError(
      '仪表盘版本已变更，请刷新后重试',
      dashboard.revision,
      mapDashboard(dashboard),
    );
  }
  return dashboard;
}

export async function publishDashboard(
  dashboardId: number,
  input: ReportDashboardLifecycleActionInput,
): Promise<ReportDashboard> {
  const current = await ensureLifecycleRevision(dashboardId, input.expectedRevision);
  await ensureDashboardReferences(
    (current.widgets ?? []) as ReportWidget[],
    (current.filters ?? []) as ReportFilter[],
    current.categoryId ?? null,
    dashboardId,
  );
  await assertDashboardSnapshotEvaluableGlobally(draftSnapshotFromDashboard(current));
  const snapshot = draftSnapshotFromDashboard(current);
  const row = await db.transaction(async (tx) => {
    const [updated] = await tx.update(reportDashboards).set({
      lifecycleStatus: 'published',
      publishedSnapshot: snapshot,
      publishedAt: new Date(),
      publishedBy: currentUserId(),
      revision: current.revision + 1,
    }).where(and(eq(reportDashboards.id, dashboardId), eq(reportDashboards.revision, input.expectedRevision))).returning();
    if (!updated) return null;
    await createVersionFromSnapshot(tx, dashboardId, snapshot, 'publish', input.remark ?? '发布快照');
    return updated;
  });
  if (!row) {
    const latest = await ensureDashboardExists(dashboardId);
    throw new DashboardRevisionConflictError('仪表盘版本已变更，请刷新后重试', latest.revision, mapDashboard(latest));
  }
  return mapDashboard(row, undefined, snapshot);
}

export async function offlineDashboard(
  dashboardId: number,
  input: ReportDashboardLifecycleActionInput,
): Promise<ReportDashboard> {
  const current = await ensureLifecycleRevision(dashboardId, input.expectedRevision);
  if (!current.publishedSnapshot) throw new HTTPException(400, { message: '该仪表盘尚未发布，无法下线' });
  const [row] = await db.update(reportDashboards).set({
    lifecycleStatus: 'offline',
    revision: current.revision + 1,
  }).where(and(eq(reportDashboards.id, dashboardId), eq(reportDashboards.revision, input.expectedRevision))).returning();
  if (!row) {
    const latest = await ensureDashboardExists(dashboardId);
    throw new DashboardRevisionConflictError('仪表盘版本已变更，请刷新后重试', latest.revision, mapDashboard(latest));
  }
  return mapDashboard(row, undefined, (row.publishedSnapshot ?? null) as ReportDashboardSnapshot | null);
}

async function getVersionSnapshotOrCurrentDraft(
  dashboardId: number,
  versionId: number,
): Promise<{ label: string; snapshot: ReportDashboardSnapshot }> {
  if (versionId === 0) {
    const dashboard = await ensureDashboardExists(dashboardId);
    return { label: `当前草稿 r${dashboard.revision}`, snapshot: draftSnapshotFromDashboard(dashboard) };
  }
  const [row] = await db.select().from(reportDashboardVersions)
    .where(and(eq(reportDashboardVersions.id, versionId), eq(reportDashboardVersions.dashboardId, dashboardId)))
    .limit(1);
  if (!row) throw new HTTPException(404, { message: '版本不存在' });
  return { label: `版本 v${row.version}`, snapshot: (row.snapshot ?? {}) as ReportDashboardSnapshot };
}

export async function diffVersion(
  dashboardId: number,
  leftVersionId: number,
  rightVersionId: number,
): Promise<ReportDashboardVersionDiff> {
  await ensureDashboardExists(dashboardId);
  const [left, right] = await Promise.all([
    getVersionSnapshotOrCurrentDraft(dashboardId, leftVersionId),
    getVersionSnapshotOrCurrentDraft(dashboardId, rightVersionId),
  ]);
  return compareDashboardSnapshots(left.snapshot, right.snapshot, {
    leftLabel: left.label,
    rightLabel: right.label,
  });
}

export async function restoreVersion(
  dashboardId: number,
  versionId: number,
  expectedRevision: number,
): Promise<ReportDashboard> {
  const current = await ensureLifecycleRevision(dashboardId, expectedRevision);
  const [version] = await db.select().from(reportDashboardVersions)
    .where(and(eq(reportDashboardVersions.id, versionId), eq(reportDashboardVersions.dashboardId, dashboardId)))
    .limit(1);
  if (!version) throw new HTTPException(404, { message: '版本不存在' });
  const snapshot = (version.snapshot ?? {}) as ReportDashboardSnapshot;
  await ensureDashboardReferences(snapshot.widgets ?? [], snapshot.filters ?? [], snapshot.categoryId ?? null, dashboardId);
  const row = await db.transaction(async (tx) => {
    const [updated] = await tx.update(reportDashboards).set({
      name: snapshot.name,
      layout: snapshot.layout as ReportGridItem[],
      canvasLayout: snapshot.canvasLayout as ReportDashboardSnapshot['canvasLayout'],
      widgets: snapshot.widgets as ReportWidget[],
      filters: snapshot.filters as ReportFilter[],
      config: snapshot.config as ReportDashboardConfig,
      categoryId: snapshot.categoryId ?? null,
      remark: snapshot.remark ?? null,
      revision: current.revision + 1,
    }).where(and(eq(reportDashboards.id, dashboardId), eq(reportDashboards.revision, expectedRevision))).returning();
    if (!updated) return null;
    await createVersionFromSnapshot(
      tx,
      dashboardId,
      draftSnapshotFromDashboard(current),
      'restore_backup',
      `恢复版本 v${version.version} 前自动备份`,
    );
    return updated;
  });
  if (!row) {
    const latest = await ensureDashboardExists(dashboardId);
    throw new DashboardRevisionConflictError('仪表盘版本已变更，请刷新后重试', latest.revision, mapDashboard(latest));
  }
  return mapDashboard(row);
}

// ─── 收藏 ──────────────────────────────────────────────────────────────────────
export async function toggleFavorite(dashboardId: number): Promise<{ favorited: boolean }> {
  await ensureDashboardExists(dashboardId);
  const uid = currentUserId();
  const existing = await db.$count(
    reportDashboardFavorites,
    and(eq(reportDashboardFavorites.userId, uid), eq(reportDashboardFavorites.dashboardId, dashboardId)),
  );
  if (existing > 0) {
    await db.delete(reportDashboardFavorites)
      .where(and(eq(reportDashboardFavorites.userId, uid), eq(reportDashboardFavorites.dashboardId, dashboardId)));
    return { favorited: false };
  }
  await db.insert(reportDashboardFavorites).values({ userId: uid, dashboardId }).onConflictDoNothing();
  return { favorited: true };
}

// ─── 公开分享 ────────────────────────────────────────────────────────────────────

function mapShareStatsRows(rows: ReportDashboardShareRow[], stats: Array<{ shareId: number; accessCount: number; lastAccessAt: Date | null }>) {
  const statMap = new Map(stats.map((item) => [item.shareId, { accessCount: item.accessCount, lastAccessAt: item.lastAccessAt }]));
  return rows.map((row) => mapShare(row, statMap.get(row.id)));
}

export function mapShare(
  row: ReportDashboardShareRow,
  stats?: { accessCount: number; lastAccessAt: Date | null },
): ReportDashboardShare {
  const token = row.tokenEncrypted ? (resolveReportSecret(row.tokenEncrypted) ?? '') : (row.token.length < 64 ? row.token : '');
  return {
    id: row.id,
    dashboardId: row.dashboardId,
    token,
    enabled: row.enabled,
    hasPassword: !!row.passwordHash,
    expireAt: formatNullableDateTime(row.expireAt),
    maxAccessCount: row.maxAccessCount ?? null,
    allowedCidrs: (row.allowedCidrs ?? []) as string[],
    allowedIps: (row.allowedIps ?? []) as string[],
    accessCount: row.accessCount ?? 0,
    lastAccessAt: formatNullableDateTime(stats?.lastAccessAt ?? null),
    createdBy: row.createdBy ?? null,
    createdAt: formatDateTime(row.createdAt),
    updatedAt: formatDateTime(row.updatedAt),
  };
}

export async function listShares(dashboardId: number): Promise<ReportDashboardShare[]> {
  await ensureDashboardExists(dashboardId);
  const rows = await db.select().from(reportDashboardShares)
    .where(eq(reportDashboardShares.dashboardId, dashboardId))
    .orderBy(desc(reportDashboardShares.id));
  if (rows.length === 0) return [];
  const stats = await db.select({
    shareId: reportShareAccessLogs.shareId,
    accessCount: count(),
    lastAccessAt: max(reportShareAccessLogs.createdAt),
  }).from(reportShareAccessLogs)
    .where(inArray(reportShareAccessLogs.shareId, rows.map((row) => row.id)))
    .groupBy(reportShareAccessLogs.shareId);
  return mapShareStatsRows(rows, stats);
}

function parseShareExpireAt(expireAt: string | null | undefined): Date | null | undefined {
  if (expireAt === undefined) return undefined;
  if (expireAt === null) return null;
  return parseDateTimeInput(expireAt);
}

export async function createShare(dashboardId: number, input: CreateReportShareInput): Promise<ReportDashboardShare> {
  const dashboard = await ensureDashboardExists(dashboardId);
  if (dashboard.lifecycleStatus !== 'published' || !dashboard.publishedSnapshot) {
    throw new HTTPException(400, { message: '仅已发布仪表盘可创建公开分享' });
  }
  await assertDashboardSnapshotEvaluableGlobally(
    dashboard.publishedSnapshot as ReportDashboardSnapshot,
  );
  assertPublicDashboardProjection((dashboard.publishedSnapshot.widgets ?? []) as ReportWidget[]);
  const token = randomBytes(24).toString('hex');
  const tokenHash = createHash('sha256').update(token).digest('hex');
  const passwordHash = input.password ? await bcrypt.hash(input.password, 10) : null;
  const expireAt = input.expireAt === undefined
    ? new Date(Date.now() + DEFAULT_SHARE_TTL_DAYS * 24 * 60 * 60 * 1000)
    : parseShareExpireAt(input.expireAt);
  const [row] = await db.insert(reportDashboardShares).values({
    dashboardId,
    token: tokenHash,
    tokenEncrypted: encryptField(token),
    passwordHash,
    expireAt,
    enabled: input.enabled ?? true,
    maxAccessCount: input.maxAccessCount ?? null,
    allowedCidrs: input.allowedCidrs ?? [],
    allowedIps: input.allowedIps ?? [],
  }).returning();
  return mapShare(row);
}

export async function ensureShareExists(id: number): Promise<ReportDashboardShareRow> {
  const [row] = await db.select().from(reportDashboardShares).where(eq(reportDashboardShares.id, id)).limit(1);
  if (!row) throw new HTTPException(404, { message: '分享链接不存在' });
  await ensureDashboardExists(row.dashboardId);
  return row;
}

export async function updateShare(id: number, input: UpdateReportShareInput): Promise<ReportDashboardShare> {
  await ensureShareExists(id);
  const passwordHash = input.password === undefined ? undefined : (input.password ? await bcrypt.hash(input.password, 10) : null);
  const expireAt = parseShareExpireAt(input.expireAt);
  const [row] = await db.update(reportDashboardShares).set({
    enabled: input.enabled,
    passwordHash,
    expireAt,
    maxAccessCount: input.maxAccessCount,
    allowedCidrs: input.allowedCidrs,
    allowedIps: input.allowedIps,
    sessionVersion: sql`${reportDashboardShares.sessionVersion} + 1`,
  }).where(eq(reportDashboardShares.id, id)).returning();
  if (!row) throw new HTTPException(404, { message: '分享链接不存在' });
  return mapShare(row);
}

export async function deleteShare(id: number): Promise<void> {
  await ensureShareExists(id);
  await db.delete(reportDashboardShares).where(eq(reportDashboardShares.id, id));
}

function logShareAccess(share: Pick<ReportDashboardShareRow, 'id' | 'dashboardId'>, action: 'access' | 'view' | 'data', ok: boolean): void {
  let clientIp: string | null = null;
  try { clientIp = getClientIp(getCtx()); } catch { /* noop */ }
  void db.insert(reportShareAccessLogs)
    .values({ shareId: share.id, dashboardId: share.dashboardId, action, clientIp, ok })
    .catch((err) => logger.warn('公开分享访问日志写入失败', { shareId: share.id, err: err instanceof Error ? err.message : String(err) }));
}

async function ensureShareAccessAllowed(share: ReportDashboardShareRow, action: 'access' | 'view' | 'data'): Promise<{ dashboard: ReportDashboardRow; clientIp: string }> {
  const dashboard = await ensureDashboardExists(share.dashboardId);
  if (!share.enabled) {
    logShareAccess(share, action, false);
    throw new HTTPException(404, { message: '链接不存在或已停用' });
  }
  if (dashboard.lifecycleStatus !== 'published' || !dashboard.publishedSnapshot) {
    logShareAccess(share, action, false);
    throw new HTTPException(403, { message: '仪表盘未发布或已下线' });
  }
  if (share.expireAt && new Date(share.expireAt).getTime() < Date.now()) {
    logShareAccess(share, action, false);
    throw new HTTPException(403, { message: '链接已过期' });
  }
  const clientIp = getClientIp(getCtx());
  if (!ensureAccessAllowedByIp(clientIp, (share.allowedIps ?? []) as string[], (share.allowedCidrs ?? []) as string[])) {
    logShareAccess(share, action, false);
    throw new HTTPException(403, { message: '当前 IP 不在允许范围内' });
  }
  return { dashboard, clientIp };
}

async function claimShareAccess(share: ReportDashboardShareRow): Promise<void> {
  const where = share.maxAccessCount
    ? and(
        eq(reportDashboardShares.id, share.id),
        lt(reportDashboardShares.accessCount, share.maxAccessCount),
      )
    : eq(reportDashboardShares.id, share.id);
  const [claimed] = await db.update(reportDashboardShares)
    .set({ accessCount: sql`${reportDashboardShares.accessCount} + 1` })
    .where(where)
    .returning({ id: reportDashboardShares.id });
  if (!claimed) throw new HTTPException(403, { message: '分享访问次数已用尽' });
}

async function releaseShareAccess(shareId: number): Promise<void> {
  await db.update(reportDashboardShares)
    .set({ accessCount: sql`GREATEST(${reportDashboardShares.accessCount} - 1, 0)` })
    .where(eq(reportDashboardShares.id, shareId));
}

async function findShareByToken(token: string): Promise<ReportDashboardShareRow> {
  const tokenHash = createHash('sha256').update(token).digest('hex');
  const [share] = await db.select().from(reportDashboardShares)
    .where(or(eq(reportDashboardShares.token, tokenHash), eq(reportDashboardShares.token, token)))
    .limit(1);
  if (!share) throw new HTTPException(404, { message: '链接不存在或已停用' });
  if (share.token === token && !share.tokenEncrypted) {
    await db.update(reportDashboardShares)
      .set({ token: tokenHash, tokenEncrypted: encryptField(token) })
      .where(eq(reportDashboardShares.id, share.id));
  }
  return share;
}

async function saveShareSession(sessionToken: string, payload: ShareSessionPayload): Promise<void> {
  try {
    const key = `${SHARE_SESSION_PREFIX}${createHash('sha256').update(sessionToken).digest('hex')}`;
    await redis.set(key, JSON.stringify(payload), 'EX', SHARE_SESSION_TTL_SECONDS);
  } catch (_err) {
    throw new HTTPException(503, { message: '公开访问会话创建失败，请稍后重试' });
  }
}

async function readShareSession(sessionToken: string): Promise<ShareSessionPayload> {
  try {
    const key = `${SHARE_SESSION_PREFIX}${createHash('sha256').update(sessionToken).digest('hex')}`;
    const raw = await redis.get(key);
    if (!raw) throw new HTTPException(401, { message: '公开访问会话已失效，请重新验证密码' });
    return JSON.parse(raw) as ShareSessionPayload;
  } catch (err) {
    if (err instanceof HTTPException) throw err;
    throw new HTTPException(503, { message: '公开访问会话不可用，请稍后重试' });
  }
}

async function resolveShareSession(shareToken: string, accessSessionToken: string, action: 'view' | 'data') {
  const share = await findShareByToken(shareToken);
  const session = await readShareSession(accessSessionToken);
  if (session.shareId !== share.id || session.dashboardId !== share.dashboardId) {
    throw new HTTPException(401, { message: '公开访问会话无效' });
  }
  const { dashboard, clientIp } = await ensureShareAccessAllowed(share, action);
  if (session.shareSessionVersion !== share.sessionVersion) {
    throw new HTTPException(401, { message: '分享配置已更新，请重新验证访问密码' });
  }
  if (session.clientIp !== clientIp) {
    throw new HTTPException(401, { message: '访问会话与当前 IP 不匹配' });
  }
  logShareAccess(share, action, true);
  return { share, dashboard };
}

function toPublicDashboard(dashboard: ReportDashboardRow): ReportPublicDashboard {
  const snapshot = (dashboard.publishedSnapshot ?? null) as ReportDashboardSnapshot | null;
  if (!snapshot) throw new HTTPException(404, { message: '仪表盘未发布' });
  return {
    name: snapshot.name,
    layout: snapshot.layout ?? [],
    canvasLayout: snapshot.canvasLayout ?? [],
    widgets: snapshot.widgets ?? [],
    filters: snapshot.filters ?? [],
    config: snapshot.config ?? {},
  };
}

/** 深度遍历配置对象，收集所有字符串值 */
function addField(into: Set<string>, field: unknown): void {
  if (typeof field === 'string' && field.trim()) into.add(field);
}

function addFields(into: Set<string>, fields: unknown): void {
  if (Array.isArray(fields)) fields.forEach((field) => addField(into, field));
}

function publicWidgetFields(widget: ReportWidget): Set<string> {
  const fields = new Set<string>();
  const options = (widget.options ?? {}) as ReportWidgetOptions;
  addField(fields, options.categoryField);
  addField(fields, options.valueField);
  addField(fields, options.compareField);
  addField(fields, options.trendField);
  addField(fields, options.sortField);
  addField(fields, options.pivotValueField);
  addField(fields, options.sourceField);
  addField(fields, options.targetField);
  addField(fields, options.wordField);
  addField(fields, options.yField);
  addField(fields, options.areaField);
  addFields(fields, options.valueFields);
  addFields(fields, options.secondaryFields);
  addFields(fields, options.pivotRows);
  addFields(fields, options.pivotColumns);
  addFields(fields, widget.drilldown?.fields);
  for (const column of options.columns ?? []) addField(fields, column.name);
  for (const format of options.conditionalFormats ?? []) addField(fields, format.field);
  return fields;
}

export function assertPublicDashboardProjection(widgets: ReportWidget[]): void {
  for (const widget of widgets) {
    if (!widget.datasetId) continue;
    const fields = publicWidgetFields(widget);
    const countOnly = widget.options?.aggregate === 'count';
    if (fields.size === 0 && !countOnly) {
      throw new HTTPException(400, {
        message: `组件「${widget.title || widget.i}」未显式配置公开字段，不能创建或访问公开分享`,
      });
    }
  }
}

export function minimizePublicData(
  widgets: ReportWidget[],
  data: Record<string, ReportWidgetDataResult>,
): Record<string, ReportWidgetDataResult> {
  const widgetById = new Map(widgets.map((widget) => [widget.i, widget]));
  const out: Record<string, ReportWidgetDataResult> = {};
  for (const [widgetId, result] of Object.entries(data)) {
    if (result.error) {
      out[widgetId] = { ...result, data: null, error: { code: 502, message: '组件数据加载失败' } };
      continue;
    }
    if (!result.data) {
      out[widgetId] = { ...result, error: null };
      continue;
    }
    const widget = widgetById.get(widgetId);
    if (!widget) {
      out[widgetId] = { ...result, data: { columns: [], fields: [], rows: [], total: result.data.total } };
      continue;
    }
    const referenced = publicWidgetFields(widget);
    const keep = result.data.columns.filter((column) => referenced.has(column));
    if (keep.length === 0) {
      out[widgetId] = {
        ...result,
        data: { columns: [], fields: [], rows: result.data.rows.map(() => ({})), total: result.data.total },
      };
      continue;
    }
    if (keep.length === result.data.columns.length) {
      out[widgetId] = result;
      continue;
    }
    const keepSet = new Set(keep);
    out[widgetId] = {
      ...result,
      data: {
        columns: keep,
        fields: result.data.fields.filter((field) => keepSet.has(field.name)),
        rows: result.data.rows.map((row) => Object.fromEntries(Object.entries(row).filter(([key]) => keepSet.has(key)))),
        total: result.data.total,
      },
    };
  }
  return out;
}

export async function createPublicAccessSession(
  token: string,
  password?: string,
): Promise<ReportPublicAccessSession> {
  const share = await findShareByToken(token);
  if (share.passwordHash) {
    if (!password || !(await bcrypt.compare(password, share.passwordHash))) {
      logShareAccess(share, 'access', false);
      throw new HTTPException(401, { message: '访问密码错误' });
    }
  }
  const { dashboard, clientIp } = await ensureShareAccessAllowed(share, 'access');
  const publicDashboard = toPublicDashboard(dashboard);
  assertPublicDashboardProjection(publicDashboard.widgets);
  const filterData = await getDashboardFilterOptionData(publicDashboard.filters, share.dashboardId);
  const accessSessionToken = randomBytes(24).toString('hex');
  const expiresAt = new Date(Date.now() + SHARE_SESSION_TTL_SECONDS * 1000);
  await claimShareAccess(share);
  try {
    await saveShareSession(accessSessionToken, {
      shareId: share.id,
      dashboardId: share.dashboardId,
      shareSessionVersion: share.sessionVersion,
      clientIp,
      createdAt: formatDateTime(new Date()),
      expiresAt: formatDateTime(expiresAt),
    });
  } catch (error) {
    await releaseShareAccess(share.id);
    throw error;
  }
  logShareAccess(share, 'access', true);
  return {
    accessSessionToken,
    expiresAt: formatDateTime(expiresAt),
    dashboard: {
      ...publicDashboard,
      filterOptions: sanitizePublicFilterOptions(publicDashboard.filters, filterData),
    },
  };
}

export async function resolvePublicDashboard(token: string, accessSessionToken: string): Promise<ReportPublicDashboard> {
  const { dashboard, share } = await resolveShareSession(token, accessSessionToken, 'view');
  const publicDashboard = toPublicDashboard(dashboard);
  assertPublicDashboardProjection(publicDashboard.widgets);
  const filterData = await getDashboardFilterOptionData(publicDashboard.filters, share.dashboardId);
  return {
    ...publicDashboard,
    filterOptions: sanitizePublicFilterOptions(publicDashboard.filters, filterData),
  };
}

export async function resolvePublicData(
  token: string,
  accessSessionToken: string,
  filterValues: Record<string, unknown>,
  widgetQueries?: Record<string, ReportDatasetQueryOptions>,
): Promise<Record<string, ReportWidgetDataResult>> {
  const { dashboard, share } = await resolveShareSession(token, accessSessionToken, 'data');
  const publicDashboard = toPublicDashboard(dashboard);
  assertPublicDashboardProjection(publicDashboard.widgets);
  const data = await getDashboardData(publicDashboard.widgets, filterValues ?? {}, undefined, widgetQueries, share.dashboardId);
  return minimizePublicData(publicDashboard.widgets, data);
}

// ─── 嵌入令牌 ────────────────────────────────────────────────────────────────────

export function mapEmbedToken(row: ReportDashboardEmbedTokenRow): ReportDashboardEmbedToken {
  const token = row.tokenEncrypted ? (resolveReportSecret(row.tokenEncrypted) ?? '') : '';
  return {
    id: row.id,
    dashboardId: row.dashboardId,
    token,
    allowedFilterIds: (row.allowedFilterIds ?? []) as string[],
    fixedFilters: (row.fixedFilters ?? {}) as Record<string, unknown>,
    expireAt: formatNullableDateTime(row.expireAt),
    revokedAt: formatNullableDateTime(row.revokedAt),
    remark: row.remark ?? null,
    createdBy: row.createdBy ?? null,
    createdAt: formatDateTime(row.createdAt),
    updatedAt: formatDateTime(row.updatedAt),
  };
}

export async function listEmbedTokens(dashboardId: number): Promise<ReportDashboardEmbedToken[]> {
  await ensureDashboardExists(dashboardId);
  const rows = await db.select().from(reportDashboardEmbedTokens)
    .where(eq(reportDashboardEmbedTokens.dashboardId, dashboardId))
    .orderBy(desc(reportDashboardEmbedTokens.id));
  return rows.map(mapEmbedToken);
}

export async function createEmbedToken(
  dashboardId: number,
  input: CreateReportEmbedTokenInput,
): Promise<ReportDashboardEmbedToken> {
  const dashboard = await ensureDashboardExists(dashboardId);
  if (dashboard.lifecycleStatus !== 'published' || !dashboard.publishedSnapshot) {
    throw new HTTPException(400, { message: '仅已发布仪表盘可创建嵌入令牌' });
  }
  const snapshot = (dashboard.publishedSnapshot ?? {}) as ReportDashboardSnapshot;
  const widgetFilterIds = new Set((snapshot.filters ?? []).map((filter) => filter.id));
  for (const filterId of input.allowedFilterIds ?? []) {
    if (!widgetFilterIds.has(filterId)) throw new HTTPException(400, { message: `筛选器 ${filterId} 不存在` });
  }
  for (const filterId of Object.keys(input.fixedFilters ?? {})) {
    if (!widgetFilterIds.has(filterId)) throw new HTTPException(400, { message: `固定筛选器 ${filterId} 不存在` });
    if ((input.allowedFilterIds ?? []).includes(filterId)) {
      throw new HTTPException(400, { message: `固定筛选器 ${filterId} 不能同时允许调用方覆盖` });
    }
  }
  await assertDashboardSnapshotEvaluableGlobally(snapshot);
  const token = randomBytes(24).toString('hex');
  const tokenHash = createHash('sha256').update(token).digest('hex');
  const [row] = await db.insert(reportDashboardEmbedTokens).values({
    dashboardId,
    token: tokenHash,
    tokenEncrypted: encryptField(token),
    allowedFilterIds: input.allowedFilterIds ?? [],
    fixedFilters: input.fixedFilters ?? {},
    expireAt: input.expireAt ? parseDateTimeInput(input.expireAt) : null,
    remark: input.remark ?? null,
  }).returning();
  return mapEmbedToken(row);
}

export async function revokeEmbedToken(id: number): Promise<void> {
  const [existing] = await db.select({ dashboardId: reportDashboardEmbedTokens.dashboardId })
    .from(reportDashboardEmbedTokens)
    .where(eq(reportDashboardEmbedTokens.id, id))
    .limit(1);
  if (!existing) throw new HTTPException(404, { message: '嵌入令牌不存在' });
  await ensureDashboardExists(existing.dashboardId);
  const [row] = await db.update(reportDashboardEmbedTokens).set({ revokedAt: new Date() })
    .where(eq(reportDashboardEmbedTokens.id, id))
    .returning();
  if (!row) throw new HTTPException(404, { message: '嵌入令牌不存在' });
}

async function resolveEmbedToken(token: string): Promise<ReportDashboardEmbedTokenRow> {
  const tokenHash = createHash('sha256').update(token).digest('hex');
  const [row] = await db.select().from(reportDashboardEmbedTokens)
    .where(eq(reportDashboardEmbedTokens.token, tokenHash))
    .limit(1);
  if (!row) throw new HTTPException(404, { message: '嵌入令牌不存在' });
  if (row.revokedAt) throw new HTTPException(403, { message: '嵌入令牌已撤销' });
  if (row.expireAt && new Date(row.expireAt).getTime() < Date.now()) {
    throw new HTTPException(403, { message: '嵌入令牌已过期' });
  }
  const dashboard = await ensureDashboardExists(row.dashboardId);
  if (dashboard.lifecycleStatus !== 'published' || !dashboard.publishedSnapshot) {
    throw new HTTPException(403, { message: '仪表盘未发布或已下线' });
  }
  return row;
}

export async function resolveEmbedDashboard(token: string): Promise<ReportPublicDashboard> {
  const row = await resolveEmbedToken(token);
  const dashboard = await ensureDashboardExists(row.dashboardId);
  const publicDashboard = toPublicDashboard(dashboard);
  const allowed = new Set((row.allowedFilterIds ?? []) as string[]);
  const filters = publicDashboard.filters.filter((filter) => allowed.has(filter.id));
  const scopedFilters = applyEmbedFilterScope({}, {
    allowedFilterIds: (row.allowedFilterIds ?? []) as string[],
    fixedFilters: (row.fixedFilters ?? {}) as Record<string, unknown>,
  });
  const filterData = await getDashboardFilterOptionData(filters, `embed:${row.id}`, scopedFilters);
  return {
    ...publicDashboard,
    filters,
    filterOptions: sanitizePublicFilterOptions(filters, filterData),
  };
}

export async function resolveEmbedData(
  token: string,
  filters: Record<string, unknown>,
  widgetQueries?: Record<string, ReportDatasetQueryOptions>,
): Promise<Record<string, ReportWidgetDataResult>> {
  const row = await resolveEmbedToken(token);
  const dashboard = await ensureDashboardExists(row.dashboardId);
  const publicDashboard = toPublicDashboard(dashboard);
  const scopedFilters = applyEmbedFilterScope(filters ?? {}, {
    allowedFilterIds: (row.allowedFilterIds ?? []) as string[],
    fixedFilters: (row.fixedFilters ?? {}) as Record<string, unknown>,
  });
  assertPublicDashboardProjection(publicDashboard.widgets);
  const data = await getDashboardData(publicDashboard.widgets, scopedFilters, undefined, widgetQueries, `embed:${row.id}`);
  return minimizePublicData(publicDashboard.widgets, data);
}
