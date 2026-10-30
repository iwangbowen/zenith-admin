import type { PaymentEvent } from '../../lib/payment-event-bus';
import { registerEventConsumer } from '../../lib/domain-events';
import { formatDateTime } from '../../lib/datetime';
import { settlePaymentEventWithin } from './payment-local-settlement.service';
import { preparePaymentOpenWebhookWithin } from './payment-open-webhook-bridge.service';

let registered = false;
function readPaymentEvent(fact: { eventId: string; occurredAt: Date; payload: Record<string, unknown> }): PaymentEvent {
  const payload = fact.payload as unknown as PaymentEvent;
  if (!payload.type || !payload.orderNo || !payload.bizType || !payload.bizId) throw new Error('Payment event snapshot is incomplete');
  return { ...payload, eventId: fact.eventId, occurredAt: formatDateTime(fact.occurredAt) };
}

/** Payment facts have one local settlement consistency unit; optional handoffs follow it. */
export function registerPaymentEventConsumers(): void {
  if (registered) return;
  registered = true;
  registerEventConsumer({ key: 'payment.local-settlement', matches: (event) => event.domain === 'payment',
    handle: async (tx, fact) => { await settlePaymentEventWithin(tx, readPaymentEvent(fact)); return { outcome: 'completed' }; },
  });
  registerEventConsumer({ key: 'payment.open-webhook', after: ['payment.local-settlement'], matches: (event) => event.domain === 'payment',
    handle: async (tx, fact) => {
      const ids = await preparePaymentOpenWebhookWithin(tx, readPaymentEvent(fact));
      return ids.length ? { outcome: 'handed_off', refs: { deliveryIds: ids } } : { outcome: 'skipped', reason: 'payment application is not bound to an open client' };
    },
  });
}
