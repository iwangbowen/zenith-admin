/**
 * cms-models 域缓存一致性契约
 *
 * 收敛前模型的新增 / 编辑 / 删除都 `invalidateQueries(cmsModelKeys.all)`，却漏掉了栏目树上的 modelName。
 * 收敛后走 `invalidateAfterCmsModelChange`：模型列表 / 详情 / 下拉源 + 栏目树；模型引用 refs 与站点下拉源不动。
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

import { cmsChannelKeys, useCmsChannelTree } from './cms-channels';
import { cmsModelKeys, useAllCmsModels, useCmsModelList, useDeleteCmsModel, useSaveCmsModel } from './cms-models';
import { cmsSiteKeys, useAllCmsSites } from './cms-sites';

const SITE_ID = 1;
const MODEL = { id: 3, name: '文章', code: 'article', fields: [] };

beforeEach(() => {
  api.reset();
  api
    .on('GET', '/api/cms/models', { list: [MODEL], total: 1, page: 1, pageSize: 10 })
    .on('GET', '/api/cms/models/all', [MODEL])
    .on('GET', '/api/cms/models/3', MODEL)
    .on('GET', '/api/cms/channels/tree', [{ id: 9, modelId: 3, modelName: '文章', name: '新闻' }])
    .on('GET', '/api/cms/sites/all', [{ id: SITE_ID, name: '主站' }])
    .on('PUT', '/api/cms/models/3', { ...MODEL, name: '资讯' })
    .on('DELETE', '/api/cms/models/3', null);
});

function mountModelsPage() {
  const qc = createTestQueryClient();
  const hook = renderHook(
    () => ({
      list: useCmsModelList({ page: 1, pageSize: 10 }),
      lookup: useAllCmsModels(SITE_ID),
      tree: useCmsChannelTree(SITE_ID),
      sites: useAllCmsSites(),
      save: useSaveCmsModel(SITE_ID),
      remove: useDeleteCmsModel(SITE_ID),
    }),
    { wrapper: createWrapper(qc) },
  );
  return { qc, hook };
}

async function settle(hook: ReturnType<typeof mountModelsPage>['hook']) {
  await waitFor(() => {
    expect(hook.result.current.list.isSuccess).toBe(true);
    expect(hook.result.current.lookup.isSuccess).toBe(true);
    expect(hook.result.current.tree.isSuccess).toBe(true);
    expect(hook.result.current.sites.isSuccess).toBe(true);
  });
}

describe('模型写操作波及下拉源与栏目树', () => {
  it('renaming a model refetches list, lookup and the channel tree (modelName), keeps the site lookup fresh', async () => {
    const { qc, hook } = mountModelsPage();
    await settle(hook);

    const fetches = observeFetches(qc);
    api.resetCalls();

    await hook.result.current.save.mutateAsync({ id: 3, values: { name: '资讯' } });
    await waitFor(() => {
      expect(hook.result.current.list.isFetching).toBe(false);
      expect(hook.result.current.tree.isFetching).toBe(false);
    });

    expect(api.urls('PUT')[0]).toBe('/api/cms/models/3?siteId=1');
    expect(fetches.countOf(cmsModelKeys.lists)).toBe(1);
    expect(fetches.countOf(cmsModelKeys.lookup)).toBe(1);
    expect(fetches.countOf(cmsChannelKeys.trees)).toBe(1);
    expect(fetches.countOf(cmsSiteKeys.allSites)).toBe(0);
    expect(isFresh(qc, cmsSiteKeys.allSites)).toBe(true);

    fetches.stop();
  });

  it('deleting a model drops its detail cache and refetches the lookup', async () => {
    const { qc, hook } = mountModelsPage();
    await settle(hook);
    qc.setQueryData(cmsModelKeys.detail(3), MODEL);
    api.resetCalls();

    await hook.result.current.remove.mutateAsync(3);
    await waitFor(() => expect(hook.result.current.lookup.isFetching).toBe(false));

    expect(hasCacheEntry(qc, cmsModelKeys.detail(3))).toBe(false);
    expect(api.countOf('GET', '/api/cms/models/3')).toBe(0);
    expect(api.countOf('GET', '/api/cms/models/all')).toBe(1);
  });
});
