import { useMutation, useQueryClient } from '@tanstack/react-query';
import { aiHttpToolContract } from '@zenith/shared/ai';
import type { AiHttpTool, CreateAiHttpToolInput } from '@zenith/shared/ai';
import { resourceKeyOf, type BodyOf } from '@zenith/shared/core';
import { api, contractKey, useApiMutation, useApiQuery } from '@/lib/contract-query';
import { LOOKUP_STALE_TIME } from '@/lib/query';

/** 新增与编辑共用同一表单：必填字段由表单 rules 保证，服务端 schema 兜底校验 */
export type SaveAiHttpToolValues = Partial<CreateAiHttpToolInput>;

export const aiToolKeys = {
  all: [resourceKeyOf(aiHttpToolContract.basePath)] as const,
  lists: contractKey(aiHttpToolContract.list),
  /** 智能体编辑器的可选工具视图（内置 + HTTP 工具）由 HTTP 工具集合派生 */
  available: contractKey(aiHttpToolContract.all),
};

export function useAiHttpTools() {
  return useApiQuery(aiHttpToolContract.list);
}

/** 智能体编辑器工具勾选用（内置 + HTTP 工具统一视图） */
export function useAvailableAiTools(enabled = true) {
  return useApiQuery(aiHttpToolContract.all, { enabled, staleTime: LOOKUP_STALE_TIME });
}

export function useSaveAiHttpTool() {
  const qc = useQueryClient();
  return useMutation<AiHttpTool, Error, { id?: number; values: SaveAiHttpToolValues }>({
    mutationFn: ({ id, values }) =>
      id === undefined
        ? api(aiHttpToolContract.create, { body: values as BodyOf<typeof aiHttpToolContract.create> })
        : api(aiHttpToolContract.update, { params: { id }, body: values }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: aiToolKeys.lists });
      void qc.invalidateQueries({ queryKey: aiToolKeys.available });
    },
  });
}

export function useDeleteAiHttpTool() {
  return useApiMutation(aiHttpToolContract.remove, {
    invalidate: (qc) => {
      void qc.invalidateQueries({ queryKey: aiToolKeys.lists });
      void qc.invalidateQueries({ queryKey: aiToolKeys.available });
    },
  });
}
