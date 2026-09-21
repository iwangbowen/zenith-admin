import { useEffect, useRef, useState } from 'react';
import { Toast } from '@douyinfe/semi-ui';
import {
  monitorContract,
  type MonitorHistoryPoint,
  type MonitorHistoryRange,
  type MonitorSnapshot,
  type MonitorTimeseriesPoint,
  type MonitorWsMetrics,
} from '@zenith/shared/platform';
import { useMonitorHistory, useMonitorSnapshot } from '@/hooks/queries/monitor';
import { urlOf } from '@/lib/contract-query';
import { request } from '@/utils/request';
import { readSseStream } from '@/utils/streaming';

export const REALTIME_REFRESH_OPTIONS = [
  { label: '实时更新（约 10 秒）', value: -1 },
  { label: '每 5 秒更新', value: 5000 },
  { label: '每 10 秒更新', value: 10000 },
  { label: '每 30 秒更新', value: 30000 },
  { label: '每 60 秒更新', value: 60000 },
  { label: '暂停自动更新', value: 0 },
];

export const HISTORY_REFRESH_OPTIONS = [
  { label: '自动更新（每分钟）', value: 60000 },
  { label: '暂停自动更新', value: 0 },
];

const EMPTY_HISTORY: MonitorHistoryPoint[] = [];

/** SSE 的 null 是删除标记，数组整段替换；合并时保留上一帧不变。 */
function mergePatch(base: unknown, patch: unknown): unknown {
  if (patch === null) return undefined;
  if (patch === undefined) return base;
  if (Array.isArray(patch)) return patch;
  if (typeof patch !== 'object' || typeof base !== 'object' || base === null || Array.isArray(base)) return patch;
  const out: Record<string, unknown> = { ...(base as Record<string, unknown>) };
  for (const [key, value] of Object.entries(patch)) {
    if (value === null) delete out[key];
    else out[key] = mergePatch(out[key], value);
  }
  return out;
}

interface MonitorRefreshOptions {
  activeTab: string;
  historyRange: MonitorHistoryRange;
  initialRefreshInterval?: number;
  initialHistoryRefreshInterval?: number;
}

/** 当前 Tab 的取数、刷新、连接和反馈共用一个入口；历史查询不依赖实时快照。 */
export function useMonitorRefreshController({
  activeTab,
  historyRange,
  initialRefreshInterval,
  initialHistoryRefreshInterval,
}: MonitorRefreshOptions) {
  const isHistory = activeTab === 'history';
  const [realtimeInterval, setRealtimeInterval] = useState(
    REALTIME_REFRESH_OPTIONS.find((option) => option.value === initialRefreshInterval)?.value ?? 30000,
  );
  const [historyInterval, setHistoryInterval] = useState(
    HISTORY_REFRESH_OPTIONS.find((option) => option.value === initialHistoryRefreshInterval)?.value
      // 旧版本仅有全页暂停偏好，迁移时保持历史页也暂停。
      ?? (initialRefreshInterval === 0 ? 0 : 60000),
  );
  const sseEnabled = !isHistory && realtimeInterval === -1;
  const [data, setData] = useState<MonitorSnapshot | null>(null);
  const [series, setSeries] = useState<MonitorTimeseriesPoint[]>([]);
  const [wsMetrics, setWsMetrics] = useState<MonitorWsMetrics | null>(null);
  const [lastUpdated, setLastUpdated] = useState(0);
  const latestAppliedAt = useRef(0);
  const [sseLoading, setSseLoading] = useState(false);
  const [sseStatus, setSseStatus] = useState<'idle' | 'connecting' | 'open' | 'error'>('idle');
  const [sseError, setSseError] = useState<string | null>(null);
  const [streamRevision, setStreamRevision] = useState(0);
  const sseAbortRef = useRef<AbortController | null>(null);
  const contextRef = useRef('');
  const refreshRequestRef = useRef(0);
  const context = `${activeTab}:${historyRange}:${isHistory ? historyInterval : realtimeInterval}`;
  useEffect(() => {
    contextRef.current = context;
    return () => {
      contextRef.current = '';
      refreshRequestRef.current += 1;
    };
  }, [context]);

  const snapshotQuery = useMonitorSnapshot(
    !isHistory && realtimeInterval > 0 ? realtimeInterval : false,
    !isHistory && !sseEnabled,
  );
  const historyQuery = useMonitorHistory(historyRange, isHistory, isHistory && historyInterval > 0 ? historyInterval : false);
  const history = historyQuery.data?.points ?? EMPTY_HISTORY;

  useEffect(() => {
    // 模式切换前尚未完成的 HTTP 请求不能覆盖当前 SSE 差量基线。
    if (isHistory || sseEnabled || !snapshotQuery.data || snapshotQuery.dataUpdatedAt <= latestAppliedAt.current) return;
    latestAppliedAt.current = snapshotQuery.dataUpdatedAt;
    setData(snapshotQuery.data.data);
    setSeries(snapshotQuery.data.series);
    setWsMetrics(snapshotQuery.data.wsMetrics);
    setLastUpdated(snapshotQuery.dataUpdatedAt);
  }, [isHistory, sseEnabled, snapshotQuery.data, snapshotQuery.dataUpdatedAt]);

  useEffect(() => {
    if (!sseEnabled) {
      setSseStatus('idle');
      setSseLoading(false);
      return;
    }
    setSseLoading(true);
    setSseError(null);
    const ctrl = new AbortController();
    sseAbortRef.current = ctrl;

    const handleFrame = (event: string, dataLine: string) => {
      if (ctrl.signal.aborted) return;
      try {
        const payload: unknown = JSON.parse(dataLine);
        if (event === 'metrics' || event === 'metrics:diff') {
          if (event === 'metrics') setData(payload as MonitorSnapshot);
          else setData((prev) => prev ? mergePatch(prev, payload) as MonitorSnapshot : prev);
          const now = Date.now();
          latestAppliedAt.current = now;
          setLastUpdated(now);
          setSseLoading(false);
          setSseStatus('open');
          setSseError(null);
        } else if (event === 'series') {
          const points = (payload as { points?: MonitorTimeseriesPoint[] }).points;
          setSeries(Array.isArray(points) ? points : []);
        } else if (event === 'series:point') {
          setSeries((prev) => [...prev, payload as MonitorTimeseriesPoint].slice(-360));
        } else if (event === 'ws') {
          setWsMetrics(payload as MonitorWsMetrics);
        }
      } catch { /* 忽略不可解析的帧，保留上次有效数据 */ }
    };

    const connectOnce = async () => {
      try {
        setSseStatus('connecting');
        const res = await request.fetchRaw(urlOf(monitorContract.stream), { signal: ctrl.signal, silent: true });
        if (ctrl.signal.aborted) return false;
        if (!res?.ok || !res.body) return true;
        await readSseStream(res, (events) => {
          for (const { event, data: frameData } of events) {
            if (frameData) handleFrame(event, frameData);
          }
        });
      } catch { /* 连接中断后统一重连；主动退出不更新状态 */ }
      return !ctrl.signal.aborted;
    };

    const sleep = (ms: number) => new Promise<void>((resolve) => {
      const finish = () => {
        clearTimeout(timer);
        ctrl.signal.removeEventListener('abort', finish);
        resolve();
      };
      const timer = setTimeout(finish, ms);
      ctrl.signal.addEventListener('abort', finish, { once: true });
      if (ctrl.signal.aborted) finish();
    });

    void (async () => {
      let attempt = 0;
      while (!ctrl.signal.aborted) {
        const started = Date.now();
        const retry = await connectOnce();
        if (!retry || ctrl.signal.aborted) break;
        if (Date.now() - started > 30_000) attempt = 0;
        setSseStatus('error');
        setSseLoading(false);
        setSseError('实时连接中断，正在自动重连；已显示的数据会保留。');
        attempt += 1;
        await sleep(Math.min(30_000, 1000 * 2 ** Math.min(attempt - 1, 5)));
      }
    })();

    return () => {
      ctrl.abort();
      if (sseAbortRef.current === ctrl) sseAbortRef.current = null;
    };
  }, [sseEnabled, streamRevision]);

  const refresh = async () => {
    const requestId = ++refreshRequestRef.current;
    if (sseEnabled) {
      // 手动刷新与差量流共用一个数据源，重连首帧恢复完整快照。
      sseAbortRef.current?.abort();
      setSseLoading(true);
      setSseStatus('connecting');
      setSseError(null);
      setStreamRevision((revision) => revision + 1);
      return;
    }
    if (isHistory) {
      const previous = historyQuery.data;
      const result = await historyQuery.refetch();
      if (contextRef.current !== context || refreshRequestRef.current !== requestId) return;
      if (result.isError) Toast.error(`历史趋势刷新失败：${result.error.message}`);
      else if (previous && JSON.stringify(previous.points) === JSON.stringify(result.data?.points)) Toast.info('已刷新，暂无新增采样');
      else Toast.success('历史趋势已刷新');
    } else {
      const result = await snapshotQuery.refetch();
      if (contextRef.current !== context || refreshRequestRef.current !== requestId) return;
      if (result.isError) Toast.error(`监控数据刷新失败：${result.error.message}`);
    }
  };

  const queryError = isHistory ? historyQuery.error : snapshotQuery.error;
  return {
    isHistory,
    data,
    series,
    wsMetrics,
    history,
    historyLoading: historyQuery.isFetching,
    realtimeInterval,
    historyInterval,
    refreshInterval: isHistory ? historyInterval : realtimeInterval,
    refreshOptions: isHistory ? HISTORY_REFRESH_OPTIONS : REALTIME_REFRESH_OPTIONS,
    setRefreshInterval: (interval: number) => {
      if (isHistory) setHistoryInterval(interval === 0 ? 0 : 60000);
      else if (REALTIME_REFRESH_OPTIONS.some((option) => option.value === interval)) setRealtimeInterval(interval);
    },
    refresh,
    loading: isHistory ? historyQuery.isFetching : sseEnabled ? sseLoading : snapshotQuery.isFetching,
    updatedAt: isHistory ? historyQuery.dataUpdatedAt : lastUpdated,
    latestHistoryPeriod: history.at(-1)?.t,
    sseEnabled,
    sseStatus,
    errorMessage: sseEnabled ? sseError : queryError ? `${isHistory ? '历史趋势' : '监控数据'}更新失败：${queryError.message}。请点击刷新重试。` : null,
  };
}
