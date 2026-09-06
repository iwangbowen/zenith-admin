import { and, eq } from 'drizzle-orm';
import { HTTPException } from 'hono/http-exception';
import { PAYMENT_METHOD_CHANNEL } from '@zenith/shared/payment';
import type { PaymentMethod } from '@zenith/shared/payment';
import { config } from '../../config';
import { db } from '../../db';
import { exactTenantCondition } from '../../lib/tenant';
import {
  paymentMethodConfigs,
  type PaymentChannelConfigRow,
  type PaymentMethodConfigRow,
} from '../../db/schema';
import {
  getProviderManifest,
  initPaymentAdapters,
  type PaymentProviderCapability,
  type PaymentProviderEnvironment,
  type PaymentProviderOperation,
} from '../../lib/payment';

export type PaymentCapabilityReasonCode =
  | 'ENGINE_OFF'
  | 'ENGINE_MODE_MISMATCH'
  | 'CONFIG_DISABLED'
  | 'ENVIRONMENT_UNSUPPORTED'
  | 'CONFIG_INCOMPLETE'
  | 'PAYMENT_METHOD_NOT_CONFIGURED'
  | 'PAYMENT_METHOD_DISABLED'
  | 'PAYMENT_METHOD_CHANNEL_MISMATCH'
  | 'PAYMENT_METHOD_UNSUPPORTED'
  | 'CURRENCY_UNSUPPORTED'
  | 'OPERATION_UNSUPPORTED';

export interface PaymentCapabilityDecision {
  supported: boolean;
  reasonCode: PaymentCapabilityReasonCode | null;
  reason: string | null;
  missingConfigFields: string[];
}

export function paymentConfigEnvironment(row: PaymentChannelConfigRow): PaymentProviderEnvironment {
  return row.sandbox ? 'sandbox' : 'live';
}

export function hasPaymentConfigField(row: PaymentChannelConfigRow, field: string): boolean {
  const fieldChecks: Record<string, boolean> = {
    sandboxNotifySecret: Boolean(row.sandboxNotifySecretEncrypted),
    wechatAppId: Boolean(row.wechatAppId),
    wechatMchId: Boolean(row.wechatMchId),
    wechatApiV3Key: Boolean(row.wechatApiV3KeyEncrypted),
    wechatPrivateKey: Boolean(row.wechatPrivateKeyEncrypted),
    wechatSerialNo: Boolean(row.wechatSerialNo),
    // 手工证书和自动下载证书两条路径都可满足回调验签。
    wechatPlatformCert: Boolean(row.wechatPlatformCert)
      || Boolean(row.wechatApiV3KeyEncrypted && row.wechatPrivateKeyEncrypted && row.wechatSerialNo),
    alipayAppId: Boolean(row.alipayAppId),
    alipaySellerId: Boolean(row.alipaySellerId),
    alipayPrivateKey: Boolean(row.alipayPrivateKeyEncrypted),
    alipayPublicKey: Boolean(row.alipayPublicKey),
    unionpayMerId: Boolean(row.unionpayMerId),
    unionpayCertId: Boolean(row.unionpayCertId),
    unionpayPrivateKey: Boolean(row.unionpayPrivateKeyEncrypted),
    unionpayPublicKey: Boolean(row.unionpayPublicKey),
  };
  return fieldChecks[field] ?? false;
}

function methodDecision(
  row: PaymentChannelConfigRow,
  capability: PaymentProviderCapability,
  method: PaymentMethod | null,
  methodByCode: ReadonlyMap<PaymentMethod, PaymentMethodConfigRow>,
): PaymentCapabilityDecision | null {
  if (!method) return null;
  if (capability.paymentMethods && !capability.paymentMethods.includes(method)) {
    return {
      supported: false,
      reasonCode: 'PAYMENT_METHOD_UNSUPPORTED',
      reason: `渠道适配器未实现支付方式 ${method}`,
      missingConfigFields: [],
    };
  }
  const methodConfig = methodByCode.get(method);
  if (!methodConfig) {
    return {
      supported: false,
      reasonCode: 'PAYMENT_METHOD_NOT_CONFIGURED',
      reason: `支付方式 ${method} 未配置`,
      missingConfigFields: [],
    };
  }
  if (PAYMENT_METHOD_CHANNEL[method] !== row.channel) {
    return {
      supported: false,
      reasonCode: 'PAYMENT_METHOD_CHANNEL_MISMATCH',
      reason: `支付方式 ${method} 与商户渠道不匹配`,
      missingConfigFields: [],
    };
  }
  if (methodConfig.channel !== row.channel) {
    return {
      supported: false,
      reasonCode: 'PAYMENT_METHOD_CHANNEL_MISMATCH',
      reason: `支付方式 ${method} 与商户渠道不匹配`,
      missingConfigFields: [],
    };
  }
  if (!methodConfig.enabled) {
    return {
      supported: false,
      reasonCode: 'PAYMENT_METHOD_DISABLED',
      reason: `支付方式 ${method} 已停用`,
      missingConfigFields: [],
    };
  }
  return null;
}

export function decidePaymentCapability(input: {
  configRow: PaymentChannelConfigRow;
  manifestSandboxFields: readonly string[];
  capability: PaymentProviderCapability;
  method: PaymentMethod | null;
  currency: string;
  methodByCode: ReadonlyMap<PaymentMethod, PaymentMethodConfigRow>;
  recovery?: boolean;
}): PaymentCapabilityDecision {
  const { configRow: row, capability, method, methodByCode } = input;
  const currency = input.currency.toUpperCase();
  const environment = paymentConfigEnvironment(row);
  if (config.payment.engineMode === 'off' && !input.recovery) {
    return { supported: false, reasonCode: 'ENGINE_OFF', reason: '支付引擎已关闭', missingConfigFields: [] };
  }
  if (row.status !== 'enabled' && !input.recovery) {
    return { supported: false, reasonCode: 'CONFIG_DISABLED', reason: '商户配置已停用', missingConfigFields: [] };
  }
  if (!input.recovery && config.payment.engineMode !== 'off' && config.payment.engineMode !== environment) {
    return {
      supported: false,
      reasonCode: 'ENGINE_MODE_MISMATCH',
      reason: `当前运行模式为 ${config.payment.engineMode}，不能使用 ${environment} 商户配置`,
      missingConfigFields: [],
    };
  }
  if (!capability.environments.includes(environment)) {
    return {
      supported: false,
      reasonCode: 'ENVIRONMENT_UNSUPPORTED',
      reason: `适配器未实现 ${environment} 环境下的 ${capability.operation}`,
      missingConfigFields: [],
    };
  }
  if (!capability.currencies.includes(currency)) {
    return {
      supported: false,
      reasonCode: 'CURRENCY_UNSUPPORTED',
      reason: `适配器不支持币种 ${currency}`,
      missingConfigFields: [],
    };
  }
  const requiredFields = environment === 'sandbox'
    ? input.manifestSandboxFields
    : capability.requiredConfigFields;
  const missingConfigFields = requiredFields.filter((field) => !hasPaymentConfigField(row, field));
  if (missingConfigFields.length > 0) {
    return {
      supported: false,
      reasonCode: 'CONFIG_INCOMPLETE',
      reason: `商户配置缺少：${missingConfigFields.join(', ')}`,
      missingConfigFields,
    };
  }
  return (input.recovery ? null : methodDecision(row, capability, method, methodByCode))
    ?? { supported: true, reasonCode: null, reason: null, missingConfigFields: [] };
}

function declaredCapability(
  configRow: PaymentChannelConfigRow,
  operation: PaymentProviderOperation,
  method?: PaymentMethod,
): PaymentProviderCapability | null {
  const manifest = getProviderManifest(configRow.channel);
  const operationCapabilities = manifest.capabilities.filter((item) => item.operation === operation);
  if (operationCapabilities.length === 0) return null;
  if (!method) return operationCapabilities[0];
  return operationCapabilities.find((item) => !item.paymentMethods || item.paymentMethods.includes(method))
    ?? operationCapabilities[0];
}

/** 核心资金路径使用的权威能力判断；支付方式当前按现有全局唯一模型读取。 */
export async function evaluateEffectivePaymentOperation(input: {
  configRow: PaymentChannelConfigRow;
  operation: PaymentProviderOperation;
  method?: PaymentMethod;
  currency?: string;
  recovery?: boolean;
}): Promise<{ capability: PaymentProviderCapability | null; decision: PaymentCapabilityDecision }> {
  initPaymentAdapters();
  const manifest = getProviderManifest(input.configRow.channel);
  const capability = declaredCapability(input.configRow, input.operation, input.method);
  if (!capability) {
    return {
      capability: null,
      decision: {
        supported: false,
        reasonCode: 'OPERATION_UNSUPPORTED',
        reason: `渠道适配器未实现 ${input.operation}`,
        missingConfigFields: [],
      },
    };
  }
  // Every operation that receives a concrete method must validate the tenant's
  // method configuration. Provider manifests may omit `paymentMethods` for
  // operations shared by all methods (refund/query/transfer), but that does
  // not make a disabled or unconfigured method valid.
  const methodRows = input.method
    ? await db
      .select()
      .from(paymentMethodConfigs)
      .where(and(
        eq(paymentMethodConfigs.method, input.method),
        exactTenantCondition(paymentMethodConfigs.tenantId, input.configRow.tenantId),
      ))
      .limit(1)
    : [];
  const methodByCode = new Map(methodRows.map((item) => [item.method, item]));
  return {
    capability,
    decision: decidePaymentCapability({
      configRow: input.configRow,
      manifestSandboxFields: manifest.sandboxRequiredConfigFields,
      capability,
      method: input.method ?? null,
      currency: input.currency ?? 'CNY',
      methodByCode,
      recovery: input.recovery,
    }),
  };
}

export async function assertEffectivePaymentOperation(input: {
  configRow: PaymentChannelConfigRow;
  operation: PaymentProviderOperation;
  method?: PaymentMethod;
  currency?: string;
  recovery?: boolean;
}): Promise<PaymentProviderCapability> {
  const { capability, decision } = await evaluateEffectivePaymentOperation(input);
  if (capability && decision.supported) return capability;
  const status = decision.reasonCode === 'ENGINE_OFF'
    ? 503
    : decision.reasonCode === 'ENGINE_MODE_MISMATCH'
      ? 403
      : 400;
  throw new HTTPException(status, {
    message: `${decision.reasonCode ?? 'CAPABILITY_UNSUPPORTED'}: ${decision.reason ?? '支付能力不可用'}`,
  });
}
