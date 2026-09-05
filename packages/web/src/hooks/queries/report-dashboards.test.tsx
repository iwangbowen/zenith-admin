/**
 * report-dashboards 域缓存一致性契约（S10 消除空转）
 *
 * 该域此前有 4 处「先 `.all` 再补具体键」的空转：`.all` 是那些具体键的前缀，
 * 后补的调用完全不产生额外效果，等于只有广播生效。
 *
 * 更重要的是本域最贵的缓存 —— `dashboardData`（一屏可能扇出数十个数据集查询）
 * 也挂在同一根下，于是「收藏一个看板」这种纯标记操作会把整屏图表全部重跑。
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
  reportDashboardKeys,
  useCloneReportDashboard,
  useDeleteReportDashboard,
  useReportDashboardList,
  useToggleReportDashboardFavorite,
} from './report-dashboards';

const LIST_PARAMS = { page: 1, pageSize: 10 };
const DASHBOARD = { id: 1, name: '经营看板', lifecycleStatus: 'published' };

/** 模拟一屏图表的取数缓存：本域最贵的缓存条目 */
const DATA_KEY = reportDashboardKeys.dashboardData(1, 'auto', { filters: {}, limit: 1000 });

beforeEach(() => {
  api.reset();
  api
    .on('GET', '/api/report/dashboards', { list: [DASHBOARD], total: 1, page: 1, pageSize: 10 })
    .on('POST', '/api/report/dashboards/1/favorite', { favorited: true })
    .on('POST', '/api/report/dashboards/1/clone', { ...DASHBOARD, id: 2 })
    .on('DELETE', '/api/report/dashboards/1', null);
});

describe('useToggleReportDashboardFavorite', () => {
  it('refreshes only the list, leaving the expensive widget data cache intact', async () => {
    const qc = createTestQueryClient();
    const { result } = renderHook(
      () => ({ list: useReportDashboardList(LIST_PARAMS), favorite: useToggleReportDashboardFavorite() }),
      { wrapper: createWrapper(qc) },
    );
    await waitFor(() => expect(result.current.list.isSuccess).toBe(true));

    qc.setQueryData(DATA_KEY, { widgets: {} });
    qc.setQueryData(reportDashboardKeys.detail(1, 'auto'), DASHBOARD);

    const fetches = observeFetches(qc);
    await result.current.favorite.mutateAsync({ params: { id: 1 } });
    await waitFor(() => expect(fetches.countOf(reportDashboardKeys.lists)).toBe(1));

    // 收藏只是列表标记：图表取数与详情都不应被牵连
    expect(isFresh(qc, DATA_KEY)).toBe(true);
    expect(isFresh(qc, reportDashboardKeys.detail(1, 'auto'))).toBe(true);
    expect(fetches.countOf(reportDashboardKeys.dataOf(1))).toBe(0);

    fetches.stop();
  });
});

describe('useCloneReportDashboard', () => {
  it('only refreshes the list, since cloning does not alter the source dashboard', async () => {
    const qc = createTestQueryClient();
    const { result } = renderHook(
      () => ({ list: useReportDashboardList(LIST_PARAMS), clone: useCloneReportDashboard() }),
      { wrapper: createWrapper(qc) },
    );
    await waitFor(() => expect(result.current.list.isSuccess).toBe(true));

    qc.setQueryData(DATA_KEY, { widgets: {} });

    await result.current.clone.mutateAsync({ params: { id: 1 }, body: { name: '副本' } });
    await waitFor(() => expect(result.current.list.isFetching).toBe(false));

    expect(isFresh(qc, DATA_KEY)).toBe(true);
  });
});

describe('useDeleteReportDashboard', () => {
  it('drops the deleted dashboard detail, data, versions and shares caches', async () => {
    const qc = createTestQueryClient();
    const { result } = renderHook(
      () => ({ list: useReportDashboardList(LIST_PARAMS), remove: useDeleteReportDashboard() }),
      { wrapper: createWrapper(qc) },
    );
    await waitFor(() => expect(result.current.list.isSuccess).toBe(true));

    qc.setQueryData(reportDashboardKeys.detail(1, 'auto'), DASHBOARD);
    qc.setQueryData(reportDashboardKeys.detail(1, 'draft'), DASHBOARD);
    qc.setQueryData(DATA_KEY, { widgets: {} });
    qc.setQueryData(reportDashboardKeys.versions(1), []);
    qc.setQueryData(reportDashboardKeys.shares(1), []);

    await result.current.remove.mutateAsync({ params: { id: 1 } });
    await waitFor(() => expect(result.current.list.isFetching).toBe(false));

    // detailOf 前缀一次性覆盖 auto / draft / published
    expect(hasCacheEntry(qc, reportDashboardKeys.detail(1, 'auto'))).toBe(false);
    expect(hasCacheEntry(qc, reportDashboardKeys.detail(1, 'draft'))).toBe(false);
    expect(hasCacheEntry(qc, DATA_KEY)).toBe(false);
    expect(hasCacheEntry(qc, reportDashboardKeys.versions(1))).toBe(false);
    expect(hasCacheEntry(qc, reportDashboardKeys.shares(1))).toBe(false);
  });
});
