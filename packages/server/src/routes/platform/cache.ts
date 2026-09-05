import { OpenAPIHono } from '@hono/zod-openapi';
import { cacheContract } from '@zenith/shared/platform';
import { authMiddleware } from '../../middleware/auth';
import { guard, setAuditAfterData, setAuditBeforeData } from '../../middleware/guard';
import { defineContractRoute } from '../../lib/contract-route';
import { okBody, validationHook } from '../../lib/openapi-schemas';
import { getCacheList, deleteCacheKey, deleteCacheByCategory, deleteAllCache, getCacheBeforeAudit, getCachesByCategoryBeforeAudit, getAllCachesBeforeAudit, getCacheFullValue, getCacheOverview, updateCacheTtl, updateCacheValue, deleteCacheKeys, getCacheKeysBeforeAudit } from '../../services/platform/cache.service';

const cacheRouter = new OpenAPIHono({ defaultHook: validationHook });

const read = [authMiddleware, guard({ permission: 'system:cache:list' })] as const;

const listRoute = defineContractRoute(cacheContract.list, {
  middleware: read,
  handler: async (c) => c.json(okBody(await getCacheList(c.req.valid('query').keyword), 'success'), 200),
});

const overviewRoute = defineContractRoute(cacheContract.overview, {
  middleware: read,
  handler: async (c) => c.json(okBody(await getCacheOverview(), 'success'), 200),
});

const deleteOneRoute = defineContractRoute(cacheContract.removeKey, {
  middleware: [authMiddleware, guard({ permission: 'system:cache:delete', audit: { module: '缓存管理', description: '删除缓存' } })],
  handler: async (c) => {
    const { key } = c.req.valid('json');
    const before = await getCacheBeforeAudit(key);
    if (before) setAuditBeforeData(c, before);
    await deleteCacheKey(key);
    return c.json(okBody(null, '删除成功'), 200);
  },
});

const deleteByCategoryRoute = defineContractRoute(cacheContract.removeByCategory, {
  middleware: [authMiddleware, guard({ permission: 'system:cache:delete', audit: { module: '缓存管理', description: '删除分类缓存' } })],
  handler: async (c) => {
    const { segment } = c.req.valid('json');
    const before = await getCachesByCategoryBeforeAudit(segment);
    if (before.total > 0) setAuditBeforeData(c, before);
    const count = await deleteCacheByCategory(segment);
    return c.json(okBody({ count }, `已删除 ${count} 条缓存`), 200);
  },
});

const getValueRoute = defineContractRoute(cacheContract.value, {
  middleware: read,
  handler: async (c) => {
    const { key } = c.req.valid('query');
    const value = await getCacheFullValue(key);
    return c.json(okBody(value, 'success'), 200);
  },
});

const updateTtlRoute = defineContractRoute(cacheContract.updateTtl, {
  middleware: [authMiddleware, guard({ permission: 'system:cache:update', audit: { module: '缓存管理', description: '修改缓存 TTL' } })],
  handler: async (c) => {
    const { key, ttl } = c.req.valid('json');
    const before = await getCacheBeforeAudit(key);
    if (before) setAuditBeforeData(c, before);
    await updateCacheTtl(key, ttl);
    const after = await getCacheBeforeAudit(key);
    if (after) setAuditAfterData(c, after);
    return c.json(okBody(null, '修改成功'), 200);
  },
});

const updateValueRoute = defineContractRoute(cacheContract.updateValue, {
  middleware: [authMiddleware, guard({ permission: 'system:cache:update', audit: { module: '缓存管理', description: '修改缓存值' } })],
  handler: async (c) => {
    const { key, value, ttl } = c.req.valid('json');
    const before = await getCacheBeforeAudit(key);
    if (before) setAuditBeforeData(c, before);
    await updateCacheValue(key, value, ttl);
    const after = await getCacheBeforeAudit(key);
    if (after) setAuditAfterData(c, after);
    return c.json(okBody(null, '修改成功'), 200);
  },
});

const deleteBatchRoute = defineContractRoute(cacheContract.removeKeys, {
  middleware: [authMiddleware, guard({ permission: 'system:cache:delete', audit: { module: '缓存管理', description: '批量删除缓存' } })],
  handler: async (c) => {
    const { keys } = c.req.valid('json');
    const before = await getCacheKeysBeforeAudit(keys);
    if (before.total > 0) setAuditBeforeData(c, before);
    const count = await deleteCacheKeys(keys);
    return c.json(okBody({ count }, `已删除 ${count} 条缓存`), 200);
  },
});

const deleteAllRoute = defineContractRoute(cacheContract.removeAll, {
  middleware: [authMiddleware, guard({ permission: 'system:cache:delete', audit: { module: '缓存管理', description: '清空所有缓存' } })],
  handler: async (c) => {
    const before = await getAllCachesBeforeAudit();
    if (before.total > 0) setAuditBeforeData(c, before);
    const count = await deleteAllCache();
    return c.json(okBody({ count }, `已清空 ${count} 条缓存`), 200);
  },
});

cacheRouter.openapiRoutes([listRoute, overviewRoute, getValueRoute, updateTtlRoute, updateValueRoute, deleteOneRoute, deleteBatchRoute, deleteByCategoryRoute, deleteAllRoute] as const);

export default cacheRouter;
