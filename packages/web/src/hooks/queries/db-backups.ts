import type { QueryOf } from '@zenith/shared/core';
import { dbBackupContract } from '@zenith/shared/ops';
import { createResourceQueries, useApiMutation, useApiQuery } from '@/lib/contract-query';
import { keepPreviousData } from '@tanstack/react-query';

export type DbBackupListParams = NonNullable<QueryOf<typeof dbBackupContract.list>>;

export const {
  keys: dbBackupKeys,
  useDelete: useDeleteDbBackups,
} = createResourceQueries(dbBackupContract);

/** 备份任务在后台执行，页面按需轮询列表观察 pending → success / failed */
export function useDbBackupList(params: DbBackupListParams, options?: { refetchInterval?: number | false }) {
  return useApiQuery(dbBackupContract.list, { query: params }, {
    placeholderData: keepPreviousData,
    refetchInterval: options?.refetchInterval,
  });
}

/** 创建备份只返回任务回执，新记录经列表失效回源 */
export function useCreateDbBackup() {
  return useApiMutation(dbBackupContract.create, {
    invalidate: (qc) => {
      void qc.invalidateQueries({ queryKey: dbBackupKeys.all });
    },
  });
}
