import { Hono } from 'hono';
import { eq, and, like, or, gte, lte } from 'drizzle-orm';
import { db } from '../db';
import { roles, roleMenus, userRoles, users } from '../db/schema';
import { createRoleSchema, updateRoleSchema, assignRoleMenusSchema, assignRoleUsersSchema } from '@zenith/shared';
import { authMiddleware } from '../middleware/auth';
import { guard } from '../middleware/guard';
import { clearUserPermissionCache } from '../lib/permissions';

const rolesRouter = new Hono();
rolesRouter.use('*', authMiddleware);

function toRole(row: typeof roles.$inferSelect, menuIds?: number[]) {
  return {
    ...row,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    ...(menuIds === undefined ? {} : { menuIds }),
  };
}

// 角色列表
rolesRouter.get('/', guard({ permission: 'system:role:list' }), async (c) => {
  const keyword = c.req.query('keyword') ?? '';
  const status = c.req.query('status');
  const startTime = c.req.query('startTime');
  const endTime = c.req.query('endTime');

  const conditions = [];
  if (keyword) {
    conditions.push(or(like(roles.name, `%${keyword}%`), like(roles.code, `%${keyword}%`)));
  }
  if (status && (status === 'active' || status === 'disabled')) {
    conditions.push(eq(roles.status, status));
  }
  if (startTime) {
    conditions.push(gte(roles.createdAt, new Date(startTime)));
  }
  if (endTime) {
    conditions.push(lte(roles.createdAt, new Date(endTime)));
  }

  const where = conditions.length > 0 ? and(...conditions) : undefined;
  const list = await db
    .select()
    .from(roles)
    .where(where)
    .orderBy(roles.id);

  return c.json({
    code: 0,
    message: 'ok',
    data: list.map((r) => toRole(r)),
  });
});

// 获取单个角色（含 menuIds）
rolesRouter.get('/:id', guard({ permission: 'system:role:list' }), async (c) => {
  const id = Number(c.req.param('id'));
  const [role] = await db.select().from(roles).where(eq(roles.id, id)).limit(1);
  if (!role) return c.json({ code: 404, message: '角色不存在', data: null }, 404);

  const assignments = await db.select({ menuId: roleMenus.menuId }).from(roleMenus).where(eq(roleMenus.roleId, id));
  const menuIds = assignments.map((a) => a.menuId);
  return c.json({ code: 0, message: 'ok', data: toRole(role, menuIds) });
});

// 新增角色
rolesRouter.post('/', guard({ permission: 'system:role:create', audit: { description: '创建角色', module: '角色管理' } }), async (c) => {
  const body = await c.req.json();
  const result = createRoleSchema.safeParse(body);
  if (!result.success) {
    return c.json({ code: 400, message: result.error.issues[0].message, data: null }, 400);
  }
  try {
    const [role] = await db.insert(roles).values(result.data).returning();
    return c.json({ code: 0, message: '创建成功', data: toRole(role) });
  } catch (err: unknown) {
    if ((err as { code?: string }).code === '23505') {
      return c.json({ code: 400, message: '角色编码已存在', data: null }, 400);
    }
    throw err;
  }
});

// 更新角色
rolesRouter.put('/:id', guard({ permission: 'system:role:update', audit: { description: '更新角色', module: '角色管理' } }), async (c) => {
  const id = Number(c.req.param('id'));
  const body = await c.req.json();
  const result = updateRoleSchema.safeParse(body);
  if (!result.success) {
    return c.json({ code: 400, message: result.error.issues[0].message, data: null }, 400);
  }
  const [role] = await db
    .update(roles)
    .set({ ...result.data, updatedAt: new Date() })
    .where(eq(roles.id, id))
    .returning();
  if (!role) return c.json({ code: 404, message: '角色不存在', data: null }, 404);
  return c.json({ code: 0, message: '更新成功', data: toRole(role) });
});

// 删除角色
rolesRouter.delete('/:id', guard({ permission: 'system:role:delete', audit: { description: '删除角色', module: '角色管理' } }), async (c) => {
  const id = Number(c.req.param('id'));
  const [deleted] = await db.delete(roles).where(eq(roles.id, id)).returning();
  if (!deleted) return c.json({ code: 404, message: '角色不存在', data: null }, 404);
  return c.json({ code: 0, message: '删除成功', data: null });
});

// 分配角色菜单
rolesRouter.put('/:id/menus', guard({ permission: 'system:role:assign', audit: { description: '分配角色菜单', module: '角色管理' } }), async (c) => {
  const id = Number(c.req.param('id'));
  const body = await c.req.json();
  const result = assignRoleMenusSchema.safeParse(body);
  if (!result.success) {
    return c.json({ code: 400, message: result.error.issues[0].message, data: null }, 400);
  }

  const [role] = await db.select({ id: roles.id }).from(roles).where(eq(roles.id, id)).limit(1);
  if (!role) return c.json({ code: 404, message: '角色不存在', data: null }, 404);

  // 先删除旧关联，再批量插入
  await db.delete(roleMenus).where(eq(roleMenus.roleId, id));
  if (result.data.menuIds.length > 0) {
    await db.insert(roleMenus).values(result.data.menuIds.map((menuId) => ({ roleId: id, menuId })));
  }

  // Clear permission cache for all users since role menus changed
  clearUserPermissionCache();

  return c.json({ code: 0, message: '菜单权限已更新', data: null });
});

rolesRouter.get('/:id/users', guard({ permission: 'system:role:list' }), async (c) => {
  const id = Number(c.req.param('id'));
  const [role] = await db.select({ id: roles.id }).from(roles).where(eq(roles.id, id)).limit(1);
  if (!role) return c.json({ code: 404, message: '角色不存在', data: null }, 404);

  const rows = await db
    .select({ id: users.id, username: users.username, nickname: users.nickname, email: users.email, avatar: users.avatar, status: users.status, createdAt: users.createdAt, updatedAt: users.updatedAt })
    .from(userRoles)
    .innerJoin(users, eq(userRoles.userId, users.id))
    .where(eq(userRoles.roleId, id));

  return c.json({
    code: 0,
    message: 'ok',
    data: rows.map((u) => ({ ...u, createdAt: u.createdAt.toISOString(), updatedAt: u.updatedAt.toISOString() })),
  });
});

// 设置角色关联的用户
rolesRouter.put('/:id/users', guard({ permission: 'system:role:assign', audit: { description: '分配角色用户', module: '角色管理' } }), async (c) => {
  const id = Number(c.req.param('id'));
  const body = await c.req.json();
  const result = assignRoleUsersSchema.safeParse(body);
  if (!result.success) {
    return c.json({ code: 400, message: result.error.issues[0].message, data: null }, 400);
  }

  const [role] = await db.select({ id: roles.id }).from(roles).where(eq(roles.id, id)).limit(1);
  if (!role) return c.json({ code: 404, message: '角色不存在', data: null }, 404);

  await db.delete(userRoles).where(eq(userRoles.roleId, id));
  if (result.data.userIds.length > 0) {
    await db.insert(userRoles).values(result.data.userIds.map((userId) => ({ userId, roleId: id })));
  }

  // Clear permission cache for affected users
  clearUserPermissionCache();

  return c.json({ code: 0, message: '用户分配已更新', data: null });
});

export default rolesRouter;
