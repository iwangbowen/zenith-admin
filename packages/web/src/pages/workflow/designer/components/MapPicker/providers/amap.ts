import { wgs2gcj, gcj2wgs } from '../coordConvert';
import type { MapProvider } from '../mapProvider';

let p: Promise<void> | null = null;

function loadScript(key: string, security?: string): Promise<void> {
  if (security) (window as any)._AMapSecurityConfig = { securityJsCode: security };
  if (window.AMap && window.AMap.Map) return Promise.resolve();
  if (p) return p;
  p = new Promise<void>((resolve) => {
    const s = document.createElement('script');
    s.src = `https://webapi.amap.com/maps?v=2.0&key=${encodeURIComponent(key)}`;
    s.async = true;
    s.onload = () => {
      const t0 = Date.now();
      const t = window.setInterval(() => {
        if (window.AMap?.Map) {
          window.clearInterval(t);
          resolve();
        } else if (Date.now() - t0 > 8000) {
          window.clearInterval(t);
          resolve();
        }
      }, 60);
    };
    s.onerror = () => {
      p = null;
      resolve();
    };
    document.head.appendChild(s);
  });
  return p;
}

async function reverseGeocode(lng: number, lat: number, key: string, security?: string): Promise<string> {
  const g = wgs2gcj(lng, lat);
  await loadScript(key, security);
  try {
    const AMap = window.AMap;
    const geocoder = await new Promise<any>((res, rej) => {
      AMap.plugin(['AMap.Geocoder'], () => res(new AMap.Geocoder()));
      window.setTimeout(() => rej(new Error('timeout')), 5000);
    });
    // 高德 2.0 回调签名为 (status, result)，故取第二个参数；`result ?? status` 同时兼容单参变体
    const r = await new Promise<any>((res) => geocoder.getAddress([g.lng, g.lat], (status: any, result: any) => res(result ?? status)));
    if (r?.regeocode?.formattedAddress) return r.regeocode.formattedAddress;
  } catch {
    /* 忽略，返回空 */
  }
  return '';
}

export const amapProvider: MapProvider = {
  id: 'amap',
  label: '高德',
  coordSystem: 'GCJ-02',
  loadScript: (k, s) => loadScript(k, s),
  createMap({ container, center, zoom }) {
    const g = wgs2gcj(center.lng, center.lat);
    const map = new window.AMap.Map(container, { center: [g.lng, g.lat], zoom });
    return {
      onClick(cb) {
        map.on('click', (e: any) => cb(gcj2wgs(e.lnglat.getLng(), e.lnglat.getLat())));
      },
      checkResize() {
        window.AMap?.Event?.trigger?.(map, 'resize');
      },
      destroy() {
        map.destroy?.();
      },
    };
  },
  reverseGeocode: (lng, lat, k, s) => reverseGeocode(lng, lat, k, s),
};
