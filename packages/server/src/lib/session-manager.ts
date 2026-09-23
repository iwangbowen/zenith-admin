import crypto from 'node:crypto';
import type { SessionClientKind, SessionRevokeReason } from '@zenith/shared/identity';
import { config } from '../config';
import { createRedisSessionStore } from './redis-session-store';
import { createLoginChallengeGuard, type LoginChallengePolicy, type LoginFailureOutcome } from './login-challenge-guard';

export interface SessionInfo {
  tokenId: string;
  userId: number;
  username: string;
  nickname: string;
  tenantId?: number | null;
  /** 登录终端（网页 / 移动审批 / 桌面端），并发限制按终端分别计算时的分组键 */
  client: SessionClientKind;
  ip: string;
  location: string | null;
  browser: string;
  os: string;
  loginAt: Date;
  lastActiveAt: Date;
  /** 模拟会话的实际操作人；本人登录为空 */
  impersonatorId?: number | null;
  impersonatorName?: string | null;
}

const { keyPrefix } = config.redis;
const SESSION_PREFIX = `${keyPrefix}session:`;
const BLACKLIST_PREFIX = `${keyPrefix}blacklist:`;
const REFRESH_PREFIX = `${keyPrefix}refresh:`;
const USER_SESSIONS_PREFIX = `${keyPrefix}user-sessions:`;

/**
 * 管理员会话存储：会话 TTL 8h（每次请求续期），黑名单 TTL 2h（与 accessToken 一致），
 * refresh 授权 TTL 30d（与 refreshToken 一致）。底层通用实现见 redis-session-store.ts。
 */
const store = createRedisSessionStore<SessionInfo>({
  sessionPrefix: SESSION_PREFIX,
  blacklistPrefix: BLACKLIST_PREFIX,
  refreshPrefix: REFRESH_PREFIX,
  ownerIndexPrefix: USER_SESSIONS_PREFIX,
  ownerIdOf: (s) => s.userId,
});

/** Generate a unique token ID */
export function generateTokenId(): string {
  return crypto.randomUUID();
}

/** Register a new session on login */
export async function registerSession(info: Omit<SessionInfo, 'lastActiveAt'>): Promise<void> {
  await store.register(info);
}

/** 为 jti 签发 refresh 授权：只有登录 / 续签轮换产生的 jti 才能用来换发 token */
export async function grantRefresh(tokenId: string): Promise<void> {
  await store.grantRefresh(tokenId);
}

/** 一次性消费 refresh 授权；返回 false 表示该 refresh token 已登出 / 已被轮换 / 已过期 */
export async function consumeRefreshGrant(tokenId: string): Promise<boolean> {
  return store.consumeRefreshGrant(tokenId);
}

/** Refresh session activity timestamp and reset TTL. Returns true if session existed, false if not found. */
export async function touchSession(tokenId: string): Promise<boolean> {
  return store.touch(tokenId);
}

/** Check if a token is blacklisted */
export async function isTokenBlacklisted(tokenId: string): Promise<boolean> {
  return store.isBlacklisted(tokenId);
}

/** 令牌的吊销原因（被挤下线 / 改密 / 管理员强退 / 登出 / 轮换）；未吊销返回 null */
export async function getTokenRevocation(tokenId: string): Promise<SessionRevokeReason | null> {
  return store.getRevocation(tokenId);
}

/** Force logout a session by tokenId */
export async function forceLogout(tokenId: string, reason: SessionRevokeReason = 'force-logout'): Promise<boolean> {
  return store.forceLogout(tokenId, reason);
}

/** Force logout all sessions belonging to a specific user */
export async function forceLogoutAllByUser(userId: number, reason: SessionRevokeReason = 'force-logout'): Promise<string[]> {
  return store.forceLogoutByOwner(userId, { reason });
}

/** 强制下线某用户除指定 jti 外的全部会话（改密后保留当前设备） */
export async function forceLogoutAllByUserExcept(
  userId: number,
  keepTokenId: string | undefined,
  reason: SessionRevokeReason = 'password-changed',
): Promise<string[]> {
  return store.forceLogoutByOwner(userId, { except: keepTokenId, reason });
}

/** Force logout all sessions belonging to any of the specified users (single SCAN + pipeline) */
export async function forceLogoutAllByUsers(userIds: number[]): Promise<string[]> {
  if (userIds.length === 0) return [];
  const idSet = new Set(userIds);
  return store.forceLogoutMatching((s) => idSet.has(s.userId));
}

/** 批量吊销已知会话（登录期并发限制挤人用），返回被下线的 tokenId 列表 */
export async function revokeSessions(sessions: SessionInfo[], reason: SessionRevokeReason): Promise<string[]> {
  return store.revokeSessions(sessions, reason);
}

/** 登出 / 轮换淘汰：吊销 access token、撤销 refresh 授权并删除在线会话 */
export async function removeSession(tokenId: string, reason: Extract<SessionRevokeReason, 'logout' | 'rotated'> = 'logout'): Promise<void> {
  await store.remove(tokenId, reason);
}

/** Get a single session by tokenId */
export async function getSession(tokenId: string): Promise<SessionInfo | null> {
  return store.get(tokenId);
}

/** 某用户的全部在线会话（含模拟会话；按主体索引取，不做全量 SCAN） */
export async function listUserSessions(userId: number): Promise<SessionInfo[]> {
  return store.listByOwner(userId);
}

/** 启动时把索引外的在线会话补挂到用户索引（升级前登录的会话 / 恢复的 Redis 数据），返回处理数 */
export async function rebuildUserSessionIndex(): Promise<number> {
  return store.rebuildOwnerIndex();
}

/** Get all online sessions */
export async function getOnlineSessions(): Promise<SessionInfo[]> {
  return store.getAll();
}

/** Get online session count */
export async function getOnlineCount(): Promise<number> {
  return store.count();
}

// ─── 登录失败防护（按 账号 × 来源 计数 → 要求验证码，永不锁定账号）────────────
// 算法与注释见 login-challenge-guard.ts；本处只绑定管理员键前缀 `login_*`。

const loginGuard = createLoginChallengeGuard(`${keyPrefix}login_`);

/** 当前登录是否需要先通过验证码（账号级挑战对所有来源生效，来源级只对被失败过的 IP 生效） */
export const checkLoginGuard = loginGuard.check;

/** 只判断该来源是否已进入防护（忽略账号级标记），供无验证码环节的登录路径做来源级节流 */
export const isSourceChallenged = loginGuard.isSourceChallenged;

/**
 * 记录一次登录失败（按 账号 × 来源 计数）；窗口内失败来源数或总量达到突增阈值时通知安全管理员。
 * 返回剩余可用次数（<= 0 表示已进入验证码防护）、窗口内失败统计与本轮触发的告警原因。
 */
export async function recordLoginFailure(
  username: string,
  ip: string,
  policy: LoginChallengePolicy,
  tenantId: number | null = null,
): Promise<LoginFailureOutcome> {
  const outcome = await loginGuard.recordFailure(username, ip, policy);
  // 告警只在真的触发时才加载派发服务（它依赖 db / logger），避免会话基础设施被迫拉起这些模块
  if (outcome.bursts.length > 0) {
    const { dispatchLoginBurstAlerts } = await import('../services/identity/login-burst-alerts.service');
    await dispatchLoginBurstAlerts(outcome, {
      username,
      ip,
      tenantId,
      windowMinutes: policy.windowMinutes,
      link: '/system/login-logs',
    });
  }
  return outcome;
}

/** 登录成功：清除该来源的失败计数与来源级验证码要求（账号级要求保留到窗口结束） */
export const clearLoginAttempts = loginGuard.clear;

/** 批量检查多个账号当前是否要求验证码（用户列表用） */
export const batchLoginChallengeRequired = loginGuard.batchRequired;

/** 管理员清除账号的登录失败防护状态：删除全部来源计数与验证码要求 */
export const unlockUser = loginGuard.clearAll;
