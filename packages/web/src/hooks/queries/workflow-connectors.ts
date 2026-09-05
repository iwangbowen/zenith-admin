import { useQuery } from '@tanstack/react-query';
import type { QueryOf } from '@zenith/shared/core';
import { workflowConnectorContract } from '@zenith/shared/workflow';
import { api, createResourceQueries, useApiMutation } from '@/lib/contract-query';

export type WorkflowConnectorListParams = QueryOf<typeof workflowConnectorContract.list>;

/** 连接器监控（stats + 调用记录）随连接器增删改一并失效 */
const CONNECTOR_MONITOR_PREFIX = ['workflow', 'connectors', 'monitor'] as const;

const resource = createResourceQueries(workflowConnectorContract, {
  // 保留原有嵌套 key：运行时流程用 invalidateQueries({ queryKey: ['workflow'] }) 广播失效
  keyPrefix: ['workflow', 'connectors'],
  onSaved: (qc) => void qc.invalidateQueries({ queryKey: CONNECTOR_MONITOR_PREFIX }),
  onDeleted: (qc) => void qc.invalidateQueries({ queryKey: CONNECTOR_MONITOR_PREFIX }),
});

export const workflowConnectorKeys = {
  ...resource.keys,
  monitor: (id: number | null | undefined, days: number) => [...CONNECTOR_MONITOR_PREFIX, id ?? null, days] as const,
};

export const useWorkflowConnectorList = resource.useList;
export const useSaveWorkflowConnector = resource.useSave;
export const useDeleteWorkflowConnectors = resource.useDelete;

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
