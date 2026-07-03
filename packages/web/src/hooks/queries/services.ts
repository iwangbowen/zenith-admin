import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { request } from '@/utils/request';
import { unwrap } from '@/lib/query';

export interface ServiceInfo {
  name: string;
  description: string;
  loadState: string;
  activeState: string;
  subState: string;
}

export type ServiceAction = 'start' | 'stop' | 'restart' | 'enable' | 'disable' | 'mask' | 'unmask';

export const serviceKeys = {
  all: ['services'] as const,
  lists: ['services', 'list'] as const,
  list: () => ['services', 'list'] as const,
  logs: (name: string | undefined) => ['services', 'logs', name] as const,
};

export function useServiceList() {
  return useQuery({
    queryKey: serviceKeys.list(),
    queryFn: async () => {
      const check = await request.get<{ available: boolean }>('/api/systemd/check', { silent: true }).then(unwrap);
      if (!check.available) return { available: false, services: [] as ServiceInfo[] };
      const services = await request.get<ServiceInfo[]>('/api/systemd/').then(unwrap);
      return { available: true, services };
    },
  });
}

export function useServiceAction() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ name, action }: { name: string; action: ServiceAction }) =>
      request.post<null>(`/api/systemd/${name}/${action}`, {}).then(unwrap),
    onSuccess: () => qc.invalidateQueries({ queryKey: serviceKeys.all }),
  });
}

export function useServiceLogs() {
  return useMutation({
    mutationFn: (name: string) => request.get<{ logs: string }>(`/api/systemd/${name}/logs`).then(unwrap),
  });
}
