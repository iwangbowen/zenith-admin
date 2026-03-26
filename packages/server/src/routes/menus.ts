import { Hono } from 'hono';
import { eq, and, asc } from 'drizzle-orm';
import { db } from '../db';
import { menus } from '../db/schema';
import { createMenuSchema, updateMenuSchema } from '@zenith/shared';
import { authMiddleware } from '../middleware/auth';
import { guard } from '../middleware/guard';
import { isSuperAdmin, getUserMenuIds } from '../lib/permissions';
import type { JwtPayload } from '../middleware/auth';
import type { Menu } from '@zenith/shared';

const menusRouter = new Hono();
menusRouter.use('*', authMiddleware);

function getUser(c: { get: (key: 'user') => unknown }): JwtPayload {
  return c.get('user') as JwtPayload;
}

function toMenu(row: typeof menus.$inferSelect): Omit<Menu, 'children'> {
  return {
    id: row.id,
    parentId: row.parentId,
    title: row.title,
    name: row.name ?? undefined,
    path: row.path ?? undefined,
    component: row.component ?? undefined,
    icon: row.icon ?? undefined,
    type: row.type,
    permission: row.permission ?? undefined,
    sort: row.sort,
    status: row.status,
    visible: row.visible,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

// 将平铺列表转为树形结构
function buildTree(list: Omit<Menu, 'children'>[]): Menu[] {
  const map = new Map<number, Menu>();
  list.forEach((item) => map.set(item.id, { ...item }));
  const roots: Menu[] = [];
  map.forEach((node) => {
    if (node.parentId === 0) {
      roots.push(node);
    } else {
      const parent = map.get(node.parentId);
      if (parent) {
        parent.children = parent.children ?? [];
        parent.children.push(node);
      } else {
        roots.push(node);
      }
    }
  });
  const sortNodes = (nodes: Menu[]) => {
    nodes.sort((a, b) => a.sort - b.sort);
    nodes.forEach((n) => n.children && sortNodes(n.children));
  };
  sortNodes(roots);
  return roots;
}

// 获取当前用户有权限的菜单树
menusRouter.get('/user', async (c) => {
  const user = getUser(c);
  const allMenus = await db.select().from(menus).orderBy(asc(menus.sort), asc(menus.id));

  if (isSuperAdmin(user.roles)) {
    return c.json({ code: 0, message: 'ok', data: buildTree(allMenus.map(toMenu)) });
  }

  const allowedMenuIds = new Set(await getUserMenuIds(user.userId));
  // Include parent directories that are ancestors of allowed menus
  const idToMenu = new Map(allMenus.map((m) => [m.id, m]));
  for (const id of new Set(allowedMenuIds)) {
    let current = idToMenu.get(id);
    while (current && current.parentId !== 0) {
      if (allowedMenuIds.has(current.parentId)) break;
      allowedMenuIds.add(current.parentId);
      current = idToMenu.get(current.parentId);
    }
  }

  // 始终下发内置隐藏菜单（visible=false），所有登录用户都需要它们的标题/面包屑信息
  const filtered = allMenus.filter((m) => allowedMenuIds.has(m.id) || !m.visible);
  return c.json({ code: 0, message: 'ok', data: buildTree(filtered.map(toMenu)) });
});

// 获取菜单树（全部，管理用）
menusRouter.get('/', guard({ permission: 'system:menu:list' }), async (c) => {
  const list = await db.select().from(menus).orderBy(asc(menus.sort), asc(menus.id));
  return c.json({ code: 0, message: 'ok', data: buildTree(list.map(toMenu)) });
});

// 获取平铺列表（用于角色分配菜单时展示）
menusRouter.get('/flat', guard({ permission: 'system:menu:list' }), async (c) => {
  const list = await db.select().from(menus).orderBy(asc(menus.sort), asc(menus.id));
  return c.json({ code: 0, message: 'ok', data: list.map(toMenu) });
});

// 新增菜单
menusRouter.post('/', guard({ permission: 'system:menu:create', audit: { description: '创建菜单', module: '菜单管理' } }), async (c) => {
  const body = await c.req.json();
  const result = createMenuSchema.safeParse(body);
  if (!result.success) {
    return c.json({ code: 400, message: result.error.issues[0].message, data: null }, 400);
  }
  const [menu] = await db.insert(menus).values(result.data).returning();
  return c.json({ code: 0, message: '创建成功', data: toMenu(menu) });
});

// 更新菜单
menusRouter.put('/:id', guard({ permission: 'system:menu:update', audit: { description: '更新菜单', module: '菜单管理' } }), async (c) => {
  const id = Number(c.req.param('id'));
  const body = await c.req.json();
  const result = updateMenuSchema.safeParse(body);
  if (!result.success) {
    return c.json({ code: 400, message: result.error.issues[0].message, data: null }, 400);
  }
  const [menu] = await db
    .update(menus)
    .set({ ...result.data, updatedAt: new Date() })
    .where(eq(menus.id, id))
    .returning();
  if (!menu) return c.json({ code: 404, message: '菜单不存在', data: null }, 404);
  return c.json({ code: 0, message: '更新成功', data: toMenu(menu) });
});

// 删除菜单（同时删除子菜单）
menusRouter.delete('/:id', guard({ permission: 'system:menu:delete', audit: { description: '删除菜单', module: '菜单管理' } }), async (c) => {
  const id = Number(c.req.param('id'));
  // 收集所有子孙节点
  const all = await db.select({ id: menus.id, parentId: menus.parentId }).from(menus);
  const toDelete = new Set<number>();
  const queue = [id];
  while (queue.length) {
    const cur = queue.shift()!;
    toDelete.add(cur);
    all.filter((m) => m.parentId === cur).forEach((m) => queue.push(m.id));
  }
  for (const mid of toDelete) {
    await db.delete(menus).where(and(eq(menus.id, mid)));
  }
  return c.json({ code: 0, message: '删除成功', data: null });
});

export default menusRouter;
