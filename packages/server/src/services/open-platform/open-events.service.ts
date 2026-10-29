import type { SubjectRef } from '@zenith/shared/core';
import type { DbTransaction } from '../../db/types';
import { publishEventInTx, registerEventConsumer } from '../../lib/domain-events';
import { formatDateTime } from '../../lib/datetime';

export interface OpenPlatformEvent {
  type: string; eventId: string; clientId: string | null; tenantId: number | null;
  scope?: { siteId?: number; spaceId?: number }; occurredAt: string; data: Record<string, unknown>;
}
let registered = false;
/** Metadata and handlers are declared identically by API and worker roles. */
export function registerOpenEventConsumer(): void {
  if (registered) return;
  registerEventConsumer({ key: 'open.webhook.prepare', matches: (event) => ['cms', 'drive', 'iot', 'open-platform'].includes(event.domain),
    handle: async (tx, event) => {
      const { prepareAppWebhookDeliveriesWithin } = await import('./app-webhooks.service');
      const ids = await prepareAppWebhookDeliveriesWithin(tx, { ...event.payload, eventId: event.eventId,
        occurredAt: formatDateTime(event.occurredAt), tenantId: event.tenantId,
      } as unknown as OpenPlatformEvent);
      return ids.length ? { outcome: 'handed_off', refs: { deliveryIds: ids } } : { outcome: 'skipped', reason: 'no_authorized_subscriptions' };
    },
  });
  registered = true;
}

export function publishOpenEventInTx(tx: DbTransaction, input: {
  type: string; tenantId: number | null; clientId?: string | null; scope?: OpenPlatformEvent['scope'];
  data: Record<string, unknown>; businessKey: string; orderingKey: string; subjects: readonly SubjectRef[];
}) {
  registerOpenEventConsumer();
  const domain = input.type.startsWith('cms.') ? 'cms' : input.type.startsWith('drive.') ? 'drive' : input.type.startsWith('iot.') ? 'iot' : 'open-platform';
  return publishEventInTx(tx, { domain, eventType: input.type, tenantId: input.tenantId, businessKey: input.businessKey,
    orderingKey: input.orderingKey, subjectRefs: input.subjects, scope: input.scope,
    payload: { type: input.type, tenantId: input.tenantId, clientId: input.clientId ?? null, scope: input.scope ?? {}, data: input.data },
  });
}
