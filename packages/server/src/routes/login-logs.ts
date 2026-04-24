import { OpenAPIHono, createRoute, defineOpenAPIRoute, z } from '@hono/zod-openapi';
import { desc, eq, like, and, gte, lte } from 'drizzle-orm';
import { db } from '../db';
import { pageOffset } from '../lib/pagination';
import { loginLogs } from '../db/schema';
import { authMiddleware } from '../middleware/auth';
import { guard } from '../middleware/guard';
import { exportToExcel } from '../lib/excel-export';
import { tenantCondition } from '../lib/tenant';
import { PaginationQuery, validationHook, commonErrorResponses, okPaginated, okBody } from '../lib/openapi-schemas';
import { LoginLogDTO as LoginLogItem } from '../lib/openapi-dtos';

const loginLogsRoute = new OpenAPIHono({ defaultHook: validationHook });

// ─── Routes ────────────────────────────────────────────────────────────────
const listRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get',
    path: '/',
    tags: ['LoginLogs'],
    summary: '登录日志分页查询',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'system:log:login' })] as const,
    request: {
      query: PaginationQuery.extend({
        username: z.string().optional(),
        status: z.enum(['success', 'fail']).optional(),
        startTime: z.string().optional(),
        endTime: z.string().optional(),
      }),
    },
    responses: {
      ...okPaginated(LoginLogItem, '登录日志列表'),
      ...commonErrorResponses,
    },
  }),
  handler: async (c) => {
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

    const [count, rows] = await Promise.all([
      db.$count(loginLogs, finalWhere),
      db
        .select()
        .from(loginLogs)
        .where(finalWhere)
        .orderBy(desc(loginLogs.createdAt))
        .limit(pageSize)
        .offset(pageOffset(page, pageSize)),
    ]);

    return c.json(
      okBody({
        list: rows.map((r) => ({ ...r, createdAt: r.createdAt.toISOString() })),
        total: count,
        page,
        pageSize,
      }),
      200,
    );
  },
});

const exportRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get',
    path: '/export',
    tags: ['LoginLogs'],
    summary: '导出登录日志 Excel',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'system:log:login' })] as const,
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
  }),
  handler: async (c) => {
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
  },
});

loginLogsRoute.openapiRoutes([listRoute, exportRoute] as const);

export default loginLogsRoute;
