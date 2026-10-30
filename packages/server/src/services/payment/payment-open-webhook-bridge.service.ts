import { and, eq } from 'drizzle-orm';
import type { DbTransaction } from '../../db/types';
import { exactTenantCondition } from '../../lib/tenant';
import { oauth2Clients, paymentApps } from '../../db/schema';
import type { PaymentEvent } from '../../lib/payment-event-bus';
import { publishOpenEventInTx } from '../open-platform/open-events.service';

export async function preparePaymentOpenWebhookWithin(tx: DbTransaction, event: PaymentEvent): Promise<number[]> {
  if (event.appId == null) return [];
  const tenantScope = exactTenantCondition(paymentApps.tenantId, event.tenantId ?? null);
  const [binding] = await tx.select({ clientId: oauth2Clients.clientId })
    .from(paymentApps).innerJoin(oauth2Clients, eq(oauth2Clients.id, paymentApps.openClientId))
    .where(and(eq(paymentApps.id, event.appId), eq(paymentApps.status, 'enabled'), eq(oauth2Clients.status, 'enabled'), tenantScope)).limit(1);
  if (!binding) return [];
  const stored = await publishOpenEventInTx(tx, {
    type: event.type, clientId: binding.clientId, tenantId: event.tenantId ?? null,
    businessKey: `payment-open:${event.eventId}`, orderingKey: `payment:${event.orderNo}`,
    subjects: event.subjectRefs ?? [{ type: 'payment.order', key: event.orderNo, role: 'primary' }],
    data: { orderNo: event.orderNo, bizType: event.bizType, bizId: event.bizId, channel: event.channel,
      payMethod: event.payMethod ?? null, currency: event.currency, amount: event.amount,
      originalAmount: event.originalAmount ?? null, refundNo: event.refundNo ?? null, refundAmount: event.refundAmount ?? null,
      occurredAt: event.occurredAt },
  });
  return [stored.id];
}
