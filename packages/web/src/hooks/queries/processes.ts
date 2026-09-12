import { processContract } from '@zenith/shared/ops';
import { contractKey, urlOf, useApiMutation, useApiQuery } from '@/lib/contract-query';
import { hostQueryOf } from './ops-hosts';

export const processKeys = {
  list: (hostId: number | null) => contractKey(processContract.list, { query: hostQueryOf(hostId) }),
  detail: (pid: number | undefined, hostId: number | null) =>
    contractKey(processContract.detail, { params: { pid: pid ?? 0 }, query: hostQueryOf(hostId) }),
};

/** 本机走 SSE 实时流（见 processStreamUrl），远端主机按 5 秒轮询 */
export function useProcessList(hostId: number | null, enabled = true) {
  return useApiQuery(processContract.list, { query: hostQueryOf(hostId) }, {
    requestOptions: { silent: true },
    enabled,
    refetchInterval: hostId == null ? false : 5000,
  });
}

export function useProcessDetail(pid: number | undefined, enabled = true, hostId: number | null = null) {
  return useApiQuery(processContract.detail, { params: { pid: pid ?? 0 }, query: hostQueryOf(hostId) }, {
    enabled: enabled && pid !== undefined,
  });
}

/** 进程列表 SSE 地址（`request.fetchRaw` 消费，event: processes） */
export function processStreamUrl(hostId: number | null = null) {
  return urlOf(processContract.stream, { query: hostQueryOf(hostId) });
}

/** 结束进程：该主机的进程列表回源；进程已不存在，其详情缓存移除而非失效（避免 404 重拉）。其它主机不受影响 */
export function useKillProcess() {
  return useApiMutation(processContract.kill, {
    invalidate: (qc, _output, { params, query }) => {
      const hostId = query.hostId ?? null;
      qc.removeQueries({ queryKey: processKeys.detail(params.pid, hostId) });
      void qc.invalidateQueries({ queryKey: processKeys.list(hostId) });
    },
  });
}

/** 调整优先级：该主机的进程列表（nice 列）与该进程详情回源 */
export function useSetProcessPriority() {
  return useApiMutation(processContract.setPriority, {
    invalidate: (qc, _output, { params, query }) => {
      const hostId = query.hostId ?? null;
      void qc.invalidateQueries({ queryKey: processKeys.detail(params.pid, hostId) });
      void qc.invalidateQueries({ queryKey: processKeys.list(hostId) });
    },
  });
}
