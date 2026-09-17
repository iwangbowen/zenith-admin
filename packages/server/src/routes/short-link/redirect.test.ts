import { describe, expect, it, vi } from 'vitest';
import { JSDOM } from 'jsdom';

vi.mock('../../middleware/rate-limit', () => ({ pathBoundRateLimit: vi.fn(async (_c, next) => next()) }));
vi.mock('../../services/short-link/short-link-redirect.service', () => ({
  resolveShortLink: vi.fn(async () => ({ id: 1, status: 'enabled', password: 'test-password', expiresAtMs: null, maxVisits: null, finalUrl: 'https://example.com', redirectType: '302' })),
  getLiveVisitCount: vi.fn(async () => 0),
  recordShortLinkClickSafe: vi.fn(),
}));

import redirectRouter from './redirect';

describe('短链访问密码显隐', () => {
  it.each(['/sample', '/sample?pwd=incorrect'])('在 %s 默认隐藏，切换不改变输入或触发表单提交', async (url) => {
    const response = await redirectRouter.request(url);
    expect(response.status).toBe(200);
    const dom = new JSDOM(await response.text(), { runScripts: 'dangerously', url: 'https://example.com/s/sample' });
    try {
      const document = dom.window.document;
      const input = document.querySelector<HTMLInputElement>('input[name="pwd"]')!;
      const button = document.querySelector<HTMLButtonElement>('.password-toggle')!;
      const submit = vi.fn((event: Event) => event.preventDefault());
      document.querySelector('form')!.addEventListener('submit', submit);
      expect(input.type).toBe('password');
      expect(input.value).toBe('');
      input.value = 'a-new-password';
      button.click();
      expect(input.type).toBe('text');
      expect(button.getAttribute('aria-label')).toBe('隐藏密码');
      expect(button.getAttribute('aria-pressed')).toBe('true');
      button.click();
      expect(input.type).toBe('password');
      expect(button.getAttribute('aria-label')).toBe('显示密码');
      expect(input.value).toBe('a-new-password');
      expect(submit).not.toHaveBeenCalled();
      expect(new dom.window.FormData(document.querySelector('form')!).get('pwd')).toBe('a-new-password');
    } finally {
      dom.window.close();
    }
  });
});
