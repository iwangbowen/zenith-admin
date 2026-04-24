import { OpenAPIHono, createRoute, defineOpenAPIRoute, z } from '@hono/zod-openapi';
import { eq, and, like, or, gte, lte } from 'drizzle-orm';
import { db } from '../db';
import { pageOffset } from '../lib/pagination';
import { roles, roleMenus, userRoles } from '../db/schema';
import { authMiddleware } from '../middleware/auth';
import { guard } from '../middleware/guard';
import { clearUserPermissionCache } from '../lib/permissions';
import { exportToExcel } from '../lib/excel-export';
import { tenantCondition, getCreateTenantId } from '../lib/tenant';
import { createRoleSchema, updateRoleSchema, assignRoleMenusSchema, assignRoleUsersSchema } from '@zenith/shared';
import { ErrorResponse, PaginationQuery, jsonContent, validationHook, commonErrorResponses, ok, okPaginated, okMsg, IdParam, okBody, errBody, okExcel, excelBody } from '../lib/openapi-schemas';
import { RoleDTO, UserDTO } from '../lib/openapi-dtos';

const rolesRouter = new OpenAPIHono({ defaultHook: validationHook });

function toRole(row: typeof roles.$inferSelect, menuIds?: number[]) {
  return {
    ...row,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    ...(menuIds === undefined ? {} : { menuIds }),
  };
}

// ─── Routes ────────────────────────────────────────────────────────────────
const allRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get',
    path: '/all',
    tags: ['Roles'],
    summary: '全量角色（供下拉框）',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'system:role:list' })] as const,
    request: {},
    responses: {
      ...commonErrorResponses,
      ...ok(z.array(RoleDTO), '全量角色'),
    },
  }),
  handler: async (c) => {
    const tc = tenantCondition(roles, c.get('user'));
    const list = await db.select().from(roles).where(tc).orderBy(roles.id);
    return c.json(okBody(list.map((r) => toRole(r))), 200);
  },
});

const listRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get',
    path: '/',
    tags: ['Roles'],
    summary: '角色列表',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'system:role:list' })] as const,
    request: {
      query: PaginationQuery.extend({
        keyword: z.string().optional(),
        status: z.enum(['active', 'disabled']).optional(),
        startTime: z.string().optional(),
        endTime: z.string().optional(),
      }),
    },
    responses: {
      ...commonErrorResponses,
      ...okPaginated(RoleDTO, '角色列表'),
    },
  }),
  handler: async (c) => {
    const q = c.req.valid('query');
    const { page = 1, pageSize = 10 } = q;
    const conditions = [];
    if (q.keyword) {
      conditions.push(or(like(roles.name, `%${q.keyword}%`), like(roles.code, `%${q.keyword}%`)));
    }
    if (q.status) conditions.push(eq(roles.status, q.status));
    if (q.startTime) conditions.push(gte(roles.createdAt, new Date(q.startTime)));
    if (q.endTime) conditions.push(lte(roles.createdAt, new Date(q.endTime)));

    const where = conditions.length > 0 ? and(...conditions) : undefined;
    const user = c.get('user');
    const tc = tenantCondition(roles, user);
    const finalWhere = where && tc ? and(where, tc) : (tc ?? where);
    const [total, list] = await Promise.all([
      db.$count(roles, finalWhere),
      db.select().from(roles).where(finalWhere).orderBy(roles.id).limit(pageSize).offset(pageOffset(page, pageSize)),
    ]);

    return c.json(okBody({ list: list.map((r) => toRole(r)), total, page, pageSize }), 200);
  },
});

const getOneRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get',
    path: '/{id}',
    tags: ['Roles'],
    summary: '获取单个角色（含 menuIds）',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'system:role:list' })] as const,
    request: { params: IdParam },
    responses: {
      ...commonErrorResponses,
      ...ok(RoleDTO, '角色详情'),
      404: { content: jsonContent(ErrorResponse), description: '角色不存在' },
    },
  }),
  handler: async (c) => {
    const { id } = c.req.valid('param');
    const role = await db.query.roles.findFirst({
      where: and(eq(roles.id, id), tenantCondition(roles, c.get('user'))),
      with: { roleMenus: { columns: { menuId: true } } },
    });
    if (!role) return c.json(errBody('角色不存在', 404), 404);

    const menuIds = role.roleMenus.map(({ menuId }) => menuId);
    return c.json(okBody(toRole(role, menuIds)), 200);
  },
});

const createRoleRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'post',
    path: '/',
    tags: ['Roles'],
    summary: '新增角色',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'system:role:create', audit: { description: '创建角色', module: '角色管理' } })] as const,
    request: { body: { content: jsonContent(createRoleSchema), required: true } },
    responses: {
      ...commonErrorResponses,
      ...ok(RoleDTO, '创建成功'),
      400: { content: jsonContent(ErrorResponse), description: '编码冲突' },
    },
  }),
  handler: async (c) => {
    const data = c.req.valid('json');
    try {
      const [role] = await db
        .insert(roles)
        .values({ ...data, tenantId: getCreateTenantId(c.get('user')) })
        .returning();
      return c.json(okBody(toRole(role), '创建成功'), 200);
    } catch (err: unknown) {
      if ((err as { code?: string }).code === '23505') {
        return c.json(errBody('角色编码已存在'), 400);
      }
      throw err;
    }
  },
});

const updateRoleRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'put',
    path: '/{id}',
    tags: ['Roles'],
    summary: '更新角色',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'system:role:update', audit: { description: '更新角色', module: '角色管理' } })] as const,
    request: {
      params: IdParam,
      body: { content: jsonContent(updateRoleSchema), required: true },
    },
    responses: {
      ...commonErrorResponses,
      ...ok(RoleDTO, '更新成功'),
      404: { content: jsonContent(ErrorResponse), description: '角色不存在' },
    },
  }),
  handler: async (c) => {
    const { id } = c.req.valid('param');
    const data = c.req.valid('json');
    const [role] = await db
      .update(roles)
      .set({ ...data })
      .where(and(eq(roles.id, id), tenantCondition(roles, c.get('user'))))
      .returning();
    if (!role) return c.json(errBody('角色不存在', 404), 404);
    return c.json(okBody(toRole(role), '更新成功'), 200);
  },
});

const deleteRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'delete',
    path: '/{id}',
    tags: ['Roles'],
    summary: '删除角色',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'system:role:delete', audit: { description: '删除角色', module: '角色管理' } })] as const,
    request: { params: IdParam },
    responses: {
      ...commonErrorResponses,
      ...okMsg('删除成功'),
      404: { content: jsonContent(ErrorResponse), description: '角色不存在' },
    },
  }),
  handler: async (c) => {
    const { id } = c.req.valid('param');
    const [deleted] = await db
      .delete(roles)
      .where(and(eq(roles.id, id), tenantCondition(roles, c.get('user'))))
      .returning();
    if (!deleted) return c.json(errBody('角色不存在', 404), 404);
    return c.json(okBody(null, '删除成功'), 200);
  },
});

const assignMenusRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'put',
    path: '/{id}/menus',
    tags: ['Roles'],
    summary: '分配角色菜单',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'system:role:assign', audit: { description: '分配角色菜单', module: '角色管理' } })] as const,
    request: {
      params: IdParam,
      body: { content: jsonContent(assignRoleMenusSchema), required: true },
    },
    responses: {
      ...commonErrorResponses,
      ...okMsg('菜单权限已更新'),
      404: { content: jsonContent(ErrorResponse), description: '角色不存在' },
    },
  }),
  handler: async (c) => {
    const { id } = c.req.valid('param');
    const data = c.req.valid('json');
    const [role] = await db
      .select({ id: roles.id })
      .from(roles)
      .where(and(eq(roles.id, id), tenantCondition(roles, c.get('user'))))
      .limit(1);
    if (!role) return c.json(errBody('角色不存在', 404), 404);

    await db.transaction(async (tx) => {
      await tx.delete(roleMenus).where(eq(roleMenus.roleId, id));
      if (data.menuIds.length > 0) {
        await tx.insert(roleMenus).values(data.menuIds.map((menuId: number) => ({ roleId: id, menuId })));
      }
    });

    clearUserPermissionCache();
    return c.json(okBody(null, '菜单权限已更新'), 200);
  },
});

const getUsersRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get',
    path: '/{id}/users',
    tags: ['Roles'],
    summary: '获取角色关联用户',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'system:role:list' })] as const,
    request: { params: IdParam },
    responses: {
      ...commonErrorResponses,
      ...ok(z.array(UserDTO), '用户列表'),
      404: { content: jsonContent(ErrorResponse), description: '角色不存在' },
    },
  }),
  handler: async (c) => {
    const { id } = c.req.valid('param');
    const role = await db.query.roles.findFirst({
      where: and(eq(roles.id, id), tenantCondition(roles, c.get('user'))),
      columns: {},
      with: { userRoles: { columns: {}, with: { user: true } } },
    });
    if (!role) return c.json(errBody('角色不存在', 404), 404);

    return c.json(
      okBody(role.userRoles.map(({ user: u }) => ({
        id: u.id, username: u.username, nickname: u.nickname, email: u.email,
        avatar: u.avatar, status: u.status,
        createdAt: u.createdAt.toISOString(), updatedAt: u.updatedAt.toISOString(),
      }))),
      200,
    );
  },
});

const assignUsersRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'put',
    path: '/{id}/users',
    tags: ['Roles'],
    summary: '分配角色用户',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'system:role:assign', audit: { description: '分配角色用户', module: '角色管理' } })] as const,
    request: {
      params: IdParam,
      body: { content: jsonContent(assignRoleUsersSchema), required: true },
    },
    responses: {
      ...commonErrorResponses,
      ...okMsg('用户分配已更新'),
      404: { content: jsonContent(ErrorResponse), description: '角色不存在' },
    },
  }),
  handler: async (c) => {
    const { id } = c.req.valid('param');
    const data = c.req.valid('json');
    const [role] = await db
      .select({ id: roles.id })
      .from(roles)
      .where(and(eq(roles.id, id), tenantCondition(roles, c.get('user'))))
      .limit(1);
    if (!role) return c.json(errBody('角色不存在', 404), 404);

    await db.transaction(async (tx) => {
      await tx.delete(userRoles).where(eq(userRoles.roleId, id));
      if (data.userIds.length > 0) {
        await tx.insert(userRoles).values(data.userIds.map((userId: number) => ({ userId, roleId: id })));
      }
    });

    clearUserPermissionCache();
    return c.json(okBody(null, '用户分配已更新'), 200);
  },
});

const exportRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get',
    path: '/export',
    tags: ['Roles'],
    summary: '导出角色列表',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'system:role:list' })] as const,
    responses: {
      ...commonErrorResponses,
      ...okExcel('Excel 文件'),
    },
  }),
  handler: async (c) => {
    const rows = await db.select().from(roles).where(tenantCondition(roles, c.get('user')));
    const buffer = await exportToExcel(
      [
        { header: 'ID', key: 'id', width: 8 },
        { header: '角色名称', key: 'name', width: 18 },
        { header: '角色编码', key: 'code', width: 18 },
        { header: '描述', key: 'description', width: 30 },
        { header: '状态', key: 'status', width: 10, transform: (v) => (v === 'active' ? '启用' : '禁用') },
        { header: '创建时间', key: 'createdAt', width: 22 },
      ],
      rows.map((r) => ({ ...r, createdAt: r.createdAt.toISOString() })),
      '角色列表',
    );
    return excelBody(c, buffer, 'roles.xlsx');
  },
});

rolesRouter.openapiRoutes([allRoute, listRoute, getOneRoute, createRoleRoute, updateRoleRoute, deleteRoute, assignMenusRoute, getUsersRoute, assignUsersRoute, exportRoute] as const);

export default rolesRouter;
