/**
 * cms-channels 域缓存一致性契约
 *
 * 收敛前栏目的每个写操作都 `invalidateQueries(cmsChannelKeys.all)`，合并 / 清空还会追加
 * `cmsContentKeys.all`；但内容列表带 channelName 这一事实在普通改名时反而被漏掉了。
 * 收敛后按 `invalidateAfterCmsChannelChange` 精确失效，断言落在实际请求与 fetching 事件上。
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
  cmsChannelKeys,
  useClearCmsChannel,
  useCmsChannelTree,
  useCmsChannelUsers,
  useDeleteCmsChannel,
  useSaveCmsChannel,
  useSetCmsChannelUsers,
} from './cms-channels';
import { cmsContentKeys, useCmsContentList } from './cms-contents';
import { cmsModelKeys, useAllCmsModels } from './cms-models';
import { cmsSiteKeys, useAllCmsSites } from './cms-sites';

const SITE_ID = 1;
const CHANNEL = { id: 3, siteId: SITE_ID, parentId: 0, name: '新闻', code: 'news', slug: 'news', path: 'news' };

beforeEach(() => {
  api.reset();
  api
    .on('GET', '/api/cms/channels/tree', [CHANNEL])
    .on('GET', '/api/cms/channels/3/users', { userIds: [] })
    .on('GET', '/api/cms/models/all', [{ id: 1, name: '文章' }])
    .on('GET', '/api/cms/sites/all', [{ id: SITE_ID, name: '主站' }])
    .on('GET', '/api/cms/contents', { list: [], total: 0, page: 1, pageSize: 10 })
    .on('PUT', '/api/cms/channels/3', { ...CHANNEL, name: '新闻中心' })
    .on('POST', '/api/cms/channels/3/clear', null)
    .on('PUT', '/api/cms/channels/3/users', null)
    .on('DELETE', '/api/cms/channels/3', null);
});

/** 还原 ChannelsPage 的挂载情况：栏目树 + 模型下拉源 + 站点下拉源；内容列表页在另一个标签里挂着 */
function mountChannelsPage() {
  const qc = createTestQueryClient();
  const hook = renderHook(
    () => ({
      tree: useCmsChannelTree(SITE_ID),
      models: useAllCmsModels(SITE_ID),
      sites: useAllCmsSites(),
      contents: useCmsContentList({ page: 1, pageSize: 10, siteId: SITE_ID }),
      save: useSaveCmsChannel(),
      clear: useClearCmsChannel(),
      remove: useDeleteCmsChannel(),
      setUsers: useSetCmsChannelUsers(),
    }),
    { wrapper: createWrapper(qc) },
  );
  return { qc, hook };
}

async function settle(hook: ReturnType<typeof mountChannelsPage>['hook']) {
  await waitFor(() => {
    expect(hook.result.current.tree.isSuccess).toBe(true);
    expect(hook.result.current.models.isSuccess).toBe(true);
    expect(hook.result.current.sites.isSuccess).toBe(true);
    expect(hook.result.current.contents.isSuccess).toBe(true);
  });
}

describe('useSaveCmsChannel —— 改名波及树与内容列表，不波及下拉源', () => {
  it('refetches the tree and the content list (channelName column) but keeps models / sites fresh', async () => {
    const { qc, hook } = mountChannelsPage();
    await settle(hook);

    const fetches = observeFetches(qc);
    api.resetCalls();

    await hook.result.current.save.mutateAsync({ id: 3, values: { name: '新闻中心' } });
    await waitFor(() => {
      expect(hook.result.current.tree.isFetching).toBe(false);
      expect(hook.result.current.contents.isFetching).toBe(false);
    });

    expect(fetches.countOf(cmsChannelKeys.trees)).toBe(1);
    expect(fetches.countOf(cmsContentKeys.lists)).toBe(1);
    expect(fetches.countOf(cmsModelKeys.lookup)).toBe(0);
    expect(fetches.countOf(cmsSiteKeys.allSites)).toBe(0);
    expect(isFresh(qc, cmsModelKeys.allModels(SITE_ID))).toBe(true);
    expect(api.countOf('GET', '/api/cms/models/all')).toBe(0);
    expect(api.countOf('GET', '/api/cms/sites/all')).toBe(0);

    fetches.stop();
  });
});

describe('useClearCmsChannel —— 只动内容侧', () => {
  it('refetches the content list but not the channel tree', async () => {
    const { qc, hook } = mountChannelsPage();
    await settle(hook);

    const fetches = observeFetches(qc);
    api.resetCalls();

    await hook.result.current.clear.mutateAsync({ params: { id: 3 } });
    await waitFor(() => expect(hook.result.current.contents.isFetching).toBe(false));

    expect(fetches.countOf(cmsContentKeys.lists)).toBe(1);
    // 收敛前：清空栏目会把栏目树也打回源，树结构其实没变
    expect(fetches.countOf(cmsChannelKeys.trees)).toBe(0);
    expect(isFresh(qc, cmsChannelKeys.tree(SITE_ID))).toBe(true);

    fetches.stop();
  });
});

describe('useSetCmsChannelUsers —— 授权名单影响树的可见节点', () => {
  it('refetches the grant list and the tree, leaves the content list untouched', async () => {
    const { qc, hook } = mountChannelsPage();
    await settle(hook);
    const extra = renderHook(() => useCmsChannelUsers(3), { wrapper: createWrapper(qc) });
    await waitFor(() => expect(extra.result.current.isSuccess).toBe(true));

    const fetches = observeFetches(qc);
    api.resetCalls();

    await hook.result.current.setUsers.mutateAsync({ params: { id: 3 }, body: { userIds: [9] } });
    await waitFor(() => expect(hook.result.current.tree.isFetching).toBe(false));

    expect(fetches.countOf(cmsChannelKeys.users(3))).toBe(1);
    expect(fetches.countOf(cmsChannelKeys.trees)).toBe(1);
    expect(fetches.countOf(cmsContentKeys.lists)).toBe(0);
    expect(api.countOf('GET', '/api/cms/contents')).toBe(0);

    fetches.stop();
  });
});

describe('useDeleteCmsChannel', () => {
  it('drops the deleted channel detail / grant caches rather than refetching them', async () => {
    const { qc, hook } = mountChannelsPage();
    await settle(hook);

    qc.setQueryData(cmsChannelKeys.detail(3), CHANNEL);
    qc.setQueryData(cmsChannelKeys.users(3), { userIds: [] });
    api.resetCalls();

    await hook.result.current.remove.mutateAsync({ params: { id: 3 } });
    await waitFor(() => expect(hook.result.current.tree.isFetching).toBe(false));

    expect(hasCacheEntry(qc, cmsChannelKeys.detail(3))).toBe(false);
    expect(hasCacheEntry(qc, cmsChannelKeys.users(3))).toBe(false);
    expect(api.countOf('GET', '/api/cms/channels/3')).toBe(0);
    expect(api.countOf('GET', '/api/cms/channels/tree')).toBe(1);
  });
});
