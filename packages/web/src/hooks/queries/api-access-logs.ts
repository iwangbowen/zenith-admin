import { keepPreviousData } from '@tanstack/react-query';
import { resourceKeyOf, type QueryOf } from '@zenith/shared/core';
import { apiAccessLogContract, traceContract } from '@zenith/shared/platform';
import { contractKey, useApiMutation, useApiQuery } from '@/lib/contract-query';

export type ApiAccessLogListParams = NonNullable<QueryOf<typeof apiAccessLogContract.list>>;

export const apiAccessLogKeys = {
  all: [resourceKeyOf(apiAccessLogContract.basePath)] as const,
  lists: contractKey(apiAccessLogContract.list),
  details: contractKey(apiAccessLogContract.detail),
  detail: (id: number | undefined) => contractKey(apiAccessLogContract.detail, { params: { id: id ?? 0 } }),
};

export function useApiAccessLogList(params: ApiAccessLogListParams, enabled = true) {
  return useApiQuery(apiAccessLogContract.list, { query: params }, { placeholderData: keepPreviousData, enabled });
}

export function useApiAccessLogDetail(id: number | undefined, enabled = true) {
  return useApiQuery(apiAccessLogContract.detail, { params: { id: id ?? 0 } }, { enabled: enabled && id !== undefined });
}

export function useCleanApiAccessLogs() {
  return useApiMutation(apiAccessLogContract.clean, {
    invalidate: (qc) => {
      void qc.invalidateQueries({ queryKey: apiAccessLogKeys.lists });
      qc.removeQueries({ queryKey: apiAccessLogKeys.details });
      // 链路时间线会回退读取 API 访问记录，清除后同步移除这些请求节点。
      void qc.invalidateQueries({ queryKey: contractKey(traceContract.timeline) });
    },
  });
}

