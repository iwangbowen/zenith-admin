import { canonicalEntityRefSchema, entityWatchContract, ENTITY_TIMELINE_EVENT_LABELS, getDomainEventDefinition, isWatchableDomainEvent, isWatchableEntityType, watchedEntityDetailRoute, type CanonicalEntityRef } from '@zenith/shared/platform';
import { permissionList } from '@zenith/shared/core';
import { mock } from '@/mocks/utils/contract';
import { currentMockSession, mockUserPermissions, type MockSession } from '@/mocks/utils/auth';
import { forbidden, notFound, unauthorized, badRequest } from '@/mocks/utils/handlers';
import { resolveAnchor } from './entity-relations';
import { registerMockWatchObserver } from '@/mocks/data/entity-watch-events';
import { getNextInAppMessageId, mockInAppMessages } from '@/mocks/data/in-app-messages';
import { mockDateTime } from '@/mocks/utils/date';
import { recordMockNotification } from '@/mocks/data/entity-subjects';

const watches = new Map<string, { ref: CanonicalEntityRef; session: MockSession }>();
const sent = new Set<string>();
const keyOf = (ref: CanonicalEntityRef, session: MockSession) => JSON.stringify([session.user.id, session.viewingTenantId ?? session.user.tenantId ?? null, ref.type, ref.key]);

registerMockWatchObserver((event) => {
  if (!isWatchableDomainEvent(event.eventType)) return;
  const source = canonicalEntityRefSchema.safeParse(event.sourceRef);
  const definition = getDomainEventDefinition(event.eventType);
  if (!source.success || !definition) return;
  for (const { ref, session } of watches.values()) {
    const dedupe = `${event.id}:${session.user.id}`;
    if (sent.has(dedupe) || session.user.status !== 'enabled') continue;
    if (!(ref.type === source.data.type && ref.key === source.data.key) && !event.subjectRefs.some((subject) => subject.type === ref.type && subject.key === ref.key)) continue;
    const permissions = mockUserPermissions(session.user);
    if (!permissions.includes('*') && !permissionList(definition.permission).some((permission) => permissions.includes(permission))) continue;
    const anchor = resolveAnchor(ref, session);
    if (!anchor || !resolveAnchor(source.data, session)) continue;
    const link = watchedEntityDetailRoute(source.data) ?? watchedEntityDetailRoute(ref);
    if (!link) continue;
    sent.add(dedupe);
    const label = ENTITY_TIMELINE_EVENT_LABELS[event.eventType as keyof typeof ENTITY_TIMELINE_EVENT_LABELS];
    mockInAppMessages.unshift({ id: getNextInAppMessageId(), templateId: null, templateName: null, userId: session.user.id,
      username: session.user.username, title: `${anchor.title} · ${label}`, content: `你关注的对象发生了业务变化：${label}。`,
      type: 'info', source: 'system', isRead: false, readAt: null, senderId: null, senderName: null, link, createdAt: mockDateTime() });
    recordMockNotification('platform.entity.changed', [ref, source.data], session.user.id);
  }
});

export const entityWatchesHandlers = [
  mock(entityWatchContract.state, ({ params, request, ok }) => {
    const session = currentMockSession(request);
    if (!session) return unauthorized('请先登录', { status: 401 });
    if (!resolveAnchor(params, session)) return notFound('对象不存在或无权查看', { status: 404 });
    return ok({ supported: isWatchableEntityType(params.type), watching: watches.has(keyOf(params, session)) });
  }),
  mock(entityWatchContract.follow, ({ params, request, ok }) => {
    const session = currentMockSession(request);
    if (!session) return unauthorized('请先登录', { status: 401 });
    if (session.impersonation) return forbidden('模拟登录期间不能改变个人关注', { status: 403 });
    if (!isWatchableEntityType(params.type)) return badRequest('该对象暂无可关注的业务事件', { status: 400 });
    if (!resolveAnchor(params, session)) return notFound('对象不存在或无权查看', { status: 404 });
    watches.set(keyOf(params, session), { ref: params, session });
    return ok({ supported: true, watching: true });
  }),
  mock(entityWatchContract.unfollow, ({ params, request, ok }) => {
    const session = currentMockSession(request);
    if (!session) return unauthorized('请先登录', { status: 401 });
    if (session.impersonation) return forbidden('模拟登录期间不能改变个人关注', { status: 403 });
    watches.delete(keyOf(params, session));
    return ok({ supported: isWatchableEntityType(params.type), watching: false });
  }),
];
