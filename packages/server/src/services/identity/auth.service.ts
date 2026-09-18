import { listRows } from '../../lib/list-query';
import { requireRow } from '../../lib/db-assert';
import { and, desc, eq, gt, gte, isNotNull, isNull, lte, or } from 'drizzle-orm';
import { db } from '../../db';
import { users, loginLogs, tenants, operationLogs, passwordResetTokens, type UserRow } from '../../db/schema';
import { reserveTenantSeats } from '../../lib/tenant-quota';
import { signToken, verifyToken } from '../../lib/jwt';
import {
  generateTokenId, registerSession, removeSession, grantRefresh, consumeRefreshGrant, getTokenRevocation,
  checkLoginLock, recordLoginFailure, clearLoginAttempts, forceLogout, forceLogoutAllByUser,
  forceLogoutAllByUserExcept, getSession, listUserSessions,
} from '../../lib/session-manager';
import { SessionRevokedException } from '../../lib/session-liveness';
import type { JwtPayload } from '../../middleware/auth';
import { formatDateTime, formatTimestamps } from '../../lib/datetime';
import { parseUserAgent, resolveReportedClient } from '../../lib/request-helpers';
import { buildWhere, dateRangeConditions, keywordCondition } from '../../lib/where-helpers';
import { lookupIpLocation } from '../../lib/ip-location';
import { clampSmallint, truncateVarchar } from '../../lib/sanitize';
import logger from '../../lib/logger';
import { getSettings } from '../../lib/settings';
import { validatePassword, type IdentitySecuritySettings, type SessionConcurrencyPolicy } from '@zenith/shared/settings';
import type { QueryOutputOf } from '@zenith/shared/core';
import { SESSION_CLIENT_KIND_LABELS, type authContract, type LoginEventType as SharedLoginEventType, type SessionClientKind, type UpdateProfileInput } from '@zenith/shared/identity';
import {
  clearMfaChallenge,
  createMfaChallenge,
  getMfaChallenge,
  shouldRequireMfa,
  verifyLoginTotp,
} from './identity-security.service';
import { consumeSessionConflictTicket, enforceSessionLimit, findConflictingSessions, issueSessionConflict } from './session-policy.service';

// ─── 获取用户角色列表 ─────────────────────────────────────────────────────────

export async function getUserRoles(userId: number) {
  const result = await db.query.users.findFirst({
    where: eq(users.id, userId),
    columns: {},
    with: { userRoles: { columns: {}, with: { role: true } } },
  });
  return (result?.userRoles ?? []).map(({ role: r }) => ({
    id: r.id,
    name: r.name,
    code: r.code,
    description: r.description,
    status: r.status,
    ...formatTimestamps(r),
  }));
}

// ─── 签发 AccessToken + RefreshToken ─────────────────────────────────────────

export async function issueTokens(
  user: { id: number; username: string; tenantId?: number | null; viewingTenantId?: number | null },
  roleCodes: string[],
  extra?: { os?: string },
) {
  const tokenId = generateTokenId();
  const tenantId = user.tenantId ?? null;
  const viewingTenantClaim = user.viewingTenantId !== undefined
    ? { viewingTenantId: user.viewingTenantId }
    : {};
  // OS 断言只进 access token（逐请求展示用）：Unknown / 缺省不写，避免把"未知"固化进令牌
  const osClaim = extra?.os && extra.os !== 'Unknown' ? { os: extra.os } : {};
  const accessToken = await signToken<JwtPayload>(
    { userId: user.id, username: user.username, roles: roleCodes, tenantId, ...viewingTenantClaim, ...osClaim, jti: tokenId },
    '2h',
  );
  const refreshToken = await signToken(
    { userId: user.id, username: user.username, type: 'refresh', tenantId, ...viewingTenantClaim, jti: tokenId },
    '30d',
  );
  return { accessToken, refreshToken, tokenId };
}

// ─── 记录登录日志 ─────────────────────────────────────────────────────────────

export interface DeviceInfo {
  screenWidth?: number;
  screenHeight?: number;
  devicePixelRatio?: string;
  gpu?: string;
  cpuCores?: number;
  memoryGb?: string;
}

export type LoginEventType = SharedLoginEventType;

export interface LoginLogParams {
  username: string;
  eventType?: LoginEventType;
  status: 'success' | 'fail';
  message: string;
  userId?: number;
  tenantId?: number | null;
  ip: string;
  ua: string;
  /** 无 UA 可解析时（如记录被挤下线的旧会话）直接给出浏览器 / 操作系统 */
  browser?: string;
  os?: string;
  deviceInfo?: DeviceInfo;
}

export async function recordLoginLog(params: LoginLogParams) {
  const { username, eventType = 'login', status, message, userId, tenantId, ip, ua, deviceInfo } = params;
  const { browser, os } = resolveReportedClient(params, ua);
  try {
    // 各列按 schema 长度截断兜底：ip / ua / browser / os 等源自不可信请求头
    await db.insert(loginLogs).values({
      username: truncateVarchar(username, 64) ?? '',
      userId,
      ip: truncateVarchar(ip, 64),
      location: ip ? truncateVarchar(lookupIpLocation(ip), 128) : null,
      browser: truncateVarchar(browser, 64),
      os: truncateVarchar(os, 64),
      userAgent: truncateVarchar(ua, 512),
      eventType,
      status,
      message: truncateVarchar(message, 256),
      tenantId: tenantId ?? null,
      screenWidth: clampSmallint(deviceInfo?.screenWidth),
      screenHeight: clampSmallint(deviceInfo?.screenHeight),
      devicePixelRatio: truncateVarchar(deviceInfo?.devicePixelRatio, 8),
      gpu: truncateVarchar(deviceInfo?.gpu, 256),
      cpuCores: clampSmallint(deviceInfo?.cpuCores),
      memoryGb: truncateVarchar(deviceInfo?.memoryGb, 8),
    });
  } catch (err) {
    // 与操作日志策略对齐：登录日志写入失败只告警，不阻断登录 / 登出主流程
    logger.warn('登录日志写入失败', { username, eventType, status, error: err instanceof Error ? err.message : String(err) });
  }
}

// ─── 以下为下沉后的登录/注册/会话业务逻辑 ─────────────────────────────────────
import { hashPassword, verifyPassword } from '../../lib/password';
import { randomBytes } from 'node:crypto';
import { config } from '../../config';
import { sendMail } from '../../lib/email';
import { isSuperAdmin, getUserPermissions } from '../../lib/permissions';
import { verifyCaptcha } from '../../lib/captcha';
import { isPlatformAdmin, isTenantActive, isTenantExpired } from '../../lib/tenant';
import { checkSubjectLiveness, loadSubjectRow } from '../../lib/subject-liveness';
import { HTTPException } from 'hono/http-exception';
import { currentUser } from '../../lib/context';
import { getImpersonationState, endImpersonation } from './impersonation.service';

/** 密码过期检查：策略按用户所属租户解析（未传入时自行读取） */
async function checkPasswordExpiry(
  user: { passwordUpdatedAt: Date | null; createdAt: Date; tenantId?: number | null },
  policy?: IdentitySecuritySettings,
): Promise<boolean> {
  const { expiryEnabled, expiryDays } = (policy ?? await getSettings('identitySecurity', { tenantId: user.tenantId ?? null })).password;
  if (!expiryEnabled) return false;
  const pwdUpdate = user.passwordUpdatedAt || user.createdAt;
  const days = (Date.now() - pwdUpdate.getTime()) / (1000 * 60 * 60 * 24);
  return days > expiryDays;
}

/** 目标用户所属租户的密码规则（新增 / 改密 / 重置共用） */
async function passwordPolicyFor(tenantId: number | null | undefined) {
  return (await getSettings('identitySecurity', { tenantId: tenantId ?? null })).password;
}

export interface LoginInput {
  username: string;
  password: string;
  captchaId?: string;
  captchaCode?: string;
  tenantCode?: string;
  ip: string;
  ua: string;
  client: SessionClientKind;
  deviceInfo?: DeviceInfo;
  deviceId?: string;
  rememberDevice?: boolean;
  /** 客户端自报的展示用浏览器 / OS（登录请求体），仅展示，不参与鉴权 */
  browser?: string;
  os?: string;
}

/** 登录来源的客户端信息：IP / UA 必有，终端类型缺省 web（注册、旧调用方）；
 * os / browser 为客户端自报的展示值（精确到 Win11 等 UA 冻结的系统），仅展示，不参与鉴权 */
export interface LoginClient {
  ip: string;
  ua: string;
  client?: SessionClientKind;
  deviceInfo?: DeviceInfo;
  browser?: string;
  os?: string;
}

export async function finalizeLogin(
  user: UserRow,
  input: LoginClient,
  options: { logMessage: string; requirePasswordChange?: boolean; sessionPolicy?: SessionConcurrencyPolicy; evictOthers?: boolean },
) {
  const userRoleList = await getUserRoles(user.id);
  const { browser, os } = resolveReportedClient(input, input.ua);
  const { accessToken, refreshToken, tokenId } = await issueTokens(user, userRoleList.map((r) => r.code), { os });

  const client = input.client ?? 'web';
  const location = lookupIpLocation(input.ip);
  const loginAt = new Date();
  const tenantId = user.tenantId ?? null;
  // 先注册本次会话再执行并发限制：挤人失败不影响本次登录，用户也不会处于「0 个会话」
  await Promise.all([
    registerSession({
      tokenId,
      userId: user.id,
      username: user.username,
      nickname: user.nickname,
      tenantId,
      client,
      ip: input.ip,
      location,
      browser,
      os,
      loginAt,
    }),
    grantRefresh(tokenId),
  ]);
  const kicked = await enforceSessionLimit(
    { userId: user.id, tenantId, tokenId, client, ip: input.ip, location, browser, os, loginAt },
    { policy: options.sessionPolicy, evictAll: options.evictOthers },
  );
  const kickedNote = kicked.length > 0 ? `（挤掉 ${kicked.length} 个会话）` : '';
  await Promise.all([
    recordLoginLog({
      ip: input.ip,
      ua: input.ua,
      browser: input.browser,
      os: input.os,
      username: user.username,
      status: 'success',
      message: `${options.logMessage}${kickedNote}`,
      userId: user.id,
      tenantId,
      deviceInfo: input.deviceInfo,
    }),
    ...kicked.map((victim) => recordLoginLog({
      eventType: 'kicked',
      ip: victim.ip,
      ua: '',
      browser: victim.browser,
      os: victim.os,
      username: user.username,
      status: 'success',
      message: `被新登录挤下线：${SESSION_CLIENT_KIND_LABELS[client]} ${browser} / ${os}（${location ? `${location} ` : ''}${input.ip}）`,
      userId: user.id,
      tenantId,
    })),
    db.update(users).set({ lastLoginAt: loginAt }).where(eq(users.id, user.id)),
  ]);
  const { password: _pw, ...userInfo } = user;
  return {
    user: {
      ...userInfo,
      roles: userRoleList,
      ...formatTimestamps(user),
      requirePasswordChange: options.requirePasswordChange,
    },
    token: { accessToken, refreshToken },
    requirePasswordChange: options.requirePasswordChange,
  };
}

/** 凭据已通过后的登录上下文：终端 / 设备信息随会话与 MFA 挑战、冲突票据一路传递 */
export interface AuthenticatedLoginClient {
  ip: string;
  ua: string;
  client?: SessionClientKind;
  deviceInfo?: DeviceInfo;
  deviceId?: string;
  rememberDevice?: boolean;
  /** 客户端自报的展示用浏览器 / OS，仅展示，不参与鉴权 */
  browser?: string;
  os?: string;
}

/**
 * 凭据已通过后的统一收口（密码 / 企业 SSO / 第三方 OAuth / 冲突票据兑换共用）：
 * 会话并发（拒绝模式）→ MFA 决策 → 密码过期检查 → 签发 token。
 * 名额已满返回冲突结果（前端弹层确认后凭票据兑换）；策略要求或新设备风控命中返回 MFA 挑战（前端走 verifyMfaLogin）。
 * `evictOthers`：用户已确认下线其它设备，跳过名额判定并在签发后全部挤掉（经 MFA 时随挑战记忆）。
 */
export async function completeLoginWithMfa(
  user: UserRow,
  client: AuthenticatedLoginClient,
  logMessage: string,
  options: { policy?: IdentitySecuritySettings; evictOthers?: boolean } = {},
) {
  const tenantId = user.tenantId ?? null;
  const policy = options.policy ?? await getSettings('identitySecurity', { tenantId });
  const clientKind = client.client ?? 'web';
  // 拒绝模式：凭据已通过，此时判定名额才不会泄露账号在线状态；MFA 之前判定，名额不足时不必再走二次验证
  if (!options.evictOthers) {
    const conflicts = await findConflictingSessions({ userId: user.id, tenantId, client: clientKind }, policy.session);
    if (conflicts.length > 0) {
      return issueSessionConflict(
        { userId: user.id, username: user.username, tenantId, ...client, client: clientKind, logMessage },
        conflicts,
        policy.session.maxSessions,
      );
    }
  }
  const mfa = await shouldRequireMfa({ user, ip: client.ip, ua: client.ua, deviceId: client.deviceId, policy });
  if (mfa.required) {
    const challenge = await createMfaChallenge({
      userId: user.id,
      username: user.username,
      tenantId,
      ip: client.ip,
      ua: client.ua,
      client: client.client,
      deviceInfo: client.deviceInfo,
      deviceId: client.deviceId,
      rememberDevice: client.rememberDevice ?? false,
      browser: client.browser,
      os: client.os,
      evictOthers: options.evictOthers,
      logMessage,
    });
    return {
      mfaRequired: true as const,
      challengeId: challenge.challengeId,
      methods: mfa.methods,
      expiresAt: challenge.expiresAt,
      reason: mfa.reason,
    };
  }
  const requirePasswordChange = await checkPasswordExpiry(user, policy);
  return finalizeLogin(user, client, { logMessage, requirePasswordChange, sessionPolicy: policy.session, evictOthers: options.evictOthers });
}

/** 拒绝模式：用户在登录页确认「下线其它设备并登录」，凭一次性票据继续原登录流程（不必重输密码） */
export async function resolveSessionConflict(ticket: string) {
  const payload = await consumeSessionConflictTicket(ticket);
  const [user] = await db.select().from(users).where(eq(users.id, payload.userId)).limit(1);
  if (!user) throw new HTTPException(401, { message: '用户不存在' });
  if (user.status === 'disabled') throw new HTTPException(403, { message: '账号已被禁用' });
  return completeLoginWithMfa(
    user,
    { ip: payload.ip, ua: payload.ua, client: payload.client, deviceInfo: payload.deviceInfo, deviceId: payload.deviceId, rememberDevice: payload.rememberDevice, browser: payload.browser, os: payload.os },
    `${payload.logMessage}（已下线其它设备）`,
    { evictOthers: true },
  );
}

export async function login(input: LoginInput) {
  // 验证码开关在租户解析之前判定，只能是平台级设置
  const auth = await getSettings('auth');
  if (auth.captchaEnabled) {
    if (!input.captchaId || !input.captchaCode) throw new HTTPException(400, { message: '请输入验证码' });
    if (!verifyCaptcha(input.captchaId, input.captchaCode)) throw new HTTPException(400, { message: '验证码错误或已过期' });
  }

  let tenantId: number | null = null;
  if (config.multiTenantMode && input.tenantCode) {
    const [maybeTenant] = await db.select().from(tenants).where(eq(tenants.code, input.tenantCode)).limit(1);
    const tenant = requireRow(maybeTenant, '租户不存在', 400);
    if (tenant.status !== 'enabled') throw new HTTPException(403, { message: '租户已被禁用' });
    if (isTenantExpired(tenant)) throw new HTTPException(403, { message: '租户已过期' });
    tenantId = tenant.id;
  }

  // 整条登录链路（锁定 / 密码过期 / MFA / 风控）统一使用目标租户的身份安全策略
  const policy = await getSettings('identitySecurity', { tenantId });

  const remainingLockSeconds = await checkLoginLock(input.username);
  if (remainingLockSeconds > 0) {
    const remainingMinutes = Math.ceil(remainingLockSeconds / 60);
    throw new HTTPException(423, { message: `账号已被锁定，请 ${remainingMinutes} 分钟后重试` });
  }
  const loginMaxAttempts = policy.lockout.maxAttempts;
  const lockDurationSeconds = policy.lockout.durationMinutes * 60;

  // 支持用户名或手机号登录
  const identifierWhere = or(eq(users.username, input.username), eq(users.phone, input.username))!;
  let userWhere;
  if (config.multiTenantMode && tenantId !== null) userWhere = and(identifierWhere, eq(users.tenantId, tenantId));
  else if (config.multiTenantMode) userWhere = and(identifierWhere, isNull(users.tenantId));
  else userWhere = identifierWhere;

  const [user] = await db.select().from(users).where(userWhere).limit(1);
  if (!user) {
    await Promise.all([
      recordLoginLog({ ip: input.ip, ua: input.ua, browser: input.browser, os: input.os, username: input.username, status: 'fail', message: '用户名或密码错误', tenantId }),
      recordLoginFailure(input.username, loginMaxAttempts, lockDurationSeconds),
    ]);
    throw new HTTPException(400, { message: '用户名或密码错误' });
  }
  if (user.status === 'disabled') {
    await recordLoginLog({ ip: input.ip, ua: input.ua, browser: input.browser, os: input.os, username: input.username, status: 'fail', message: '账号已被禁用', userId: user.id, tenantId });
    throw new HTTPException(403, { message: '账号已被禁用' });
  }
  const valid = await verifyPassword(input.password, user.password);
  if (!valid) {
    await Promise.all([
      recordLoginLog({ ip: input.ip, ua: input.ua, browser: input.browser, os: input.os, username: input.username, status: 'fail', message: '用户名或密码错误', userId: user.id, tenantId }),
      recordLoginFailure(input.username, loginMaxAttempts, lockDurationSeconds),
    ]);
    throw new HTTPException(400, { message: '用户名或密码错误' });
  }

  await clearLoginAttempts(input.username);
  // 凭据已通过：会话并发 → MFA → 密码过期 → 签发，与 SSO / OAuth 同一收口
  return completeLoginWithMfa(user, input, '登录成功', { policy });
}

export interface RegisterInput {
  username: string;
  nickname: string;
  email: string;
  password: string;
  ip: string;
  ua: string;
}

export async function register(input: RegisterInput) {
  const auth = await getSettings('auth');
  if (!auth.allowRegistration) throw new HTTPException(403, { message: '系统已关闭注册功能' });
  // 自助注册创建的是平台级用户，按平台密码规则校验
  const passwordError = validatePassword(input.password, await passwordPolicyFor(null));
  if (passwordError) throw new HTTPException(400, { message: passwordError });

  const [[usernameRow], [emailRow]] = await Promise.all([
    db.select({ id: users.id }).from(users).where(and(eq(users.username, input.username), isNull(users.tenantId))).limit(1),
    db.select({ id: users.id }).from(users).where(and(eq(users.email, input.email), isNull(users.tenantId))).limit(1),
  ]);
  if (usernameRow) throw new HTTPException(400, { message: '用户名已存在' });
  if (emailRow) throw new HTTPException(400, { message: '邮箱已被注册' });

  const hashed = await hashPassword(input.password);
  const user = await db.transaction(async (tx) => {
    // 席位校验与插入同事务（License 席位对自助注册同样生效）
    await reserveTenantSeats(tx, null);
    const [created] = await tx.insert(users).values({
      username: input.username, nickname: input.nickname, email: input.email, password: hashed,
    }).returning();
    return created;
  });

  return finalizeLogin(user, { ip: input.ip, ua: input.ua }, { logMessage: '注册并自动登录成功' });
}

export async function verifyMfaLogin(challengeId: string, code: string, rememberDevice?: boolean) {
  const challenge = await getMfaChallenge(challengeId);
  await verifyLoginTotp({ ...challenge, rememberDevice: rememberDevice ?? challenge.rememberDevice }, code);
  const [user] = await db.select().from(users).where(eq(users.id, challenge.userId)).limit(1);
  if (!user) throw new HTTPException(401, { message: '用户不存在' });
  if (user.status === 'disabled') throw new HTTPException(403, { message: '账号已被禁用' });
  const requirePasswordChange = await checkPasswordExpiry(user);
  await clearMfaChallenge(challengeId);
  return finalizeLogin(
    user,
    { ip: challenge.ip, ua: challenge.ua, client: challenge.client, deviceInfo: challenge.deviceInfo as DeviceInfo | undefined, browser: challenge.browser, os: challenge.os },
    // 冲突票据兑换后转入 MFA 的挑战带着「已确认下线其它设备」，签发后照约挤掉
    { logMessage: challenge.logMessage ? `${challenge.logMessage}（MFA 验证）` : 'MFA 验证后登录成功', requirePasswordChange, evictOthers: challenge.evictOthers },
  );
}

/**
 * 用 refresh token 换发新 token（轮换）：
 * 1. refresh token 只是承载 jti 的凭据，必须一次性消费 Redis 中对应的 refresh 授权——
 *    登出 / 强制下线 / 改密撤销授权后，即便 token 本身未过期也无法续签；
 * 2. 每次续签签发新 jti 并把授权与在线会话迁移过去，旧 jti 立即吊销（旧 access / refresh 同时作废），
 *    被盗的 refresh token 最多只能用一次，且与合法客户端并发使用时会立刻暴露。
 */
export async function refreshAccessToken(token: string, clientInfo?: { ip: string; ua: string; client?: SessionClientKind }) {
  let payload: {
    userId: number;
    username: string;
    type?: string;
    jti?: string;
    tenantId?: number | null;
    viewingTenantId?: number | null;
    impersonation?: unknown;
  };
  try {
    payload = await verifyToken<typeof payload>(token);
  } catch {
    throw new HTTPException(401, { message: 'refresh token 已过期' });
  }
  // 模拟会话从不签发 refresh token；带模拟声明的令牌一律拒绝续签
  if (payload.type !== 'refresh' || !Number.isInteger(payload.userId) || payload.userId <= 0 || !payload.jti || payload.impersonation !== undefined) {
    throw new HTTPException(401, { message: '无效的 refresh token' });
  }
  const previousTokenId = payload.jti;
  // 被挤下线 / 改密 / 强退的 jti 带原因回 401（黑名单 2h 内），登录页据此给出精确提示；授权已被消费则按一般失效
  const revoked = await getTokenRevocation(previousTokenId);
  if (revoked) throw new SessionRevokedException(revoked);
  if (!(await consumeRefreshGrant(previousTokenId))) {
    throw new HTTPException(401, { message: '登录状态已失效，请重新登录' });
  }
  // 授权已被消费：后续任何校验失败都必须让该会话彻底作废，避免半开状态
  const revokePrevious = async () => { try { await removeSession(previousTokenId); } catch { /* best-effort */ } };
  // 主体活性与 JWT 鉴权同口径（lib/subject-liveness）；租户被禁用/过期后 refresh 同步失效，不受 multiTenantMode 开关影响
  const verdict = checkSubjectLiveness(await loadSubjectRow(payload.userId), { claimedTenantId: payload.tenantId ?? null });
  if (!verdict.ok) {
    await revokePrevious();
    throw new HTTPException(verdict.status, { message: verdict.message });
  }
  const u = verdict.row;
  const dbTenantId = verdict.tenantId;
  const userRoleList = await getUserRoles(payload.userId);
  if (payload.viewingTenantId != null) {
    if (!isSuperAdmin({
      roles: userRoleList.filter((role) => role.status === 'enabled').map((role) => role.code),
      tenantId: dbTenantId,
    }) || dbTenantId !== null || !Number.isInteger(payload.viewingTenantId) || payload.viewingTenantId <= 0) {
      await revokePrevious();
      throw new HTTPException(401, { message: '登录状态已失效，请重新登录' });
    }
    const [viewingTenant] = await db.select({ status: tenants.status, expireAt: tenants.expireAt })
      .from(tenants)
      .where(eq(tenants.id, payload.viewingTenantId))
      .limit(1);
    if (!viewingTenant) { await revokePrevious(); throw new HTTPException(403, { message: '租户不存在' }); }
    if (!isTenantActive(viewingTenant)) {
      await revokePrevious();
      throw new HTTPException(403, { message: '租户已被禁用或过期' });
    }
  }
  const tokenId = generateTokenId();
  const viewingTenantClaim = payload.viewingTenantId !== undefined ? { viewingTenantId: payload.viewingTenantId } : {};
  // 在线会话迁移到新 jti：沿用原登录时间与设备信息；Redis 中无原会话（重启 / 长期未活跃）时按本次请求重建
  const existing = await getSession(previousTokenId);
  // 断言沿用会话已存 OS（Unknown 不进令牌，避免把"未知"固化）
  const migratedOsClaim = existing?.os && existing.os !== 'Unknown' ? { os: existing.os } : {};
  const [accessToken, refreshToken] = await Promise.all([
    signToken<JwtPayload>(
      { userId: payload.userId, username: u.username, roles: userRoleList.map((r) => r.code), tenantId: dbTenantId, ...viewingTenantClaim, ...migratedOsClaim, jti: tokenId },
      '2h',
    ),
    signToken(
      { userId: payload.userId, username: u.username, type: 'refresh', tenantId: dbTenantId, ...viewingTenantClaim, jti: tokenId },
      '30d',
    ),
  ]);
  const { browser, os } = parseUserAgent(clientInfo?.ua ?? '');
  await Promise.all([
    registerSession({
      tokenId,
      userId: payload.userId,
      username: u.username,
      nickname: u.nickname,
      tenantId: dbTenantId,
      client: existing?.client ?? clientInfo?.client ?? 'web',
      ip: existing?.ip ?? clientInfo?.ip ?? '',
      location: existing?.location ?? (clientInfo ? lookupIpLocation(clientInfo.ip) : null),
      browser: existing?.browser ?? browser,
      os: existing?.os ?? os,
      loginAt: existing?.loginAt ?? new Date(),
    }),
    grantRefresh(tokenId),
    removeSession(previousTokenId, 'rotated'),
  ]);
  return { accessToken, refreshToken };
}

export async function logoutSession(clientInfo?: { ip: string; ua: string }) {
  const user = currentUser();
  // 模拟会话走「退出」也按结束模拟处理：关闭记录并留痕
  if (user.impersonation) {
    await endImpersonation(clientInfo ?? { ip: '', ua: '' });
    return;
  }
  const tokenId = user.jti;
  await Promise.all([
    tokenId ? removeSession(tokenId) : Promise.resolve(),
    clientInfo
      ? recordLoginLog({
          eventType: 'logout',
          ip: clientInfo.ip,
          ua: clientInfo.ua,
          username: user.username,
          status: 'success',
          message: '退出登录成功',
          userId: user.userId,
          tenantId: user.tenantId,
        })
      : Promise.resolve(),
  ]);
}

/**
 * 按 refresh token 退出对应会话（账号切换器场景）。
 * 停靠账号本地只保留 refreshToken，注销它时拿不到 access token，
 * 因此以 refresh token 校验身份后按其 jti 移除会话，语义与 logoutSession 一致。
 */
export async function logoutByRefreshToken(token: string, clientInfo?: { ip: string; ua: string }) {
  let payload: { userId: number; username: string; type?: string; jti?: string; tenantId?: number | null; viewingTenantId?: number | null };
  try {
    payload = await verifyToken(token);
  } catch {
    throw new HTTPException(401, { message: 'refresh token 已过期' });
  }
  if (payload.type !== 'refresh') throw new HTTPException(401, { message: '无效的 refresh token' });
  await Promise.all([
    payload.jti ? removeSession(payload.jti) : Promise.resolve(),
    clientInfo
      ? recordLoginLog({
          eventType: 'logout',
          ip: clientInfo.ip,
          ua: clientInfo.ua,
          username: payload.username,
          status: 'success',
          message: '退出登录成功（账号切换）',
          userId: payload.userId,
          tenantId: payload.tenantId ?? null,
        })
      : Promise.resolve(),
  ]);
}

export { getMyPreferences, saveMyPreferences } from './auth-preferences.service';

export async function getMyFavoriteMenus(): Promise<number[]> {
  const userId = currentUser().userId;
  const [row] = await db.select({ favoriteMenus: users.favoriteMenus }).from(users).where(eq(users.id, userId)).limit(1);
  return row?.favoriteMenus ?? [];
}

export async function saveMyFavoriteMenus(menuIds: number[]): Promise<number[]> {
  const userId = currentUser().userId;
  await db.update(users).set({ favoriteMenus: menuIds }).where(eq(users.id, userId));
  return menuIds;
}

export async function getMyProfile() {
  const authUser = currentUser();
  const userId = authUser.userId;
  const user = requireRow(await db.query.users.findFirst({
    where: eq(users.id, userId),
    with: {
      department: { columns: { id: true, name: true } },
      userPositions: { columns: {}, with: { position: true } },
      userRoles: { columns: {}, with: { role: { columns: { id: true, name: true, code: true, description: true, status: true, createdAt: true, updatedAt: true } } } },
    },
  }), '用户不存在');
  const userRoleList = user.userRoles.map(({ role: r }) => ({
    id: r.id, name: r.name, code: r.code, description: r.description, status: r.status,
    ...formatTimestamps(r),
  }));
  const [requirePasswordChange, tenantRows, impersonation] = await Promise.all([
    checkPasswordExpiry(user),
    user.tenantId
      ? db.select({ name: tenants.name }).from(tenants).where(eq(tenants.id, user.tenantId)).limit(1)
      : Promise.resolve([] as { name: string }[]),
    authUser.impersonation ? getImpersonationState(authUser.impersonation.id) : Promise.resolve(null),
  ]);
  const permissions = isSuperAdmin({ roles: userRoleList.map((r) => r.code), tenantId: user.tenantId }) ? ['*'] : await getUserPermissions(user.id);
  const tenantName = tenantRows[0]?.name ?? null;
  const { password: _pw, preferences: _prefs, department, userPositions: _up, userRoles: _ur, ...userInfo } = user;

  // 首页展示本次登录：取最近 1 条成功登录（登录时已先写 loginLogs，本次请求能查到自己这次）
  const recentLogins = await db
    .select({ createdAt: loginLogs.createdAt, ip: loginLogs.ip })
    .from(loginLogs)
    .where(and(eq(loginLogs.userId, userId), eq(loginLogs.eventType, 'login'), eq(loginLogs.status, 'success')))
    .orderBy(desc(loginLogs.createdAt))
    .limit(1);
  const latestLogin = recentLogins[0] ?? null;

  return {
    ...userInfo,
    lastLoginAt: latestLogin ? formatDateTime(latestLogin.createdAt) : null,
    lastLoginIp: latestLogin?.ip ?? null,
    lastLoginLocation: latestLogin?.ip ? lookupIpLocation(latestLogin.ip) : null,
    departmentId: user.departmentId,
    departmentName: department?.name ?? null,
    positions: user.userPositions.map(({ position: p }) => ({
      id: p.id, name: p.name, code: p.code, sort: p.sort, status: p.status,
      remark: p.remark ?? null,
      ...formatTimestamps(p),
    })),
    tenantName,
    viewingTenantId: authUser.viewingTenantId ?? null,
    impersonation,
    roles: userRoleList,
    permissions,
    requirePasswordChange,
    ...formatTimestamps(user),
  };
}

export async function updateMyProfile(data: UpdateProfileInput) {
  const userId = currentUser().userId;
  const [emailDup, phoneDup] = await Promise.all([
    data.email
      ? db.select({ id: users.id }).from(users).where(eq(users.email, data.email)).limit(1)
      : Promise.resolve([] as { id: number }[]),
    data.phone
      ? db.select({ id: users.id }).from(users).where(eq(users.phone, data.phone)).limit(1)
      : Promise.resolve([] as { id: number }[]),
  ]);
  if (emailDup[0] && emailDup[0].id !== userId) throw new HTTPException(400, { message: '邮箱已被使用' });
  if (phoneDup[0] && phoneDup[0].id !== userId) throw new HTTPException(400, { message: '手机号已被使用' });
  const [[updated], userRoleList] = await Promise.all([
    db.update(users).set({ ...data }).where(eq(users.id, userId)).returning(),
    getUserRoles(userId),
  ]);
  const { password: _pw, ...userInfo } = updated;
  return { ...userInfo, roles: userRoleList, ...formatTimestamps(updated) };
}

export async function changeMyPassword(oldPassword: string, newPassword: string) {
  const userId = currentUser().userId;
  const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  requireRow(user, '用户不存在');
  const valid = await verifyPassword(oldPassword, user.password);
  if (!valid) throw new HTTPException(400, { message: '原密码错误' });
  const passwordError = validatePassword(newPassword, await passwordPolicyFor(user.tenantId));
  if (passwordError) throw new HTTPException(400, { message: passwordError });
  const hashed = await hashPassword(newPassword);
  await db.update(users).set({ password: hashed, passwordUpdatedAt: new Date() }).where(eq(users.id, userId));
  // 改密后其它设备全部下线（含被盗 refresh token），当前设备保留
  await forceLogoutAllByUserExcept(userId, currentUser().jti);
}

export async function listMyLoginLogs(query: QueryOutputOf<typeof authContract.myLoginLogs>) {
  const userId = currentUser().userId;
  const { page, pageSize, eventType, status, startTime, endTime } = query;
  const where = buildWhere(
    eq(loginLogs.userId, userId),
    eventType ? eq(loginLogs.eventType, eventType) : undefined,
    status ? eq(loginLogs.status, status) : undefined,
    ...dateRangeConditions(loginLogs.createdAt, startTime, endTime),
  );
  return listRows({
    page,
    pageSize,
    table: loginLogs,
    where,
    orderBy: [desc(loginLogs.createdAt)],
    map: (r) => ({ ...r, createdAt: formatDateTime(r.createdAt) }),
  });
}

export async function listMyOperationLogs(query: QueryOutputOf<typeof authContract.myOperationLogs>) {
  const userId = currentUser().userId;
  const { page, pageSize, module, description, method, path, ip, status, content, impersonated, startTime, endTime } = query;
  const where = buildWhere(
    eq(operationLogs.userId, userId),
    keywordCondition(module, [operationLogs.module]),
    keywordCondition(description, [operationLogs.description]),
    method ? eq(operationLogs.method, method) : undefined,
    keywordCondition(path, [operationLogs.path]),
    keywordCondition(ip, [operationLogs.ip]),
    keywordCondition(content, [operationLogs.beforeData, operationLogs.afterData, operationLogs.requestBody], 'ilike'),
    status === 'success' ? and(gte(operationLogs.responseCode, 200), lte(operationLogs.responseCode, 399)) : undefined,
    status === 'fail' ? gte(operationLogs.responseCode, 400) : undefined,
    impersonated === true ? isNotNull(operationLogs.impersonatorId) : undefined,
    impersonated === false ? isNull(operationLogs.impersonatorId) : undefined,
    ...dateRangeConditions(operationLogs.createdAt, startTime, endTime),
  );
  return listRows({
    page,
    pageSize,
    table: operationLogs,
    where,
    orderBy: [desc(operationLogs.createdAt)],
    map: (r) => ({ ...r, createdAt: formatDateTime(r.createdAt) }),
  });
}

export async function listMySessions() {
  const { userId, jti: currentTokenId } = currentUser();
  const mySessions = await listUserSessions(userId);
  return mySessions.map((s) => ({
    tokenId: s.tokenId,
    client: s.client,
    ip: s.ip,
    location: s.location ?? null,
    browser: s.browser,
    os: s.os,
    loginAt: formatDateTime(s.loginAt),
    lastActiveAt: formatDateTime(s.lastActiveAt),
    isCurrent: s.tokenId === currentTokenId,
  }));
}

export async function deleteMyOtherSessions() {
  const { userId, jti: currentTokenId } = currentUser();
  const kicked = await forceLogoutAllByUserExcept(userId, currentTokenId, 'force-logout');
  return kicked.length;
}

export async function deleteMySession(tokenId: string) {
  const { userId, jti: currentTokenId } = currentUser();
  if (tokenId === currentTokenId) throw new HTTPException(400, { message: '不能退出当前设备，请使用退出登录功能' });
  const session = (await listUserSessions(userId)).find((s) => s.tokenId === tokenId);
  requireRow(session, '会话不存在或已过期');
  await forceLogout(tokenId);
}

export async function switchTenantView(targetTenantId: number | null, ip: string, ua: string) {
  const payload = currentUser();
  if (!isPlatformAdmin(payload)) throw new HTTPException(403, { message: '仅平台超管可切换租户' });
  if (targetTenantId !== null) {
    const [tenant] = await db.select().from(tenants).where(eq(tenants.id, targetTenantId)).limit(1);
    requireRow(tenant, '租户不存在');
    if (tenant.status !== 'enabled') throw new HTTPException(403, { message: '租户已被禁用' });
    if (isTenantExpired(tenant)) throw new HTTPException(403, { message: '租户已过期' });
  }
  const { browser, os } = parseUserAgent(ua);
  // 会话迁移（非新登录）：沿用原会话的终端信息与登录时间（与 refresh 轮换一致），不触发并发限制；旧 jti 立即吊销（access / refresh 一并作废）
  const existing = payload.jti ? await getSession(payload.jti) : null;
  if (payload.jti) await removeSession(payload.jti, 'rotated');
  // 断言沿用会话已存 OS（Unknown 不进令牌）
  const migratedOs = existing?.os && existing.os !== 'Unknown' ? existing.os : undefined;
  const tokenId = generateTokenId();
  const newAccessToken = await signToken<JwtPayload>(
    { userId: payload.userId, username: payload.username, roles: payload.roles, tenantId: payload.tenantId, viewingTenantId: targetTenantId, ...(migratedOs ? { os: migratedOs } : {}), jti: tokenId },
    '2h',
  );
  const newRefreshToken = await signToken(
    { userId: payload.userId, username: payload.username, type: 'refresh', tenantId: payload.tenantId, viewingTenantId: targetTenantId, jti: tokenId },
    '30d',
  );
  await Promise.all([
    registerSession({
      tokenId,
      userId: payload.userId,
      username: payload.username,
      nickname: payload.username,
      tenantId: payload.tenantId,
      client: existing?.client ?? 'web',
      ip,
      location: lookupIpLocation(ip),
      browser: existing?.browser ?? browser,
      os: existing?.os ?? os,
      loginAt: existing?.loginAt ?? new Date(),
    }),
    grantRefresh(tokenId),
  ]);
  return {
    accessToken: newAccessToken,
    refreshToken: newRefreshToken,
    viewingTenantId: targetTenantId,
    message: targetTenantId === null ? '已切换回平台视角' : '已切换租户视角',
  };
}

export async function listSwitchableTenants() {
  const payload = currentUser();
  if (!isPlatformAdmin(payload)) throw new HTTPException(403, { message: '无权限' });
  return db.select({ id: tenants.id, name: tenants.name, code: tenants.code, status: tenants.status }).from(tenants).where(eq(tenants.status, 'enabled'));
}

export async function forgotPassword(email: string) {
  const auth = await getSettings('auth');
  if (!auth.forgotPasswordEnabled) throw new HTTPException(403, { message: '忘记密码功能未开启' });
  const [user] = await db.select({ id: users.id, username: users.username })
    .from(users).where(and(eq(users.email, email), eq(users.status, 'enabled'))).limit(1);
  if (user) {
    const token = randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + 30 * 60 * 1000);
    await db.insert(passwordResetTokens).values({ userId: user.id, token, expiresAt });
    const frontendUrl = config.frontendBaseUrl;
    const resetLink = `${frontendUrl}/reset-password?token=${token}`;
    try {
      await sendMail(
        email,
        '【Zenith Admin】密码重置',
        `<p>您好，${user.username}！</p>
  <p>我们收到了您的密码重置请求。请点击下方链接重置密码（链接 30 分钟内有效）：</p>
  <p><a href="${resetLink}">${resetLink}</a></p>
  <p>如果您没有发起此请求，请忽略本邮件。</p>`,
      );
    } catch {
      // ignore
    }
  }
}

export async function resetPassword(token: string, newPassword: string) {
  const now = new Date();
  const [maybeRecord] = await db.select().from(passwordResetTokens)
    .where(and(eq(passwordResetTokens.token, token), gt(passwordResetTokens.expiresAt, now), isNull(passwordResetTokens.usedAt)))
    .limit(1);
  const record = requireRow(maybeRecord, '重置链接无效或已过期', 400);
  const [target] = await db.select({ tenantId: users.tenantId }).from(users).where(eq(users.id, record.userId)).limit(1);
  const passwordError = validatePassword(newPassword, await passwordPolicyFor(target?.tenantId));
  if (passwordError) throw new HTTPException(400, { message: passwordError });
  const hashed = await hashPassword(newPassword);
  await db.transaction(async (tx) => {
    await tx.update(users).set({ password: hashed, passwordUpdatedAt: now }).where(eq(users.id, record.userId));
    await tx.update(passwordResetTokens).set({ usedAt: now }).where(eq(passwordResetTokens.id, record.id));
  });
  // 重置密码通常意味着凭据可能已泄露：全部会话下线
  await forceLogoutAllByUser(record.userId);
}

export async function verifyMyPassword(password: string) {
  const userId = currentUser().userId;
  const [user] = await db.select({ password: users.password }).from(users).where(eq(users.id, userId)).limit(1);
  requireRow(user, '用户不存在');
  const valid = await verifyPassword(password, user.password);
  if (!valid) throw new HTTPException(401, { message: '密码错误' });
}
