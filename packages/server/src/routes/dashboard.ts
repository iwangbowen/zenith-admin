import { Hono } from 'hono';
import { sql, and, gte, lt, eq, desc } from 'drizzle-orm';
import { db } from '../db';
import { users, loginLogs, operationLogs } from '../db/schema';
import { authMiddleware } from '../middleware/auth';
import { isSuperAdmin } from '../lib/permissions';
import { getOnlineCount } from '../lib/session-manager';
import type { JwtPayload } from '../middleware/auth';
import { tenantCondition } from '../lib/tenant';

const dashboardRoute = new Hono<{ Variables: { user: JwtPayload } }>();

dashboardRoute.use('/*', authMiddleware);

// GET /api/dashboard/stats — 仅超级管理员可访问
dashboardRoute.get('/stats', async (c) => {
  const user = c.get('user');

  if (!isSuperAdmin(user.roles)) {
    return c.json({ code: 403, message: '无权限', data: null }, 403);
  }

  // 今天的时间范围（UTC 起始）
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const todayEnd = new Date(todayStart);
  todayEnd.setDate(todayEnd.getDate() + 1);

  const utc = tenantCondition(users, user);
  const ltc = tenantCondition(loginLogs, user);
  const otc = tenantCondition(operationLogs, user);

  const [totalUsersResult] = await db
    .select({ count: sql<number>`cast(count(*) as integer)` })
    .from(users)
    .where(utc);

  const [activeUsersResult] = await db
    .select({ count: sql<number>`cast(count(*) as integer)` })
    .from(users)
    .where(utc ? and(sql`${users.status} = 'active'`, utc) : sql`${users.status} = 'active'`);

  const todayLoginWhere = ltc ? and(gte(loginLogs.createdAt, todayStart), lt(loginLogs.createdAt, todayEnd), ltc) : and(gte(loginLogs.createdAt, todayStart), lt(loginLogs.createdAt, todayEnd));
  const [todayLoginsResult] = await db
    .select({ count: sql<number>`cast(count(*) as integer)` })
    .from(loginLogs)
    .where(todayLoginWhere);

  const todayOpWhere = otc ? and(gte(operationLogs.createdAt, todayStart), lt(operationLogs.createdAt, todayEnd), otc) : and(gte(operationLogs.createdAt, todayStart), lt(operationLogs.createdAt, todayEnd));
  const [todayOperationsResult] = await db
    .select({ count: sql<number>`cast(count(*) as integer)` })
    .from(operationLogs)
    .where(todayOpWhere);

  const onlineUsers = await getOnlineCount();

  return c.json({
    code: 0,
    message: 'success',
    data: {
      totalUsers: totalUsersResult.count,
      activeUsers: activeUsersResult.count,
      onlineUsers,
      todayLogins: todayLoginsResult.count,
      todayOperations: todayOperationsResult.count,
    },
  });
});

// GET /api/dashboard/charts — 仅超级管理员，返回 7 天趋势 + 今日操作分布 + 用户活跃度
dashboardRoute.get('/charts', async (c) => {
  const user = c.get('user');

  if (!isSuperAdmin(user.roles)) {
    return c.json({ code: 403, message: '无权限', data: null }, 403);
  }

  const now = new Date();
  const todayStart = new Date(now);
  todayStart.setHours(0, 0, 0, 0);
  const todayEnd = new Date(todayStart);
  todayEnd.setDate(todayEnd.getDate() + 1);

  // 7 天前的起点
  const sevenDaysAgo = new Date(todayStart);
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 6);

  const ltc = tenantCondition(loginLogs, user);
  const otc = tenantCondition(operationLogs, user);

  const loginRangeWhere = ltc
    ? and(gte(loginLogs.createdAt, sevenDaysAgo), ltc)
    : gte(loginLogs.createdAt, sevenDaysAgo);

  const todayOpWhere = otc
    ? and(gte(operationLogs.createdAt, todayStart), lt(operationLogs.createdAt, todayEnd), otc)
    : and(gte(operationLogs.createdAt, todayStart), lt(operationLogs.createdAt, todayEnd));

  const activityRangeWhere = ltc
    ? and(gte(loginLogs.createdAt, sevenDaysAgo), eq(loginLogs.status, 'success'), ltc)
    : and(gte(loginLogs.createdAt, sevenDaysAgo), eq(loginLogs.status, 'success'));

  const [loginTrendRows, operationTypeRows, userActivityRows] = await Promise.all([
    // 7 天登录趋势（按天，success/fail 分开）
    db
      .select({
        date: sql<string>`to_char(date(${loginLogs.createdAt} AT TIME ZONE 'UTC'), 'YYYY-MM-DD')`,
        status: loginLogs.status,
        count: sql<number>`cast(count(*) as integer)`,
      })
      .from(loginLogs)
      .where(loginRangeWhere)
      .groupBy(sql`date(${loginLogs.createdAt} AT TIME ZONE 'UTC')`, loginLogs.status)
      .orderBy(sql`date(${loginLogs.createdAt} AT TIME ZONE 'UTC')`),

    // 今日操作类型分布（按模块）
    db
      .select({
        module: operationLogs.module,
        count: sql<number>`cast(count(*) as integer)`,
      })
      .from(operationLogs)
      .where(todayOpWhere)
      .groupBy(operationLogs.module)
      .orderBy(desc(sql`count(*)`))
      .limit(8),

    // 7 天用户活跃度（每天成功登录的不重复用户数）
    db
      .select({
        date: sql<string>`to_char(date(${loginLogs.createdAt} AT TIME ZONE 'UTC'), 'YYYY-MM-DD')`,
        activeUsers: sql<number>`cast(count(distinct ${loginLogs.username}) as integer)`,
      })
      .from(loginLogs)
      .where(activityRangeWhere)
      .groupBy(sql`date(${loginLogs.createdAt} AT TIME ZONE 'UTC')`)
      .orderBy(sql`date(${loginLogs.createdAt} AT TIME ZONE 'UTC')`),
  ]);

  // 生成过去 7 天的日期列表，填补缺失日期
  const dates: string[] = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(sevenDaysAgo);
    d.setDate(d.getDate() + i);
    dates.push(d.toISOString().slice(0, 10));
  }

  // 登录趋势：合并 success/fail 到同一日期
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

  // 用户活跃度：合并缺日期
  const activityMap: Record<string, number> = {};
  for (const row of userActivityRows) {
    activityMap[row.date] = row.activeUsers;
  }
  const userActivity = dates.map((date) => ({
    date,
    activeUsers: activityMap[date] ?? 0,
  }));

  return c.json({
    code: 0,
    message: 'success',
    data: {
      loginTrend,
      operationTypes: operationTypeRows.map((r) => ({
        module: r.module ?? '未知',
        count: r.count,
      })),
      userActivity,
    },
  });
});

export default dashboardRoute;
