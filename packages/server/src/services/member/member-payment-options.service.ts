import { and, asc, eq } from 'drizzle-orm';
import { PAYMENT_DEDUCT_METHODS, PAYMENT_METHOD_CHANNEL, PAYMENT_METHOD_LABELS } from '@zenith/shared/payment';
import type { MemberPaymentApplicationOption } from '@zenith/shared/member';
import { db } from '../../db';
import { paymentApps, paymentChannelConfigs } from '../../db/schema';
import { currentMember } from '../../lib/member-context';
import { exactTenantCondition } from '../../lib/tenant';
import { listEffectiveCashierMethods } from '../payment/payment-cashier-capability.service';
import { evaluateEffectivePaymentOperation } from '../payment/payment-capability-evaluator';
import { resolveApplicationChannelConfig } from '../payment/payment-apps.service';

export async function listMemberPaymentOptions(): Promise<MemberPaymentApplicationOption[]> {
  const tenantId = currentMember().tenantId ?? null;
  const tenantScope = exactTenantCondition(paymentApps.tenantId, tenantId);
  const apps = await db
    .select({ id: paymentApps.id, name: paymentApps.name })
    .from(paymentApps)
    .where(and(eq(paymentApps.status, 'enabled'), tenantScope))
    .orderBy(asc(paymentApps.id));

  const options: MemberPaymentApplicationOption[] = [];
  for (const app of apps) {
    const cashierMethods = await listEffectiveCashierMethods({ tenantId, applicationId: app.id });
    const deductMethods: MemberPaymentApplicationOption['deductMethods'] = [];
    for (const method of PAYMENT_DEDUCT_METHODS) {
      try {
        const route = await resolveApplicationChannelConfig(app.id, PAYMENT_METHOD_CHANNEL[method], tenantId);
        const configTenant = exactTenantCondition(paymentChannelConfigs.tenantId, tenantId);
        const [config] = await db
          .select()
          .from(paymentChannelConfigs)
          .where(and(eq(paymentChannelConfigs.id, route.channelConfigId), configTenant))
          .limit(1);
        if (!config) continue;
        const { decision } = await evaluateEffectivePaymentOperation({
          configRow: config,
          operation: 'contract.sign',
          method,
          currency: 'CNY',
        });
        if (decision.supported) deductMethods.push({ method, label: PAYMENT_METHOD_LABELS[method] });
      } catch {
        // An application simply omits methods for channels it does not bind.
      }
    }
    if (cashierMethods.length === 0 && deductMethods.length === 0) continue;
    options.push({
      id: app.id,
      name: app.name,
      cashierMethods: cashierMethods.map(({ method, label, icon }) => ({ method, label, icon })),
      deductMethods,
    });
  }
  return options;
}
