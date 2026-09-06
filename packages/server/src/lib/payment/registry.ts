/**
 * 支付渠道适配器注册表。
 *
 * 新增渠道：实现 PaymentChannelAdapter 后在 lib/payment/index.ts 的
 * initPaymentAdapters() 中调用 registerAdapter() 即可，门面与业务层零改动。
 */
import { HTTPException } from 'hono/http-exception';
import { requireRow } from '../db-assert';
import type { PaymentChannel, PaymentMethod } from '@zenith/shared/payment';
import type {
  PaymentChannelAdapter,
  PaymentProviderCapability,
  PaymentProviderEnvironment,
  PaymentProviderManifest,
  PaymentProviderOperation,
} from './types';

const adapterRegistry = new Map<PaymentChannel, PaymentChannelAdapter>();

export function registerAdapter(adapter: PaymentChannelAdapter): void {
  if (adapter.manifest.channel !== adapter.channel) {
    throw new Error(`Payment adapter manifest channel mismatch: ${adapter.channel}/${adapter.manifest.channel}`);
  }
  adapterRegistry.set(adapter.channel, adapter);
}

export function getAdapter(channel: PaymentChannel): PaymentChannelAdapter {
  const maybeAdapter = adapterRegistry.get(channel);
  const adapter = requireRow(maybeAdapter, `不支持的支付渠道：${channel}`, 400);
  return adapter;
}

export function hasAdapter(channel: PaymentChannel): boolean {
  return adapterRegistry.has(channel);
}

export function getProviderManifest(channel: PaymentChannel): PaymentProviderManifest {
  return getAdapter(channel).manifest;
}

export function listProviderManifests(): PaymentProviderManifest[] {
  return [...adapterRegistry.values()].map((adapter) => adapter.manifest);
}

export function supportsProviderCapability(
  channel: PaymentChannel,
  operation: PaymentProviderOperation,
  environment: PaymentProviderEnvironment,
  paymentMethod?: PaymentMethod,
): boolean {
  return findProviderCapability(channel, operation, environment, paymentMethod) != null;
}

export function findProviderCapability(
  channel: PaymentChannel,
  operation: PaymentProviderOperation,
  environment: PaymentProviderEnvironment,
  paymentMethod?: PaymentMethod,
): PaymentProviderCapability | null {
  return getProviderManifest(channel).capabilities.find((capability) => (
    capability.operation === operation
    && capability.environments.includes(environment)
    && (!paymentMethod || !capability.paymentMethods || capability.paymentMethods.includes(paymentMethod))
  )) ?? null;
}

export function assertProviderCapability(
  channel: PaymentChannel,
  operation: PaymentProviderOperation,
  environment: PaymentProviderEnvironment,
  paymentMethod?: PaymentMethod,
): PaymentProviderCapability {
  const capability = findProviderCapability(channel, operation, environment, paymentMethod);
  if (!capability) {
    throw new HTTPException(400, {
      message: `CAPABILITY_UNSUPPORTED: ${channel}/${operation}/${environment}${paymentMethod ? `/${paymentMethod}` : ''}`,
    });
  }
  return capability;
}
