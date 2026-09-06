import { describe, expect, it, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import type { PaymentApp, PaymentChannelConfig } from '@zenith/shared/payment';
import { paymentAppBoundConfigIds, useAppBoundConfigOptions, useEnabledPaymentAppLookup } from './payment-app-options';

const apps = [
  { id: 1, name: '商城', openClientName: '官网', environment: 'sandbox', wechatConfigId: 10, alipayConfigId: null, unionpayConfigId: 12 },
  { id: 2, name: '小程序', openClientName: '小程序客户端', environment: 'live', wechatConfigId: null, alipayConfigId: 11, unionpayConfigId: null },
] as PaymentApp[];

vi.mock('@/hooks/queries/payment-apps', () => ({
  usePaymentAppList: () => ({ data: { list: apps }, isFetching: false }),
}));

describe('payment app options', () => {
  it('builds default and override labels', () => {
    const { result, rerender } = renderHook(({ override }: { override?: boolean }) => useEnabledPaymentAppLookup({
      label: override ? (app) => `${app.name} · ${app.openClientName}` : undefined,
    }), { initialProps: { override: false } });
    expect(result.current.appOptions).toEqual([{ value: 1, label: '商城 · 沙箱' }, { value: 2, label: '小程序 · 生产' }]);

    rerender({ override: true });
    expect(result.current.appOptions[0]?.label).toBe('商城 · 官网');
  });

  it('returns bound config ids', () => {
    expect([...paymentAppBoundConfigIds(apps[0])]).toEqual([10, 12]);
  });

  it('filters selected app bound configs', () => {
    const configs = [
      { id: 10, name: '微信商户', channel: 'wechat', sandbox: true },
      { id: 11, name: '支付宝商户', channel: 'alipay', sandbox: false },
      { id: 12, name: '云闪付商户', channel: 'unionpay', sandbox: true },
    ] as PaymentChannelConfig[];
    const { result } = renderHook(() => useAppBoundConfigOptions({ selectedAppId: 1, configs, apps }));
    expect(result.current.options.map((option) => option.label)).toEqual(['微信商户 · 微信支付 · 沙箱', '云闪付商户 · 云闪付 · 沙箱']);
    expect(result.current.configById.get(10)?.name).toBe('微信商户');
  });
});
