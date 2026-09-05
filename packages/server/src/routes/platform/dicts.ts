import { OpenAPIHono } from '@hono/zod-openapi';
import { dictContract } from '@zenith/shared/platform';
import { authMiddleware } from '../../middleware/auth';
import { guard, setAuditBeforeData } from '../../middleware/guard';
import { defineContractRoute } from '../../lib/contract-route';
import { okBody, validationHook } from '../../lib/openapi-schemas';
import {
  listDicts,
  createDict,
  updateDict,
  deleteDict,
  listDictItems,
  listDictItemsByCode,
  createDictItem,
  updateDictItem,
  deleteDictItem,
  getDictBeforeAudit,
  getDictItemBeforeAudit,
  getDict,
  getDictItem,
} from '../../services/platform/dicts.service';

const dictsRouter = new OpenAPIHono({ defaultHook: validationHook });

const read = [authMiddleware, guard({ permission: 'system:dict:list' })] as const;

const listDictsRoute = defineContractRoute(dictContract.list, {
  middleware: read,
  handler: async (c) => c.json(okBody(await listDicts(c.req.valid('query'))), 200),
});

const getDictRoute = defineContractRoute(dictContract.detail, {
  middleware: read,
  handler: async (c) => c.json(okBody(await getDict(c.req.valid('param').id)), 200),
});

const createDictRoute = defineContractRoute(dictContract.create, {
  middleware: [authMiddleware, guard({ permission: 'system:dict:create', audit: { description: '创建字典', module: '字典管理' } })],
  handler: async (c) => c.json(okBody(await createDict(c.req.valid('json')), '创建成功'), 200),
});

const updateDictRoute = defineContractRoute(dictContract.update, {
  middleware: [authMiddleware, guard({ permission: 'system:dict:update', audit: { description: '更新字典', module: '字典管理' } })],
  handler: async (c) => {
    const { id } = c.req.valid('param');
    const before = await getDictBeforeAudit(id);
    if (before) setAuditBeforeData(c, before);
    return c.json(okBody(await updateDict(id, c.req.valid('json')), '更新成功'), 200);
  },
});

const deleteDictRoute = defineContractRoute(dictContract.remove, {
  middleware: [authMiddleware, guard({ permission: 'system:dict:delete', audit: { description: '删除字典', module: '字典管理' } })],
  handler: async (c) => {
    const { id } = c.req.valid('param');
    const before = await getDictBeforeAudit(id);
    if (before) setAuditBeforeData(c, before);
    await deleteDict(id);
    return c.json(okBody(null, '删除成功'), 200);
  },
});

const listItemsRoute = defineContractRoute(dictContract.items, {
  middleware: read,
  handler: async (c) => {
    const { id } = c.req.valid('param');
    return c.json(okBody(await listDictItems(id)), 200);
  },
});

const getItemsByCodeRoute = defineContractRoute(dictContract.itemsByCode, {
  middleware: [authMiddleware],
  handler: async (c) => {
    const { code } = c.req.valid('param');
    return c.json(okBody(await listDictItemsByCode(code)), 200);
  },
});

const createItemRoute = defineContractRoute(dictContract.createItem, {
  middleware: [authMiddleware, guard({ permission: 'system:dict:item', audit: { description: '创建字典项', module: '字典管理' } })],
  handler: async (c) => {
    const { id } = c.req.valid('param');
    return c.json(okBody(await createDictItem(id, c.req.valid('json')), '创建成功'), 200);
  },
});

const getItemRoute = defineContractRoute(dictContract.itemDetail, {
  middleware: [authMiddleware, guard({ permission: 'system:dict:item' })],
  handler: async (c) => {
    const { id, itemId } = c.req.valid('param');
    return c.json(okBody(await getDictItem(id, itemId)), 200);
  },
});

const updateItemRoute = defineContractRoute(dictContract.updateItem, {
  middleware: [authMiddleware, guard({ permission: 'system:dict:item', audit: { description: '更新字典项', module: '字典管理' } })],
  handler: async (c) => {
    const { itemId } = c.req.valid('param');
    const before = await getDictItemBeforeAudit(itemId);
    if (before) setAuditBeforeData(c, before);
    return c.json(okBody(await updateDictItem(itemId, c.req.valid('json')), '更新成功'), 200);
  },
});

const deleteItemRoute = defineContractRoute(dictContract.removeItem, {
  middleware: [authMiddleware, guard({ permission: 'system:dict:item', audit: { description: '删除字典项', module: '字典管理' } })],
  handler: async (c) => {
    const { itemId } = c.req.valid('param');
    const before = await getDictItemBeforeAudit(itemId);
    if (before) setAuditBeforeData(c, before);
    await deleteDictItem(itemId);
    return c.json(okBody(null, '删除成功'), 200);
  },
});

dictsRouter.openapiRoutes([listDictsRoute, getDictRoute, createDictRoute, updateDictRoute, deleteDictRoute, listItemsRoute, getItemsByCodeRoute, getItemRoute, createItemRoute, updateItemRoute, deleteItemRoute] as const);

export default dictsRouter;
