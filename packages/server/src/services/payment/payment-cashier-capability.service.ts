import { and, asc, eq, inArray } from 'drizzle-orm';
import { HTTPException } from 'hono/http-exception';
import { PAYMENT_CASHIER_METHODS, PAYMENT_METHOD_CHANNEL } from '@zenith/shared/payment';
import type { PaymentCashierMethod } from '@zenith/shared/payment';
import { db } from '../../db';
import { exactTenantCondition } from '../../lib/tenant';
import { paymentChannelConfigs, paymentMethodConfigs } from '../../db/schema';
import { evaluateEffectivePaymentOperation } from './payment-capability-evaluator';
import { resolveApplicationChannelConfig } from './payment-apps.service';

export interface EffectiveCashierMethod {
  method: PaymentCashierMethod;
  label: string;
  icon: string | null;
  channelConfigId: number;
}

export async function listEffectiveCashierMethods(input: {
  tenantId: number | null;
  applicationId: number;
  currency?: string;
  allowedMethods?: readonly PaymentCashierMethod[];
  fixedMethod?: PaymentCashierMethod | null;
}): Promise<EffectiveCashierMethod[]> {
  const allowedMethods = input.allowedMethods ?? PAYMENT_CASHIER_METHODS;
  const candidates = input.fixedMethod
    ? allowedMethods.filter((method) => method === input.fixedMethod)
    : [...allowedMethods];
  if (candidates.length === 0) return [];

  const methodTenant = exactTenantCondition(paymentMethodConfigs.tenantId, input.tenantId);
  const methodRows = await db
    .select()
    .from(paymentMethodConfigs)
    .where(and(
      eq(paymentMethodConfigs.enabled, true),
      inArray(paymentMethodConfigs.method, candidates),
      methodTenant,
    ))
    .orderBy(asc(paymentMethodConfigs.sort), asc(paymentMethodConfigs.id));

  const configCache = new Map<number, typeof paymentChannelConfigs.$inferSelect>();
  const result: EffectiveCashierMethod[] = [];
  for (const methodRow of methodRows) {
    const method = methodRow.method as PaymentCashierMethod;
    try {
      const route = await resolveApplicationChannelConfig(
        input.applicationId,
        PAYMENT_METHOD_CHANNEL[method],
        input.tenantId,
      );
      let configRow = configCache.get(route.channelConfigId);
      if (!configRow) {
        const configTenant = exactTenantCondition(paymentChannelConfigs.tenantId, input.tenantId);
        [configRow] = await db
          .select()
          .from(paymentChannelConfigs)
          .where(and(eq(paymentChannelConfigs.id, route.channelConfigId), configTenant))
          .limit(1);
        if (!configRow) continue;
        configCache.set(configRow.id, configRow);
      }
      const { decision } = await evaluateEffectivePaymentOperation({
        configRow,
        operation: 'payment.create',
        method,
        currency: input.currency ?? 'CNY',
      });
      if (!decision.supported) continue;
      result.push({
        method,
        label: methodRow.label,
        icon: methodRow.icon ?? null,
        channelConfigId: configRow.id,
      });
    } catch (error) {
      if (error instanceof HTTPException) continue;
      throw error;
    }
  }
  return result;
}

export async function assertEffectiveCashierMethod(input: {
  tenantId: number | null;
  applicationId: number;
  method: PaymentCashierMethod;
  currency?: string;
  allowedMethods?: readonly PaymentCashierMethod[];
}): Promise<EffectiveCashierMethod> {
  const [available] = await listEffectiveCashierMethods({
    tenantId: input.tenantId,
    applicationId: input.applicationId,
    currency: input.currency,
    allowedMethods: input.allowedMethods,
    fixedMethod: input.method,
  });
  if (!available) {
    throw new HTTPException(400, {
      message: `支付应用绑定的商户配置当前不支持支付方式 ${input.method}`,
    });
  }
  return available;
}
