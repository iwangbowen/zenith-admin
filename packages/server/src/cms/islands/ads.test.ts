// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runAds } from './ads';
import { flush, html, setMemberToken, stubFetch } from './test-utils';

const ADS = `<div class="ad-slot">
  <a href="#" data-ad-id="5" data-ad-clickable="true" data-ad-render-proof="proof-5">A</a>
  <a href="#" data-ad-id="6" data-ad-clickable="false" data-ad-render-proof="proof-6">B</a>
  <a href="#" data-ad-id="5" data-ad-clickable="true" data-ad-render-proof="proof-5">A again</a>
  <a href="#" data-ad-id="7">no proof</a>
</div>`;

describe('ads page island', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    document.head.innerHTML = '<meta name="cms-site" content="main">';
    localStorage.clear();
  });
  afterEach(() => vi.restoreAllMocks());

  it('无广告元素：不发请求', () => {
    const { calls } = stubFetch([]);
    runAds();
    expect(calls).toHaveLength(0);
  });

  it('换取令牌：去重、跳过无签名元素；可点击广告写入带令牌 href；批量上报曝光', async () => {
    setMemberToken('mt');
    const { calls } = stubFetch([
      { code: 0, data: [{ adId: 5, clickToken: 'c5', viewToken: 'v5' }, { adId: 6, clickToken: 'c6', viewToken: 'v6' }] },
      { code: 0 },
    ]);
    html(ADS);
    runAds();
    await flush();
    expect(calls[0]).toMatchObject({ url: '/api/public/cms/ads/tokens/main', method: 'POST' });
    expect(calls[0].body).toEqual({ ads: [{ adId: 5, renderProof: 'proof-5' }, { adId: 6, renderProof: 'proof-6' }] });
    expect(calls[0].headers.Authorization).toBe('Bearer mt');
    const first = document.querySelector<HTMLAnchorElement>('[data-ad-id="5"]')!;
    expect(first.getAttribute('href')).toBe('/api/public/cms/ads/5/click?token=c5');
    // 不可点击广告不改 href
    expect(document.querySelector<HTMLAnchorElement>('[data-ad-id="6"]')!.getAttribute('href')).toBe('#');
    expect(calls[1]).toMatchObject({ url: '/api/public/cms/ads/view', method: 'POST', body: { tokens: ['v5', 'v6'] } });
  });

  it('缺少 cms-site meta：不发请求', () => {
    document.head.innerHTML = '';
    const { calls } = stubFetch([]);
    html(ADS);
    runAds();
    expect(calls).toHaveLength(0);
  });
});
