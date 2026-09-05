/**
 * 支付适配层统一出口。
 *
 * 服务启动时调用 initPaymentAdapters() 注册所有内置渠道适配器。
 */
import { registerAdapter } from './registry';
import { wechatPayAdapter } from './wechat.adapter';
import { alipayAdapter } from './alipay.adapter';
import { unionpayAdapter } from './unionpay.adapter';

let initialized = false;

/** 注册所有内置支付渠道适配器（幂等，可重复调用）。 */
export function initPaymentAdapters(): void {
  if (initialized) return;
  registerAdapter(wechatPayAdapter);
  registerAdapter(alipayAdapter);
  registerAdapter(unionpayAdapter);
  initialized = true;
}

export {
  assertProviderCapability,
  findProviderCapability,
  getAdapter,
  getProviderManifest,
  hasAdapter,
  listProviderManifests,
  registerAdapter,
  supportsProviderCapability,
} from './registry';
export type {
  AdapterContext,
  ChannelOperationStatus,
  DecryptedSecrets,
  ContractQueryInput,
  ContractQueryResult,
  NotifyResult,
  PaymentChannelAdapter,
  PaymentQueryResult,
  PreauthQueryInput,
  PreauthQueryResult,
  PaymentProviderCapability,
  PaymentProviderEnvironment,
  PaymentProviderManifest,
  PaymentProviderOperation,
  ProfitShareReverseInput,
  ProfitShareReverseQueryResult,
  ProfitShareReverseResult,
  RefundQueryResult,
  RefundResult,
} from './types';
