import redis from '../lib/redis';
import { config } from '../config';
import { AppError } from '../lib/errors';

const { keyPrefix } = config.redis;

const CATEGORY_MAP: Record<string, string> = {
  session: '会话 Token',
  blacklist: '强制下线黑名单',
  perm: '权限缓存',
  login_attempt: '登录失败计数',
  login_lock: '登录锁定',
};

export function getSegment(key: string): string {
  const stripped = key.startsWith(keyPrefix) ? key.slice(keyPrefix.length) : key;
  return stripped.split(':')[0] ?? stripped;
}

export function getCategory(key: string): string {
  return CATEGORY_MAP[getSegment(key)] ?? '其他';
}

export async function scanKeys(pattern: string): Promise<string[]> {
  const keys: string[] = [];
  let cursor = '0';
  do {
    const [nextCursor, batch] = await redis.scan(cursor, 'MATCH', pattern, 'COUNT', 100);
    cursor = nextCursor;
    keys.push(...batch);
  } while (cursor !== '0');
  return keys;
}

export async function getKeyMeta(key: string) {
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

export async function listCache(keyword?: string) {
  let keys = await scanKeys(`${keyPrefix}*`);
  if (keyword) keys = keys.filter((k) => k.includes(keyword));
  keys.sort((a, b) => a.localeCompare(b));
  const items = await Promise.all(keys.map(getKeyMeta));
  return { list: items, total: items.length };
}

export async function deleteCacheKey(key: string) {
  if (!key) throw new AppError('参数错误：缺少 key', 400);
  if (!key.startsWith(keyPrefix)) throw new AppError('只能删除当前命名空间的缓存', 403);
  const deleted = await redis.del(key);
  if (deleted === 0) throw new AppError('key 不存在', 404);
}

export async function deleteCacheByCategory(segment: string) {
  if (!segment) throw new AppError('参数错误：缺少 segment', 400);
  const keys = await scanKeys(`${keyPrefix}${segment}:*`);
  if (keys.length > 0) await redis.del(...keys);
  return keys.length;
}

export async function deleteAllCache() {
  const keys = await scanKeys(`${keyPrefix}*`);
  if (keys.length > 0) await redis.del(...keys);
  return keys.length;
}
