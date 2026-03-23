import { Hono } from 'hono';
import { eq, and, asc } from 'drizzle-orm';
import { db } from '../db';
import { menus } from '../db/schema';
import { createMenuSchema, updateMenuSchema } from '@zenith/shared';
import { authMiddleware } from '../middleware/auth';
import { auditLog } from '../middleware/audit';
import type { Menu } from '@zenith/shared';

const menusRouter = new Hono();
menusRouter.use('*', authMiddleware);

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

// 获取菜单树（全部）
menusRouter.get('/', async (c) => {
  const list = await db.select().from(menus).orderBy(asc(menus.sort), asc(menus.id));
  return c.json({ code: 0, message: 'ok', data: buildTree(list.map(toMenu)) });
});

// 获取平铺列表（用于角色分配菜单时展示）
menusRouter.get('/flat', async (c) => {
  const list = await db.select().from(menus).orderBy(asc(menus.sort), asc(menus.id));
  return c.json({ code: 0, message: 'ok', data: list.map(toMenu) });
});

// 新增菜单
menusRouter.post('/', auditLog({ description: '创建菜单', module: '菜单管理' }), async (c) => {
  const body = await c.req.json();
  const result = createMenuSchema.safeParse(body);
  if (!result.success) {
    return c.json({ code: 400, message: result.error.issues[0].message, data: null }, 400);
  }
  const [menu] = await db.insert(menus).values(result.data).returning();
  return c.json({ code: 0, message: '创建成功', data: toMenu(menu) });
});

// 更新菜单
menusRouter.put('/:id', auditLog({ description: '更新菜单', module: '菜单管理' }), async (c) => {
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
menusRouter.delete('/:id', auditLog({ description: '删除菜单', module: '菜单管理' }), async (c) => {
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
