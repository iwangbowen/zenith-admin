/**
 * 统一 JWT 封装单测（认证核心路径）。
 *
 * 覆盖 `signToken` / `verifyToken`：
 *  1. 签发-校验闭环：payload 透传、自动写入 iat/exp claim
 *  2. expiresIn 换算：'2h' / '30d' / 数字秒 / 正则兜底（'15m'、'10s'、'1d'）/ 非法格式抛错
 *  3. 安全边界：篡改 token、错误密钥签名、过期 token 均校验失败
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { sign } from 'hono/jwt';

const TEST_JWT_SECRET = 'unit-test-only-fake-secret-do-not-use-in-production';

vi.mock('../config', () => ({
  config: {
    jwtSecret: 'unit-test-only-fake-secret-do-not-use-in-production',
    jwtRefreshSecret: 'unit-test-only-fake-refresh-secret',
  },
}));

import { signToken, verifyToken, type Expiry } from './jwt';

function decodePayload(token: string): Record<string, unknown> {
  return JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8'));
}

afterEach(() => {
  vi.useRealTimers();
});

describe('signToken', () => {
  it('签发的 token 可被 verifyToken 校验且 payload 透传', async () => {
    const token = await signToken({ userId: 42, username: 'alice', roles: ['admin'] }, '2h');
    const payload = await verifyToken<{ userId: number; username: string; roles: string[] }>(token);
    expect(payload.userId).toBe(42);
    expect(payload.username).toBe('alice');
    expect(payload.roles).toEqual(['admin']);
  });

  it("'2h' → exp = iat + 7200", async () => {
    const token = await signToken({ userId: 1 }, '2h');
    const { iat, exp } = decodePayload(token) as { iat: number; exp: number };
    expect(exp - iat).toBe(2 * 3600);
  });

  it("'30d' → exp = iat + 2592000", async () => {
    const token = await signToken({ userId: 1 }, '30d');
    const { iat, exp } = decodePayload(token) as { iat: number; exp: number };
    expect(exp - iat).toBe(30 * 86400);
  });

  it('数字直接作为秒数', async () => {
    const token = await signToken({ userId: 1 }, 60);
    const { iat, exp } = decodePayload(token) as { iat: number; exp: number };
    expect(exp - iat).toBe(60);
  });

  it("正则兜底：'15m' / '10s' / '1d' 均正确换算", async () => {
    for (const [expiry, seconds] of [['15m', 900], ['10s', 10], ['1d', 86400]] as const) {
      const token = await signToken({ userId: 1 }, expiry as Expiry);
      const { iat, exp } = decodePayload(token) as { iat: number; exp: number };
      expect(exp - iat).toBe(seconds);
    }
  });

  it('非法 expiry 格式抛错', async () => {
    await expect(signToken({ userId: 1 }, 'abc' as Expiry)).rejects.toThrow(/Unsupported expiry format/);
  });

  it('iat 为当前时间（秒级）', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
    const token = await signToken({ userId: 1 }, '2h');
    const { iat } = decodePayload(token) as { iat: number };
    expect(iat).toBe(Math.floor(new Date('2026-01-01T00:00:00Z').getTime() / 1000));
  });
});

describe('verifyToken - 安全边界', () => {
  it('篡改 payload 后签名不匹配 → 抛错', async () => {
    const token = await signToken({ userId: 1, roles: ['user'] }, '2h');
    const [header, payload, sig] = token.split('.');
    const tampered = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    tampered.roles = ['admin']; // 提权尝试
    const forged = [header, Buffer.from(JSON.stringify(tampered)).toString('base64url'), sig].join('.');
    await expect(verifyToken(forged)).rejects.toThrow();
  });

  it('使用错误密钥签发的 token → 抛错', async () => {
    const now = Math.floor(Date.now() / 1000);
    const foreign = await sign({ userId: 1, iat: now, exp: now + 3600 }, 'another-secret', 'HS256');
    await expect(verifyToken(foreign)).rejects.toThrow();
  });

  it('过期 token → 抛错', async () => {
    const now = Math.floor(Date.now() / 1000);
    const expired = await sign({ userId: 1, iat: now - 100, exp: now - 1 }, TEST_JWT_SECRET, 'HS256');
    await expect(verifyToken(expired)).rejects.toThrow();
  });

  it('格式非法的字符串 → 抛错', async () => {
    await expect(verifyToken('not-a-jwt')).rejects.toThrow();
  });
});
