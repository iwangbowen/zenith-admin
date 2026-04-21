/**
 * 统一 JWT 封装（基于 Hono 官方 `hono/jwt`，无 Node 运行时强依赖）。
 *
 * - 避免散落各处的 `jwt.sign` / `jwt.verify` 调用
 * - 统一处理 `expiresIn` → `exp` claim 换算
 * - `verifyToken` 返回类型透传，失败抛出 Hono JwtException 体系的错误
 */
import { sign, verify } from 'hono/jwt';
import { config } from '../config';

/**
 * 支持 '2h' | '30d' 字符串写法或直接传秒数。
 * 与 jsonwebtoken 的 `expiresIn` 保持兼容（本项目实际只用到这两种值）。
 */
export type Expiry = '2h' | '30d' | number;

function expiryToSeconds(exp: Expiry): number {
  if (typeof exp === 'number') return exp;
  if (exp === '2h') return 2 * 3600;
  if (exp === '30d') return 30 * 86400;
  // 兜底：解析 `\d+[smhd]` 形式
  const m = /^(\d+)([smhd])$/.exec(exp);
  if (m) {
    const mults: Record<string, number> = { s: 1, m: 60, h: 3600, d: 86400 };
    return Number(m[1]) * mults[m[2]];
  }
  throw new Error(`Unsupported expiry format: ${exp}`);
}

/** 签发 Token；自动写入 `iat` / `exp` claim。 */
export async function signToken<T extends object>(payload: T, expiresIn: Expiry): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  return sign({ ...payload, iat: now, exp: now + expiryToSeconds(expiresIn) }, config.jwtSecret, 'HS256');
}

/** 校验 Token；失败抛出 Hono JwtException（调用方自行捕获返回 401）。 */
export async function verifyToken<T = Record<string, unknown>>(token: string): Promise<T> {
  return (await verify(token, config.jwtSecret, 'HS256')) as T;
}
