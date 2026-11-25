import { OpenAPIHono } from '@hono/zod-openapi';
import { menuContract } from '@zenith/shared/identity';
import { setAuditBeforeData } from '../../middleware/guard';
import { defineContractRoute } from '../../lib/contract-route';
import { validationHook, conflictResponse, okBody } from '../../lib/openapi-schemas';
import {
  listUserMenuTree,
  listMenuPaths,
  listMenuTree,
  listMenusFlat,
  getMenu,
  createMenu,
  updateMenu,
  reorderMenus,
  deleteMenu,
  getMenuBeforeAudit,
  getMenuCascadeBeforeAudit,
} from '../../services/identity/menus.service';
import { mountCrud } from '../_crud';

const menusRouter = new OpenAPIHono({ defaultHook: validationHook });

const userMenuRoute = defineContractRoute(menuContract.userTree, {
  handler: async (c) => c.json(okBody(await listUserMenuTree()), 200),
});

const pathsRoute = defineContractRoute(menuContract.paths, {
  handler: async (c) => c.json(okBody(await listMenuPaths()), 200),
});

const listRoute = defineContractRoute(menuContract.tree, {
  handler: async (c) => c.json(okBody(await listMenuTree()), 200),
});

const flatRoute = defineContractRoute(menuContract.flat, {
  handler: async (c) => c.json(okBody(await listMenusFlat()), 200),
});
const createMenuRoute = defineContractRoute(menuContract.create, {
  handler: async (c) => c.json(okBody(await createMenu(c.req.valid('json')), '创建成功'), 200),
});

const updateMenuRoute = defineContractRoute(menuContract.update, {
  handler: async (c) => {
    const { id } = c.req.valid('param');
    const before = await getMenuBeforeAudit(id);
    if (before) setAuditBeforeData(c, before);
    return c.json(okBody(await updateMenu(id, c.req.valid('json')), '更新成功'), 200);
  },
});

const reorderMenuRoute = defineContractRoute(menuContract.reorder, {
  handler: async (c) => {
    const data = c.req.valid('json');
    return c.json(okBody(await reorderMenus(data.parentId, data.orderedIds), '排序已更新'), 200);
  },
});

const deleteMenuRoute = defineContractRoute(menuContract.remove, {
  responses: conflictResponse,
  handler: async (c) => {
    const { id } = c.req.valid('param');
    const before = await getMenuCascadeBeforeAudit(id);
    if (before) setAuditBeforeData(c, before);
    await deleteMenu(id);
    return c.json(okBody(null, '删除成功'), 200);
  },
});

mountCrud(menusRouter, menuContract,
  { get: getMenu },
  { exclude: ['create', 'update', 'remove'] },
  [userMenuRoute, pathsRoute, listRoute, flatRoute, createMenuRoute, updateMenuRoute, reorderMenuRoute, deleteMenuRoute],
);

export default menusRouter;
