import { OpenAPIHono, createRoute, defineOpenAPIRoute, z } from '@hono/zod-openapi';
import { eq, like, and, ne, sql, desc } from 'drizzle-orm';
import { db } from '../db';
import { pageOffset } from '../lib/pagination';
import { systemConfigs } from '../db/schema';
import { authMiddleware } from '../middleware/auth';
import { guard } from '../middleware/guard';
import { exportToExcel } from '../lib/excel-export';
import { getPasswordPolicy } from '../lib/password-policy';
import { tenantCondition, getCreateTenantId } from '../lib/tenant';
import { ErrorResponse, PaginationQuery, jsonContent, validationHook, commonErrorResponses, ok, okPaginated, okMsg, IdParam } from '../lib/openapi-schemas';
import { SystemConfigDTO, PublicConfigDTO, PasswordPolicyDTO } from '../lib/openapi-dtos';

const systemConfigsRoute = new OpenAPIHono({ defaultHook: validationHook });
const configTypeValues = ['string', 'number', 'boolean', 'json'] as const;
const createSystemConfigSchema = z.object({
  configKey: z.string().min(1).max(128).regex(/^[\w.]+$/),
  configValue: z.string().max(4096),
  configType: z.enum(configTypeValues).default('string'),
  description: z.string().max(256).default(''),
});
const updateSystemConfigSchema = createSystemConfigSchema.partial();

// ─── Public routes ─────────────────────────────────────────────────────────
const publicGetRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get',
    path: '/public/{key}',
    tags: ['SystemConfigs'],
    summary: '公开获取单项配置',
    request: { params: z.object({ key: z.string().openapi({ param: { name: 'key', in: 'path' }, example: 'site_name', description: '配置键' }) }) },
    responses: {
      ...commonErrorResponses,
      ...ok(PublicConfigDTO, '配置値'),
      404: { content: jsonContent(ErrorResponse), description: '配置不存在' },
    },
  }),
  handler: async (c) => {
    const { key } = c.req.valid('param');
    const [row] = await db.select().from(systemConfigs).where(eq(systemConfigs.configKey, key)).limit(1);
    if (!row) {
      return c.json({ code: 404, message: '配置不存在', data: null }, 404);
    }
    return c.json(
      {
        code: 0 as const,
        message: 'ok',
        data: { configKey: row.configKey, configValue: row.configValue, configType: row.configType },
      },
      200,
    );
  },
});

const passwordPolicyRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get',
    path: '/password-policy',
    tags: ['SystemConfigs'],
    summary: '获取当前密码策略',
    responses: {
      ...commonErrorResponses,
      ...ok(PasswordPolicyDTO, '密码策略'),
    },
  }),
  handler: async (c) => {
    const policy = await getPasswordPolicy();
    return c.json({ code: 0 as const, message: 'success', data: policy }, 200);
  },
});

// ─── Protected routes ──────────────────────────────────────────────────────

const listRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get',
    path: '/',
    tags: ['SystemConfigs'],
    summary: '配置分页列表',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'system:config:list' })] as const,
    request: {
      query: PaginationQuery.extend({
        keyword: z.string().optional(),
        configType: z.enum(configTypeValues).optional(),
      }),
    },
    responses: {
      ...commonErrorResponses,
      ...okPaginated(SystemConfigDTO, '配置列表'),
    },
  }),
  handler: async (c) => {
    const q = c.req.valid('query');
    const page = Number(q.page) || 1;
    const pageSize = Number(q.pageSize) || 10;
    const conditions = [];
    if (q.keyword) conditions.push(like(systemConfigs.configKey, `%${q.keyword}%`));
    if (q.configType) conditions.push(eq(systemConfigs.configType, q.configType));

    const where = conditions.length > 0 ? and(...conditions) : undefined;
    const user = c.get('user');
    const tc = tenantCondition(systemConfigs, user);
    const finalWhere = where && tc ? and(where, tc) : (tc ?? where);

    const [count, rows] = await Promise.all([
      db.$count(systemConfigs, finalWhere),
      db
        .select()
        .from(systemConfigs)
        .where(finalWhere)
        .orderBy(desc(systemConfigs.id))
        .limit(pageSize)
        .offset(pageOffset(page, pageSize)),
    ]);

    return c.json(
      {
        code: 0 as const,
        message: 'ok',
        data: {
          list: rows.map((r) => ({ ...r, createdAt: r.createdAt.toISOString(), updatedAt: r.updatedAt.toISOString() })),
          total: count,
          page,
          pageSize,
        },
      },
      200,
    );
  },
});

const createConfigRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'post',
    path: '/',
    tags: ['SystemConfigs'],
    summary: '新增配置',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'system:config:create', audit: { module: '系统配置', description: '新增配置' } })] as const,
    request: { body: { content: jsonContent(createSystemConfigSchema), required: true } },
    responses: {
      ...commonErrorResponses,
      ...ok(SystemConfigDTO, '创建成功'),
      400: { content: jsonContent(ErrorResponse), description: '配置键已存在' },
    },
  }),
  handler: async (c) => {
    const data = c.req.valid('json');
    const [existing] = await db
      .select()
      .from(systemConfigs)
      .where(and(eq(systemConfigs.configKey, data.configKey), tenantCondition(systemConfigs, c.get('user')) ?? sql`1=1`))
      .limit(1);
    if (existing) {
      return c.json({ code: 400, message: '配置键已存在', data: null }, 400);
    }
    const [row] = await db
      .insert(systemConfigs)
      .values({ ...data, tenantId: getCreateTenantId(c.get('user')) })
      .returning();
    return c.json(
      {
        code: 0 as const,
        message: '创建成功',
        data: { ...row, createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString() },
      },
      200,
    );
  },
});

const updateConfigRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'put',
    path: '/{id}',
    tags: ['SystemConfigs'],
    summary: '更新配置',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'system:config:update', audit: { module: '系统配置', description: '更新配置' } })] as const,
    request: {
      params: IdParam,
      body: { content: jsonContent(updateSystemConfigSchema), required: true },
    },
    responses: {
      ...commonErrorResponses,
      ...ok(SystemConfigDTO, '更新成功'),
      400: { content: jsonContent(ErrorResponse), description: '配置键已存在' },
      404: { content: jsonContent(ErrorResponse), description: '配置不存在' },
    },
  }),
  handler: async (c) => {
    const { id } = c.req.valid('param');
    const data = c.req.valid('json');

    if (data.configKey) {
      const tc = tenantCondition(systemConfigs, c.get('user'));
      const dupWhere = tc
        ? and(eq(systemConfigs.configKey, data.configKey), ne(systemConfigs.id, id), tc)
        : and(eq(systemConfigs.configKey, data.configKey), ne(systemConfigs.id, id));
      const [dup] = await db.select().from(systemConfigs).where(dupWhere).limit(1);
      if (dup) {
        return c.json({ code: 400, message: '配置键已存在', data: null }, 400);
      }
    }

    const tenantCond = tenantCondition(systemConfigs, c.get('user'));
    const [row] = await db
      .update(systemConfigs)
      .set({ ...data })
      .where(tenantCond ? and(eq(systemConfigs.id, id), tenantCond) : eq(systemConfigs.id, id))
      .returning();

    if (!row) {
      return c.json({ code: 404, message: '配置不存在', data: null }, 404);
    }

    return c.json(
      {
        code: 0 as const,
        message: '更新成功',
        data: { ...row, createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString() },
      },
      200,
    );
  },
});

const deleteRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'delete',
    path: '/{id}',
    tags: ['SystemConfigs'],
    summary: '删除配置',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'system:config:delete', audit: { module: '系统配置', description: '删除配置' } })] as const,
    request: { params: IdParam },
    responses: {
      ...commonErrorResponses,
      ...okMsg('删除成功'),
      404: { content: jsonContent(ErrorResponse), description: '配置不存在' },
    },
  }),
  handler: async (c) => {
    const { id } = c.req.valid('param');
    const tc = tenantCondition(systemConfigs, c.get('user'));
    const [row] = await db
      .delete(systemConfigs)
      .where(tc ? and(eq(systemConfigs.id, id), tc) : eq(systemConfigs.id, id))
      .returning();
    if (!row) {
      return c.json({ code: 404, message: '配置不存在', data: null }, 404);
    }
    return c.json({ code: 0 as const, message: '删除成功', data: null }, 200);
  },
});

const exportRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get',
    path: '/export',
    tags: ['SystemConfigs'],
    summary: '导出系统配置 Excel',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'system:config:list' })] as const,
    responses: {
      ...commonErrorResponses,
      200: {
        content: { 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': { schema: z.string() } },
        description: 'Excel 文件',
      },
    },
  }),
  handler: async (c) => {
    const rows = await db
      .select()
      .from(systemConfigs)
      .where(tenantCondition(systemConfigs, c.get('user')))
      .orderBy(desc(systemConfigs.id));
    const buffer = await exportToExcel(
      [
        { header: 'ID', key: 'id', width: 8 },
        { header: '配置键', key: 'configKey', width: 30 },
        { header: '配置值', key: 'configValue', width: 40 },
        { header: '类型', key: 'configType', width: 10 },
        { header: '描述', key: 'description', width: 30 },
      ],
      rows.map((r) => ({ ...r, createdAt: r.createdAt.toISOString(), updatedAt: r.updatedAt.toISOString() })),
      '系统配置',
    );
    c.header('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    c.header('Content-Disposition', 'attachment; filename=system-configs.xlsx');
    return c.body(buffer) as never;
  },
});

systemConfigsRoute.openapiRoutes([publicGetRoute, passwordPolicyRoute, listRoute, createConfigRoute, updateConfigRoute, deleteRoute, exportRoute] as const);

export default systemConfigsRoute;
