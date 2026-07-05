import { OpenAPIHono, createRoute, defineOpenAPIRoute, z } from '@hono/zod-openapi';
import { authMiddleware } from '../../middleware/auth';
import { guard, setAuditBeforeData } from '../../middleware/guard';
import { jsonContent, validationHook, commonErrorResponses, conflictResponse, ok, okMsg, IdParam, okBody } from '../../lib/openapi-schemas';
import { MenuDTO } from '../../lib/openapi-dtos';
import {
  listUserMenuTree,
  listMenuTree,
  listMenusFlat,
  getMenu,
  createMenu,
  updateMenu,
  deleteMenu,
  getMenuBeforeAudit,
  getMenuCascadeBeforeAudit,
} from '../../services/identity/menus.service';

const menusRouter = new OpenAPIHono({ defaultHook: validationHook });

// ─── Schemas ───────────────────────────────────────────────────────────────

const createMenuSchema = z.object({
  parentId: z.coerce.number().int().default(0),
  title: z.string().min(1).max(64),
  name: z.string().max(64).optional(),
  path: z.string().max(256).optional(),
  component: z.string().max(256).optional(),
  icon: z.string().max(64).optional(),
  type: z.enum(['directory', 'menu', 'button']).default('menu'),
  permission: z.string().max(128).optional(),
  query: z.string().max(512).nullish(),
  isExternal: z.boolean().default(false),
  embed: z.boolean().default(false),
  keepAlive: z.boolean().default(false),
  sort: z.coerce.number().int().default(0),
  status: z.enum(['enabled', 'disabled']).default('enabled'),
  visible: z.boolean().default(true),
});
const updateMenuSchema = createMenuSchema.partial();

// ─── Routes ────────────────────────────────────────────────────────────────
const userMenuRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get',
    path: '/user',
    tags: ['Menus'],
    summary: '当前用户可见菜单树',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware] as const,
    responses: {
      ...commonErrorResponses,
      ...ok(z.array(MenuDTO), '菜单树'),
    },
  }),
  handler: async (c) => {
    const tree = await listUserMenuTree();
    return c.json(okBody(tree), 200);
  },
});

const listRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get',
    path: '/',
    tags: ['Menus'],
    summary: '菜单树（管理用）',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: '' })] as const,
    responses: {
      ...commonErrorResponses,
      ...ok(z.array(MenuDTO), '全量菜单树'),
    },
  }),
  handler: async (c) => {
    return c.json(okBody(await listMenuTree()), 200);
  },
});

const flatRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get',
    path: '/flat',
    tags: ['Menus'],
    summary: '平铺菜单列表',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'system:menu:list' })] as const,
    responses: {
      ...commonErrorResponses,
      ...ok(z.array(MenuDTO), '平铺菜单'),
    },
  }),
  handler: async (c) => {
    return c.json(okBody(await listMenusFlat()), 200);
  },
});

const getOneRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get', path: '/{id}', tags: ['Menus'], summary: '获取菜单详情',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'system:menu:list' })] as const,
    request: { params: IdParam },
    responses: {
      ...commonErrorResponses,
      ...ok(MenuDTO, '菜单详情'),
      404: { content: jsonContent(z.object({ message: z.string() })), description: '菜单不存在' },
    },
  }),
  handler: async (c) => c.json(okBody(await getMenu(c.req.valid('param').id)), 200),
});

const createMenuRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'post',
    path: '/',
    tags: ['Menus'],
    summary: '新增菜单',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'system:menu:create', audit: { description: '创建菜单', module: '菜单管理' } })] as const,
    request: { body: { content: jsonContent(createMenuSchema), required: true } },
    responses: {
      ...commonErrorResponses,
      ...ok(MenuDTO, '创建成功'),
    },
  }),
  handler: async (c) => {
    const data = c.req.valid('json');
    const menu = await createMenu(data);
    return c.json(okBody(menu, '创建成功'), 200);
  },
});

const updateMenuRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'put',
    path: '/{id}',
    tags: ['Menus'],
    summary: '更新菜单',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'system:menu:update', audit: { description: '更新菜单', module: '菜单管理' } })] as const,
    request: {
      params: IdParam,
      body: { content: jsonContent(updateMenuSchema), required: true },
    },
    responses: {
      ...commonErrorResponses,
      ...ok(MenuDTO, '更新成功'),
    },
  }),
  handler: async (c) => {
    const { id } = c.req.valid('param');
    const data = c.req.valid('json');
    const before = await getMenuBeforeAudit(id);
    if (before) setAuditBeforeData(c, before);
    const menu = await updateMenu(id, data);
    return c.json(okBody(menu, '更新成功'), 200);
  },
});

const deleteMenuRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'delete',
    path: '/{id}',
    tags: ['Menus'],
    summary: '删除菜单及子菜单',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'system:menu:delete', audit: { description: '删除菜单', module: '菜单管理' } })] as const,
    request: { params: IdParam },
    responses: {
      ...commonErrorResponses,
      ...conflictResponse,
      ...okMsg('删除成功'),
    },
  }),
  handler: async (c) => {
    const { id } = c.req.valid('param');
    const before = await getMenuCascadeBeforeAudit(id);
    if (before) setAuditBeforeData(c, before);
    await deleteMenu(id);
    return c.json(okBody(null, '删除成功'), 200);
  },
});

menusRouter.openapiRoutes([userMenuRoute, listRoute, flatRoute, getOneRoute, createMenuRoute, updateMenuRoute, deleteMenuRoute] as const);

export default menusRouter;
