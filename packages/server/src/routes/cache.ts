import { OpenAPIHono, createRoute, defineOpenAPIRoute, z } from '@hono/zod-openapi';
import { authMiddleware } from '../middleware/auth';
import { guard, setAuditBeforeData } from '../middleware/guard';
import { validationHook, okBody } from '../lib/openapi-schemas';
import { CacheItemDTO, CacheOverviewDTO } from '../lib/openapi-dtos';
import { getCacheList, deleteCacheKey, deleteCacheByCategory, deleteAllCache, getCacheBeforeAudit, getCachesByCategoryBeforeAudit, getAllCachesBeforeAudit, getCacheFullValue, getCacheOverview, updateCacheTtl, updateCacheValue, deleteCacheKeys, getCacheKeysBeforeAudit } from '../services/cache.service';

const cacheRouter = new OpenAPIHono({ defaultHook: validationHook });

const GenericResponse = z.object({ code: z.number(), message: z.string(), data: z.unknown() });
const CacheListResponse = z.object({ code: z.literal(0), message: z.string(), data: z.object({ list: z.array(CacheItemDTO), total: z.number() }) });
const CountResponse = z.object({ code: z.literal(0), message: z.string(), data: z.object({ count: z.number() }) });
const CacheOverviewResponse = z.object({ code: z.literal(0), message: z.string(), data: CacheOverviewDTO });

const listRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get', path: '/', tags: ['Cache'], summary: '列出所有缓存 key（可按关键词过滤）',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'system:cache:list' })] as const,
    request: { query: z.object({ keyword: z.string().optional().openapi({ example: 'session' }) }) },
    responses: { 200: { content: { 'application/json': { schema: CacheListResponse } }, description: '缓存列表' } },
  }),
  handler: async (c) => c.json(okBody(await getCacheList(c.req.valid('query').keyword), 'success'), 200),
});

const overviewRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get', path: '/overview', tags: ['Cache'], summary: 'Redis 概览统计',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'system:cache:list' })] as const,
    responses: { 200: { content: { 'application/json': { schema: CacheOverviewResponse } }, description: 'Redis 概览' } },
  }),
  handler: async (c) => c.json(okBody(await getCacheOverview(), 'success'), 200),
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
    const { key } = c.req.valid('json');
    const before = await getCacheBeforeAudit(key);
    if (before) setAuditBeforeData(c, before);
    await deleteCacheKey(key);
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
    const { segment } = c.req.valid('json');
    const before = await getCachesByCategoryBeforeAudit(segment);
    if (before.total > 0) setAuditBeforeData(c, before);
    const count = await deleteCacheByCategory(segment);
    return c.json(okBody({ count }, `已删除 ${count} 条缓存`), 200);
  },
});

const getValueRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get', path: '/value', tags: ['Cache'], summary: '获取指定 key 的完整值',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'system:cache:list' })] as const,
    request: { query: z.object({ key: z.string().openapi({ example: 'zenith:session:abc' }) }) },
    responses: { 200: { content: { 'application/json': { schema: GenericResponse } }, description: 'key 完整值' } },
  }),
  handler: async (c) => {
    const { key } = c.req.valid('query');
    const value = await getCacheFullValue(key);
    return c.json(okBody(value, 'success'), 200);
  },
});

const updateTtlRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'put', path: '/ttl', tags: ['Cache'], summary: '修改指定 key 的过期时间',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'system:cache:update', audit: { module: '缓存管理', description: '修改缓存 TTL' } })] as const,
    request: { body: { content: { 'application/json': { schema: z.object({ key: z.string().openapi({ example: 'zenith:session:abc' }), ttl: z.number().int().openapi({ example: 3600, description: '-1 为永久，正整数为秒数' }) }) } } } },
    responses: {
      200: { content: { 'application/json': { schema: GenericResponse } }, description: '修改成功' },
      400: { content: { 'application/json': { schema: GenericResponse } }, description: '参数错误' },
      403: { content: { 'application/json': { schema: GenericResponse } }, description: '命名空间不匹配' },
      404: { content: { 'application/json': { schema: GenericResponse } }, description: 'key 不存在' },
    },
  }),
  handler: async (c) => {
    const { key, ttl } = c.req.valid('json');
    const before = await getCacheBeforeAudit(key);
    if (before) setAuditBeforeData(c, before);
    await updateCacheTtl(key, ttl);
    return c.json(okBody(null, '修改成功'), 200);
  },
});

const updateValueRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'put', path: '/value', tags: ['Cache'], summary: '修改指定 key 的值（仅字符串）',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'system:cache:update', audit: { module: '缓存管理', description: '修改缓存值' } })] as const,
    request: { body: { content: { 'application/json': { schema: z.object({ key: z.string().openapi({ example: 'zenith:perm:1' }), value: z.string().openapi({ example: '["dashboard:view"]' }), ttl: z.number().int().optional().openapi({ example: 600, description: '不传保留原 TTL，-1 为永久，正整数为秒数' }) }) } } } },
    responses: {
      200: { content: { 'application/json': { schema: GenericResponse } }, description: '修改成功' },
      400: { content: { 'application/json': { schema: GenericResponse } }, description: '参数错误或类型不支持' },
      403: { content: { 'application/json': { schema: GenericResponse } }, description: '命名空间不匹配' },
      404: { content: { 'application/json': { schema: GenericResponse } }, description: 'key 不存在' },
    },
  }),
  handler: async (c) => {
    const { key, value, ttl } = c.req.valid('json');
    const before = await getCacheBeforeAudit(key);
    if (before) setAuditBeforeData(c, before);
    await updateCacheValue(key, value, ttl);
    return c.json(okBody(null, '修改成功'), 200);
  },
});

const deleteBatchRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'delete', path: '/batch', tags: ['Cache'], summary: '批量删除指定 key',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'system:cache:delete', audit: { module: '缓存管理', description: '批量删除缓存' } })] as const,
    request: { body: { content: { 'application/json': { schema: z.object({ keys: z.array(z.string()).min(1).openapi({ example: ['zenith:session:abc'] }) }) } } } },
    responses: {
      200: { content: { 'application/json': { schema: CountResponse } }, description: '删除成功' },
      400: { content: { 'application/json': { schema: GenericResponse } }, description: '参数错误' },
      403: { content: { 'application/json': { schema: GenericResponse } }, description: '命名空间不匹配' },
    },
  }),
  handler: async (c) => {
    const { keys } = c.req.valid('json');
    const before = await getCacheKeysBeforeAudit(keys);
    if (before.total > 0) setAuditBeforeData(c, before);
    const count = await deleteCacheKeys(keys);
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
    const before = await getAllCachesBeforeAudit();
    if (before.total > 0) setAuditBeforeData(c, before);
    const count = await deleteAllCache();
    return c.json(okBody({ count }, `已清空 ${count} 条缓存`), 200);
  },
});

cacheRouter.openapiRoutes([listRoute, overviewRoute, getValueRoute, updateTtlRoute, updateValueRoute, deleteOneRoute, deleteBatchRoute, deleteByCategoryRoute, deleteAllRoute] as const);

export default cacheRouter;
