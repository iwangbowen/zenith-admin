import { OpenAPIHono, createRoute, defineOpenAPIRoute, z } from '@hono/zod-openapi';
import { count, desc, like, and, gte, lte, sql, eq } from 'drizzle-orm';
import { db } from '../db';
import { operationLogs } from '../db/schema';
import { authMiddleware } from '../middleware/auth';
import { guard } from '../middleware/guard';
import { exportToExcel } from '../lib/excel-export';
import { tenantCondition } from '../lib/tenant';
import { apiResponse, paginatedResponse, jsonContent, validationHook, commonErrorResponses } from '../lib/openapi-schemas';
import { OperationLogDTO, OperationLogStatsDTO as StatsDTO } from '../lib/openapi-dtos';

const operationLogsRoute = new OpenAPIHono({ defaultHook: validationHook });

const listRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get',
    path: '/',
    tags: ['OperationLogs'],
    summary: '操作日志分页列表',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'system:log:operation' })] as const,
    request: {
      query: z.object({
        page: z.coerce.number().optional(),
        pageSize: z.coerce.number().optional(),
        username: z.string().optional(),
        module: z.string().optional(),
        description: z.string().optional(),
        method: z.string().optional(),
        path: z.string().optional(),
        ip: z.string().optional(),
        status: z.enum(['success', 'fail']).optional(),
        startTime: z.string().optional(),
        endTime: z.string().optional(),
      }),
    },
    responses: { 200: { content: jsonContent(paginatedResponse(OperationLogDTO)), description: '日志列表' }, ...commonErrorResponses },
  }),
  handler: async (c) => {
    const q = c.req.valid('query');
    const page = Number(q.page) || 1;
    const pageSize = Number(q.pageSize) || 10;

    const conditions = [];
    if (q.username) conditions.push(like(operationLogs.username, `%${q.username}%`));
    if (q.module) conditions.push(like(operationLogs.module, `%${q.module}%`));
    if (q.description) conditions.push(like(operationLogs.description, `%${q.description}%`));
    if (q.method) conditions.push(eq(operationLogs.method, q.method));
    if (q.path) conditions.push(like(operationLogs.path, `%${q.path}%`));
    if (q.ip) conditions.push(like(operationLogs.ip, `%${q.ip}%`));
    if (q.status === 'success') conditions.push(and(gte(operationLogs.responseCode, 200), lte(operationLogs.responseCode, 399)));
    if (q.status === 'fail') conditions.push(gte(operationLogs.responseCode, 400));
    if (q.startTime) conditions.push(gte(operationLogs.createdAt, new Date(q.startTime)));
    if (q.endTime) conditions.push(lte(operationLogs.createdAt, new Date(q.endTime)));

    const where = conditions.length > 0 ? and(...conditions) : undefined;
    const user = c.get('user');
    const tc = tenantCondition(operationLogs, user);
    const finalWhere = where && tc ? and(where, tc) : (tc ?? where);

    const count = await db.$count(operationLogs, finalWhere);

    const rows = await db
      .select()
      .from(operationLogs)
      .where(finalWhere)
      .orderBy(desc(operationLogs.createdAt))
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
  },
});

const statsRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get',
    path: '/stats',
    tags: ['OperationLogs'],
    summary: '操作日志统计',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'system:log:operation' })] as const,
    request: { query: z.object({ days: z.coerce.number().optional() }) },
    responses: { 200: { content: jsonContent(apiResponse(StatsDTO)), description: '统计结果' }, ...commonErrorResponses },
  }),
  handler: async (c) => {
    const { days: daysRaw } = c.req.valid('query');
    const days = Math.min(Math.max(Number(daysRaw) || 90, 7), 365);
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days + 1);
    startDate.setHours(0, 0, 0, 0);
    const user = c.get('user');
    const tc = tenantCondition(operationLogs, user);
    const baseWhere = tc ? and(gte(operationLogs.createdAt, startDate), tc) : gte(operationLogs.createdAt, startDate);

    const moduleCount = count();
    const dailyCount = count();
    const userCount = count();
    const [moduleStats, dailyStats, userStats] = await Promise.all([
      db
        .select({
          module: operationLogs.module,
          count: moduleCount,
        })
        .from(operationLogs)
        .where(baseWhere)
        .groupBy(operationLogs.module)
        .orderBy(desc(moduleCount))
        .limit(20),
      db
        .select({
          date: sql<string>`to_char(date(${operationLogs.createdAt} AT TIME ZONE 'UTC'), 'YYYY-MM-DD')`,
          count: dailyCount,
        })
        .from(operationLogs)
        .where(baseWhere)
        .groupBy(sql`date(${operationLogs.createdAt} AT TIME ZONE 'UTC')`)
        .orderBy(sql`date(${operationLogs.createdAt} AT TIME ZONE 'UTC')`),
      db
        .select({
          username: operationLogs.username,
          count: userCount,
        })
        .from(operationLogs)
        .where(baseWhere)
        .groupBy(operationLogs.username)
        .orderBy(desc(userCount))
        .limit(10),
    ]);

    return c.json(
      {
        code: 0 as const,
        message: 'ok',
        data: {
          moduleStats: moduleStats.map((r) => ({ module: r.module ?? '未知模块', count: r.count })),
          dailyStats: dailyStats.map((r) => ({ date: r.date, count: r.count })),
          userStats: userStats.map((r) => ({ username: r.username ?? '未知用户', count: r.count })),
        },
      },
      200,
    );
  },
});

const exportRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get',
    path: '/export',
    tags: ['OperationLogs'],
    summary: '导出操作日志 Excel',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'system:log:operation' })] as const,
    responses: {
      200: {
        content: { 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': { schema: z.string() } },
        description: 'Excel 文件',
      },
    },
  }),
  handler: async (c) => {
    const rows = await db.select().from(operationLogs).where(tenantCondition(operationLogs, c.get('user'))).orderBy(desc(operationLogs.id));
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
      '操作日志',
    );
    c.header('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    c.header('Content-Disposition', 'attachment; filename=operation-logs.xlsx');
    return c.body(buffer) as never;
  },
});

operationLogsRoute.openapiRoutes([listRoute, statsRoute, exportRoute] as const);

export default operationLogsRoute;
