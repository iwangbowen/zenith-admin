/**
 * report-dashboards 域缓存一致性契约。
 *
 * 按操作的实际影响精确失效；收藏、克隆不影响源看板的 `dashboardData`，
 * 避免触发整屏图表背后的数据集查询。删除则移除该看板详情、数据、版本与分享缓存。
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { ReportWidget } from '@zenith/shared/report';
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
  useDeleteReportDashboardShare,
  useReportDashboardWidgetData,
  useReportDashboardList,
  useReportDashboardShares,
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
    .on('DELETE', '/api/report/dashboards/1', null)
    .on('GET', '/api/report/dashboards/1/shares', [])
    .on('GET', '/api/report/dashboards/2/shares', [])
    .on('DELETE', '/api/report/dashboards/shares/9', null)
    .on('POST', /\/api\/report\/dashboards\/1\/data/, {
      metric: {
        data: {
          columns: ['value'],
          fields: [{ name: 'value', label: '销售净额', type: 'number' }],
          rows: [{ value: 36000.75, formattedValue: '36,000.75', unit: '元' }],
          total: 1,
        },
        error: null,
        durationMs: 3,
        cacheHit: false,
      },
    });
});

describe('useReportDashboardWidgetData', () => {
  it('returns metric-backed KPI data even when the widget has no dataset id', async () => {
    const qc = createTestQueryClient();
    const widget = { i: 'metric', type: 'kpi', title: '销售净额', metricId: 2, options: {} } as ReportWidget;
    const { result } = renderHook(
      () => useReportDashboardWidgetData(1, [widget], {}),
      { wrapper: createWrapper(qc) },
    );

    await waitFor(() => expect(result.current.query.isSuccess).toBe(true));
    expect(result.current.get(widget).data?.rows[0]).toMatchObject({ value: 36000.75, unit: '元' });
  });
});

describe('useDeleteReportDashboardShare', () => {
  it('删除分享链接：dashboardId 只作为失效上下文，不进入请求；只回源该看板的分享列表', async () => {
    const qc = createTestQueryClient();
    const { result } = renderHook(
      () => ({ shares1: useReportDashboardShares(1), shares2: useReportDashboardShares(2), remove: useDeleteReportDashboardShare() }),
      { wrapper: createWrapper(qc) },
    );
    await waitFor(() => {
      expect(result.current.shares1.isSuccess).toBe(true);
      expect(result.current.shares2.isSuccess).toBe(true);
    });

    const fetches = observeFetches(qc);
    api.resetCalls();
    await result.current.remove.mutateAsync({ params: { shareId: 9 }, dashboardId: 1 });
    await waitFor(() => expect(fetches.countOf(reportDashboardKeys.shares(1))).toBe(1));

    const deleteCall = api.calls.find((call) => call.method === 'DELETE');
    expect(deleteCall?.url).toBe('/api/report/dashboards/shares/9');
    expect(deleteCall?.body).toBeUndefined();
    expect(fetches.countOf(reportDashboardKeys.shares(2))).toBe(0);
    expect(isFresh(qc, reportDashboardKeys.shares(2))).toBe(true);
    fetches.stop();
  });
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
