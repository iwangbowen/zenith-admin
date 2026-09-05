import { keepPreviousData } from '@tanstack/react-query';
import type { QueryOf } from '@zenith/shared/core';
import { emailSendLogContract } from '@zenith/shared/messaging';
import { contractKey, useApiMutation, useApiQuery } from '@/lib/contract-query';

export type EmailSendLogListParams = NonNullable<QueryOf<typeof emailSendLogContract.list>>;

export const emailSendLogKeys = {
  lists: contractKey(emailSendLogContract.list),
  list: (params: EmailSendLogListParams) => contractKey(emailSendLogContract.list, { query: params }),
};

export function useEmailSendLogList(params: EmailSendLogListParams) {
  return useApiQuery(emailSendLogContract.list, { query: params }, { placeholderData: keepPreviousData });
}

/** 测试发送会产生一条发送记录 */
export function useTestEmailSendLog() {
  return useApiMutation(emailSendLogContract.testSend, {
    invalidate: (qc) => {
      void qc.invalidateQueries({ queryKey: emailSendLogKeys.lists });
    },
  });
}

export function useDeleteEmailSendLog() {
  return useApiMutation(emailSendLogContract.remove, {
    invalidate: (qc) => {
      void qc.invalidateQueries({ queryKey: emailSendLogKeys.lists });
    },
  });
}