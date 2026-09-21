import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { monitorContract, type MonitorHistoryRange } from '@zenith/shared/platform';
import { ApiRecorder, createRequestMock, createTestQueryClient, createWrapper } from '@/test-utils/query-harness';
import { request } from '@/utils/request';
import { monitorKeys, useMonitorHistory, useMonitorSnapshot } from './monitor';

const api = new ApiRecorder();
vi.mock('@/utils/request', () => {
  const mock = createRequestMock(() => api);
  return { request: { ...mock, get: vi.fn(mock.get) } };
});

const HISTORY_URL = monitorContract.history.fullPath;
const SNAPSHOT_URL = monitorContract.snapshot.fullPath;
const SERIES_URL = monitorContract.timeseries.fullPath;
const WS_URL = monitorContract.ws.fullPath;

beforeEach(() => {
  api.reset();
  vi.mocked(request.get).mockClear();
  api
    .on('GET', HISTORY_URL, (call: { url: string }) => ({
      range: new URL(call.url, 'http://localhost').searchParams.get('range'),
      bucketSec: 60,
      points: [],
    }))
    .on('GET', SNAPSHOT_URL, { collectedAt: '2026-09-21 12:00:00' })
    .on('GET', SERIES_URL, { points: [{ t: '2026-09-21 12:00:00', cpu: 10 }] })
    .on('GET', WS_URL, { totalConnections: 2 });
});

describe('monitor queries', () => {
  it('polls history once per minute and stops when automatic updates are paused', async () => {
    vi.useFakeTimers();
    const qc = createTestQueryClient();
    const hook = renderHook(({ interval }: { interval: number | false }) => useMonitorHistory('1h', true, interval), {
      wrapper: createWrapper(qc), initialProps: { interval: 60_000 as number | false },
    });
    try {
      await act(async () => { await vi.advanceTimersByTimeAsync(1); });
      expect(hook.result.current.isSuccess).toBe(true);
      expect(api.countOf('GET', HISTORY_URL)).toBe(1);
      await act(async () => { await vi.advanceTimersByTimeAsync(59_998); });
      expect(api.countOf('GET', HISTORY_URL)).toBe(1);
      await act(async () => { await vi.advanceTimersByTimeAsync(2); });
      expect(api.countOf('GET', HISTORY_URL)).toBe(2);

      hook.rerender({ interval: false });
      await act(async () => { await vi.advanceTimersByTimeAsync(120_000); });
      expect(api.countOf('GET', HISTORY_URL)).toBe(2);
      expect(api.countOf('GET', SNAPSHOT_URL)).toBe(0);
    } finally {
      hook.unmount();
      qc.clear();
      vi.useRealTimers();
    }
  });

  it('queries each selected range independently and refreshes only the current range', async () => {
    const qc = createTestQueryClient();
    const hook = renderHook(({ range }: { range: MonitorHistoryRange }) => useMonitorHistory(range), {
      wrapper: createWrapper(qc), initialProps: { range: '1h' as MonitorHistoryRange },
    });
    await waitFor(() => expect(hook.result.current.data?.range).toBe('1h'));
    hook.rerender({ range: '24h' });
    await waitFor(() => expect(hook.result.current.data?.range).toBe('24h'));
    api.resetCalls();
    await act(async () => { await hook.result.current.refetch(); });

    expect(api.urls('GET')).toEqual([`${HISTORY_URL}?range=24h`]);
    expect(qc.getQueryData(monitorKeys.history('1h'))).toMatchObject({ range: '1h' });
    expect(qc.getQueryData(monitorKeys.history('24h'))).toMatchObject({ range: '24h' });
  });

  it('allows a manual history refresh when automatic fetching is disabled', async () => {
    vi.useFakeTimers();
    const qc = createTestQueryClient();
    const hook = renderHook(() => useMonitorHistory('1h', false, 60_000), { wrapper: createWrapper(qc) });
    try {
      expect(hook.result.current.data).toBeUndefined();
      await act(async () => { await vi.advanceTimersByTimeAsync(120_000); });
      expect(api.countOf('GET', HISTORY_URL)).toBe(0);
      await act(async () => { await hook.result.current.refetch(); });
      await act(async () => { await vi.advanceTimersByTimeAsync(1); });
      expect(hook.result.current.data?.range).toBe('1h');
      expect(api.countOf('GET', HISTORY_URL)).toBe(1);
      await act(async () => { await vi.advanceTimersByTimeAsync(120_000); });
      expect(api.countOf('GET', HISTORY_URL)).toBe(1);
    } finally {
      hook.unmount();
      qc.clear();
      vi.useRealTimers();
    }
  });

  it('keeps the selected range visible when an older range request finishes later', async () => {
    let resolveFirst!: (response: Awaited<ReturnType<typeof request.get>>) => void;
    vi.mocked(request.get).mockImplementationOnce(() => new Promise((resolve) => { resolveFirst = resolve; }));
    const qc = createTestQueryClient();
    const hook = renderHook(({ range }: { range: MonitorHistoryRange }) => useMonitorHistory(range), {
      wrapper: createWrapper(qc), initialProps: { range: '1h' as MonitorHistoryRange },
    });
    expect(hook.result.current.data).toBeUndefined();
    hook.rerender({ range: '24h' });
    await waitFor(() => expect(hook.result.current.data?.range).toBe('24h'));

    await act(async () => {
      resolveFirst({ code: 0, message: 'success', data: { range: '1h', bucketSec: 60, points: [] } });
    });
    await waitFor(() => expect(qc.getQueryData(monitorKeys.history('1h'))).toMatchObject({ range: '1h' }));
    expect(hook.result.current.data?.range).toBe('24h');
  });

  it('manually refreshes all three live endpoints with one shared cancellation signal', async () => {
    const qc = createTestQueryClient();
    const hook = renderHook(() => useMonitorSnapshot(false, false), { wrapper: createWrapper(qc) });
    expect(hook.result.current.isSuccess).toBe(false);
    expect(api.calls).toHaveLength(0);
    await act(async () => { await hook.result.current.refetch(); });
    await waitFor(() => expect(hook.result.current.isSuccess).toBe(true));

    expect(api.urls('GET')).toEqual([SNAPSHOT_URL, SERIES_URL, WS_URL]);
    expect(hook.result.current.data).toMatchObject({
      data: { collectedAt: '2026-09-21 12:00:00' },
      series: [{ cpu: 10 }],
      wsMetrics: { totalConnections: 2 },
    });
    const options = vi.mocked(request.get).mock.calls.map((call) => call[1]);
    const signal = options[0]?.signal;
    expect(signal).toBeInstanceOf(AbortSignal);
    expect(signal?.aborted).toBe(false);
    expect(options.every((option) => option?.signal === signal && option?.silent)).toBe(true);
  });

  it('aborts every in-flight live endpoint when the query is unmounted', () => {
    vi.mocked(request.get).mockImplementationOnce(() => new Promise(() => {}))
      .mockImplementationOnce(() => new Promise(() => {}))
      .mockImplementationOnce(() => new Promise(() => {}));
    const qc = createTestQueryClient();
    const hook = renderHook(() => useMonitorSnapshot(false), { wrapper: createWrapper(qc) });
    const signals = vi.mocked(request.get).mock.calls.map((call) => call[1]?.signal);
    expect(signals).toHaveLength(3);
    expect(signals.every((signal) => signal && !signal.aborted)).toBe(true);

    hook.unmount();
    expect(signals.every((signal) => signal?.aborted)).toBe(true);
    qc.clear();
  });
});
