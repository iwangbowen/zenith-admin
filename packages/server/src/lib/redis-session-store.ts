/**
 * 通用 Redis 会话存储（管理员 / 会员会话共用的底层实现）。
 *
 * 通过 key 前缀参数化隔离不同用户体系（如 `session:` 与 `member-session:`），
 * 上层 session-manager / member-session-manager 各自实例化并保持原有导出 API。
 */
import redis from './redis';
import { scanKeys } from './redis-scan';

export interface BaseSessionInfo {
  tokenId: string;
  loginAt: Date;
  lastActiveAt: Date;
}

export interface RedisSessionStoreOptions {
  /** 完整 session key 前缀（含命名空间），如 `zenith:session:` */
  sessionPrefix: string;
  /** 完整黑名单 key 前缀（含命名空间），如 `zenith:blacklist:` */
  blacklistPrefix: string;
  /** Session TTL（秒），默认 8h */
  sessionTtlSeconds?: number;
  /** Blacklist TTL（秒），默认 2h（与 accessToken 有效期一致） */
  blacklistTtlSeconds?: number;
  /** lastActiveAt 回写节流间隔（毫秒）：TTL 每请求都续，活跃时间戳按此粒度更新 */
  activeAtRefreshMs?: number;
}

/** 反序列化并还原 Date 字段 */
function reviveSession<T extends BaseSessionInfo>(raw: string): T {
  const s = JSON.parse(raw) as T;
  s.loginAt = new Date(s.loginAt);
  s.lastActiveAt = new Date(s.lastActiveAt);
  return s;
}

export function createRedisSessionStore<T extends BaseSessionInfo>(options: RedisSessionStoreOptions) {
  const {
    sessionPrefix,
    blacklistPrefix,
    sessionTtlSeconds = 8 * 60 * 60,
    blacklistTtlSeconds = 2 * 60 * 60,
    activeAtRefreshMs = 60_000,
  } = options;

  /** 登录时注册会话 */
  async function register(info: Omit<T, 'lastActiveAt'>): Promise<void> {
    const session = { ...info, lastActiveAt: new Date() };
    await redis.set(`${sessionPrefix}${info.tokenId}`, JSON.stringify(session), 'EX', sessionTtlSeconds);
  }

  /** 刷新会话活跃时间并重置 TTL。返回 false 表示会话不存在。 */
  async function touch(tokenId: string): Promise<boolean> {
    const key = `${sessionPrefix}${tokenId}`;
    // GETEX 单次往返完成读取 + TTL 续期（替代 GET+SET 两次往返）
    const raw = await redis.getex(key, 'EX', sessionTtlSeconds);
    if (!raw) return false;
    const session: T = JSON.parse(raw);
    // lastActiveAt 仅按分钟级精度回写，避免每个请求都 JSON.stringify + SET
    const lastActive = new Date(session.lastActiveAt).getTime();
    if (!Number.isFinite(lastActive) || Date.now() - lastActive >= activeAtRefreshMs) {
      session.lastActiveAt = new Date();
      // XX：仅当 key 仍存在时写入，避免与强制下线的 del 竞争后复活会话
      await redis.set(key, JSON.stringify(session), 'EX', sessionTtlSeconds, 'XX');
    }
    return true;
  }

  /** 检查 token 是否已被强制下线 */
  async function isBlacklisted(tokenId: string): Promise<boolean> {
    const result = await redis.exists(`${blacklistPrefix}${tokenId}`);
    return result === 1;
  }

  /** 强制下线某个会话（写黑名单 + 删会话）。会话不存在时返回 false。 */
  async function forceLogout(tokenId: string): Promise<boolean> {
    const key = `${sessionPrefix}${tokenId}`;
    const raw = await redis.get(key);
    if (!raw) return false;
    await Promise.all([
      redis.set(`${blacklistPrefix}${tokenId}`, '1', 'EX', blacklistTtlSeconds),
      redis.del(key),
    ]);
    return true;
  }

  /** 强制下线所有匹配的会话（单次 SCAN + pipeline），返回被下线的 tokenId 列表 */
  async function forceLogoutMatching(predicate: (session: T) => boolean): Promise<string[]> {
    const sessions = await getAll();
    const targets = sessions.filter((s) => predicate(s));
    if (targets.length === 0) return [];
    const pipeline = redis.pipeline();
    for (const s of targets) {
      pipeline.set(`${blacklistPrefix}${s.tokenId}`, '1', 'EX', blacklistTtlSeconds);
      pipeline.del(`${sessionPrefix}${s.tokenId}`);
    }
    await pipeline.exec();
    return targets.map((s) => s.tokenId);
  }

  /** 正常登出（仅删除会话，不写黑名单）*/
  async function remove(tokenId: string): Promise<void> {
    await redis.del(`${sessionPrefix}${tokenId}`);
  }

  /** 获取单个会话 */
  async function get(tokenId: string): Promise<T | null> {
    const raw = await redis.get(`${sessionPrefix}${tokenId}`);
    if (!raw) return null;
    return reviveSession<T>(raw);
  }

  /** 获取所有在线会话（按登录时间倒序）*/
  async function getAll(): Promise<T[]> {
    const keys = await scanKeys(`${sessionPrefix}*`);
    if (keys.length === 0) return [];
    const values = await redis.mget(...keys);
    return values
      .filter((v): v is string => v !== null)
      .map((v) => reviveSession<T>(v))
      .sort((a, b) => b.loginAt.getTime() - a.loginAt.getTime());
  }

  /** 在线会话数 */
  async function count(): Promise<number> {
    const keys = await scanKeys(`${sessionPrefix}*`);
    return keys.length;
  }

  return { register, touch, isBlacklisted, forceLogout, forceLogoutMatching, remove, get, getAll, count };
}
