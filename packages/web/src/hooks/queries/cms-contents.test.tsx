/**
 * cms-contents 域缓存一致性契约
 *
 * 收敛前所有内容写操作都 `invalidateQueries(cmsContentKeys.all)`：把版本列表、链接目标回显等
 * 与本次流转无关的查询一并打回源，同时又漏掉了看板统计这类真正被改动的数据。
 * 收敛后按 `invalidateAfterCmsContentChange` 精确失效，断言落在实际请求与 fetching 事件上。
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
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
import {
  CMS_CHANNEL_SAMPLE_CONTENT_QUERY,
  cmsContentKeys,
  useCmsChannelSampleContent,
  useCmsContentAction,
  useCmsContentBatch,
  useCmsContentBatchOps,
  useCmsContentDetail,
  useCmsContentList,
  useCmsContentOpLogs,
  useCmsContentVersions,
  useCmsContentWorkflowContext,
  useCmsContentWorkflowPreview,
  useCmsContentApprovalDetail,
  useDuplicateCmsContent,
} from './cms-contents';
import { cmsDashboardKeys, useCmsDashboardStats } from './cms-stats';
import { cmsTagKeys, useAllCmsTags } from './cms-tags';

const SITE_ID = 1;
const LIST_PARAMS = { page: 1, pageSize: 10, siteId: SITE_ID };
const CONTENT = { id: 7, siteId: SITE_ID, channelId: 3, title: '发布稿', status: 'draft', editorialStatus: 'draft', version: 1 };
const PAGE = { list: [CONTENT], total: 1, page: 1, pageSize: 10 };

beforeEach(() => {
  api.reset();
  api
    .on('GET', '/api/cms/contents', PAGE)
    .on('GET', '/api/cms/contents/7', CONTENT)
    .on('GET', '/api/cms/contents/7/op-logs', [])
    .on('GET', '/api/cms/contents/7/versions', { list: [], page: 1, pageSize: 30, total: 0 })
    .on('GET', '/api/cms/contents/7/workflow', { instance: null, previousInstances: [] })
    .on('GET', '/api/cms/contents/7/approval-detail', CONTENT)
    .on('GET', '/api/cms/channels/tree', [])
    .on('GET', '/api/cms/tags/all', [{ id: 1, name: '头条' }])
    .on('GET', '/api/cms/dashboard/stats', { totals: { published: 0, draft: 1 } })
    .on('POST', '/api/cms/contents/7/publish', { ...CONTENT, status: 'published' })
    .on('POST', '/api/cms/contents/7/duplicate', { ...CONTENT, id: 8 })
    .on('POST', '/api/cms/contents/purge', null)
    .on('POST', '/api/cms/contents/batch-flags', null);
});

/** 还原 ContentsPage 的挂载情况：列表 + 栏目树 + 标签下拉源；看板统计另开一页挂着 */
function mountContentsPage() {
  const qc = createTestQueryClient();
  const hook = renderHook(
    () => ({
      list: useCmsContentList(LIST_PARAMS),
      tree: useCmsChannelTree(SITE_ID),
      tags: useAllCmsTags(SITE_ID),
      dashboard: useCmsDashboardStats(SITE_ID),
      action: useCmsContentAction(),
      batch: useCmsContentBatch(),
      batchOps: useCmsContentBatchOps(),
      duplicate: useDuplicateCmsContent(),
      sample: useCmsChannelSampleContent(),
    }),
    { wrapper: createWrapper(qc) },
  );
  return { qc, hook };
}

async function settle(hook: ReturnType<typeof mountContentsPage>['hook']) {
  await waitFor(() => {
    expect(hook.result.current.list.isSuccess).toBe(true);
    expect(hook.result.current.tree.isSuccess).toBe(true);
    expect(hook.result.current.tags.isSuccess).toBe(true);
    expect(hook.result.current.dashboard.isSuccess).toBe(true);
  });
}

describe('useCmsContentAction —— 状态流转按真实副作用失效', () => {
  it('refetches list / detail / op logs / dashboard but refreshes frozen revision history while leaving tree and tags alone', async () => {
    const { qc, hook } = mountContentsPage();
    await settle(hook);

    // 编辑页同时挂着详情，操作记录与历史版本抽屉已打开
    const extra = renderHook(
      () => ({
        detail: useCmsContentDetail(7), opLogs: useCmsContentOpLogs(7), versions: useCmsContentVersions(7),
        workflow: useCmsContentWorkflowContext(7), previous: useCmsContentWorkflowContext(7, 12),
        approval: useCmsContentApprovalDetail(7, 12),
      }),
      { wrapper: createWrapper(qc) },
    );
    await waitFor(() => {
      expect(extra.result.current.detail.isSuccess).toBe(true);
      expect(extra.result.current.opLogs.isSuccess).toBe(true);
      expect(extra.result.current.versions.isSuccess).toBe(true);
      expect(extra.result.current.workflow.isSuccess).toBe(true);
      expect(extra.result.current.previous.isSuccess).toBe(true);
      expect(extra.result.current.approval.isSuccess).toBe(true);
    });

    const fetches = observeFetches(qc);
    api.resetCalls();

    await hook.result.current.action.mutateAsync({ id: 7, action: 'publish', expectedVersion: 1 });
    await waitFor(() => {
      expect(hook.result.current.list.isFetching).toBe(false);
      expect(hook.result.current.dashboard.isFetching).toBe(false);
    });

    expect(api.countOf('POST', '/api/cms/contents/7/publish')).toBe(1);
    expect(fetches.countOf(cmsContentKeys.lists)).toBe(1);
    expect(fetches.countOf(cmsContentKeys.detail(7))).toBe(1);
    expect(fetches.countOf(cmsContentKeys.opLogs(7))).toBe(1);
    expect(api.countOf('GET', '/api/cms/contents/7/workflow')).toBe(2);
    expect(api.countOf('GET', '/api/cms/contents/7/approval-detail')).toBe(1);
    // 看板 totals / todayPublished / publishTrend 都随发布变化——收敛前根本没失效
    expect(fetches.countOf(cmsDashboardKeys.statsAll)).toBe(1);

    // 发布冻结修订，历史摘要必须回源；栏目树与标签下拉源不含内容状态
    expect(fetches.countOf(cmsContentKeys.versions)).toBe(1);
    expect(isFresh(qc, cmsContentKeys.versionPage(7))).toBe(true);
    expect(fetches.countOf(cmsChannelKeys.trees)).toBe(0);
    expect(fetches.countOf(cmsTagKeys.lookup)).toBe(0);
    expect(api.countOf('GET', '/api/cms/tags/all')).toBe(0);
    expect(api.countOf('GET', '/api/cms/channels/tree')).toBe(0);

    fetches.stop();
  });
});

describe('CMS 业务审批查询', () => {
  it('keeps channel-dependent previews separate and scopes approval data to the selected instance', async () => {
    api.on('POST', '/api/cms/contents/workflow-preview', (call: { body?: unknown }) => ({
      definition: { id: (call.body as { channelId: number }).channelId, name: '内容审核' }, nodes: [],
    }));
    const qc = createTestQueryClient();
    const hook = renderHook(({ channelId, instanceId }) => ({
      preview: useCmsContentWorkflowPreview({ siteId: SITE_ID, channelId }),
      approval: useCmsContentApprovalDetail(7, instanceId),
    }), { initialProps: { channelId: 3, instanceId: 12 }, wrapper: createWrapper(qc) });
    await waitFor(() => expect(hook.result.current.preview.data?.definition?.id).toBe(3));
    expect(api.urls('GET')).toContain('/api/cms/contents/7/approval-detail?instanceId=12');

    hook.rerender({ channelId: 4, instanceId: 13 });
    await waitFor(() => expect(hook.result.current.preview.data?.definition?.id).toBe(4));
    expect(api.urls('GET')).toContain('/api/cms/contents/7/approval-detail?instanceId=13');
    expect(api.urls().some((url) => url.startsWith('/api/workflow/'))).toBe(false);
    expect(api.countOf('GET', '/api/cms/contents/7')).toBe(0);
  });

  it('refreshes a pending list until the asynchronous approval result reaches CMS, then stops polling', async () => {
    vi.useFakeTimers();
    let status = 'pending';
    api.on('GET', '/api/cms/contents', () => ({ ...PAGE, list: [{ ...CONTENT, status: status === 'published' ? 'published' : 'draft', editorialStatus: status === 'pending' ? 'pending' : 'clean' }] }));
    const qc = createTestQueryClient();
    const hook = renderHook(() => useCmsContentList(LIST_PARAMS), { wrapper: createWrapper(qc) });
    try {
      await act(async () => { await vi.advanceTimersByTimeAsync(1); });
      expect(hook.result.current.data?.list[0].editorialStatus).toBe('pending');
      status = 'published';
      await act(async () => { await vi.advanceTimersByTimeAsync(10_000); });
      expect(hook.result.current.data?.list[0].status).toBe('published');
      const callsAfterCompleted = api.countOf('GET', '/api/cms/contents');
      await act(async () => { await vi.advanceTimersByTimeAsync(20_000); });
      expect(api.countOf('GET', '/api/cms/contents')).toBe(callsAfterCompleted);
    } finally {
      hook.unmount();
      qc.clear();
      vi.useRealTimers();
    }
  });
});

describe('useCmsContentBatch —— 彻底删除移除详情缓存', () => {
  it('drops detail / op-log / version caches of purged contents instead of refetching them', async () => {
    const { qc, hook } = mountContentsPage();
    await settle(hook);

    // 编辑页离开后遗留的缓存：有数据、无 observer
    qc.setQueryData(cmsContentKeys.detail(7), CONTENT);
    qc.setQueryData(cmsContentKeys.opLogs(7), []);
    qc.setQueryData(cmsContentKeys.versionList(7), []);
    api.resetCalls();

    await hook.result.current.batch.mutateAsync({ action: 'purge', ids: [7], expectedVersions: { '7': 1 } });
    await waitFor(() => expect(hook.result.current.list.isFetching).toBe(false));

    expect(hasCacheEntry(qc, cmsContentKeys.detail(7))).toBe(false);
    expect(hasCacheEntry(qc, cmsContentKeys.opLogs(7))).toBe(false);
    expect(hasCacheEntry(qc, cmsContentKeys.versionList(7))).toBe(false);
    expect(api.countOf('GET', '/api/cms/contents/7')).toBe(0);
    expect(api.countOf('GET', '/api/cms/contents')).toBe(1);
  });
});

describe('useCmsContentBatchOps / useDuplicateCmsContent', () => {
  it('batch-flags refetches the list and the touched details only', async () => {
    const { qc, hook } = mountContentsPage();
    await settle(hook);
    const extra = renderHook(() => useCmsContentDetail(7), { wrapper: createWrapper(qc) });
    await waitFor(() => expect(extra.result.current.isSuccess).toBe(true));

    const fetches = observeFetches(qc);
    api.resetCalls();

    await hook.result.current.batchOps.mutateAsync({ action: 'batch-flags', body: { ids: [7], expectedVersions: { '7': 1 }, isTop: true } });
    await waitFor(() => expect(hook.result.current.list.isFetching).toBe(false));

    expect(fetches.countOf(cmsContentKeys.lists)).toBe(1);
    expect(fetches.countOf(cmsContentKeys.detail(7))).toBe(1);
    expect(fetches.countOf(cmsChannelKeys.trees)).toBe(0);
    expect(fetches.countOf(cmsTagKeys.lookup)).toBe(0);

    fetches.stop();
  });

  it('duplicate only adds a draft: list and dashboard refetch, the source detail stays fresh', async () => {
    const { qc, hook } = mountContentsPage();
    await settle(hook);
    const extra = renderHook(() => useCmsContentDetail(7), { wrapper: createWrapper(qc) });
    await waitFor(() => expect(extra.result.current.isSuccess).toBe(true));

    const fetches = observeFetches(qc);
    api.resetCalls();

    await hook.result.current.duplicate.mutateAsync({ params: { id: 7 }, body: {} });
    await waitFor(() => expect(hook.result.current.list.isFetching).toBe(false));

    expect(fetches.countOf(cmsContentKeys.lists)).toBe(1);
    expect(fetches.countOf(cmsDashboardKeys.statsAll)).toBe(1);
    expect(fetches.countOf(cmsContentKeys.detail(7))).toBe(0);
    expect(isFresh(qc, cmsContentKeys.detail(7))).toBe(true);

    fetches.stop();
  });
});

describe('useCmsChannelSampleContent —— 一次性取样不进缓存', () => {
  it('issues a single published-content list request without creating a cache entry', async () => {
    const { qc, hook } = mountContentsPage();
    await settle(hook);
    api.resetCalls();

    const query = { siteId: SITE_ID, channelId: 3, ...CMS_CHANNEL_SAMPLE_CONTENT_QUERY };
    const data = await hook.result.current.sample.mutateAsync({ query });

    expect(data.list[0]?.id).toBe(7);
    const url = api.urls('GET')[0] ?? '';
    expect(url.startsWith('/api/cms/contents?')).toBe(true);
    expect(url).toContain('status=published');
    expect(url).toContain('pageSize=1');
    expect(hasCacheEntry(qc, cmsContentKeys.list({ ...query }))).toBe(false);
  });
});
