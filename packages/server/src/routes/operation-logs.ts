import { Hono } from 'hono';
import { desc, like, and, gte, lte, sql, eq } from 'drizzle-orm';
import { db } from '../db';
import { operationLogs } from '../db/schema';
import { authMiddleware } from '../middleware/auth';
import { guard } from '../middleware/guard';
import { exportToExcel } from '../lib/excel-export';

const operationLogsRoute = new Hono();

operationLogsRoute.use('/*', authMiddleware);

operationLogsRoute.get('/', guard({ permission: 'system:log:operation' }), async (c) => {
  const page = Number(c.req.query('page')) || 1;
  const pageSize = Number(c.req.query('pageSize')) || 10;
  const username = c.req.query('username');
  const module = c.req.query('module');
  const description = c.req.query('description');
  const method = c.req.query('method');
  const path = c.req.query('path');
  const status = c.req.query('status');
  const startTime = c.req.query('startTime');
  const endTime = c.req.query('endTime');

  const conditions = [];
  if (username) conditions.push(like(operationLogs.username, `%${username}%`));
  if (module) conditions.push(like(operationLogs.module, `%${module}%`));
  if (description) conditions.push(like(operationLogs.description, `%${description}%`));
  if (method) conditions.push(eq(operationLogs.method, method));
  if (path) conditions.push(like(operationLogs.path, `%${path}%`));
  if (status === 'success') conditions.push(and(gte(operationLogs.responseCode, 200), lte(operationLogs.responseCode, 399)));
  if (status === 'fail') conditions.push(gte(operationLogs.responseCode, 400));
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

operationLogsRoute.get('/export', guard({ permission: 'system:operationlog:list' }), async (c) => {
  const rows = await db.select().from(operationLogs).orderBy(desc(operationLogs.id));
  const buffer = await exportToExcel(
    [
      { header: 'ID', key: 'id', width: 8 },
      { header: '用户名', key: 'username', width: 14 },
      { header: '模块', key: 'module', width: 14 },
      { header: '描述', key: 'description', width: 20 },
      { header: '方法', key: 'method', width: 8 },
      { header: '路径', key: 'path', width: 24 },
      { header: '状态码', key: 'responseCode', width: 10 },
      { header: '耗时(ms)', key: 'duration', width: 12 },
      { header: 'IP', key: 'ip', width: 16 },
      { header: '时间', key: 'createdAt', width: 22 },
    ],
    rows.map((r) => ({ ...r, createdAt: r.createdAt.toISOString() })),
    '操作日志'
  );
  c.header('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  c.header('Content-Disposition', 'attachment; filename=operation-logs.xlsx');
  return c.body(buffer);
});

export default operationLogsRoute;
