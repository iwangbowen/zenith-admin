import { useMemo } from 'react';
import type { PaymentApp, PaymentChannel, PaymentChannelConfig } from '@zenith/shared/payment';
import { PAYMENT_CHANNEL_LABELS } from '@zenith/shared/payment';
import { usePaymentAppList } from '@/hooks/queries/payment-apps';

export type PaymentAppOption = { value: number; label: string };

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
