import { useMutation, useQuery } from '@tanstack/react-query';
import { systemdContract, type SystemdService } from '@zenith/shared/ops';
import { api, contractKey, urlOf, useApiMutation } from '@/lib/contract-query';
import { hostQueryOf } from './ops-hosts';

export const serviceKeys = {
  all: ['systemd'] as const,
  lists: contractKey(systemdContract.list),
  list: (hostId: number | null) => contractKey(systemdContract.list, { query: hostQueryOf(hostId) }),
};

/** 先探测 systemd 可用性，不可用时不再请求服务清单（Windows / 容器环境） */
export function useServiceList(hostId: number | null = null) {
  return useQuery({
    queryKey: serviceKeys.list(hostId),
    queryFn: async () => {
      const query = hostQueryOf(hostId);
      const check = await api(systemdContract.check, { query }, { silent: true });
      if (!check.available) return { available: false, services: [] as SystemdService[] };
      const services = await api(systemdContract.list, { query });
      return { available: true, services };
    },
  });
}

export function useServiceAction() {
  return useApiMutation(systemdContract.control, {
    invalidate: (qc) => {
      void qc.invalidateQueries({ queryKey: serviceKeys.all });
    },
  });
}

/** 近期日志按需拉取（打开日志抽屉时），不进缓存 */
export function useServiceLogs() {
  return useMutation({
    mutationFn: ({ name, hostId = null }: { name: string; hostId?: number | null }) =>
      api(systemdContract.logs, { params: { name }, query: hostQueryOf(hostId) }),
  });
}

/** journalctl -f 实时跟踪的流式地址（`streamText` 消费） */
export function serviceLogsStreamUrl(name: string, hostId: number | null = null) {
  return urlOf(systemdContract.logsStream, { params: { name }, query: hostQueryOf(hostId) });
}
