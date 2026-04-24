/**
 * 缓存管理路由 —— 使用 `@hono/zod-openapi` 编写的试点实现之二。
 *
 * 相比 `sessions.ts`，本文件演示更完整的要素：
 *  - Query 参数的 Zod schema 与 `c.req.valid('query')`
 *  - JSON body 的 Zod schema 与 `c.req.valid('json')`
 *  - 多种业务错误码（400 / 403 / 404）与统一响应体
 */
import { OpenAPIHono, createRoute, defineOpenAPIRoute, z } from '@hono/zod-openapi';
import { authMiddleware } from '../middleware/auth';
import { guard } from '../middleware/guard';
import redis from '../lib/redis';
import { config } from '../config';
import { validationHook, okBody, errBody } from '../lib/openapi-schemas';
import { CacheItemDTO as CacheItemSchema } from '../lib/openapi-dtos';

const cacheRouter = new OpenAPIHono({ defaultHook: validationHook });

const { keyPrefix } = config.redis;

const CATEGORY_MAP: Record<string, string> = {
  session: '会话 Token',
  blacklist: '强制下线黑名单',
  perm: '权限缓存',
  login_attempt: '登录失败计数',
  login_lock: '登录锁定',
};

function getSegment(key: string): string {
  const stripped = key.startsWith(keyPrefix) ? key.slice(keyPrefix.length) : key;
  return stripped.split(':')[0] ?? stripped;
}

function getCategory(key: string): string {
  return CATEGORY_MAP[getSegment(key)] ?? '其他';
}

async function scanKeys(pattern: string): Promise<string[]> {
  const keys: string[] = [];
  let cursor = '0';
  do {
    const [nextCursor, batch] = await redis.scan(cursor, 'MATCH', pattern, 'COUNT', 100);
    cursor = nextCursor;
    keys.push(...batch);
  } while (cursor !== '0');
  return keys;
}

async function getKeyMeta(key: string) {
  const [type, ttl] = await Promise.all([redis.type(key), redis.ttl(key)]);

  let value: string | null = null;
  let size = 0;

  try {
    if (type === 'string') {
      const raw = await redis.get(key);
      if (raw !== null) {
        size = Buffer.byteLength(raw, 'utf8');
        value = raw.length > 200 ? `${raw.slice(0, 200)}…` : raw;
      }
    } else if (type === 'list') {
      size = await redis.llen(key);
    } else if (type === 'set') {
      size = await redis.scard(key);
    } else if (type === 'zset') {
      size = await redis.zcard(key);
    } else if (type === 'hash') {
      size = await redis.hlen(key);
    }
  } catch {
    // ignore
  }

  return {
    key,
    displayKey: key.startsWith(keyPrefix) ? key.slice(keyPrefix.length) : key,
    segment: getSegment(key),
    category: getCategory(key),
    type,
    ttl,
    size,
    value,
  };
}

// ─── Schemas ───────────────────────────────────────────────────────────────
const GenericResponse = z.object({
  code: z.number(),
  message: z.string(),
  data: z.unknown(),
});

const CacheListResponse = z.object({
  code: z.literal(0),
  message: z.string(),
  data: z.object({ list: z.array(CacheItemSchema), total: z.number() }),
});

const CountResponse = z.object({
  code: z.literal(0),
  message: z.string(),
  data: z.object({ count: z.number() }),
});

// ─── Routes ────────────────────────────────────────────────────────────────
const listRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get',
    path: '/',
    tags: ['Cache'],
    summary: '列出所有缓存 key（可按关键词过滤）',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'system:cache:list' })] as const,
    request: {
      query: z.object({
        keyword: z.string().optional().openapi({ example: 'session' }),
      }),
    },
    responses: {
      200: { content: { 'application/json': { schema: CacheListResponse } }, description: '缓存列表' },
    },
  }),
  handler: async (c) => {
    const { keyword } = c.req.valid('query');
    let keys = await scanKeys(`${keyPrefix}*`);
    if (keyword) keys = keys.filter((k) => k.includes(keyword));
    keys.sort((a, b) => a.localeCompare(b));
    const items = await Promise.all(keys.map(getKeyMeta));
    return c.json(okBody({ list: items, total: items.length }, 'success'), 200);
  },
});

const deleteOneRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'delete',
    path: '/',
    tags: ['Cache'],
    summary: '删除指定 key',
    security: [{ BearerAuth: [] }],
    middleware: [
      authMiddleware,
      guard({ permission: 'system:cache:delete', audit: { module: '缓存管理', description: '删除缓存' } }),
    ] as const,
    request: {
      body: {
        content: { 'application/json': { schema: z.object({ key: z.string().openapi({ example: 'zenith:session:abc' }) }) } },
      },
    },
    responses: {
      200: { content: { 'application/json': { schema: GenericResponse } }, description: '删除成功' },
      400: { content: { 'application/json': { schema: GenericResponse } }, description: '参数错误' },
      403: { content: { 'application/json': { schema: GenericResponse } }, description: '命名空间不匹配' },
      404: { content: { 'application/json': { schema: GenericResponse } }, description: 'key 不存在' },
    },
  }),
  handler: async (c) => {
    const { key } = c.req.valid('json');
    if (!key) return c.json(errBody('参数错误：缺少 key'), 400);
    if (!key.startsWith(keyPrefix)) return c.json(errBody('只能删除当前命名空间的缓存', 403), 403);
    const deleted = await redis.del(key);
    if (deleted === 0) return c.json(errBody('key 不存在', 404), 404);
    return c.json(okBody(null, '删除成功'), 200);
  },
});

const deleteByCategoryRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'delete',
    path: '/by-category',
    tags: ['Cache'],
    summary: '按分类批量删除',
    security: [{ BearerAuth: [] }],
    middleware: [
      authMiddleware,
      guard({ permission: 'system:cache:delete', audit: { module: '缓存管理', description: '删除分类缓存' } }),
    ] as const,
    request: {
      body: {
        content: { 'application/json': { schema: z.object({ segment: z.string().openapi({ example: 'session' }) }) } },
      },
    },
    responses: {
      200: { content: { 'application/json': { schema: CountResponse } }, description: '删除成功' },
      400: { content: { 'application/json': { schema: GenericResponse } }, description: '参数错误' },
    },
  }),
  handler: async (c) => {
    const { segment } = c.req.valid('json');
    if (!segment) return c.json(errBody('参数错误：缺少 segment'), 400);
    const keys = await scanKeys(`${keyPrefix}${segment}:*`);
    if (keys.length > 0) await redis.del(...keys);
    return c.json(okBody({ count: keys.length }, `已删除 ${keys.length} 条缓存`), 200);
  },
});

const deleteAllRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'delete',
    path: '/all',
    tags: ['Cache'],
    summary: '清空当前命名空间所有缓存',
    security: [{ BearerAuth: [] }],
    middleware: [
      authMiddleware,
      guard({ permission: 'system:cache:delete', audit: { module: '缓存管理', description: '清空所有缓存' } }),
    ] as const,
    responses: {
      200: { content: { 'application/json': { schema: CountResponse } }, description: '清空成功' },
    },
  }),
  handler: async (c) => {
    const keys = await scanKeys(`${keyPrefix}*`);
    if (keys.length > 0) await redis.del(...keys);
    return c.json(okBody({ count: keys.length }, `已清空 ${keys.length} 条缓存`), 200);
  },
});

cacheRouter.openapiRoutes([listRoute, deleteOneRoute, deleteByCategoryRoute, deleteAllRoute] as const);

export default cacheRouter;
