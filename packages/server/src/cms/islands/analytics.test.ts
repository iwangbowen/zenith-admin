// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runAnalytics } from './analytics';

function setHead(metas: Record<string, string>): void {
  document.head.innerHTML = Object.entries(metas).map(([name, content]) => `<meta name="${name}" content="${content}">`).join('');
}

async function readBlob(blob: Blob): Promise<unknown> {
  return JSON.parse(await blob.text());
}

describe('analytics page island', () => {
  let sendBeacon: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    document.head.innerHTML = '';
    sendBeacon = vi.fn(() => true);
    Object.defineProperty(navigator, 'sendBeacon', { value: sendBeacon, configurable: true });
  });
  afterEach(() => vi.restoreAllMocks());

  it('无 cms-analytics-key：不发任何 beacon', () => {
    setHead({ 'cms-site': 'main' });
    runAnalytics();
    expect(sendBeacon).not.toHaveBeenCalled();
  });

  it('列表页：仅上报 page_view，并持久化匿名 id / 会话 id', async () => {
    setHead({ 'cms-analytics-key': 'site-key-1' });
    document.title = '首页';
    runAnalytics();
    expect(sendBeacon).toHaveBeenCalledTimes(1);
    const [url, blob] = sendBeacon.mock.calls[0] as [string, Blob];
    expect(url).toBe('/api/analytics/events?siteKey=site-key-1');
    const payload = await readBlob(blob) as { events: Record<string, unknown>[] };
    expect(payload.events[0]).toMatchObject({ eventType: 'page_view', pageTitle: '首页', pagePath: location.pathname });
    expect(payload.events[0].anonymousId).toBe(localStorage.getItem('cms_aid'));
    expect(payload.events[0].sessionId).toBe(sessionStorage.getItem('cms_sid'));
  });

  it('详情页：额外上报浏览计数；再次运行复用同一匿名 id', async () => {
    setHead({ 'cms-analytics-key': 'k', 'cms-content-id': '99' });
    runAnalytics();
    expect(sendBeacon).toHaveBeenCalledTimes(2);
    const [viewUrl, viewBlob] = sendBeacon.mock.calls[1] as [string, Blob];
    expect(viewUrl).toBe('/api/public/cms/view');
    expect(await readBlob(viewBlob)).toEqual({ contentId: 99 });
    const aid = localStorage.getItem('cms_aid');
    runAnalytics();
    expect(localStorage.getItem('cms_aid')).toBe(aid);
  });
});
