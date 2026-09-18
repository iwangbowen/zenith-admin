import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { ApiRecorder, createRequestMock, createTestQueryClient, createWrapper } from '@/test-utils/query-harness';
import { paymentReconContract } from '@zenith/shared/payment';
import { useHandlePaymentReconCase, usePaymentReconCase, usePaymentReconCases, usePaymentReconSummary, useSubmitPaymentStatement } from './payment-recon';

const api = new ApiRecorder();
vi.mock('@/utils/request', () => ({ request: createRequestMock(() => api) }));

describe('payment reconciliation queries', () => {
  beforeEach(() => {
    api.reset();
    api.on('GET', /\/summary/, { expectedPeriods: 0, waitingPeriods: 1, readyPeriods: 2, failedPeriods: 0, openCases: 1, suspendedCases: 0, overdueCases: 0, pendingAdjustments: 0, unmatchedBankEntries: 0, unmatchedSettlementEntries: 0, differenceAmounts: [] });
    api.on('GET', /\/cases\/7$/, { id: 7, version: 1, status: 'open', events: [], adjustments: [] });
    api.on('GET', '*', { list: [], total: 0, page: 1, pageSize: 10 });
    api.on('POST', '*', { id: 11, taskType: 'payment-statement-download', title: '账单下载', status: 'pending' });
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
});
