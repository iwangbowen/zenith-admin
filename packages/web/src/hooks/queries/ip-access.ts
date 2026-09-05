import { keepPreviousData } from '@tanstack/react-query';
import type { QueryOf } from '@zenith/shared/core';
import { ipAccessLogContract } from '@zenith/shared/platform';
import { contractKey, useApiQuery } from '@/lib/contract-query';

export type IpAccessLogListParams = NonNullable<QueryOf<typeof ipAccessLogContract.list>>;

/**
 * IP 访问控制页：拦截日志在本域；黑白名单配置本身由运行时设置 ipAccess 模块承载，
 * 读写走 hooks/queries/settings 的 useSettings('ipAccess') / useSaveSettings('ipAccess')。
 */
export const ipAccessKeys = {
  all: ['ip-access'] as const,
  logs: contractKey(ipAccessLogContract.list),
  logList: (params: IpAccessLogListParams) => contractKey(ipAccessLogContract.list, { query: params }),
};

export function useIpAccessLogs(params: IpAccessLogListParams) {
  return useApiQuery(ipAccessLogContract.list, { query: params }, { placeholderData: keepPreviousData });
}
