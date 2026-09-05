import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import type { WikiDoc, WikiOpsStats } from '@zenith/shared/wiki';
import type { SettingsEnvelope, WikiSettings } from '@zenith/shared/settings';
import {
  ApiRecorder,
  createRequestMock,
  createTestQueryClient,
  createWrapper,
} from '@/test-utils/query-harness';

const api = new ApiRecorder();
vi.mock('@/utils/request', () => ({ request: createRequestMock(() => api) }));

import { useWikiDocDetail } from './wiki-docs';
import { useSetGovernanceReview, useWikiGovernanceDocs } from './wiki-governance';
import { useUpdateWikiSettings, useWikiOpsStats, useWikiSettings } from './wiki-stats';

const SETTINGS: WikiSettings = {
  requireApproval: true,
  defaultVisibility: 'public',
  aiSyncEnabled: false,
  aiSyncKbId: null,
  commentsEnabled: true,
  recycleRetentionDays: 30,
  pendingRemindHours: 48,
};
const SAVED_SETTINGS: WikiSettings = {
  ...SETTINGS,
  commentsEnabled: false,
  pendingRemindHours: 24,
};
// 运行时设置的读取信封：生效值 / 上级值 / 覆盖路径 / 版本
function envelope(effective: WikiSettings, version: number): SettingsEnvelope<'wiki'> {
  return { module: 'wiki', scope: 'platform', tenantId: null, version, effective, inherited: SETTINGS, overriddenPaths: [], updatedAt: null };
}
const DOC: WikiDoc = {
  id: 1,
  spaceId: 1,
  parentId: null,
  title: '治理文档',
  summary: null,
  status: 'published',
  rejectReason: null,
  sort: 0,
  isPinned: false,
  viewCount: 0,
  currentVersion: 1,
  revision: 1,
  requireReadReceipt: false,
  commentsEnabled: true,
  ownerId: null,
  ownerName: null,
  expireAt: null,
  reviewCycleDays: null,
  nextReviewAt: null,
  isArchived: false,
  publishedAt: '2026-08-15 10:00:00',
  deletedAt: null,
  tags: [],
  tagIds: [],
  authorName: null,
  createdAt: '2026-08-15 10:00:00',
  updatedAt: '2026-08-15 10:00:00',
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
const GOVERNANCE_PATH = '/api/wiki/governance/docs?page=1&pageSize=10&kind=review-backlog';

beforeEach(() => {
  api.reset();
  api
    .on('GET', '/api/settings/wiki', envelope(SETTINGS, 1))
    .on('PUT', '/api/settings/wiki', envelope(SAVED_SETTINGS, 2))
    .on('GET', '/api/wiki/docs/1', DOC)
    .on('GET', '/api/wiki/stats/ops', OPS)
    .on('GET', GOVERNANCE_PATH, { list: [], total: 0, page: 1, pageSize: 10 })
    .on('POST', '/api/wiki/governance/review-cycle', null);
});

describe('知识中心治理缓存契约', () => {
  it('设置里的评论开关与审核积压阈值变化后刷新所有真实消费者', async () => {
    const qc = createTestQueryClient();
    const { result } = renderHook(
      () => ({
        settings: useWikiSettings(),
        detail: useWikiDocDetail(1),
        ops: useWikiOpsStats(),
        backlog: useWikiGovernanceDocs('review-backlog', { page: 1, pageSize: 10 }),
        update: useUpdateWikiSettings(),
      }),
      { wrapper: createWrapper(qc) },
    );
    await waitFor(() => {
      expect(result.current.settings.isSuccess).toBe(true);
      expect(result.current.detail.isSuccess).toBe(true);
      expect(result.current.ops.isSuccess).toBe(true);
      expect(result.current.backlog.isSuccess).toBe(true);
    });

    api.resetCalls();
    await result.current.update.mutateAsync({ body: { version: 1, data: SAVED_SETTINGS } });
    await waitFor(() => expect(api.countOf('GET', GOVERNANCE_PATH)).toBe(1));

    expect(api.countOf('GET', '/api/wiki/docs/1')).toBe(1);
    expect(api.countOf('GET', '/api/wiki/stats/ops')).toBe(1);
  });

  it('设置或取消复审后同步刷新治理清单与运营统计', async () => {
    const qc = createTestQueryClient();
    const { result } = renderHook(
      () => ({
        ops: useWikiOpsStats(),
        backlog: useWikiGovernanceDocs('review-backlog', { page: 1, pageSize: 10 }),
        review: useSetGovernanceReview(),
      }),
      { wrapper: createWrapper(qc) },
    );
    await waitFor(() => {
      expect(result.current.ops.isSuccess).toBe(true);
      expect(result.current.backlog.isSuccess).toBe(true);
    });

    api.resetCalls();
    await result.current.review.mutateAsync({ body: { ids: [1], reviewCycleDays: null, expireAt: null } });
    await waitFor(() => expect(api.countOf('GET', GOVERNANCE_PATH)).toBe(1));

    expect(api.countOf('GET', '/api/wiki/stats/ops')).toBe(1);
  });
});
