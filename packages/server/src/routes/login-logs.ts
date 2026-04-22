import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi';
import { desc, eq, like, and, sql, gte, lte } from 'drizzle-orm';
import { db } from '../db';
import { loginLogs } from '../db/schema';
import { authMiddleware } from '../middleware/auth';
import type { AuthEnv } from '../middleware/auth';
import { guard } from '../middleware/guard';
import { exportToExcel } from '../lib/excel-export';
import { tenantCondition } from '../lib/tenant';
import { paginatedResponse, jsonContent, validationHook, commonErrorResponses } from '../lib/openapi-schemas';

const loginLogsRoute = new OpenAPIHono<AuthEnv>({ defaultHook: validationHook });
loginLogsRoute.use('/*', authMiddleware);

// ─── Schemas ───────────────────────────────────────────────────────────────
const LoginLogItem = z
  .object({
    id: z.number(),
    username: z.string().nullable(),
    ip: z.string().nullable(),
    status: z.enum(['success', 'fail']),
    message: z.string().nullable(),
    userAgent: z.string().nullable().optional(),
    createdAt: z.string(),
  })
  .passthrough()
  .openapi('LoginLogItem');

// ─── Routes ────────────────────────────────────────────────────────────────
const listRoute = createRoute({
  method: 'get',
  path: '/',
  tags: ['LoginLogs'],
  summary: '登录日志分页查询',
  security: [{ BearerAuth: [] }],
  middleware: [guard({ permission: 'system:log:login' })] as const,
  request: {
    query: z.object({
      page: z.coerce.number().optional(),
      pageSize: z.coerce.number().optional(),
      username: z.string().optional(),
      status: z.enum(['success', 'fail']).optional(),
      startTime: z.string().optional(),
      endTime: z.string().optional(),
    }),
  },
  responses: {
    200: { content: jsonContent(paginatedResponse(LoginLogItem)), description: '登录日志列表' },
    ...commonErrorResponses,
  },
});

loginLogsRoute.openapi(listRoute, async (c) => {
  const q = c.req.valid('query');
  const page = Number(q.page) || 1;
  const pageSize = Number(q.pageSize) || 10;

  const conditions = [];
  if (q.username) conditions.push(like(loginLogs.username, `%${q.username}%`));
  if (q.status) conditions.push(eq(loginLogs.status, q.status));
  if (q.startTime) conditions.push(gte(loginLogs.createdAt, new Date(q.startTime)));
  if (q.endTime) conditions.push(lte(loginLogs.createdAt, new Date(q.endTime)));

  const where = conditions.length > 0 ? and(...conditions) : undefined;
  const user = c.get('user');
  const tc = tenantCondition(loginLogs, user);
  const finalWhere = where && tc ? and(where, tc) : (tc ?? where);

  const [{ count }] = await db
    .select({ count: sql<number>`cast(count(*) as integer)` })
    .from(loginLogs)
    .where(finalWhere);

  const rows = await db
    .select()
    .from(loginLogs)
    .where(finalWhere)
    .orderBy(desc(loginLogs.createdAt))
    .limit(pageSize)
    .offset((page - 1) * pageSize);

  return c.json(
    {
      code: 0 as const,
      message: 'ok',
      data: {
        list: rows.map((r) => ({ ...r, createdAt: r.createdAt.toISOString() })),
        total: count,
        page,
        pageSize,
      },
    },
    200,
  );
});

const exportRoute = createRoute({
  method: 'get',
  path: '/export',
  tags: ['LoginLogs'],
  summary: '导出登录日志 Excel',
  security: [{ BearerAuth: [] }],
  middleware: [guard({ permission: 'system:log:login' })] as const,
  responses: {
    200: {
      description: 'Excel 文件',
      content: {
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': {
          schema: z.string().openapi({ format: 'binary' }),
        },
      },
    },
  },
});

loginLogsRoute.openapi(exportRoute, async (c) => {
  const rows = await db
    .select()
    .from(loginLogs)
    .where(tenantCondition(loginLogs, c.get('user')))
    .orderBy(desc(loginLogs.id));
  const buffer = await exportToExcel(
    [
      { header: 'ID', key: 'id', width: 8 },
      { header: '用户名', key: 'username', width: 16 },
      { header: 'IP', key: 'ip', width: 18 },
      { header: '状态', key: 'status', width: 10, transform: (v) => (v === 'success' ? '成功' : '失败') },
      { header: '消息', key: 'message', width: 30 },
      { header: '登录时间', key: 'createdAt', width: 22 },
    ],
    rows.map((r) => ({ ...r, message: r.message ?? '', createdAt: r.createdAt.toISOString() })),
    '登录日志',
  );
  c.header('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  c.header('Content-Disposition', 'attachment; filename=login-logs.xlsx');
  return c.body(buffer);
});

export default loginLogsRoute;
