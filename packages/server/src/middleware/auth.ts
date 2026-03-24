import type { Context, Next } from 'hono';
import jwt from 'jsonwebtoken';
import { config } from '../config';
import { isTokenBlacklisted, touchSession } from '../lib/session-manager';

export interface JwtPayload {
  userId: number;
  username: string;
  roles: string[];
  jti?: string;
}

export async function authMiddleware(c: Context, next: Next) {
  const authorization = c.req.header('Authorization');
  if (!authorization?.startsWith('Bearer ')) {
    return c.json({ code: 401, message: '未登录', data: null }, 401);
  }

  const token = authorization.slice(7);
  try {
    const payload = jwt.verify(token, config.jwtSecret) as JwtPayload;

    // Check if this token has been force-logged-out
    if (payload.jti && isTokenBlacklisted(payload.jti)) {
      return c.json({ code: 401, message: '会话已被强制下线', data: null }, 401);
    }

    // Refresh session activity
    if (payload.jti) {
      touchSession(payload.jti);
    }

    c.set('user', payload);
    await next();
  } catch {
    return c.json({ code: 401, message: '登录已过期', data: null }, 401);
  }
}
