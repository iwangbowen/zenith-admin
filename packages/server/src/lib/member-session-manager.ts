/**
 * 会员会话管理（与管理员 session-manager 完全隔离）。
 *
 * Redis key 使用独立命名空间，避免与管理员会话互窜：
 *   - `{prefix}member-session:{jti}`   会员在线会话，TTL 8h（每次请求续期）
 *   - `{prefix}member-blacklist:{jti}` 会员强制下线标记，TTL 2h（与 accessToken 一致）
 *
 * 底层通用实现见 redis-session-store.ts。
 */
import crypto from 'node:crypto';
import { config } from '../config';
import { createRedisSessionStore } from './redis-session-store';

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

const { keyPrefix } = config.redis;

const store = createRedisSessionStore<MemberSessionInfo>({
  sessionPrefix: `${keyPrefix}member-session:`,
  blacklistPrefix: `${keyPrefix}member-blacklist:`,
});

/** 生成唯一会话 ID */
export function generateMemberTokenId(): string {
  return crypto.randomUUID();
}

/** 登录时注册会话 */
export async function registerMemberSession(info: Omit<MemberSessionInfo, 'lastActiveAt'>): Promise<void> {
  await store.register(info);
}

/** 刷新会话活跃时间并重置 TTL。返回 false 表示会话不存在。 */
export async function touchMemberSession(tokenId: string): Promise<boolean> {
  return store.touch(tokenId);
}

/** 检查会员 token 是否已被强制下线 */
export async function isMemberTokenBlacklisted(tokenId: string): Promise<boolean> {
  return store.isBlacklisted(tokenId);
}

/** 强制下线某个会员会话 */
export async function forceLogoutMember(tokenId: string): Promise<boolean> {
  return store.forceLogout(tokenId);
}

/** 强制下线某会员的所有会话 */
export async function forceLogoutAllByMember(memberId: number): Promise<string[]> {
  return store.forceLogoutMatching((s) => s.memberId === memberId);
}

/** 正常登出（仅删除会话，不写黑名单）*/
export async function removeMemberSession(tokenId: string): Promise<void> {
  await store.remove(tokenId);
}

/** 获取单个会员会话 */
export async function getMemberSession(tokenId: string): Promise<MemberSessionInfo | null> {
  return store.get(tokenId);
}

/** 获取所有在线会员会话 */
export async function getOnlineMemberSessions(): Promise<MemberSessionInfo[]> {
  return store.getAll();
}

/** 在线会员会话数 */
export async function getOnlineMemberCount(): Promise<number> {
  return store.count();
}
