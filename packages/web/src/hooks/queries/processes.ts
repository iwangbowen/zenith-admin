import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ProcessInfo } from '@zenith/shared';
import { request } from '@/utils/request';
import { unwrap } from '@/lib/query';

export const processKeys = {
  all: ['processes'] as const,
  detail: (pid: number | undefined) => ['processes', 'detail', pid] as const,
};

export function useProcessDetail(pid: number | undefined, enabled = true) {
  return useQuery({
    queryKey: processKeys.detail(pid),
    queryFn: () => request.get<ProcessInfo>(`/api/processes/${pid}`).then(unwrap),
    enabled: enabled && pid !== undefined,
  });
}

export function useKillProcess() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ pid, signal }: { pid: number; signal: string }) =>
      request.delete<null>(`/api/processes/${pid}`, { signal }).then(unwrap),
    onSuccess: () => qc.invalidateQueries({ queryKey: processKeys.all }),
  });
}

export function useSetProcessPriority() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ pid, values }: { pid: number; values: Record<string, unknown> }) =>
      request.put<null>(`/api/processes/${pid}/priority`, values).then(unwrap),
    onSuccess: () => qc.invalidateQueries({ queryKey: processKeys.all }),
  });
}
