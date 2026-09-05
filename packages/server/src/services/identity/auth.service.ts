import { and, desc, eq, gt, isNull, or, type SQL } from 'drizzle-orm';
import { db } from '../../db';
import { users, loginLogs, tenants, operationLogs, passwordResetTokens, type UserRow } from '../../db/schema';
import { reserveTenantSeats } from '../../lib/tenant-quota';
import { signToken, verifyToken } from '../../lib/jwt';
import {
  generateTokenId, registerSession, removeSession, grantRefresh, consumeRefreshGrant, isTokenBlacklisted,
  checkLoginLock, recordLoginFailure, clearLoginAttempts, getOnlineSessions, forceLogout, forceLogoutAllByUser,
  forceLogoutAllByUserExcept, getSession,
} from '../../lib/session-manager';
import type { JwtPayload } from '../../middleware/auth';
import { formatDateTime } from '../../lib/datetime';
import { parseUserAgent } from '../../lib/request-helpers';
import { dateRangeConditions, withPagination, keywordCondition } from '../../lib/where-helpers';
import { lookupIpLocation } from '../../lib/ip-location';
import { clampSmallint, truncateVarchar } from '../../lib/sanitize';
import logger from '../../lib/logger';
import { getSettings } from '../../lib/settings';
import { validatePassword, type IdentitySecuritySettings } from '@zenith/shared/settings';
import {
  clearMfaChallenge,
  createMfaChallenge,
  getMfaChallenge,
  shouldRequireMfa,
  verifyLoginTotp,
} from './identity-security.service';

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
    createdAt: formatDateTime(r.createdAt),
    updatedAt: formatDateTime(r.updatedAt),
  }));
}

// ─── 签发 AccessToken + RefreshToken ─────────────────────────────────────────

export async function issueTokens(
  user: { id: number; username: string; tenantId?: number | null; viewingTenantId?: number | null },
  roleCodes: string[],
) {
  const tokenId = generateTokenId();
  const tenantId = user.tenantId ?? null;
  const viewingTenantClaim = user.viewingTenantId !== undefined
    ? { viewingTenantId: user.viewingTenantId }
    : {};
  const accessToken = await signToken<JwtPayload>(
    { userId: user.id, username: user.username, roles: roleCodes, tenantId, ...viewingTenantClaim, jti: tokenId },
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

export type LoginEventType = 'login' | 'logout';

export interface LoginLogParams {
  username: string;
  eventType?: LoginEventType;
  status: 'success' | 'fail';
  message: string;
  userId?: number;
  tenantId?: number | null;
  ip: string;
  ua: string;
  deviceInfo?: DeviceInfo;
}

export async function recordLoginLog(params: LoginLogParams) {
  const { username, eventType = 'login', status, message, userId, tenantId, ip, ua, deviceInfo } = params;
  const { browser, os } = parseUserAgent(ua);
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
import { HTTPException } from 'hono/http-exception';
import { currentUser } from '../../lib/context';

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
  deviceInfo?: DeviceInfo;
  deviceId?: string;
  rememberDevice?: boolean;
}

export async function finalizeLogin(
  user: UserRow,
  input: { ip: string; ua: string; deviceInfo?: DeviceInfo },
  options: { logMessage: string; requirePasswordChange?: boolean },
) {
  const userRoleList = await getUserRoles(user.id);
  const { accessToken, refreshToken, tokenId } = await issueTokens(user, userRoleList.map((r) => r.code));

  const { browser, os } = parseUserAgent(input.ua);
  await Promise.all([
    registerSession({
      tokenId,
      userId: user.id,
      username: user.username,
      nickname: user.nickname,
      tenantId: user.tenantId ?? null,
      ip: input.ip,
      location: lookupIpLocation(input.ip),
      browser,
      os,
      loginAt: new Date(),
    }),
    grantRefresh(tokenId),
    recordLoginLog({
      ip: input.ip,
      ua: input.ua,
      username: user.username,
      status: 'success',
      message: options.logMessage,
      userId: user.id,
      tenantId: user.tenantId ?? null,
      deviceInfo: input.deviceInfo,
    }),
    db.update(users).set({ lastLoginAt: new Date() }).where(eq(users.id, user.id)),
  ]);
  const { password: _pw, ...userInfo } = user;
  return {
    user: {
      ...userInfo,
      roles: userRoleList,
      createdAt: formatDateTime(user.createdAt),
      updatedAt: formatDateTime(user.updatedAt),
      requirePasswordChange: options.requirePasswordChange,
    },
    token: { accessToken, refreshToken },
    requirePasswordChange: options.requirePasswordChange,
  };
}

/**
 * 非密码登录（企业 SSO / 第三方 OAuth）的统一收口：与 `login()` 共用同一套 MFA 决策与密码过期检查。
 * 策略要求或新设备风控命中时返回挑战（前端走 verifyMfaLogin），否则签发 token。
 */
export async function completeLoginWithMfa(
  user: UserRow,
  client: { ip: string; ua: string; deviceInfo?: DeviceInfo; deviceId?: string },
  logMessage: string,
) {
  const mfa = await shouldRequireMfa({ user, ip: client.ip, ua: client.ua, deviceId: client.deviceId });
  if (mfa.required) {
    const challenge = await createMfaChallenge({
      userId: user.id,
      username: user.username,
      tenantId: user.tenantId ?? null,
      ip: client.ip,
      ua: client.ua,
      deviceInfo: client.deviceInfo,
      deviceId: client.deviceId,
      rememberDevice: false,
    });
    return {
      mfaRequired: true as const,
      challengeId: challenge.challengeId,
      methods: mfa.methods,
      expiresAt: challenge.expiresAt,
      reason: mfa.reason,
    };
  }
  const requirePasswordChange = await checkPasswordExpiry(user);
  return finalizeLogin(user, { ip: client.ip, ua: client.ua, deviceInfo: client.deviceInfo }, { logMessage, requirePasswordChange });
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
    const [tenant] = await db.select().from(tenants).where(eq(tenants.code, input.tenantCode)).limit(1);
    if (!tenant) throw new HTTPException(400, { message: '租户不存在' });
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
      recordLoginLog({ ip: input.ip, ua: input.ua, username: input.username, status: 'fail', message: '用户名或密码错误', tenantId }),
      recordLoginFailure(input.username, loginMaxAttempts, lockDurationSeconds),
    ]);
    throw new HTTPException(400, { message: '用户名或密码错误' });
  }
  if (user.status === 'disabled') {
    await recordLoginLog({ ip: input.ip, ua: input.ua, username: input.username, status: 'fail', message: '账号已被禁用', userId: user.id, tenantId });
    throw new HTTPException(403, { message: '账号已被禁用' });
  }
  const valid = await verifyPassword(input.password, user.password);
  if (!valid) {
    await Promise.all([
      recordLoginLog({ ip: input.ip, ua: input.ua, username: input.username, status: 'fail', message: '用户名或密码错误', userId: user.id, tenantId }),
      recordLoginFailure(input.username, loginMaxAttempts, lockDurationSeconds),
    ]);
    throw new HTTPException(400, { message: '用户名或密码错误' });
  }

  const [requirePasswordChange] = await Promise.all([
    checkPasswordExpiry(user, policy),
    clearLoginAttempts(input.username),
  ]);

  const mfa = await shouldRequireMfa({ user, ip: input.ip, ua: input.ua, deviceId: input.deviceId, policy });
  if (mfa.required) {
    const challenge = await createMfaChallenge({
      userId: user.id,
      username: user.username,
      tenantId: user.tenantId ?? null,
      ip: input.ip,
      ua: input.ua,
      deviceInfo: input.deviceInfo,
      deviceId: input.deviceId,
      rememberDevice: input.rememberDevice ?? false,
    });
    return {
      mfaRequired: true as const,
      challengeId: challenge.challengeId,
      methods: mfa.methods,
      expiresAt: challenge.expiresAt,
      reason: mfa.reason,
    };
  }

  return finalizeLogin(user, input, { logMessage: '登录成功', requirePasswordChange });
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
    { ip: challenge.ip, ua: challenge.ua, deviceInfo: challenge.deviceInfo as DeviceInfo | undefined },
    { logMessage: 'MFA 验证后登录成功', requirePasswordChange },
  );
}

/**
 * 用 refresh token 换发新 token（轮换）：
 * 1. refresh token 只是承载 jti 的凭据，必须一次性消费 Redis 中对应的 refresh 授权——
 *    登出 / 强制下线 / 改密撤销授权后，即便 token 本身未过期也无法续签；
 * 2. 每次续签签发新 jti 并把授权与在线会话迁移过去，旧 jti 立即吊销（旧 access / refresh 同时作废），
 *    被盗的 refresh token 最多只能用一次，且与合法客户端并发使用时会立刻暴露。
 */
export async function refreshAccessToken(token: string, clientInfo?: { ip: string; ua: string }) {
  let payload: {
    userId: number;
    username: string;
    type?: string;
    jti?: string;
    tenantId?: number | null;
    viewingTenantId?: number | null;
  };
  try {
    payload = await verifyToken<typeof payload>(token);
  } catch {
    throw new HTTPException(401, { message: 'refresh token 已过期' });
  }
  if (payload.type !== 'refresh' || !Number.isInteger(payload.userId) || payload.userId <= 0 || !payload.jti) {
    throw new HTTPException(401, { message: '无效的 refresh token' });
  }
  const previousTokenId = payload.jti;
  if (await isTokenBlacklisted(previousTokenId) || !(await consumeRefreshGrant(previousTokenId))) {
    throw new HTTPException(401, { message: '登录状态已失效，请重新登录' });
  }
  // 授权已被消费：后续任何校验失败都必须让该会话彻底作废，避免半开状态
  const revokePrevious = async () => { try { await removeSession(previousTokenId); } catch { /* best-effort */ } };
  const [u] = await db.select({
    status: users.status,
    nickname: users.nickname,
    username: users.username,
    tenantId: users.tenantId,
    tenantStatus: tenants.status,
    tenantExpireAt: tenants.expireAt,
  })
    .from(users)
    .leftJoin(tenants, eq(users.tenantId, tenants.id))
    .where(eq(users.id, payload.userId))
    .limit(1);
  if (!u) { await revokePrevious(); throw new HTTPException(401, { message: '用户不存在' }); }
  if (u.status !== 'enabled') { await revokePrevious(); throw new HTTPException(403, { message: '账号已被禁用' }); }
  const dbTenantId = u.tenantId ?? null;
  if ((payload.tenantId ?? null) !== dbTenantId) {
    await revokePrevious();
    throw new HTTPException(401, { message: '登录状态已失效，请重新登录' });
  }
  // 租户被禁用/过期后，refresh 必须同步失效（不受 multiTenantMode 开关影响）。
  if (dbTenantId !== null && !isTenantActive({ status: u.tenantStatus, expireAt: u.tenantExpireAt })) {
    await revokePrevious();
    throw new HTTPException(403, { message: '租户已被禁用或过期' });
  }
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
  const [accessToken, refreshToken] = await Promise.all([
    signToken<JwtPayload>(
      { userId: payload.userId, username: u.username, roles: userRoleList.map((r) => r.code), tenantId: dbTenantId, ...viewingTenantClaim, jti: tokenId },
      '2h',
    ),
    signToken(
      { userId: payload.userId, username: u.username, type: 'refresh', tenantId: dbTenantId, ...viewingTenantClaim, jti: tokenId },
      '30d',
    ),
  ]);
  // 在线会话迁移到新 jti：沿用原登录时间与设备信息；Redis 中无原会话（重启 / 长期未活跃）时按本次请求重建
  const existing = await getSession(previousTokenId);
  const { browser, os } = parseUserAgent(clientInfo?.ua ?? '');
  await Promise.all([
    registerSession({
      tokenId,
      userId: payload.userId,
      username: u.username,
      nickname: u.nickname,
      tenantId: dbTenantId,
      ip: existing?.ip ?? clientInfo?.ip ?? '',
      location: existing?.location ?? (clientInfo ? lookupIpLocation(clientInfo.ip) : null),
      browser: existing?.browser ?? browser,
      os: existing?.os ?? os,
      loginAt: existing?.loginAt ?? new Date(),
    }),
    grantRefresh(tokenId),
    removeSession(previousTokenId),
  ]);
  return { accessToken, refreshToken };
}

export async function logoutSession(clientInfo?: { ip: string; ua: string }) {
  const user = currentUser();
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

export async function getMyPreferences() {
  const userId = currentUser().userId;
  const [row] = await db.select({ preferences: users.preferences }).from(users).where(eq(users.id, userId)).limit(1);
  return (row?.preferences as Record<string, unknown> | null) ?? null;
}

export async function saveMyPreferences(prefs: Record<string, unknown>) {
  const userId = currentUser().userId;
  await db.update(users).set({ preferences: prefs }).where(eq(users.id, userId));
  return prefs;
}

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
  const user = await db.query.users.findFirst({
    where: eq(users.id, userId),
    with: {
      department: { columns: { id: true, name: true } },
      userPositions: { columns: {}, with: { position: true } },
      userRoles: { columns: {}, with: { role: { columns: { id: true, name: true, code: true, description: true, status: true, createdAt: true, updatedAt: true } } } },
    },
  });
  if (!user) throw new HTTPException(404, { message: '用户不存在' });
  const userRoleList = user.userRoles.map(({ role: r }) => ({
    id: r.id, name: r.name, code: r.code, description: r.description, status: r.status,
    createdAt: formatDateTime(r.createdAt), updatedAt: formatDateTime(r.updatedAt),
  }));
  const [requirePasswordChange, tenantRows] = await Promise.all([
    checkPasswordExpiry(user),
    user.tenantId
      ? db.select({ name: tenants.name }).from(tenants).where(eq(tenants.id, user.tenantId)).limit(1)
      : Promise.resolve([] as { name: string }[]),
  ]);
  const permissions = isSuperAdmin({ roles: userRoleList.map((r) => r.code), tenantId: user.tenantId }) ? ['*'] : await getUserPermissions(user.id);
  const tenantName = tenantRows[0]?.name ?? null;
  const { password: _pw, preferences: _prefs, department, userPositions: _up, userRoles: _ur, ...userInfo } = user;

  // 查询上次登录记录（最近 2 条成功登录，取第 2 条作为"上次"）
  const recentLogins = await db
    .select({ createdAt: loginLogs.createdAt, ip: loginLogs.ip })
    .from(loginLogs)
    .where(and(eq(loginLogs.userId, userId), eq(loginLogs.eventType, 'login'), eq(loginLogs.status, 'success')))
    .orderBy(desc(loginLogs.createdAt))
    .limit(2);
  const prevLogin = recentLogins[1] ?? null;

  return {
    ...userInfo,
    lastLoginAt: prevLogin ? formatDateTime(prevLogin.createdAt) : null,
    lastLoginIp: prevLogin?.ip ?? null,
    lastLoginLocation: prevLogin?.ip ? lookupIpLocation(prevLogin.ip) : null,
    departmentId: user.departmentId,
    departmentName: department?.name ?? null,
    positions: user.userPositions.map(({ position: p }) => ({
      id: p.id, name: p.name, code: p.code, sort: p.sort, status: p.status,
      remark: p.remark ?? null,
      createdAt: formatDateTime(p.createdAt), updatedAt: formatDateTime(p.updatedAt),
    })),
    tenantName,
    viewingTenantId: authUser.viewingTenantId ?? null,
    roles: userRoleList,
    permissions,
    requirePasswordChange,
    createdAt: formatDateTime(user.createdAt),
    updatedAt: formatDateTime(user.updatedAt),
  };
}

export async function updateMyProfile(data: { nickname?: string; email?: string; phone?: string | null; gender?: string | null; avatar?: string | null }) {
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
  return { ...userInfo, roles: userRoleList, createdAt: formatDateTime(updated.createdAt), updatedAt: formatDateTime(updated.updatedAt) };
}

export async function changeMyPassword(oldPassword: string, newPassword: string) {
  const userId = currentUser().userId;
  const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  if (!user) throw new HTTPException(404, { message: '用户不存在' });
  const valid = await verifyPassword(oldPassword, user.password);
  if (!valid) throw new HTTPException(400, { message: '原密码错误' });
  const passwordError = validatePassword(newPassword, await passwordPolicyFor(user.tenantId));
  if (passwordError) throw new HTTPException(400, { message: passwordError });
  const hashed = await hashPassword(newPassword);
  await db.update(users).set({ password: hashed, passwordUpdatedAt: new Date() }).where(eq(users.id, userId));
  // 改密后其它设备全部下线（含被盗 refresh token），当前设备保留
  await forceLogoutAllByUserExcept(userId, currentUser().jti);
}

export async function listMyLoginLogs(query: { page?: number; pageSize?: number; eventType?: LoginEventType; status?: 'success' | 'fail'; startTime?: string; endTime?: string }) {
  const userId = currentUser().userId;
  const { page = 1, pageSize = 10, eventType, status, startTime, endTime } = query;
  const conditions = [eq(loginLogs.userId, userId)];
  if (eventType) conditions.push(eq(loginLogs.eventType, eventType));
  if (status) conditions.push(eq(loginLogs.status, status));
  conditions.push(...dateRangeConditions(loginLogs.createdAt, startTime, endTime));
  const where = and(...conditions);
  const [count, rows] = await Promise.all([
    db.$count(loginLogs, where),
    withPagination(db.select().from(loginLogs).where(where).orderBy(desc(loginLogs.createdAt)).$dynamic(), page, pageSize),
  ]);
  return { list: rows.map((r) => ({ ...r, createdAt: formatDateTime(r.createdAt) })), total: count, page, pageSize };
}

export async function listMyOperationLogs(query: { page?: number; pageSize?: number; module?: string; startTime?: string; endTime?: string }) {
  const userId = currentUser().userId;
  const { page = 1, pageSize = 10, module, startTime, endTime } = query;
  const conditions: (SQL | undefined)[] = [eq(operationLogs.userId, userId)];
  conditions.push(keywordCondition(module, [operationLogs.module]));
  conditions.push(...dateRangeConditions(operationLogs.createdAt, startTime, endTime));
  const where = and(...conditions);
  const [count, rows] = await Promise.all([
    db.$count(operationLogs, where),
    withPagination(db.select().from(operationLogs).where(where).orderBy(desc(operationLogs.createdAt)).$dynamic(), page, pageSize),
  ]);
  return { list: rows.map((r) => ({ ...r, createdAt: formatDateTime(r.createdAt) })), total: count, page, pageSize };
}

export async function listMySessions() {
  const { userId, jti: currentTokenId } = currentUser();
  const allSessions = await getOnlineSessions();
  const mySessions = allSessions.filter((s) => s.userId === userId);
  return mySessions.map((s) => ({
    tokenId: s.tokenId,
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
  const allSessions = await getOnlineSessions();
  const others = allSessions.filter((s) => s.userId === userId && s.tokenId !== currentTokenId);
  await Promise.all(others.map((s) => forceLogout(s.tokenId)));
  return others.length;
}

export async function deleteMySession(tokenId: string) {
  const { userId, jti: currentTokenId } = currentUser();
  if (tokenId === currentTokenId) throw new HTTPException(400, { message: '不能退出当前设备，请使用退出登录功能' });
  const allSessions = await getOnlineSessions();
  const session = allSessions.find((s) => s.tokenId === tokenId && s.userId === userId);
  if (!session) throw new HTTPException(404, { message: '会话不存在或已过期' });
  await forceLogout(tokenId);
}

export async function switchTenantView(targetTenantId: number | null, ip: string, ua: string) {
  const payload = currentUser();
  if (!isPlatformAdmin(payload)) throw new HTTPException(403, { message: '仅平台超管可切换租户' });
  if (targetTenantId !== null) {
    const [tenant] = await db.select().from(tenants).where(eq(tenants.id, targetTenantId)).limit(1);
    if (!tenant) throw new HTTPException(404, { message: '租户不存在' });
    if (tenant.status !== 'enabled') throw new HTTPException(403, { message: '租户已被禁用' });
    if (isTenantExpired(tenant)) throw new HTTPException(403, { message: '租户已过期' });
  }
  const tokenId = generateTokenId();
  const newAccessToken = await signToken<JwtPayload>(
    { userId: payload.userId, username: payload.username, roles: payload.roles, tenantId: payload.tenantId, viewingTenantId: targetTenantId, jti: tokenId },
    '2h',
  );
  const newRefreshToken = await signToken(
    { userId: payload.userId, username: payload.username, type: 'refresh', tenantId: payload.tenantId, viewingTenantId: targetTenantId, jti: tokenId },
    '30d',
  );
  const { browser, os } = parseUserAgent(ua);
  // 旧 jti 立即吊销（access / refresh 一并作废），新 jti 注册会话并签发 refresh 授权
  if (payload.jti) await removeSession(payload.jti);
  await Promise.all([
    registerSession({
      tokenId,
      userId: payload.userId,
      username: payload.username,
      nickname: payload.username,
      tenantId: payload.tenantId,
      ip,
      location: lookupIpLocation(ip),
      browser,
      os,
      loginAt: new Date(),
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
    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5373';
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
  const [record] = await db.select().from(passwordResetTokens)
    .where(and(eq(passwordResetTokens.token, token), gt(passwordResetTokens.expiresAt, now), isNull(passwordResetTokens.usedAt)))
    .limit(1);
  if (!record) throw new HTTPException(400, { message: '重置链接无效或已过期' });
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
  if (!user) throw new HTTPException(404, { message: '用户不存在' });
  const valid = await verifyPassword(password, user.password);
  if (!valid) throw new HTTPException(401, { message: '密码错误' });
}
