import { readMeta } from './shared/meta';
import { CMS_ATTRIBUTION_EVENT_NAMES, type CmsAttributionContext } from '@zenith/shared/cms';

const listeners = new WeakMap<Document, AbortController>();
export function getCmsAttributionContext(doc: Document = document): CmsAttributionContext | undefined {
  const key = readMeta('cms-analytics-key', doc);
  if (!key) return undefined;
  try {
    const storageKey = `cms_entry_${key}`;
    let entry: { entryPath: string; entrySource: string };
    const saved = sessionStorage.getItem(storageKey);
    if (saved) entry = JSON.parse(saved) as typeof entry;
    else {
      let referrer = 'direct';
      if (doc.referrer) { try { const url = new URL(doc.referrer); if (url.host !== location.host) referrer = url.host; } catch { /* no referrer attribution */ } }
      entry = { entryPath: location.pathname.slice(0, 500), entrySource: (new URL(location.href).searchParams.get('utm_source') || referrer).slice(0, 128) };
      sessionStorage.setItem(storageKey, JSON.stringify(entry));
    }
    const id = (name: string) => { const value = Number(readMeta(name, doc)); return Number.isSafeInteger(value) && value > 0 ? value : null; };
    return { ...entry, visitorId: stableId(localStorage, 'cms_aid'), contentId: id('cms-content-id'), releaseId: id('cms-release-id'), deploymentId: id('cms-deployment-id') };
  } catch { return undefined; }
}

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
    const context = getCmsAttributionContext(doc);
    const cmsSiteId = Number(readMeta('cms-site-id', doc));
    const properties = context && cmsSiteId > 0 ? Object.fromEntries(Object.entries({ ...context, cmsSiteId }).filter(([, value]) => value !== null && value !== undefined)) : undefined;
    const attributionEvent = (eventName: string, extra?: Record<string, unknown>) => ({ eventType: 'custom', eventName, sessionId, anonymousId, pagePath: location.pathname, properties: { ...properties, ...extra } });
    beacon(`/api/analytics/events?siteKey=${encodeURIComponent(siteKey)}`, {
      events: [{
        eventType: 'page_view',
        sessionId,
        anonymousId,
        pagePath: location.pathname,
        pageTitle: doc.title,
        referrer: doc.referrer || undefined,
      }, ...(properties ? [attributionEvent(CMS_ATTRIBUTION_EVENT_NAMES.entry), ...(context?.contentId ? [attributionEvent(CMS_ATTRIBUTION_EVENT_NAMES.read)] : [])] : [])],
    });
    const contentId = Number(readMeta('cms-content-id', doc));
    if (contentId) beacon('/api/public/cms/view', { contentId });
    listeners.get(doc)?.abort();
    const controller = new AbortController(); listeners.set(doc, controller);
    doc.addEventListener('click', (event) => {
      if (!properties || !(event.target instanceof Element)) return;
      const link = event.target.closest<HTMLAnchorElement>('a[download],.attachments a,.model-display-download a,.home-hero a,.home-banner a,.cms-block-hero a,[data-cms-topic]');
      if (!link) return;
      const isDownload = link.hasAttribute('download') || Boolean(link.closest('.attachments,.model-display-download'));
      let targetPath = ''; try { targetPath = new URL(link.href, location.href).pathname; } catch { return; }
      beacon(`/api/analytics/events?siteKey=${encodeURIComponent(siteKey)}`, { events: [attributionEvent(isDownload ? CMS_ATTRIBUTION_EVENT_NAMES.download : CMS_ATTRIBUTION_EVENT_NAMES.topicClick, { targetPath: targetPath.slice(0, 500) })] });
    }, { signal: controller.signal });
    doc.addEventListener('submit', (event) => {
      if (!(event.target instanceof HTMLFormElement) || !context || !event.target.action.includes('/api/public/cms/forms/')) return;
      const form = event.target;
      let field = form.querySelector<HTMLInputElement>('input[name="_cmsAttribution"]');
      if (!field) { field = doc.createElement('input'); field.type = 'hidden'; field.name = '_cmsAttribution'; form.append(field); }
      field.value = JSON.stringify(context);
    }, { capture: true, signal: controller.signal });
  } catch {
    // 存储不可用（隐私模式）等：采集失败不影响页面
  }
}
