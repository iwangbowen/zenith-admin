import { Hono } from 'hono';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { eq } from 'drizzle-orm';
import { UAParser } from 'ua-parser-js';
import { db } from '../db';
import { users, userRoles, roles, loginLogs } from '../db/schema';
import { config } from '../config';
import { loginSchema, registerSchema, changePasswordSchema, updateProfileSchema } from '@zenith/shared';
import { authMiddleware } from '../middleware/auth';
import type { JwtPayload } from '../middleware/auth';
import { isSuperAdmin, getUserPermissions } from '../lib/permissions';

const auth = new Hono();

async function recordLoginLog(c: any, username: string, status: 'success' | 'fail', message: string, userId?: number) {
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
    message
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

auth.post('/login', async (c) => {
  const body = await c.req.json();
  const result = loginSchema.safeParse(body);
  if (!result.success) {
    return c.json({ code: 400, message: result.error.issues[0].message, data: null }, 400);
  }

  const { username, password } = result.data;
  const [user] = await db.select().from(users).where(eq(users.username, username)).limit(1);

  if (!user) {
    await recordLoginLog(c, username, 'fail', '用户名或密码错误');
    return c.json({ code: 400, message: '用户名或密码错误', data: null }, 400);
  }

  if (user.status === 'disabled') {
    await recordLoginLog(c, username, 'fail', '账号已被禁用', user.id);
    return c.json({ code: 403, message: '账号已被禁用', data: null }, 403);
  }

  const valid = await bcrypt.compare(password, user.password);
  if (!valid) {
    await recordLoginLog(c, username, 'fail', '用户名或密码错误', user.id);
    return c.json({ code: 400, message: '用户名或密码错误', data: null }, 400);
  }

  const userRoleList = await getUserRoles(user.id);

  const token = jwt.sign(
    { userId: user.id, username: user.username, roles: userRoleList.map((r) => r.code) } satisfies JwtPayload,
    config.jwtSecret,
    { expiresIn: '7d' }
  );

  await recordLoginLog(c, username, 'success', '登录成功', user.id);

  const { password: _, ...userInfo } = user;
  return c.json({
    code: 0,
    message: '登录成功',
    data: {
      user: { ...userInfo, roles: userRoleList, createdAt: user.createdAt.toISOString(), updatedAt: user.updatedAt.toISOString() },
      token: { accessToken: token },
    },
  });
});

auth.post('/register', async (c) => {
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

  const token = jwt.sign(
    { userId: user.id, username: user.username, roles: userRoleList.map((r) => r.code) } satisfies JwtPayload,
    config.jwtSecret,
    { expiresIn: '7d' }
  );

  await recordLoginLog(c, username, 'success', '注册并在自动登录成功', user.id);

  const { password: _, ...userInfo } = user;
  return c.json({
    code: 0,
    message: '注册成功',
    data: {
      user: { ...userInfo, roles: userRoleList, createdAt: user.createdAt.toISOString(), updatedAt: user.updatedAt.toISOString() },
      token: { accessToken: token },
    },
  });
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

  const { password: _, ...userInfo } = user;
  return c.json({
    code: 0,
    message: 'ok',
    data: {
      ...userInfo,
      roles: userRoleList,
      permissions,
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
  await db.update(users).set({ password: hashed, updatedAt: new Date() }).where(eq(users.id, payload.userId));

  return c.json({ code: 0, message: '密码修改成功', data: null });
});

export default auth;
