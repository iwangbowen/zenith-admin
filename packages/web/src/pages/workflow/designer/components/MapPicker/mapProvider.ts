import { tiandituProvider } from './providers/tianditu';
import { amapProvider } from './providers/amap';
import { tencentProvider } from './providers/tencent';
import { baiduProvider } from './providers/baidu';

export type MapProviderId = 'tianditu' | 'amap' | 'tencent' | 'baidu';
export type CoordSystem = 'WGS-84' | 'GCJ-02' | 'BD-09';

export interface MapInstance {
  onClick(cb: (wgs: { lng: number; lat: number }) => void): void;
  checkResize(): void;
  destroy(): void;
}

export interface CreateMapOptions {
  container: HTMLElement;
  center: { lng: number; lat: number }; // 一律 WGS-84
  zoom: number;
}

export interface MapProvider {
  id: MapProviderId;
  label: string;
  coordSystem: CoordSystem;
  loadScript(apiKey: string, securityJsCode?: string): Promise<void>;
  createMap(opts: CreateMapOptions): MapInstance;
  reverseGeocode(lng: number, lat: number, apiKey: string, securityJsCode?: string): Promise<string>;
}

export const MAP_PROVIDERS: Record<MapProviderId, MapProvider> = {
  tianditu: tiandituProvider,
  amap: amapProvider,
  tencent: tencentProvider,
  baidu: baiduProvider,
};

export function getMapProvider(id?: MapProviderId): MapProvider {
  return MAP_PROVIDERS[id ?? 'tianditu'] ?? tiandituProvider;
}
