// eslint-disable-next-line no-restricted-imports -- H5 保留：手写 useQuery / useMutation 的理由见本文件对应 hook 的注释；queryKey 仍由 contractKey 生成
import { useQuery } from '@tanstack/react-query';
import { systemdContract, type SystemdService } from '@zenith/shared/ops';
import { api, contractKey, urlOf, useApiMutation } from '@/lib/contract-query';
import { hostQueryOf } from './ops-hosts';

export const serviceKeys = {
  lists: contractKey(systemdContract.list),
  /** 「可用性探测 + 服务清单」合并查询：list 操作的契约 key 追加区分段，与纯清单查询不共键；仍在 `lists` 前缀之下 */
  list: (hostId: number | null) => [...contractKey(systemdContract.list, { query: hostQueryOf(hostId) }), 'with-availability'] as const,
};

/** 先探测 systemd 可用性，不可用时不再请求服务清单（Windows / 容器环境）（H5：组合两次契约请求） */
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

/** 启停 / 重启 / 开机自启只改该主机的服务状态列；其它主机的清单不受影响（本机 key 的 query 为 {}，需精确匹配） */
export function useServiceAction() {
  return useApiMutation(systemdContract.control, {
    invalidate: (qc, _output, { query }) => {
      void qc.invalidateQueries({ queryKey: serviceKeys.list(query.hostId ?? null), exact: true });
    },
  });
}

/** 近期日志按需拉取（打开日志抽屉时），不进缓存 */
export function useServiceLogs() {
  return useApiMutation(systemdContract.logs);
}

/** journalctl -f 实时跟踪的流式地址（`streamText` 消费） */
export function serviceLogsStreamUrl(name: string, hostId: number | null = null) {
  return urlOf(systemdContract.logsStream, { params: { name }, query: hostQueryOf(hostId) });
}
