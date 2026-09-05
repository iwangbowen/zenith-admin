import { emailConfigContract } from '@zenith/shared/messaging';
import { contractKey, useApiMutation, useApiQuery } from '@/lib/contract-query';

export const emailConfigKeys = {
  detail: contractKey(emailConfigContract.get),
};

export function useEmailConfig() {
  return useApiQuery(emailConfigContract.get);
}

export function useSaveEmailConfig() {
  return useApiMutation(emailConfigContract.save, {
    invalidate: (qc) => {
      void qc.invalidateQueries({ queryKey: emailConfigKeys.detail });
    },
  });
}

export function useTestEmailConfig() {
  return useApiMutation(emailConfigContract.test);
}