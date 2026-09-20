import { NOTIFICATION_CHANNELS, NOTIFICATION_EVENTS, NOTIFICATION_EVENT_GROUP_LABELS, isNotificationEventKey, notificationPolicyContract, type NotificationEventDef, type NotificationPolicyEvent } from '@zenith/shared/messaging';
import { mock } from '@/mocks/utils/contract';
import { badRequest, forbidden, unauthorized } from '@/mocks/utils/handlers';
import { currentMockSession, mockUserPermissions } from '@/mocks/utils/auth';
import { mockNotificationDispatches, recordMockNotification } from '@/mocks/data/entity-subjects';
import { matchesFilter, withinDateRange } from '@/mocks/utils/filter';

const overrides = new Map<string, { enabled: boolean; locked: boolean }>();
const scopeKey = (request: Request) => {
  const session = currentMockSession(request);
  return String(session?.viewingTenantId ?? session?.user.tenantId ?? 'platform');
};
function authorize(request: Request, permission: string) {
  const session = currentMockSession(request);
  if (!session) return unauthorized('请先登录', { status: 401 });
  const permissions = mockUserPermissions(session.user);
  return permissions.includes('*') || permissions.includes(permission) ? null : forbidden('没有通知策略权限', { status: 403 });
}

export const notificationPoliciesHandlers = [
  mock(notificationPolicyContract.events, ({ request, ok }) => {
    const error = authorize(request, 'system:notify-policy:list');
    if (error) return error;
    const events: NotificationPolicyEvent[] = Object.entries(NOTIFICATION_EVENTS).map(([key, definition]) => {
      const event: NotificationEventDef = definition;
      return { key, group: event.group, groupLabel: NOTIFICATION_EVENT_GROUP_LABELS[event.group], label: event.label,
        description: event.description, severity: event.severity, mandatory: event.mandatory ?? false, bypassQuietHours: event.bypassQuietHours ?? false,
        channels: NOTIFICATION_CHANNELS.map((channel) => ({ channel, available: (event.availableChannels ?? event.defaultChannels).includes(channel),
          defaultEnabled: event.defaultChannels.includes(channel), override: overrides.get(`${scopeKey(request)}:${key}:${channel}`) ?? null })) };
    });
    return ok(events);
  }),
  mock(notificationPolicyContract.dispatches, ({ request, query, ok, paginate }) => {
    const error = authorize(request, 'system:notify-policy:list');
    if (error) return error;
    const session = currentMockSession(request)!;
    const tenantId = session.viewingTenantId ?? session.user.tenantId ?? null;
    return ok(paginate(mockNotificationDispatches.filter((row) => row.tenantId === tenantId
      && matchesFilter(row.eventKey, query.eventKey) && matchesFilter(row.channel, query.channel)
      && matchesFilter(row.decision, query.decision) && matchesFilter(row.recipientType, query.recipientType)
      && matchesFilter(row.recipientId, query.recipientId) && withinDateRange(row.createdAt, query.startTime, query.endTime)).toReversed()));
  }),
  mock(notificationPolicyContract.testFire, ({ request, body, ok }) => {
    const error = authorize(request, 'system:notify-policy:test');
    if (error) return error;
    if (!isNotificationEventKey(body.eventKey)) return badRequest('通知事件不存在', { status: 400 });
    const session = currentMockSession(request)!;
    if (session.viewingTenantId != null || session.user.tenantId != null) return forbidden('演示通知仅支持平台作用域', { status: 403 });
    return ok({ outboxId: recordMockNotification(body.eventKey, [], session.user.id) });
  }),
  mock(notificationPolicyContract.saveOverride, ({ request, body, ok }) => {
    const error = authorize(request, 'system:notify-policy:save');
    if (error) return error;
    overrides.set(`${scopeKey(request)}:${body.eventKey}:${body.channel}`, { enabled: body.enabled, locked: body.locked });
    return ok(null);
  }),
  mock(notificationPolicyContract.resetOverride, ({ request, body, ok }) => {
    const error = authorize(request, 'system:notify-policy:save');
    if (error) return error;
    overrides.delete(`${scopeKey(request)}:${body.eventKey}:${body.channel}`);
    return ok(null);
  }),
];
