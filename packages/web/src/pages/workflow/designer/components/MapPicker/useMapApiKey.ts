import { usePublicSettings } from '@/hooks/queries/settings';
import { MAP_PROVIDER_KEY_FIELD } from './providers/types';
import type { MapProviderId } from './mapProvider';

/** 从系统设置 public 投影读取各厂商 Key（Key 需前端持有以拼入脚本 URL） */
export function useMapApiKey(provider: MapProviderId) {
  const { data } = usePublicSettings();
  const map = data?.map;
  return {
    apiKey: (map?.[MAP_PROVIDER_KEY_FIELD[provider]] ?? '') as string,
    securityJsCode: (map?.amapSecurityJsCode ?? '') as string,
  };
}
