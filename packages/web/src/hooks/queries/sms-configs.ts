import { smsConfigContract } from '@zenith/shared/messaging';
import { createResourceQueries, useApiMutation } from '@/lib/contract-query';

export const {
  keys: smsConfigKeys,
  useList: useSmsConfigList,
  useDetail: useSmsConfigDetail,
  useSave: useSaveSmsConfig,
  useDelete: useDeleteSmsConfig,
} = createResourceQueries(smsConfigContract);

/** 设为默认会同时改变当前与原默认配置的 isDefault：所有详情与列表一起失效 */
export function useSetDefaultSmsConfig() {
  return useApiMutation(smsConfigContract.setDefault, {
    invalidate: (qc) => {
      void qc.invalidateQueries({ queryKey: [...smsConfigKeys.all, 'detail'] });
      void qc.invalidateQueries({ queryKey: smsConfigKeys.lists });
    },
  });
}