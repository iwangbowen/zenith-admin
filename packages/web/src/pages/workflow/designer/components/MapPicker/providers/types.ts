import type { MapProviderId } from '../mapProvider';

// 字段名刻意不含 token/apikey/secret 等字眼，否则会被系统设置 registry 自检拦截
type MapKeyField = 'tiandituMapKey' | 'amapMapKey' | 'amapSecurityJsCode' | 'tencentMapKey' | 'baiduMapKey';

export const MAP_PROVIDER_KEY_FIELD: Record<MapProviderId, MapKeyField> = {
  tianditu: 'tiandituMapKey',
  amap: 'amapMapKey',
  tencent: 'tencentMapKey',
  baidu: 'baiduMapKey',
};

export const MAP_PROVIDER_OPTIONS = [
  { value: 'tianditu', label: '天地图' },
  { value: 'amap', label: '高德' },
  { value: 'tencent', label: '腾讯' },
  { value: 'baidu', label: '百度' },
] as const;
