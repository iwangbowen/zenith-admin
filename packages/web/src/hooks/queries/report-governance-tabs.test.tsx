/**
 * report-sla / report-query-capacity 域缓存一致性契约
 *
 * 两个治理页签都把互不相干的查询挂在同一屏：SLA 页是规则 + 违规，容量页是配额 / 用量 + 成本日志 / 统计 / 趋势。
 * 收窄前任何写操作整域失效；现在违规流转不碰规则、配额写操作不碰成本流水。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
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

import { reportSlaKeys, useReportSlaRuleList, useReportSlaViolationList, useSaveReportSlaRule, useUpdateReportSlaViolation } from './report-sla';
import {
  reportQueryCapacityKeys,
  useReportQueryCostLogs,
  useReportQueryCostStats,
  useReportQueryCostTrend,
  useReportQueryQuotaList,
  useReportQueryQuotaUsage,
  useResetReportQueryQuota,
  useSaveReportQueryQuota,
} from './report-query-capacity';

const PAGE = { page: 1, pageSize: 10 };
const EMPTY_PAGE = { list: [], total: 0, page: 1, pageSize: 10 };

beforeEach(() => {
  api.reset();
  api
    .on('GET', '/api/report/sla/rules', EMPTY_PAGE)
    .on('GET', '/api/report/sla/violations', EMPTY_PAGE)
    .on('POST', '/api/report/sla/violations/4/status', { id: 4, ruleId: 1, status: 'resolved' })
    .on('PUT', '/api/report/sla/rules/1', { id: 1, name: '新鲜度' })
    .on('GET', '/api/report/query-capacity/quotas', EMPTY_PAGE)
    .on('GET', '/api/report/query-capacity/quotas/1/usage', { queries: 0 })
    .on('GET', '/api/report/query-capacity/cost-logs', EMPTY_PAGE)
    .on('GET', '/api/report/query-capacity/cost-stats', { totalCost: 0 })
    .on('GET', '/api/report/query-capacity/cost-trend', [])
    .on('POST', '/api/report/query-capacity/quotas/1/reset', null)
    .on('PUT', '/api/report/query-capacity/quotas/1', { id: 1, scope: 'tenant' });
});

describe('report-sla', () => {
  function mountSlaTab() {
    const qc = createTestQueryClient();
    const hook = renderHook(
      () => ({
        rules: useReportSlaRuleList(PAGE),
        violations: useReportSlaViolationList(PAGE),
        save: useSaveReportSlaRule(),
        violation: useUpdateReportSlaViolation(),
      }),
      { wrapper: createWrapper(qc) },
    );
    return { qc, ...hook };
  }

  it('违规确认 / 解决只回源违规列表，规则列表保持新鲜', async () => {
    const { qc, result } = mountSlaTab();
    await waitFor(() => {
      expect(result.current.rules.isSuccess).toBe(true);
      expect(result.current.violations.isSuccess).toBe(true);
    });

    const fetches = observeFetches(qc);
    await result.current.violation.mutateAsync({ params: { id: 4 }, body: { status: 'resolved' } });
    await waitFor(() => expect(fetches.countOf(reportSlaKeys.violationLists)).toBe(1));

    expect(fetches.countOf(reportSlaKeys.lists)).toBe(0);
    expect(isFresh(qc, reportSlaKeys.list(PAGE))).toBe(true);
    fetches.stop();
  });

  it('编辑规则只回源规则列表与该规则详情，违规记录是历史观测不动', async () => {
    const { qc, result } = mountSlaTab();
    await waitFor(() => {
      expect(result.current.rules.isSuccess).toBe(true);
      expect(result.current.violations.isSuccess).toBe(true);
    });

    const fetches = observeFetches(qc);
    await result.current.save.mutateAsync({ id: 1, values: { name: '新鲜度' } });
    await waitFor(() => expect(fetches.countOf(reportSlaKeys.lists)).toBe(1));

    expect(fetches.countOf(reportSlaKeys.violationLists)).toBe(0);
    expect(isFresh(qc, reportSlaKeys.violations(PAGE))).toBe(true);
    fetches.stop();
  });
});

describe('report-query-capacity', () => {
  function mountCapacityTab() {
    const qc = createTestQueryClient();
    const hook = renderHook(
      () => ({
        quotas: useReportQueryQuotaList(PAGE),
        usage: useReportQueryQuotaUsage(1),
        costLogs: useReportQueryCostLogs(PAGE),
        costStats: useReportQueryCostStats({}),
        costTrend: useReportQueryCostTrend({ bucket: 'day' }),
        reset: useResetReportQueryQuota(),
        save: useSaveReportQueryQuota(),
      }),
      { wrapper: createWrapper(qc) },
    );
    return { qc, ...hook };
  }

  async function settled(result: ReturnType<typeof mountCapacityTab>['result']) {
    await waitFor(() => {
      expect(result.current.quotas.isSuccess).toBe(true);
      expect(result.current.usage.isSuccess).toBe(true);
      expect(result.current.costLogs.isSuccess).toBe(true);
      expect(result.current.costStats.isSuccess).toBe(true);
      expect(result.current.costTrend.isSuccess).toBe(true);
    });
  }

  it('重置用量只回源该配额的用量，配额列表与成本流水保持新鲜', async () => {
    const { qc, result } = mountCapacityTab();
    await settled(result);

    const fetches = observeFetches(qc);
    api.resetCalls();
    await result.current.reset.mutateAsync({ params: { id: 1 }, body: {} });
    await waitFor(() => expect(api.countOf('GET', '/api/report/query-capacity/quotas/1/usage')).toBe(1));

    expect(fetches.countOf(reportQueryCapacityKeys.lists)).toBe(0);
    expect(isFresh(qc, reportQueryCapacityKeys.list(PAGE))).toBe(true);
    expect(isFresh(qc, reportQueryCapacityKeys.costLogs(PAGE))).toBe(true);
    expect(isFresh(qc, reportQueryCapacityKeys.costStats({}))).toBe(true);
    expect(isFresh(qc, reportQueryCapacityKeys.costTrend({ bucket: 'day' }))).toBe(true);
    expect(api.countOf('GET')).toBe(1);
    fetches.stop();
  });

  it('编辑配额回源列表与该配额用量（用量响应携带上限），成本流水保持新鲜', async () => {
    const { qc, result } = mountCapacityTab();
    await settled(result);

    const fetches = observeFetches(qc);
    api.resetCalls();
    await result.current.save.mutateAsync({ id: 1, values: { dailyQueryLimit: 2000 } });
    await waitFor(() => expect(fetches.countOf(reportQueryCapacityKeys.lists)).toBe(1));

    expect(api.countOf('GET', '/api/report/query-capacity/quotas/1/usage')).toBe(1);
    expect(isFresh(qc, reportQueryCapacityKeys.costLogs(PAGE))).toBe(true);
    expect(isFresh(qc, reportQueryCapacityKeys.costStats({}))).toBe(true);
    expect(api.countOf('GET', '/api/report/query-capacity/cost-logs')).toBe(0);
    fetches.stop();
  });
});
