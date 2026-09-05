import { useMemo } from 'react';
import { useMutation } from '@tanstack/react-query';
import { dataMaskConfigContract } from '@zenith/shared/platform';
import { api, createResourceQueries, useApiMutation } from '@/lib/contract-query';
import { useAllRoles } from './roles';

const resource = createResourceQueries(dataMaskConfigContract);

export const dataMaskKeys = resource.keys;

export const useDataMaskList = resource.useList;
export const useDataMaskDetail = resource.useDetail;
export const useSaveDataMask = resource.useSave;
/** 服务端未提供 DELETE /batch，多条时逐条删除 */
export const useDeleteDataMasks = resource.useDelete;

/**
 * 角色选项。数据实际归属 roles 域，复用其共享 lookup，
 * 避免以 dataMaskKeys 为键导致角色增删改后没有来源失效它。
 */
export function useDataMaskRoleOptions() {
  const rolesQuery = useAllRoles();
  const data = useMemo(
    () => (rolesQuery.data ?? []).map((r) => ({ value: r.code, label: r.name })),
    [rolesQuery.data],
  );
  return { data, isFetching: rolesQuery.isFetching, isSuccess: rolesQuery.isSuccess };
}

/** 扫描是按需触发的只读动作，结果只在弹窗内消费，不进入查询缓存 */
export function useScanDataMaskFields() {
  return useMutation({ mutationFn: () => api(dataMaskConfigContract.scan) });
}

export function useBatchCreateDataMask() {
  return useApiMutation(dataMaskConfigContract.batchCreate, {
    // 批量创建的 id 未知，只需刷新列表
    invalidate: (qc) => void qc.invalidateQueries({ queryKey: dataMaskKeys.lists }),
  });
}
