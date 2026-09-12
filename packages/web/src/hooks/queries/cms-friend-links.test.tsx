/**
 * cms-friend-links 域缓存一致性契约
 *
 * 分组与友链互相引用：分组分页列表带 linkCount，友链列表带 groupName。收敛前分组写操作
 * `invalidateQueries(cmsFriendLinkKeys.all)`；收敛后走 `invalidateAfterCmsFriendLinkGroupChange`
 * （分组列表 + 分组下拉源 + 友链列表），友链写操作由工厂失效并补上分组列表的计数列。
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

import {
  cmsFriendLinkKeys,
  useAllCmsFriendLinkGroups,
  useCmsFriendLinkGroupList,
  useCmsFriendLinkList,
  useDeleteCmsFriendLinkGroup,
  useSaveCmsFriendLink,
} from './cms-friend-links';
import { cmsSiteKeys, useAllCmsSites } from './cms-sites';

const SITE_ID = 1;
const LINK_PARAMS = { page: 1, pageSize: 10, siteId: SITE_ID };
const GROUP_PARAMS = { page: 1, pageSize: 10, siteId: SITE_ID };
const GROUP = { id: 2, siteId: SITE_ID, name: '合作伙伴', code: 'partners', linkCount: 1 };

beforeEach(() => {
  api.reset();
  api
    .on('GET', '/api/cms/friend-links', { list: [{ id: 5, groupId: 2, groupName: '合作伙伴' }], total: 1, page: 1, pageSize: 10 })
    .on('GET', '/api/cms/friend-links/groups', { list: [GROUP], total: 1, page: 1, pageSize: 10 })
    .on('GET', '/api/cms/friend-links/groups/all', [GROUP])
    .on('GET', '/api/cms/sites/all', [{ id: SITE_ID, name: '主站' }])
    .on('DELETE', '/api/cms/friend-links/groups/2', null)
    .on('POST', '/api/cms/friend-links', { id: 6, groupId: 2, groupName: '合作伙伴' });
});

function mountFriendLinksPage() {
  const qc = createTestQueryClient();
  const hook = renderHook(
    () => ({
      links: useCmsFriendLinkList(LINK_PARAMS),
      groups: useCmsFriendLinkGroupList(GROUP_PARAMS),
      groupOptions: useAllCmsFriendLinkGroups(SITE_ID),
      sites: useAllCmsSites(),
      removeGroup: useDeleteCmsFriendLinkGroup(),
      saveLink: useSaveCmsFriendLink(),
    }),
    { wrapper: createWrapper(qc) },
  );
  return { qc, hook };
}

async function settle(hook: ReturnType<typeof mountFriendLinksPage>['hook']) {
  await waitFor(() => {
    expect(hook.result.current.links.isSuccess).toBe(true);
    expect(hook.result.current.groups.isSuccess).toBe(true);
    expect(hook.result.current.groupOptions.isSuccess).toBe(true);
    expect(hook.result.current.sites.isSuccess).toBe(true);
  });
}

describe('分组 ↔ 友链互相失效', () => {
  it('deleting a group refetches group list, group lookup and the link list (groupName), not the site lookup', async () => {
    const { qc, hook } = mountFriendLinksPage();
    await settle(hook);

    const fetches = observeFetches(qc);
    api.resetCalls();

    await hook.result.current.removeGroup.mutateAsync({ params: { id: 2 } });
    await waitFor(() => {
      expect(hook.result.current.links.isFetching).toBe(false);
      expect(hook.result.current.groupOptions.isFetching).toBe(false);
    });

    expect(fetches.countOf(cmsFriendLinkKeys.groups)).toBe(1);
    expect(fetches.countOf(cmsFriendLinkKeys.groupAlls)).toBe(1);
    expect(fetches.countOf(cmsFriendLinkKeys.lists)).toBe(1);
    expect(fetches.countOf(cmsSiteKeys.allSites)).toBe(0);
    expect(isFresh(qc, cmsSiteKeys.allSites)).toBe(true);

    fetches.stop();
  });

  it('creating a link refetches the group list (linkCount) but keeps the group lookup fresh', async () => {
    const { qc, hook } = mountFriendLinksPage();
    await settle(hook);

    const fetches = observeFetches(qc);
    api.resetCalls();

    await hook.result.current.saveLink.mutateAsync({ values: { siteId: SITE_ID, groupId: 2, name: '友站', url: 'https://example.com' } });
    await waitFor(() => expect(hook.result.current.groups.isFetching).toBe(false));

    expect(fetches.countOf(cmsFriendLinkKeys.lists)).toBe(1);
    expect(fetches.countOf(cmsFriendLinkKeys.groups)).toBe(1);
    // 下拉源不含计数，5 分钟长缓存不该被友链增删改打掉
    expect(fetches.countOf(cmsFriendLinkKeys.groupAlls)).toBe(0);
    expect(isFresh(qc, cmsFriendLinkKeys.groupAll(SITE_ID))).toBe(true);
    expect(api.countOf('GET', '/api/cms/friend-links/groups/all')).toBe(0);

    fetches.stop();
  });
});
