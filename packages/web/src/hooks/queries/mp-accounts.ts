import type { QueryOf } from '@zenith/shared/core';
import { mpAccountContract } from '@zenith/shared/mp';
import { createResourceQueries, useApiMutation, useApiQuery } from '@/lib/contract-query';

export type MpAccountListParams = QueryOf<typeof mpAccountContract.list>;

export const {
  keys: mpAccountKeys,
  useList: useMpAccountList,
  useDetail: useMpAccountDetail,
  useSave: useSaveMpAccount,
  useDelete: useDeleteMpAccounts,
} = createResourceQueries(mpAccountContract);

/** 公众号切换器下拉源：契约无 all 端点，取列表首页（最多 100 条）；key 落在 lists 前缀下，随保存 / 删除一并失效 */
export function useMpAccountOptions() {
  return useApiQuery(mpAccountContract.list, { query: { page: 1, pageSize: 100 } });
}

/** 设为默认会同时改变原默认账号：全部详情与列表（含切换器下拉源）都需失效 */
export function useSetDefaultMpAccount() {
  return useApiMutation(mpAccountContract.setDefault, {
    invalidate: (qc) => {
      void qc.invalidateQueries({ queryKey: [...mpAccountKeys.all, 'detail'] });
      void qc.invalidateQueries({ queryKey: mpAccountKeys.lists });
    },
  });
}

/** 测试连接只校验凭证并缓存 access_token，不改变任何已缓存的账号数据 */
export function useTestMpAccount() {
  return useApiMutation(mpAccountContract.testConnection);
}
