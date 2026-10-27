import { describe, expect, it, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import type { PaymentApp, PaymentChannelConfig } from '@zenith/shared/payment';
import { PAYMENT_DEDUCT_METHODS, PAYMENT_PREAUTH_METHOD_LABELS, PAYMENT_PREAUTH_METHODS, paymentAppBoundConfigIds } from '@zenith/shared/payment';
import { paymentCapabilityReason, useAppBoundConfigOptions, useAppPaymentMethodOptions, useEnabledPaymentAppLookup } from './payment-app-options';

const mocks = vi.hoisted(() => ({
  capabilities: vi.fn(),
  methods: vi.fn(),
}));

const apps = [
  { id: 1, name: '商城', openClientName: '官网', environment: 'sandbox', wechatConfigId: 10, alipayConfigId: null, unionpayConfigId: 12 },
  { id: 2, name: '小程序', openClientName: '小程序客户端', environment: 'live', wechatConfigId: null, alipayConfigId: 11, unionpayConfigId: null },
] as PaymentApp[];

vi.mock('@/hooks/queries/payment-apps', () => ({
  usePaymentAppList: () => ({ data: { list: apps }, isFetching: false }),
}));
vi.mock('@/hooks/queries/payment-capabilities', () => ({
  usePaymentCapabilities: mocks.capabilities,
}));
vi.mock('@/hooks/queries/payment-methods', () => ({
  usePaymentMethodList: mocks.methods,
}));
vi.mock('@/hooks/usePermission', () => ({
  usePermission: () => ({ hasPermission: () => true }),
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

  it('按应用与预授权操作只展示服务端确认可用的方式', () => {
    mocks.methods.mockReturnValue({ data: [] });
    mocks.capabilities.mockReturnValue({
      data: {
        engineMode: 'sandbox',
        configs: [{
          channelConfigId: 10,
          environment: 'sandbox',
          capabilities: [
            { paymentMethod: 'wechat_preauth', supported: false },
            { paymentMethod: 'alipay_preauth', supported: true },
          ],
        }],
      },
      isError: false,
      isFetching: false,
    });
    const selectedApp = { ...apps[0], alipayConfigId: 11 } as PaymentApp;
    const { result } = renderHook(() => useAppPaymentMethodOptions(selectedApp, PAYMENT_PREAUTH_METHODS, {
      operation: 'preauth.freeze',
      labels: PAYMENT_PREAUTH_METHOD_LABELS,
    }));

    expect(mocks.capabilities).toHaveBeenCalledWith({
      applicationId: selectedApp.id,
      operation: 'preauth.freeze',
      currency: 'CNY',
    }, true);
    expect(result.current.options).toEqual([{ value: 'alipay_preauth', label: '支付宝预授权' }]);
  });

  it('按签约能力隐藏已停用的代扣方式', () => {
    mocks.methods.mockReturnValue({
      data: [
        { method: 'wechat_papay', enabled: false },
        { method: 'alipay_cycle', enabled: true },
      ],
    });
    mocks.capabilities.mockReturnValue({
      data: {
        engineMode: 'sandbox',
        configs: [{
          channelConfigId: 10,
          environment: 'sandbox',
          capabilities: [
            { paymentMethod: 'wechat_papay', supported: false },
            { paymentMethod: 'alipay_cycle', supported: true },
          ],
        }],
      },
      isError: false,
      isFetching: false,
    });
    const selectedApp = { ...apps[0], alipayConfigId: 11 } as PaymentApp;
    const { result } = renderHook(() => useAppPaymentMethodOptions(selectedApp, PAYMENT_DEDUCT_METHODS, { operation: 'contract.sign' }));

    expect(result.current.options).toEqual([{ value: 'alipay_cycle', label: '支付宝周期扣款' }]);
  });

  it('exposes the server reason for an empty capability state', () => {
    expect(paymentCapabilityReason({
      engineMode: 'sandbox',
      configs: [{
        channelConfigId: 10,
        tenantId: null,
        configName: '微信沙箱',
        channel: 'wechat',
        environment: 'sandbox',
        configStatus: 'enabled',
        providerName: '微信支付',
        supported: false,
        reason: '支付方式 wechat_papay 已停用',
        capabilities: [],
      }],
    })).toBe('支付方式 wechat_papay 已停用');
  });
});
