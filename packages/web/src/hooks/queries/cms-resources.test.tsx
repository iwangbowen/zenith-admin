/**
 * cms-resources 域缓存一致性契约
 *
 * 收敛前 8 个素材 / 文件夹写操作全部 `invalidateQueries(cmsResourceKeys.all)`，把正打开的
 * 引用索引抽屉也打回源。收敛后统一走 `invalidateAfterCmsResourceChange`（列表 + 文件夹计数），
 * 引用索引只在素材删除时移除。
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

import {
  cmsResourceKeys,
  useCmsResourceFolders,
  useCmsResourceList,
  useCmsResourceReferences,
  useDeleteCmsResources,
  useSaveCmsResourceFolder,
  useUpdateCmsResource,
} from './cms-resources';
import { cmsSiteKeys, useAllCmsSites } from './cms-sites';

const SITE_ID = 1;
const LIST_PARAMS = { page: 1, pageSize: 20, siteId: SITE_ID };
const RESOURCE = { id: 5, siteId: SITE_ID, name: 'banner.png', folderId: 2, refCount: 1 };

beforeEach(() => {
  api.reset();
  api
    .on('GET', '/api/cms/resources', { list: [RESOURCE], total: 1, page: 1, pageSize: 20 })
    .on('GET', '/api/cms/resources/folders', [{ id: 2, name: '首页', resourceCount: 1 }])
    .on('GET', '/api/cms/resources/5/references', [{ type: 'content', id: 7, title: '发布稿' }])
    .on('GET', '/api/cms/sites/all', [{ id: SITE_ID, name: '主站' }])
    .on('PUT', '/api/cms/resources/5', { ...RESOURCE, name: 'hero.png' })
    .on('PUT', '/api/cms/resources/folders/2', { id: 2, name: '首页轮播' })
    .on('POST', '/api/cms/resources/delete', null);
});

/** 还原 ResourcesPage 的挂载情况：列表 + 文件夹树 + 站点切换器，引用抽屉已打开 */
function mountResourcesPage() {
  const qc = createTestQueryClient();
  const hook = renderHook(
    () => ({
      list: useCmsResourceList(LIST_PARAMS),
      folders: useCmsResourceFolders(SITE_ID),
      refs: useCmsResourceReferences(5),
      sites: useAllCmsSites(),
      update: useUpdateCmsResource(),
      saveFolder: useSaveCmsResourceFolder(),
      remove: useDeleteCmsResources(),
    }),
    { wrapper: createWrapper(qc) },
  );
  return { qc, hook };
}

async function settle(hook: ReturnType<typeof mountResourcesPage>['hook']) {
  await waitFor(() => {
    expect(hook.result.current.list.isSuccess).toBe(true);
    expect(hook.result.current.folders.isSuccess).toBe(true);
    expect(hook.result.current.refs.isSuccess).toBe(true);
    expect(hook.result.current.sites.isSuccess).toBe(true);
  });
}

describe('素材 / 文件夹写操作只打列表与文件夹计数', () => {
  it('rename refetches list + folders, keeps the open references drawer and the site lookup fresh', async () => {
    const { qc, hook } = mountResourcesPage();
    await settle(hook);

    const fetches = observeFetches(qc);
    api.resetCalls();

    await hook.result.current.update.mutateAsync({ params: { id: 5 }, body: { name: 'hero.png' } });
    await hook.result.current.saveFolder.mutateAsync({ id: 2, values: { name: '首页轮播' } });
    await waitFor(() => {
      expect(hook.result.current.list.isFetching).toBe(false);
      expect(hook.result.current.folders.isFetching).toBe(false);
    });

    expect(fetches.countOf(cmsResourceKeys.lists)).toBe(2);
    expect(fetches.countOf(cmsResourceKeys.foldersAll)).toBe(2);
    // 收敛前：两次写操作各把引用索引打回源一次
    expect(fetches.countOf(cmsResourceKeys.references(5))).toBe(0);
    expect(isFresh(qc, cmsResourceKeys.references(5))).toBe(true);
    expect(api.countOf('GET', '/api/cms/resources/5/references')).toBe(0);
    expect(fetches.countOf(cmsSiteKeys.allSites)).toBe(0);

    fetches.stop();
  });

  it('delete removes the references cache of deleted resources instead of refetching a 404', async () => {
    const { qc, hook } = mountResourcesPage();
    await settle(hook);
    // 抽屉已关闭：有数据、无 observer
    hook.unmount();
    expect(hasCacheEntry(qc, cmsResourceKeys.references(5))).toBe(true);

    const page = renderHook(
      () => ({ list: useCmsResourceList(LIST_PARAMS), remove: useDeleteCmsResources() }),
      { wrapper: createWrapper(qc) },
    );
    await waitFor(() => expect(page.result.current.list.isSuccess).toBe(true));
    api.resetCalls();

    await page.result.current.remove.mutateAsync({ body: { ids: [5] } });
    await waitFor(() => expect(page.result.current.list.isFetching).toBe(false));

    expect(hasCacheEntry(qc, cmsResourceKeys.references(5))).toBe(false);
    expect(api.countOf('GET', '/api/cms/resources/5/references')).toBe(0);
    expect(api.countOf('GET', '/api/cms/resources')).toBe(1);
  });
});
