import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi';
import { eq, and, asc } from 'drizzle-orm';
import { db } from '../db';
import { menus } from '../db/schema';
import { authMiddleware } from '../middleware/auth';
import { guard } from '../middleware/guard';
import { isSuperAdmin, getUserMenuIds } from '../lib/permissions';
import type { AuthEnv } from '../middleware/auth';
import type { Menu } from '@zenith/shared';
import { apiResponse, ErrorResponse, MessageResponse, jsonContent, validationHook, commonErrorResponses } from '../lib/openapi-schemas';

const menusRouter = new OpenAPIHono<AuthEnv>({ defaultHook: validationHook });
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

// ─── Schemas ───────────────────────────────────────────────────────────────
const MenuDTO = z.looseObject({}).openapi('Menu');
const createMenuSchema = z.object({
  parentId: z.coerce.number().int().default(0),
  title: z.string().min(1).max(64),
  name: z.string().max(64).optional(),
  path: z.string().max(256).optional(),
  component: z.string().max(256).optional(),
  icon: z.string().max(64).optional(),
  type: z.enum(['directory', 'menu', 'button']).default('menu'),
  permission: z.string().max(128).optional(),
  sort: z.coerce.number().int().default(0),
  status: z.enum(['active', 'disabled']).default('active'),
  visible: z.boolean().default(true),
});
const updateMenuSchema = createMenuSchema.partial();

// ─── Routes ────────────────────────────────────────────────────────────────
const userMenuRoute = createRoute({
  method: 'get',
  path: '/user',
  tags: ['Menus'],
  summary: '当前用户可见菜单树',
  security: [{ BearerAuth: [] }],
  responses: {
    ...commonErrorResponses,
    200: { content: jsonContent(apiResponse(z.array(MenuDTO))), description: '菜单树' },
  },
});

menusRouter.openapi(userMenuRoute, async (c) => {
  const user = c.get('user');
  const allMenus = await db.select().from(menus).orderBy(asc(menus.sort), asc(menus.id));

  if (isSuperAdmin(user.roles)) {
    return c.json({ code: 0 as const, message: 'ok', data: buildTree(allMenus.map(toMenu)) }, 200);
  }

  const allowedMenuIds = new Set(await getUserMenuIds(user.userId));
  const idToMenu = new Map(allMenus.map((m) => [m.id, m]));
  for (const id of new Set(allowedMenuIds)) {
    let current = idToMenu.get(id);
    while (current && current.parentId !== 0) {
      if (allowedMenuIds.has(current.parentId)) break;
      allowedMenuIds.add(current.parentId);
      current = idToMenu.get(current.parentId);
    }
  }

  const filtered = allMenus.filter((m) => allowedMenuIds.has(m.id) || !m.visible);
  return c.json({ code: 0 as const, message: 'ok', data: buildTree(filtered.map(toMenu)) }, 200);
});

const listRoute = createRoute({
  method: 'get',
  path: '/',
  tags: ['Menus'],
  summary: '菜单树（管理用）',
  security: [{ BearerAuth: [] }],
  middleware: [guard({ permission: 'system:menu:list' })] as const,
  responses: {
    ...commonErrorResponses,
    200: { content: jsonContent(apiResponse(z.array(MenuDTO))), description: '全量菜单树' },
  },
});

menusRouter.openapi(listRoute, async (c) => {
  const list = await db.select().from(menus).orderBy(asc(menus.sort), asc(menus.id));
  return c.json({ code: 0 as const, message: 'ok', data: buildTree(list.map(toMenu)) }, 200);
});

const flatRoute = createRoute({
  method: 'get',
  path: '/flat',
  tags: ['Menus'],
  summary: '平铺菜单列表',
  security: [{ BearerAuth: [] }],
  middleware: [guard({ permission: 'system:menu:list' })] as const,
  responses: {
    ...commonErrorResponses,
    200: { content: jsonContent(apiResponse(z.array(MenuDTO))), description: '平铺菜单' },
  },
});

menusRouter.openapi(flatRoute, async (c) => {
  const list = await db.select().from(menus).orderBy(asc(menus.sort), asc(menus.id));
  return c.json({ code: 0 as const, message: 'ok', data: list.map(toMenu) }, 200);
});

const createMenuRoute = createRoute({
  method: 'post',
  path: '/',
  tags: ['Menus'],
  summary: '新增菜单',
  security: [{ BearerAuth: [] }],
  middleware: [guard({ permission: 'system:menu:create', audit: { description: '创建菜单', module: '菜单管理' } })] as const,
  request: { body: { content: jsonContent(createMenuSchema), required: true } },
  responses: {
    ...commonErrorResponses,
    200: { content: jsonContent(apiResponse(MenuDTO)), description: '创建成功' },
  },
});

menusRouter.openapi(createMenuRoute, async (c) => {
  const data = c.req.valid('json');
  const [menu] = await db.insert(menus).values(data).returning();
  return c.json({ code: 0 as const, message: '创建成功', data: toMenu(menu) }, 200);
});

const updateMenuRoute = createRoute({
  method: 'put',
  path: '/{id}',
  tags: ['Menus'],
  summary: '更新菜单',
  security: [{ BearerAuth: [] }],
  middleware: [guard({ permission: 'system:menu:update', audit: { description: '更新菜单', module: '菜单管理' } })] as const,
  request: {
    params: z.object({ id: z.coerce.number() }),
    body: { content: jsonContent(updateMenuSchema), required: true },
  },
  responses: {
    ...commonErrorResponses,
    200: { content: jsonContent(apiResponse(MenuDTO)), description: '更新成功' },
    404: { content: jsonContent(ErrorResponse), description: '菜单不存在' },
  },
});

menusRouter.openapi(updateMenuRoute, async (c) => {
  const { id } = c.req.valid('param');
  const data = c.req.valid('json');
  const [menu] = await db
    .update(menus)
    .set({ ...data, updatedAt: new Date() })
    .where(eq(menus.id, id))
    .returning();
  if (!menu) return c.json({ code: 404, message: '菜单不存在', data: null }, 404);
  return c.json({ code: 0 as const, message: '更新成功', data: toMenu(menu) }, 200);
});

const deleteMenuRoute = createRoute({
  method: 'delete',
  path: '/{id}',
  tags: ['Menus'],
  summary: '删除菜单及子菜单',
  security: [{ BearerAuth: [] }],
  middleware: [guard({ permission: 'system:menu:delete', audit: { description: '删除菜单', module: '菜单管理' } })] as const,
  request: { params: z.object({ id: z.coerce.number() }) },
  responses: {
    ...commonErrorResponses,
    200: { content: jsonContent(MessageResponse), description: '删除成功' },
  },
});

menusRouter.openapi(deleteMenuRoute, async (c) => {
  const { id } = c.req.valid('param');
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
  return c.json({ code: 0 as const, message: '删除成功', data: null }, 200);
});

export default menusRouter;
