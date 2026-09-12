import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import type { WikiDoc, WikiOpsStats, WikiStatsOverview } from '@zenith/shared/wiki';
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
  useMoveWikiDoc,
  useMyProcessedReviews,
  useReviewWikiDoc,
  useSubmitWikiDoc,
  useUpdateWikiDoc,
  useWikiDocDetail,
  useWikiDocReviewRecords,
  useWikiDocTree,
  useWikiDocVersions,
  wikiDocKeys,
  wikiDocTreeKeys,
  wikiDocVersionKeys,
  wikiReviewRecordKeys,
} from './wiki-docs';
import { useWikiOpsStats, useWikiStatsOverview } from './wiki-stats';

const PROCESSED_PARAMS = { page: 1, pageSize: 10 };
const DOC: WikiDoc = {
  id: 1,
  spaceId: 1,
  parentId: null,
  title: '审核文档',
  summary: null,
  status: 'pending',
  rejectReason: null,
  sort: 0,
  isPinned: false,
  viewCount: 0,
  currentVersion: 1,
  revision: 1,
  requireReadReceipt: false,
  ownerId: null,
  ownerName: null,
  expireAt: null,
  reviewCycleDays: null,
  nextReviewAt: null,
  isArchived: false,
  publishedAt: null,
  deletedAt: null,
  tags: [],
  tagIds: [],
  authorName: null,
  createdAt: '2026-08-15 10:00:00',
  updatedAt: '2026-08-15 10:00:00',
};
const OVERVIEW: WikiStatsOverview = {
  spaceCount: 1,
  docCount: 1,
  publishedCount: 0,
  pendingCount: 1,
  commentCount: 0,
  weekNewDocs: 1,
  weekViews: 0,
};
const OPS: WikiOpsStats = {
  createdTrend: [],
  spaceDistribution: [],
  searchCount30d: 0,
  noResultCount30d: 0,
  approvedCount30d: 0,
  rejectedCount30d: 0,
  pendingBacklog: 0,
  expiredCount: 0,
  reviewDueCount: 0,
  noOwnerCount: 0,
  archivedCount: 0,
};

beforeEach(() => {
  api.reset();
  api
    .on('GET', '/api/wiki/docs/1/review-records', [])
    .on('GET', '/api/wiki/docs/reviews/processed?page=1&pageSize=10', {
      list: [],
      total: 0,
      page: 1,
      pageSize: 10,
    })
    .on('GET', '/api/wiki/stats/overview', OVERVIEW)
    .on('GET', '/api/wiki/stats/ops', OPS)
    .on('GET', '/api/wiki/docs/tree?spaceId=1', [])
    .on('GET', '/api/wiki/docs/1', DOC)
    .on('GET', '/api/wiki/docs/1/versions', { list: [], total: 0, page: 1, pageSize: 10 })
    .on('GET', '/api/wiki/docs/2/versions', { list: [], total: 0, page: 1, pageSize: 10 })
    .on('PUT', '/api/wiki/docs/1', { ...DOC, currentVersion: 2, revision: 2 })
    .on('POST', '/api/wiki/docs/1/move', DOC)
    .on('POST', '/api/wiki/docs/1/review', { ...DOC, status: 'published' })
    .on('POST', '/api/wiki/docs/1/submit', DOC);
});

describe('知识中心审核缓存契约', () => {
  it('审核后同时刷新文档时间线与已处理列表', async () => {
    const qc = createTestQueryClient();
    const { result } = renderHook(
      () => ({
        timeline: useWikiDocReviewRecords(1),
        processed: useMyProcessedReviews(PROCESSED_PARAMS),
        overview: useWikiStatsOverview(),
        ops: useWikiOpsStats(),
        review: useReviewWikiDoc(),
      }),
      { wrapper: createWrapper(qc) },
    );
    await waitFor(() => {
      expect(result.current.timeline.isSuccess).toBe(true);
      expect(result.current.processed.isSuccess).toBe(true);
      expect(result.current.overview.isSuccess).toBe(true);
      expect(result.current.ops.isSuccess).toBe(true);
    });

    const fetches = observeFetches(qc);
    api.resetCalls();
    await result.current.review.mutateAsync({ params: { id: 1 }, body: { action: 'approve' } });
    await waitFor(() => expect(fetches.countOf(wikiReviewRecordKeys.processedLists)).toBe(1));

    expect(fetches.countOf(wikiReviewRecordKeys.of(1))).toBe(1);
    expect(api.countOf('GET', '/api/wiki/docs/1/review-records')).toBe(1);
    expect(api.countOf('GET', '/api/wiki/docs/reviews/processed?page=1&pageSize=10')).toBe(1);
    expect(api.countOf('GET', '/api/wiki/stats/overview')).toBe(1);
    expect(api.countOf('GET', '/api/wiki/stats/ops')).toBe(1);
    fetches.stop();
  });

  it('提交只刷新该文档时间线，不刷新与之无关的已处理列表', async () => {
    const qc = createTestQueryClient();
    const { result } = renderHook(
      () => ({
        timeline: useWikiDocReviewRecords(1),
        processed: useMyProcessedReviews(PROCESSED_PARAMS),
        overview: useWikiStatsOverview(),
        ops: useWikiOpsStats(),
        submit: useSubmitWikiDoc(),
      }),
      { wrapper: createWrapper(qc) },
    );
    await waitFor(() => {
      expect(result.current.timeline.isSuccess).toBe(true);
      expect(result.current.processed.isSuccess).toBe(true);
      expect(result.current.overview.isSuccess).toBe(true);
      expect(result.current.ops.isSuccess).toBe(true);
    });

    const fetches = observeFetches(qc);
    api.resetCalls();
    await result.current.submit.mutateAsync({ params: { id: 1 } });
    await waitFor(() => expect(fetches.countOf(wikiReviewRecordKeys.of(1))).toBe(1));

    expect(fetches.countOf(wikiReviewRecordKeys.processedLists)).toBe(0);
    expect(api.countOf('GET', '/api/wiki/docs/reviews/processed?page=1&pageSize=10')).toBe(0);
    expect(api.countOf('GET', '/api/wiki/stats/overview')).toBe(1);
    expect(api.countOf('GET', '/api/wiki/stats/ops')).toBe(1);
    fetches.stop();
  });

  it('移动后刷新所属空间目录树与文档详情', async () => {
    const qc = createTestQueryClient();
    const { result } = renderHook(
      () => ({
        tree: useWikiDocTree(1),
        detail: useWikiDocDetail(1),
        move: useMoveWikiDoc(),
      }),
      { wrapper: createWrapper(qc) },
    );
    await waitFor(() => {
      expect(result.current.tree.isSuccess).toBe(true);
      expect(result.current.detail.isSuccess).toBe(true);
    });

    const fetches = observeFetches(qc);
    api.resetCalls();
    await result.current.move.mutateAsync({ params: { id: 1 }, body: { parentId: null, index: 0 } });
    await waitFor(() => expect(fetches.countOf(wikiDocTreeKeys.of(1))).toBe(1));

    expect(fetches.countOf(wikiDocKeys.detail(1))).toBe(1);
    expect(api.countOf('GET', '/api/wiki/docs/tree?spaceId=1')).toBe(1);
    expect(api.countOf('GET', '/api/wiki/docs/1')).toBe(1);
    fetches.stop();
  });

  it('保存正文产生新版本：只回源该文档的版本历史，其它文档的版本列表保持新鲜', async () => {
    const qc = createTestQueryClient();
    const { result } = renderHook(
      () => ({
        versions1: useWikiDocVersions(1, PROCESSED_PARAMS),
        versions2: useWikiDocVersions(2, PROCESSED_PARAMS),
        update: useUpdateWikiDoc(),
      }),
      { wrapper: createWrapper(qc) },
    );
    await waitFor(() => {
      expect(result.current.versions1.isSuccess).toBe(true);
      expect(result.current.versions2.isSuccess).toBe(true);
    });

    const fetches = observeFetches(qc);
    api.resetCalls();
    await result.current.update.mutateAsync({ params: { id: 1 }, body: { title: '审核文档', revision: 1 } });
    // listOf 对 params 段做部分匹配（分页 query 不参与），用实际请求断言回源
    await waitFor(() => expect(api.countOf('GET', '/api/wiki/docs/1/versions')).toBe(1));

    expect(fetches.countOf(wikiDocVersionKeys.lists)).toBe(1);
    expect(api.countOf('GET', '/api/wiki/docs/2/versions')).toBe(0);
    expect(isFresh(qc, wikiDocVersionKeys.list(2, PROCESSED_PARAMS))).toBe(true);
    fetches.stop();
  });
});
