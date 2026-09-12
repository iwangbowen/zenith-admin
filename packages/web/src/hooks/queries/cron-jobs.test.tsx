/**
 * cron-jobs 域缓存一致性契约（S2 代表性试点）
 *
 * 选它压测契约，因为一个页面上最多同时挂着 6 个查询（列表、handlers、概览、
 * 详情、单任务日志、全量日志），且包含两类最难判断的情形：
 *
 *  1. **命令型但有副作用**：手动执行接口只返回提示文案（`okBody(null, msg)`），
 *     却会改变 lastRunAt/lastRunStatus、执行日志与概览统计。
 *     判据是「有没有已挂载的查询读了被改动的状态」，而不是接口像不像命令。
 *  2. **长期活跃的静态 lookup**：handlers 无 enabled 门控、staleTime 5 分钟，
 *     收敛前每次写操作都被 `.all` 打回源。任何 mutation 都不该碰它。
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import type { CronJob } from '@zenith/shared/platform';
import {
  ApiRecorder,
  createRequestMock,
  createTestQueryClient,
  createWrapper,
  getCacheEntry,
  hasCacheEntry,
  isFresh,
  observeFetches,
} from '@/test-utils/query-harness';

const api = new ApiRecorder();
vi.mock('@/utils/request', () => ({ request: createRequestMock(() => api) }));

import {
  cronJobKeys,
  useClearCronJobLogs,
  useClearCronJobLogsOfJob,
  useCronJobAllLogs,
  useCronJobDetail,
  useCronJobHandlers,
  useCronJobList,
  useCronJobStats,
  useDeleteCronJob,
  useRunCronJob,
  useSaveCronJob,
  useUpdateCronJobStatus,
} from './cron-jobs';

const LIST_PARAMS = { page: 1, pageSize: 10 };
const ALL_LOGS_PARAMS = { page: 1, pageSize: 10 };

const JOB: CronJob = {
  id: 1,
  name: '对账',
  cronExpression: '0 0 * * *',
  handler: 'reconcile',
  params: null,
  status: 'enabled',
  description: '每日对账',
  retryCount: 0,
  retryInterval: 60,
  retryBackoff: false,
  monitorTimeout: null,
  lastRunAt: null,
  lastRunStatus: null,
  lastRunMessage: null,
  createdAt: '2026-07-31 10:00:00',
  updatedAt: '2026-07-31 10:00:00',
};

beforeEach(() => {
  api.reset();
  api
    .on('GET', '/api/cron-jobs', { list: [JOB], total: 1, page: 1, pageSize: 10 })
    .on('GET', '/api/cron-jobs/handlers', ['reconcile', 'cleanup'])
    .on('GET', '/api/cron-jobs/stats', { totalJobs: 1, enabledJobs: 1 })
    .on('GET', '/api/cron-jobs/logs', { list: [], total: 0, page: 1, pageSize: 10 })
    .on('GET', '/api/cron-jobs/1', JOB)
    .on('PUT', '/api/cron-jobs/1', { ...JOB, name: '对账（改）' })
    .on('PUT', '/api/cron-jobs/1/status', null)
    .on('POST', '/api/cron-jobs/1/run', null)
    .on('DELETE', '/api/cron-jobs/1', null)
    .on('DELETE', /\/logs\/clean/, null);
});

/** 还原 CronJobsPage 默认标签页的挂载情况：列表与 handlers 都无 enabled 门控 */
function mountJobsTab() {
  const qc = createTestQueryClient();
  const hook = renderHook(
    () => ({
      list: useCronJobList(LIST_PARAMS),
      handlers: useCronJobHandlers(),
      stats: useCronJobStats(),
      run: useRunCronJob(),
      save: useSaveCronJob(),
      remove: useDeleteCronJob(),
      status: useUpdateCronJobStatus(),
      clearLogs: useClearCronJobLogs(),
    }),
    { wrapper: createWrapper(qc) },
  );
  return { qc, hook };
}

async function settle(hook: ReturnType<typeof mountJobsTab>['hook']) {
  await waitFor(() => {
    expect(hook.result.current.list.isSuccess).toBe(true);
    expect(hook.result.current.handlers.isSuccess).toBe(true);
    expect(hook.result.current.stats.isSuccess).toBe(true);
  });
}

describe('handlers 静态 lookup 不再被任何写操作波及', () => {
  it('keeps the handlers lookup fresh across run / save / status / delete / clearLogs', async () => {
    const { qc, hook } = mountJobsTab();
    await settle(hook);
    expect(isFresh(qc, cronJobKeys.handlers)).toBe(true);

    const fetches = observeFetches(qc);
    api.resetCalls();

    await hook.result.current.run.mutateAsync({ params: { id: 1 } });
    await hook.result.current.save.mutateAsync({ id: 1, values: { name: '对账（改）' } });
    await hook.result.current.status.mutateAsync({ params: { id: 1 }, body: { status: 'disabled' } });
    await hook.result.current.clearLogs.mutateAsync({ query: { days: 90 } });
    await hook.result.current.remove.mutateAsync([1]);
    await waitFor(() => expect(hook.result.current.list.isFetching).toBe(false));

    // 收敛前：这 5 个动作各触发一次 handlers 回源
    expect(fetches.countOf(cronJobKeys.handlers)).toBe(0);
    expect(api.countOf('GET', '/api/cron-jobs/handlers')).toBe(0);
    expect(isFresh(qc, cronJobKeys.handlers)).toBe(true);

    fetches.stop();
  });
});

describe('useRunCronJob —— 命令型接口但副作用广', () => {
  it('still refreshes list, detail, stats and logs even though the response carries no data', async () => {
    const { qc, hook } = mountJobsTab();
    await settle(hook);

    // 详情与全量日志分别由弹窗/抽屉挂载
    const extra = renderHook(
      () => ({ detail: useCronJobDetail(1), logs: useCronJobAllLogs(ALL_LOGS_PARAMS) }),
      { wrapper: createWrapper(qc) },
    );
    await waitFor(() => {
      expect(extra.result.current.detail.isSuccess).toBe(true);
      expect(extra.result.current.logs.isSuccess).toBe(true);
    });

    const fetches = observeFetches(qc);
    api.resetCalls();

    await hook.result.current.run.mutateAsync({ params: { id: 1 } });
    await waitFor(() => expect(hook.result.current.list.isFetching).toBe(false));

    expect(fetches.countOf(cronJobKeys.lists)).toBe(1);
    expect(fetches.countOf(cronJobKeys.detail(1))).toBe(1);
    expect(fetches.countOf(cronJobKeys.stats)).toBe(1);
    expect(fetches.countOf(cronJobKeys.logs)).toBe(1);

    fetches.stop();
  });
});

describe('useClearCronJobLogs —— 只影响日志与由日志聚合的概览', () => {
  it('refreshes logs and stats but leaves the job list and detail untouched', async () => {
    const { qc, hook } = mountJobsTab();
    await settle(hook);

    const extra = renderHook(() => useCronJobDetail(1), { wrapper: createWrapper(qc) });
    await waitFor(() => expect(extra.result.current.isSuccess).toBe(true));

    const fetches = observeFetches(qc);
    api.resetCalls();

    await hook.result.current.clearLogs.mutateAsync({ query: { days: 90 } });
    await waitFor(() => expect(fetches.countOf(cronJobKeys.stats)).toBe(1));

    expect(fetches.countOf(cronJobKeys.lists)).toBe(0);
    expect(fetches.countOf(cronJobKeys.detail(1))).toBe(0);
    expect(isFresh(qc, cronJobKeys.detail(1))).toBe(true);
    expect(api.countOf('GET', '/api/cron-jobs')).toBe(0);

    fetches.stop();
  });

  it('per-job clearing hits the job endpoint and shares the same invalidation surface', async () => {
    const { qc, hook } = mountJobsTab();
    await settle(hook);

    const extra = renderHook(() => ({ detail: useCronJobDetail(1), clearJobLogs: useClearCronJobLogsOfJob() }), { wrapper: createWrapper(qc) });
    await waitFor(() => expect(extra.result.current.detail.isSuccess).toBe(true));

    const fetches = observeFetches(qc);
    api.resetCalls();

    await extra.result.current.clearJobLogs.mutateAsync({ params: { id: 1 }, query: { days: 30 } });
    await waitFor(() => expect(fetches.countOf(cronJobKeys.stats)).toBe(1));

    expect(api.urls('DELETE')).toEqual(['/api/cron-jobs/1/logs/clean?days=30']);
    expect(fetches.countOf(cronJobKeys.lists)).toBe(0);
    expect(fetches.countOf(cronJobKeys.detail(1))).toBe(0);
    expect(isFresh(qc, cronJobKeys.detail(1))).toBe(true);

    fetches.stop();
  });
});

describe('useSaveCronJob / useDeleteCronJob', () => {
  it('fills the detail cache from the save response instead of refetching it', async () => {
    const { qc, hook } = mountJobsTab();
    await settle(hook);

    const extra = renderHook(() => useCronJobDetail(1), { wrapper: createWrapper(qc) });
    await waitFor(() => expect(extra.result.current.isSuccess).toBe(true));
    api.resetCalls();

    await hook.result.current.save.mutateAsync({ id: 1, values: { name: '对账（改）' } });

    expect(getCacheEntry<CronJob>(qc, cronJobKeys.detail(1))?.name).toBe('对账（改）');
    expect(api.countOf('GET', '/api/cron-jobs/1')).toBe(0);
  });

  it('drops the deleted job detail rather than invalidating it into a 404 refetch', async () => {
    const { qc, hook } = mountJobsTab();
    await settle(hook);

    // 弹窗关闭后遗留的详情缓存：有数据、无 observer
    qc.setQueryData(cronJobKeys.detail(1), JOB);
    api.resetCalls();

    await hook.result.current.remove.mutateAsync([1]);
    await waitFor(() => expect(hook.result.current.list.isFetching).toBe(false));

    expect(hasCacheEntry(qc, cronJobKeys.detail(1))).toBe(false);
    expect(api.countOf('GET', '/api/cron-jobs/1')).toBe(0);
  });
});
