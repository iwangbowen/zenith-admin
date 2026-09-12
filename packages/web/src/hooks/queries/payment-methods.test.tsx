/**
 * payment-methods 域缓存一致性契约：变量即契约输入 `{ params: { id }, body }`，
 * 启停后配置列表与「可用支付方式」下拉源都要回源。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { ApiRecorder, createRequestMock, createTestQueryClient, createWrapper, observeFetches } from '@/test-utils/query-harness';

const api = new ApiRecorder();
vi.mock('@/utils/request', () => ({ request: createRequestMock(() => api) }));

import { paymentMethodKeys, useEnabledPaymentMethods, usePaymentMethodList, useSavePaymentMethod } from './payment-methods';

beforeEach(() => {
  api.reset();
  api
    .on('GET', '/api/payment/methods', [])
    .on('GET', '/api/payment/methods/enabled', [])
    .on('PUT', '/api/payment/methods/1', { id: 1, method: 'wechat_native', enabled: false });
});

describe('useSavePaymentMethod', () => {
  it('停用支付方式：PUT 契约路径并透传 body，配置列表与可用方式下拉源回源', async () => {
    const qc = createTestQueryClient();
    const { result } = renderHook(
      () => ({ list: usePaymentMethodList(), enabled: useEnabledPaymentMethods(), save: useSavePaymentMethod() }),
      { wrapper: createWrapper(qc) },
    );
    await waitFor(() => {
      expect(result.current.list.isSuccess).toBe(true);
      expect(result.current.enabled.isSuccess).toBe(true);
    });

    const fetches = observeFetches(qc);
    api.resetCalls();
    await result.current.save.mutateAsync({ params: { id: 1 }, body: { enabled: false } });
    await waitFor(() => expect(fetches.countOf(paymentMethodKeys.lists)).toBe(1));

    const put = api.calls.find((call) => call.method === 'PUT');
    expect(put?.url).toBe('/api/payment/methods/1');
    expect(put?.body).toEqual({ enabled: false });
    expect(fetches.countOf(paymentMethodKeys.enabled)).toBe(1);
    fetches.stop();
  });
});
