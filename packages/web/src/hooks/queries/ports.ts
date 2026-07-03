import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { request } from '@/utils/request';
import { unwrap } from '@/lib/query';

export interface PortEntry {
  protocol: string;
  localAddress: string;
  localPort: number;
  state: string;
  pid: number | null;
  processName: string | null;
  serviceName: string | null;
}

export const portKeys = {
  all: ['ports'] as const,
  lists: ['ports', 'list'] as const,
  list: () => ['ports', 'list'] as const,
};

export function usePortList(refetchInterval: number | false) {
  return useQuery({
    queryKey: portKeys.list(),
    queryFn: () => request.get<PortEntry[]>('/api/ports', { silent: true }).then(unwrap),
    refetchInterval,
  });
}

export function useKillPortProcess() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (pid: number) => request.delete<null>(`/api/ports/${pid}`).then(unwrap),
    onSuccess: () => qc.invalidateQueries({ queryKey: portKeys.all }),
  });
}
