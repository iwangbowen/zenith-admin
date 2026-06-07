import { OpenAPIHono, createRoute, defineOpenAPIRoute, z } from '@hono/zod-openapi';
import { authMiddleware } from '../middleware/auth';
import { guard, setAuditBeforeData } from '../middleware/guard';
import { createRoleSchema, updateRoleSchema, assignRoleMenusSchema, assignRoleUsersSchema } from '@zenith/shared';
import { PaginationQuery, jsonContent, validationHook, commonErrorResponses, ok, okPaginated, okMsg, IdParam, okBody, okExcel, excelStreamBody, okCsv, csvStreamBody } from '../lib/openapi-schemas';
import { RoleDTO, UserDTO } from '../lib/openapi-dtos';
import {
  listAllRoles,
  listRoles,
  getRole,
  createRole,
  updateRole,
  deleteRole,
  assignRoleMenus,
  getRoleUsers,
  assignRoleUsers,
  exportRoles, exportRolesAsCsv,
  getRoleBeforeAudit,
} from '../services/roles.service';

const rolesRouter = new OpenAPIHono({ defaultHook: validationHook });

const allRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get', path: '/all', tags: ['Roles'], summary: '全量角色（供下拉框）',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'system:role:list' })] as const,
    request: {},
    responses: { ...commonErrorResponses, ...ok(z.array(RoleDTO), '全量角色') },
  }),
  handler: async (c) => c.json(okBody(await listAllRoles()), 200),
});

const listRouteDef = defineOpenAPIRoute({
  route: createRoute({
    method: 'get', path: '/', tags: ['Roles'], summary: '角色列表',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'system:role:list' })] as const,
    request: {
      query: PaginationQuery.extend({
        keyword: z.string().optional(),
        status: z.enum(['enabled', 'disabled']).optional(),
        startTime: z.string().optional(),
        endTime: z.string().optional(),
      }),
    },
    responses: { ...commonErrorResponses, ...okPaginated(RoleDTO, '角色列表') },
  }),
  handler: async (c) => c.json(okBody(await listRoles(c.req.valid('query'))), 200),
});

const getOneRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get', path: '/{id}', tags: ['Roles'], summary: '获取单个角色（含 menuIds）',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'system:role:list' })] as const,
    request: { params: IdParam },
    responses: { ...commonErrorResponses, ...ok(RoleDTO, '角色详情') },
  }),
  handler: async (c) => {
    const { id } = c.req.valid('param');
    return c.json(okBody(await getRole(id)), 200);
  },
});

const createRoleRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'post', path: '/', tags: ['Roles'], summary: '新增角色',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'system:role:create', audit: { description: '创建角色', module: '角色管理' } })] as const,
    request: { body: { content: jsonContent(createRoleSchema), required: true } },
    responses: { ...commonErrorResponses, ...ok(RoleDTO, '创建成功') },
  }),
  handler: async (c) => c.json(okBody(await createRole(c.req.valid('json')), '创建成功'), 200),
});

const updateRoleRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'put', path: '/{id}', tags: ['Roles'], summary: '更新角色',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'system:role:update', audit: { description: '更新角色', module: '角色管理' } })] as const,
    request: { params: IdParam, body: { content: jsonContent(updateRoleSchema), required: true } },
    responses: { ...commonErrorResponses, ...ok(RoleDTO, '更新成功') },
  }),
  handler: async (c) => {
    const { id } = c.req.valid('param');
    const before = await getRoleBeforeAudit(id);
    if (before) setAuditBeforeData(c, before);
    return c.json(okBody(await updateRole(id, c.req.valid('json')), '更新成功'), 200);
  },
});

const deleteRouteDef = defineOpenAPIRoute({
  route: createRoute({
    method: 'delete', path: '/{id}', tags: ['Roles'], summary: '删除角色',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'system:role:delete', audit: { description: '删除角色', module: '角色管理' } })] as const,
    request: { params: IdParam },
    responses: { ...commonErrorResponses, ...okMsg('删除成功') },
  }),
  handler: async (c) => {
    const { id } = c.req.valid('param');
    const before = await getRoleBeforeAudit(id);
    if (before) setAuditBeforeData(c, before);
    await deleteRole(id);
    return c.json(okBody(null, '删除成功'), 200);
  },
});

const assignMenusRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'put', path: '/{id}/menus', tags: ['Roles'], summary: '分配角色菜单',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'system:role:assign', audit: { description: '分配角色菜单', module: '角色管理' } })] as const,
    request: { params: IdParam, body: { content: jsonContent(assignRoleMenusSchema), required: true } },
    responses: { ...commonErrorResponses, ...okMsg('菜单权限已更新') },
  }),
  handler: async (c) => {
    const { id } = c.req.valid('param');
    const data = c.req.valid('json');
    const before = await getRoleBeforeAudit(id);
    if (before) setAuditBeforeData(c, before);
    await assignRoleMenus(id, data.menuIds);
    return c.json(okBody(null, '菜单权限已更新'), 200);
  },
});

const getUsersRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get', path: '/{id}/users', tags: ['Roles'], summary: '获取角色关联用户',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'system:role:list' })] as const,
    request: { params: IdParam },
    responses: { ...commonErrorResponses, ...ok(z.array(UserDTO), '用户列表') },
  }),
  handler: async (c) => {
    const { id } = c.req.valid('param');
    return c.json(okBody(await getRoleUsers(id)), 200);
  },
});

const assignUsersRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'put', path: '/{id}/users', tags: ['Roles'], summary: '分配角色用户',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'system:role:assign', audit: { description: '分配角色用户', module: '角色管理' } })] as const,
    request: { params: IdParam, body: { content: jsonContent(assignRoleUsersSchema), required: true } },
    responses: { ...commonErrorResponses, ...okMsg('用户分配已更新') },
  }),
  handler: async (c) => {
    const { id } = c.req.valid('param');
    const data = c.req.valid('json');
    const before = await getRoleBeforeAudit(id);
    if (before) setAuditBeforeData(c, before);
    await assignRoleUsers(id, data.userIds);
    return c.json(okBody(null, '用户分配已更新'), 200);
  },
});

const exportRouteDef = defineOpenAPIRoute({
  route: createRoute({
    method: 'get', path: '/export', tags: ['Roles'], summary: '导出角色列表',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'system:role:list' })] as const,
    responses: { ...commonErrorResponses, ...okExcel('Excel 文件') },
  }),
  handler: async (c) => {
    const { stream, filename } = await exportRoles();
    return excelStreamBody(c, stream, filename);
  },
});

const exportCsvRouteDef = defineOpenAPIRoute({
  route: createRoute({
    method: 'get', path: '/export/csv', tags: ['Roles'], summary: '导出角色列表 CSV',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'system:role:list' })] as const,
    responses: { ...commonErrorResponses, ...okCsv('CSV 文件') },
  }),
  handler: async (c) => {
    const { stream, filename } = await exportRolesAsCsv();
    return csvStreamBody(c, stream, filename);
  },
});

rolesRouter.openapiRoutes([allRoute, listRouteDef, exportRouteDef, exportCsvRouteDef, getOneRoute, createRoleRoute, updateRoleRoute, deleteRouteDef, assignMenusRoute, getUsersRoute, assignUsersRoute] as const);

export default rolesRouter;
