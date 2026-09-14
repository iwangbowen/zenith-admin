import { wgs2bd09, bd092wgs } from '../coordConvert';
import type { MapProvider } from '../mapProvider';

let p: Promise<void> | null = null;

function loadScript(key: string): Promise<void> {
  if (window.BMap && window.BMap.Map) return Promise.resolve();
  if (p) return p;
  p = new Promise<void>((resolve) => {
    const cbName = '__zenithBaiduInit';
    const prev = (window as any)[cbName];
    (window as any)[cbName] = () => {
      if (prev) prev();
      (window as any)[cbName] = prev;
      resolve();
    };
    const s = document.createElement('script');
    s.src = `https://api.map.baidu.com/api?v=3.0&ak=${encodeURIComponent(key)}&callback=${cbName}`;
    s.async = true;
    s.onerror = () => {
      (window as any)[cbName] = prev;
      p = null;
      resolve();
    };
    document.head.appendChild(s);
  });
  return p;
}

async function reverseGeocode(lng: number, lat: number, key: string): Promise<string> {
  const b = wgs2bd09(lng, lat);
  await loadScript(key);
  try {
    const geocoder = new window.BMap.Geocoder();
    const res = await new Promise<any>((resolve) => geocoder.getLocation(new window.BMap.Point(b.lng, b.lat), (r: any) => resolve(r)));
    if (res?.address) return res.address;
  } catch {
    /* 忽略 */
  }
  return '';
}

export const baiduProvider: MapProvider = {
  id: 'baidu',
  label: '百度',
  coordSystem: 'BD-09',
  loadScript: (k) => loadScript(k),
  createMap({ container, center, zoom }) {
    const b = wgs2bd09(center.lng, center.lat);
    const map = new window.BMap.Map(container);
    map.centerAndZoom(new window.BMap.Point(b.lng, b.lat), zoom);
    return {
      onClick(cb) {
        map.addEventListener('click', (e: any) => cb(bd092wgs(e.point.lng, e.point.lat)));
      },
      checkResize() {
        map.checkResize?.();
      },
      destroy() {
        map.destroy?.();
      },
    };
  },
  reverseGeocode: (lng, lat, k) => reverseGeocode(lng, lat, k),
};
