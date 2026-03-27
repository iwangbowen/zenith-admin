import { Hono } from 'hono';
import type { Context } from 'hono';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { eq, desc, sql, gte, lte, like, and, isNull } from 'drizzle-orm';
import { UAParser } from 'ua-parser-js';
import { db } from '../db';
import { users, userRoles, roles, loginLogs, tenants, operationLogs } from '../db/schema';
import { config } from '../config';
import { loginSchema, registerSchema, changePasswordSchema, updateProfileSchema, switchTenantSchema } from '@zenith/shared';
import { authMiddleware } from '../middleware/auth';
import type { JwtPayload } from '../middleware/auth';
import { isSuperAdmin, getUserPermissions } from '../lib/permissions';
import { generateCaptcha, verifyCaptcha } from '../lib/captcha';
import { getConfigBoolean, getConfigNumber } from '../lib/system-config';
import { generateTokenId, registerSession, removeSession, checkLoginLock, recordLoginFailure, clearLoginAttempts, getOnlineSessions, forceLogout } from '../lib/session-manager';
import { isPlatformAdmin } from '../lib/tenant';

const auth = new Hono();

async function recordLoginLog(c: Context, username: string, status: 'success' | 'fail', message: string, userId?: number, tenantId?: number | null) {
  const ip = c.req.header('x-forwarded-for') || c.req.header('x-real-ip') || '127.0.0.1';
  const ua = c.req.header('user-agent') || '';
  const parser = new UAParser(ua);
  const browser = parser.getBrowser();
  const os = parser.getOS();

  await db.insert(loginLogs).values({
    username,
    userId,
    ip,
    browser: browser.name ? `${browser.name} ${browser.version || ''}`.trim() : 'Unknown',
    os: os.name ? `${os.name} ${os.version || ''}`.trim() : 'Unknown',
    status,
    message,
    tenantId: tenantId ?? null,
  });
}

function getAuthUser(c: { get: (key: 'user') => unknown }): JwtPayload {
  return c.get('user') as JwtPayload;
}

async function getUserRoles(userId: number) {
  const rows = await db
    .select({ id: roles.id, name: roles.name, code: roles.code, description: roles.description, status: roles.status, createdAt: roles.createdAt, updatedAt: roles.updatedAt })
    .from(userRoles)
    .innerJoin(roles, eq(userRoles.roleId, roles.id))
    .where(eq(userRoles.userId, userId));
  return rows.map((r) => ({ ...r, createdAt: r.createdAt.toISOString(), updatedAt: r.updatedAt.toISOString() }));
}

auth.get('/captcha', async (c) => {
  const enabled = await getConfigBoolean('captcha_enabled', false);
  if (!enabled) {
    return c.json({ code: 0, message: 'ok', data: { enabled: false, captchaId: '', svg: '' } });
  }
  const result = generateCaptcha();
  return c.json({ code: 0, message: 'ok', data: { enabled: true, captchaId: result.captchaId, svg: result.captchaImage } });
});

auth.post('/login', async (c) => {
  const body = await c.req.json();
  const result = loginSchema.safeParse(body);
  if (!result.success) {
    return c.json({ code: 400, message: result.error.issues[0].message, data: null }, 400);
  }

  // Check if captcha is enabled
  const captchaEnabled = await getConfigBoolean('captcha_enabled', false);
  if (captchaEnabled) {
    const { captchaId, captchaCode } = result.data;
    if (!captchaId || !captchaCode) {
      return c.json({ code: 400, message: '请输入验证码', data: null }, 400);
    }
    if (!verifyCaptcha(captchaId, captchaCode)) {
      return c.json({ code: 400, message: '验证码错误或已过期', data: null }, 400);
    }
  }

  const { username, password } = result.data;

  // ─── 多租户：解析 tenantCode ───────────────────────────────────────────────
  let tenantId: number | null = null;
  if (config.multiTenantMode && result.data.tenantCode) {
    const [tenant] = await db.select().from(tenants).where(eq(tenants.code, result.data.tenantCode)).limit(1);
    if (!tenant) {
      return c.json({ code: 400, message: '租户不存在', data: null }, 400);
    }
    if (tenant.status === 'disabled') {
      return c.json({ code: 403, message: '租户已被禁用', data: null }, 403);
    }
    if (tenant.expireAt && new Date(tenant.expireAt) < new Date()) {
      return c.json({ code: 403, message: '租户已过期', data: null }, 403);
    }
    tenantId = tenant.id;
  }

  // ─── 登录失败锁定检查 ────────────────────────────────────────────────────
  const remainingLockSeconds = await checkLoginLock(username);
  if (remainingLockSeconds > 0) {
    const remainingMinutes = Math.ceil(remainingLockSeconds / 60);
    return c.json({ code: 423, message: `账号已被锁定，请 ${remainingMinutes} 分钟后重试`, data: null }, 423);
  }

  const [loginMaxAttempts, loginLockDurationMinutes] = await Promise.all([
    getConfigNumber('login_max_attempts', 10),
    getConfigNumber('login_lock_duration_minutes', 30),
  ]);
  const lockDurationSeconds = loginLockDurationMinutes * 60;

  const userWhere = config.multiTenantMode && tenantId !== null
    ? and(eq(users.username, username), eq(users.tenantId, tenantId))
    : config.multiTenantMode
      ? and(eq(users.username, username), isNull(users.tenantId))
      : eq(users.username, username);

  const [user] = await db.select().from(users).where(userWhere).limit(1);

  if (!user) {
    await Promise.all([
      recordLoginLog(c, username, 'fail', '用户名或密码错误', undefined, tenantId),
      recordLoginFailure(username, loginMaxAttempts, lockDurationSeconds),
    ]);
    return c.json({ code: 400, message: '用户名或密码错误', data: null }, 400);
  }

  if (user.status === 'disabled') {
    await recordLoginLog(c, username, 'fail', '账号已被禁用', user.id, tenantId);
    return c.json({ code: 403, message: '账号已被禁用', data: null }, 403);
  }

  const valid = await bcrypt.compare(password, user.password);
  if (!valid) {
    await Promise.all([
      recordLoginLog(c, username, 'fail', '用户名或密码错误', user.id, tenantId),
      recordLoginFailure(username, loginMaxAttempts, lockDurationSeconds),
    ]);
    return c.json({ code: 400, message: '用户名或密码错误', data: null }, 400);
  }


  // Check password expiry
  let requirePasswordChange = false;
  const expiryEnabled = await getConfigBoolean('password_expiry_enabled', false);
  if (expiryEnabled) {
    const expiryDays = await getConfigNumber('password_expiry_days', 90);
    const pwdUpdate = user.passwordUpdatedAt || user.createdAt;
    const msInDay = 1000 * 60 * 60 * 24;
    const daysSinceUpdate = (Date.now() - pwdUpdate.getTime()) / msInDay;
    if (daysSinceUpdate > expiryDays) {
      requirePasswordChange = true;
    }
  }

  // 登录成功，清除失败计数
  await clearLoginAttempts(username);

  const userRoleList = await getUserRoles(user.id);
  const tokenId = generateTokenId();

  const accessToken = jwt.sign(
    { userId: user.id, username: user.username, roles: userRoleList.map((r) => r.code), tenantId: user.tenantId ?? null, jti: tokenId } satisfies JwtPayload,
    config.jwtSecret,
    { expiresIn: '2h' }
  );

  const refreshToken = jwt.sign(
    { userId: user.id, username: user.username, type: 'refresh', tenantId: user.tenantId ?? null, jti: tokenId },
    config.jwtSecret,
    { expiresIn: '30d' }
  );

  // Register session for online user tracking
  const ip = c.req.header('x-forwarded-for') || c.req.header('x-real-ip') || '127.0.0.1';
  const ua = c.req.header('user-agent') || '';
  const parser = new UAParser(ua);
  const browserInfo = parser.getBrowser();
  const osInfo = parser.getOS();

  await registerSession({
    tokenId,
    userId: user.id,
    username: user.username,
    nickname: user.nickname,
    tenantId: user.tenantId ?? null,
    ip,
    browser: browserInfo.name ? `${browserInfo.name} ${browserInfo.version || ''}`.trim() : 'Unknown',
    os: osInfo.name ? `${osInfo.name} ${osInfo.version || ''}`.trim() : 'Unknown',
    loginAt: new Date(),
  });

  await recordLoginLog(c, username, 'success', '登录成功', user.id, tenantId);

  const { password: _, ...userInfo } = user;
  return c.json({
    code: 0,
    message: '登录成功',
    data: {
      user: { ...userInfo, roles: userRoleList, createdAt: user.createdAt.toISOString(), updatedAt: user.updatedAt.toISOString(), requirePasswordChange },
      token: { accessToken, refreshToken },
      requirePasswordChange,
    },
  });
});

auth.post('/register', async (c) => {
  const allowRegistration = await getConfigBoolean('allow_registration', false);
  if (!allowRegistration) {
    return c.json({ code: 403, message: '系统已关闭注册功能', data: null }, 403);
  }

  const body = await c.req.json();
  const result = registerSchema.safeParse(body);
  if (!result.success) {
    return c.json({ code: 400, message: result.error.issues[0].message, data: null }, 400);
  }

  const { username, nickname, email, password } = result.data;

  const [existing] = await db.select().from(users).where(eq(users.username, username)).limit(1);
  if (existing) {
    return c.json({ code: 400, message: '用户名已存在', data: null }, 400);
  }

  const [existingEmail] = await db.select().from(users).where(eq(users.email, email)).limit(1);
  if (existingEmail) {
    return c.json({ code: 400, message: '邮箱已被注册', data: null }, 400);
  }

  const hashedPassword = await bcrypt.hash(password, 10);
  const [user] = await db
    .insert(users)
    .values({ username, nickname, email, password: hashedPassword })
    .returning();

  const userRoleList = await getUserRoles(user.id);
  const tokenId = generateTokenId();

  const accessToken = jwt.sign(
    { userId: user.id, username: user.username, roles: userRoleList.map((r) => r.code), tenantId: user.tenantId ?? null, jti: tokenId } satisfies JwtPayload,
    config.jwtSecret,
    { expiresIn: '2h' }
  );

  const refreshToken = jwt.sign(
    { userId: user.id, username: user.username, type: 'refresh', tenantId: user.tenantId ?? null, jti: tokenId },
    config.jwtSecret,
    { expiresIn: '30d' }
  );

  // Register session for online user tracking (same as login)
  const regIp = c.req.header('x-forwarded-for') || c.req.header('x-real-ip') || '127.0.0.1';
  const regUa = c.req.header('user-agent') || '';
  const regParser = new UAParser(regUa);
  const regBrowser = regParser.getBrowser();
  const regOs = regParser.getOS();

  await registerSession({
    tokenId,
    userId: user.id,
    username: user.username,
    nickname: user.nickname,
    tenantId: user.tenantId ?? null,
    ip: regIp,
    browser: regBrowser.name ? `${regBrowser.name} ${regBrowser.version || ''}`.trim() : 'Unknown',
    os: regOs.name ? `${regOs.name} ${regOs.version || ''}`.trim() : 'Unknown',
    loginAt: new Date(),
  });

  await recordLoginLog(c, username, 'success', '注册并自动登录成功', user.id);

  const { password: _, ...userInfo } = user;
  return c.json({
    code: 0,
    message: '注册成功',
    data: {
      user: { ...userInfo, roles: userRoleList, createdAt: user.createdAt.toISOString(), updatedAt: user.updatedAt.toISOString() },
      token: { accessToken, refreshToken },
    },
  });
});

// Refresh token endpoint
auth.post('/refresh', async (c) => {
  const body = await c.req.json();
  const token = body.refreshToken;
  if (!token) {
    return c.json({ code: 400, message: 'refreshToken 不能为空', data: null }, 400);
  }

  try {
    const payload = jwt.verify(token, config.jwtSecret) as { userId: number; username: string; type?: string; jti?: string; tenantId?: number | null };
    if (payload.type !== 'refresh') {
      return c.json({ code: 401, message: '无效的 refresh token', data: null }, 401);
    }

    // Check user status — disabled users must not be allowed to refresh
    const [refreshUser] = await db.select({ status: users.status }).from(users).where(eq(users.id, payload.userId)).limit(1);
    if (!refreshUser) {
      return c.json({ code: 401, message: '用户不存在', data: null }, 401);
    }
    if (refreshUser.status === 'disabled') {
      return c.json({ code: 403, message: '账号已被禁用', data: null }, 403);
    }

    // Reuse the original jti so the existing Redis session remains valid
    const tokenId = payload.jti ?? generateTokenId();

    // Get fresh user roles
    const userRoleList = await getUserRoles(payload.userId);

    const accessToken = jwt.sign(
      { userId: payload.userId, username: payload.username, roles: userRoleList.map((r) => r.code), tenantId: payload.tenantId ?? null, jti: tokenId } satisfies JwtPayload,
      config.jwtSecret,
      { expiresIn: '2h' }
    );

    return c.json({
      code: 0,
      message: 'ok',
      data: { accessToken },
    });
  } catch {
    return c.json({ code: 401, message: 'refresh token 已过期', data: null }, 401);
  }
});

// 退出登录
auth.post('/logout', authMiddleware, async (c) => {
  const payload = getAuthUser(c as { get: (key: 'user') => unknown });
  if (payload.jti) {
    await removeSession(payload.jti);
  }
  return c.json({ code: 0, message: '已退出登录', data: null });
});

auth.get('/me', authMiddleware, async (c) => {
  const payload = getAuthUser(c as { get: (key: 'user') => unknown });
  const [user] = await db.select().from(users).where(eq(users.id, payload.userId)).limit(1);
  if (!user) {
    return c.json({ code: 404, message: '用户不存在', data: null }, 404);
  }
  const userRoleList = await getUserRoles(user.id);

  // Collect permission codes for this user
  let permissions: string[];
  if (isSuperAdmin(userRoleList.map((r) => r.code))) {
    permissions = ['*']; // super_admin has all permissions
  } else {
    permissions = await getUserPermissions(user.id);
  }

  // Check password expiry
  let requirePasswordChange = false;
  const expiryEnabled = await getConfigBoolean('password_expiry_enabled', false);
  if (expiryEnabled) {
    const expiryDays = await getConfigNumber('password_expiry_days', 90);
    const pwdUpdate = user.passwordUpdatedAt || user.createdAt;
    const msInDay = 1000 * 60 * 60 * 24;
    const daysSinceUpdate = (Date.now() - pwdUpdate.getTime()) / msInDay;
    if (daysSinceUpdate > expiryDays) {
      requirePasswordChange = true;
    }
  }

  const { password: _, ...userInfo } = user;

  // Resolve tenant name
  let tenantName: string | null = null;
  if (user.tenantId) {
    const [tenant] = await db.select({ name: tenants.name }).from(tenants).where(eq(tenants.id, user.tenantId)).limit(1);
    tenantName = tenant?.name ?? null;
  }

  return c.json({
    code: 0,
    message: 'ok',
    data: {
      ...userInfo,
      tenantName,
      roles: userRoleList,
      permissions,
      requirePasswordChange,
      createdAt: user.createdAt.toISOString(),
      updatedAt: user.updatedAt.toISOString(),
    },
  });
});

// 修改个人资料
auth.put('/profile', authMiddleware, async (c) => {
  const payload = getAuthUser(c as { get: (key: 'user') => unknown });
  const body = await c.req.json();
  const result = updateProfileSchema.safeParse(body);
  if (!result.success) {
    return c.json({ code: 400, message: result.error.issues[0].message, data: null }, 400);
  }

  if (result.data.email) {
    const [existing] = await db.select({ id: users.id }).from(users).where(eq(users.email, result.data.email)).limit(1);
    if (existing && existing.id !== payload.userId) {
      return c.json({ code: 400, message: '邮箱已被使用', data: null }, 400);
    }
  }

  const [updated] = await db
    .update(users)
    .set({ ...result.data, updatedAt: new Date() })
    .where(eq(users.id, payload.userId))
    .returning();

  const userRoleList = await getUserRoles(payload.userId);
  const { password: _, ...userInfo } = updated;
  return c.json({
    code: 0,
    message: '资料已更新',
    data: { ...userInfo, roles: userRoleList, createdAt: updated.createdAt.toISOString(), updatedAt: updated.updatedAt.toISOString() },
  });
});

// 修改密码
auth.put('/password', authMiddleware, async (c) => {
  const payload = getAuthUser(c as { get: (key: 'user') => unknown });
  const body = await c.req.json();
  const result = changePasswordSchema.safeParse(body);
  if (!result.success) {
    return c.json({ code: 400, message: result.error.issues[0].message, data: null }, 400);
  }

  const [user] = await db.select().from(users).where(eq(users.id, payload.userId)).limit(1);
  if (!user) {
    return c.json({ code: 404, message: '用户不存在', data: null }, 404);
  }

  const valid = await bcrypt.compare(result.data.oldPassword, user.password);
  if (!valid) {
    return c.json({ code: 400, message: '原密码错误', data: null }, 400);
  }

  const hashed = await bcrypt.hash(result.data.newPassword, 10);
  await db.update(users).set({ password: hashed, passwordUpdatedAt: new Date(), updatedAt: new Date() }).where(eq(users.id, payload.userId));

  return c.json({ code: 0, message: '密码修改成功', data: null });
});

// 我的登录记录
auth.get('/my-login-logs', authMiddleware, async (c) => {
  const payload = getAuthUser(c as { get: (key: 'user') => unknown });
  const page = Number(c.req.query('page')) || 1;
  const pageSize = Number(c.req.query('pageSize')) || 10;
  const status = c.req.query('status') as 'success' | 'fail' | undefined;
  const startTime = c.req.query('startTime');
  const endTime = c.req.query('endTime');

  const conditions = [eq(loginLogs.userId, payload.userId)];
  if (status) conditions.push(eq(loginLogs.status, status));
  if (startTime) conditions.push(gte(loginLogs.createdAt, new Date(startTime)));
  if (endTime) conditions.push(lte(loginLogs.createdAt, new Date(endTime)));

  const where = and(...conditions);

  const [{ count }] = await db
    .select({ count: sql<number>`cast(count(*) as integer)` })
    .from(loginLogs)
    .where(where);

  const rows = await db
    .select()
    .from(loginLogs)
    .where(where)
    .orderBy(desc(loginLogs.createdAt))
    .limit(pageSize)
    .offset((page - 1) * pageSize);

  return c.json({
    code: 0,
    message: 'ok',
    data: {
      list: rows.map((r) => ({ ...r, createdAt: r.createdAt.toISOString() })),
      total: count,
      page,
      pageSize,
    },
  });
});

// 我的操作记录
auth.get('/my-operation-logs', authMiddleware, async (c) => {
  const payload = getAuthUser(c as { get: (key: 'user') => unknown });
  const page = Number(c.req.query('page')) || 1;
  const pageSize = Number(c.req.query('pageSize')) || 10;
  const module = c.req.query('module');
  const startTime = c.req.query('startTime');
  const endTime = c.req.query('endTime');

  const conditions = [eq(operationLogs.userId, payload.userId)];
  if (module) conditions.push(like(operationLogs.module, `%${module}%`));
  if (startTime) conditions.push(gte(operationLogs.createdAt, new Date(startTime)));
  if (endTime) conditions.push(lte(operationLogs.createdAt, new Date(endTime)));

  const where = and(...conditions);

  const [{ count }] = await db
    .select({ count: sql<number>`cast(count(*) as integer)` })
    .from(operationLogs)
    .where(where);

  const rows = await db
    .select()
    .from(operationLogs)
    .where(where)
    .orderBy(desc(operationLogs.createdAt))
    .limit(pageSize)
    .offset((page - 1) * pageSize);

  return c.json({
    code: 0,
    message: 'ok',
    data: {
      list: rows.map((r) => ({ ...r, createdAt: r.createdAt.toISOString() })),
      total: count,
      page,
      pageSize,
    },
  });
});

// ─── 我的会话管理 ─────────────────────────────────────────────────────────────
auth.get('/my-sessions', authMiddleware, async (c) => {
  const payload = getAuthUser(c as { get: (key: 'user') => unknown });
  const allSessions = await getOnlineSessions();
  const mySessions = allSessions.filter((s) => s.userId === payload.userId);
  return c.json({
    code: 0,
    message: 'ok',
    data: mySessions.map((s) => ({
      tokenId: s.tokenId,
      ip: s.ip,
      browser: s.browser,
      os: s.os,
      loginAt: s.loginAt.toISOString(),
      lastActiveAt: s.lastActiveAt.toISOString(),
      isCurrent: s.tokenId === payload.jti,
    })),
  });
});

// 退出全部其他设备（保留当前会话）
auth.delete('/my-sessions/others', authMiddleware, async (c) => {
  const payload = getAuthUser(c as { get: (key: 'user') => unknown });
  const allSessions = await getOnlineSessions();
  const others = allSessions.filter((s) => s.userId === payload.userId && s.tokenId !== payload.jti);
  await Promise.all(others.map((s) => forceLogout(s.tokenId)));
  return c.json({
    code: 0,
    message: `已退出 ${others.length} 个其他设备`,
    data: { count: others.length },
  });
});

// 退出指定设备（不能退出自己当前的设备）
auth.delete('/my-sessions/:tokenId', authMiddleware, async (c) => {
  const payload = getAuthUser(c as { get: (key: 'user') => unknown });
  const tokenId = c.req.param('tokenId');
  if (tokenId === payload.jti) {
    return c.json({ code: 400, message: '不能退出当前设备，请使用退出登录功能', data: null }, 400);
  }
  const allSessions = await getOnlineSessions();
  const session = allSessions.find((s) => s.tokenId === tokenId && s.userId === payload.userId);
  if (!session) {
    return c.json({ code: 404, message: '会话不存在或已过期', data: null }, 404);
  }
  await forceLogout(tokenId!);
  return c.json({ code: 0, message: '已退出该设备', data: null });
});

// ─── 切换租户视角（仅平台超管） ─────────────────────────────────────────────
auth.post('/switch-tenant', authMiddleware, async (c) => {
  const payload = getAuthUser(c as { get: (key: 'user') => unknown });

  if (!isPlatformAdmin(payload)) {
    return c.json({ code: 403, message: '仅平台超管可切换租户', data: null }, 403);
  }

  const body = await c.req.json();
  const result = switchTenantSchema.safeParse(body);
  if (!result.success) {
    return c.json({ code: 400, message: result.error.issues[0].message, data: null }, 400);
  }

  const { tenantId: targetTenantId } = result.data;

  // Validate target tenant exists (if not null)
  if (targetTenantId !== null) {
    const [tenant] = await db.select().from(tenants).where(eq(tenants.id, targetTenantId)).limit(1);
    if (!tenant) {
      return c.json({ code: 404, message: '租户不存在', data: null }, 404);
    }
  }

  const tokenId = generateTokenId();
  const newAccessToken = jwt.sign(
    { userId: payload.userId, username: payload.username, roles: payload.roles, tenantId: payload.tenantId, viewingTenantId: targetTenantId, jti: tokenId } satisfies JwtPayload,
    config.jwtSecret,
    { expiresIn: '2h' }
  );

  const newRefreshToken = jwt.sign(
    { userId: payload.userId, username: payload.username, type: 'refresh', tenantId: payload.tenantId, viewingTenantId: targetTenantId, jti: tokenId },
    config.jwtSecret,
    { expiresIn: '30d' }
  );

  // Re-register session
  const ip = c.req.header('x-forwarded-for') || c.req.header('x-real-ip') || '127.0.0.1';
  const ua = c.req.header('user-agent') || '';
  const uaParser = new UAParser(ua);
  const browserInfo = uaParser.getBrowser();
  const osInfo = uaParser.getOS();

  // Remove old session
  if (payload.jti) await removeSession(payload.jti);

  await registerSession({
    tokenId,
    userId: payload.userId,
    username: payload.username,
    nickname: payload.username,
    tenantId: payload.tenantId,
    ip,
    browser: browserInfo.name ? `${browserInfo.name} ${browserInfo.version || ''}`.trim() : 'Unknown',
    os: osInfo.name ? `${osInfo.name} ${osInfo.version || ''}`.trim() : 'Unknown',
    loginAt: new Date(),
  });

  return c.json({
    code: 0,
    message: targetTenantId === null ? '已切换回平台视角' : '已切换租户视角',
    data: { accessToken: newAccessToken, refreshToken: newRefreshToken, viewingTenantId: targetTenantId },
  });
});

// ─── 获取租户列表（仅平台超管，用于前端租户切换选择器）──────────────────────
auth.get('/tenants', authMiddleware, async (c) => {
  const payload = getAuthUser(c as { get: (key: 'user') => unknown });
  if (!isPlatformAdmin(payload)) {
    return c.json({ code: 403, message: '无权限', data: null }, 403);
  }

  const rows = await db.select({
    id: tenants.id,
    name: tenants.name,
    code: tenants.code,
    status: tenants.status,
  }).from(tenants).where(eq(tenants.status, 'active'));

  return c.json({ code: 0, message: 'ok', data: rows });
});

export default auth;
