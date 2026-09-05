import { portContract } from '@zenith/shared/ops';
import { contractKey, useApiMutation, useApiQuery } from '@/lib/contract-query';
import { hostQueryOf } from './ops-hosts';

export const portKeys = {
  all: ['ports'] as const,
  lists: contractKey(portContract.list),
  list: (hostId: number | null) => contractKey(portContract.list, { query: hostQueryOf(hostId) }),
};

export function usePortList(refetchInterval: number | false, hostId: number | null = null) {
  return useApiQuery(portContract.list, { query: hostQueryOf(hostId) }, {
    requestOptions: { silent: true },
    refetchInterval,
  });
}

/** 结束占用端口的进程：该进程的全部监听行消失，各主机端口列表整体失效 */
export function useKillPortProcess() {
  return useApiMutation(portContract.kill, {
    invalidate: (qc) => {
      void qc.invalidateQueries({ queryKey: portKeys.all });
    },
  });
}
