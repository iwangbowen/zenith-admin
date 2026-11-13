import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { apiAccessLogContract, operationLogContract, traceContract } from '@zenith/shared/platform';
import { mockApiAccessLogs } from '@/mocks/data/logs';
import { ApiRecorder, createRequestMock, createTestQueryClient, createWrapper, hasCacheEntry, isFresh, observeFetches } from '@/test-utils/query-harness';

const api = new ApiRecorder();
vi.mock('@/utils/request', () => ({ request: createRequestMock(() => api) }));

import { contractKey } from '@/lib/contract-query';
import { apiAccessLogKeys, useApiAccessLogDetail, useApiAccessLogList, useCleanApiAccessLogs } from './api-access-logs';
import { traceKeys, useTraceTimeline } from './trace';

beforeEach(() => {
  api.reset();
  api.on('GET', '/api/api-access-logs', { list: [], total: 0, page: 1, pageSize: 20 })
    .on('GET', `${apiAccessLogContract.basePath}/1`, mockApiAccessLogs[0])
    .on('GET', `${apiAccessLogContract.basePath}/2`, mockApiAccessLogs[1])
    .on('GET', `${traceContract.basePath}/req-7`, { correlationId: 'req-7', nodes: [] })
    .on('DELETE', '/api/api-access-logs/clean', { deleted: 3 });
});

describe('API access log queries', () => {
  it('列表筛选与分页按契约序列化，手动刷新使用当前筛选', async () => {
    const client = createTestQueryClient();
    const hook = renderHook(() => useApiAccessLogList({ page: 2, pageSize: 20, responseCode: 400, minDurationMs: 0, accessorName: '张 三' }), { wrapper: createWrapper(client) });
    await waitFor(() => expect(hook.result.current.isSuccess).toBe(true));
    const first = new URL(api.urls('GET')[0], 'http://localhost');
    expect(Object.fromEntries(first.searchParams)).toMatchObject({ page: '2', pageSize: '20', responseCode: '400', minDurationMs: '0', accessorName: '张 三' });
    api.resetCalls();
    await act(async () => { await hook.result.current.refetch(); });
    expect(api.urls('GET')).toEqual([`${first.pathname}${first.search}`]);
    hook.unmount();
    client.clear();
  });

  it('详情只在选中时获取，切换 ID 不把旧详情作为新记录返回', async () => {
    const client = createTestQueryClient();
    const hook = renderHook(({ id }: { id: number | undefined }) => useApiAccessLogDetail(id), { wrapper: createWrapper(client), initialProps: { id: undefined as number | undefined } });
    expect(api.calls).toHaveLength(0);
    hook.rerender({ id: 1 });
    await waitFor(() => expect(hook.result.current.data?.id).toBe(1));
    hook.rerender({ id: 2 });
    expect(hook.result.current.data?.id).not.toBe(1);
    await waitFor(() => expect(hook.result.current.data?.id).toBe(2));
    api.resetCalls();
    hook.rerender({ id: undefined });
    await act(async () => { await Promise.resolve(); });
    expect(api.calls).toHaveLength(0);
    hook.unmount();
    client.clear();
  });
});

describe('API access log cleanup cache', () => {
  it.each([0, 30, 365])('refreshes lists and removes obsolete details without touching other logs (days=%i)', async days => {
    const qc = createTestQueryClient();
    const hook = renderHook(() => ({ list: useApiAccessLogList({ page: 1, pageSize: 20 }), timeline: useTraceTimeline('req-7'), clean: useCleanApiAccessLogs() }), { wrapper: createWrapper(qc) });
    await waitFor(() => {
      expect(hook.result.current.list.isSuccess).toBe(true);
      expect(hook.result.current.timeline.isSuccess).toBe(true);
    });
    qc.setQueryData(apiAccessLogKeys.detail(7), { id: 7 });
    const otherLogsKey = contractKey(operationLogContract.list);
    qc.setQueryData(otherLogsKey, { list: [] });
    const fetches = observeFetches(qc);
    api.resetCalls();
    await expect(hook.result.current.clean.mutateAsync({ query: { days } })).resolves.toEqual({ deleted: 3 });
    const call = api.calls.find(item => item.method === 'DELETE')!;
    expect(new URL(call.url, 'http://localhost').searchParams.get('days')).toBe(String(days));
    await waitFor(() => {
      expect(fetches.countOf(apiAccessLogKeys.lists)).toBe(1);
      expect(fetches.countOf(traceKeys.of('req-7'))).toBe(1);
    });
    expect(hasCacheEntry(qc, apiAccessLogKeys.detail(7))).toBe(false);
    expect(api.countOf('GET', '/api/api-access-logs/7')).toBe(0);
    expect(isFresh(qc, otherLogsKey)).toBe(true);
    fetches.stop();
    hook.unmount();
    qc.clear();
  });
});
