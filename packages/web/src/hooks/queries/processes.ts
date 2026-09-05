import { processContract } from '@zenith/shared/ops';
import { contractKey, urlOf, useApiMutation, useApiQuery } from '@/lib/contract-query';
import { hostQueryOf } from './ops-hosts';

export const processKeys = {
  all: ['processes'] as const,
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

export function useKillProcess() {
  return useApiMutation(processContract.kill, {
    invalidate: (qc) => {
      void qc.invalidateQueries({ queryKey: processKeys.all });
    },
  });
}

export function useSetProcessPriority() {
  return useApiMutation(processContract.setPriority, {
    invalidate: (qc) => {
      void qc.invalidateQueries({ queryKey: processKeys.all });
    },
  });
}
