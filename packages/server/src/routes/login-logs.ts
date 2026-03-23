import { Hono } from 'hono';
import { desc, eq, like, and, sql } from 'drizzle-orm';
import { db } from '../db';
import { loginLogs } from '../db/schema';
import { authMiddleware } from '../middleware/auth';

const loginLogsRoute = new Hono();

loginLogsRoute.use('/*', authMiddleware);

loginLogsRoute.get('/', async (c) => {
  const page = Number(c.req.query('page')) || 1;
  const pageSize = Number(c.req.query('pageSize')) || 10;
  const username = c.req.query('username');
  const status = c.req.query('status') as 'success' | 'fail' | undefined;

  const conditions = [];
  if (username) conditions.push(like(loginLogs.username, `%${username}%`));
  if (status) conditions.push(eq(loginLogs.status, status));

  const where = conditions.length > 0 ? and(...conditions) : undefined;

  const [{ count }] = await db
    .select({ count: sql<number>`cast(count(*) as integer)` })
    .from(loginLogs)
    .where(where);

  const rows = await db
    .select()
    .from(loginLogs)
    .where(where)
    .orderBy(desc(loginLogs.createdAt))
    .limit(pageSize)
    .offset((page - 1) * pageSize);

  return c.json({
    code: 0,
    message: 'ok',
    data: {
      list: rows.map(r => ({
        ...r,
        createdAt: r.createdAt.toISOString()
      })),
      total: count,
      page,
      pageSize,
    },
  });
});

export default loginLogsRoute;
