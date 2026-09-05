import { asc } from 'drizzle-orm';
import {
  PAYMENT_PROVIDER_OPERATIONS as SHARED_PAYMENT_PROVIDER_OPERATIONS,
  type PaymentCapabilitiesResponse,
  type PaymentCapabilityQuery,
  type PaymentConfigCapabilities,
  type PaymentEffectiveCapability,
  type PaymentMethod,
} from '@zenith/shared/payment';
import { db } from '../../db';
import {
  paymentChannelConfigs,
  paymentMethodConfigs,
  type PaymentChannelConfigRow,
  type PaymentMethodConfigRow,
} from '../../db/schema';
import { config } from '../../config';
import { currentUser } from '../../lib/context';
import { tenantCondition } from '../../lib/tenant';
import {
  initPaymentAdapters,
  listProviderManifests,
  type PaymentProviderCapability,
  type PaymentProviderOperation,
} from '../../lib/payment';
import { decidePaymentCapability, paymentConfigEnvironment } from './payment-capability-evaluator';

/** 契约枚举中的每个操作都必须是适配器已实现的操作（PaymentProviderOperation） */
export const PAYMENT_PROVIDER_OPERATIONS = SHARED_PAYMENT_PROVIDER_OPERATIONS satisfies readonly PaymentProviderOperation[];

function capabilityRows(
  row: PaymentChannelConfigRow,
  providerName: string,
  manifestSandboxFields: readonly string[],
  capabilities: readonly PaymentProviderCapability[],
  methodByCode: ReadonlyMap<PaymentMethod, PaymentMethodConfigRow>,
  query: PaymentCapabilityQuery,
): PaymentConfigCapabilities {
  const environment = paymentConfigEnvironment(row);
  const declared = query.operation
    ? capabilities.filter((capability) => capability.operation === query.operation)
    : [...capabilities];

  let rows: PaymentEffectiveCapability[];
  if (declared.length === 0 && query.operation) {
    rows = [{
      operation: query.operation,
      environment,
      declaredEnvironments: [],
      paymentMethod: query.method ?? null,
      currency: query.currency ?? 'CNY',
      execution: null,
      limits: null,
      supported: false,
      reasonCode: 'OPERATION_UNSUPPORTED',
      reason: `渠道适配器未实现 ${query.operation}`,
      missingConfigFields: [],
    }];
  } else {
    rows = declared.flatMap((capability) => {
      if (query.method && capability.paymentMethods && !capability.paymentMethods.includes(query.method)) {
        return [{ capability, method: query.method }];
      }
      if (query.method && !capability.paymentMethods) return [];
      const methods: Array<PaymentMethod | null> = query.method
        ? [query.method]
        : capability.paymentMethods?.length
          ? [...capability.paymentMethods]
          : [null];
      return methods.map((method) => ({ capability, method }));
    }).flatMap(({ capability, method }) => {
      const currencies = query.currency ? [query.currency] : [...capability.currencies];
      return currencies.map((currency): PaymentEffectiveCapability => {
        const decision = decidePaymentCapability({
          configRow: row,
          manifestSandboxFields,
          capability,
          method,
          currency,
          methodByCode,
        });
        return {
          operation: capability.operation,
          environment,
          declaredEnvironments: [...capability.environments],
          paymentMethod: method,
          currency,
          execution: capability.execution,
          limits: capability.limits
            ? {
                maxAmount: capability.limits.maxAmount ?? null,
                receiverNameRequiredAtOrAbove: capability.limits.receiverNameRequiredAtOrAbove ?? null,
              }
            : null,
          ...decision,
        };
      });
    });
  }

  const supported = rows.some((capability) => capability.supported);
  return {
    channelConfigId: row.id,
    tenantId: row.tenantId ?? null,
    configName: row.name,
    channel: row.channel,
    environment,
    configStatus: row.status,
    providerName,
    supported,
    reason: supported ? null : rows[0]?.reason ?? '没有符合当前上下文的有效能力',
    capabilities: rows,
  };
}

export async function listEffectivePaymentCapabilities(
  query: PaymentCapabilityQuery = {},
): Promise<PaymentCapabilitiesResponse> {
  initPaymentAdapters();
  const user = currentUser();
  const configScope = tenantCondition(paymentChannelConfigs, user);
  const methodScope = tenantCondition(paymentMethodConfigs, user);
  const [merchantConfigs, methodConfigs] = await Promise.all([
    db.select().from(paymentChannelConfigs).where(configScope).orderBy(asc(paymentChannelConfigs.id)),
    db.select().from(paymentMethodConfigs).where(methodScope).orderBy(asc(paymentMethodConfigs.sort), asc(paymentMethodConfigs.id)),
  ]);
  const methodByCode = new Map(methodConfigs.map((item) => [item.method, item]));
  const manifests = new Map(listProviderManifests().map((manifest) => [manifest.channel, manifest]));

  const configs = merchantConfigs
    .filter((row) => query.channelConfigId == null || row.id === query.channelConfigId)
    .filter((row) => query.channel == null || row.channel === query.channel)
    .map((row) => {
      const manifest = manifests.get(row.channel);
      if (!manifest) {
        return {
          channelConfigId: row.id,
          tenantId: row.tenantId ?? null,
          configName: row.name,
          channel: row.channel,
          environment: paymentConfigEnvironment(row),
          configStatus: row.status,
          providerName: row.channel,
          supported: false,
          reason: '渠道适配器未注册',
          capabilities: [],
        } satisfies PaymentConfigCapabilities;
      }
      return capabilityRows(
        row,
        manifest.displayName,
        manifest.sandboxRequiredConfigFields,
        manifest.capabilities,
        methodByCode,
        { ...query, currency: query.currency?.toUpperCase() },
      );
    });

  return { engineMode: config.payment.engineMode, configs };
}
