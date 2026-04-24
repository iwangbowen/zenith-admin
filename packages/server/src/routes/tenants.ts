import { OpenAPIHono, createRoute, defineOpenAPIRoute, z } from '@hono/zod-openapi';
import { eq, like, and, ne, desc } from 'drizzle-orm';
import { createMiddleware } from 'hono/factory';
import { db } from '../db';
import { pageOffset } from '../lib/pagination';
import { tenants } from '../db/schema';
import { authMiddleware } from '../middleware/auth';
import { guard } from '../middleware/guard';
import { exportToExcel } from '../lib/excel-export';
import { isPlatformAdmin } from '../lib/tenant';
import type { AppEnv } from '../lib/context';
import { ErrorResponse, PaginationQuery, jsonContent, validationHook, commonErrorResponses, ok, okPaginated, okMsg, IdParam } from '../lib/openapi-schemas';
import { TenantDTO } from '../lib/openapi-dtos';

const tenantsRoute = new OpenAPIHono({ defaultHook: validationHook });

/** 仅允许平台超管操作 */
const platformAdminMiddleware = createMiddleware<AppEnv>(async (c, next) => {
  const user = c.get('user');
  if (!isPlatformAdmin(user)) {
    return c.json({ code: 403, message: '仅平台管理员可管理租户', data: null }, 403);
  }
  await next();
});

const createTenantSchema = z.object({
  name: z.string().min(1).max(100),
  code: z.string().min(1).max(50).regex(/^[a-z][a-z0-9_]*$/),
  logo: z.string().max(500).optional(),
  contactName: z.string().max(50).optional(),
  contactPhone: z.string().max(20).optional(),
  status: z.enum(['active', 'disabled']).default('active'),
  expireAt: z.iso.datetime({ offset: true }).optional().nullable(),
  maxUsers: z.number().int().positive().optional().nullable(),
  remark: z.string().max(500).optional(),
});
const updateTenantSchema = createTenantSchema.partial();

function toTenant(row: typeof tenants.$inferSelect) {
  return {
    ...row,
    expireAt: row.expireAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

// GET /
const listRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get',
    path: '/',
    tags: ['Tenants'],
    summary: '租户列表',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, platformAdminMiddleware] as const,
    request: { query: PaginationQuery.extend({ keyword: z.string().optional(), status: z.string().optional() }) },
    responses: { ...okPaginated(TenantDTO, 'ok'), ...commonErrorResponses },
  }),
  handler: async (c) => {
    const { page = 1, pageSize = 10, keyword, status } = c.req.valid('query');
    const conditions = [];
    if (keyword) conditions.push(like(tenants.name, `%${keyword}%`));
    if (status === 'active' || status === 'disabled') conditions.push(eq(tenants.status, status));
    const where = conditions.length > 0 ? and(...conditions) : undefined;
    const [count, rows] = await Promise.all([
      db.$count(tenants, where),
      db.select().from(tenants).where(where).orderBy(desc(tenants.id)).limit(pageSize).offset(pageOffset(page, pageSize)),
    ]);
    return c.json({ code: 0 as const, message: 'ok', data: { list: rows.map(toTenant), total: count, page, pageSize } }, 200);
  },
});

// GET /all
const allRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get',
    path: '/all',
    tags: ['Tenants'],
    summary: '全部租户',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, platformAdminMiddleware] as const,
    responses: { ...ok(z.array(TenantDTO), 'ok'), ...commonErrorResponses },
  }),
  handler: async (c) => {
    const rows = await db.select({ id: tenants.id, name: tenants.name, code: tenants.code, status: tenants.status }).from(tenants).orderBy(tenants.id);
    return c.json({ code: 0 as const, message: 'ok', data: rows }, 200);
  },
});

// GET /export
const exportRouteDef = defineOpenAPIRoute({
  route: createRoute({
    method: 'get',
    path: '/export',
    tags: ['Tenants'],
    summary: '导出租户',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, platformAdminMiddleware] as const,
    responses: { 200: { content: { 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': { schema: z.string() } }, description: 'Excel' } },
  }),
  handler: async (c) => {
    const rows = await db.select().from(tenants).orderBy(desc(tenants.id));
    const buffer = await exportToExcel(
      [
        { header: 'ID', key: 'id', width: 8 },
        { header: '租户名称', key: 'name', width: 20 },
        { header: '租户编码', key: 'code', width: 16 },
        { header: '联系人', key: 'contactName', width: 14 },
        { header: '联系电话', key: 'contactPhone', width: 16 },
        { header: '状态', key: 'status', width: 10, transform: (v) => v === 'active' ? '启用' : '禁用' },
        { header: '到期时间', key: 'expireAt', width: 22 },
        { header: '最大用户数', key: 'maxUsers', width: 12 },
        { header: '创建时间', key: 'createdAt', width: 22 },
      ],
      rows.map((r) => ({ ...r, expireAt: r.expireAt?.toISOString() ?? '', createdAt: r.createdAt.toISOString(), updatedAt: r.updatedAt.toISOString() })),
      '租户列表',
    );
    c.header('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    c.header('Content-Disposition', 'attachment; filename=tenants.xlsx');
    return c.body(buffer) as never;
  },
});

// GET /{id}
const detailRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get',
    path: '/{id}',
    tags: ['Tenants'],
    summary: '租户详情',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, platformAdminMiddleware] as const,
    request: { params: IdParam },
    responses: {
      ...ok(TenantDTO, 'ok'),
      404: { content: jsonContent(ErrorResponse), description: '不存在' },
    },
  }),
  handler: async (c) => {
    const { id } = c.req.valid('param');
    const [row] = await db.select().from(tenants).where(eq(tenants.id, id)).limit(1);
    if (!row) return c.json({ code: 404, message: '租户不存在', data: null }, 404);
    return c.json({ code: 0 as const, message: 'ok', data: toTenant(row) }, 200);
  },
});

// POST /
const createRouteDef = defineOpenAPIRoute({
  route: createRoute({
    method: 'post',
    path: '/',
    tags: ['Tenants'],
    summary: '创建租户',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, platformAdminMiddleware, guard({ audit: { module: '租户管理', description: '创建租户' } })] as const,
    request: { body: { content: jsonContent(createTenantSchema), required: true } },
    responses: {
      ...ok(TenantDTO, '创建成功'),
      400: { content: jsonContent(ErrorResponse), description: '参数错误' },
    },
  }),
  handler: async (c) => {
    const data = c.req.valid('json');
    const [existing] = await db.select().from(tenants).where(eq(tenants.code, data.code)).limit(1);
    if (existing) return c.json({ code: 400, message: '租户编码已存在', data: null }, 400);
    const [row] = await db.insert(tenants).values({ ...data, expireAt: data.expireAt ? new Date(data.expireAt) : null }).returning();
    return c.json({ code: 0 as const, message: '创建成功', data: toTenant(row) }, 200);
  },
});

// PUT /{id}
const updateRouteDef = defineOpenAPIRoute({
  route: createRoute({
    method: 'put',
    path: '/{id}',
    tags: ['Tenants'],
    summary: '更新租户',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, platformAdminMiddleware, guard({ audit: { module: '租户管理', description: '更新租户' } })] as const,
    request: { params: IdParam, body: { content: jsonContent(updateTenantSchema), required: true } },
    responses: {
      ...ok(TenantDTO, '更新成功'),
      400: { content: jsonContent(ErrorResponse), description: '参数错误' },
      404: { content: jsonContent(ErrorResponse), description: '不存在' },
    },
  }),
  handler: async (c) => {
    const { id } = c.req.valid('param');
    const data = c.req.valid('json');
    if (data.code) {
      const [dup] = await db.select().from(tenants).where(and(eq(tenants.code, data.code), ne(tenants.id, id))).limit(1);
      if (dup) return c.json({ code: 400, message: '租户编码已存在', data: null }, 400);
    }
    const { expireAt: rawExpireAt, ...rest } = data;
    const values = {
      ...rest,
      ...(rawExpireAt === undefined ? {} : { expireAt: rawExpireAt ? new Date(rawExpireAt) : null }),
    };
    const [row] = await db.update(tenants).set(values).where(eq(tenants.id, id)).returning();
    if (!row) return c.json({ code: 404, message: '租户不存在', data: null }, 404);
    return c.json({ code: 0 as const, message: '更新成功', data: toTenant(row) }, 200);
  },
});

// DELETE /{id}
const deleteRouteDef = defineOpenAPIRoute({
  route: createRoute({
    method: 'delete',
    path: '/{id}',
    tags: ['Tenants'],
    summary: '删除租户',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, platformAdminMiddleware, guard({ audit: { module: '租户管理', description: '删除租户' } })] as const,
    request: { params: IdParam },
    responses: {
      ...okMsg('删除成功'),
      404: { content: jsonContent(ErrorResponse), description: '不存在' },
    },
  }),
  handler: async (c) => {
    const { id } = c.req.valid('param');
    const [row] = await db.delete(tenants).where(eq(tenants.id, id)).returning();
    if (!row) return c.json({ code: 404, message: '租户不存在', data: null }, 404);
    return c.json({ code: 0 as const, message: '删除成功', data: null }, 200);
  },
});

tenantsRoute.openapiRoutes([listRoute, allRoute, exportRouteDef, detailRoute, createRouteDef, updateRouteDef, deleteRouteDef] as const);

export default tenantsRoute;
