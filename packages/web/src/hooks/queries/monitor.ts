// eslint-disable-next-line no-restricted-imports -- H5 保留：手写 useQuery / useMutation 的理由见本文件对应 hook 的注释；queryKey 仍由 contractKey 生成
import { useQuery } from '@tanstack/react-query';
import { monitorContract, type MonitorHistoryRange } from '@zenith/shared/platform';
import { api, contractKey, useApiQuery } from '@/lib/contract-query';

export const monitorKeys = {
  /** 快照 / 时序 / WS 三个端点合并为一次查询：snapshot 操作的契约 key 追加区分段，与纯快照查询不共键 */
  snapshot: [...contractKey(monitorContract.snapshot), 'overview'] as const,
  history: (range: MonitorHistoryRange) => contractKey(monitorContract.history, { query: { range } }),
};

/** H5：组合三次契约请求，供页面整屏刷新 */
export function useMonitorSnapshot(refetchInterval: number | false, enabled = true) {
  return useQuery({
    queryKey: monitorKeys.snapshot,
    queryFn: async ({ signal }) => {
      const [data, timeseries, wsMetrics] = await Promise.all([
        api(monitorContract.snapshot, { silent: true, signal }),
        api(monitorContract.timeseries, { silent: true, signal }),
        api(monitorContract.ws, { silent: true, signal }),
      ]);
      return { data, series: timeseries.points, wsMetrics };
    },
    enabled,
    refetchInterval,
  });
}

export function useMonitorHistory(range: MonitorHistoryRange, enabled = true, refetchInterval: number | false = false) {
  return useApiQuery(monitorContract.history, { query: { range } }, {
    enabled,
    refetchInterval,
    requestOptions: { silent: true },
  });
}

/** WebSocket 连接监控独立页面使用的轻量查询，不拉取整机监控快照。 */
export function useMonitorWsMetrics(refetchInterval: number | false = 5000) {
  return useApiQuery(monitorContract.ws, undefined, {
    requestOptions: { silent: true },
    refetchInterval,
  });
}

/**
 * WebSocket 连接趋势（10 秒/点、保留 1 小时）。
 * 采集节拍与快照轮询不同频，默认 10 秒拉一次即可，无需跟随 5 秒的连接刷新。
 */
export function useMonitorWsTrend(refetchInterval: number | false = 10000) {
  return useApiQuery(monitorContract.wsTrend, undefined, {
    requestOptions: { silent: true },
    refetchInterval,
  });
}
