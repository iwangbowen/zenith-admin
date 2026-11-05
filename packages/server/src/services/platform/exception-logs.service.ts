/**
 * 异常日志（服务端异常）：与错误监控共用 error_groups / error_events，本服务只操作 source = 'server' 的部分。
 * 服务端异常归平台（tenantId 为 null），契约层已限定平台身份（platformOnly: 'multi-tenant'），这里不再叠加租户条件；
 * 告警规则复用 error_alert_rules，创建 / 查询固定 source = 'server'。
 */
import { and, desc, eq, gte, inArray, isNotNull, isNull, sql, countDistinct } from 'drizzle-orm';
import { HTTPException } from 'hono/http-exception';
import type { QueryOutputOf } from '@zenith/shared/core';
import { exceptionLogContract, type ExceptionGroupDetail, type ExceptionOverview, type ExceptionReporterStatus } from '@zenith/shared/platform';
import type { CreateErrorAlertRuleInput, ErrorStatus, ServerErrorType, UpdateErrorAlertRuleInput, UpdateErrorGroupInput } from '@zenith/shared/analytics';
import { isServerErrorType } from '@zenith/shared/analytics';
import { db } from '../../db';
import { errorAlertLogs, errorAlertRules, errorEvents, errorGroups, users } from '../../db/schema';
import { requireFirstRow, requireRow } from '../../lib/db-assert';
import { APP_TIME_ZONE, formatDate, parseDateRangeStart } from '../../lib/datetime';
import { startOfDaysAgo } from '../../lib/analytics-helpers';
import { currentErrorTrackingSettings, errorReporterStats } from '../../lib/error-tracking/reporter';
import { buildListResult, listRows } from '../../lib/list-query';
import { PROCESS_HOSTNAME, PROCESS_PID } from '../../lib/process-identity';
import { buildWhere, dateRangeConditions, keywordCondition, withPagination } from '../../lib/where-helpers';
import { config } from '../../config';
import { mapEvent, mapGroup } from '../analytics/frontend-errors.service';
import { createAlertRule, deleteAlertRule, mapAlertLog, mapRule, testAlertRule, updateAlertRule } from '../analytics/error-alert.service';

const DAY_MS = 86_400_000;

const serverGroups = () => eq(errorGroups.source, 'server');
const serverEvents = () => eq(errorEvents.source, 'server');

function dateAxis(days: number): string[] {
  const todayStart = parseDateRangeStart(formatDate(new Date())) ?? new Date();
  const firstDay = todayStart.getTime() - (days - 1) * DAY_MS;
  return Array.from({ length: days }, (_, index) => formatDate(new Date(firstDay + index * DAY_MS)));
}

const dateBucket = sql<string>`to_char(timezone(${APP_TIME_ZONE}, ${errorEvents.createdAt}), 'YYYY-MM-DD')`;

// ─── 分组 ────────────────────────────────────────────────────────────────────

export async function listExceptionGroups(q: QueryOutputOf<typeof exceptionLogContract.groups>) {
  const { page, pageSize } = q;
  const where = buildWhere(
    serverGroups(),
    q.status ? eq(errorGroups.status, q.status) : undefined,
    q.errorType ? eq(errorGroups.errorType, q.errorType) : undefined,
    q.level ? eq(errorGroups.level, q.level) : undefined,
    q.environment ? eq(errorGroups.environment, q.environment) : undefined,
    q.assigneeId ? eq(errorGroups.assigneeId, q.assigneeId) : undefined,
    keywordCondition(q.keyword, [errorGroups.message], 'ilike'),
    ...dateRangeConditions(errorGroups.lastSeenAt, q.startTime, q.endTime),
  );

  return buildListResult({
    page,
    pageSize,
    count: () => db.$count(errorGroups, where),
    rows: async () => {
      const list = await withPagination(db.select().from(errorGroups).where(where).orderBy(desc(errorGroups.lastSeenAt)).$dynamic(), page, pageSize);
      // 页内分组的近 7 日趋势（迷你曲线），一次查询批量取回
      const trendByGroup = new Map<number, Map<string, number>>();
      if (list.length > 0) {
        const rows = await db
          .select({ groupId: errorEvents.groupId, date: dateBucket, count: sql<number>`COUNT(*)::int` })
          .from(errorEvents)
          .where(and(inArray(errorEvents.groupId, list.map((g) => g.id)), gte(errorEvents.createdAt, startOfDaysAgo(7))))
          .groupBy(errorEvents.groupId, sql`2`);
        for (const row of rows) {
          if (!trendByGroup.has(row.groupId)) trendByGroup.set(row.groupId, new Map());
          trendByGroup.get(row.groupId)!.set(row.date, Number(row.count));
        }
      }
      const axis = dateAxis(7);
      return list.map((g) => ({ ...mapGroup(g), trend: axis.map((d) => trendByGroup.get(g.id)?.get(d) ?? 0) }));
    },
  });
}

export async function ensureExceptionGroupExists(id: number) {
  return requireFirstRow(db.select().from(errorGroups).where(and(eq(errorGroups.id, id), serverGroups())).limit(1), '异常分组不存在');
}

export async function getExceptionGroupDetail(id: number): Promise<ExceptionGroupDetail> {
  const group = await ensureExceptionGroupExists(id);
  const start = startOfDaysAgo(14);
  const routeOrJob = sql<string>`COALESCE(${errorEvents.route}, ${errorEvents.jobType}, '-')`;

  const [trendRows, routeRows, hostRows, tenantRows, recent] = await Promise.all([
    db.select({ date: dateBucket, count: sql<number>`COUNT(*)::int` }).from(errorEvents).where(and(eq(errorEvents.groupId, id), gte(errorEvents.createdAt, start))).groupBy(sql`1`),
    db.select({ name: routeOrJob, value: sql<number>`COUNT(*)::int` }).from(errorEvents).where(eq(errorEvents.groupId, id)).groupBy(sql`1`).orderBy(sql`COUNT(*) DESC`).limit(8),
    db.select({ name: sql<string>`COALESCE(${errorEvents.hostname}, '-')`, value: sql<number>`COUNT(*)::int` }).from(errorEvents).where(eq(errorEvents.groupId, id)).groupBy(sql`1`).orderBy(sql`COUNT(*) DESC`).limit(8),
    db.select({ tenantId: errorEvents.affectedTenantId, value: sql<number>`COUNT(*)::int` }).from(errorEvents).where(eq(errorEvents.groupId, id)).groupBy(errorEvents.affectedTenantId).orderBy(sql`COUNT(*) DESC`).limit(10),
    db.select().from(errorEvents).where(eq(errorEvents.groupId, id)).orderBy(desc(errorEvents.createdAt)).limit(20),
  ]);

  const trendMap = new Map(trendRows.map((r) => [r.date, Number(r.count)]));
  return {
    group: mapGroup(group),
    trend: dateAxis(14).map((date) => ({ date, count: trendMap.get(date) ?? 0 })),
    routes: routeRows.map((r) => ({ name: r.name, value: Number(r.value) })),
    hosts: hostRows.map((r) => ({ name: r.name, value: Number(r.value) })),
    affectedTenants: tenantRows.map((r) => ({ tenantId: r.tenantId, value: Number(r.value) })),
    recentEvents: recent.map(mapEvent),
  };
}

export async function updateExceptionGroup(id: number, input: UpdateErrorGroupInput) {
  await ensureExceptionGroupExists(id);
  let assigneeName: string | null | undefined;
  if (input.assigneeId !== undefined) {
    if (input.assigneeId === null) assigneeName = null;
    else {
      // 服务端异常归平台：指派人不限租户，只要求账号存在
      const [u] = await db.select({ nickname: users.nickname, username: users.username }).from(users).where(eq(users.id, input.assigneeId)).limit(1);
      requireRow(u, '指派用户不存在', 400);
      assigneeName = u.nickname || u.username;
    }
  }
  const [row] = await db
    .update(errorGroups)
    .set({
      ...(input.status !== undefined ? { status: input.status, resolvedAt: input.status === 'resolved' ? new Date() : null } : {}),
      ...(input.level !== undefined ? { level: input.level } : {}),
      ...(input.assigneeId !== undefined ? { assigneeId: input.assigneeId, assigneeName: assigneeName ?? null } : {}),
      ...(input.note !== undefined ? { note: input.note } : {}),
    })
    .where(and(eq(errorGroups.id, id), serverGroups()))
    .returning();
  return mapGroup(row);
}

export async function batchUpdateExceptionGroupStatus(ids: number[], status: ErrorStatus): Promise<number> {
  if (ids.length === 0) return 0;
  const res = await db
    .update(errorGroups)
    .set({ status, resolvedAt: status === 'resolved' ? new Date() : null })
    .where(and(inArray(errorGroups.id, ids), serverGroups()));
  return (res as unknown as { rowCount?: number }).rowCount ?? 0;
}

export async function deleteExceptionGroups(ids: number[]): Promise<number> {
  if (ids.length === 0) return 0;
  const res = await db.delete(errorGroups).where(and(inArray(errorGroups.id, ids), serverGroups()));
  return (res as unknown as { rowCount?: number }).rowCount ?? 0;
}

// ─── 事件 ────────────────────────────────────────────────────────────────────

export async function listExceptionEvents(q: QueryOutputOf<typeof exceptionLogContract.events>) {
  const { page, pageSize } = q;
  const where = buildWhere(
    serverEvents(),
    q.groupId ? eq(errorEvents.groupId, q.groupId) : undefined,
    q.errorType ? eq(errorEvents.errorType, q.errorType) : undefined,
    q.level ? eq(errorEvents.level, q.level) : undefined,
    keywordCondition(q.correlationId, [errorEvents.correlationId], 'like', 'prefix'),
    keywordCondition(q.route, [errorEvents.route], 'ilike'),
    keywordCondition(q.jobType, [errorEvents.jobType], 'ilike'),
    keywordCondition(q.hostname, [errorEvents.hostname], 'ilike'),
    ...dateRangeConditions(errorEvents.createdAt, q.startTime, q.endTime),
  );
  return listRows({ page, pageSize, table: errorEvents, where, orderBy: [desc(errorEvents.createdAt)], map: mapEvent });
}

export async function getExceptionEvent(id: number) {
  const row = await requireFirstRow(db.select().from(errorEvents).where(and(eq(errorEvents.id, id), serverEvents())).limit(1), '异常事件不存在');
  return mapEvent(row);
}

// ─── 概览 ────────────────────────────────────────────────────────────────────

export async function getExceptionOverview(days: number): Promise<ExceptionOverview> {
  const start = startOfDaysAgo(days);
  const todayStart = parseDateRangeStart(formatDate(new Date())) ?? new Date();
  const last24h = new Date(Date.now() - DAY_MS);
  const recentGroups = and(serverGroups(), gte(errorGroups.lastSeenAt, start));

  const [totals, byType, byLevel, trendRows, topIssues, newToday, occurrences24h] = await Promise.all([
    db.select({
      totalGroups: sql<number>`COUNT(*)::int`,
      unresolved: sql<number>`COUNT(*) FILTER (WHERE ${errorGroups.status} = 'unresolved')::int`,
      totalOccurrences: sql<number>`COALESCE(SUM(${errorGroups.count}), 0)::bigint`,
    }).from(errorGroups).where(recentGroups),
    db.select({ errorType: errorGroups.errorType, groups: sql<number>`COUNT(*)::int`, occurrences: sql<number>`COALESCE(SUM(${errorGroups.count}), 0)::bigint` }).from(errorGroups).where(recentGroups).groupBy(errorGroups.errorType),
    db.select({ level: errorGroups.level, groups: sql<number>`COUNT(*)::int`, occurrences: sql<number>`COALESCE(SUM(${errorGroups.count}), 0)::bigint` }).from(errorGroups).where(recentGroups).groupBy(errorGroups.level),
    db.select({ date: dateBucket, occurrences: sql<number>`COUNT(*)::int`, groups: countDistinct(errorEvents.groupId) }).from(errorEvents).where(and(serverEvents(), gte(errorEvents.createdAt, start))).groupBy(sql`1`),
    db.select().from(errorGroups).where(and(recentGroups, eq(errorGroups.status, 'unresolved'))).orderBy(desc(errorGroups.count)).limit(10),
    db.$count(errorGroups, and(serverGroups(), gte(errorGroups.firstSeenAt, todayStart))),
    db.$count(errorEvents, and(serverEvents(), gte(errorEvents.createdAt, last24h))),
  ]);

  const trendMap = new Map(trendRows.map((r) => [r.date, r]));
  return {
    totalGroups: Number(totals[0]?.totalGroups ?? 0),
    unresolved: Number(totals[0]?.unresolved ?? 0),
    totalOccurrences: Number(totals[0]?.totalOccurrences ?? 0),
    newToday,
    occurrences24h,
    byType: byType
      .filter((r): r is typeof r & { errorType: ServerErrorType } => isServerErrorType(r.errorType))
      .map((r) => ({ errorType: r.errorType, groups: Number(r.groups), occurrences: Number(r.occurrences) })),
    byLevel: byLevel.map((r) => ({ level: r.level, groups: Number(r.groups), occurrences: Number(r.occurrences) })),
    trend: dateAxis(days).map((date) => ({ date, occurrences: Number(trendMap.get(date)?.occurrences ?? 0), groups: Number(trendMap.get(date)?.groups ?? 0) })),
    topIssues: topIssues.map(mapGroup),
  };
}

export function getReporterStatus(): ExceptionReporterStatus {
  const stats = errorReporterStats();
  return {
    enabled: currentErrorTrackingSettings().enabled,
    captured: stats.captured,
    stored: stats.stored,
    countOnly: stats.countOnly,
    dropped: stats.dropped,
    ignored: stats.ignored,
    flushFailures: stats.flushFailures,
    pending: stats.pending,
    paused: stats.paused,
    hostname: PROCESS_HOSTNAME,
    pid: PROCESS_PID,
    processRole: config.roles.label,
  };
}

// ─── 告警规则（固定 source = 'server'，平台级）─────────────────────────────────

/** 服务端异常的告警规则只认平台级 + source=server 的行 */
async function ensureServerAlertRule(id: number) {
  const row = await requireFirstRow(
    db.select().from(errorAlertRules).where(and(eq(errorAlertRules.id, id), eq(errorAlertRules.source, 'server'), isNull(errorAlertRules.tenantId))).limit(1),
    '告警规则不存在',
  );
  return row;
}

export async function listExceptionAlertRules(q: QueryOutputOf<typeof exceptionLogContract.alerts>) {
  return listRows({
    page: q.page,
    pageSize: q.pageSize,
    table: errorAlertRules,
    where: and(eq(errorAlertRules.source, 'server'), isNull(errorAlertRules.tenantId)),
    orderBy: [desc(errorAlertRules.id)],
    map: mapRule,
  });
}

export async function createExceptionAlertRule(input: CreateErrorAlertRuleInput) {
  if (input.errorType && !isServerErrorType(input.errorType)) throw new HTTPException(400, { message: '服务端异常告警规则只能选择服务端异常类型' });
  return createAlertRule({ ...input, source: 'server' });
}

export async function updateExceptionAlertRule(id: number, input: UpdateErrorAlertRuleInput) {
  await ensureServerAlertRule(id);
  if (input.errorType && !isServerErrorType(input.errorType)) throw new HTTPException(400, { message: '服务端异常告警规则只能选择服务端异常类型' });
  return updateAlertRule(id, { ...input, source: 'server' });
}

export async function deleteExceptionAlertRule(id: number) {
  await ensureServerAlertRule(id);
  return deleteAlertRule(id);
}

export async function testExceptionAlertRule(id: number) {
  await ensureServerAlertRule(id);
  return testAlertRule(id);
}

export async function listExceptionAlertLogs(q: QueryOutputOf<typeof exceptionLogContract.alertLogs>) {
  // 只看服务端规则触发的历史：按规则 source 关联；规则已删除的历史行（rule_id 为 null）不再可归因，排除
  const serverRuleIds = db.select({ id: errorAlertRules.id }).from(errorAlertRules).where(eq(errorAlertRules.source, 'server'));
  const where = buildWhere(
    isNotNull(errorAlertLogs.ruleId),
    inArray(errorAlertLogs.ruleId, serverRuleIds),
    q.ruleId ? eq(errorAlertLogs.ruleId, q.ruleId) : undefined,
  );
  return listRows({ page: q.page, pageSize: q.pageSize, table: errorAlertLogs, where, orderBy: [desc(errorAlertLogs.id)], map: mapAlertLog });
}
