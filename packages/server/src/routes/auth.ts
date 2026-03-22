import { Hono } from 'hono';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { eq } from 'drizzle-orm';
import { db } from '../db';
import { users } from '../db/schema';
import { config } from '../config';
import { loginSchema, registerSchema } from '@zenith/shared';
import { authMiddleware } from '../middleware/auth';
import type { JwtPayload } from '../middleware/auth';

const auth = new Hono();

auth.post('/login', async (c) => {
  const body = await c.req.json();
  const result = loginSchema.safeParse(body);
  if (!result.success) {
    return c.json({ code: 400, message: result.error.issues[0].message, data: null }, 400);
  }

  const { username, password } = result.data;
  const [user] = await db.select().from(users).where(eq(users.username, username)).limit(1);

  if (!user) {
    return c.json({ code: 400, message: '用户名或密码错误', data: null }, 400);
  }

  if (user.status === 'disabled') {
    return c.json({ code: 403, message: '账号已被禁用', data: null }, 403);
  }

  const valid = await bcrypt.compare(password, user.password);
  if (!valid) {
    return c.json({ code: 400, message: '用户名或密码错误', data: null }, 400);
  }

  const token = jwt.sign(
    { userId: user.id, username: user.username, role: user.role } satisfies JwtPayload,
    config.jwtSecret,
    { expiresIn: '7d' }
  );

  const { password: _, ...userInfo } = user;
  return c.json({
    code: 0,
    message: '登录成功',
    data: {
      user: { ...userInfo, createdAt: user.createdAt.toISOString(), updatedAt: user.updatedAt.toISOString() },
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

  const token = jwt.sign(
    { userId: user.id, username: user.username, role: user.role } satisfies JwtPayload,
    config.jwtSecret,
    { expiresIn: '7d' }
  );

  const { password: _, ...userInfo } = user;
  return c.json({
    code: 0,
    message: '注册成功',
    data: {
      user: { ...userInfo, createdAt: user.createdAt.toISOString(), updatedAt: user.updatedAt.toISOString() },
      token: { accessToken: token },
    },
  });
});

auth.get('/me', authMiddleware, async (c) => {
  const payload = c.get('user') as JwtPayload;
  const [user] = await db.select().from(users).where(eq(users.id, payload.userId)).limit(1);
  if (!user) {
    return c.json({ code: 404, message: '用户不存在', data: null }, 404);
  }
  const { password: _, ...userInfo } = user;
  return c.json({
    code: 0,
    message: 'ok',
    data: { ...userInfo, createdAt: user.createdAt.toISOString(), updatedAt: user.updatedAt.toISOString() },
  });
});

export default auth;
