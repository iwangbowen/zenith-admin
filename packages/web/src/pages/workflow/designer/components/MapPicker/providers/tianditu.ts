import type { MapProvider } from '../mapProvider';

let p: Promise<void> | null = null;

function loadScript(tk: string): Promise<void> {
  if (window.T! && window.T!.Map && (window.T!.MapType || window.T!.TileLayer)) return Promise.resolve();
  if (p) return p;
  p = new Promise<void>((resolve) => {
    const s = document.createElement('script');
    s.src = `https://api.tianditu.gov.cn/api?v=4.0&tk=${encodeURIComponent(tk)}`;
    s.async = true;
    s.onload = () => {
      const t0 = Date.now();
      const timer = window.setInterval(() => {
        const T = window.T!;
        if (T && T.Map && (T.MapType || T.TileLayer)) {
          window.clearInterval(timer);
          resolve();
        } else if (Date.now() - t0 > 8000) {
          window.clearInterval(timer);
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

async function reverseGeocode(lng: number, lat: number, tk: string): Promise<string> {
  await loadScript(tk);
  const T = window.T!;
  if (T && T.Geocoder) {
    try {
      const geocoder = new T.Geocoder();
      const addr = await new Promise<string>((res) => {
        geocoder.getLocation(new T.LngLat(lng, lat), (r: any) => res(extractSdk(r)));
      });
      if (addr) return addr;
    } catch {
      /* 走 REST */
    }
  }
  if (!tk) return '';
  const postStr = encodeURIComponent(JSON.stringify({ lon: lng, lat, ver: 1 }));
  const url = `https://api.tianditu.gov.cn/geocoder?postStr=${postStr}&type=geocode&tk=${encodeURIComponent(tk)}`;
  try {
    const data = await (await fetch(url)).json();
    return (data?.result?.formatted_address as string) ?? '';
  } catch {
    return '';
  }
}

function extractSdk(r: any): string {
  return r?.getAddress?.() ?? r?.address ?? '';
}

export const tiandituProvider: MapProvider = {
  id: 'tianditu',
  label: '天地图',
  coordSystem: 'WGS-84',
  loadScript: (tk) => loadScript(tk),
  createMap({ container, center, zoom }) {
    const map = new window.T!.Map(container, { center: new window.T!.LngLat(center.lng, center.lat), zoom });
    return {
      onClick(cb) {
        map.addEventListener('click', (e: any) => cb({ lng: +e.lnglat.getLng().toFixed(6), lat: +e.lnglat.getLat().toFixed(6) }));
      },
      checkResize() {
        map.checkResize?.();
      },
      destroy() {
        map.destroy?.();
      },
    };
  },
  reverseGeocode: (lng, lat, tk) => reverseGeocode(lng, lat, tk),
};
