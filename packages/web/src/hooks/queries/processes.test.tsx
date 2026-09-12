/**
 * processes 域缓存一致性契约
 *
 * 收敛前 kill / setPriority 按 `['processes']` 域根广播，所有主机的进程列表与详情一并回源。收敛后按主机维度失效：
 *  1. 结束进程：该主机列表回源，该进程详情移除（避免 404 重拉）；其它主机的列表保持 fresh
 *  2. 调整优先级：该主机列表 + 该进程详情回源
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import {
  ApiRecorder,
  createRequestMock,
  createTestQueryClient,
  createWrapper,
  hasCacheEntry,
  isFresh,
  observeFetches,
} from '@/test-utils/query-harness';

const api = new ApiRecorder();
vi.mock('@/utils/request', () => ({ request: createRequestMock(() => api) }));

import { processKeys, useKillProcess, useProcessDetail, useProcessList, useSetProcessPriority } from './processes';

const PROC = { pid: 42, name: 'node', cpu: 1, memory: 1 };

beforeEach(() => {
  api.reset();
  api
    .on('GET', '/api/processes', { list: [PROC], total: 1 })
    .on('GET', '/api/processes/42', PROC)
    .on('DELETE', '/api/processes/42', null)
    .on('PUT', '/api/processes/42/priority', null);
});

/** 本机列表（hostId=null，SSE 为主但仍有缓存条目）与远端主机 1 的列表同时挂载 */
async function mountHosts() {
  const qc = createTestQueryClient();
  const hook = renderHook(
    () => ({
      local: useProcessList(null),
      remote: useProcessList(1),
      detail: useProcessDetail(42, true, 1),
      kill: useKillProcess(),
      setPriority: useSetProcessPriority(),
    }),
    { wrapper: createWrapper(qc) },
  );
  await waitFor(() => {
    expect(hook.result.current.local.isSuccess).toBe(true);
    expect(hook.result.current.remote.isSuccess).toBe(true);
    expect(hook.result.current.detail.isSuccess).toBe(true);
  });
  return { qc, hook };
}

describe('useKillProcess', () => {
  it('refetches the host list, drops the process detail, and leaves the other host fresh', async () => {
    const { qc, hook } = await mountHosts();
    const fetches = observeFetches(qc);
    api.resetCalls();

    await hook.result.current.kill.mutateAsync({ params: { pid: 42 }, query: { hostId: 1 }, body: { signal: 'SIGTERM' } });
    await waitFor(() => expect(fetches.countOf(processKeys.list(1))).toBe(1));

    // 详情仍有 observer 时 removeQueries 会立刻重建并重拉；这里断言远端列表回源、本机列表不动
    expect(fetches.countOf(processKeys.list(null))).toBe(0);
    expect(isFresh(qc, processKeys.list(null))).toBe(true);
    expect(api.urls('GET').filter((u) => u.startsWith('/api/processes?'))).toEqual(['/api/processes?hostId=1']);
    fetches.stop();
  });

  it('removes a detail cache left behind by a closed drawer instead of refetching it', async () => {
    const qc = createTestQueryClient();
    const hook = renderHook(() => ({ remote: useProcessList(1), kill: useKillProcess() }), { wrapper: createWrapper(qc) });
    await waitFor(() => expect(hook.result.current.remote.isSuccess).toBe(true));
    qc.setQueryData(processKeys.detail(42, 1), PROC);
    api.resetCalls();

    await hook.result.current.kill.mutateAsync({ params: { pid: 42 }, query: { hostId: 1 }, body: { signal: 'SIGTERM' } });
    await waitFor(() => expect(hook.result.current.remote.isFetching).toBe(false));

    expect(hasCacheEntry(qc, processKeys.detail(42, 1))).toBe(false);
    expect(api.countOf('GET', '/api/processes/42')).toBe(0);
  });
});

describe('useSetProcessPriority', () => {
  it('refetches the process detail and its host list only', async () => {
    const { qc, hook } = await mountHosts();
    const fetches = observeFetches(qc);
    api.resetCalls();

    await hook.result.current.setPriority.mutateAsync({ params: { pid: 42 }, query: { hostId: 1 }, body: { nice: 5 } });
    await waitFor(() => {
      expect(fetches.countOf(processKeys.list(1))).toBe(1);
      expect(fetches.countOf(processKeys.detail(42, 1))).toBe(1);
    });

    expect(fetches.countOf(processKeys.list(null))).toBe(0);
    fetches.stop();
  });
});
