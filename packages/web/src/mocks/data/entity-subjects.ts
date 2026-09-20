import { NOTIFICATION_EVENTS, type NotificationDispatch, type NotificationEventKey } from '@zenith/shared/messaging';
import type { CanonicalEntityRef } from '@zenith/shared/platform';
import { mockDateTime } from '@/mocks/utils/date';
import { mockOperationLogs } from './logs';
import { currentMockSession } from '@/mocks/utils/auth';
import { mockUsers } from './users';

/** Explicit fixture subjects; trace IDs and request text never create business relationships. */
export const mockEntitySubjects = new Map<string, CanonicalEntityRef[]>();
export const mockNotificationOutboxes: Array<{ id: number; title: string; eventKey: NotificationEventKey; createdAt: string }> = [];
export const mockNotificationDispatches: NotificationDispatch[] = [];

export function recordMockSubjects(source: CanonicalEntityRef, subjects: readonly CanonicalEntityRef[]) {
  mockEntitySubjects.set(`${source.type}:${source.key}`, [...new Map(subjects.map((ref) => [`${ref.type}:${ref.key}`, ref])).values()]);
}

export function recordMockOperationAudit(request: Request, description: string, subjects: readonly CanonicalEntityRef[]) {
  const id = Math.max(0, ...mockOperationLogs.map((log) => log.id)) + 1;
  const session = currentMockSession(request);
  mockOperationLogs.push({ id, userId: session?.user.id ?? null, username: session?.user.username ?? null,
    method: request.method, path: new URL(request.url).pathname,
    module: '支付对账', description, requestBody: null, beforeData: null, afterData: null, responseBody: null,
    responseCode: 200, durationMs: 0, ip: null, userAgent: request.headers.get('User-Agent'), os: null, browser: null,
    tenantId: session?.viewingTenantId ?? session?.user.tenantId ?? null, createdAt: mockDateTime() });
  recordMockSubjects({ type: 'platform.operation-log', key: String(id) }, subjects);
}

export function recordMockNotification(eventKey: NotificationEventKey, subjects: readonly CanonicalEntityRef[] = [], recipientId = 1) {
  const event = NOTIFICATION_EVENTS[eventKey];
  const recipient = mockUsers.find((user) => user.id === recipientId);
  const id = (mockNotificationOutboxes.at(-1)?.id ?? 0) + 1;
  const createdAt = mockDateTime();
  mockNotificationOutboxes.push({ id, title: event.label, eventKey, createdAt });
  recordMockSubjects({ type: 'notification.outbox', key: String(id) }, subjects);
  mockNotificationDispatches.push({
    id: 1000 + id, outboxId: id, eventKey, eventLabel: event.label,
    recipientType: 'user', recipientId, recipientName: recipient?.nickname || recipient?.username || null, recipientAddress: null,
    channel: 'inapp', decision: 'sent', reasonCode: null, reasonDetail: null, providerMsgId: null, tenantId: null, createdAt,
  });
  return id;
}
