import redis from '../../lib/redis';
import { config } from '../../config';
import { HTTPException } from 'hono/http-exception';
import { getRedisInfo } from './monitor.service';
import { scanKeys } from '../../lib/redis-scan';

export { scanKeys };

const { keyPrefix } = config.redis;

// key 首段（命名空间前缀后的第一个 `:` 分段）→ 分类名，必须保持一一对应：
// 前端「删除分类」按 segment 批量删除，同一分类名只能对应一个 segment
const CATEGORY_MAP: Record<string, string> = {
  // 管理员认证与权限
  session: '会话 Token',
  blacklist: '强制下线黑名单',
  perm: '权限缓存',
  login_attempt: '登录失败计数',
  login_lock: '登录锁定',
  // 请求防护
  rl: '接口限流计数',
  rlstats: '限流统计',
  idempotency: '幂等控制',
  // AI 服务（ai:req / ai:err / ai:quota / ai:gen）
  ai: 'AI 服务',
  // 开放平台
  openrl: '开放平台限流',
  opennonce: '开放平台防重放',
  'openquota-gate': '开放平台配额告警',
  // SSO 身份提供方
  'idp-oidc-state': 'OIDC 登录状态',
  'idp-saml-state': 'SAML 登录状态',
  'idp-saml-request': 'SAML 认证请求',
  'idp-saml-login-ticket': 'SAML 登录票据',
  // 工作流
  wf: '工作流自动化',
  wfconn: '工作流连接器',
  // 会员体系
  'member-session': '会员会话',
  'member-blacklist': '会员下线黑名单',
  member: '会员安全',
  // 微信公众号（mp:access_token / mp:jsapi_ticket）
  mp: '公众号凭证',
  // 报表中心（report:quota / dataset / matview / chatbi / share-session / fill）
  report: '报表中心',
  // 埋点分析（analytics:quota）
  analytics: '埋点分析',
};

export function getSegment(key: string): string {
  const stripped = key.startsWith(keyPrefix) ? key.slice(keyPrefix.length) : key;
  return stripped.split(':')[0] ?? stripped;
}

export function getCategory(key: string): string {
  return CATEGORY_MAP[getSegment(key)] ?? '其他';
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

export async function getCacheList(keyword?: string) {
  let keys = await scanKeys(`${keyPrefix}*`);
  if (keyword) keys = keys.filter((k) => k.includes(keyword));
  keys.sort((a, b) => a.localeCompare(b));
  const items = await Promise.all(keys.map(getKeyMeta));
  return { list: items, total: items.length };
}

export async function getCacheFullValue(key: string): Promise<string | null> {
  const type = await redis.type(key);
  if (type !== 'string') return null;
  return redis.get(key);
}

function toAuditItem(meta: Awaited<ReturnType<typeof getKeyMeta>>) {
  return {
    key: meta.key,
    displayKey: meta.displayKey,
    segment: meta.segment,
    category: meta.category,
    type: meta.type,
    ttl: meta.ttl,
    size: meta.size,
  };
}

export async function getCacheBeforeAudit(key: string) {
  if (!key?.startsWith(keyPrefix)) return null;
  const exists = await redis.exists(key);
  if (!exists) return null;
  return toAuditItem(await getKeyMeta(key));
}

export async function getCachesByCategoryBeforeAudit(segment: string) {
  if (!segment) return { total: 0, list: [] };
  const keys = await scanKeys(`${keyPrefix}${segment}:*`);
  keys.sort((a, b) => a.localeCompare(b));
  const items = await Promise.all(keys.map(getKeyMeta));
  return { total: items.length, list: items.map(toAuditItem) };
}

export async function getAllCachesBeforeAudit() {
  const keys = await scanKeys(`${keyPrefix}*`);
  keys.sort((a, b) => a.localeCompare(b));
  const items = await Promise.all(keys.map(getKeyMeta));
  return { total: items.length, list: items.map(toAuditItem) };
}

export async function deleteCacheKey(key: string) {
  if (!key) throw new HTTPException(400, { message: '参数错误：缺少 key' });
  if (!key.startsWith(keyPrefix)) throw new HTTPException(403, { message: '只能删除当前命名空间的缓存' });
  const deleted = await redis.del(key);
  if (deleted === 0) throw new HTTPException(404, { message: 'key 不存在' });
}

export async function deleteCacheByCategory(segment: string) {
  if (!segment) throw new HTTPException(400, { message: '参数错误：缺少 segment' });
  const keys = await scanKeys(`${keyPrefix}${segment}:*`);
  if (keys.length > 0) await redis.del(...keys);
  return keys.length;
}

export async function deleteAllCache() {
  const keys = await scanKeys(`${keyPrefix}*`);
  if (keys.length > 0) await redis.del(...keys);
  return keys.length;
}

function assertNamespace(key: string): void {
  if (!key) throw new HTTPException(400, { message: '参数错误：缺少 key' });
  if (!key.startsWith(keyPrefix)) throw new HTTPException(403, { message: '只能操作当前命名空间的缓存' });
}

export interface CacheOverview {
  connected: boolean;
  version: string;
  uptimeSeconds: number;
  connectedClients: number;
  usedMemory: number;
  usedMemoryHuman: string;
  maxMemory: number;
  memFragmentationRatio: number;
  keyspaceHits: number;
  keyspaceMisses: number;
  hitRate: number;
  totalKeys: number;
  keyPrefix: string;
}

export async function getCacheOverview(): Promise<CacheOverview> {
  const info = await getRedisInfo();
  if (!info) {
    return {
      connected: false,
      version: '',
      uptimeSeconds: 0,
      connectedClients: 0,
      usedMemory: 0,
      usedMemoryHuman: '',
      maxMemory: 0,
      memFragmentationRatio: 0,
      keyspaceHits: 0,
      keyspaceMisses: 0,
      hitRate: 0,
      totalKeys: 0,
      keyPrefix,
    };
  }
  const totalLookups = info.keyspaceHits + info.keyspaceMisses;
  const hitRate = totalLookups > 0 ? Math.round((info.keyspaceHits / totalLookups) * 10000) / 100 : 0;
  return {
    connected: true,
    version: info.version,
    uptimeSeconds: info.uptimeSeconds,
    connectedClients: info.connectedClients,
    usedMemory: info.usedMemory,
    usedMemoryHuman: info.usedMemoryHuman,
    maxMemory: info.maxMemory,
    memFragmentationRatio: info.memFragmentationRatio,
    keyspaceHits: info.keyspaceHits,
    keyspaceMisses: info.keyspaceMisses,
    hitRate,
    totalKeys: info.keyCount,
    keyPrefix,
  };
}

export async function updateCacheTtl(key: string, ttl: number) {
  assertNamespace(key);
  const exists = await redis.exists(key);
  if (!exists) throw new HTTPException(404, { message: 'key 不存在' });
  if (ttl === -1) {
    await redis.persist(key);
  } else if (ttl > 0) {
    await redis.expire(key, ttl);
  } else {
    throw new HTTPException(400, { message: 'TTL 必须为 -1（永久）或大于 0 的秒数' });
  }
}

export async function updateCacheValue(key: string, value: string, ttl?: number) {
  assertNamespace(key);
  const type = await redis.type(key);
  if (type === 'none') throw new HTTPException(404, { message: 'key 不存在' });
  if (type !== 'string') throw new HTTPException(400, { message: '仅支持编辑字符串类型的缓存' });
  if (ttl === undefined) {
    // 保留原有过期时间
    await redis.call('SET', key, value, 'KEEPTTL');
  } else if (ttl === -1) {
    await redis.set(key, value);
  } else if (ttl > 0) {
    await redis.set(key, value, 'EX', ttl);
  } else {
    throw new HTTPException(400, { message: 'TTL 必须为 -1（永久）或大于 0 的秒数' });
  }
}

export async function deleteCacheKeys(keys: string[]) {
  if (!Array.isArray(keys) || keys.length === 0) {
    throw new HTTPException(400, { message: '参数错误：缺少 keys' });
  }
  for (const key of keys) assertNamespace(key);
  const deleted = await redis.del(...keys);
  return deleted;
}

export async function getCacheKeysBeforeAudit(keys: string[]) {
  const valid = keys.filter((k) => k?.startsWith(keyPrefix));
  if (valid.length === 0) return { total: 0, list: [] };
  const existing: string[] = [];
  for (const key of valid) {
    if (await redis.exists(key)) existing.push(key);
  }
  if (existing.length === 0) return { total: 0, list: [] };
  const items = await Promise.all(existing.map(getKeyMeta));
  return { total: items.length, list: items.map(toAuditItem) };
}
