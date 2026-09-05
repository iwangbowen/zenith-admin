import { keepPreviousData, useMutation, useQueryClient } from '@tanstack/react-query';
import { userAiConfigContract } from '@zenith/shared/ai';
import type { SaveUserAiConfigInput, UserAiConfig } from '@zenith/shared/ai';
import { resourceKeyOf } from '@zenith/shared/core';
import { api, contractKey, useApiMutation, useApiQuery } from '@/lib/contract-query';
import { LOOKUP_STALE_TIME } from '@/lib/query';
import { aiProviderKeys } from './ai-providers';

export const aiUserConfigKeys = {
  all: [resourceKeyOf(userAiConfigContract.basePath)] as const,
  lists: contractKey(userAiConfigContract.list),
};

export function useAiUserConfigs(enabled = true) {
  return useApiQuery(userAiConfigContract.list, {
    enabled,
    placeholderData: keepPreviousData,
    staleTime: LOOKUP_STALE_TIME,
  });
}

/** 无 id 走创建，有 id 走更新；个人 API Key 会改变聊天可选模型，但不影响供应商配置本身，故只失效模型列表 */
export function useSaveAiUserConfig() {
  const qc = useQueryClient();
  return useMutation<UserAiConfig, Error, { id?: number; values: SaveUserAiConfigInput }>({
    mutationFn: ({ id, values }) =>
      id === undefined
        ? api(userAiConfigContract.create, { body: values })
        : api(userAiConfigContract.update, { params: { id }, body: values }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: aiUserConfigKeys.lists });
      void qc.invalidateQueries({ queryKey: aiProviderKeys.chatModels });
    },
  });
}

export function useDeleteAiUserConfig() {
  return useApiMutation(userAiConfigContract.remove, {
    invalidate: (qc) => {
      void qc.invalidateQueries({ queryKey: aiUserConfigKeys.lists });
      void qc.invalidateQueries({ queryKey: aiProviderKeys.chatModels });
    },
  });
}
