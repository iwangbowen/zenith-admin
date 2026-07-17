import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { AiChatModel, AiProviderConfig } from '@zenith/shared';
import { request } from '@/utils/request';
import { LOOKUP_STALE_TIME, unwrap } from '@/lib/query';

export interface AiProviderListParams {
  keyword?: string;
}

export interface AiProviderTestPayload {
  id?: number;
  provider?: string;
  baseUrl: string;
  apiKey?: string;
  model: string;
}

export const aiProviderKeys = {
  all: ['ai-providers'] as const,
  lists: ['ai-providers', 'list'] as const,
  list: (params: AiProviderListParams = {}) => ['ai-providers', 'list', params] as const,
  detail: (id: number | undefined) => ['ai-providers', 'detail', id] as const,
  chatModels: ['ai-providers', 'chat-models'] as const,
};

export function useAiProviderList(params: AiProviderListParams = {}, options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: aiProviderKeys.list(params),
    queryFn: () => request.get<AiProviderConfig[]>('/api/ai/providers').then(unwrap),
    placeholderData: keepPreviousData,
    staleTime: LOOKUP_STALE_TIME,
    enabled: options?.enabled ?? true,
  });
}

/** 聊天可用模型（轻量列表，无需 ai:provider:list 权限，仅含启用配置） */
export function useAiChatModels() {
  return useQuery({
    queryKey: aiProviderKeys.chatModels,
    queryFn: () => request.get<AiChatModel[]>('/api/ai/models').then(unwrap),
    placeholderData: keepPreviousData,
    staleTime: LOOKUP_STALE_TIME,
  });
}

export function useAiProviderDetail(id: number | undefined, enabled = true) {
  return useQuery({
    queryKey: aiProviderKeys.detail(id),
    queryFn: () => request.get<AiProviderConfig>(`/api/ai/providers/${id}`).then(unwrap),
    enabled: enabled && id !== undefined,
  });
}

export function useSaveAiProvider() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, values }: { id?: number; values: Partial<AiProviderConfig> }) =>
      (id === undefined
        ? request.post<AiProviderConfig>('/api/ai/providers', values)
        : request.put<AiProviderConfig>(`/api/ai/providers/${id}`, values)
      ).then(unwrap),
    onSuccess: () => qc.invalidateQueries({ queryKey: aiProviderKeys.all }),
  });
}

export function useDeleteAiProvider() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => request.delete<null>(`/api/ai/providers/${id}`).then(unwrap),
    onSuccess: () => qc.invalidateQueries({ queryKey: aiProviderKeys.all }),
  });
}

export function useSetDefaultAiProvider() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => request.post<null>(`/api/ai/providers/${id}/set-default`, {}).then(unwrap),
    onSuccess: () => qc.invalidateQueries({ queryKey: aiProviderKeys.all }),
  });
}

export function useTestAiProviderConnection() {
  return useMutation({
    mutationFn: (body: AiProviderTestPayload) =>
      request.post<{ success: boolean; message: string }>('/api/ai/providers/test-connection', body).then(unwrap),
  });
}
