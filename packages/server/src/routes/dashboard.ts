import { Hono } from 'hono';
import { sql, and, gte, lt } from 'drizzle-orm';
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

export default dashboardRoute;
