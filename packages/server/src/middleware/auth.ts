import type { Context, Next } from 'hono';
import jwt from 'jsonwebtoken';
import { config } from '../config';

export interface JwtPayload {
  userId: number;
  username: string;
  role: string;
}

export async function authMiddleware(c: Context, next: Next) {
  const authorization = c.req.header('Authorization');
  if (!authorization?.startsWith('Bearer ')) {
    return c.json({ code: 401, message: '未登录', data: null }, 401);
  }

  const token = authorization.slice(7);
  try {
    const payload = jwt.verify(token, config.jwtSecret) as JwtPayload;
    c.set('user', payload);
    await next();
  } catch {
    return c.json({ code: 401, message: '登录已过期', data: null }, 401);
  }
}
