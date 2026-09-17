import { authContract } from '@zenith/shared/identity';
import { apiQueryOptions, contractKey, useApiMutation, useApiQuery } from '@/lib/contract-query';
import { LOOKUP_STALE_TIME } from '@/lib/query';

export const preferencesKey = contractKey(authContract.preferences);

export function preferencesQueryOptions() {
  return apiQueryOptions(authContract.preferences, {
    staleTime: LOOKUP_STALE_TIME,
    refetchOnWindowFocus: true,
    refetchOnReconnect: 'always',
  });
}

export function usePersonalPreferences() {
  return useApiQuery(authContract.preferences, {
    staleTime: LOOKUP_STALE_TIME,
    refetchOnWindowFocus: true,
    refetchOnReconnect: 'always',
  });
}

export function useSavePersonalPreferences() {
  return useApiMutation(authContract.savePreferences, {
    // 连续调整按顺序保存，避免旧请求晚到把新选择覆盖。
    scope: { id: 'personal-preferences' },
    invalidate: (qc, saved) => { qc.setQueryData(preferencesKey, saved); },
  });
}
