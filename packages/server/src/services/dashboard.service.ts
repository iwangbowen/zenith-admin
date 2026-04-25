import { count, countDistinct, sql, and, gte, lt, eq, desc } from 'drizzle-orm';
import { db } from '../db';
import { users, loginLogs, operationLogs } from '../db/schema';
import { isSuperAdmin } from '../lib/permissions';
import { getOnlineCount } from '../lib/session-manager';
import { tenantCondition } from '../lib/tenant';
import { AppError } from '../lib/errors';
import type { JwtPayload } from '../middleware/auth';
import { currentUser } from '../lib/context';
import { formatDate } from '../lib/datetime';

function ensureSuperAdmin(user: JwtPayload) {
  if (!isSuperAdmin(user.roles)) throw new AppError('无权限', 403);
}

export async function getDashboardStats() {
  const user = currentUser();
  ensureSuperAdmin(user);
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const todayEnd = new Date(todayStart);
  todayEnd.setDate(todayEnd.getDate() + 1);

  const utc = tenantCondition(users, user);
  const ltc = tenantCondition(loginLogs, user);
  const otc = tenantCondition(operationLogs, user);

  const activeUsersWhere = utc ? and(eq(users.status, 'active'), utc) : eq(users.status, 'active');
  const todayLoginWhere = ltc
    ? and(gte(loginLogs.createdAt, todayStart), lt(loginLogs.createdAt, todayEnd), ltc)
    : and(gte(loginLogs.createdAt, todayStart), lt(loginLogs.createdAt, todayEnd));
  const todayOpWhere = otc
    ? and(gte(operationLogs.createdAt, todayStart), lt(operationLogs.createdAt, todayEnd), otc)
    : and(gte(operationLogs.createdAt, todayStart), lt(operationLogs.createdAt, todayEnd));

  const [totalUsers, activeUsers, todayLogins, todayOperations, onlineUsers] = await Promise.all([
    db.$count(users, utc),
    db.$count(users, activeUsersWhere),
    db.$count(loginLogs, todayLoginWhere),
    db.$count(operationLogs, todayOpWhere),
    getOnlineCount(),
  ]);
  return { totalUsers, activeUsers, onlineUsers, todayLogins, todayOperations };
}

export async function getDashboardCharts() {
  const user = currentUser();
  ensureSuperAdmin(user);
  const now = new Date();
  const todayStart = new Date(now);
  todayStart.setHours(0, 0, 0, 0);
  const todayEnd = new Date(todayStart);
  todayEnd.setDate(todayEnd.getDate() + 1);
  const sevenDaysAgo = new Date(todayStart);
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 6);

  const ltc = tenantCondition(loginLogs, user);
  const otc = tenantCondition(operationLogs, user);

  const loginRangeWhere = ltc ? and(gte(loginLogs.createdAt, sevenDaysAgo), ltc) : gte(loginLogs.createdAt, sevenDaysAgo);
  const todayOpWhere = otc
    ? and(gte(operationLogs.createdAt, todayStart), lt(operationLogs.createdAt, todayEnd), otc)
    : and(gte(operationLogs.createdAt, todayStart), lt(operationLogs.createdAt, todayEnd));
  const activityRangeWhere = ltc
    ? and(gte(loginLogs.createdAt, sevenDaysAgo), eq(loginLogs.status, 'success'), ltc)
    : and(gte(loginLogs.createdAt, sevenDaysAgo), eq(loginLogs.status, 'success'));

  const loginTrendCount = count();
  const operationTypeCount = count();
  const activeUserCount = countDistinct(loginLogs.username);
  const [loginTrendRows, operationTypeRows, userActivityRows] = await Promise.all([
    db
      .select({
        date: sql<string>`to_char(date(${loginLogs.createdAt}), 'YYYY-MM-DD')`,
        status: loginLogs.status,
        count: loginTrendCount,
      })
      .from(loginLogs)
      .where(loginRangeWhere)
      .groupBy(sql`date(${loginLogs.createdAt})`, loginLogs.status)
      .orderBy(sql`date(${loginLogs.createdAt})`),
    db
      .select({ module: operationLogs.module, count: operationTypeCount })
      .from(operationLogs)
      .where(todayOpWhere)
      .groupBy(operationLogs.module)
      .orderBy(desc(operationTypeCount))
      .limit(8),
    db
      .select({
        date: sql<string>`to_char(date(${loginLogs.createdAt}), 'YYYY-MM-DD')`,
        activeUsers: activeUserCount,
      })
      .from(loginLogs)
      .where(activityRangeWhere)
      .groupBy(sql`date(${loginLogs.createdAt})`)
      .orderBy(sql`date(${loginLogs.createdAt})`),
  ]);

  const dates: string[] = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(sevenDaysAgo);
    d.setDate(d.getDate() + i);
    dates.push(formatDate(d));
  }

  const trendMap: Record<string, { successCount: number; failCount: number }> = {};
  for (const row of loginTrendRows) {
    if (!trendMap[row.date]) trendMap[row.date] = { successCount: 0, failCount: 0 };
    if (row.status === 'success') trendMap[row.date].successCount = row.count;
    else trendMap[row.date].failCount = row.count;
  }
  const loginTrend = dates.map((date) => ({
    date,
    successCount: trendMap[date]?.successCount ?? 0,
    failCount: trendMap[date]?.failCount ?? 0,
  }));
  const activityMap: Record<string, number> = {};
  for (const row of userActivityRows) activityMap[row.date] = row.activeUsers;
  const userActivity = dates.map((date) => ({ date, activeUsers: activityMap[date] ?? 0 }));

  return {
    loginTrend,
    operationTypes: operationTypeRows.map((r) => ({ module: r.module ?? '未知', count: r.count })),
    userActivity,
  };
}
