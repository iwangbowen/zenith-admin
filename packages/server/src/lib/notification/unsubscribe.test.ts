/**
 * 退订令牌线格式黄金测试：令牌长期存活在已发出的邮件里，实现重构不得改变一个字节。
 * 期望值在测试内用原始公式独立计算：`<base64url(JSON)>.<base64url(HMAC-SHA256(secret, "notification-unsubscribe:" + data))>`。
 */
import { createHmac } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { config } from '../../config';
import { createUnsubscribeToken, verifyUnsubscribeToken, type UnsubscribePayload } from './unsubscribe';

const NOW = Date.UTC(2026, 0, 15, 8, 0, 0);

function goldenToken(payload: UnsubscribePayload): string {
  const data = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = createHmac('sha256', config.jwtSecret).update(`notification-unsubscribe:${data}`).digest('base64url');
  return `${data}.${sig}`;
}

describe('unsubscribe token wire format', () => {
  afterEach(() => vi.useRealTimers());

  it('签发结果与原始公式逐字节一致（默认 60 天有效）', () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    const payload = { recipientType: 'user' as const, recipientId: 42, scope: 'event' as const, eventKey: 'workflow.task.assigned' };
    const token = createUnsubscribeToken(payload);
    expect(token).toBe(goldenToken({ ...payload, exp: NOW + 60 * 86_400_000 }));
    expect(token).not.toContain('=');
    expect(token.split('.')).toHaveLength(2);
  });

  it('自定义有效期按天累加', () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    const payload = { recipientType: 'member' as const, recipientId: 7, scope: 'all-email' as const };
    expect(createUnsubscribeToken(payload, 3)).toBe(goldenToken({ ...payload, exp: NOW + 3 * 86_400_000 }));
  });

  it('校验：合法令牌还原载荷；过期 / 篡改 / 缺段返回 null', () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    const live: UnsubscribePayload = { recipientType: 'user', recipientId: 42, scope: 'event', eventKey: 'k', exp: NOW + 1000 };
    expect(verifyUnsubscribeToken(goldenToken(live))).toEqual(live);
    expect(verifyUnsubscribeToken(goldenToken({ ...live, exp: NOW - 1 }))).toBeNull();
    const token = goldenToken(live);
    const [data, sig] = token.split('.');
    expect(verifyUnsubscribeToken(`${data}.${sig.slice(0, -1)}x`)).toBeNull();
    expect(verifyUnsubscribeToken(`${data}x.${sig}`)).toBeNull();
    expect(verifyUnsubscribeToken(data)).toBeNull();
    expect(verifyUnsubscribeToken('')).toBeNull();
    expect(verifyUnsubscribeToken(`.${sig}`)).toBeNull();
  });

  it('校验：载荷字段不合法返回 null', () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    const base: UnsubscribePayload = { recipientType: 'user', recipientId: 1, scope: 'event', eventKey: 'k', exp: NOW + 1000 };
    expect(verifyUnsubscribeToken(goldenToken({ ...base, recipientType: 'admin' as never }))).toBeNull();
    expect(verifyUnsubscribeToken(goldenToken({ ...base, recipientId: 0 }))).toBeNull();
    expect(verifyUnsubscribeToken(goldenToken({ ...base, scope: 'sms' as never }))).toBeNull();
    expect(verifyUnsubscribeToken(goldenToken({ ...base, eventKey: undefined }))).toBeNull();
    expect(verifyUnsubscribeToken(goldenToken({ ...base, scope: 'all-email', eventKey: undefined }))).toEqual({ ...base, scope: 'all-email', eventKey: undefined });
  });
});
