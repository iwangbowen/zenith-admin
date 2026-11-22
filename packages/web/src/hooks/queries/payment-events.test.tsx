import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { ApiRecorder, createRequestMock, createTestQueryClient, createWrapper, observeFetches } from '@/test-utils/query-harness';

const api = new ApiRecorder();
vi.mock('@/utils/request', () => ({ request: createRequestMock(() => api) }));

import {
  paymentEventKeys,
  usePaymentEventAttempts,
  usePaymentEventList,
  usePaymentOpsHealth,
  useRedispatchPaymentEvent,
} from './payment-events';

const event = {
  id: 7,
  type: 'payment.succeeded',
  orderNo: 'PO-7',
  status: 'done',
  attempts: 1,
  generation: 2,
  redispatchCount: 1,
  payload: '{}',
  lastError: null,
  createdAt: '2026-10-24 01:00:00',
  processedAt: '2026-10-24 01:01:00',
} as const;

beforeEach(() => {
  api.reset();
  api
    .on('GET', '/api/payment/ops/events?page=1&pageSize=10', { list: [event], total: 1, page: 1, pageSize: 10 })
    .on('GET', '/api/payment/ops/events/7/attempts', [{ id: 1, eventId: 7, generation: 2, attemptNo: 1, status: 'succeeded', errorMessage: null, startedAt: event.createdAt, finishedAt: event.processedAt }])
    .on('GET', '/api/payment/ops/health', { outboxPending: 0, outboxFailed: 0, webhookPending: 0, webhookFailed24h: 0, sharingProcessing: 0, transferProcessing: 0, reconPendingDiff: 0, paymentExceptionsOpen: 0 })
    .on('POST', '/api/payment/ops/events/7/redispatch', event);
});

describe('payment event queries', () => {
  it('重投后刷新事件列表、健康指标与该事件尝试历史', async () => {
    const queryClient = createTestQueryClient();
    const { result } = renderHook(() => ({
      list: usePaymentEventList({ page: 1, pageSize: 10 }),
      attempts: usePaymentEventAttempts(7),
      health: usePaymentOpsHealth(),
      redispatch: useRedispatchPaymentEvent(),
    }), { wrapper: createWrapper(queryClient) });

    await waitFor(() => {
      expect(result.current.list.isSuccess).toBe(true);
      expect(result.current.attempts.isSuccess).toBe(true);
      expect(result.current.health.isSuccess).toBe(true);
    });

    const fetches = observeFetches(queryClient);
    await result.current.redispatch.mutateAsync({ params: { id: 7 } });
    await waitFor(() => expect(fetches.countOf(paymentEventKeys.attempts(7))).toBe(1));

    expect(fetches.countOf(paymentEventKeys.lists)).toBe(1);
    expect(fetches.countOf(paymentEventKeys.health)).toBe(1);
    fetches.stop();
  });
});
