import { OpenAPIHono, createRoute, defineOpenAPIRoute, z } from '@hono/zod-openapi';
import { createMiddleware } from 'hono/factory';
import { authMiddleware } from '../middleware/auth';
import { guard } from '../middleware/guard';
import { isPlatformAdmin } from '../lib/tenant';
import type { AppEnv } from '../lib/context';
import { PaginationQuery, jsonContent, validationHook, commonErrorResponses, ok, okPaginated, okMsg, IdParam, okBody, errBody, okExcel, excelBody } from '../lib/openapi-schemas';
import { TenantDTO } from '../lib/openapi-dtos';
import {
  listTenants,
  listAllTenants,
  getTenant,
  createTenant,
  updateTenant,
  deleteTenant,
  exportTenants,
} from '../services/tenants.service';

const tenantsRoute = new OpenAPIHono({ defaultHook: validationHook });

const dateTimeStringSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/, '日期时间格式必须为 YYYY-MM-DD HH:mm:ss')
  .openapi({ example: '2026-03-22 20:09:37' });

const platformAdminMiddleware = createMiddleware<AppEnv>(async (c, next) => {
  const user = c.get('user');
  if (!isPlatformAdmin(user)) {
    return c.json(errBody('仅平台管理员可管理租户', 403), 403);
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
  expireAt: dateTimeStringSchema.optional().nullable(),
  maxUsers: z.number().int().positive().optional().nullable(),
  remark: z.string().max(500).optional(),
});
const updateTenantSchema = createTenantSchema.partial();

const listRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get', path: '/', tags: ['Tenants'], summary: '租户列表',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, platformAdminMiddleware] as const,
    request: { query: PaginationQuery.extend({ keyword: z.string().optional(), status: z.string().optional() }) },
    responses: { ...okPaginated(TenantDTO, 'ok'), ...commonErrorResponses },
  }),
  handler: async (c) => c.json(okBody(await listTenants(c.req.valid('query'))), 200),
});

const allRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get', path: '/all', tags: ['Tenants'], summary: '全部租户',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, platformAdminMiddleware] as const,
    responses: { ...ok(z.array(TenantDTO), 'ok'), ...commonErrorResponses },
  }),
  handler: async (c) => c.json(okBody(await listAllTenants()), 200),
});

const exportRouteDef = defineOpenAPIRoute({
  route: createRoute({
    method: 'get', path: '/export', tags: ['Tenants'], summary: '导出租户',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, platformAdminMiddleware] as const,
    responses: { ...okExcel() },
  }),
  handler: async (c) => {
    const { buffer, filename } = await exportTenants();
    return excelBody(c, buffer, filename);
  },
});

const detailRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get', path: '/{id}', tags: ['Tenants'], summary: '租户详情',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, platformAdminMiddleware] as const,
    request: { params: IdParam },
    responses: { ...ok(TenantDTO, 'ok'), ...commonErrorResponses },
  }),
  handler: async (c) => {
    const { id } = c.req.valid('param');
    return c.json(okBody(await getTenant(id)), 200);
  },
});

const createRouteDef = defineOpenAPIRoute({
  route: createRoute({
    method: 'post', path: '/', tags: ['Tenants'], summary: '创建租户',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, platformAdminMiddleware, guard({ audit: { module: '租户管理', description: '创建租户' } })] as const,
    request: { body: { content: jsonContent(createTenantSchema), required: true } },
    responses: { ...ok(TenantDTO, '创建成功'), ...commonErrorResponses },
  }),
  handler: async (c) => c.json(okBody(await createTenant(c.req.valid('json')), '创建成功'), 200),
});

const updateRouteDef = defineOpenAPIRoute({
  route: createRoute({
    method: 'put', path: '/{id}', tags: ['Tenants'], summary: '更新租户',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, platformAdminMiddleware, guard({ audit: { module: '租户管理', description: '更新租户' } })] as const,
    request: { params: IdParam, body: { content: jsonContent(updateTenantSchema), required: true } },
    responses: { ...ok(TenantDTO, '更新成功'), ...commonErrorResponses },
  }),
  handler: async (c) => {
    const { id } = c.req.valid('param');
    return c.json(okBody(await updateTenant(id, c.req.valid('json')), '更新成功'), 200);
  },
});

const deleteRouteDef = defineOpenAPIRoute({
  route: createRoute({
    method: 'delete', path: '/{id}', tags: ['Tenants'], summary: '删除租户',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, platformAdminMiddleware, guard({ audit: { module: '租户管理', description: '删除租户' } })] as const,
    request: { params: IdParam },
    responses: { ...okMsg('删除成功'), ...commonErrorResponses },
  }),
  handler: async (c) => {
    const { id } = c.req.valid('param');
    await deleteTenant(id);
    return c.json(okBody(null, '删除成功'), 200);
  },
});

tenantsRoute.openapiRoutes([listRoute, allRoute, exportRouteDef, detailRoute, createRouteDef, updateRouteDef, deleteRouteDef] as const);

export default tenantsRoute;
