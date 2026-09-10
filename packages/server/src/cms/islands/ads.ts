import { apiHeaders, apiJson, isOk } from './shared/api';
import { readMemberToken } from './shared/member';
import { readMeta } from './shared/meta';

interface AdTokenRow {
  adId: number;
  clickToken?: string | null;
  viewToken?: string | null;
}

/**
 * 广告事件（页面级）：收集本页 `[data-ad-id]` 元素及其服务端签名 data-ad-render-proof，换取一次性令牌——
 * 可点击广告写入带令牌的点击跳转 href，并批量上报曝光。静态页同样在浏览器端完成，无广告时零开销。
 */
export function runAds(doc: Document = document): void {
  const siteCode = readMeta('cms-site', doc);
  const elements = doc.querySelectorAll<HTMLElement>('[data-ad-id]');
  if (!siteCode || !elements.length) return;

  const ads: { adId: number; renderProof: string }[] = [];
  for (const el of elements) {
    const adId = Number(el.getAttribute('data-ad-id'));
    const renderProof = el.getAttribute('data-ad-render-proof');
    if (adId && renderProof && !ads.some((item) => item.adId === adId)) ads.push({ adId, renderProof });
  }
  if (!ads.length) return;

  const headers = apiHeaders(readMemberToken(), true);
  apiJson<AdTokenRow[]>(`/api/public/cms/ads/tokens/${encodeURIComponent(siteCode)}`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ ads }),
  })
    .then((result) => {
      if (!isOk(result) || !Array.isArray(result.data)) return;
      const views: string[] = [];
      for (const item of result.data) {
        const el = doc.querySelector<HTMLAnchorElement>(`[data-ad-id="${item.adId}"]`);
        if (!el) continue;
        if (item.clickToken && el.getAttribute('data-ad-clickable') === 'true') {
          el.href = `/api/public/cms/ads/${item.adId}/click?token=${encodeURIComponent(item.clickToken)}`;
        }
        if (item.viewToken) views.push(item.viewToken);
      }
      if (views.length) {
        return fetch('/api/public/cms/ads/view', { method: 'POST', headers, body: JSON.stringify({ tokens: views }), keepalive: true });
      }
    })
    .catch(() => {});
}
