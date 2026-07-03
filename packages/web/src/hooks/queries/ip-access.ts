import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { IpAccessLog, PaginatedResponse, SystemConfig } from '@zenith/shared';
import { request } from '@/utils/request';
import { toQueryString, unwrap } from '@/lib/query';

export interface IpAccessLogListParams {
  page: number;
  pageSize: number;
  ip?: string;
  blockType?: string;
}

export interface IpConfigMap {
  ip_whitelist_enabled?: SystemConfig;
  ip_whitelist?: SystemConfig;
  ip_blacklist_enabled?: SystemConfig;
  ip_blacklist?: SystemConfig;
}

export const ipAccessKeys = {
  all: ['ip-access'] as const,
  config: ['ip-access', 'config'] as const,
  logs: ['ip-access', 'logs'] as const,
  logList: (params: IpAccessLogListParams) => ['ip-access', 'logs', params] as const,
};

export function useIpAccessLogs(params: IpAccessLogListParams) {
  return useQuery({
    queryKey: ipAccessKeys.logList(params),
    queryFn: () => request.get<PaginatedResponse<IpAccessLog>>(`/api/ip-access-logs${toQueryString(params)}`).then(unwrap),
    placeholderData: keepPreviousData,
  });
}

export function useIpAccessConfigs() {
  return useQuery({
    queryKey: ipAccessKeys.config,
    queryFn: async () => {
      const data = await request.get<PaginatedResponse<SystemConfig>>('/api/system-configs?keyword=ip_&pageSize=20').then(unwrap);
      const map: IpConfigMap = {};
      for (const item of data.list) {
        if (item.configKey === 'ip_whitelist_enabled') map.ip_whitelist_enabled = item;
        if (item.configKey === 'ip_whitelist') map.ip_whitelist = item;
        if (item.configKey === 'ip_blacklist_enabled') map.ip_blacklist_enabled = item;
        if (item.configKey === 'ip_blacklist') map.ip_blacklist = item;
      }
      return map;
    },
  });
}

function upsertConfig(existing: SystemConfig | undefined, configKey: string, configType: string, configValue: string, description: string) {
  if (existing?.id) {
    return request.put<SystemConfig>(`/api/system-configs/${existing.id}`, { configValue }).then(unwrap);
  }
  return request.post<SystemConfig>('/api/system-configs', { configKey, configType, configValue, description }).then(unwrap);
}

export function useSaveIpAccessSection() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      configs,
      section,
      enabled,
      listJson,
    }: {
      configs: IpConfigMap;
      section: 'whitelist' | 'blacklist';
      enabled: boolean;
      listJson: string;
    }) => {
      if (section === 'whitelist') {
        await Promise.all([
          upsertConfig(configs.ip_whitelist_enabled, 'ip_whitelist_enabled', 'boolean', String(enabled), '是否开启IP白名单访问控制'),
          upsertConfig(configs.ip_whitelist, 'ip_whitelist', 'json', listJson, 'IP白名单列表（支持CIDR，JSON数组）'),
        ]);
      } else {
        await Promise.all([
          upsertConfig(configs.ip_blacklist_enabled, 'ip_blacklist_enabled', 'boolean', String(enabled), '是否开启IP黑名单访问控制'),
          upsertConfig(configs.ip_blacklist, 'ip_blacklist', 'json', listJson, 'IP黑名单列表（支持CIDR，JSON数组）'),
        ]);
      }
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ipAccessKeys.all }),
  });
}
