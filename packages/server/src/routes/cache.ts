import { Hono } from 'hono';
import { authMiddleware } from '../middleware/auth';
import { guard } from '../middleware/guard';
import redis from '../lib/redis';
import { config } from '../config';

const cacheRouter = new Hono();

cacheRouter.use('*', authMiddleware);

const { keyPrefix } = config.redis;

const CATEGORY_MAP: Record<string, string> = {
  session: '会话 Token',
  blacklist: '强制下线黑名单',
  perm: '权限缓存',
  login_attempt: '登录失败计数',
  login_lock: '登录锁定',
};

/** 从 key 提取原始前缀段（如 session、blacklist） */
function getSegment(key: string): string {
  const stripped = key.startsWith(keyPrefix) ? key.slice(keyPrefix.length) : key;
  return stripped.split(':')[0] ?? stripped;
}

/** 根据 key 提取中文分类标签 */
function getCategory(key: string): string {
  const seg = getSegment(key);
  return CATEGORY_MAP[seg] ?? '其他';
}

/** 用 SCAN 命令安全枚举匹配 pattern 的所有 key */
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

/** 获取 key 的类型、TTL 和预览值 */
async function getKeyMeta(key: string) {
  const [type, ttl] = await Promise.all([
    redis.type(key),
    redis.ttl(key),
  ]);

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

/** GET /api/cache - 列出所有缓存 key */
cacheRouter.get('/', guard({ permission: 'system:cache:list' }), async (c) => {
  const keyword = c.req.query('keyword') ?? '';

  let keys = await scanKeys(`${keyPrefix}*`);

  if (keyword) {
    keys = keys.filter((k) => k.includes(keyword));
  }

  // 按 key 名排序
  keys.sort((a, b) => a.localeCompare(b));

  const items = await Promise.all(keys.map(getKeyMeta));

  return c.json({ code: 0, message: 'success', data: { list: items, total: items.length } });
});

/** DELETE /api/cache - 删除指定 key（body: { key }） */
cacheRouter.delete('/', guard({ permission: 'system:cache:delete', audit: { module: '缓存管理', description: '删除缓存' } }), async (c) => {
  const body = await c.req.json().catch(() => null);
  const key: string | undefined = body?.key;
  if (!key) {
    return c.json({ code: 400, message: '参数错误：缺少 key', data: null }, 400);
  }

  // 安全校验：只允许删除属于当前命名空间的 key
  if (!key.startsWith(keyPrefix)) {
    return c.json({ code: 403, message: '只能删除当前命名空间的缓存', data: null }, 403);
  }

  const deleted = await redis.del(key);
  if (deleted === 0) {
    return c.json({ code: 404, message: 'key 不存在', data: null }, 404);
  }

  return c.json({ code: 0, message: '删除成功', data: null });
});

/** DELETE /api/cache/by-category - 删除指定分类下的所有缓存（body: { segment }） */
cacheRouter.delete('/by-category', guard({ permission: 'system:cache:delete', audit: { module: '缓存管理', description: '删除分类缓存' } }), async (c) => {
  const body = await c.req.json().catch(() => null);
  const segment: string | undefined = body?.segment;
  if (!segment) {
    return c.json({ code: 400, message: '参数错误：缺少 segment', data: null }, 400);
  }
  const keys = await scanKeys(`${keyPrefix}${segment}:*`);
  if (keys.length > 0) {
    await redis.del(...keys);
  }
  return c.json({ code: 0, message: `已删除 ${keys.length} 条缓存`, data: { count: keys.length } });
});

/** DELETE /api/cache/all - 清空当前命名空间所有缓存 */
cacheRouter.delete('/all', guard({ permission: 'system:cache:delete', audit: { module: '缓存管理', description: '清空所有缓存' } }), async (c) => {
  const keys = await scanKeys(`${keyPrefix}*`);
  if (keys.length > 0) {
    await redis.del(...keys);
  }
  return c.json({ code: 0, message: `已清空 ${keys.length} 条缓存`, data: { count: keys.length } });
});

export default cacheRouter;
