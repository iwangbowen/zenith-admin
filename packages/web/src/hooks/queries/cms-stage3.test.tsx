/**
 * cms-stage3（发布中心）缓存一致性契约
 *
 * 收敛前 4 个发布任务 mutation 都 `invalidateQueries(cmsPublishingKeys.all)`，站群整组重建再追加
 * `asyncTaskKeys.all`。发布任务本身就是一条 async task，所以任务中心视图理应在每次提交 / 操作后都刷新；
 * 收敛后统一走 `invalidateAfterCmsPublishingChange`：发布中心三张视图 + 任务中心状态（不含任务类型元数据）。
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
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

import { asyncTaskKeys, useAsyncTaskList, useAsyncTaskTypes } from './async-tasks';
import { cmsSiteKeys, useAllCmsSites } from './cms-sites';
import {
  cmsPublishingKeys,
  useCmsPublishArtifactList,
  useCmsPublishingAction,
  useCmsPublishingDetail,
  useCmsPublishingList,
  useSubmitCmsPublish,
} from './cms-stage3';

const TASK = { id: 11, siteId: 1, status: 'success', taskType: 'cms-publish', targetType: 'site' };
const EMPTY_PAGE = { list: [], total: 0, page: 1, pageSize: 10 };

beforeEach(() => {
  api.reset();
  api
    .on('GET', '/api/cms/publishing', { ...EMPTY_PAGE, list: [TASK], total: 1 })
    .on('GET', '/api/cms/publishing/artifacts', EMPTY_PAGE)
    .on('GET', '/api/cms/publishing/11', { task: TASK, items: [], artifacts: [] })
    .on('GET', '/api/cms/sites/all', [{ id: 1, name: '主站' }])
    .on('GET', '/api/async-tasks', EMPTY_PAGE)
    .on('GET', '/api/async-tasks/types', [])
    .on('POST', '/api/cms/publishing/submit', { ...TASK, id: 12, status: 'pending' })
    .on('POST', '/api/cms/publishing/11/rebuild', { ...TASK, status: 'pending' });
});

/** 还原 PublishingPage 的挂载情况：任务列表 + 产物列表 + 详情抽屉 + 站点切换器；任务中心在另一页挂着 */
function mountPublishingPage() {
  const qc = createTestQueryClient();
  const hook = renderHook(
    () => ({
      tasks: useCmsPublishingList({ page: 1, pageSize: 10, status: 'terminal' }),
      artifacts: useCmsPublishArtifactList({ page: 1, pageSize: 10 }),
      detail: useCmsPublishingDetail(11),
      sites: useAllCmsSites(),
      myTasks: useAsyncTaskList({ page: 1, pageSize: 10 }),
      taskTypes: useAsyncTaskTypes(),
      submit: useSubmitCmsPublish(),
      action: useCmsPublishingAction(),
    }),
    { wrapper: createWrapper(qc) },
  );
  return { qc, hook };
}

async function settle(hook: ReturnType<typeof mountPublishingPage>['hook']) {
  await waitFor(() => {
    expect(hook.result.current.tasks.isSuccess).toBe(true);
    expect(hook.result.current.artifacts.isSuccess).toBe(true);
    expect(hook.result.current.detail.isSuccess).toBe(true);
    expect(hook.result.current.sites.isSuccess).toBe(true);
    expect(hook.result.current.myTasks.isSuccess).toBe(true);
    expect(hook.result.current.taskTypes.isSuccess).toBe(true);
  });
}

describe('发布任务提交 / 操作的失效面', () => {
  it('rebuild refetches task list, artifacts, detail and the task center list; site lookup and task types stay fresh', async () => {
    const { qc, hook } = mountPublishingPage();
    await settle(hook);

    const fetches = observeFetches(qc);
    api.resetCalls();

    await hook.result.current.action.mutateAsync({ params: { id: 11, action: 'rebuild' } });
    await waitFor(() => {
      expect(hook.result.current.tasks.isFetching).toBe(false);
      expect(hook.result.current.myTasks.isFetching).toBe(false);
    });

    expect(fetches.countOf(cmsPublishingKeys.lists)).toBe(1);
    expect(fetches.countOf(cmsPublishingKeys.artifacts)).toBe(1);
    expect(fetches.countOf(cmsPublishingKeys.detail(11))).toBe(1);
    expect(fetches.countOf(asyncTaskKeys.lists)).toBe(1);

    expect(fetches.countOf(cmsSiteKeys.allSites)).toBe(0);
    expect(isFresh(qc, cmsSiteKeys.allSites)).toBe(true);
    // 任务类型元数据由类型配置单独维护，不随任务状态变化
    expect(fetches.countOf(asyncTaskKeys.types)).toBe(0);
    expect(api.countOf('GET', '/api/async-tasks/types')).toBe(0);

    fetches.stop();
  });

  it('submit also refreshes the task center (a publish task is an async task) — previously only group submit did', async () => {
    const { qc, hook } = mountPublishingPage();
    await settle(hook);

    const fetches = observeFetches(qc);
    api.resetCalls();

    await hook.result.current.submit.mutateAsync({ body: { siteId: 1, targetType: 'site' } });
    await waitFor(() => expect(hook.result.current.myTasks.isFetching).toBe(false));

    expect(fetches.countOf(cmsPublishingKeys.lists)).toBe(1);
    expect(fetches.countOf(asyncTaskKeys.lists)).toBe(1);
    expect(api.countOf('GET', '/api/async-tasks')).toBe(1);

    fetches.stop();
  });
});
