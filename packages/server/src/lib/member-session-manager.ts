/**
 * 会员会话管理（与管理员 session-manager 完全隔离）。
 *
 * Redis key 使用独立命名空间，避免与管理员会话互窜：
 *   - `{prefix}member-session:{jti}`        会员在线会话，TTL 8h（每次请求续期）
 *   - `{prefix}member-refresh:{jti}`        会员 refresh 授权，TTL 30d（登出 / 下线即撤销，续签一次性消费并轮换）
 *   - `{prefix}member-blacklist:{jti}`      会员吊销标记，TTL 2h（与 accessToken 一致）
 *   - `{prefix}member-sessions:{memberId}`  该会员全部在线 jti 的索引 SET
 *
 * 底层通用实现见 redis-session-store.ts。
 */
import crypto from 'node:crypto';
import type { SessionRevokeReason } from '@zenith/shared/identity';
import { config } from '../config';
import { getSettings } from './settings';
import { createRedisSessionStore } from './redis-session-store';
import { createLoginChallengeGuard, type LoginFailureOutcome } from './login-challenge-guard';

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
  refreshPrefix: `${keyPrefix}member-refresh:`,
  ownerIndexPrefix: `${keyPrefix}member-sessions:`,
  ownerIdOf: (s) => s.memberId,
});

/** 生成唯一会话 ID */
export function generateMemberTokenId(): string {
  return crypto.randomUUID();
}

/** 登录时注册会话 */
export async function registerMemberSession(info: Omit<MemberSessionInfo, 'lastActiveAt'>): Promise<void> {
  await store.register(info);
}

/** 为会员 jti 签发 refresh 授权 */
export async function grantMemberRefresh(tokenId: string): Promise<void> {
  await store.grantRefresh(tokenId);
}

/** 一次性消费会员 refresh 授权 */
export async function consumeMemberRefreshGrant(tokenId: string): Promise<boolean> {
  return store.consumeRefreshGrant(tokenId);
}

/** 刷新会话活跃时间并重置 TTL。返回 false 表示会话不存在。 */
export async function touchMemberSession(tokenId: string): Promise<boolean> {
  return store.touch(tokenId);
}

/** 检查会员 token 是否已被强制下线 */
export async function isMemberTokenBlacklisted(tokenId: string): Promise<boolean> {
  return store.isBlacklisted(tokenId);
}

/** 会员令牌的吊销原因；未吊销返回 null */
export async function getMemberTokenRevocation(tokenId: string): Promise<SessionRevokeReason | null> {
  return store.getRevocation(tokenId);
}

/** 强制下线某个会员会话 */
export async function forceLogoutMember(tokenId: string): Promise<boolean> {
  return store.forceLogout(tokenId);
}

/** 强制下线某会员的所有会话（按会员索引取，不做全量 SCAN） */
export async function forceLogoutAllByMember(memberId: number): Promise<string[]> {
  return store.forceLogoutByOwner(memberId);
}

/** 启动时把索引外的会员会话补挂到会员索引，返回处理数 */
export async function rebuildMemberSessionIndex(): Promise<number> {
  return store.rebuildOwnerIndex();
}

/** 正常登出：吊销 access token、撤销 refresh 授权并删除会话 */
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

// ─── 会员登录失败防护（与管理员 login_* 隔离，键前缀 member:login_*）─────────────
// 与管理员共用 login-challenge-guard 的算法：失败按「账号 × 来源」计数 → 达阈值要求验证码，不锁定账号。

const memberLoginGuard = createLoginChallengeGuard(`${keyPrefix}member:login_`);

/** 当前会员登录是否需要先通过验证码（账号级挑战对所有来源生效，来源级只对被失败过的 IP 生效） */
export const checkMemberLoginGuard = memberLoginGuard.check;

/**
 * 记录一次会员登录失败，返回剩余可用次数（<= 0 表示已进入验证码防护）、窗口内失败统计与触发的告警原因。
 * 沿用身份安全策略的失败阈值 / 窗口 / 突增告警阈值（与管理员一致）；
 * 会员所属租户已知时按租户策略与租户安全管理员，否则用平台策略并把告警发给平台安全管理员。
 */
export async function recordMemberLoginFailure(
  account: string,
  ip: string,
  tenantId: number | null = null,
): Promise<LoginFailureOutcome> {
  const policy = (await getSettings('identitySecurity', { tenantId })).loginChallenge;
  const outcome = await memberLoginGuard.recordFailure(account, ip, policy);
  // 告警只在真的触发时才加载派发服务（它依赖 db / logger），避免会话基础设施被迫拉起这些模块
  if (outcome.bursts.length > 0) {
    const { dispatchLoginBurstAlerts } = await import('../services/identity/login-burst-alerts.service');
    await dispatchLoginBurstAlerts(outcome, {
      username: account,
      ip,
      tenantId,
      windowMinutes: policy.windowMinutes,
      link: '/member/login-logs',
    });
  }
  return outcome;
}

/** 会员登录成功后清除该来源的失败计数与来源级验证码要求（账号级要求保留到窗口结束） */
export const clearMemberLoginAttempts = memberLoginGuard.clear;
