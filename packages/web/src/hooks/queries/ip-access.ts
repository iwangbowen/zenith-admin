import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { QueryOf } from '@zenith/shared/core';
import { ipAccessLogContract, systemConfigContract, type SystemConfig } from '@zenith/shared/platform';
import { api, contractKey, useApiQuery } from '@/lib/contract-query';

export type IpAccessLogListParams = NonNullable<QueryOf<typeof ipAccessLogContract.list>>;

export interface IpConfigMap {
  ip_whitelist_enabled?: SystemConfig;
  ip_whitelist?: SystemConfig;
  ip_blacklist_enabled?: SystemConfig;
  ip_blacklist?: SystemConfig;
}

/** IP 访问控制页把「拦截日志」与「派生自系统配置的开关」放在同一命名空间下，保存后一并回源 */
export const ipAccessKeys = {
  all: ['ip-access'] as const,
  config: ['ip-access', 'config'] as const,
  logs: contractKey(ipAccessLogContract.list),
  logList: (params: IpAccessLogListParams) => contractKey(ipAccessLogContract.list, { query: params }),
};

export function useIpAccessLogs(params: IpAccessLogListParams) {
  return useApiQuery(ipAccessLogContract.list, { query: params }, { placeholderData: keepPreviousData });
}

export function useIpAccessConfigs() {
  return useQuery({
    queryKey: ipAccessKeys.config,
    queryFn: async () => {
      const data = await api(systemConfigContract.list, { query: { keyword: 'ip_', pageSize: 20 } });
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

function upsertConfig(existing: SystemConfig | undefined, configKey: string, configName: string, configType: SystemConfig['configType'], configValue: string, description: string) {
  if (existing?.id) {
    return api(systemConfigContract.update, { params: { id: existing.id }, body: { configValue } });
  }
  return api(systemConfigContract.create, { body: { configKey, configName, configType, configValue, description } });
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
          upsertConfig(configs.ip_whitelist_enabled, 'ip_whitelist_enabled', 'IP 白名单开关', 'boolean', String(enabled), '是否开启IP白名单访问控制'),
          upsertConfig(configs.ip_whitelist, 'ip_whitelist', 'IP 白名单', 'json', listJson, 'IP白名单列表（支持CIDR，JSON数组）'),
        ]);
      } else {
        await Promise.all([
          upsertConfig(configs.ip_blacklist_enabled, 'ip_blacklist_enabled', 'IP 黑名单开关', 'boolean', String(enabled), '是否开启IP黑名单访问控制'),
          upsertConfig(configs.ip_blacklist, 'ip_blacklist', 'IP 黑名单', 'json', listJson, 'IP黑名单列表（支持CIDR，JSON数组）'),
        ]);
      }
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ipAccessKeys.all }),
  });
}
