import { keepPreviousData, useMutation, useQueryClient } from '@tanstack/react-query';
import { aiChatModelContract, aiProviderContract } from '@zenith/shared/ai';
import type { AiProviderConfig, CreateAiProviderConfigInput } from '@zenith/shared/ai';
import { resourceKeyOf, type BodyOf } from '@zenith/shared/core';
import { api, contractKey, useApiMutation, useApiQuery } from '@/lib/contract-query';
import { LOOKUP_STALE_TIME } from '@/lib/query';

export type AiProviderTestPayload = BodyOf<typeof aiProviderContract.testConnection>;

export type AiProviderFetchModelsPayload = BodyOf<typeof aiProviderContract.fetchModels>;

/** 新增与编辑共用同一表单：必填字段由表单 rules 保证，服务端 schema 兜底校验 */
export type SaveAiProviderValues = Partial<CreateAiProviderConfigInput>;

export const aiProviderKeys = {
  all: [resourceKeyOf(aiProviderContract.basePath)] as const,
  lists: contractKey(aiProviderContract.list),
  detail: (id: number | undefined) => contractKey(aiProviderContract.detail, { params: { id: id ?? 0 } }),
  /** 聊天可用模型（aiChatModelContract.list）由启用中的供应商配置派生 */
  chatModels: contractKey(aiChatModelContract.list),
  catalog: contractKey(aiProviderContract.catalog),
  catalogModels: (providerId: string | undefined) => contractKey(aiProviderContract.catalogModels, { params: { providerId: providerId ?? '' } }),
};

/** 配置列表不分页，关键词筛选由页面在本地完成 */
export function useAiProviderList(options?: { enabled?: boolean }) {
  return useApiQuery(aiProviderContract.list, {
    placeholderData: keepPreviousData,
    staleTime: LOOKUP_STALE_TIME,
    enabled: options?.enabled ?? true,
  });
}

/** 聊天可用模型（轻量列表，无需 ai:provider:list 权限，仅含启用配置） */
export function useAiChatModels() {
  return useApiQuery(aiChatModelContract.list, {
    placeholderData: keepPreviousData,
    staleTime: LOOKUP_STALE_TIME,
  });
}

export function useAiProviderDetail(id: number | undefined, enabled = true) {
  return useApiQuery(aiProviderContract.detail, { params: { id: id ?? 0 } }, {
    enabled: enabled && id !== undefined,
  });
}

/** 无 id 走创建，有 id 走更新；聊天可用模型由启用中的供应商配置派生，改动后必须回源 */
export function useSaveAiProvider() {
  const qc = useQueryClient();
  return useMutation<AiProviderConfig, Error, { id?: number; values: SaveAiProviderValues }>({
    mutationFn: ({ id, values }) =>
      id === undefined
        ? api(aiProviderContract.create, { body: values as BodyOf<typeof aiProviderContract.create> })
        : api(aiProviderContract.update, { params: { id }, body: values }),
    onSuccess: (saved) => {
      void qc.invalidateQueries({ queryKey: aiProviderKeys.detail(saved.id) });
      void qc.invalidateQueries({ queryKey: aiProviderKeys.lists });
      void qc.invalidateQueries({ queryKey: aiProviderKeys.chatModels });
    },
  });
}

export function useDeleteAiProvider() {
  return useApiMutation(aiProviderContract.remove, {
    invalidate: (qc, _output, { params }) => {
      qc.removeQueries({ queryKey: aiProviderKeys.detail(params.id) });
      void qc.invalidateQueries({ queryKey: aiProviderKeys.lists });
      void qc.invalidateQueries({ queryKey: aiProviderKeys.chatModels });
    },
  });
}

/** 默认标记会同时改变旧默认项，故整体刷新列表而非单条详情 */
export function useSetDefaultAiProvider() {
  return useApiMutation(aiProviderContract.setDefault, {
    invalidate: (qc, _output, { params }) => {
      void qc.invalidateQueries({ queryKey: aiProviderKeys.detail(params.id) });
      void qc.invalidateQueries({ queryKey: aiProviderKeys.lists });
      void qc.invalidateQueries({ queryKey: aiProviderKeys.chatModels });
    },
  });
}

export function useTestAiProviderConnection() {
  return useApiMutation(aiProviderContract.testConnection);
}

/** 从供应商 API 自动发现模型列表 */
export function useFetchAiProviderModels() {
  return useApiMutation(aiProviderContract.fetchModels);
}

/** 服务商目录（Mastra 模型目录,常用项排前） */
export function useAiProviderCatalog(options?: { enabled?: boolean }) {
  return useApiQuery(aiProviderContract.catalog, {
    staleTime: LOOKUP_STALE_TIME,
    enabled: options?.enabled ?? true,
  });
}

/** 目录内某服务商的模型清单（custom 服务商无目录，不发请求） */
export function useAiCatalogModels(providerId: string | undefined, options?: { enabled?: boolean }) {
  return useApiQuery(aiProviderContract.catalogModels, { params: { providerId: providerId ?? '' } }, {
    staleTime: LOOKUP_STALE_TIME,
    enabled: (options?.enabled ?? true) && !!providerId && providerId !== 'custom',
  });
}
