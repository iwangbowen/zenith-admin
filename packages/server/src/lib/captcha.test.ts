/**
 * 登录图形验证码单测。
 *
 * 验证码答案存 Redis（多 api 节点共享，任意节点都能校验），因此这里断言的是
 * 「写入了正确的键与 TTL」「校验一次性消费」「Redis 故障按校验失败处理」，
 * 而不是进程内 Map 的细节。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import redis from './redis';
import { generateCaptcha, verifyCaptcha, resolveCaptchaComplexity } from './captcha';

const state = vi.hoisted(() => ({ store: new Map<string, string>() }));

vi.mock('./redis', () => ({
  default: {
    setex: vi.fn(async (key: string, _ttl: number, value: string) => {
      state.store.set(key, value);
      return 'OK';
    }),
    getdel: vi.fn(async (key: string) => {
      const value = state.store.get(key) ?? null;
      state.store.delete(key);
      return value;
    }),
  },
}));

vi.mock('../config', () => ({ config: { redis: { keyPrefix: 'zenith:' } } }));

const redisMock = vi.mocked(redis);

beforeEach(() => {
  state.store.clear();
  vi.clearAllMocks();
});

describe('captcha', () => {
  it('生成验证码：返回 id 与 SVG，并把答案按 5 分钟 TTL 写入 Redis', async () => {
    const { captchaId, captchaImage } = await generateCaptcha();

    expect(captchaId).toBeTruthy();
    expect(captchaImage).toContain('<svg');
    expect(redisMock.setex).toHaveBeenCalledTimes(1);
    const [key, ttl, answer] = redisMock.setex.mock.calls[0];
    expect(key).toBe(`zenith:captcha:${captchaId}`);
    expect(ttl).toBe(5 * 60);
    expect(answer).toBeTruthy();
  });

  it('各复杂度档位都能生成', async () => {
    for (const level of ['low', 'medium', 'high'] as const) {
      const { captchaImage } = await generateCaptcha(level);
      expect(captchaImage).toContain('<svg');
    }
  });

  it('复杂度非法值回退 medium', () => {
    expect(resolveCaptchaComplexity('low')).toBe('low');
    expect(resolveCaptchaComplexity('invalid')).toBe('medium');
    expect(resolveCaptchaComplexity(undefined)).toBe('medium');
  });

  it('答案正确即通过，且一次性消费（同一 id 不能复用）', async () => {
    const { captchaId } = await generateCaptcha();
    const answer = redisMock.setex.mock.calls[0][2];

    expect(await verifyCaptcha(captchaId, answer)).toBe(true);
    expect(await verifyCaptcha(captchaId, answer)).toBe(false);
  });

  it('大小写与首尾空格不影响判定；错误答案返回 false', async () => {
    const { captchaId } = await generateCaptcha();
    const answer = redisMock.setex.mock.calls[0][2] as string;

    expect(await verifyCaptcha(captchaId, ` ${answer.toUpperCase()} `)).toBe(true);
    expect(await verifyCaptcha('non-existent-id', '42')).toBe(false);
  });

  it('id 或答案为空时直接失败，不查 Redis', async () => {
    expect(await verifyCaptcha('', '42')).toBe(false);
    const { captchaId } = await generateCaptcha();
    expect(await verifyCaptcha(captchaId, '')).toBe(false);
    expect(redisMock.getdel).not.toHaveBeenCalled();
  });

  it('Redis 故障按校验失败处理（不把异常抛给登录链路）', async () => {
    redisMock.getdel.mockRejectedValueOnce(new Error('redis down'));
    expect(await verifyCaptcha('any-id', '42')).toBe(false);
  });
});
