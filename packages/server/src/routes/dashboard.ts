import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi';
import { sql, and, gte, lt, eq, desc } from 'drizzle-orm';
import { db } from '../db';
import { users, loginLogs, operationLogs } from '../db/schema';
import { authMiddleware } from '../middleware/auth';
import { isSuperAdmin } from '../lib/permissions';
import { getOnlineCount } from '../lib/session-manager';
import type { AuthEnv } from '../middleware/auth';
import { tenantCondition } from '../lib/tenant';
import { apiResponse, ErrorResponse, jsonContent, validationHook, commonErrorResponses } from '../lib/openapi-schemas';

const dashboardRoute = new OpenAPIHono<AuthEnv>({ defaultHook: validationHook });

dashboardRoute.use('/*', authMiddleware);

const StatsDTO = z.object({
  totalUsers: z.number(),
  activeUsers: z.number(),
  onlineUsers: z.number(),
  todayLogins: z.number(),
  todayOperations: z.number(),
});

const ChartsDTO = z.object({
  loginTrend: z.array(z.object({ date: z.string(), successCount: z.number(), failCount: z.number() })),
  operationTypes: z.array(z.object({ module: z.string(), count: z.number() })),
  userActivity: z.array(z.object({ date: z.string(), activeUsers: z.number() })),
});

const statsRoute = createRoute({
  method: 'get',
  path: '/stats',
  tags: ['Dashboard'],
  summary: '仪表盘统计',
  security: [{ BearerAuth: [] }],
  responses: {
    ...commonErrorResponses,
    200: { content: jsonContent(apiResponse(StatsDTO)), description: '统计数据' },
    403: { content: jsonContent(ErrorResponse), description: '无权限' },
  },
});

dashboardRoute.openapi(statsRoute, async (c) => {
  const user = c.get('user');
  if (!isSuperAdmin(user.roles)) {
    return c.json({ code: 403, message: '无权限', data: null }, 403);
  }

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

  const todayLoginWhere = ltc
    ? and(gte(loginLogs.createdAt, todayStart), lt(loginLogs.createdAt, todayEnd), ltc)
    : and(gte(loginLogs.createdAt, todayStart), lt(loginLogs.createdAt, todayEnd));
  const [todayLoginsResult] = await db
    .select({ count: sql<number>`cast(count(*) as integer)` })
    .from(loginLogs)
    .where(todayLoginWhere);

  const todayOpWhere = otc
    ? and(gte(operationLogs.createdAt, todayStart), lt(operationLogs.createdAt, todayEnd), otc)
    : and(gte(operationLogs.createdAt, todayStart), lt(operationLogs.createdAt, todayEnd));
  const [todayOperationsResult] = await db
    .select({ count: sql<number>`cast(count(*) as integer)` })
    .from(operationLogs)
    .where(todayOpWhere);

  const onlineUsers = await getOnlineCount();

  return c.json(
    {
      code: 0 as const,
      message: 'success',
      data: {
        totalUsers: totalUsersResult.count,
        activeUsers: activeUsersResult.count,
        onlineUsers,
        todayLogins: todayLoginsResult.count,
        todayOperations: todayOperationsResult.count,
      },
    },
    200,
  );
});

const chartsRoute = createRoute({
  method: 'get',
  path: '/charts',
  tags: ['Dashboard'],
  summary: '仪表盘图表数据',
  security: [{ BearerAuth: [] }],
  responses: {
    ...commonErrorResponses,
    200: { content: jsonContent(apiResponse(ChartsDTO)), description: '图表数据' },
    403: { content: jsonContent(ErrorResponse), description: '无权限' },
  },
});

dashboardRoute.openapi(chartsRoute, async (c) => {
  const user = c.get('user');
  if (!isSuperAdmin(user.roles)) {
    return c.json({ code: 403, message: '无权限', data: null }, 403);
  }

  const now = new Date();
  const todayStart = new Date(now);
  todayStart.setHours(0, 0, 0, 0);
  const todayEnd = new Date(todayStart);
  todayEnd.setDate(todayEnd.getDate() + 1);

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

  const dates: string[] = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(sevenDaysAgo);
    d.setDate(d.getDate() + i);
    dates.push(d.toISOString().slice(0, 10));
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
  for (const row of userActivityRows) {
    activityMap[row.date] = row.activeUsers;
  }
  const userActivity = dates.map((date) => ({ date, activeUsers: activityMap[date] ?? 0 }));

  return c.json(
    {
      code: 0 as const,
      message: 'success',
      data: {
        loginTrend,
        operationTypes: operationTypeRows.map((r) => ({ module: r.module ?? '未知', count: r.count })),
        userActivity,
      },
    },
    200,
  );
});

export default dashboardRoute;
