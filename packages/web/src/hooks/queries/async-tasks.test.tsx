/**
 * async-tasks 域失效粒度契约
 *
 * 任务中心一屏同时挂着 4 个查询：列表、统计、类型元数据、明细项，全部落在
 * `asyncTaskKeys.all = ['async-tasks']` 之下。收敛前任何一次任务状态变更都用
 * `.all` 广播，把与该动作无因果关系的 `types`（任务类型元数据）一并打回源。
 *
 * 断言落在**实际发出的请求**上，而不是「调用了 invalidateQueries(某 key)」——
 * `.all` 是 `types` 的前缀，后一种断言在收敛前后都会通过，等于没测。
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { asyncTaskContract, IMPORT_TASK_TYPES } from '@zenith/shared/tasks';
import {
  ApiRecorder,
  createRequestMock,
  createTestQueryClient,
  createWrapper,
  isFresh,
  observeFetches,
} from '@/test-utils/query-harness';

const api = new ApiRecorder();
vi.mock('@/utils/request', () => ({ request: createRequestMock(() => api) }));

import {
  asyncTaskKeys,
  useAsyncTaskAction,
  useAsyncTaskDetail,
  useAsyncTaskItems,
  useAsyncTaskList,
  useAsyncTaskStats,
  useAsyncTaskTypes,
  useBatchCancelAsyncTasks,
  useCleanupAsyncTasks,
  useDeleteAsyncTask,
  useUpdateAsyncTaskTypeConfig,
} from './async-tasks';

const LIST_PARAMS = { page: 1, pageSize: 10 };
const ITEM_PARAMS = { taskId: 1, page: 1, pageSize: 10 };

beforeEach(() => {
  api.reset();
  api
    .on('GET', '/api/async-tasks', { list: [], total: 0, page: 1, pageSize: 10 })
    .on('GET', '/api/async-tasks/stats', { total: 0, running: 0 })
    .on('GET', '/api/async-tasks/types', [{ taskType: 'export', title: '导出' }])
    .on('GET', '/api/async-tasks/1/items', { list: [], total: 0, page: 1, pageSize: 10 })
    .on('GET', '/api/async-tasks/1', { id: 1, status: 'running' })
    .on('POST', '/api/async-tasks/1/cancel', { id: 1, status: 'cancelled' })
    .on('POST', '/api/async-tasks/batch-cancel', { affected: 2 })
    .on('POST', '/api/async-tasks/cleanup', { cleaned: 3 })
    .on('DELETE', '/api/async-tasks/1', null)
    .on('PUT', '/api/async-tasks/types/export/config', { taskType: 'export', title: '导出' });
});

it('encodes import and preview task types as one comma-separated query value accepted by the server contract', async () => {
  const hook = renderHook(() => useAsyncTaskList({ ...LIST_PARAMS, taskTypes: [...IMPORT_TASK_TYPES] }), { wrapper: createWrapper(createTestQueryClient()) });
  await waitFor(() => expect(hook.result.current.isSuccess).toBe(true));
  const query = new URL(api.urls('GET')[0], window.location.origin).searchParams;
  expect(query.getAll('taskTypes')).toEqual(['data-import,data-import-preview']);
  expect(asyncTaskContract.list.query.parse(Object.fromEntries(query)).taskTypes).toEqual(['data-import', 'data-import-preview']);
});

/** 还原 TaskCenterPage 的挂载：list / stats / types / items 同屏 */
function mountTaskCenter() {
  const qc = createTestQueryClient();
  const hook = renderHook(
    () => ({
      list: useAsyncTaskList(LIST_PARAMS),
      stats: useAsyncTaskStats(),
      types: useAsyncTaskTypes(),
      items: useAsyncTaskItems(ITEM_PARAMS),
      detail: useAsyncTaskDetail(1),
      cancel: useAsyncTaskAction('cancel'),
      remove: useDeleteAsyncTask(),
      batchCancel: useBatchCancelAsyncTasks(),
      cleanup: useCleanupAsyncTasks(),
      updateTypeConfig: useUpdateAsyncTaskTypeConfig(),
    }),
    { wrapper: createWrapper(qc) },
  );
  return { qc, hook };
}

async function settle(hook: ReturnType<typeof mountTaskCenter>['hook']) {
  await waitFor(() => {
    expect(hook.result.current.list.isSuccess).toBe(true);
    expect(hook.result.current.stats.isSuccess).toBe(true);
    expect(hook.result.current.types.isSuccess).toBe(true);
    expect(hook.result.current.items.isSuccess).toBe(true);
    expect(hook.result.current.detail.isSuccess).toBe(true);
  });
}

describe('任务类型元数据不被任务状态变更波及', () => {
  it('keeps the task-type metadata fresh across cancel / delete / batch-cancel / cleanup', async () => {
    const { qc, hook } = mountTaskCenter();
    await settle(hook);
    expect(isFresh(qc, asyncTaskKeys.types)).toBe(true);

    const fetches = observeFetches(qc);
    api.resetCalls();

    await hook.result.current.cancel.mutateAsync({ params: { id: 1 } });
    await hook.result.current.batchCancel.mutateAsync({ body: { ids: [1, 2] } });
    await hook.result.current.cleanup.mutateAsync({});
    await hook.result.current.remove.mutateAsync({ params: { id: 1 } });
    await waitFor(() => expect(hook.result.current.list.isFetching).toBe(false));

    // 收敛前：这 4 个动作各触发一次 types 回源
    expect(fetches.countOf(asyncTaskKeys.types)).toBe(0);
    expect(api.countOf('GET', '/api/async-tasks/types')).toBe(0);
    expect(isFresh(qc, asyncTaskKeys.types)).toBe(true);

    fetches.stop();
  });
});

describe('任务状态变更仍然刷新列表、统计与明细项', () => {
  it('refreshes list, stats and items on cancel so the UI does not go stale', async () => {
    const { hook } = mountTaskCenter();
    await settle(hook);

    const api0 = api.countOf('GET');
    api.resetCalls();

    await hook.result.current.cancel.mutateAsync({ params: { id: 1 } });
    await waitFor(() => {
      expect(api.countOf('GET', '/api/async-tasks')).toBe(1);
      expect(api.countOf('GET', '/api/async-tasks/stats')).toBe(1);
      expect(api.countOf('GET', '/api/async-tasks/1/items')).toBe(1);
      expect(api.countOf('GET', '/api/async-tasks/1')).toBe(1);
    });

    expect(api0).toBeGreaterThan(0);
  });
});

describe('类型配置变更只刷新类型元数据', () => {
  it('does not refetch the task list or stats when only the type config changed', async () => {
    const { qc, hook } = mountTaskCenter();
    await settle(hook);

    const fetches = observeFetches(qc);
    api.resetCalls();

    await hook.result.current.updateTypeConfig.mutateAsync({
      params: { taskType: 'export' },
      body: { enabled: true, allowConcurrent: true, maxAttempts: 3, retryDelayMs: 5000, retentionDays: null },
    });
    await waitFor(() => expect(fetches.countOf(asyncTaskKeys.types)).toBe(1));

    expect(api.countOf('GET', '/api/async-tasks')).toBe(0);
    expect(api.countOf('GET', '/api/async-tasks/stats')).toBe(0);

    fetches.stop();
  });
});
