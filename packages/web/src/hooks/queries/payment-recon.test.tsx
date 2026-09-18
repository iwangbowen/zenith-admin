import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { ApiRecorder, createRequestMock, createTestQueryClient, createWrapper } from '@/test-utils/query-harness';
import { paymentReconContract } from '@zenith/shared/payment';
import { useHandlePaymentReconCase, usePaymentChannelAccounts, usePaymentReconCase, usePaymentReconCases, usePaymentReconRuns, usePaymentReconSummary, usePaymentStatements, useSubmitPaymentStatement } from './payment-recon';

const api = new ApiRecorder();
vi.mock('@/utils/request', () => ({ request: createRequestMock(() => api) }));

describe('payment reconciliation queries', () => {
  beforeEach(() => {
    api.reset();
    api.on('GET', /\/summary/, { activeRuns: 0, runRevision: '', expectedPeriods: 0, waitingPeriods: 1, readyPeriods: 2, failedPeriods: 0, openCases: 1, suspendedCases: 0, overdueCases: 0, pendingAdjustments: 0, unmatchedBankEntries: 0, unmatchedSettlementEntries: 0, differenceAmounts: [] });
    api.on('GET', /\/cases\/7$/, { id: 7, version: 1, status: 'open', events: [], adjustments: [] });
    api.on('GET', /\/cases(?:\?|$)/, { list: [], total: 0, page: 1, pageSize: 10 });
    api.on('POST', /\/periods$/, { id: 11, taskType: 'payment-statement-download', title: '账单下载', status: 'pending' });
    api.on('PATCH', /\/cases\/7$/, { id: 7, version: 2, status: 'suspended' });
  });
  it('uses account scoped case and summary contract paths', async () => {
    const queryClient = createTestQueryClient();
    const { result } = renderHook(() => ({ cases: usePaymentReconCases({ page: 1, pageSize: 10, accountId: 3 }), detail: usePaymentReconCase(7), summary: usePaymentReconSummary(3) }), { wrapper: createWrapper(queryClient) });
    await waitFor(() => expect(result.current.summary.isSuccess).toBe(true));
    expect(api.calls.some((call) => call.url.includes('/api/payment/recon/cases') && call.url.includes('accountId=3'))).toBe(true);
    expect(api.calls.some((call) => call.url === '/api/payment/recon/cases/7')).toBe(true);
    expect(api.calls.some((call) => call.url.includes('/api/payment/recon/summary') && call.url.includes('accountId=3'))).toBe(true);
  });
  it('sends expected version when handling a case', async () => {
    const queryClient = createTestQueryClient();
    const { result } = renderHook(() => useHandlePaymentReconCase(), { wrapper: createWrapper(queryClient) });
    await result.current.mutateAsync({ params: { id: 7 }, body: { action: 'suspend', remark: '等待渠道补充证据', expectedVersion: 1 } });
    expect(api.calls.some((call) => call.method === 'PATCH' && call.url === '/api/payment/recon/cases/7')).toBe(true);
  });
  it('submits account scoped bill download as an async task', async () => {
    const queryClient = createTestQueryClient();
    const { result } = renderHook(() => useSubmitPaymentStatement(), { wrapper: createWrapper(queryClient) });
    const task = await result.current.mutateAsync({ body: { accountId: 3, billDate: '2026-09-17', type: 'trade', currency: 'CNY' } });
    expect(task.taskType).toBe('payment-statement-download');
    expect(api.calls.find((call) => call.method === 'POST')?.url).toBe(paymentReconContract.submit.fullPath);
  });

  it('refreshes cases, detail, versions and filtered run history when an ownerless run finishes', async () => {
    vi.useFakeTimers();
    let completed = false;
    api.on('GET', /\/summary/, () => ({ activeRuns: completed ? 0 : 1, runRevision: completed ? 'completed:1' : 'pending:1', openCases: completed ? 1 : 0 }));
    api.on('GET', /\/cases(?:\?|$)/, () => ({ list: completed ? [{ id: 7, status: 'open' }] : [], total: completed ? 1 : 0, page: 1, pageSize: 10 }));
    api.on('GET', /\/cases\/7$/, () => ({ id: 7, version: completed ? 2 : 1, status: completed ? 'open' : 'ignored', events: completed ? [{ action: 'reconciled' }] : [], adjustments: [] }));
    api.on('GET', /\/runs/, () => ({ list: completed ? [{ id: 21, status: 'completed', diffCount: 1 }] : [], total: completed ? 1 : 0, page: 1, pageSize: 10 }));
    api.on('GET', /\/periods\/3\/statements$/, () => [{ id: completed ? 12 : 11 }]);
    api.on('GET', '/api/payment/channel-accounts/all', []);
    const queryClient = createTestQueryClient();
    const hook = renderHook(() => ({
      summary: usePaymentReconSummary(3), cases: usePaymentReconCases({ accountId: 3 }), detail: usePaymentReconCase(7),
      // An active run is absent from this filter, and no "my task" hook or event is involved.
      runs: usePaymentReconRuns({ accountId: 3, status: 'completed', page: 2 }),
      versions: usePaymentStatements(3), accounts: usePaymentChannelAccounts(),
    }), { wrapper: createWrapper(queryClient) });
    try {
      await act(async () => { await vi.advanceTimersByTimeAsync(1); });
      expect(hook.result.current.summary.data?.activeRuns).toBe(1);
      expect(hook.result.current.detail.data?.status).toBe('ignored');
      completed = true;
      await act(async () => { await vi.advanceTimersByTimeAsync(3000); });
      await act(async () => { await vi.advanceTimersByTimeAsync(1); });
      expect(hook.result.current.summary.data?.openCases).toBe(1);
      expect(hook.result.current.cases.data?.total).toBe(1);
      expect(hook.result.current.detail.data).toMatchObject({ version: 2, status: 'open', events: [{ action: 'reconciled' }] });
      expect(hook.result.current.runs.data?.list[0]).toMatchObject({ status: 'completed', diffCount: 1 });
      expect(hook.result.current.versions.data?.[0].id).toBe(12);
      expect(api.countOf('GET', '/api/payment/channel-accounts/all')).toBe(1);
      const caseRequests = api.countOf('GET', /\/cases(?:\?|$)/);
      const summaryRequests = api.countOf('GET', /\/summary/);
      await act(async () => { await vi.advanceTimersByTimeAsync(15_000); });
      expect(api.countOf('GET', /\/summary/)).toBe(summaryRequests + 1);
      expect(api.countOf('GET', /\/cases(?:\?|$)/)).toBe(caseRequests);
    } finally {
      hook.unmount(); queryClient.clear(); vi.useRealTimers();
    }
  });

  it('discovers scheduled runs from the idle probe and refreshes failures without user task activity', async () => {
    vi.useFakeTimers();
    let phase: 'idle' | 'running' | 'failed' = 'idle';
    api.on('GET', /\/summary/, () => ({ activeRuns: phase === 'running' ? 1 : 0, runRevision: phase === 'idle' ? '' : `${phase}:1` }));
    api.on('GET', /\/runs/, () => ({ list: phase === 'idle' ? [] : [{ id: 22, status: phase, error: phase === 'failed' ? '账单已更新' : null }], total: phase === 'idle' ? 0 : 1, page: 1, pageSize: 10 }));
    const queryClient = createTestQueryClient();
    const hook = renderHook(() => ({ summary: usePaymentReconSummary(), runs: usePaymentReconRuns({}) }), { wrapper: createWrapper(queryClient) });
    try {
      await act(async () => { await vi.advanceTimersByTimeAsync(1); });
      phase = 'running';
      await act(async () => { await vi.advanceTimersByTimeAsync(15_000); });
      await act(async () => { await vi.advanceTimersByTimeAsync(1); });
      expect(hook.result.current.runs.data?.list[0].status).toBe('running');
      phase = 'failed';
      await act(async () => { await vi.advanceTimersByTimeAsync(3000); });
      await act(async () => { await vi.advanceTimersByTimeAsync(1); });
      expect(hook.result.current.runs.data?.list[0]).toMatchObject({ status: 'failed', error: '账单已更新' });
      const requests = api.calls.length;
      hook.unmount();
      await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
      expect(api.calls).toHaveLength(requests);
    } finally {
      hook.unmount(); queryClient.clear(); vi.useRealTimers();
    }
  });
});
