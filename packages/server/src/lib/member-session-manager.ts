/**
 * 会员会话管理（与管理员 session-manager 完全隔离）。
 *
 * Redis key 使用独立命名空间，避免与管理员会话互窜：
 *   - `{prefix}member-session:{jti}`   会员在线会话，TTL 8h（每次请求续期）
 *   - `{prefix}member-blacklist:{jti}` 会员强制下线标记，TTL 2h（与 accessToken 一致）
 */
import crypto from 'node:crypto';
import { config } from '../config';
import redis from './redis';

export interface MemberSessionInfo {
  tokenId: string;
  memberId: number;
  /** 主标识（手机号 / 用户名 / 邮箱之一）*/
  identifier: string;
  nickname: string;
  tenantId?: number | null;
  ip: string;
  location: string | null;
  browser: string;
  os: string;
  loginAt: Date;
  lastActiveAt: Date;
}

/** Session TTL: 8 小时（秒）*/
const SESSION_TTL = 8 * 60 * 60;
/** Blacklist TTL: 2 小时（与 accessToken 一致，秒）*/
const BLACKLIST_TTL = 2 * 60 * 60;
/** lastActiveAt 回写节流间隔（毫秒）：TTL 每请求都续，活跃时间戳按此粒度更新 */
const ACTIVE_AT_REFRESH_MS = 60_000;

const { keyPrefix } = config.redis;
const SESSION_PREFIX = `${keyPrefix}member-session:`;
const BLACKLIST_PREFIX = `${keyPrefix}member-blacklist:`;

/** 生成唯一会话 ID */
export function generateMemberTokenId(): string {
  return crypto.randomUUID();
}

/** 登录时注册会话 */
export async function registerMemberSession(info: Omit<MemberSessionInfo, 'lastActiveAt'>): Promise<void> {
  const session: MemberSessionInfo = { ...info, lastActiveAt: new Date() };
  await redis.set(`${SESSION_PREFIX}${info.tokenId}`, JSON.stringify(session), 'EX', SESSION_TTL);
}

/** 刷新会话活跃时间并重置 TTL。返回 false 表示会话不存在。 */
export async function touchMemberSession(tokenId: string): Promise<boolean> {
  const key = `${SESSION_PREFIX}${tokenId}`;
  // GETEX 单次往返完成读取 + TTL 续期（替代 GET+SET 两次往返）
  const raw = await redis.getex(key, 'EX', SESSION_TTL);
  if (!raw) return false;
  const session: MemberSessionInfo = JSON.parse(raw);
  // lastActiveAt 仅按分钟级精度回写，避免每个请求都 JSON.stringify + SET
  const lastActive = new Date(session.lastActiveAt).getTime();
  if (!Number.isFinite(lastActive) || Date.now() - lastActive >= ACTIVE_AT_REFRESH_MS) {
    session.lastActiveAt = new Date();
    // XX：仅当 key 仍存在时写入，避免与强制下线的 del 竞争后复活会话
    await redis.set(key, JSON.stringify(session), 'EX', SESSION_TTL, 'XX');
  }
  return true;
}

/** 检查会员 token 是否已被强制下线 */
export async function isMemberTokenBlacklisted(tokenId: string): Promise<boolean> {
  const result = await redis.exists(`${BLACKLIST_PREFIX}${tokenId}`);
  return result === 1;
}

/** 强制下线某个会员会话 */
export async function forceLogoutMember(tokenId: string): Promise<boolean> {
  const key = `${SESSION_PREFIX}${tokenId}`;
  const raw = await redis.get(key);
  if (!raw) return false;
  await Promise.all([
    redis.set(`${BLACKLIST_PREFIX}${tokenId}`, '1', 'EX', BLACKLIST_TTL),
    redis.del(key),
  ]);
  return true;
}

/** 强制下线某会员的所有会话 */
export async function forceLogoutAllByMember(memberId: number): Promise<string[]> {
  const sessions = await getOnlineMemberSessions();
  const targets = sessions.filter((s) => s.memberId === memberId);
  if (targets.length === 0) return [];
  await Promise.all(
    targets.map((s) =>
      Promise.all([
        redis.set(`${BLACKLIST_PREFIX}${s.tokenId}`, '1', 'EX', BLACKLIST_TTL),
        redis.del(`${SESSION_PREFIX}${s.tokenId}`),
      ]),
    ),
  );
  return targets.map((s) => s.tokenId);
}

/** 正常登出（仅删除会话，不写黑名单）*/
export async function removeMemberSession(tokenId: string): Promise<void> {
  await redis.del(`${SESSION_PREFIX}${tokenId}`);
}

/** 获取单个会员会话 */
export async function getMemberSession(tokenId: string): Promise<MemberSessionInfo | null> {
  const raw = await redis.get(`${SESSION_PREFIX}${tokenId}`);
  if (!raw) return null;
  const s = JSON.parse(raw) as MemberSessionInfo;
  s.loginAt = new Date(s.loginAt);
  s.lastActiveAt = new Date(s.lastActiveAt);
  return s;
}

/** 获取所有在线会员会话 */
export async function getOnlineMemberSessions(): Promise<MemberSessionInfo[]> {
  const keys = await scanKeys(`${SESSION_PREFIX}*`);
  if (keys.length === 0) return [];
  const values = await redis.mget(...keys);
  return values
    .filter((v): v is string => v !== null)
    .map((v) => {
      const s = JSON.parse(v) as MemberSessionInfo;
      s.loginAt = new Date(s.loginAt);
      s.lastActiveAt = new Date(s.lastActiveAt);
      return s;
    })
    .sort((a, b) => b.loginAt.getTime() - a.loginAt.getTime());
}

/** 在线会员会话数 */
export async function getOnlineMemberCount(): Promise<number> {
  const keys = await scanKeys(`${SESSION_PREFIX}*`);
  return keys.length;
}

/** 使用 SCAN 遍历匹配 key（生产安全）*/
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
