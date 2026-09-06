import { and, eq } from 'drizzle-orm';
import { db } from '../../db';
import { exactTenantCondition } from '../../lib/tenant';
import { oauth2Clients, paymentApps } from '../../db/schema';
import { openEventBus } from '../../lib/open-event-bus';
import { paymentEventBus } from '../../lib/payment-event-bus';
import logger from '../../lib/logger';

let registered = false;

export function registerPaymentOpenWebhookBridge(): void {
  if (registered) return;
  registered = true;
  paymentEventBus.onAny(async (event) => {
    // Payment events without an application scope cannot be routed to an
    // external Webhook, but that optional integration must never make the
    // authoritative payment outbox fail or retry indefinitely.
    if (event.appId == null) {
      logger.warn('[payment-open-webhook] skipped event without application scope', { eventId: event.eventId, type: event.type });
      return;
    }
    const tenantScope = exactTenantCondition(paymentApps.tenantId, event.tenantId ?? null);
    const [binding] = await db
      .select({ clientId: oauth2Clients.clientId })
      .from(paymentApps)
      .innerJoin(oauth2Clients, eq(oauth2Clients.id, paymentApps.openClientId))
      .where(and(
        eq(paymentApps.id, event.appId),
        eq(paymentApps.status, 'enabled'),
        eq(oauth2Clients.status, 'enabled'),
        tenantScope,
      ))
      .limit(1);
    // An app may be disabled/unbound after the payment was completed. Treat
    // this as a deliberate no-op; only persistence/transport errors below
    // should propagate and trigger the payment outbox retry policy.
    if (!binding) {
      logger.warn('[payment-open-webhook] skipped event for unbound application', { eventId: event.eventId, appId: event.appId, tenantId: event.tenantId ?? null });
      return;
    }
    await openEventBus.emitAndWait({
      type: event.type,
      clientId: binding.clientId,
      tenantId: event.tenantId ?? null,
      eventId: event.eventId,
      data: {
        orderNo: event.orderNo,
        bizType: event.bizType,
        bizId: event.bizId,
        channel: event.channel,
        payMethod: event.payMethod ?? null,
        currency: event.currency,
        amount: event.amount,
        originalAmount: event.originalAmount ?? null,
        refundNo: event.refundNo ?? null,
        refundAmount: event.refundAmount ?? null,
        occurredAt: event.occurredAt,
      },
    });
  });
  logger.info('[payment-open-webhook] bridge registered');
}
