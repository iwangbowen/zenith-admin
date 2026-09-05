import { keepPreviousData } from '@tanstack/react-query';
import type { QueryOf } from '@zenith/shared/core';
import { smsSendLogContract } from '@zenith/shared/messaging';
import { contractKey, useApiMutation, useApiQuery } from '@/lib/contract-query';

export type SmsSendLogListParams = NonNullable<QueryOf<typeof smsSendLogContract.list>>;

export const smsSendLogKeys = {
  lists: contractKey(smsSendLogContract.list),
  list: (params: SmsSendLogListParams) => contractKey(smsSendLogContract.list, { query: params }),
};

export function useSmsSendLogList(params: SmsSendLogListParams) {
  return useApiQuery(smsSendLogContract.list, { query: params }, { placeholderData: keepPreviousData });
}

/** 测试发送会产生一条发送记录 */
export function useTestSmsSendLog() {
  return useApiMutation(smsSendLogContract.testSend, {
    invalidate: (qc) => {
      void qc.invalidateQueries({ queryKey: smsSendLogKeys.lists });
    },
  });
}

export function useDeleteSmsSendLog() {
  return useApiMutation(smsSendLogContract.remove, {
    invalidate: (qc) => {
      void qc.invalidateQueries({ queryKey: smsSendLogKeys.lists });
    },
  });
}