/**
 * hooks/queries/analytics.ts —— 留存双口径（mode）query key + 事件分析工作台/漏斗 mutation 单测。
 *
 * 覆盖点：
 *  1. analyticsKeys.retention(days, mode) 对不同 mode 产出不同的 query key（保证切换口径触发重新拉取，
 *     而不是复用另一口径的缓存）
 *  2. useAnalyticsRetention 默认 mode='first_seen'，且请求 URL 携带 mode 参数
 *  3. useAnalyticsRetention 显式传入 mode='window_first' 时请求 URL 与 query key 均切换
 *  4. useAnalyticsEventQuery 是 query（非 mutation），POST 到契约路径并透传 body，
 *     未提交时保持 idle，翻页产生不同 query key
 *  5. useAnalyzeFunnel 是 mutation，POST 到契约路径并透传 body（含 conversionWindowHours / 对比轴）
 *
 * 契约调用层会把请求选项作为末位实参传给 request，断言用 expect.anything() 兜住。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { createTestQueryClient, createWrapper } from '@/test-utils/query-harness';

const get = vi.fn();
const post = vi.fn();

vi.mock('@/utils/request', () => ({ request: { get: (...a: unknown[]) => get(...a), post: (...a: unknown[]) => post(...a) } }));

import { analyticsContract } from '@zenith/shared/analytics';
import { analyticsKeys, useAnalyticsRetention, useAnalyticsAcquisition, useAnalyticsDrillUsers, useAnalyticsEventQuery, useAnalyzeFunnel } from './analytics';

const wrapper = () => createWrapper(createTestQueryClient());

beforeEach(() => {
  vi.clearAllMocks();
  get.mockResolvedValue({ code: 0, message: 'success', data: { rows: [] } });
  post.mockResolvedValue({ code: 0, message: 'success', data: { series: [], periods: [], mode: 'first_seen' } });
});

const retentionParams = {
  days: 14,
  mode: 'first_seen' as const,
  periodType: 'day' as const,
  maxPeriods: 8,
  comparison: { type: 'none' as const },
};

describe('analyticsKeys.retention — 全部查询条件纳入 query key', () => {
  it('produces distinct keys for first_seen vs window_first so switching the caliber refetches instead of reusing stale cache', () => {
    const keyFirstSeen = analyticsKeys.retention(retentionParams);
    const keyWindowFirst = analyticsKeys.retention({ ...retentionParams, mode: 'window_first' });
    expect(keyFirstSeen).not.toEqual(keyWindowFirst);
  });

  // 周期粒度、列数、对比轴不进 key 时，切换条件会命中上一份缓存，页面看起来没反应
  it('produces distinct keys for different period types, column counts and comparison axes', () => {
    const base = analyticsKeys.retention(retentionParams);
    expect(base).not.toEqual(analyticsKeys.retention({ ...retentionParams, periodType: 'week' }));
    expect(base).not.toEqual(analyticsKeys.retention({ ...retentionParams, maxPeriods: 12 }));
    expect(base).not.toEqual(analyticsKeys.retention({ ...retentionParams, comparison: { type: 'dimension', dimension: 'browser' } }));
    expect(base).not.toEqual(analyticsKeys.retention({ ...retentionParams, comparison: { type: 'segments', segmentIds: [1] } }));
  });
});

describe('useAnalyticsRetention', () => {
  // 留存改 POST：对比轴是判别联合对象，query string 承载不了
  it('POSTs the full query body to /api/analytics/retention', async () => {
    const { result } = renderHook(() => useAnalyticsRetention(retentionParams), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(post).toHaveBeenCalledWith(analyticsContract.retention.fullPath, retentionParams, expect.anything());
    expect(get).not.toHaveBeenCalled();
  });

  it('passes the segment comparison axis through verbatim', async () => {
    const params = { ...retentionParams, comparison: { type: 'segments' as const, segmentIds: [3, 5] } };
    const { result } = renderHook(() => useAnalyticsRetention(params), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(post).toHaveBeenCalledWith(analyticsContract.retention.fullPath, params, expect.anything());
  });
});

describe('useAnalyticsDrillUsers — 图表下钻', () => {
  const context = {
    type: 'funnel' as const,
    days: 7,
    steps: [{ label: 'A', pagePath: '/' }, { label: 'B', pagePath: '/b' }],
    conversionWindowHours: 72,
    comparison: { type: 'none' as const },
    stepIndex: 1,
    outcome: 'dropped' as const,
  };

  // 未打开抽屉时不应发请求：下钻是按需查询，进入页面就打一发是纯浪费
  it('stays idle when no context is provided', () => {
    renderHook(() => useAnalyticsDrillUsers(null), { wrapper: wrapper() });
    expect(post).not.toHaveBeenCalled();
  });

  it('POSTs the context and pagination to /api/analytics/drill-users', async () => {
    post.mockResolvedValue({ code: 0, message: 'success', data: { list: [], total: 0, page: 1, pageSize: 20, matchedUsers: 0 } });
    const input = { context, page: 1, pageSize: 20 };
    const { result } = renderHook(() => useAnalyticsDrillUsers(input), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(post).toHaveBeenCalledWith(analyticsContract.drillUsers.fullPath, input, expect.anything());
  });
});

describe('useAnalyticsAcquisition — 获客归因', () => {
  it('includes the attribution model and dimension in the request URL', async () => {
    const { result } = renderHook(
      () => useAnalyticsAcquisition({ days: 30, dimension: 'channel', model: 'first_touch' }),
      { wrapper: wrapper() },
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(get).toHaveBeenCalledWith(expect.stringContaining('model=first_touch'), expect.anything());
    expect(get).toHaveBeenCalledWith(expect.stringContaining('dimension=channel'), expect.anything());
  });
});

describe('useAnalyticsEventQuery — 通用事件分析工作台', () => {
  it('POSTs the query body verbatim to /api/analytics/events/query', async () => {
    const body = { groupBy: ['eventName' as const], metric: 'uv' as const, days: 7, page: 2, pageSize: 20 };
    const { result } = renderHook(() => useAnalyticsEventQuery(body), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(post).toHaveBeenCalledWith(analyticsContract.queryEvents.fullPath, body, expect.anything());
  });

  it('stays idle until a query has been submitted, so opening the tab does not fire a request', () => {
    const { result } = renderHook(() => useAnalyticsEventQuery(null), { wrapper: wrapper() });
    expect(result.current.fetchStatus).toBe('idle');
    expect(post).not.toHaveBeenCalled();
  });

  it('gives different pages distinct query keys so paging refetches instead of reusing page 1', async () => {
    const base = { groupBy: ['date' as const], metric: 'events' as const, days: 7, pageSize: 20 };
    const { result: p1 } = renderHook(() => useAnalyticsEventQuery({ ...base, page: 1 }), { wrapper: wrapper() });
    await waitFor(() => expect(p1.current.isSuccess).toBe(true));
    const { result: p2 } = renderHook(() => useAnalyticsEventQuery({ ...base, page: 2 }), { wrapper: wrapper() });
    await waitFor(() => expect(p2.current.isSuccess).toBe(true));
    expect(post).toHaveBeenCalledTimes(2);
    expect(post).toHaveBeenLastCalledWith(analyticsContract.queryEvents.fullPath, { ...base, page: 2 }, expect.anything());
  });
});

describe('useAnalyzeFunnel — 有序转化漏斗 mutation（转化窗口 + 对比轴透传）', () => {
  it('POSTs the full funnel query including conversionWindowHours and the comparison axis', async () => {
    const { result } = renderHook(() => useAnalyzeFunnel(), { wrapper: wrapper() });
    const body = {
      steps: [{ label: '浏览', eventName: 'view' }, { label: '下单', eventName: 'order' }],
      conversionWindowHours: 24,
      comparison: { type: 'segments' as const, segmentIds: [7] },
    };
    await result.current.mutateAsync({ body });
    expect(post).toHaveBeenCalledWith(analyticsContract.funnel.fullPath, body, expect.anything());
  });

  it('passes a dimension breakdown axis through unchanged', async () => {
    const { result } = renderHook(() => useAnalyzeFunnel(), { wrapper: wrapper() });
    const body = {
      steps: [{ label: '浏览', eventName: 'view' }, { label: '下单', eventName: 'order' }],
      conversionWindowHours: 72,
      comparison: { type: 'dimension' as const, dimension: 'channel' as const },
    };
    await result.current.mutateAsync({ body });
    expect(post).toHaveBeenCalledWith(analyticsContract.funnel.fullPath, body, expect.anything());
  });
});
