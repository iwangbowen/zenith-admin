import { OpenAPIHono, createRoute, defineOpenAPIRoute, z } from '@hono/zod-openapi';
import { authMiddleware } from '../middleware/auth';
import { guard, setAuditBeforeData } from '../middleware/guard';
import { PaginationQuery, jsonContent, validationHook, commonErrorResponses, ok, okPaginated, okMsg, IdParam, okBody, okExcel, excelBody } from '../lib/openapi-schemas';
import { createDictSchema, updateDictSchema, createDictItemSchema, updateDictItemSchema } from '@zenith/shared';
import { DictDTO, DictItemDTO } from '../lib/openapi-dtos';
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
  exportDicts,
  getDictBeforeAudit,
  getDictItemBeforeAudit,
} from '../services/dicts.service';

const dictsRouter = new OpenAPIHono({ defaultHook: validationHook });

const listDictsRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get', path: '/', tags: ['Dicts'], summary: '字典列表',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'system:dict:list' })] as const,
    request: {
      query: PaginationQuery.extend({
        keyword: z.string().optional(),
        status: z.enum(['enabled', 'disabled']).optional(),
        startDate: z.string().optional(),
        endDate: z.string().optional(),
      }),
    },
    responses: { ...commonErrorResponses, ...okPaginated(DictDTO, '字典列表') },
  }),
  handler: async (c) => c.json(okBody(await listDicts(c.req.valid('query'))), 200),
});

const createDictRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'post', path: '/', tags: ['Dicts'], summary: '创建字典',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'system:dict:create', audit: { description: '创建字典', module: '字典管理' } })] as const,
    request: { body: { content: jsonContent(createDictSchema), required: true } },
    responses: { ...commonErrorResponses, ...ok(DictDTO, '创建成功') },
  }),
  handler: async (c) => c.json(okBody(await createDict(c.req.valid('json')), '创建成功'), 200),
});

const updateDictRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'put', path: '/{id}', tags: ['Dicts'], summary: '更新字典',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'system:dict:update', audit: { description: '更新字典', module: '字典管理' } })] as const,
    request: { params: IdParam, body: { content: jsonContent(updateDictSchema), required: true } },
    responses: { ...commonErrorResponses, ...ok(DictDTO, '更新成功') },
  }),
  handler: async (c) => {
    const { id } = c.req.valid('param');
    const before = await getDictBeforeAudit(id);
    if (before) setAuditBeforeData(c, before);
    return c.json(okBody(await updateDict(id, c.req.valid('json')), '更新成功'), 200);
  },
});

const deleteDictRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'delete', path: '/{id}', tags: ['Dicts'], summary: '删除字典',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'system:dict:delete', audit: { description: '删除字典', module: '字典管理' } })] as const,
    request: { params: IdParam },
    responses: { ...commonErrorResponses, ...okMsg('删除成功') },
  }),
  handler: async (c) => {
    const { id } = c.req.valid('param');
    const before = await getDictBeforeAudit(id);
    if (before) setAuditBeforeData(c, before);
    await deleteDict(id);
    return c.json(okBody(null, '删除成功'), 200);
  },
});

const listItemsRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get', path: '/{id}/items', tags: ['Dicts'], summary: '获取字典下所有字典项',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'system:dict:list' })] as const,
    request: { params: IdParam },
    responses: { ...commonErrorResponses, ...ok(z.array(DictItemDTO), '字典项列表') },
  }),
  handler: async (c) => {
    const { id } = c.req.valid('param');
    return c.json(okBody(await listDictItems(id)), 200);
  },
});

const getItemsByCodeRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get', path: '/code/{code}/items', tags: ['Dicts'], summary: '通过字典编码获取字典项（供前端使用）',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware] as const,
    request: { params: z.object({ code: z.string().openapi({ param: { name: 'code', in: 'path' }, example: 'sys_status', description: '字典编码' }) }) },
    responses: { ...commonErrorResponses, ...ok(z.array(DictItemDTO), '字典项列表') },
  }),
  handler: async (c) => {
    const { code } = c.req.valid('param');
    return c.json(okBody(await listDictItemsByCode(code)), 200);
  },
});

const createItemRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'post', path: '/{id}/items', tags: ['Dicts'], summary: '创建字典项',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'system:dict:item', audit: { description: '创建字典项', module: '字典管理' } })] as const,
    request: { params: IdParam, body: { content: jsonContent(createDictItemSchema), required: true } },
    responses: { ...commonErrorResponses, ...ok(DictItemDTO, '创建成功') },
  }),
  handler: async (c) => {
    const { id } = c.req.valid('param');
    return c.json(okBody(await createDictItem(id, c.req.valid('json')), '创建成功'), 200);
  },
});

const updateItemRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'put', path: '/{id}/items/{itemId}', tags: ['Dicts'], summary: '更新字典项',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'system:dict:item', audit: { description: '更新字典项', module: '字典管理' } })] as const,
    request: {
      params: z.object({
        id: z.coerce.number().openapi({ param: { name: 'id', in: 'path' }, example: 1, description: '字典 ID' }),
        itemId: z.coerce.number().openapi({ param: { name: 'itemId', in: 'path' }, example: 1, description: '字典项 ID' }),
      }),
      body: { content: jsonContent(updateDictItemSchema), required: true },
    },
    responses: { ...commonErrorResponses, ...ok(DictItemDTO, '更新成功') },
  }),
  handler: async (c) => {
    const { itemId } = c.req.valid('param');
    const before = await getDictItemBeforeAudit(itemId);
    if (before) setAuditBeforeData(c, before);
    return c.json(okBody(await updateDictItem(itemId, c.req.valid('json')), '更新成功'), 200);
  },
});

const deleteItemRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'delete', path: '/{id}/items/{itemId}', tags: ['Dicts'], summary: '删除字典项',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'system:dict:item', audit: { description: '删除字典项', module: '字典管理' } })] as const,
    request: {
      params: z.object({
        id: z.coerce.number().openapi({ param: { name: 'id', in: 'path' }, example: 1, description: '字典 ID' }),
        itemId: z.coerce.number().openapi({ param: { name: 'itemId', in: 'path' }, example: 1, description: '字典项 ID' }),
      }),
    },
    responses: { ...commonErrorResponses, ...okMsg('删除成功') },
  }),
  handler: async (c) => {
    const { itemId } = c.req.valid('param');
    const before = await getDictItemBeforeAudit(itemId);
    if (before) setAuditBeforeData(c, before);
    await deleteDictItem(itemId);
    return c.json(okBody(null, '删除成功'), 200);
  },
});

const exportRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get', path: '/export', tags: ['Dicts'], summary: '导出字典 Excel',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'system:dict:list' })] as const,
    responses: { ...commonErrorResponses, ...okExcel('Excel 文件') },
  }),
  handler: async (c) => {
    const { buffer, filename } = await exportDicts();
    return excelBody(c, buffer, filename);
  },
});

dictsRouter.openapiRoutes([listDictsRoute, createDictRoute, updateDictRoute, deleteDictRoute, listItemsRoute, getItemsByCodeRoute, createItemRoute, updateItemRoute, deleteItemRoute, exportRoute] as const);

export default dictsRouter;
