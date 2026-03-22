import { Hono } from 'hono';
import { eq } from 'drizzle-orm';
import { db } from '../db';
import { roles, roleMenus } from '../db/schema';
import { createRoleSchema, updateRoleSchema, assignRoleMenusSchema } from '@zenith/shared';
import { authMiddleware } from '../middleware/auth';

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
rolesRouter.get('/', async (c) => {
  const keyword = c.req.query('keyword') ?? '';
  const list = await db
    .select()
    .from(roles)
    .orderBy(roles.id);

  const filtered = keyword
    ? list.filter((r) => r.name.includes(keyword) || r.code.includes(keyword))
    : list;

  return c.json({
    code: 0,
    message: 'ok',
    data: filtered.map((r) => toRole(r)),
  });
});

// 获取单个角色（含 menuIds）
rolesRouter.get('/:id', async (c) => {
  const id = Number(c.req.param('id'));
  const [role] = await db.select().from(roles).where(eq(roles.id, id)).limit(1);
  if (!role) return c.json({ code: 404, message: '角色不存在', data: null }, 404);

  const assignments = await db.select({ menuId: roleMenus.menuId }).from(roleMenus).where(eq(roleMenus.roleId, id));
  const menuIds = assignments.map((a) => a.menuId);
  return c.json({ code: 0, message: 'ok', data: toRole(role, menuIds) });
});

// 新增角色
rolesRouter.post('/', async (c) => {
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
rolesRouter.put('/:id', async (c) => {
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
rolesRouter.delete('/:id', async (c) => {
  const id = Number(c.req.param('id'));
  const [deleted] = await db.delete(roles).where(eq(roles.id, id)).returning();
  if (!deleted) return c.json({ code: 404, message: '角色不存在', data: null }, 404);
  return c.json({ code: 0, message: '删除成功', data: null });
});

// 分配角色菜单
rolesRouter.put('/:id/menus', async (c) => {
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

  return c.json({ code: 0, message: '菜单权限已更新', data: null });
});

export default rolesRouter;
