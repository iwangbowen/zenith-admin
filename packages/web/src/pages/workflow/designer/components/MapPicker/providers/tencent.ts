import { wgs2gcj, gcj2wgs } from '../coordConvert';
import type { MapProvider } from '../mapProvider';

let p: Promise<void> | null = null;

function loadScript(key: string): Promise<void> {
  if (window.qq! && window.qq!.maps && window.qq!.maps.Map) return Promise.resolve();
  if (p) return p;
  p = new Promise<void>((resolve) => {
    const s = document.createElement('script');
    s.src = `https://map.qq.com/api/gljs?v=1.exp&libraries=service&key=${encodeURIComponent(key)}`;
    s.async = true;
    s.onload = () => {
      const t0 = Date.now();
      const t = window.setInterval(() => {
        if (window.qq?.maps?.Map) {
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

async function reverseGeocode(lng: number, lat: number, key: string): Promise<string> {
  const g = wgs2gcj(lng, lat);
  await loadScript(key);
  try {
    const geocoder = new window.qq!.maps.Geocoder();
    const res = await new Promise<any>((resolve) => geocoder.getAddress(new window.qq!.maps.LatLng(g.lat, g.lng), (r: any) => resolve(r)));
    if (res?.detail?.address) return res.detail.address;
  } catch {
    /* 忽略 */
  }
  return '';
}

export const tencentProvider: MapProvider = {
  id: 'tencent',
  label: '腾讯',
  coordSystem: 'GCJ-02',
  loadScript: (k) => loadScript(k),
  createMap({ container, center, zoom }) {
    const g = wgs2gcj(center.lng, center.lat);
    // 注意：腾讯 LatLng 参数为 (lat, lng)
    const map = new window.qq!.maps.Map(container, { center: new window.qq!.maps.LatLng(g.lat, g.lng), zoom });
    return {
      onClick(cb) {
        window.qq!.maps.event.addListener(map, 'click', (e: any) => cb(gcj2wgs(e.latLng.lng, e.latLng.lat)));
      },
      checkResize() {
        window.qq!.maps.event.trigger(map, 'resize');
      },
      destroy() {
        /* 腾讯无显式 destroy，移除容器即可 */
      },
    };
  },
  reverseGeocode: (lng, lat, k) => reverseGeocode(lng, lat, k),
};
