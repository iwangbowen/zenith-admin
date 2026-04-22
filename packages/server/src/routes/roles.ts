import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi';
import { eq, and, like, or, gte, lte } from 'drizzle-orm';
import { db } from '../db';
import { roles, roleMenus, userRoles, users } from '../db/schema';
import { authMiddleware } from '../middleware/auth';
import type { AuthEnv } from '../middleware/auth';
import { guard } from '../middleware/guard';
import { clearUserPermissionCache } from '../lib/permissions';
import { exportToExcel } from '../lib/excel-export';
import { tenantCondition, getCreateTenantId } from '../lib/tenant';
import { createRoleSchema, updateRoleSchema, assignRoleMenusSchema, assignRoleUsersSchema } from '@zenith/shared';
import { apiResponse, ErrorResponse, MessageResponse, jsonContent, validationHook, commonErrorResponses } from '../lib/openapi-schemas';

const rolesRouter = new OpenAPIHono<AuthEnv>({ defaultHook: validationHook });
rolesRouter.use('*', authMiddleware);

function toRole(row: typeof roles.$inferSelect, menuIds?: number[]) {
  return {
    ...row,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    ...(menuIds === undefined ? {} : { menuIds }),
  };
}

// ─── Schemas ───────────────────────────────────────────────────────────────
const RoleDTO = z.looseObject({}).openapi('Role');
const UserDTO = z.looseObject({}).openapi('UserBrief');

// ─── Routes ────────────────────────────────────────────────────────────────
const listRoute = createRoute({
  method: 'get',
  path: '/',
  tags: ['Roles'],
  summary: '角色列表',
  security: [{ BearerAuth: [] }],
  middleware: [guard({ permission: 'system:role:list' })] as const,
  request: {
    query: z.object({
      keyword: z.string().optional(),
      status: z.enum(['active', 'disabled']).optional(),
      startTime: z.string().optional(),
      endTime: z.string().optional(),
    }),
  },
  responses: {
    ...commonErrorResponses,
    200: { content: jsonContent(apiResponse(z.array(RoleDTO))), description: '角色列表' },
  },
});

rolesRouter.openapi(listRoute, async (c) => {
  const q = c.req.valid('query');
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
  const list = await db.select().from(roles).where(finalWhere).orderBy(roles.id);

  return c.json({ code: 0 as const, message: 'ok', data: list.map((r) => toRole(r)) }, 200);
});

const getOneRoute = createRoute({
  method: 'get',
  path: '/{id}',
  tags: ['Roles'],
  summary: '获取单个角色（含 menuIds）',
  security: [{ BearerAuth: [] }],
  middleware: [guard({ permission: 'system:role:list' })] as const,
  request: { params: z.object({ id: z.coerce.number() }) },
  responses: {
    ...commonErrorResponses,
    200: { content: jsonContent(apiResponse(RoleDTO)), description: '角色详情' },
    404: { content: jsonContent(ErrorResponse), description: '角色不存在' },
  },
});

rolesRouter.openapi(getOneRoute, async (c) => {
  const { id } = c.req.valid('param');
  const [role] = await db
    .select()
    .from(roles)
    .where(and(eq(roles.id, id), tenantCondition(roles, c.get('user'))))
    .limit(1);
  if (!role) return c.json({ code: 404, message: '角色不存在', data: null }, 404);

  const assignments = await db.select({ menuId: roleMenus.menuId }).from(roleMenus).where(eq(roleMenus.roleId, id));
  const menuIds = assignments.map((a) => a.menuId);
  return c.json({ code: 0 as const, message: 'ok', data: toRole(role, menuIds) }, 200);
});

const createRoleRoute = createRoute({
  method: 'post',
  path: '/',
  tags: ['Roles'],
  summary: '新增角色',
  security: [{ BearerAuth: [] }],
  middleware: [guard({ permission: 'system:role:create', audit: { description: '创建角色', module: '角色管理' } })] as const,
  request: { body: { content: jsonContent(createRoleSchema), required: true } },
  responses: {
    ...commonErrorResponses,
    200: { content: jsonContent(apiResponse(RoleDTO)), description: '创建成功' },
    400: { content: jsonContent(ErrorResponse), description: '编码冲突' },
  },
});

rolesRouter.openapi(createRoleRoute, async (c) => {
  const data = c.req.valid('json');
  try {
    const [role] = await db
      .insert(roles)
      .values({ ...data, tenantId: getCreateTenantId(c.get('user')) })
      .returning();
    return c.json({ code: 0 as const, message: '创建成功', data: toRole(role) }, 200);
  } catch (err: unknown) {
    if ((err as { code?: string }).code === '23505') {
      return c.json({ code: 400, message: '角色编码已存在', data: null }, 400);
    }
    throw err;
  }
});

const updateRoleRoute = createRoute({
  method: 'put',
  path: '/{id}',
  tags: ['Roles'],
  summary: '更新角色',
  security: [{ BearerAuth: [] }],
  middleware: [guard({ permission: 'system:role:update', audit: { description: '更新角色', module: '角色管理' } })] as const,
  request: {
    params: z.object({ id: z.coerce.number() }),
    body: { content: jsonContent(updateRoleSchema), required: true },
  },
  responses: {
    ...commonErrorResponses,
    200: { content: jsonContent(apiResponse(RoleDTO)), description: '更新成功' },
    404: { content: jsonContent(ErrorResponse), description: '角色不存在' },
  },
});

rolesRouter.openapi(updateRoleRoute, async (c) => {
  const { id } = c.req.valid('param');
  const data = c.req.valid('json');
  const [role] = await db
    .update(roles)
    .set({ ...data, updatedAt: new Date() })
    .where(and(eq(roles.id, id), tenantCondition(roles, c.get('user'))))
    .returning();
  if (!role) return c.json({ code: 404, message: '角色不存在', data: null }, 404);
  return c.json({ code: 0 as const, message: '更新成功', data: toRole(role) }, 200);
});

const deleteRoute = createRoute({
  method: 'delete',
  path: '/{id}',
  tags: ['Roles'],
  summary: '删除角色',
  security: [{ BearerAuth: [] }],
  middleware: [guard({ permission: 'system:role:delete', audit: { description: '删除角色', module: '角色管理' } })] as const,
  request: { params: z.object({ id: z.coerce.number() }) },
  responses: {
    ...commonErrorResponses,
    200: { content: jsonContent(MessageResponse), description: '删除成功' },
    404: { content: jsonContent(ErrorResponse), description: '角色不存在' },
  },
});

rolesRouter.openapi(deleteRoute, async (c) => {
  const { id } = c.req.valid('param');
  const [deleted] = await db
    .delete(roles)
    .where(and(eq(roles.id, id), tenantCondition(roles, c.get('user'))))
    .returning();
  if (!deleted) return c.json({ code: 404, message: '角色不存在', data: null }, 404);
  return c.json({ code: 0 as const, message: '删除成功', data: null }, 200);
});

const assignMenusRoute = createRoute({
  method: 'put',
  path: '/{id}/menus',
  tags: ['Roles'],
  summary: '分配角色菜单',
  security: [{ BearerAuth: [] }],
  middleware: [guard({ permission: 'system:role:assign', audit: { description: '分配角色菜单', module: '角色管理' } })] as const,
  request: {
    params: z.object({ id: z.coerce.number() }),
    body: { content: jsonContent(assignRoleMenusSchema), required: true },
  },
  responses: {
    ...commonErrorResponses,
    200: { content: jsonContent(MessageResponse), description: '菜单权限已更新' },
    404: { content: jsonContent(ErrorResponse), description: '角色不存在' },
  },
});

rolesRouter.openapi(assignMenusRoute, async (c) => {
  const { id } = c.req.valid('param');
  const data = c.req.valid('json');
  const [role] = await db
    .select({ id: roles.id })
    .from(roles)
    .where(and(eq(roles.id, id), tenantCondition(roles, c.get('user'))))
    .limit(1);
  if (!role) return c.json({ code: 404, message: '角色不存在', data: null }, 404);

  await db.delete(roleMenus).where(eq(roleMenus.roleId, id));
  if (data.menuIds.length > 0) {
    await db.insert(roleMenus).values(data.menuIds.map((menuId: number) => ({ roleId: id, menuId })));
  }

  clearUserPermissionCache();
  return c.json({ code: 0 as const, message: '菜单权限已更新', data: null }, 200);
});

const getUsersRoute = createRoute({
  method: 'get',
  path: '/{id}/users',
  tags: ['Roles'],
  summary: '获取角色关联用户',
  security: [{ BearerAuth: [] }],
  middleware: [guard({ permission: 'system:role:list' })] as const,
  request: { params: z.object({ id: z.coerce.number() }) },
  responses: {
    ...commonErrorResponses,
    200: { content: jsonContent(apiResponse(z.array(UserDTO))), description: '用户列表' },
    404: { content: jsonContent(ErrorResponse), description: '角色不存在' },
  },
});

rolesRouter.openapi(getUsersRoute, async (c) => {
  const { id } = c.req.valid('param');
  const [role] = await db
    .select({ id: roles.id })
    .from(roles)
    .where(and(eq(roles.id, id), tenantCondition(roles, c.get('user'))))
    .limit(1);
  if (!role) return c.json({ code: 404, message: '角色不存在', data: null }, 404);

  const rows = await db
    .select({
      id: users.id,
      username: users.username,
      nickname: users.nickname,
      email: users.email,
      avatar: users.avatar,
      status: users.status,
      createdAt: users.createdAt,
      updatedAt: users.updatedAt,
    })
    .from(userRoles)
    .innerJoin(users, eq(userRoles.userId, users.id))
    .where(eq(userRoles.roleId, id));

  return c.json(
    {
      code: 0 as const,
      message: 'ok',
      data: rows.map((u) => ({ ...u, createdAt: u.createdAt.toISOString(), updatedAt: u.updatedAt.toISOString() })),
    },
    200,
  );
});

const assignUsersRoute = createRoute({
  method: 'put',
  path: '/{id}/users',
  tags: ['Roles'],
  summary: '分配角色用户',
  security: [{ BearerAuth: [] }],
  middleware: [guard({ permission: 'system:role:assign', audit: { description: '分配角色用户', module: '角色管理' } })] as const,
  request: {
    params: z.object({ id: z.coerce.number() }),
    body: { content: jsonContent(assignRoleUsersSchema), required: true },
  },
  responses: {
    ...commonErrorResponses,
    200: { content: jsonContent(MessageResponse), description: '用户分配已更新' },
    404: { content: jsonContent(ErrorResponse), description: '角色不存在' },
  },
});

rolesRouter.openapi(assignUsersRoute, async (c) => {
  const { id } = c.req.valid('param');
  const data = c.req.valid('json');
  const [role] = await db
    .select({ id: roles.id })
    .from(roles)
    .where(and(eq(roles.id, id), tenantCondition(roles, c.get('user'))))
    .limit(1);
  if (!role) return c.json({ code: 404, message: '角色不存在', data: null }, 404);

  await db.delete(userRoles).where(eq(userRoles.roleId, id));
  if (data.userIds.length > 0) {
    await db.insert(userRoles).values(data.userIds.map((userId: number) => ({ userId, roleId: id })));
  }

  clearUserPermissionCache();
  return c.json({ code: 0 as const, message: '用户分配已更新', data: null }, 200);
});

const exportRoute = createRoute({
  method: 'get',
  path: '/export',
  tags: ['Roles'],
  summary: '导出角色列表',
  security: [{ BearerAuth: [] }],
  middleware: [guard({ permission: 'system:role:list' })] as const,
  responses: {
    ...commonErrorResponses,
    200: {
      content: { 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': { schema: z.string() } },
      description: 'Excel 文件',
    },
  },
});

rolesRouter.openapi(exportRoute, async (c) => {
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
  c.header('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  c.header('Content-Disposition', 'attachment; filename=roles.xlsx');
  return c.body(buffer) as never;
});

export default rolesRouter;
