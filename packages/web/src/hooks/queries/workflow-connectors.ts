// eslint-disable-next-line no-restricted-imports -- H5 保留：手写 useQuery / useMutation 的理由见本文件对应 hook 的注释；queryKey 仍由 contractKey 生成
import { useQuery } from '@tanstack/react-query';
import type { QueryOf } from '@zenith/shared/core';
import { workflowConnectorContract } from '@zenith/shared/workflow';
import { api, contractKey, createResourceQueries, useApiMutation } from '@/lib/contract-query';

export type WorkflowConnectorListParams = QueryOf<typeof workflowConnectorContract.list>;

/** 连接器监控（stats + 调用记录）随连接器增删改一并失效；组合查询挂在 stats 操作前缀之下 */
const CONNECTOR_MONITOR_PREFIX = contractKey(workflowConnectorContract.stats);

const resource = createResourceQueries(workflowConnectorContract, {
  onSaved: (qc) => void qc.invalidateQueries({ queryKey: CONNECTOR_MONITOR_PREFIX }),
  onDeleted: (qc) => void qc.invalidateQueries({ queryKey: CONNECTOR_MONITOR_PREFIX }),
});

export const workflowConnectorKeys = {
  ...resource.keys,
  monitors: CONNECTOR_MONITOR_PREFIX,
  monitor: (id: number | null | undefined, days: number) =>
    [...contractKey(workflowConnectorContract.stats, { params: { id: id ?? 0 }, query: { days } }), 'with-invocations'] as const,
};

export const useWorkflowConnectorList = resource.useList;
export const useSaveWorkflowConnector = resource.useSave;
export const useDeleteWorkflowConnectors = resource.useDelete;

/** H5：queryFn 组合两次请求（调用统计 + 最近调用记录） */
export function useWorkflowConnectorMonitor(id: number | null | undefined, days: number, enabled = true) {
  return useQuery({
    queryKey: workflowConnectorKeys.monitor(id, days),
    queryFn: async () => {
      const params = { id: id as number };
      const [stats, invocations] = await Promise.all([
        api(workflowConnectorContract.stats, { params, query: { days } }, { silent: true }),
        api(workflowConnectorContract.invocations, { params, query: { limit: 50 } }, { silent: true }),
      ]);
      return { stats, invocations };
    },
    enabled: enabled && !!id,
  });
}

export function useTestWorkflowConnector() {
  return useApiMutation(workflowConnectorContract.test, { requestOptions: { silent: true } });
}
