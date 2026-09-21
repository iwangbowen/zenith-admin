import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { Toast } from '@douyinfe/semi-ui';
import {
  monitorContract,
  type MonitorHistory,
  type MonitorHistoryPoint,
  type MonitorHistoryRange,
  type MonitorSnapshot,
} from '@zenith/shared/platform';
import { ApiRecorder, createRequestMock, createTestQueryClient, createWrapper } from '@/test-utils/query-harness';
import { request } from '@/utils/request';
import { readSseStream } from '@/utils/streaming';
import { useMonitorRefreshController } from './useMonitorRefreshController';

const api = new ApiRecorder();
vi.mock('@/utils/request', () => ({
  request: { ...createRequestMock(() => api), fetchRaw: vi.fn() },
}));
vi.mock('@/utils/streaming', () => ({ readSseStream: vi.fn() }));
vi.mock('@douyinfe/semi-ui', () => ({
  Toast: { error: vi.fn(), info: vi.fn(), success: vi.fn() },
}));

const HISTORY_URL = monitorContract.history.fullPath;
const STREAM_URL = monitorContract.stream.fullPath;
const point: MonitorHistoryPoint = {
  t: '2026-09-21 12:00:00',
  cpu: 10, memory: 20, disk: 30, swap: 0, load1: 1, procCpu: 5, heap: 100,
  loopLag: 2, qps: 3, errorRate: 0, netRxBps: 4, netTxBps: 5, diskReadBps: 6, diskWriteBps: 7,
  cpuMax: 10, memoryMax: 20, diskMax: 30, swapMax: 0, load1Max: 1, procCpuMax: 5, heapMax: 100,
  loopLagMax: 2, qpsMax: 3, errorRateMax: 0, netRxBpsMax: 4, netTxBpsMax: 5, diskReadBpsMax: 6, diskWriteBpsMax: 7,
};

interface StreamSession {
  emit: Parameters<typeof readSseStream>[1];
  finish: () => void;
}
const streams: StreamSession[] = [];
const clients: ReturnType<typeof createTestQueryClient>[] = [];

function wrapper() {
  const client = createTestQueryClient();
  clients.push(client);
  return createWrapper(client);
}

function history(range: MonitorHistoryRange, points = [point]): MonitorHistory {
  return { range, bucketSec: 60, points };
}

function emitMetrics(stream: StreamSession, usage: number) {
  // 本组行为只依赖 CPU 使用率，无需复制与刷新无关的整机硬件 fixture。
  const payload: Pick<MonitorSnapshot, 'cpu'> = {
    cpu: { model: 'test-cpu', cores: 1, speed: 1000, loadAvg: [0, 0, 0], usage, perCore: [] },
  };
  stream.emit([{ event: 'metrics', data: JSON.stringify(payload) }]);
}

beforeEach(() => {
  api.reset();
  streams.length = 0;
  vi.clearAllMocks();
  api.on('GET', HISTORY_URL, ({ url }: { url: string }) => {
    const range = new URL(url, 'http://localhost').searchParams.get('range') as MonitorHistoryRange;
    return history(range);
  });
  vi.mocked(request.fetchRaw).mockImplementation(async () => new Response(''));
  vi.mocked(readSseStream).mockImplementation((_response, emit) => new Promise<void>((finish) => {
    streams.push({ emit, finish });
  }));
});

afterEach(async () => {
  cleanup();
  for (const stream of streams) stream.finish();
  for (const client of clients.splice(0)) client.clear();
  vi.restoreAllMocks();
  await Promise.resolve();
});

describe('useMonitorRefreshController', () => {
  it('loads only history when opened directly on the history tab, even with a saved live mode', async () => {
    const { result } = renderHook(() => useMonitorRefreshController({
      activeTab: 'history', historyRange: '1h', initialRefreshInterval: -1,
    }), { wrapper: wrapper() });

    await waitFor(() => expect(result.current.history).toEqual([point]));
    expect(api.urls('GET')).toEqual([`${HISTORY_URL}?range=1h`]);
    expect(request.fetchRaw).not.toHaveBeenCalled();
    expect(result.current.data).toBeNull();
    expect(result.current.sseEnabled).toBe(false);
    expect(result.current.refreshInterval).toBe(60_000);
    expect(result.current.latestHistoryPeriod).toBe(point.t);
    expect(result.current.updatedAt).toBeGreaterThan(0);
    expect(result.current.loading).toBe(false);
  });

  it('manually refreshes the selected history range and reports when no sample was added', async () => {
    const { result, rerender } = renderHook(({ range }: { range: MonitorHistoryRange }) => useMonitorRefreshController({
      activeTab: 'history', historyRange: range, initialRefreshInterval: 0,
    }), { wrapper: wrapper(), initialProps: { range: '1h' as MonitorHistoryRange } });
    await waitFor(() => expect(result.current.history).toEqual([point]));
    rerender({ range: '24h' });
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(api.urls('GET')).toContain(`${HISTORY_URL}?range=24h`);
    api.resetCalls();

    const nextPoint = { ...point, t: '2026-09-21 12:01:00', cpu: 25 };
    api.on('GET', HISTORY_URL, history('24h', [point, nextPoint]));
    await act(async () => { await result.current.refresh(); });
    await waitFor(() => expect(result.current.history).toEqual([point, nextPoint]));
    expect(api.urls('GET')).toEqual([`${HISTORY_URL}?range=24h`]);
    expect(result.current.latestHistoryPeriod).toBe(nextPoint.t);
    expect(result.current.refreshInterval).toBe(0);
    expect(Toast.success).toHaveBeenCalledWith('历史趋势已刷新');
    expect(request.fetchRaw).not.toHaveBeenCalled();

    await act(async () => { await result.current.refresh(); });
    expect(Toast.info).toHaveBeenCalledWith('已刷新，暂无新增采样');
  });

  it('preserves history and its last successful update time after a failed manual refresh', async () => {
    const { result } = renderHook(() => useMonitorRefreshController({
      activeTab: 'history', historyRange: '1h', initialHistoryRefreshInterval: 0,
    }), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.history).toEqual([point]));
    const updatedAt = result.current.updatedAt;
    api.resetCalls();
    api.on('GET', HISTORY_URL, () => { throw new Error('network unavailable'); });

    await act(async () => { await result.current.refresh(); });
    await waitFor(() => expect(result.current.errorMessage).toContain('network unavailable'));
    expect(result.current.history).toEqual([point]);
    expect(result.current.updatedAt).toBe(updatedAt);
    expect(result.current.loading).toBe(false);
    expect(api.urls('GET')).toEqual([`${HISTORY_URL}?range=1h`]);
    expect(Toast.error).toHaveBeenCalledWith('历史趋势刷新失败：network unavailable');
  });

  it('does not show a toast when a pending history refresh finishes after unmount', async () => {
    const { result, unmount } = renderHook(() => useMonitorRefreshController({
      activeTab: 'history', historyRange: '1h', initialHistoryRefreshInterval: 0,
    }), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.history).toEqual([point]));
    const pending = Promise.withResolvers<Awaited<ReturnType<typeof request.get>>>();
    const get = vi.spyOn(request, 'get').mockImplementationOnce(() => pending.promise);
    let refresh!: Promise<void>;
    act(() => { refresh = result.current.refresh(); });
    expect(get).toHaveBeenCalledTimes(1);

    unmount();
    await act(async () => {
      pending.resolve({ code: 0, message: 'success', data: history('1h') });
      await refresh;
    });
    expect(Toast.info).not.toHaveBeenCalled();
    expect(Toast.success).not.toHaveBeenCalled();
    expect(Toast.error).not.toHaveBeenCalled();
  });

  it('ignores an old manual snapshot failure after switching to live streaming', async () => {
    const snapshot: Pick<MonitorSnapshot, 'disk'> = { disk: null };
    api.on('GET', monitorContract.snapshot.fullPath, snapshot)
      .on('GET', monitorContract.timeseries.fullPath, { points: [] })
      .on('GET', monitorContract.ws.fullPath, { totalConnections: 0 });
    const { result } = renderHook(() => useMonitorRefreshController({
      activeTab: 'overview', historyRange: '1h', initialRefreshInterval: 0,
    }), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.data).toEqual(snapshot));
    const pending = Promise.withResolvers<Awaited<ReturnType<typeof request.get>>>();
    const get = vi.spyOn(request, 'get').mockImplementationOnce(() => pending.promise);
    let refresh!: Promise<void>;
    act(() => { refresh = result.current.refresh(); });
    expect(get).toHaveBeenCalledTimes(3);

    act(() => result.current.setRefreshInterval(-1));
    await waitFor(() => expect(streams).toHaveLength(1));
    act(() => emitMetrics(streams[0], 25));
    await act(async () => {
      pending.reject(new Error('old snapshot request failed'));
      await refresh;
    });
    expect(result.current.data?.cpu.usage).toBe(25);
    expect(result.current.sseStatus).toBe('open');
    expect(result.current.errorMessage).toBeNull();
    expect(Toast.error).not.toHaveBeenCalled();
  });

  it('aborts live streaming on history and restores the live mode when returning', async () => {
    const { result, rerender } = renderHook(({ activeTab }: { activeTab: string }) => useMonitorRefreshController({
      activeTab, historyRange: '1h', initialRefreshInterval: -1,
    }), { wrapper: wrapper(), initialProps: { activeTab: 'overview' } });
    await waitFor(() => expect(streams).toHaveLength(1));
    const oldSignal = vi.mocked(request.fetchRaw).mock.calls[0][1]?.signal;
    expect(oldSignal?.aborted).toBe(false);

    rerender({ activeTab: 'history' });
    await waitFor(() => expect(result.current.history).toEqual([point]));
    expect(oldSignal?.aborted).toBe(true);
    expect(result.current.sseEnabled).toBe(false);
    expect(result.current.sseStatus).toBe('idle');
    expect(result.current.refreshInterval).toBe(60_000);
    act(() => result.current.setRefreshInterval(0));
    expect(result.current.historyInterval).toBe(0);

    rerender({ activeTab: 'overview' });
    await waitFor(() => expect(streams).toHaveLength(2));
    expect(result.current.sseEnabled).toBe(true);
    expect(result.current.refreshInterval).toBe(-1);
    expect(result.current.historyInterval).toBe(0);
    expect(api.urls('GET')).toEqual([`${HISTORY_URL}?range=1h`]);
    expect(vi.mocked(request.fetchRaw).mock.calls.every(([url]) => url === STREAM_URL)).toBe(true);
  });

  it('refreshes live mode by reconnecting, waits for metrics, and ignores late frames from the old stream', async () => {
    const { result } = renderHook(() => useMonitorRefreshController({
      activeTab: 'overview', historyRange: '1h', initialRefreshInterval: -1,
    }), { wrapper: wrapper() });
    await waitFor(() => expect(streams).toHaveLength(1));
    expect(result.current.loading).toBe(true);
    expect(result.current.sseStatus).toBe('connecting');
    act(() => emitMetrics(streams[0], 10));
    expect(result.current.loading).toBe(false);
    const oldSignal = vi.mocked(request.fetchRaw).mock.calls[0][1]?.signal;

    await act(async () => { await result.current.refresh(); });
    await waitFor(() => expect(streams).toHaveLength(2));
    expect(oldSignal?.aborted).toBe(true);
    expect(result.current.loading).toBe(true);
    expect(result.current.data?.cpu.usage).toBe(10);
    act(() => streams[1].emit([{ event: 'series', data: JSON.stringify({ points: [] }) }]));
    expect(result.current.loading).toBe(true);

    act(() => emitMetrics(streams[1], 25));
    expect(result.current.data?.cpu.usage).toBe(25);
    expect(result.current.loading).toBe(false);
    expect(result.current.sseStatus).toBe('open');
    const updatedAt = result.current.updatedAt;
    act(() => {
      emitMetrics(streams[0], 99);
      streams[0].emit([
        { event: 'metrics:diff', data: JSON.stringify({ cpu: { usage: 100 } }) },
        { event: 'series:point', data: JSON.stringify({ t: 'stale', cpu: 99 }) },
        { event: 'ws', data: JSON.stringify({ totalConnections: 999 }) },
      ]);
    });
    expect(result.current.data?.cpu.usage).toBe(25);
    expect(result.current.updatedAt).toBe(updatedAt);
    expect(result.current.series).toEqual([]);
    expect(result.current.wsMetrics).toBeNull();
    expect(request.fetchRaw).toHaveBeenCalledTimes(2);
    expect(api.calls).toHaveLength(0);
  });
});
