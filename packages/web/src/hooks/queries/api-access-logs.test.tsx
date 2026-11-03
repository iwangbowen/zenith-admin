import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { apiAccessLogContract } from '@zenith/shared/platform';
import { ApiRecorder, createRequestMock, createTestQueryClient, createWrapper } from '@/test-utils/query-harness';
import { mockApiAccessLogs } from '@/mocks/data/logs';
import { useApiAccessLogDetail, useApiAccessLogList } from './api-access-logs';

const recorder = new ApiRecorder();
vi.mock('@/utils/request', () => ({ request: createRequestMock(() => recorder) }));

beforeEach(() => {
  recorder.reset();
  recorder.on('GET', apiAccessLogContract.list.fullPath, { list: [], total: 0, page: 1, pageSize: 20 });
  recorder.on('GET', `${apiAccessLogContract.basePath}/1`, mockApiAccessLogs[0]);
  recorder.on('GET', `${apiAccessLogContract.basePath}/2`, mockApiAccessLogs[1]);
});

describe('API access log queries', () => {
  it('列表筛选与分页按契约序列化，手动刷新使用当前筛选', async () => {
    const client = createTestQueryClient();
    const hook = renderHook(() => useApiAccessLogList({ page: 2, pageSize: 20, responseCode: 400, minDurationMs: 0, username: '张 三' }), { wrapper: createWrapper(client) });
    await waitFor(() => expect(hook.result.current.isSuccess).toBe(true));
    const first = new URL(recorder.urls('GET')[0], 'http://localhost');
    expect(Object.fromEntries(first.searchParams)).toMatchObject({ page: '2', pageSize: '20', responseCode: '400', minDurationMs: '0', username: '张 三' });
    recorder.resetCalls();
    await act(async () => { await hook.result.current.refetch(); });
    expect(recorder.urls('GET')).toEqual([`${first.pathname}${first.search}`]);
    hook.unmount();
    client.clear();
  });

  it('详情只在选中时获取，切换 ID 不把旧详情作为新记录返回', async () => {
    const client = createTestQueryClient();
    const hook = renderHook(({ id }: { id: number | undefined }) => useApiAccessLogDetail(id), { wrapper: createWrapper(client), initialProps: { id: undefined as number | undefined } });
    expect(recorder.calls).toHaveLength(0);
    hook.rerender({ id: 1 });
    await waitFor(() => expect(hook.result.current.data?.id).toBe(1));
    hook.rerender({ id: 2 });
    expect(hook.result.current.data?.id).not.toBe(1);
    await waitFor(() => expect(hook.result.current.data?.id).toBe(2));
    recorder.resetCalls();
    hook.rerender({ id: undefined });
    await act(async () => { await Promise.resolve(); });
    expect(recorder.calls).toHaveLength(0);
    hook.unmount();
    client.clear();
  });
});
