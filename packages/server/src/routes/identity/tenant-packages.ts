import { OpenAPIHono, createRoute, defineOpenAPIRoute, z } from '@hono/zod-openapi';
import { createMiddleware } from 'hono/factory';
import { authMiddleware } from '../../middleware/auth';
import { guard, setAuditAfterData, setAuditBeforeData } from '../../middleware/guard';
import { isPlatformAdmin } from '../../lib/tenant';
import type { AppEnv } from '../../lib/context';
import { PaginationQuery, jsonContent, validationHook, commonErrorResponses, ok, okPaginated, okMsg, IdParam, BatchIdsBody, okBody, errBody } from '../../lib/openapi-schemas';
import { TenantPackageDTO } from '../../lib/openapi-dtos';
import {
  listTenantPackages,
  listAllTenantPackages,
  getTenantPackage,
  createTenantPackage,
  updateTenantPackage,
  deleteTenantPackage,
  batchDeleteTenantPackages,
  assignTenantPackageMenus,
  getTenantPackageBeforeAudit,
  getTenantPackagesBeforeAudit,
} from '../../services/identity/tenant-packages.service';

const tenantPackagesRoute = new OpenAPIHono({ defaultHook: validationHook });

const platformAdminMiddleware = createMiddleware<AppEnv>(async (c, next) => {
  const user = c.get('user');
  if (!isPlatformAdmin(user)) {
    return c.json(errBody('仅平台管理员可管理租户套餐', 403), 403);
  }
  await next();
});

const createTenantPackageSchema = z.object({
  name: z.string().min(1).max(100),
  status: z.enum(['enabled', 'disabled']).default('enabled'),
  remark: z.string().max(500).optional(),
});
const updateTenantPackageSchema = createTenantPackageSchema.partial();
const assignMenusSchema = z.object({ menuIds: z.array(z.number().int()).default([]) });

const listRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get', path: '/', tags: ['TenantPackages'], summary: '租户套餐列表',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, platformAdminMiddleware] as const,
    request: { query: PaginationQuery.extend({ keyword: z.string().optional(), status: z.enum(['enabled', 'disabled']).optional() }) },
    responses: { ...okPaginated(TenantPackageDTO, 'ok'), ...commonErrorResponses },
  }),
  handler: async (c) => c.json(okBody(await listTenantPackages(c.req.valid('query'))), 200),
});

const allRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get', path: '/all', tags: ['TenantPackages'], summary: '全部租户套餐',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, platformAdminMiddleware] as const,
    responses: { ...ok(z.array(TenantPackageDTO), 'ok'), ...commonErrorResponses },
  }),
  handler: async (c) => c.json(okBody(await listAllTenantPackages()), 200),
});

const detailRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get', path: '/{id}', tags: ['TenantPackages'], summary: '租户套餐详情',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, platformAdminMiddleware] as const,
    request: { params: IdParam },
    responses: { ...ok(TenantPackageDTO, 'ok'), ...commonErrorResponses },
  }),
  handler: async (c) => {
    const { id } = c.req.valid('param');
    return c.json(okBody(await getTenantPackage(id)), 200);
  },
});

const createRouteDef = defineOpenAPIRoute({
  route: createRoute({
    method: 'post', path: '/', tags: ['TenantPackages'], summary: '创建租户套餐',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, platformAdminMiddleware, guard({ audit: { module: '租户套餐', description: '创建套餐' } })] as const,
    request: { body: { content: jsonContent(createTenantPackageSchema), required: true } },
    responses: { ...ok(TenantPackageDTO, '创建成功'), ...commonErrorResponses },
  }),
  handler: async (c) => c.json(okBody(await createTenantPackage(c.req.valid('json')), '创建成功'), 200),
});

const updateRouteDef = defineOpenAPIRoute({
  route: createRoute({
    method: 'put', path: '/{id}', tags: ['TenantPackages'], summary: '更新租户套餐',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, platformAdminMiddleware, guard({ audit: { module: '租户套餐', description: '更新套餐' } })] as const,
    request: { params: IdParam, body: { content: jsonContent(updateTenantPackageSchema), required: true } },
    responses: { ...ok(TenantPackageDTO, '更新成功'), ...commonErrorResponses },
  }),
  handler: async (c) => {
    const { id } = c.req.valid('param');
    const before = await getTenantPackageBeforeAudit(id);
    if (before) setAuditBeforeData(c, before);
    return c.json(okBody(await updateTenantPackage(id, c.req.valid('json')), '更新成功'), 200);
  },
});

const assignMenusRouteDef = defineOpenAPIRoute({
  route: createRoute({
    method: 'put', path: '/{id}/menus', tags: ['TenantPackages'], summary: '分配套餐菜单',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, platformAdminMiddleware, guard({ audit: { module: '租户套餐', description: '分配套餐菜单' } })] as const,
    request: { params: IdParam, body: { content: jsonContent(assignMenusSchema), required: true } },
    responses: { ...okMsg('菜单已更新'), ...commonErrorResponses },
  }),
  handler: async (c) => {
    const { id } = c.req.valid('param');
    const { menuIds } = c.req.valid('json');
    const before = await getTenantPackageBeforeAudit(id);
    if (before) setAuditBeforeData(c, before);
    await assignTenantPackageMenus(id, menuIds);
    const after = await getTenantPackageBeforeAudit(id);
    if (after) setAuditAfterData(c, after);
    return c.json(okBody(null, '菜单已更新'), 200);
  },
});

const batchDeleteRouteDef = defineOpenAPIRoute({
  route: createRoute({
    method: 'delete', path: '/batch', tags: ['TenantPackages'], summary: '批量删除租户套餐',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, platformAdminMiddleware, guard({ audit: { module: '租户套餐', description: '批量删除套餐' } })] as const,
    request: { body: { content: jsonContent(BatchIdsBody), required: true } },
    responses: { ...okMsg('批量删除成功'), ...commonErrorResponses },
  }),
  handler: async (c) => {
    const { ids } = c.req.valid('json');
    const before = await getTenantPackagesBeforeAudit(ids);
    if (before.length > 0) setAuditBeforeData(c, before);
    const count = await batchDeleteTenantPackages(ids);
    return c.json(okBody(null, `已删除 ${count} 条记录`), 200);
  },
});

const deleteRouteDef = defineOpenAPIRoute({
  route: createRoute({
    method: 'delete', path: '/{id}', tags: ['TenantPackages'], summary: '删除租户套餐',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, platformAdminMiddleware, guard({ audit: { module: '租户套餐', description: '删除套餐' } })] as const,
    request: { params: IdParam },
    responses: { ...okMsg('删除成功'), ...commonErrorResponses },
  }),
  handler: async (c) => {
    const { id } = c.req.valid('param');
    const before = await getTenantPackageBeforeAudit(id);
    if (before) setAuditBeforeData(c, before);
    await deleteTenantPackage(id);
    return c.json(okBody(null, '删除成功'), 200);
  },
});

tenantPackagesRoute.openapiRoutes([listRoute, allRoute, detailRoute, createRouteDef, updateRouteDef, assignMenusRouteDef, batchDeleteRouteDef, deleteRouteDef] as const);

export default tenantPackagesRoute;
