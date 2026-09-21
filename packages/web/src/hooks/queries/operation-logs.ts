import { keepPreviousData } from '@tanstack/react-query';
import { resourceKeyOf, type QueryOf } from '@zenith/shared/core';
import { operationLogContract } from '@zenith/shared/platform';
import { contractKey, useApiMutation, useApiQuery } from '@/lib/contract-query';

export type OperationLogListParams = NonNullable<QueryOf<typeof operationLogContract.list>>;

export type OperationLogStatsParams = NonNullable<QueryOf<typeof operationLogContract.stats>>;

export const operationLogKeys = {
  all: [resourceKeyOf(operationLogContract.basePath)] as const,
  lists: contractKey(operationLogContract.list),
  list: (params: OperationLogListParams) => contractKey(operationLogContract.list, { query: params }),
  stats: contractKey(operationLogContract.stats),
  statsDetail: (params: OperationLogStatsParams) => contractKey(operationLogContract.stats, { query: params }),
};

/** `enabled = false` 时不发请求：用户管理页的「操作记录」抽屉只在对应 tab 激活时拉取 */
export function useOperationLogList(params: OperationLogListParams, enabled = true) {
  return useApiQuery(operationLogContract.list, { query: params }, { placeholderData: keepPreviousData, enabled });
}
export function useOperationLogDetail(id: number | undefined, enabled = true) {
  return useApiQuery(operationLogContract.detail, { params: { id: id ?? 0 } }, { enabled: enabled && id !== undefined });
}

export function useOperationLogStats(params: OperationLogStatsParams) {
  return useApiQuery(operationLogContract.stats, { query: params }, {
    // 切换统计周期时保留上一周期数据，由面板的 Spin 覆盖刷新，避免整屏回退骨架
    placeholderData: keepPreviousData,
  });
}

/** 清理会同时改变列表与统计口径，整域失效 */
export function useCleanOperationLogs() {
  return useApiMutation(operationLogContract.clean, {
    invalidate: (qc) => void qc.invalidateQueries({ queryKey: operationLogKeys.all }),
  });
}
