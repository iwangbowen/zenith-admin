import { useQuery } from '@tanstack/react-query';
import { request } from '@/utils/request';
import { unwrap } from '@/lib/query';

interface TimeseriesData<TPoint> {
  intervalSec: number;
  capacity: number;
  points: TPoint[];
}

interface HistoryData<THistoryPoint> {
  range: string;
  bucketSec: number;
  points: THistoryPoint[];
}

export const monitorKeys = {
  all: ['monitor'] as const,
  snapshot: ['monitor', 'snapshot'] as const,
  history: (range: string) => ['monitor', 'history', range] as const,
};

export function useMonitorSnapshot<TMonitorData, TTimeseriesPoint, TWsMetrics>(
  refetchInterval: number | false,
  enabled = true,
) {
  return useQuery({
    queryKey: monitorKeys.snapshot,
    queryFn: async () => {
      const [data, timeseries, wsMetrics] = await Promise.all([
        request.get<TMonitorData>('/api/monitor', { silent: true }).then(unwrap),
        request.get<TimeseriesData<TTimeseriesPoint>>('/api/monitor/timeseries', { silent: true }).then(unwrap),
        request.get<TWsMetrics>('/api/monitor/ws', { silent: true }).then(unwrap),
      ]);
      return { data, series: timeseries.points, wsMetrics };
    },
    enabled,
    refetchInterval,
  });
}

export function useMonitorHistory<THistoryPoint>(range: string, enabled = true) {
  return useQuery({
    queryKey: monitorKeys.history(range),
    queryFn: () => request.get<HistoryData<THistoryPoint>>(`/api/monitor/history?range=${range}`, { silent: true }).then(unwrap),
    enabled,
  });
}
