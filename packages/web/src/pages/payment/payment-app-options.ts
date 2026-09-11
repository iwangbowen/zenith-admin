import { useMemo } from 'react';
import { Toast } from '@douyinfe/semi-ui';
import type { PaymentApp, PaymentChannel, PaymentChannelConfig, PaymentMethod } from '@zenith/shared/payment';
import { PAYMENT_CHANNEL_LABELS, PAYMENT_METHOD_CHANNEL, PAYMENT_METHOD_LABELS } from '@zenith/shared/payment';
import { usePaymentAppList } from '@/hooks/queries/payment-apps';
import { usePaymentCapabilities } from '@/hooks/queries/payment-capabilities';
import { usePaymentChannelOperationLookup } from '@/hooks/queries/payment-channels';
import { usePaymentMethodList } from '@/hooks/queries/payment-methods';
import { usePermission } from '@/hooks/usePermission';
import { abortSubmit } from '@/lib/abort-submit';

export type PaymentAppOption = { value: number; label: string };

/** 应用在某渠道绑定的商户配置 id（未绑定为 null） */
export function paymentAppConfigId(app: Pick<PaymentApp, 'wechatConfigId' | 'alipayConfigId' | 'unionpayConfigId'>, channel: PaymentChannel): number | null {
  if (channel === 'wechat') return app.wechatConfigId ?? null;
  if (channel === 'alipay') return app.alipayConfigId ?? null;
  return app.unionpayConfigId ?? null;
}

export function paymentAppBoundConfigIds(app: Pick<PaymentApp, 'wechatConfigId' | 'alipayConfigId' | 'unionpayConfigId'> | null | undefined) {
  return new Set([app?.wechatConfigId, app?.alipayConfigId, app?.unionpayConfigId].filter((id): id is number => id != null));
}

export function useEnabledPaymentAppLookup(options: { label?: (app: PaymentApp) => string } = {}) {
  const { label } = options;
  const appsQuery = usePaymentAppList({ page: 1, pageSize: 100, status: 'enabled' });
  const apps = useMemo(() => appsQuery.data?.list ?? [], [appsQuery.data?.list]);
  const appById = useMemo(() => new Map(apps.map((app) => [app.id, app])), [apps]);
  const appOptions = useMemo(
    () => apps.map((app) => ({
      value: app.id,
      label: label?.(app) ?? `${app.name} · ${app.environment === 'sandbox' ? '沙箱' : '生产'}`,
    })),
    [apps, label],
  );
  return { apps, appById, appOptions, isFetching: appsQuery.isFetching };
}

export function useAppBoundConfigOptions({
  selectedAppId,
  configs,
  apps,
  label,
}: {
  selectedAppId: number | null | undefined;
  configs: Array<Pick<PaymentChannelConfig, 'id' | 'name' | 'sandbox'> & { channel: PaymentChannel }>;
  apps: PaymentApp[];
  label?: (config: Pick<PaymentChannelConfig, 'id' | 'name' | 'sandbox'> & { channel: PaymentChannel }) => string;
}) {
  const configById = useMemo(() => new Map(configs.map((config) => [config.id, config])), [configs]);
  const appById = useMemo(() => new Map(apps.map((app) => [app.id, app])), [apps]);
  const options = useMemo(() => {
    const app = selectedAppId == null ? null : appById.get(selectedAppId);
    const boundConfigIds = paymentAppBoundConfigIds(app);
    return configs.filter((config) => boundConfigIds.has(config.id)).map((config) => ({
      value: config.id,
      label: label?.(config) ?? `${config.name} · ${PAYMENT_CHANNEL_LABELS[config.channel]} · ${config.sandbox ? '沙箱' : '生产'}`,
    }));
  }, [appById, configs, label, selectedAppId]);
  return { configById, options };
}

/** 启用的支付应用 + 运营中的商户配置，按所选应用给出其绑定的商户配置候选（对账 / 结算等表单） */
export function useAppMerchantConfigLookup(selectedAppId: number | null) {
  const channelConfigsQuery = usePaymentChannelOperationLookup();
  const operationChannelConfigs = useMemo(() => channelConfigsQuery.data ?? [], [channelConfigsQuery.data]);
  const { apps: paymentApps, appById, appOptions, isFetching: appsFetching } = useEnabledPaymentAppLookup();
  const { configById: channelConfigById, options: merchantConfigOptions } = useAppBoundConfigOptions({
    selectedAppId,
    configs: operationChannelConfigs,
    apps: paymentApps,
  });
  return {
    channelConfigsQuery,
    operationChannelConfigs,
    paymentApps,
    appById,
    appOptions,
    appsFetching,
    channelConfigById,
    merchantConfigOptions,
  };
}

/**
 * 表单提交前校验「支付应用 ↔ 商户配置」绑定关系（对账 / 结算等按应用 + 商户配置发起的操作）：
 * 任一缺失或商户配置未绑定到该应用即提示并中断提交，返回已收窄的 app / config。
 */
export function resolveAppConfigBinding(
  lookup: Pick<ReturnType<typeof useAppMerchantConfigLookup>, 'appById' | 'channelConfigById'>,
  applicationId: number,
  channelConfigId: number,
) {
  const config = lookup.channelConfigById.get(channelConfigId);
  const app = lookup.appById.get(applicationId);
  if (!app || !config || !paymentAppBoundConfigIds(app).has(config.id)) {
    Toast.error('所选支付应用未绑定该商户配置，请重新选择');
    abortSubmit('validation');
  }
  return { app, config };
}

/**
 * 按所选支付应用给出可用的支付方式选项（下单 / 收银台链接共用）：
 * 「支付方式配置」中已启用 ∩ 应用绑定商户配置在渠道实时能力里支持的方式；
 * 无能力查询权限或能力接口出错时退化为「应用已绑定对应渠道」，服务端下单仍做最终校验。
 * `candidates` 限定候选集（全部下单方式 / 仅收银台方式）。
 */
export function useAppPaymentMethodOptions<M extends PaymentMethod>(
  selectedApp: PaymentApp | null | undefined,
  candidates: readonly M[],
) {
  const { hasPermission } = usePermission();
  const canReadCapabilities = hasPermission('payment:channel:list');
  const capabilitiesQuery = usePaymentCapabilities(
    { operation: 'payment.create', currency: 'CNY' },
    canReadCapabilities,
  );
  const paymentMethodQuery = usePaymentMethodList();
  const enabledMethods = useMemo(
    () => paymentMethodQuery.data
      ? new Set(paymentMethodQuery.data.filter((config) => config.enabled).map((config) => config.method))
      : null,
    [paymentMethodQuery.data],
  );
  const options = useMemo(() => {
    if (!selectedApp || !enabledMethods) return [];
    const toOptions = (methods: readonly M[]) => methods.map((value) => ({ value, label: PAYMENT_METHOD_LABELS[value] }));
    if (capabilitiesQuery.data) {
      const appEnvironment = selectedApp.environment === 'sandbox' ? 'sandbox' : 'live';
      const boundConfigIds = paymentAppBoundConfigIds(selectedApp);
      const supportedMethods = new Set<PaymentMethod>();
      for (const config of capabilitiesQuery.data.configs) {
        if (!boundConfigIds.has(config.channelConfigId) || config.environment !== appEnvironment) continue;
        for (const capability of config.capabilities) {
          if (capability.supported && capability.paymentMethod) supportedMethods.add(capability.paymentMethod);
        }
      }
      return toOptions(candidates.filter((method) => enabledMethods.has(method) && supportedMethods.has(method)));
    }
    if (!canReadCapabilities || capabilitiesQuery.isError) {
      return toOptions(candidates.filter((method) => enabledMethods.has(method) && paymentAppConfigId(selectedApp, PAYMENT_METHOD_CHANNEL[method]) != null));
    }
    return [];
  }, [candidates, canReadCapabilities, capabilitiesQuery.data, capabilitiesQuery.isError, enabledMethods, selectedApp]);
  return { options, canReadCapabilities, capabilitiesQuery, enabledMethods };
}
