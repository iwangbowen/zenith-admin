/**
 * cms 站点域与 payment-contracts 域的失效粒度契约
 *
 * 两个域收敛前都用 `xxxKeys.all` 广播，把与本次改动无因果关系、且带长 staleTime
 * 的下拉源/元数据一并打回源：
 *  - `cmsSiteKeys.all` 覆盖主题元数据（themes / themeTemplates / themeSettingsSchema，
 *    均为 `LOOKUP_STALE_TIME` 5 分钟）与站点下拉源 `allSites`
 *  - `paymentContractKeys.all` 覆盖扣款计划下拉源 `planOptions`
 *
 * 断言落在实际请求上：`.all` 是这些键的前缀，只 spy invalidateQueries 无法证伪。
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

import { cmsSiteKeys, useAllCmsSites, useCmsThemeTemplates, useEnableSiteAnalytics, useSetCmsSiteUsers } from './cms';
import {
  paymentContractKeys,
  useAllDeductPlans,
  usePaymentContractList,
  useTerminatePaymentContract,
  useSaveDeductPlan,
} from './payment-contracts';

const CONTRACT_PARAMS = { applicationId: 1, page: 1, pageSize: 10 };

beforeEach(() => {
  api.reset();
  api
    // cms
    .on('GET', '/api/cms/sites/all', [{ id: 1, name: '主站' }])
    .on('GET', /\/api\/cms\/sites\/themes\/default\/templates/, { list: [], detail: [] })
    .on('POST', '/api/cms/sites/1/enable-analytics', { siteKey: 'k', created: true })
    .on('PUT', '/api/cms/sites/1/users', null)
    // payment contracts
    .on('GET', '/api/payment/contracts', { list: [], total: 0, page: 1, pageSize: 10 })
    .on('GET', '/api/payment/deduct-plans/all', [{ id: 7, name: '月付' }])
    .on('POST', '/api/payment/contracts/3/terminate', { id: 3, status: 'terminated' })
    .on('PUT', '/api/payment/deduct-plans/7', { id: 7, name: '月付（改）' });
});

describe('cms 主题元数据与站点下拉源不被站点级动作打回源', () => {
  it('keeps theme templates cached when analytics is enabled on a site', async () => {
    const qc = createTestQueryClient();
    const hook = renderHook(
      () => ({
        sites: useAllCmsSites(),
        templates: useCmsThemeTemplates('default', 1),
        enable: useEnableSiteAnalytics(),
        setUsers: useSetCmsSiteUsers(),
      }),
      { wrapper: createWrapper(qc) },
    );
    await waitFor(() => {
      expect(hook.result.current.sites.isSuccess).toBe(true);
      expect(hook.result.current.templates.isSuccess).toBe(true);
    });

    const fetches = observeFetches(qc);
    api.resetCalls();

    await hook.result.current.enable.mutateAsync(1);
    await waitFor(() => expect(hook.result.current.sites.isFetching).toBe(false));

    // 开通统计会在站点上写入 siteKey：站点下拉源该刷新，主题元数据不该被波及
    expect(fetches.countOf(['cms-sites', 'themes'])).toBe(0);
    expect(api.countOf('GET', /themes\/default\/templates/)).toBe(0);

    fetches.stop();
  });

  it('does not touch site lookups when only the site user grant changed', async () => {
    const qc = createTestQueryClient();
    const hook = renderHook(
      () => ({
        sites: useAllCmsSites(),
        templates: useCmsThemeTemplates('default', 1),
        setUsers: useSetCmsSiteUsers(),
      }),
      { wrapper: createWrapper(qc) },
    );
    await waitFor(() => {
      expect(hook.result.current.sites.isSuccess).toBe(true);
      expect(hook.result.current.templates.isSuccess).toBe(true);
    });

    api.resetCalls();
    await hook.result.current.setUsers.mutateAsync({ siteId: 1, userIds: [9] });
    await waitFor(() => expect(hook.result.current.setUsers.isSuccess).toBe(true));

    // 授权名单自成一份查询，不出现在站点列表/下拉源/主题元数据里
    expect(api.countOf('GET', '/api/cms/sites/all')).toBe(0);
    expect(api.countOf('GET', /themes\/default\/templates/)).toBe(0);
    expect(isFresh(qc, cmsSiteKeys.allSites)).toBe(true);
  });
});

describe('payment-contracts 扣款计划下拉源与协议状态互不牵连', () => {
  it('keeps the deduct-plan lookup fresh when a contract is terminated', async () => {
    const qc = createTestQueryClient();
    const hook = renderHook(
      () => ({
        contracts: usePaymentContractList(CONTRACT_PARAMS),
        plans: useAllDeductPlans(),
        terminate: useTerminatePaymentContract(),
      }),
      { wrapper: createWrapper(qc) },
    );
    await waitFor(() => {
      expect(hook.result.current.contracts.isSuccess).toBe(true);
      expect(hook.result.current.plans.isSuccess).toBe(true);
    });

    const fetches = observeFetches(qc);
    api.resetCalls();

    await hook.result.current.terminate.mutateAsync({ params: { id: 3 }, query: { applicationId: 1 } });
    await waitFor(() => expect(api.countOf('GET', '/api/payment/contracts')).toBe(1));

    expect(fetches.countOf(paymentContractKeys.planOptions)).toBe(0);
    expect(api.countOf('GET', '/api/payment/deduct-plans/all')).toBe(0);
    expect(isFresh(qc, paymentContractKeys.planOptions)).toBe(true);

    fetches.stop();
  });

  it('still refreshes the contract list when a plan is renamed, because the list renders planName', async () => {
    const qc = createTestQueryClient();
    const hook = renderHook(
      () => ({
        contracts: usePaymentContractList(CONTRACT_PARAMS),
        plans: useAllDeductPlans(),
        updatePlan: useSaveDeductPlan(),
      }),
      { wrapper: createWrapper(qc) },
    );
    await waitFor(() => {
      expect(hook.result.current.contracts.isSuccess).toBe(true);
      expect(hook.result.current.plans.isSuccess).toBe(true);
    });

    api.resetCalls();
    await hook.result.current.updatePlan.mutateAsync({ id: 7, values: { name: '月付（改）' } });

    // 协议列表渲染 planName 派生列，改名后必须回源，否则显示旧名称
    await waitFor(() => {
      expect(api.countOf('GET', '/api/payment/contracts')).toBe(1);
      expect(api.countOf('GET', '/api/payment/deduct-plans/all')).toBe(1);
    });
  });
});
