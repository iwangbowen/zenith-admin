import { useQuery } from '@tanstack/react-query';
import { resourceKeyOf } from '@zenith/shared/core';
import { monitorContract, type MonitorHistoryRange } from '@zenith/shared/platform';
import { api, contractKey, useApiQuery } from '@/lib/contract-query';

export const monitorKeys = {
  all: [resourceKeyOf(monitorContract.basePath)] as const,
  /** 快照 / 时序 / WS 三个端点合并为一次查询，供页面整屏刷新 */
  snapshot: [resourceKeyOf(monitorContract.basePath), 'snapshot'] as const,
  history: (range: MonitorHistoryRange) => contractKey(monitorContract.history, { query: { range } }),
};

export function useMonitorSnapshot(refetchInterval: number | false, enabled = true) {
  return useQuery({
    queryKey: monitorKeys.snapshot,
    queryFn: async () => {
      const [data, timeseries, wsMetrics] = await Promise.all([
        api(monitorContract.snapshot, { silent: true }),
        api(monitorContract.timeseries, { silent: true }),
        api(monitorContract.ws, { silent: true }),
      ]);
      return { data, series: timeseries.points, wsMetrics };
    },
    enabled,
    refetchInterval,
  });
}

export function useMonitorHistory(range: MonitorHistoryRange, enabled = true) {
  return useApiQuery(monitorContract.history, { query: { range } }, { enabled, requestOptions: { silent: true } });
}
