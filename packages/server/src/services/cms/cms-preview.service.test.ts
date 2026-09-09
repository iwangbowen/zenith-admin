/**
 * 草稿预览签名黄金测试：`sig = hex(HMAC-SHA256(secret, "cms-preview:<contentId>:<exp>"))`，
 * 随 URL 查询参数下发（?exp=&sig=），实现重构不得改变一个字节。
 */
import { createHmac } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { config } from '../../config';
import { verifyContentPreviewToken } from './cms-preview.service';

const NOW = Date.UTC(2026, 0, 15, 8, 0, 0);

function golden(contentId: number, exp: number): string {
  return createHmac('sha256', config.jwtSecret).update(`cms-preview:${contentId}:${exp}`).digest('hex');
}

describe('CMS preview signature wire format', () => {
  afterEach(() => vi.useRealTimers());

  it('原始公式计算的签名可通过校验；过期 / 篡改 / 缺失不通过', () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    const exp = Math.floor(NOW / 1000) + 3600;
    const sig = golden(1001, exp);
    expect(sig).toMatch(/^[0-9a-f]{64}$/);
    expect(verifyContentPreviewToken(1001, exp, sig)).toBe(true);
    expect(verifyContentPreviewToken(1002, exp, sig)).toBe(false);
    expect(verifyContentPreviewToken(1001, exp + 1, sig)).toBe(false);
    expect(verifyContentPreviewToken(1001, exp, `${sig.slice(0, -1)}0`)).toBe(false);
    expect(verifyContentPreviewToken(1001, exp, sig.slice(0, -1))).toBe(false);
    expect(verifyContentPreviewToken(1001, exp, '')).toBe(false);
    expect(verifyContentPreviewToken(1001, Math.floor(NOW / 1000) - 1, golden(1001, Math.floor(NOW / 1000) - 1))).toBe(false);
    expect(verifyContentPreviewToken(1001, 1.5, sig)).toBe(false);
  });
});
