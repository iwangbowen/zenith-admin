import { describe, expect, it, vi } from 'vitest';
import { JSDOM } from 'jsdom';

vi.mock('../../middleware/rate-limit', () => ({ pathBoundRateLimit: vi.fn(async (_c, next) => next()) }));
vi.mock('../../services/short-link/short-link-redirect.service', () => ({
  resolveShortLink: vi.fn(async () => ({ id: 1, status: 'enabled', password: 'test-password', expiresAtMs: null, maxVisits: null, finalUrl: 'https://example.com', redirectType: '302' })),
  getLiveVisitCount: vi.fn(async () => 0),
  recordShortLinkClickSafe: vi.fn(),
}));

import redirectRouter from './redirect';

describe('短链密码保护页', () => {
  it.each(['/sample', '/sample?pwd=incorrect'])('访问 %s 不回显输入或泄露实际密码', async (url) => {
    const response = await redirectRouter.request(url);
    expect(response.status).toBe(200);
    const markup = await response.text();
    expect(markup).not.toContain('test-password');
    const dom = new JSDOM(markup);
    try {
      const document = dom.window.document;
      const input = document.querySelector<HTMLInputElement>('input[name="pwd"]')!;
      expect(input.type).toBe('password');
      expect(input.value).toBe('');
    } finally {
      dom.window.close();
    }
  });
});
