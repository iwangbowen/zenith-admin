import { and, eq } from 'drizzle-orm';
import type { DbTransaction } from '../../db/types';
import { notificationOutboxSubjects, type NotificationOutboxRow } from '../../db/schema';
import { exactTenantCondition } from '../../lib/tenant';
import type { DeliverSummary } from '../../lib/notification/dispatch';
import { recordDomainEvent } from '../platform/relations/events.service';

/** Copy only persisted business subjects; delivery metadata and recipient addresses stay private. */
export async function recordNotificationOutcome(
  tx: DbTransaction, row: NotificationOutboxRow, status: 'done' | 'failed', summary: DeliverSummary,
): Promise<void> {
  const subjects = await tx.select({ type: notificationOutboxSubjects.entityType, key: notificationOutboxSubjects.entityKey, role: notificationOutboxSubjects.role })
    .from(notificationOutboxSubjects).where(and(eq(notificationOutboxSubjects.outboxId, row.id), exactTenantCondition(notificationOutboxSubjects.tenantId, row.tenantId)));
  const source = { type: 'notification.outbox', key: String(row.id) } as const;
  await recordDomainEvent(tx, {
    eventType: status === 'done' ? 'messaging.notification.dispatched' : 'messaging.notification.failed',
    payload: { eventKey: row.eventKey, status, ...summary },
    subjects: subjects.length ? subjects : [{ ...source, role: 'primary' }], source,
    tenantId: row.tenantId, traceId: row.traceId, parentRef: row.parentRef,
    dedupeKey: `notification-outbox:${row.id}:${status}:${row.attempts}:${(row.claimedAt ?? row.createdAt).getTime()}`,
  });
}
