import { keepPreviousData } from '@tanstack/react-query';
import type { QueryOf } from '@zenith/shared/core';
import { loginLogContract } from '@zenith/shared/identity';
import { contractKey, useApiMutation, useApiQuery } from '@/lib/contract-query';

export type LoginLogListParams = NonNullable<QueryOf<typeof loginLogContract.list>>;

export type LoginLogStatsParams = NonNullable<QueryOf<typeof loginLogContract.stats>>;

export const loginLogKeys = {
  lists: contractKey(loginLogContract.list),
  list: (params: LoginLogListParams) => contractKey(loginLogContract.list, { query: params }),
  stats: contractKey(loginLogContract.stats),
  statsDetail: (params: LoginLogStatsParams) => contractKey(loginLogContract.stats, { query: params }),
};

export function useLoginLogList(params: LoginLogListParams) {
  return useApiQuery(loginLogContract.list, { query: params }, { placeholderData: keepPreviousData });
}

export function useLoginLogStats(params: LoginLogStatsParams) {
  return useApiQuery(loginLogContract.stats, { query: params }, {
    // 切换统计周期时保留上一周期数据，由面板的 Spin 覆盖刷新，避免整屏回退骨架
    placeholderData: keepPreviousData,
  });
}

/** 清理日志：列表与由日志聚合的统计面板都会变化，是本域全部两个查询 */
export function useCleanLoginLogs() {
  return useApiMutation(loginLogContract.clean, {
    invalidate: (qc) => {
      void qc.invalidateQueries({ queryKey: loginLogKeys.lists });
      void qc.invalidateQueries({ queryKey: loginLogKeys.stats });
    },
  });
}
