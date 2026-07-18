import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { AiAgent, CreateAiAgentInput, UpdateAiAgentInput } from '@zenith/shared';
import { request } from '@/utils/request';
import { unwrap } from '@/lib/query';

export const aiAgentKeys = {
  all: ['ai-agents'] as const,
  mine: ['ai-agents', 'mine'] as const,
  market: ['ai-agents', 'market'] as const,
  pending: ['ai-agents', 'pending'] as const,
  detail: (id: number | null) => ['ai-agents', 'detail', id] as const,
};

export function useMyAiAgents() {
  return useQuery({
    queryKey: aiAgentKeys.mine,
    queryFn: () => request.get<AiAgent[]>('/api/ai/agents').then(unwrap),
  });
}

export function useMarketAiAgents() {
  return useQuery({
    queryKey: aiAgentKeys.market,
    queryFn: () => request.get<AiAgent[]>('/api/ai/agents/market').then(unwrap),
  });
}

export function usePendingAiAgents(enabled: boolean) {
  return useQuery({
    queryKey: aiAgentKeys.pending,
    queryFn: () => request.get<AiAgent[]>('/api/ai/agents/pending').then(unwrap),
    enabled,
  });
}

export function useAiAgentDetail(id: number | null) {
  return useQuery({
    queryKey: aiAgentKeys.detail(id),
    queryFn: () => request.get<AiAgent>(`/api/ai/agents/${id}`).then(unwrap),
    enabled: id !== null,
  });
}

export function useSaveAiAgent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, values }: { id?: number; values: CreateAiAgentInput | UpdateAiAgentInput }) =>
      (id === undefined
        ? request.post<AiAgent>('/api/ai/agents', values)
        : request.put<AiAgent>(`/api/ai/agents/${id}`, values)
      ).then(unwrap),
    onSuccess: () => qc.invalidateQueries({ queryKey: aiAgentKeys.all }),
  });
}

export function useDeleteAiAgent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => request.delete<null>(`/api/ai/agents/${id}`).then(unwrap),
    onSuccess: () => qc.invalidateQueries({ queryKey: aiAgentKeys.all }),
  });
}

export function usePublishAiAgent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, action }: { id: number; action: 'publish' | 'unpublish' }) =>
      request.post<AiAgent>(`/api/ai/agents/${id}/${action}`).then(unwrap),
    onSuccess: () => qc.invalidateQueries({ queryKey: aiAgentKeys.all }),
  });
}

export function useReviewAiAgent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, approve }: { id: number; approve: boolean }) =>
      request.post<AiAgent>(`/api/ai/agents/${id}/review`, { approve }).then(unwrap),
    onSuccess: () => qc.invalidateQueries({ queryKey: aiAgentKeys.all }),
  });
}

export function useCloneAiAgent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => request.post<AiAgent>(`/api/ai/agents/${id}/clone`).then(unwrap),
    onSuccess: () => qc.invalidateQueries({ queryKey: aiAgentKeys.all }),
  });
}
