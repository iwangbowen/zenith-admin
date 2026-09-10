// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mountCaptcha } from './captcha';
import { flush, html, stubFetch } from './test-utils';

const BOX = `<div class="cms-captcha-box" data-island="captcha">
  <input type="hidden" name="captchaId" value="">
  <label>验证码 <input type="text" name="captchaAnswer" required></label>
  <span class="cms-captcha-img"></span>
</div>`;

describe('captcha island', () => {
  beforeEach(() => { document.body.innerHTML = ''; });
  afterEach(() => vi.restoreAllMocks());

  it('挂载即拉取算术题：写入 captchaId、注入 SVG 与提示；点击图片刷新', async () => {
    const { calls } = stubFetch([
      { code: 0, data: { id: 'c1', svg: '<svg data-n="1"></svg>' } },
      { code: 0, data: { id: 'c2', svg: '<svg data-n="2"></svg>' } },
    ]);
    const box = html(BOX).querySelector<HTMLElement>('.cms-captcha-box')!;
    mountCaptcha(box);
    await flush();
    expect(calls[0].url).toBe('/api/public/cms/captcha');
    expect(box.querySelector<HTMLInputElement>('input[name="captchaId"]')!.value).toBe('c1');
    const image = box.querySelector<HTMLElement>('.cms-captcha-img')!;
    expect(image.innerHTML).toBe('<svg data-n="1"></svg>');
    expect(image.title).toBe('看不清？点击刷新');

    image.click();
    await flush();
    expect(calls).toHaveLength(2);
    expect(box.querySelector<HTMLInputElement>('input[name="captchaId"]')!.value).toBe('c2');
    expect(image.innerHTML).toBe('<svg data-n="2"></svg>');
  });

  it('接口失败：保持空白，不抛错', async () => {
    stubFetch([{ code: 500 }]);
    const box = html(BOX).querySelector<HTMLElement>('.cms-captcha-box')!;
    expect(() => mountCaptcha(box)).not.toThrow();
    await flush();
    expect(box.querySelector<HTMLInputElement>('input[name="captchaId"]')!.value).toBe('');
  });
});
