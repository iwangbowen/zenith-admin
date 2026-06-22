import { and, eq, gte, desc, like, inArray, sql, countDistinct } from 'drizzle-orm';
import { HTTPException } from 'hono/http-exception';
import { db } from '../db';
import { errorGroups, errorEvents, sourceMaps, users } from '../db/schema';
import type { ErrorGroupRow, ErrorEventRow } from '../db/schema';
import type { FrontendErrorType, ErrorLevel, UpdateErrorGroupInput, SourceMapUploadInput } from '@zenith/shared';
import { currentUserOrNull } from '../lib/context';
import { tenantScope, getCreateTenantId } from '../lib/tenant';
import { mergeWhere, escapeLike } from '../lib/where-helpers';
import { formatDateTime, formatNullableDateTime, formatDate, APP_TIME_ZONE } from '../lib/datetime';
import { pageOffset } from '../lib/pagination';
import { parseClientEnv, computeErrorFingerprint, startOfDaysAgo, clampDays, clampLimit } from '../lib/analytics-helpers';
import { symbolicateStack } from '../lib/source-map-symbolicate';

export interface ErrorReqCtx { ip: string; ua: string }

function defaultLevel(type: FrontendErrorType): ErrorLevel {
  if (type === 'resource_error' || type === 'console_error') return 'warning';
  if (type === 'crash' || type === 'white_screen') return 'fatal';
  return 'error';
}

export function mapGroup(row: ErrorGroupRow) {
  return {
    id: row.id,
    fingerprint: row.fingerprint,
    errorType: row.errorType,
    level: row.level,
    message: row.message,
    status: row.status,
    assigneeId: row.assigneeId,
    assigneeName: row.assigneeName,
    release: row.release,
    note: row.note,
    count: Number(row.count),
    affectedUsers: row.affectedUsers,
    firstSeenAt: formatDateTime(row.firstSeenAt),
    lastSeenAt: formatDateTime(row.lastSeenAt),
    resolvedAt: formatNullableDateTime(row.resolvedAt),
  };
}

export function mapEvent(row: ErrorEventRow) {
  return {
    id: row.id,
    groupId: row.groupId,
    fingerprint: row.fingerprint,
    errorType: row.errorType,
    level: row.level,
    message: row.message,
    stack: row.stack,
    sourceUrl: row.sourceUrl,
    lineNo: row.lineNo,
    colNo: row.colNo,
    pageUrl: row.pageUrl,
    release: row.release,
    userAgent: row.userAgent,
    browser: row.browser,
    browserVersion: row.browserVersion,
    os: row.os,
    deviceType: row.deviceType,
    userId: row.userId,
    username: row.username,
    sessionId: row.sessionId,
    breadcrumbs: (row.breadcrumbs as Record<string, unknown>[] | null) ?? null,
    context: row.context ?? null,
    httpStatus: row.httpStatus,
    httpMethod: row.httpMethod,
    httpUrl: row.httpUrl,
    createdAt: formatDateTime(row.createdAt),
  };
}

// ─── 上报 ─────────────────────────────────────────────────────────────────────
export async function reportError(input: {
  errorType: FrontendErrorType;
  level?: ErrorLevel;
  message: string;
  stack?: string;
  sourceUrl?: string;
  lineNo?: number;
  colNo?: number;
  pageUrl?: string;
  release?: string;
  sessionId?: string;
  breadcrumbs?: unknown[];
  context?: Record<string, unknown>;
  httpStatus?: number;
  httpMethod?: string;
  httpUrl?: string;
}, reqCtx: ErrorReqCtx): Promise<void> {
  const user = currentUserOrNull();
  const tenantId = user ? getCreateTenantId(user) : null;
  const env = parseClientEnv(reqCtx.ua);
  const level = input.level ?? defaultLevel(input.errorType);
  const message = input.message.slice(0, 2000);
  const fingerprint = computeErrorFingerprint({ tenantId, errorType: input.errorType, message: input.message, sourceUrl: input.sourceUrl, stack: input.stack });
  const now = new Date();

  const [group] = await db
    .insert(errorGroups)
    .values({ tenantId, fingerprint, errorType: input.errorType, level, message, release: input.release ?? null, count: 1, firstSeenAt: now, lastSeenAt: now })
    .onConflictDoUpdate({
      target: errorGroups.fingerprint,
      set: {
        count: sql`${errorGroups.count} + 1`,
        lastSeenAt: now,
        message,
        release: input.release ?? sql`${errorGroups.release}`,
        status: sql`CASE WHEN ${errorGroups.status} = 'resolved' THEN 'unresolved'::error_status ELSE ${errorGroups.status} END`,
        resolvedAt: sql`CASE WHEN ${errorGroups.status} = 'resolved' THEN NULL ELSE ${errorGroups.resolvedAt} END`,
      },
    })
    .returning();

  await db.insert(errorEvents).values({
    tenantId,
    groupId: group.id,
    fingerprint,
    errorType: input.errorType,
    level,
    message,
    stack: input.stack ?? null,
    sourceUrl: input.sourceUrl ?? null,
    lineNo: input.lineNo ?? null,
    colNo: input.colNo ?? null,
    pageUrl: input.pageUrl ?? null,
    release: input.release ?? null,
    userAgent: reqCtx.ua.slice(0, 512),
    browser: env.browser,
    browserVersion: env.browserVersion,
    os: env.os,
    deviceType: env.deviceType,
    userId: user?.userId ?? null,
    username: user?.username ?? null,
    sessionId: input.sessionId ?? null,
    breadcrumbs: input.breadcrumbs ?? null,
    context: input.context ?? null,
    httpStatus: input.httpStatus ?? null,
    httpMethod: input.httpMethod ?? null,
    httpUrl: input.httpUrl ?? null,
  });
}

// ─── 分组列表 ─────────────────────────────────────────────────────────────────
export interface GroupListQuery {
  page?: number;
  pageSize?: number;
  status?: string;
  errorType?: string;
  level?: string;
  keyword?: string;
  assigneeId?: number;
}
export async function listGroups(q: GroupListQuery) {
  const page = Math.max(Number(q.page) || 1, 1);
  const pageSize = clampLimit(q.pageSize, 20, 100);
  const conditions = [];
  if (q.status) conditions.push(eq(errorGroups.status, q.status as 'unresolved'));
  if (q.errorType) conditions.push(eq(errorGroups.errorType, q.errorType as 'js_error'));
  if (q.level) conditions.push(eq(errorGroups.level, q.level as 'error'));
  if (q.assigneeId) conditions.push(eq(errorGroups.assigneeId, q.assigneeId));
  if (q.keyword) conditions.push(like(errorGroups.message, `%${escapeLike(q.keyword)}%`));
  const where = mergeWhere(conditions.length ? and(...conditions) : undefined, tenantScope(errorGroups));

  const [list, total] = await Promise.all([
    db.select().from(errorGroups).where(where).orderBy(desc(errorGroups.lastSeenAt)).limit(pageSize).offset(pageOffset(page, pageSize)),
    db.$count(errorGroups, where),
  ]);
  return { list: list.map(mapGroup), total, page, pageSize };
}

export async function ensureGroupExists(id: number) {
  const [row] = await db.select().from(errorGroups).where(mergeWhere(eq(errorGroups.id, id), tenantScope(errorGroups))).limit(1);
  if (!row) throw new HTTPException(404, { message: '错误分组不存在' });
  return row;
}

// ─── 分组详情（趋势 / 分布 / 最近事件 / 堆栈还原）────────────────────────────
export async function getGroupDetail(id: number) {
  const group = await ensureGroupExists(id);
  const start = startOfDaysAgo(14);

  const [trendRows, browserRows, osRows, recent, affected] = await Promise.all([
    db
      .select({ date: sql<string>`to_char(timezone(${APP_TIME_ZONE}, ${errorEvents.createdAt}), 'YYYY-MM-DD')`, count: sql<number>`COUNT(*)::int` })
      .from(errorEvents)
      .where(and(eq(errorEvents.groupId, id), gte(errorEvents.createdAt, start)))
      .groupBy(sql`1`),
    db.select({ name: errorEvents.browser, value: sql<number>`COUNT(*)::int` }).from(errorEvents).where(eq(errorEvents.groupId, id)).groupBy(errorEvents.browser).orderBy(sql`COUNT(*) DESC`).limit(6),
    db.select({ name: errorEvents.os, value: sql<number>`COUNT(*)::int` }).from(errorEvents).where(eq(errorEvents.groupId, id)).groupBy(errorEvents.os).orderBy(sql`COUNT(*) DESC`).limit(6),
    db.select().from(errorEvents).where(eq(errorEvents.groupId, id)).orderBy(desc(errorEvents.createdAt)).limit(20),
    db.select({ n: countDistinct(errorEvents.userId) }).from(errorEvents).where(eq(errorEvents.groupId, id)),
  ]);

  // 缓存影响用户数
  const affectedUsers = Number(affected[0]?.n ?? 0);
  if (affectedUsers !== group.affectedUsers) {
    await db.update(errorGroups).set({ affectedUsers }).where(eq(errorGroups.id, id));
  }

  // 堆栈还原：取最近事件 stack + 该 release 的 source maps
  let symbolicatedStack: string | null = null;
  const latest = recent[0];
  if (latest?.stack && latest.release) {
    const maps = await db
      .select({ fileName: sourceMaps.fileName, content: sourceMaps.content })
      .from(sourceMaps)
      .where(mergeWhere(eq(sourceMaps.release, latest.release), tenantScope(sourceMaps)));
    if (maps.length > 0) symbolicatedStack = await symbolicateStack(latest.stack, maps);
  }

  // 趋势补轴
  const axis: string[] = [];
  const today = new Date();
  for (let i = 13; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    axis.push(formatDate(d));
  }
  const trendMap = new Map(trendRows.map((r) => [r.date, Number(r.count)]));

  return {
    group: mapGroup({ ...group, affectedUsers }),
    symbolicatedStack,
    trend: axis.map((date) => ({ date, count: trendMap.get(date) ?? 0 })),
    browsers: browserRows.map((r) => ({ name: r.name ?? '未知', value: Number(r.value) })),
    os: osRows.map((r) => ({ name: r.name ?? '未知', value: Number(r.value) })),
    recentEvents: recent.map(mapEvent),
  };
}

// ─── 处理（更新 Issue）────────────────────────────────────────────────────────
export async function updateGroup(id: number, input: UpdateErrorGroupInput) {
  await ensureGroupExists(id);
  let assigneeName: string | null | undefined;
  if (input.assigneeId !== undefined) {
    if (input.assigneeId === null) assigneeName = null;
    else {
      const [u] = await db.select({ nickname: users.nickname, username: users.username }).from(users).where(eq(users.id, input.assigneeId)).limit(1);
      assigneeName = u ? (u.nickname || u.username) : null;
    }
  }
  const setResolved = input.status === 'resolved';
  const [row] = await db
    .update(errorGroups)
    .set({
      ...(input.status !== undefined ? { status: input.status } : {}),
      ...(input.level !== undefined ? { level: input.level } : {}),
      ...(input.assigneeId !== undefined ? { assigneeId: input.assigneeId, assigneeName: assigneeName ?? null } : {}),
      ...(input.note !== undefined ? { note: input.note } : {}),
      ...(input.status !== undefined ? { resolvedAt: setResolved ? new Date() : null } : {}),
    })
    .where(eq(errorGroups.id, id))
    .returning();
  return mapGroup(row);
}

export async function batchUpdateGroupStatus(ids: number[], status: 'unresolved' | 'resolved' | 'ignored' | 'muted') {
  if (ids.length === 0) return 0;
  const where = mergeWhere(inArray(errorGroups.id, ids), tenantScope(errorGroups));
  const res = await db.update(errorGroups).set({ status, resolvedAt: status === 'resolved' ? new Date() : null }).where(where);
  return (res as unknown as { rowCount?: number }).rowCount ?? 0;
}

export async function deleteGroups(ids: number[]) {
  if (ids.length === 0) return 0;
  const where = mergeWhere(inArray(errorGroups.id, ids), tenantScope(errorGroups));
  const res = await db.delete(errorGroups).where(where);
  return (res as unknown as { rowCount?: number }).rowCount ?? 0;
}

// ─── 概览 ─────────────────────────────────────────────────────────────────────
export async function getErrorOverview(daysRaw: unknown) {
  const days = clampDays(daysRaw, 30);
  const start = startOfDaysAgo(days);
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const gScope = tenantScope(errorGroups);
  const eScope = tenantScope(errorEvents);
  const recentGroups = mergeWhere(gte(errorGroups.lastSeenAt, start), gScope);

  const [totals, byType, byLevel, trendRows, affected, topIssues, newToday] = await Promise.all([
    db
      .select({
        totalGroups: sql<number>`COUNT(*)::int`,
        unresolved: sql<number>`COUNT(*) FILTER (WHERE ${errorGroups.status} = 'unresolved')::int`,
        totalOccurrences: sql<number>`COALESCE(SUM(${errorGroups.count}), 0)::bigint`,
      })
      .from(errorGroups)
      .where(recentGroups),
    db.select({ errorType: errorGroups.errorType, groups: sql<number>`COUNT(*)::int`, occurrences: sql<number>`COALESCE(SUM(${errorGroups.count}),0)::bigint` }).from(errorGroups).where(recentGroups).groupBy(errorGroups.errorType),
    db.select({ level: errorGroups.level, groups: sql<number>`COUNT(*)::int`, occurrences: sql<number>`COALESCE(SUM(${errorGroups.count}),0)::bigint` }).from(errorGroups).where(recentGroups).groupBy(errorGroups.level),
    db
      .select({ date: sql<string>`to_char(timezone(${APP_TIME_ZONE}, ${errorEvents.createdAt}), 'YYYY-MM-DD')`, occurrences: sql<number>`COUNT(*)::int`, groups: countDistinct(errorEvents.groupId) })
      .from(errorEvents)
      .where(mergeWhere(gte(errorEvents.createdAt, start), eScope))
      .groupBy(sql`1`),
    db.select({ n: countDistinct(errorEvents.userId) }).from(errorEvents).where(mergeWhere(gte(errorEvents.createdAt, start), eScope)),
    db.select().from(errorGroups).where(mergeWhere(and(eq(errorGroups.status, 'unresolved'), gte(errorGroups.lastSeenAt, start)), gScope)).orderBy(desc(errorGroups.count)).limit(10),
    db.select({ n: sql<number>`COUNT(*)::int` }).from(errorGroups).where(mergeWhere(gte(errorGroups.firstSeenAt, todayStart), gScope)),
  ]);

  const axis: string[] = [];
  const today = new Date();
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    axis.push(formatDate(d));
  }
  const trendMap = new Map(trendRows.map((r) => [r.date, r]));

  return {
    totalGroups: Number(totals[0]?.totalGroups ?? 0),
    unresolved: Number(totals[0]?.unresolved ?? 0),
    totalOccurrences: Number(totals[0]?.totalOccurrences ?? 0),
    affectedUsers: Number(affected[0]?.n ?? 0),
    newToday: Number(newToday[0]?.n ?? 0),
    byType: byType.map((r) => ({ errorType: r.errorType, groups: Number(r.groups), occurrences: Number(r.occurrences) })),
    byLevel: byLevel.map((r) => ({ level: r.level, groups: Number(r.groups), occurrences: Number(r.occurrences) })),
    trend: axis.map((date) => ({ date, occurrences: Number(trendMap.get(date)?.occurrences ?? 0), groups: Number(trendMap.get(date)?.groups ?? 0) })),
    topIssues: topIssues.map(mapGroup),
  };
}

// ─── 事件列表 ─────────────────────────────────────────────────────────────────
export interface ErrorEventListQuery { page?: number; pageSize?: number; groupId?: number }
export async function listErrorEvents(q: ErrorEventListQuery) {
  const page = Math.max(Number(q.page) || 1, 1);
  const pageSize = clampLimit(q.pageSize, 20, 100);
  const conditions = [];
  if (q.groupId) conditions.push(eq(errorEvents.groupId, q.groupId));
  const where = mergeWhere(conditions.length ? and(...conditions) : undefined, tenantScope(errorEvents));
  const [list, total] = await Promise.all([
    db.select().from(errorEvents).where(where).orderBy(desc(errorEvents.createdAt)).limit(pageSize).offset(pageOffset(page, pageSize)),
    db.$count(errorEvents, where),
  ]);
  return { list: list.map(mapEvent), total, page, pageSize };
}

export async function cleanErrors(days: number): Promise<number> {
  if (days > 0) {
    const res = await db.delete(errorEvents).where(mergeWhere(sql`${errorEvents.createdAt} < NOW() - (${days} * INTERVAL '1 day')`, tenantScope(errorEvents)));
    await db.delete(errorGroups).where(mergeWhere(sql`${errorGroups.lastSeenAt} < NOW() - (${days} * INTERVAL '1 day') AND NOT EXISTS (SELECT 1 FROM error_events ee WHERE ee.group_id = ${errorGroups.id})`, tenantScope(errorGroups)));
    return (res as unknown as { rowCount?: number }).rowCount ?? 0;
  }
  const res = await db.delete(errorGroups).where(tenantScope(errorGroups));
  return (res as unknown as { rowCount?: number }).rowCount ?? 0;
}

// ─── Source Map ──────────────────────────────────────────────────────────────
export async function uploadSourceMap(input: SourceMapUploadInput) {
  const tenantId = (() => {
    const u = currentUserOrNull();
    return u ? getCreateTenantId(u) : null;
  })();
  // replace 语义：先删后插
  await db.delete(sourceMaps).where(mergeWhere(and(eq(sourceMaps.release, input.release), eq(sourceMaps.fileName, input.fileName)), tenantScope(sourceMaps)));
  const [row] = await db.insert(sourceMaps).values({ tenantId, release: input.release, fileName: input.fileName, content: input.content, size: input.content.length }).returning();
  return { id: row.id, release: row.release, fileName: row.fileName, size: row.size, createdAt: formatDateTime(row.createdAt), updatedAt: formatDateTime(row.updatedAt) };
}

export interface SourceMapListQuery { page?: number; pageSize?: number; release?: string }
export async function listSourceMaps(q: SourceMapListQuery) {
  const page = Math.max(Number(q.page) || 1, 1);
  const pageSize = clampLimit(q.pageSize, 20, 100);
  const conditions = [];
  if (q.release) conditions.push(like(sourceMaps.release, `%${escapeLike(q.release)}%`));
  const where = mergeWhere(conditions.length ? and(...conditions) : undefined, tenantScope(sourceMaps));
  const [list, total] = await Promise.all([
    db.select({ id: sourceMaps.id, release: sourceMaps.release, fileName: sourceMaps.fileName, size: sourceMaps.size, createdAt: sourceMaps.createdAt, updatedAt: sourceMaps.updatedAt }).from(sourceMaps).where(where).orderBy(desc(sourceMaps.id)).limit(pageSize).offset(pageOffset(page, pageSize)),
    db.$count(sourceMaps, where),
  ]);
  return { list: list.map((r) => ({ id: r.id, release: r.release, fileName: r.fileName, size: r.size, createdAt: formatDateTime(r.createdAt), updatedAt: formatDateTime(r.updatedAt) })), total, page, pageSize };
}

export async function deleteSourceMap(id: number) {
  const where = mergeWhere(eq(sourceMaps.id, id), tenantScope(sourceMaps));
  const [row] = await db.select({ id: sourceMaps.id }).from(sourceMaps).where(where).limit(1);
  if (!row) throw new HTTPException(404, { message: 'Source Map 不存在' });
  await db.delete(sourceMaps).where(where);
}
