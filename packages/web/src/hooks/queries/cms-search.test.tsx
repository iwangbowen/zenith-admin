/**
 * cms-search 域缓存一致性契约
 *
 * 收敛前词典、热词、热词分组的全部写操作共用一个失效函数（词典列表 + 热词榜 + 分组列表），
 * 而依赖站点词典「即时生效」的分词预览 / 检索测试反而没被刷新。收敛后拆成两条失效面：
 * `invalidateAfterCmsSearchWordChange`（词典 + 分词 + 检索测试）与 `invalidateAfterCmsHotwordChange`（热词榜 + 分组）。
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
  cmsSearchKeys,
  cmsSearchWordKeys,
  useCmsHotKeywords,
  useCmsHotwordGroups,
  useCmsSearchWordList,
  useCmsSegmentPreview,
  useDeleteCmsHotwordGroup,
  useDeleteCmsSearchWord,
} from './cms-search';

const SITE_ID = 1;
const WORD_PARAMS = { page: 1, pageSize: 10, siteId: SITE_ID };
const HOT_PARAMS = { siteId: SITE_ID };

beforeEach(() => {
  api.reset();
  api
    .on('GET', '/api/cms/search/words', { list: [], total: 0, page: 1, pageSize: 10 })
    .on('GET', '/api/cms/search/segment', { tokens: ['全文', '检索'] })
    .on('GET', '/api/cms/search/hot-keywords', [])
    .on('GET', '/api/cms/search/hotword-groups', [{ id: 2, siteId: SITE_ID, name: '默认' }])
    .on('DELETE', '/api/cms/search/words/9', null)
    .on('DELETE', '/api/cms/search/hotword-groups/2', null);
});

/** 还原 SearchAdminPage 的挂载情况：词典 / 热词 / 分组 / 分词预览四个标签页的查询都挂着（Tabs keepDOM） */
function mountSearchAdminPage() {
  const qc = createTestQueryClient();
  const hook = renderHook(
    () => ({
      words: useCmsSearchWordList(WORD_PARAMS),
      segment: useCmsSegmentPreview(SITE_ID, '全文检索', true),
      hot: useCmsHotKeywords(HOT_PARAMS),
      groups: useCmsHotwordGroups(SITE_ID),
      removeWord: useDeleteCmsSearchWord(),
      removeGroup: useDeleteCmsHotwordGroup(),
    }),
    { wrapper: createWrapper(qc) },
  );
  return { qc, hook };
}

async function settle(hook: ReturnType<typeof mountSearchAdminPage>['hook']) {
  await waitFor(() => {
    expect(hook.result.current.words.isSuccess).toBe(true);
    expect(hook.result.current.segment.isSuccess).toBe(true);
    expect(hook.result.current.hot.isSuccess).toBe(true);
    expect(hook.result.current.groups.isSuccess).toBe(true);
  });
}

describe('词典写操作 vs 热词写操作互不牵连', () => {
  it('deleting a dictionary word refetches the word list and segment preview, not the hot keyword views', async () => {
    const { qc, hook } = mountSearchAdminPage();
    await settle(hook);

    const fetches = observeFetches(qc);
    api.resetCalls();

    await hook.result.current.removeWord.mutateAsync({ params: { id: 9 } });
    await waitFor(() => {
      expect(hook.result.current.words.isFetching).toBe(false);
      expect(hook.result.current.segment.isFetching).toBe(false);
    });

    expect(api.countOf('DELETE', '/api/cms/search/words/9')).toBe(1);
    expect(fetches.countOf(cmsSearchWordKeys.lists)).toBe(1);
    // 词典即时重建，分词结果随之变化——收敛前没有刷新
    expect(fetches.countOf(cmsSearchKeys.segments)).toBe(1);
    // 收敛前：热词榜与分组列表各被多打一次
    expect(fetches.countOf(cmsSearchWordKeys.hotLists)).toBe(0);
    expect(fetches.countOf(cmsSearchWordKeys.groupLists)).toBe(0);
    expect(isFresh(qc, cmsSearchWordKeys.hot(HOT_PARAMS))).toBe(true);
    expect(api.countOf('GET', '/api/cms/search/hot-keywords')).toBe(0);

    fetches.stop();
  });

  it('deleting a hotword group refetches hot keywords and groups, leaves the dictionary alone', async () => {
    const { qc, hook } = mountSearchAdminPage();
    await settle(hook);

    const fetches = observeFetches(qc);
    api.resetCalls();

    await hook.result.current.removeGroup.mutateAsync({ params: { id: 2 } });
    await waitFor(() => {
      expect(hook.result.current.hot.isFetching).toBe(false);
      expect(hook.result.current.groups.isFetching).toBe(false);
    });

    expect(fetches.countOf(cmsSearchWordKeys.hotLists)).toBe(1);
    expect(fetches.countOf(cmsSearchWordKeys.groupLists)).toBe(1);
    expect(fetches.countOf(cmsSearchWordKeys.lists)).toBe(0);
    expect(fetches.countOf(cmsSearchKeys.segments)).toBe(0);
    expect(isFresh(qc, cmsSearchWordKeys.list(WORD_PARAMS))).toBe(true);
    expect(api.countOf('GET', '/api/cms/search/words')).toBe(0);

    fetches.stop();
  });
});
