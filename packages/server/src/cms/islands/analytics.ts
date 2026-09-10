import { readMeta } from './shared/meta';

function randomId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
}

function stableId(storage: Storage, key: string): string {
  let id = storage.getItem(key);
  if (!id) {
    id = randomId();
    storage.setItem(key, id);
  }
  return id;
}

function beacon(url: string, payload: unknown): void {
  navigator.sendBeacon(url, new Blob([JSON.stringify(payload)], { type: 'application/json' }));
}

/**
 * 行为采集 beacon（页面级）：站点开启统计时 SeoHead 输出 `<meta name="cms-analytics-key">`，
 * 详情页另有 `<meta name="cms-content-id">` 供浏览计数。匿名 id 落 localStorage、会话 id 落 sessionStorage。
 */
export function runAnalytics(doc: Document = document): void {
  const siteKey = readMeta('cms-analytics-key', doc);
  if (!siteKey) return;
  try {
    const anonymousId = stableId(localStorage, 'cms_aid');
    const sessionId = stableId(sessionStorage, 'cms_sid');
    beacon(`/api/analytics/events?siteKey=${encodeURIComponent(siteKey)}`, {
      events: [{
        eventType: 'page_view',
        sessionId,
        anonymousId,
        pagePath: location.pathname,
        pageTitle: doc.title,
        referrer: doc.referrer || undefined,
      }],
    });
    const contentId = Number(readMeta('cms-content-id', doc));
    if (contentId) beacon('/api/public/cms/view', { contentId });
  } catch {
    // 存储不可用（隐私模式）等：采集失败不影响页面
  }
}
