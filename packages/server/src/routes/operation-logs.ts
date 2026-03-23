import { Hono } from 'hono';
import { desc, like, and, gte, lte, sql } from 'drizzle-orm';
import { db } from '../db';
import { operationLogs } from '../db/schema';
import { authMiddleware } from '../middleware/auth';

const operationLogsRoute = new Hono();

operationLogsRoute.use('/*', authMiddleware);

operationLogsRoute.get('/', async (c) => {
  const page = Number(c.req.query('page')) || 1;
  const pageSize = Number(c.req.query('pageSize')) || 10;
  const username = c.req.query('username');
  const module = c.req.query('module');
  const description = c.req.query('description');
  const startTime = c.req.query('startTime');
  const endTime = c.req.query('endTime');

  const conditions = [];
  if (username) conditions.push(like(operationLogs.username, `%${username}%`));
  if (module) conditions.push(like(operationLogs.module, `%${module}%`));
  if (description) conditions.push(like(operationLogs.description, `%${description}%`));
  if (startTime) conditions.push(gte(operationLogs.createdAt, new Date(startTime)));
  if (endTime) conditions.push(lte(operationLogs.createdAt, new Date(endTime)));

  const where = conditions.length > 0 ? and(...conditions) : undefined;

  const [{ count }] = await db
    .select({ count: sql<number>`cast(count(*) as integer)` })
    .from(operationLogs)
    .where(where);

  const rows = await db
    .select()
    .from(operationLogs)
    .where(where)
    .orderBy(desc(operationLogs.createdAt))
    .limit(pageSize)
    .offset((page - 1) * pageSize);

  return c.json({
    code: 0,
    message: 'ok',
    data: {
      list: rows.map((r) => ({ ...r, createdAt: r.createdAt.toISOString() })),
      total: count,
      page,
      pageSize,
    },
  });
});

export default operationLogsRoute;
