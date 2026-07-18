import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { AiEvalSet, AiEvalRun, CreateAiEvalSetInput, UpdateAiEvalSetInput, AsyncTask } from '@zenith/shared';
import { request } from '@/utils/request';
import { unwrap } from '@/lib/query';

export const aiEvalKeys = {
  all: ['ai-eval'] as const,
  sets: ['ai-eval', 'sets'] as const,
  runs: (setId?: number) => ['ai-eval', 'runs', setId ?? 'all'] as const,
  runDetail: (id: number | null) => ['ai-eval', 'run', id] as const,
};

export function useAiEvalSets() {
  return useQuery({
    queryKey: aiEvalKeys.sets,
    queryFn: () => request.get<AiEvalSet[]>('/api/ai/eval/sets').then(unwrap),
  });
}

export function useAiEvalRuns(setId?: number, refetchInterval?: number | false) {
  return useQuery({
    queryKey: aiEvalKeys.runs(setId),
    queryFn: () =>
      request
        .get<AiEvalRun[]>(`/api/ai/eval/runs${setId ? `?setId=${setId}` : ''}`)
        .then(unwrap),
    refetchInterval,
  });
}

export function useAiEvalRunDetail(id: number | null) {
  return useQuery({
    queryKey: aiEvalKeys.runDetail(id),
    queryFn: () => request.get<AiEvalRun>(`/api/ai/eval/runs/${id}`).then(unwrap),
    enabled: id !== null,
  });
}

export function useSaveAiEvalSet() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, values }: { id?: number; values: CreateAiEvalSetInput | UpdateAiEvalSetInput }) =>
      (id === undefined
        ? request.post<AiEvalSet>('/api/ai/eval/sets', values)
        : request.put<AiEvalSet>(`/api/ai/eval/sets/${id}`, values)
      ).then(unwrap),
    onSuccess: () => qc.invalidateQueries({ queryKey: aiEvalKeys.all }),
  });
}

export function useDeleteAiEvalSet() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => request.delete<null>(`/api/ai/eval/sets/${id}`).then(unwrap),
    onSuccess: () => qc.invalidateQueries({ queryKey: aiEvalKeys.all }),
  });
}

export function useRunAiEval() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ setId, configId, model }: { setId: number; configId?: number; model?: string }) =>
      request.post<{ run: AiEvalRun; task: AsyncTask }>(`/api/ai/eval/sets/${setId}/run`, { configId, model }).then(unwrap),
    onSuccess: () => qc.invalidateQueries({ queryKey: aiEvalKeys.all }),
  });
}

export function useDeleteAiEvalRun() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => request.delete<null>(`/api/ai/eval/runs/${id}`).then(unwrap),
    onSuccess: () => qc.invalidateQueries({ queryKey: aiEvalKeys.all }),
  });
}
