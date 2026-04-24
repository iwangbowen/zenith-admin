import { OpenAPIHono, createRoute, defineOpenAPIRoute, z } from '@hono/zod-openapi';
import type { Context } from 'hono';
import bcrypt from 'bcryptjs';
import { randomBytes } from 'node:crypto';
import { eq, desc, gte, lte, like, and, isNull, gt } from 'drizzle-orm';
import { UAParser } from 'ua-parser-js';
import { db } from '../db';
import { pageOffset } from '../lib/pagination';
import { users, loginLogs, tenants, operationLogs, passwordResetTokens } from '../db/schema';
import { config } from '../config';
import { sendMail } from '../lib/email';
import { authMiddleware } from '../middleware/auth';
import type { JwtPayload } from '../middleware/auth';
import { signToken, verifyToken } from '../lib/jwt';
import { isSuperAdmin, getUserPermissions } from '../lib/permissions';
import { generateCaptcha, verifyCaptcha } from '../lib/captcha';
import { getConfigBoolean, getConfigNumber } from '../lib/system-config';
import { generateTokenId, registerSession, removeSession, checkLoginLock, recordLoginFailure, clearLoginAttempts, getOnlineSessions, forceLogout } from '../lib/session-manager';
import { isPlatformAdmin } from '../lib/tenant';
import { ErrorResponse, PaginationQuery, jsonContent, validationHook, commonErrorResponses, ok, okPaginated, okMsg, okBody, errBody } from '../lib/openapi-schemas';
import { LoginResultDTO, UserProfileDTO, CaptchaDTO, RefreshTokenResultDTO as RefreshDTO, SessionDTO, TenantItemDTO, SwitchTenantResultDTO as SwitchTenantDTO, LogRowDTO } from '../lib/openapi-dtos';

const auth = new OpenAPIHono({ defaultHook: validationHook });

// ─── 本地 Zod v4 schemas ─────────────────────────────────────────────────────
const loginSchema = z.object({
  username: z.string().min(3).max(32),
  password: z.string().min(6).max(64),
  captchaId: z.string().optional(),
  captchaCode: z.string().optional(),
  tenantCode: z.string().max(50).optional(),
});
const registerSchema = z.object({
  username: z.string().min(3).max(32),
  nickname: z.string().min(1).max(32),
  email: z.email(),
  password: z.string().min(6).max(64),
});
const changePasswordSchema = z.object({
  oldPassword: z.string().min(6).max(64),
  newPassword: z.string().min(6).max(64),
});
const updateProfileSchema = z.object({
  nickname: z.string().min(1).max(32).optional(),
  email: z.email().optional(),
  avatar: z.string().max(256).optional(),
});
const switchTenantSchema = z.object({ tenantId: z.number().int().positive().nullable() });
const forgotPasswordSchema = z.object({ email: z.email() });
const resetPasswordSchema = z.object({ token: z.string().min(1), newPassword: z.string().min(6).max(64) });
const refreshSchema = z.object({ refreshToken: z.string().min(1) });

// ─── DTOs ────────────────────────────────────────────────────────────────────
// LoginResultDTO / UserProfileDTO / CaptchaDTO / RefreshDTO / SessionDTO /
// TenantItemDTO / SwitchTenantDTO / LogRowDTO 均由 openapi-dtos 统一提供


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
  const result = await db.query.users.findFirst({
    where: eq(users.id, userId),
    columns: {},
    with: { userRoles: { columns: {}, with: { role: true } } },
  });
  return (result?.userRoles ?? []).map(({ role: r }) => ({
    id: r.id, name: r.name, code: r.code, description: r.description,
    status: r.status, createdAt: r.createdAt.toISOString(), updatedAt: r.updatedAt.toISOString(),
  }));
}

// ─── GET /captcha ────────────────────────────────────────────────────────────
const captchaRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get',
    path: '/captcha',
    tags: ['Auth'],
    summary: '获取验证码',
    security: [],
    responses: {
      ...commonErrorResponses,
      ...ok(CaptchaDTO, 'ok'),
    },
  }),
  handler: async (c) => {
    const enabled = await getConfigBoolean('captcha_enabled', false);
    if (!enabled) return c.json(okBody({ enabled: false, captchaId: '', svg: '' }), 200);
    const result = generateCaptcha();
    return c.json(okBody({ enabled: true, captchaId: result.captchaId, svg: result.captchaImage }), 200);
  },
});

// ─── POST /login ─────────────────────────────────────────────────────────────
const loginRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'post',
    path: '/login',
    tags: ['Auth'],
    summary: '登录',
    security: [],
    request: { body: { content: jsonContent(loginSchema), required: true } },
    responses: {
      ...commonErrorResponses,
      ...ok(LoginResultDTO, '登录成功'),
      400: { content: jsonContent(ErrorResponse), description: '参数错误' },
      403: { content: jsonContent(ErrorResponse), description: '禁用/过期' },
      423: { content: jsonContent(ErrorResponse), description: '账号被锁定' },
    },
  }),
  handler: async (c) => {
    const captchaEnabled = await getConfigBoolean('captcha_enabled', false);
    const body = c.req.valid('json');
    if (captchaEnabled) {
      const { captchaId, captchaCode } = body;
      if (!captchaId || !captchaCode) return c.json(errBody('请输入验证码'), 400);
      if (!verifyCaptcha(captchaId, captchaCode)) return c.json(errBody('验证码错误或已过期'), 400);
    }
    const { username, password } = body;

    let tenantId: number | null = null;
    if (config.multiTenantMode && body.tenantCode) {
      const [tenant] = await db.select().from(tenants).where(eq(tenants.code, body.tenantCode)).limit(1);
      if (!tenant) return c.json(errBody('租户不存在'), 400);
      if (tenant.status === 'disabled') return c.json(errBody('租户已被禁用', 403), 403);
      if (tenant.expireAt && new Date(tenant.expireAt) < new Date()) return c.json(errBody('租户已过期', 403), 403);
      tenantId = tenant.id;
    }

    const remainingLockSeconds = await checkLoginLock(username);
    if (remainingLockSeconds > 0) {
      const remainingMinutes = Math.ceil(remainingLockSeconds / 60);
      return c.json(errBody(`账号已被锁定，请 ${remainingMinutes} 分钟后重试`, 423), 423);
    }
    const [loginMaxAttempts, loginLockDurationMinutes] = await Promise.all([
      getConfigNumber('login_max_attempts', 10),
      getConfigNumber('login_lock_duration_minutes', 30),
    ]);
    const lockDurationSeconds = loginLockDurationMinutes * 60;

    let userWhere;
    if (config.multiTenantMode && tenantId !== null) userWhere = and(eq(users.username, username), eq(users.tenantId, tenantId));
    else if (config.multiTenantMode) userWhere = and(eq(users.username, username), isNull(users.tenantId));
    else userWhere = eq(users.username, username);

    const [user] = await db.select().from(users).where(userWhere).limit(1);
    if (!user) {
      await Promise.all([
        recordLoginLog(c, username, 'fail', '用户名或密码错误', undefined, tenantId),
        recordLoginFailure(username, loginMaxAttempts, lockDurationSeconds),
      ]);
      return c.json(errBody('用户名或密码错误'), 400);
    }
    if (user.status === 'disabled') {
      await recordLoginLog(c, username, 'fail', '账号已被禁用', user.id, tenantId);
      return c.json(errBody('账号已被禁用', 403), 403);
    }
    const valid = await bcrypt.compare(password, user.password);
    if (!valid) {
      await Promise.all([
        recordLoginLog(c, username, 'fail', '用户名或密码错误', user.id, tenantId),
        recordLoginFailure(username, loginMaxAttempts, lockDurationSeconds),
      ]);
      return c.json(errBody('用户名或密码错误'), 400);
    }

    let requirePasswordChange = false;
    const expiryEnabled = await getConfigBoolean('password_expiry_enabled', false);
    if (expiryEnabled) {
      const expiryDays = await getConfigNumber('password_expiry_days', 90);
      const pwdUpdate = user.passwordUpdatedAt || user.createdAt;
      const msInDay = 1000 * 60 * 60 * 24;
      const daysSinceUpdate = (Date.now() - pwdUpdate.getTime()) / msInDay;
      if (daysSinceUpdate > expiryDays) requirePasswordChange = true;
    }

    await clearLoginAttempts(username);
    const userRoleList = await getUserRoles(user.id);
    const tokenId = generateTokenId();

    const accessToken = await signToken<JwtPayload>(
      { userId: user.id, username: user.username, roles: userRoleList.map((r) => r.code), tenantId: user.tenantId ?? null, jti: tokenId },
      '2h',
    );
    const refreshToken = await signToken(
      { userId: user.id, username: user.username, type: 'refresh', tenantId: user.tenantId ?? null, jti: tokenId },
      '30d',
    );

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
    const { password: _pw, ...userInfo } = user;
    return c.json(okBody({
      user: { ...userInfo, roles: userRoleList, createdAt: user.createdAt.toISOString(), updatedAt: user.updatedAt.toISOString(), requirePasswordChange },
      token: { accessToken, refreshToken },
      requirePasswordChange,
    }, '登录成功'), 200);
  },
});

// ─── POST /register ──────────────────────────────────────────────────────────
const registerRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'post',
    path: '/register',
    tags: ['Auth'],
    summary: '注册',
    security: [],
    request: { body: { content: jsonContent(registerSchema), required: true } },
    responses: {
      ...commonErrorResponses,
      ...ok(LoginResultDTO, '注册成功'),
      400: { content: jsonContent(ErrorResponse), description: '参数错误' },
      403: { content: jsonContent(ErrorResponse), description: '注册关闭' },
    },
  }),
  handler: async (c) => {
    const allowRegistration = await getConfigBoolean('allow_registration', false);
    if (!allowRegistration) return c.json(errBody('系统已关闭注册功能', 403), 403);
    const { username, nickname, email, password } = c.req.valid('json');

    const [existing] = await db.select().from(users).where(eq(users.username, username)).limit(1);
    if (existing) return c.json(errBody('用户名已存在'), 400);
    const [existingEmail] = await db.select().from(users).where(eq(users.email, email)).limit(1);
    if (existingEmail) return c.json(errBody('邮箱已被注册'), 400);

    const hashedPassword = await bcrypt.hash(password, 10);
    const [user] = await db.insert(users).values({ username, nickname, email, password: hashedPassword }).returning();

    const userRoleList = await getUserRoles(user.id);
    const tokenId = generateTokenId();
    const accessToken = await signToken<JwtPayload>(
      { userId: user.id, username: user.username, roles: userRoleList.map((r) => r.code), tenantId: user.tenantId ?? null, jti: tokenId },
      '2h',
    );
    const refreshToken = await signToken(
      { userId: user.id, username: user.username, type: 'refresh', tenantId: user.tenantId ?? null, jti: tokenId },
      '30d',
    );

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
    const { password: _pw, ...userInfo } = user;
    return c.json(okBody({
      user: { ...userInfo, roles: userRoleList, createdAt: user.createdAt.toISOString(), updatedAt: user.updatedAt.toISOString() },
      token: { accessToken, refreshToken },
    }, '注册成功'), 200);
  },
});

// ─── POST /refresh ───────────────────────────────────────────────────────────
const refreshRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'post',
    path: '/refresh',
    tags: ['Auth'],
    summary: '刷新令牌',
    security: [],
    request: { body: { content: jsonContent(refreshSchema), required: true } },
    responses: {
      ...commonErrorResponses,
      ...ok(RefreshDTO, 'ok'),
      400: { content: jsonContent(ErrorResponse), description: '参数错误' },
      401: { content: jsonContent(ErrorResponse), description: '无效令牌' },
      403: { content: jsonContent(ErrorResponse), description: '账号禁用' },
    },
  }),
  handler: async (c) => {
    const { refreshToken: token } = c.req.valid('json');
    try {
      const payload = await verifyToken<{ userId: number; username: string; type?: string; jti?: string; tenantId?: number | null }>(token);
      if (payload.type !== 'refresh') return c.json(errBody('无效的 refresh token', 401), 401);
      const [refreshUser] = await db.select({ status: users.status }).from(users).where(eq(users.id, payload.userId)).limit(1);
      if (!refreshUser) return c.json(errBody('用户不存在', 401), 401);
      if (refreshUser.status === 'disabled') return c.json(errBody('账号已被禁用', 403), 403);
      const tokenId = payload.jti ?? generateTokenId();
      const userRoleList = await getUserRoles(payload.userId);
      const accessToken = await signToken<JwtPayload>(
        { userId: payload.userId, username: payload.username, roles: userRoleList.map((r) => r.code), tenantId: payload.tenantId ?? null, jti: tokenId },
        '2h',
      );
      return c.json(okBody({ accessToken }), 200);
    } catch {
      return c.json(errBody('refresh token 已过期', 401), 401);
    }
  },
});

// ─── POST /logout ────────────────────────────────────────────────────────────
const logoutRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'post',
    path: '/logout',
    tags: ['Auth'],
    summary: '退出登录',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware] as const,
    responses: {
      ...commonErrorResponses,
      ...okMsg('ok'),
    },
  }),
  handler: async (c) => {
    const payload = getAuthUser(c as { get: (key: 'user') => unknown });
    if (payload.jti) await removeSession(payload.jti);
    return c.json(okBody(null, '已退出登录'), 200);
  },
});

// ─── GET /me ─────────────────────────────────────────────────────────────────
const meRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get',
    path: '/me',
    tags: ['Auth'],
    summary: '获取当前用户',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware] as const,
    responses: {
      ...commonErrorResponses,
      ...ok(UserProfileDTO, 'ok'),
      404: { content: jsonContent(ErrorResponse), description: '不存在' },
    },
  }),
  handler: async (c) => {
    const payload = getAuthUser(c as { get: (key: 'user') => unknown });
    const [user] = await db.select().from(users).where(eq(users.id, payload.userId)).limit(1);
    if (!user) return c.json(errBody('用户不存在', 404), 404);
    const userRoleList = await getUserRoles(user.id);
    let permissions: string[];
    if (isSuperAdmin(userRoleList.map((r) => r.code))) permissions = ['*'];
    else permissions = await getUserPermissions(user.id);

    let requirePasswordChange = false;
    const expiryEnabled = await getConfigBoolean('password_expiry_enabled', false);
    if (expiryEnabled) {
      const expiryDays = await getConfigNumber('password_expiry_days', 90);
      const pwdUpdate = user.passwordUpdatedAt || user.createdAt;
      const msInDay = 1000 * 60 * 60 * 24;
      const daysSinceUpdate = (Date.now() - pwdUpdate.getTime()) / msInDay;
      if (daysSinceUpdate > expiryDays) requirePasswordChange = true;
    }
    const { password: _pw, ...userInfo } = user;

    let tenantName: string | null = null;
    if (user.tenantId) {
      const [tenant] = await db.select({ name: tenants.name }).from(tenants).where(eq(tenants.id, user.tenantId)).limit(1);
      tenantName = tenant?.name ?? null;
    }
    return c.json(okBody({
      ...userInfo,
      tenantName,
      roles: userRoleList,
      permissions,
      requirePasswordChange,
      createdAt: user.createdAt.toISOString(),
      updatedAt: user.updatedAt.toISOString(),
    }), 200);
  },
});

// ─── PUT /profile ────────────────────────────────────────────────────────────
const profileRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'put',
    path: '/profile',
    tags: ['Auth'],
    summary: '修改个人资料',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware] as const,
    request: { body: { content: jsonContent(updateProfileSchema), required: true } },
    responses: {
      ...commonErrorResponses,
      ...ok(UserProfileDTO, '已更新'),
      400: { content: jsonContent(ErrorResponse), description: '参数错误' },
    },
  }),
  handler: async (c) => {
    const payload = getAuthUser(c as { get: (key: 'user') => unknown });
    const data = c.req.valid('json');
    if (data.email) {
      const [existing] = await db.select({ id: users.id }).from(users).where(eq(users.email, data.email)).limit(1);
      if (existing && existing.id !== payload.userId) return c.json(errBody('邮箱已被使用'), 400);
    }
    const [updated] = await db.update(users).set({ ...data }).where(eq(users.id, payload.userId)).returning();
    const userRoleList = await getUserRoles(payload.userId);
    const { password: _pw, ...userInfo } = updated;
    return c.json(okBody({ ...userInfo, roles: userRoleList, createdAt: updated.createdAt.toISOString(), updatedAt: updated.updatedAt.toISOString() }, '资料已更新'), 200);
  },
});

// ─── PUT /password ───────────────────────────────────────────────────────────
const passwordRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'put',
    path: '/password',
    tags: ['Auth'],
    summary: '修改密码',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware] as const,
    request: { body: { content: jsonContent(changePasswordSchema), required: true } },
    responses: {
      ...commonErrorResponses,
      ...okMsg('修改成功'),
      400: { content: jsonContent(ErrorResponse), description: '原密码错误' },
      404: { content: jsonContent(ErrorResponse), description: '用户不存在' },
    },
  }),
  handler: async (c) => {
    const payload = getAuthUser(c as { get: (key: 'user') => unknown });
    const data = c.req.valid('json');
    const [user] = await db.select().from(users).where(eq(users.id, payload.userId)).limit(1);
    if (!user) return c.json(errBody('用户不存在', 404), 404);
    const valid = await bcrypt.compare(data.oldPassword, user.password);
    if (!valid) return c.json(errBody('原密码错误'), 400);
    const hashed = await bcrypt.hash(data.newPassword, 10);
    await db.update(users).set({ password: hashed, passwordUpdatedAt: new Date() }).where(eq(users.id, payload.userId));
    return c.json(okBody(null, '密码修改成功'), 200);
  },
});

// ─── GET /my-login-logs ──────────────────────────────────────────────────────
const myLoginLogsRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get',
    path: '/my-login-logs',
    tags: ['Auth'],
    summary: '我的登录记录',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware] as const,
    request: { query: PaginationQuery.extend({ status: z.enum(['success', 'fail']).optional(), startTime: z.string().optional(), endTime: z.string().optional() }) },
    responses: {
      ...commonErrorResponses,
      ...okPaginated(LogRowDTO, 'ok'),
    },
  }),
  handler: async (c) => {
    const payload = getAuthUser(c as { get: (key: 'user') => unknown });
    const { page = 1, pageSize = 10, status, startTime, endTime } = c.req.valid('query');
    const conditions = [eq(loginLogs.userId, payload.userId)];
    if (status) conditions.push(eq(loginLogs.status, status));
    if (startTime) conditions.push(gte(loginLogs.createdAt, new Date(startTime)));
    if (endTime) conditions.push(lte(loginLogs.createdAt, new Date(endTime)));
    const where = and(...conditions);
    const [count, rows] = await Promise.all([
      db.$count(loginLogs, where),
      db.select().from(loginLogs).where(where).orderBy(desc(loginLogs.createdAt)).limit(pageSize).offset(pageOffset(page, pageSize)),
    ]);
    return c.json(okBody({ list: rows.map((r) => ({ ...r, createdAt: r.createdAt.toISOString() })), total: count, page, pageSize }), 200);
  },
});

// ─── GET /my-operation-logs ──────────────────────────────────────────────────
const myOperationLogsRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get',
    path: '/my-operation-logs',
    tags: ['Auth'],
    summary: '我的操作记录',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware] as const,
    request: { query: PaginationQuery.extend({ module: z.string().optional(), startTime: z.string().optional(), endTime: z.string().optional() }) },
    responses: {
      ...commonErrorResponses,
      ...okPaginated(LogRowDTO, 'ok'),
    },
  }),
  handler: async (c) => {
    const payload = getAuthUser(c as { get: (key: 'user') => unknown });
    const { page = 1, pageSize = 10, module, startTime, endTime } = c.req.valid('query');
    const conditions = [eq(operationLogs.userId, payload.userId)];
    if (module) conditions.push(like(operationLogs.module, `%${module}%`));
    if (startTime) conditions.push(gte(operationLogs.createdAt, new Date(startTime)));
    if (endTime) conditions.push(lte(operationLogs.createdAt, new Date(endTime)));
    const where = and(...conditions);
    const [count, rows] = await Promise.all([
      db.$count(operationLogs, where),
      db.select().from(operationLogs).where(where).orderBy(desc(operationLogs.createdAt)).limit(pageSize).offset(pageOffset(page, pageSize)),
    ]);
    return c.json(okBody({ list: rows.map((r) => ({ ...r, createdAt: r.createdAt.toISOString() })), total: count, page, pageSize }), 200);
  },
});

// ─── GET /my-sessions ────────────────────────────────────────────────────────
const mySessionsRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get',
    path: '/my-sessions',
    tags: ['Auth'],
    summary: '我的会话',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware] as const,
    responses: {
      ...commonErrorResponses,
      ...ok(z.array(SessionDTO), 'ok'),
    },
  }),
  handler: async (c) => {
    const payload = getAuthUser(c as { get: (key: 'user') => unknown });
    const allSessions = await getOnlineSessions();
    const mySessions = allSessions.filter((s) => s.userId === payload.userId);
    return c.json(okBody(mySessions.map((s) => ({
      tokenId: s.tokenId,
      ip: s.ip,
      browser: s.browser,
      os: s.os,
      loginAt: s.loginAt.toISOString(),
      lastActiveAt: s.lastActiveAt.toISOString(),
      isCurrent: s.tokenId === payload.jti,
    }))), 200);
  },
});

// ─── DELETE /my-sessions/others ──────────────────────────────────────────────
const deleteOtherSessionsRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'delete',
    path: '/my-sessions/others',
    tags: ['Auth'],
    summary: '退出其他设备',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware] as const,
    responses: {
      ...commonErrorResponses,
      ...ok(z.object({ count: z.number() }), 'ok'),
    },
  }),
  handler: async (c) => {
    const payload = getAuthUser(c as { get: (key: 'user') => unknown });
    const allSessions = await getOnlineSessions();
    const others = allSessions.filter((s) => s.userId === payload.userId && s.tokenId !== payload.jti);
    await Promise.all(others.map((s) => forceLogout(s.tokenId)));
    return c.json(okBody({ count: others.length }, `已退出 ${others.length} 个其他设备`), 200);
  },
});

// ─── DELETE /my-sessions/{tokenId} ───────────────────────────────────────────
const deleteSessionRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'delete',
    path: '/my-sessions/{tokenId}',
    tags: ['Auth'],
    summary: '退出指定设备',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware] as const,
    request: { params: z.object({ tokenId: z.string().openapi({ param: { name: 'tokenId', in: 'path' }, example: 'abc123' }) }) },
    responses: {
      ...commonErrorResponses,
      ...okMsg('ok'),
      400: { content: jsonContent(ErrorResponse), description: '不能操作当前设备' },
      404: { content: jsonContent(ErrorResponse), description: '会话不存在' },
    },
  }),
  handler: async (c) => {
    const payload = getAuthUser(c as { get: (key: 'user') => unknown });
    const { tokenId } = c.req.valid('param');
    if (tokenId === payload.jti) return c.json(errBody('不能退出当前设备，请使用退出登录功能'), 400);
    const allSessions = await getOnlineSessions();
    const session = allSessions.find((s) => s.tokenId === tokenId && s.userId === payload.userId);
    if (!session) return c.json(errBody('会话不存在或已过期', 404), 404);
    await forceLogout(tokenId);
    return c.json(okBody(null, '已退出该设备'), 200);
  },
});

// ─── POST /switch-tenant ─────────────────────────────────────────────────────
const switchTenantRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'post',
    path: '/switch-tenant',
    tags: ['Auth'],
    summary: '切换租户视角',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware] as const,
    request: { body: { content: jsonContent(switchTenantSchema), required: true } },
    responses: {
      ...commonErrorResponses,
      ...ok(SwitchTenantDTO, 'ok'),
      403: { content: jsonContent(ErrorResponse), description: '无权限' },
      404: { content: jsonContent(ErrorResponse), description: '租户不存在' },
    },
  }),
  handler: async (c) => {
    const payload = getAuthUser(c as { get: (key: 'user') => unknown });
    if (!isPlatformAdmin(payload)) return c.json(errBody('仅平台超管可切换租户', 403), 403);
    const { tenantId: targetTenantId } = c.req.valid('json');
    if (targetTenantId !== null) {
      const [tenant] = await db.select().from(tenants).where(eq(tenants.id, targetTenantId)).limit(1);
      if (!tenant) return c.json(errBody('租户不存在', 404), 404);
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
    const ip = c.req.header('x-forwarded-for') || c.req.header('x-real-ip') || '127.0.0.1';
    const ua = c.req.header('user-agent') || '';
    const uaParser = new UAParser(ua);
    const browserInfo = uaParser.getBrowser();
    const osInfo = uaParser.getOS();
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
    return c.json(okBody(
      { accessToken: newAccessToken, refreshToken: newRefreshToken, viewingTenantId: targetTenantId },
      targetTenantId === null ? '已切换回平台视角' : '已切换租户视角',
    ), 200);
  },
});

// ─── GET /tenants ────────────────────────────────────────────────────────────
const authTenantsRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get',
    path: '/tenants',
    tags: ['Auth'],
    summary: '可切换租户列表',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware] as const,
    responses: {
      ...commonErrorResponses,
      ...ok(z.array(TenantItemDTO), 'ok'),
      403: { content: jsonContent(ErrorResponse), description: '无权限' },
    },
  }),
  handler: async (c) => {
    const payload = getAuthUser(c as { get: (key: 'user') => unknown });
    if (!isPlatformAdmin(payload)) return c.json(errBody('无权限', 403), 403);
    const rows = await db.select({ id: tenants.id, name: tenants.name, code: tenants.code, status: tenants.status }).from(tenants).where(eq(tenants.status, 'active'));
    return c.json(okBody(rows), 200);
  },
});

// ─── POST /forgot-password ───────────────────────────────────────────────────
const forgotPasswordRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'post',
    path: '/forgot-password',
    tags: ['Auth'],
    summary: '忘记密码',
    security: [],
    request: { body: { content: jsonContent(forgotPasswordSchema), required: true } },
    responses: {
      ...commonErrorResponses,
      ...okMsg('ok'),
      403: { content: jsonContent(ErrorResponse), description: '功能未开启' },
    },
  }),
  handler: async (c) => {
    const enabled = await getConfigBoolean('forgot_password_enabled');
    if (!enabled) return c.json(errBody('忘记密码功能未开启', 403), 403);
    const { email } = c.req.valid('json');
    const [user] = await db.select({ id: users.id, username: users.username })
      .from(users).where(and(eq(users.email, email), eq(users.status, 'active'))).limit(1);
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
    return c.json(okBody(null, '如邮箱已注册，重置链接已发送至您的邮箱'), 200);
  },
});

// ─── POST /reset-password ────────────────────────────────────────────────────
const resetPasswordRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'post',
    path: '/reset-password',
    tags: ['Auth'],
    summary: '重置密码',
    security: [],
    request: { body: { content: jsonContent(resetPasswordSchema), required: true } },
    responses: {
      ...commonErrorResponses,
      ...okMsg('ok'),
      400: { content: jsonContent(ErrorResponse), description: '链接无效' },
    },
  }),
  handler: async (c) => {
    const { token, newPassword } = c.req.valid('json');
    const now = new Date();
    const [record] = await db.select().from(passwordResetTokens)
      .where(and(eq(passwordResetTokens.token, token), gt(passwordResetTokens.expiresAt, now), isNull(passwordResetTokens.usedAt)))
      .limit(1);
    if (!record) return c.json(errBody('重置链接无效或已过期'), 400);
    const hashed = await bcrypt.hash(newPassword, 10);
    await db.transaction(async (tx) => {
      await tx.update(users).set({ password: hashed }).where(eq(users.id, record.userId));
      await tx.update(passwordResetTokens).set({ usedAt: now }).where(eq(passwordResetTokens.id, record.id));
    });
    return c.json(okBody(null, '密码已重置，请使用新密码登录'), 200);
  },
});

auth.openapiRoutes([captchaRoute, loginRoute, registerRoute, refreshRoute, logoutRoute, meRoute, profileRoute, passwordRoute, myLoginLogsRoute, myOperationLogsRoute, mySessionsRoute, deleteOtherSessionsRoute, deleteSessionRoute, switchTenantRoute, authTenantsRoute, forgotPasswordRoute, resetPasswordRoute] as const);

export default auth;
