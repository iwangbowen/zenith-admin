import { useMutation, useQueryClient } from '@tanstack/react-query';
import { aiAgentContract } from '@zenith/shared/ai';
import type { AiAgent, CreateAiAgentInput } from '@zenith/shared/ai';
import { resourceKeyOf, type BodyOf } from '@zenith/shared/core';
import { api, contractKey, useApiMutation, useApiQuery } from '@/lib/contract-query';

/** 新增与编辑共用同一表单：必填字段由表单 rules 保证，服务端 schema 兜底校验 */
export type SaveAiAgentValues = Partial<CreateAiAgentInput>;

export const aiAgentKeys = {
  all: [resourceKeyOf(aiAgentContract.basePath)] as const,
  mine: contractKey(aiAgentContract.list),
  builtin: contractKey(aiAgentContract.builtin),
  detail: (id: number | null) => contractKey(aiAgentContract.detail, { params: { id: id ?? 0 } }),
};

export function useMyAiAgents() {
  return useApiQuery(aiAgentContract.list);
}

/** 编程式内置智能体(代码定义、注册进 Mastra,只读) */
export function useBuiltinAiAgents() {
  return useApiQuery(aiAgentContract.builtin);
}

export function useAiAgentDetail(id: number | null) {
  return useApiQuery(aiAgentContract.detail, { params: { id: id ?? 0 } }, { enabled: id !== null });
}

/** 无 id 走创建，有 id 走更新；列表行即完整实体，整体失效本域即可 */
export function useSaveAiAgent() {
  const qc = useQueryClient();
  return useMutation<AiAgent, Error, { id?: number; values: SaveAiAgentValues }>({
    mutationFn: ({ id, values }) =>
      id === undefined
        ? api(aiAgentContract.create, { body: values as BodyOf<typeof aiAgentContract.create> })
        : api(aiAgentContract.update, { params: { id }, body: values }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: aiAgentKeys.all }),
  });
}

export function useDeleteAiAgent() {
  return useApiMutation(aiAgentContract.remove, {
    invalidate: (qc) => void qc.invalidateQueries({ queryKey: aiAgentKeys.all }),
  });
}
