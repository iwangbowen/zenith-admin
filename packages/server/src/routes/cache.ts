import { OpenAPIHono, createRoute, defineOpenAPIRoute, z } from '@hono/zod-openapi';
import { authMiddleware } from '../middleware/auth';
import { guard } from '../middleware/guard';
import { validationHook, okBody } from '../lib/openapi-schemas';
import { CacheItemDTO } from '../lib/openapi-dtos';
import { listCache, deleteCacheKey, deleteCacheByCategory, deleteAllCache } from '../services/cache.service';

const cacheRouter = new OpenAPIHono({ defaultHook: validationHook });

const GenericResponse = z.object({ code: z.number(), message: z.string(), data: z.unknown() });
const CacheListResponse = z.object({ code: z.literal(0), message: z.string(), data: z.object({ list: z.array(CacheItemDTO), total: z.number() }) });
const CountResponse = z.object({ code: z.literal(0), message: z.string(), data: z.object({ count: z.number() }) });

const listRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get', path: '/', tags: ['Cache'], summary: '列出所有缓存 key（可按关键词过滤）',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'system:cache:list' })] as const,
    request: { query: z.object({ keyword: z.string().optional().openapi({ example: 'session' }) }) },
    responses: { 200: { content: { 'application/json': { schema: CacheListResponse } }, description: '缓存列表' } },
  }),
  handler: async (c) => c.json(okBody(await listCache(c.req.valid('query').keyword), 'success'), 200),
});

const deleteOneRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'delete', path: '/', tags: ['Cache'], summary: '删除指定 key',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'system:cache:delete', audit: { module: '缓存管理', description: '删除缓存' } })] as const,
    request: { body: { content: { 'application/json': { schema: z.object({ key: z.string().openapi({ example: 'zenith:session:abc' }) }) } } } },
    responses: {
      200: { content: { 'application/json': { schema: GenericResponse } }, description: '删除成功' },
      400: { content: { 'application/json': { schema: GenericResponse } }, description: '参数错误' },
      403: { content: { 'application/json': { schema: GenericResponse } }, description: '命名空间不匹配' },
      404: { content: { 'application/json': { schema: GenericResponse } }, description: 'key 不存在' },
    },
  }),
  handler: async (c) => {
    await deleteCacheKey(c.req.valid('json').key);
    return c.json(okBody(null, '删除成功'), 200);
  },
});

const deleteByCategoryRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'delete', path: '/by-category', tags: ['Cache'], summary: '按分类批量删除',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'system:cache:delete', audit: { module: '缓存管理', description: '删除分类缓存' } })] as const,
    request: { body: { content: { 'application/json': { schema: z.object({ segment: z.string().openapi({ example: 'session' }) }) } } } },
    responses: {
      200: { content: { 'application/json': { schema: CountResponse } }, description: '删除成功' },
      400: { content: { 'application/json': { schema: GenericResponse } }, description: '参数错误' },
    },
  }),
  handler: async (c) => {
    const count = await deleteCacheByCategory(c.req.valid('json').segment);
    return c.json(okBody({ count }, `已删除 ${count} 条缓存`), 200);
  },
});

const deleteAllRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'delete', path: '/all', tags: ['Cache'], summary: '清空当前命名空间所有缓存',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'system:cache:delete', audit: { module: '缓存管理', description: '清空所有缓存' } })] as const,
    responses: { 200: { content: { 'application/json': { schema: CountResponse } }, description: '清空成功' } },
  }),
  handler: async (c) => {
    const count = await deleteAllCache();
    return c.json(okBody({ count }, `已清空 ${count} 条缓存`), 200);
  },
});

cacheRouter.openapiRoutes([listRoute, deleteOneRoute, deleteByCategoryRoute, deleteAllRoute] as const);

export default cacheRouter;
