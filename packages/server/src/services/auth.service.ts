import { and, desc, eq, gt, gte, isNull, like, lte } from 'drizzle-orm';
import { db } from '../db';
import { users, loginLogs, tenants, operationLogs, passwordResetTokens } from '../db/schema';
import { signToken, verifyToken } from '../lib/jwt';
import { generateTokenId, registerSession, removeSession, checkLoginLock, recordLoginFailure, clearLoginAttempts, getOnlineSessions, forceLogout, getSession } from '../lib/session-manager';
import type { JwtPayload } from '../middleware/auth';
import { formatDateTime, parseDateTimeInput } from '../lib/datetime';
import { parseUserAgent } from '../lib/request-helpers';
import { escapeLike, withPagination } from '../lib/where-helpers';
import { lookupIpLocation } from '../lib/ip-location';

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
  user: { id: number; username: string; tenantId?: number | null },
  roleCodes: string[],
) {
  const tokenId = generateTokenId();
  const tenantId = user.tenantId ?? null;
  const accessToken = await signToken<JwtPayload>(
    { userId: user.id, username: user.username, roles: roleCodes, tenantId, jti: tokenId },
    '2h',
  );
  const refreshToken = await signToken(
    { userId: user.id, username: user.username, type: 'refresh', tenantId, jti: tokenId },
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

export interface LoginLogParams {
  username: string;
  status: 'success' | 'fail';
  message: string;
  userId?: number;
  tenantId?: number | null;
  ip: string;
  ua: string;
  deviceInfo?: DeviceInfo;
}

export async function recordLoginLog(params: LoginLogParams) {
  const { username, status, message, userId, tenantId, ip, ua, deviceInfo } = params;
  const { browser, os } = parseUserAgent(ua);
  await db.insert(loginLogs).values({
    username,
    userId,
    ip,
    location: ip ? lookupIpLocation(ip) : null,
    browser,
    os,
    userAgent: ua || null,
    status,
    message,
    tenantId: tenantId ?? null,
    screenWidth: deviceInfo?.screenWidth ?? null,
    screenHeight: deviceInfo?.screenHeight ?? null,
    devicePixelRatio: deviceInfo?.devicePixelRatio ?? null,
    gpu: deviceInfo?.gpu ?? null,
    cpuCores: deviceInfo?.cpuCores ?? null,
    memoryGb: deviceInfo?.memoryGb ?? null,
  });
}

// ─── 从请求中提取客户端信息 ───────────────────────────────────────────────────

export function getClientInfo(headers: { get: (key: string) => string | null | undefined }) {
  const ip = headers.get('x-forwarded-for') || headers.get('x-real-ip') || '127.0.0.1';
  const ua = headers.get('user-agent') || '';
  return { ip, ua };
}

// ─── 以下为下沉后的登录/注册/会话业务逻辑 ─────────────────────────────────────
import bcrypt from 'bcryptjs';
import { randomBytes } from 'node:crypto';
import { config } from '../config';
import { sendMail } from '../lib/email';
import { isSuperAdmin, getUserPermissions } from '../lib/permissions';
import { verifyCaptcha } from '../lib/captcha';
import { getConfigBoolean, getConfigNumber } from '../lib/system-config';
import { isPlatformAdmin } from '../lib/tenant';
import { HTTPException } from 'hono/http-exception';
import { currentUser } from '../lib/context';

async function checkPasswordExpiry(user: { passwordUpdatedAt: Date | null; createdAt: Date }): Promise<boolean> {
  const [enabled, expiryDays] = await Promise.all([
    getConfigBoolean('password_expiry_enabled', false),
    getConfigNumber('password_expiry_days', 90),
  ]);
  if (!enabled) return false;
  const pwdUpdate = user.passwordUpdatedAt || user.createdAt;
  const days = (Date.now() - pwdUpdate.getTime()) / (1000 * 60 * 60 * 24);
  return days > expiryDays;
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
}

export async function login(input: LoginInput) {
  const captchaEnabled = await getConfigBoolean('captcha_enabled', false);
  if (captchaEnabled) {
    if (!input.captchaId || !input.captchaCode) throw new HTTPException(400, { message: '请输入验证码' });
    if (!verifyCaptcha(input.captchaId, input.captchaCode)) throw new HTTPException(400, { message: '验证码错误或已过期' });
  }

  let tenantId: number | null = null;
  if (config.multiTenantMode && input.tenantCode) {
    const [tenant] = await db.select().from(tenants).where(eq(tenants.code, input.tenantCode)).limit(1);
    if (!tenant) throw new HTTPException(400, { message: '租户不存在' });
    if (tenant.status === 'disabled') throw new HTTPException(403, { message: '租户已被禁用' });
    if (tenant.expireAt && tenant.expireAt < new Date()) throw new HTTPException(403, { message: '租户已过期' });
    tenantId = tenant.id;
  }

  const remainingLockSeconds = await checkLoginLock(input.username);
  if (remainingLockSeconds > 0) {
    const remainingMinutes = Math.ceil(remainingLockSeconds / 60);
    throw new HTTPException(423, { message: `账号已被锁定，请 ${remainingMinutes} 分钟后重试` });
  }
  const [loginMaxAttempts, loginLockDurationMinutes] = await Promise.all([
    getConfigNumber('login_max_attempts', 10),
    getConfigNumber('login_lock_duration_minutes', 30),
  ]);
  const lockDurationSeconds = loginLockDurationMinutes * 60;

  let userWhere;
  if (config.multiTenantMode && tenantId !== null) userWhere = and(eq(users.username, input.username), eq(users.tenantId, tenantId));
  else if (config.multiTenantMode) userWhere = and(eq(users.username, input.username), isNull(users.tenantId));
  else userWhere = eq(users.username, input.username);

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
  const valid = await bcrypt.compare(input.password, user.password);
  if (!valid) {
    await Promise.all([
      recordLoginLog({ ip: input.ip, ua: input.ua, username: input.username, status: 'fail', message: '用户名或密码错误', userId: user.id, tenantId }),
      recordLoginFailure(input.username, loginMaxAttempts, lockDurationSeconds),
    ]);
    throw new HTTPException(400, { message: '用户名或密码错误' });
  }

  const [requirePasswordChange, userRoleList] = await Promise.all([
    checkPasswordExpiry(user),
    getUserRoles(user.id),
    clearLoginAttempts(input.username),
  ]);
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
      browser,
      os,
      loginAt: new Date(),
    }),
    recordLoginLog({ ip: input.ip, ua: input.ua, username: input.username, status: 'success', message: '登录成功', userId: user.id, tenantId, deviceInfo: input.deviceInfo }),
  ]);
  const { password: _pw, ...userInfo } = user;
  return {
    user: { ...userInfo, roles: userRoleList, createdAt: formatDateTime(user.createdAt), updatedAt: formatDateTime(user.updatedAt), requirePasswordChange },
    token: { accessToken, refreshToken },
    requirePasswordChange,
  };
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
  const allow = await getConfigBoolean('allow_registration', false);
  if (!allow) throw new HTTPException(403, { message: '系统已关闭注册功能' });

  const [[usernameRow], [emailRow]] = await Promise.all([
    db.select({ id: users.id }).from(users).where(and(eq(users.username, input.username), isNull(users.tenantId))).limit(1),
    db.select({ id: users.id }).from(users).where(and(eq(users.email, input.email), isNull(users.tenantId))).limit(1),
  ]);
  if (usernameRow) throw new HTTPException(400, { message: '用户名已存在' });
  if (emailRow) throw new HTTPException(400, { message: '邮箱已被注册' });

  const hashed = await bcrypt.hash(input.password, 10);
  const [user] = await db.insert(users).values({
    username: input.username, nickname: input.nickname, email: input.email, password: hashed,
  }).returning();

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
      browser,
      os,
      loginAt: new Date(),
    }),
    recordLoginLog({ ip: input.ip, ua: input.ua, username: input.username, status: 'success', message: '注册并自动登录成功', userId: user.id }),
  ]);
  const { password: _pw, ...userInfo } = user;
  return {
    user: { ...userInfo, roles: userRoleList, createdAt: formatDateTime(user.createdAt), updatedAt: formatDateTime(user.updatedAt) },
    token: { accessToken, refreshToken },
  };
}

export async function refreshAccessToken(token: string, clientInfo?: { ip: string; ua: string }) {
  let payload;
  try {
    payload = await verifyToken<{ userId: number; username: string; type?: string; jti?: string; tenantId?: number | null }>(token);
  } catch {
    throw new HTTPException(401, { message: 'refresh token 已过期' });
  }
  if (payload.type !== 'refresh') throw new HTTPException(401, { message: '无效的 refresh token' });
  const [u] = await db.select({ status: users.status, nickname: users.nickname }).from(users).where(eq(users.id, payload.userId)).limit(1);
  if (!u) throw new HTTPException(401, { message: '用户不存在' });
  if (u.status === 'disabled') throw new HTTPException(403, { message: '账号已被禁用' });
  const tokenId = payload.jti ?? generateTokenId();
  const userRoleList = await getUserRoles(payload.userId);
  const accessToken = await signToken<JwtPayload>(
    { userId: payload.userId, username: payload.username, roles: userRoleList.map((r) => r.code), tenantId: payload.tenantId ?? null, jti: tokenId },
    '2h',
  );
  // 若 Redis 中无此 session（Redis 重启或 TTL 过期），重新注册以保持在线用户列表准确
  const existing = await getSession(tokenId);
  if (!existing && clientInfo) {
    const { browser, os } = parseUserAgent(clientInfo.ua);
    await registerSession({
      tokenId,
      userId: payload.userId,
      username: payload.username,
      nickname: u.nickname,
      tenantId: payload.tenantId ?? null,
      ip: clientInfo.ip,
      browser,
      os,
      loginAt: new Date(),
    });
  }
  return { accessToken };
}

export async function logoutSession() {
  const tokenId = currentUser().jti;
  if (tokenId) await removeSession(tokenId);
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

export async function getMyProfile() {
  const userId = currentUser().userId;
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
  const permissions = isSuperAdmin(userRoleList.map((r) => r.code)) ? ['*'] : await getUserPermissions(user.id);
  const tenantName = tenantRows[0]?.name ?? null;
  const { password: _pw, preferences: _prefs, department, userPositions: _up, userRoles: _ur, ...userInfo } = user;

  // 查询上次登录记录（最近 2 条成功登录，取第 2 条作为"上次"）
  const recentLogins = await db
    .select({ createdAt: loginLogs.createdAt, ip: loginLogs.ip })
    .from(loginLogs)
    .where(and(eq(loginLogs.userId, userId), eq(loginLogs.status, 'success')))
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
    roles: userRoleList,
    permissions,
    requirePasswordChange,
    createdAt: formatDateTime(user.createdAt),
    updatedAt: formatDateTime(user.updatedAt),
  };
}

export async function updateMyProfile(data: { nickname?: string; email?: string; phone?: string | null; gender?: string | null; avatar?: string | null }) {
  const userId = currentUser().userId;
  if (data.email) {
    const [existing] = await db.select({ id: users.id }).from(users).where(eq(users.email, data.email)).limit(1);
    if (existing && existing.id !== userId) throw new HTTPException(400, { message: '邮箱已被使用' });
  }
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
  const valid = await bcrypt.compare(oldPassword, user.password);
  if (!valid) throw new HTTPException(400, { message: '原密码错误' });
  const hashed = await bcrypt.hash(newPassword, 10);
  await db.update(users).set({ password: hashed, passwordUpdatedAt: new Date() }).where(eq(users.id, userId));
}

export async function listMyLoginLogs(query: { page?: number; pageSize?: number; status?: 'success' | 'fail'; startTime?: string; endTime?: string }) {
  const userId = currentUser().userId;
  const { page = 1, pageSize = 10, status, startTime, endTime } = query;
  const conditions = [eq(loginLogs.userId, userId)];
  if (status) conditions.push(eq(loginLogs.status, status));
  const parsedStartTime = parseDateTimeInput(startTime);
  const parsedEndTime = parseDateTimeInput(endTime);
  if (parsedStartTime) conditions.push(gte(loginLogs.createdAt, parsedStartTime));
  if (parsedEndTime) conditions.push(lte(loginLogs.createdAt, parsedEndTime));
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
  const conditions = [eq(operationLogs.userId, userId)];
  if (module) conditions.push(like(operationLogs.module, `%${escapeLike(module)}%`));
  const parsedStartTime = parseDateTimeInput(startTime);
  const parsedEndTime = parseDateTimeInput(endTime);
  if (parsedStartTime) conditions.push(gte(operationLogs.createdAt, parsedStartTime));
  if (parsedEndTime) conditions.push(lte(operationLogs.createdAt, parsedEndTime));
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
  if (payload.jti) await removeSession(payload.jti);
  await registerSession({
    tokenId,
    userId: payload.userId,
    username: payload.username,
    nickname: payload.username,
    tenantId: payload.tenantId,
    ip,
    browser,
    os,
    loginAt: new Date(),
  });
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
  const enabled = await getConfigBoolean('forgot_password_enabled');
  if (!enabled) throw new HTTPException(403, { message: '忘记密码功能未开启' });
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
  const hashed = await bcrypt.hash(newPassword, 10);
  await db.transaction(async (tx) => {
    await tx.update(users).set({ password: hashed }).where(eq(users.id, record.userId));
    await tx.update(passwordResetTokens).set({ usedAt: now }).where(eq(passwordResetTokens.id, record.id));
  });
}
