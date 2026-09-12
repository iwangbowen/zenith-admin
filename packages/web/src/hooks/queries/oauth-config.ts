import { oauthConfigContract } from '@zenith/shared/identity';
import { contractKey, useApiMutation, useApiQuery } from '@/lib/contract-query';

/** 本域只有一份不分页的配置列表（无 detail 操作），写操作后列表即唯一需要刷新的面 */
export const oauthConfigKeys = {
  lists: contractKey(oauthConfigContract.list),
  list: () => contractKey(oauthConfigContract.list),
};

export function useOAuthConfigs() {
  return useApiQuery(oauthConfigContract.list);
}

/** 整体替换保存单个 provider 的配置（`clientSecret` 传掩码或省略时保留原值） */
export function useSaveOAuthConfig() {
  return useApiMutation(oauthConfigContract.update, {
    invalidate: (qc) => void qc.invalidateQueries({ queryKey: oauthConfigKeys.lists }),
  });
}
