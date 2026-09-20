import { ENTITY_RELATION_TYPES, SEARCH_TYPE_ENTITY_TYPES, entityRelationsContract, entityTimelineContract, globalSearchContract, type CanonicalEntityRef, type CanonicalEntityType, type EntityRelationItem, type EntityRelationSection, type GlobalSearchType, type GlobalSearchResult } from '@zenith/shared/platform';
import type { TimelineEvent } from '@zenith/shared/core';
import { mock } from '@/mocks/utils/contract';
import { badRequest, forbidden, notFound, unauthorized } from '@/mocks/utils/handlers';
import { currentMockSession, isMockPlatformAdmin, mockUserPermissions, type MockSession } from '@/mocks/utils/auth';
import { mockPaymentOrders, mockPaymentRefunds } from '@/mocks/data/payment';
import { mockUsers } from '@/mocks/data/users';
import { mockMembers } from '@/mocks/data/members';
import { mockIotDevices, mockIotAlarms } from '@/mocks/data/iot';
import { mockWorkflowDefinitions, mockWorkflowInstances, mockWorkflowTasks } from '@/mocks/data/workflow';
import { mockDriveNodes } from '@/mocks/data/drive';
import { mockWikiDocs } from '@/mocks/data/wiki';
import { mockCmsContents } from '@/mocks/data/cms';
import { mockOperationLogs } from '@/mocks/data/logs';
import { entityDetailRoute } from '@/utils/entity-relations';
import dayjs from 'dayjs';

const manualLinks = new Map<string, readonly [CanonicalEntityRef, CanonicalEntityRef]>();
function refId(ref: CanonicalEntityRef) { return `${ref.type}:${ref.key}`; }
function linkId(source: CanonicalEntityRef, target: CanonicalEntityRef) { return [refId(source), refId(target)].sort().join('|'); }
function canManageLinks(session: MockSession) {
  const permissions = mockUserPermissions(session.user);
  return !session.impersonation?.readOnly && (permissions.includes('*') || permissions.includes('system:relation:manage'));
}

const READ_PERMISSIONS: Partial<Record<CanonicalEntityType, string>> = {
  'identity.user': 'system:user:list', 'member.member': 'member:member:list', 'payment.order': 'payment:order:list',
  'payment.refund': 'payment:refund:list', 'iot.device': 'iot:device:list', 'iot.alarm': 'iot:alarm:list',
  'workflow.definition': 'workflow:definition:list', 'workflow.instance': 'workflow:instance:list',
  'workflow.task': 'workflow:task:list', 'drive.file': 'drive:node:list', 'wiki.document': 'wiki:doc:list', 'cms.content': 'cms:content:list',
  'platform.operation-log': 'system:log:list',
};

function canReadType(session: MockSession, type: CanonicalEntityType) {
  const permissions = mockUserPermissions(session.user);
  return permissions.includes('*') || Boolean(READ_PERMISSIONS[type] && permissions.includes(READ_PERMISSIONS[type]!));
}

function resolveAnchor(ref: CanonicalEntityRef, session: MockSession): { ref: CanonicalEntityRef; title: string } | undefined {
  if (!canReadType(session, ref.type) || !/^[1-9]\d*$/.test(ref.key)) return undefined;
  const id = Number(ref.key);
  // Demo rows without tenant ownership represent the platform fixture set; never reuse them in a viewed tenant.
  if (session.viewingTenantId != null) return undefined;
  if (!isMockPlatformAdmin(session.user) && ref.type !== 'identity.user' && ref.type !== 'workflow.instance') return undefined;
  switch (ref.type) {
    case 'identity.user': {
      const row = mockUsers.find((item) => item.id === id && (isMockPlatformAdmin(session.user) || item.id === session.user.id));
      return row ? { ref, title: row.nickname || row.username } : undefined;
    }
    case 'member.member': { const row = mockMembers.find((item) => item.id === id); return row ? { ref, title: row.nickname || row.username || `会员 #${id}` } : undefined; }
    case 'payment.order': { const row = mockPaymentOrders.find((item) => item.id === id); return row ? { ref, title: row.orderNo } : undefined; }
    case 'payment.refund': { const row = mockPaymentRefunds.find((item) => item.id === id); return row ? { ref, title: row.refundNo } : undefined; }
    case 'iot.device': { const row = mockIotDevices.find((item) => item.id === id); return row ? { ref, title: row.name } : undefined; }
    case 'iot.alarm': { const row = mockIotAlarms.find((item) => item.id === id); return row ? { ref, title: row.ruleName } : undefined; }
    case 'workflow.instance': {
      const row = mockWorkflowInstances.find((item) => item.id === id && (isMockPlatformAdmin(session.user) || item.initiatorId === session.user.id));
      return row ? { ref, title: row.title } : undefined;
    }
    case 'workflow.definition': { const row = mockWorkflowDefinitions.find((item) => item.id === id); return row ? { ref, title: row.name } : undefined; }
    case 'workflow.task': { const row = mockWorkflowTasks.find((item) => item.id === id); return row ? { ref, title: row.nodeName } : undefined; }
    case 'drive.file': { const row = mockDriveNodes.find((item) => item.id === id && !item.deletedAt); return row ? { ref, title: row.name } : undefined; }
    case 'wiki.document': { const row = mockWikiDocs.find((item) => item.id === id && !item.deletedAt); return row ? { ref, title: row.title } : undefined; }
    case 'cms.content': { const row = mockCmsContents.find((item) => item.id === id); return row ? { ref, title: row.title } : undefined; }
    case 'platform.operation-log': { const row = mockOperationLogs.find((item) => item.id === id); return row ? { ref, title: row.description || row.module || `操作记录 #${row.id}` } : undefined; }
    default: return undefined;
  }
}

function sectionsFor(type: CanonicalEntityType, session: MockSession): EntityRelationSection[] {
  const definitions: Partial<Record<CanonicalEntityType, Array<[string, CanonicalEntityType]>>> = {
    'payment.order': [['payment.order.refunds', 'payment.refund']],
    'payment.refund': [['payment.refund.order', 'payment.order']],
    'identity.user': [['identity.user.payment-orders', 'payment.order']],
    'iot.device': [['iot.device.alarms', 'iot.alarm']],
    'iot.alarm': [['iot.alarm.device', 'iot.device']],
    'workflow.instance': [['workflow.instance.approval-tasks', 'workflow.task']],
    'workflow.task': [['workflow.task.instance', 'workflow.instance']],
    'cms.content': [['cms.content.related', 'cms.content']],
  };
  const sections: EntityRelationSection[] = (definitions[type] ?? []).filter(([, target]) => canReadType(session, target)).map(([key, target]) => ({
    key, labelKey: `relation.${key}`, targetTypes: [target], kind: 'direct', cardinality: 'many', capabilities: { view: true, open: true },
  }));
  sections.push({ key: `${type}.links`, labelKey: 'relation.common.related', targetTypes: [...ENTITY_RELATION_TYPES], kind: 'direct', cardinality: 'many', capabilities: { view: true, open: true } });
  return sections;
}

function relationItems(ref: CanonicalEntityRef, sectionKey: string, session: MockSession): EntityRelationItem[] {
  const id = Number(ref.key);
  const rows: Array<{ type: CanonicalEntityType; id: number; title: string; subtitle?: string | null; createdAt?: string | null }> = [];
  if (sectionKey === `${ref.type}.links`) return [...manualLinks.values()].flatMap(([source, target]) => {
    const other = refId(source) === refId(ref) ? target : refId(target) === refId(ref) ? source : undefined;
    const anchor = other && resolveAnchor(other, session);
    return anchor ? [{ ref: anchor.ref, title: anchor.title, relationKey: sectionKey, capabilities: { view: true, open: true } }] : [];
  });
  if (sectionKey === 'payment.order.refunds') rows.push(...mockPaymentRefunds.filter((row) => row.orderId === id).map((row) => ({ type: 'payment.refund' as const, id: row.id, title: row.refundNo, subtitle: row.reason, createdAt: row.createdAt })));
  if (sectionKey === 'payment.refund.order') {
    const refund = mockPaymentRefunds.find((row) => row.id === id);
    rows.push(...mockPaymentOrders.filter((row) => row.id === refund?.orderId).map((row) => ({ type: 'payment.order' as const, id: row.id, title: row.orderNo, subtitle: row.subject, createdAt: row.createdAt })));
  }
  if (sectionKey === 'identity.user.payment-orders') rows.push(...mockPaymentOrders.filter((row) => row.userId === id).map((row) => ({ type: 'payment.order' as const, id: row.id, title: row.orderNo, subtitle: row.subject, createdAt: row.createdAt })));
  if (sectionKey === 'iot.device.alarms') rows.push(...mockIotAlarms.filter((row) => row.deviceId === id).map((row) => ({ type: 'iot.alarm' as const, id: row.id, title: row.ruleName, subtitle: row.message, createdAt: row.createdAt })));
  if (sectionKey === 'iot.alarm.device') {
    const alarm = mockIotAlarms.find((row) => row.id === id);
    rows.push(...mockIotDevices.filter((row) => row.id === alarm?.deviceId).map((row) => ({ type: 'iot.device' as const, id: row.id, title: row.name, createdAt: row.createdAt })));
  }
  if (sectionKey === 'workflow.instance.approval-tasks') rows.push(...mockWorkflowTasks.filter((row) => row.instanceId === id).map((row) => ({ type: 'workflow.task' as const, id: row.id, title: row.nodeName, createdAt: row.createdAt })));
  if (sectionKey === 'workflow.task.instance') {
    const task = mockWorkflowTasks.find((row) => row.id === id);
    rows.push(...mockWorkflowInstances.filter((row) => row.id === task?.instanceId).map((row) => ({ type: 'workflow.instance' as const, id: row.id, title: row.title, createdAt: row.createdAt })));
  }
  if (sectionKey === 'cms.content.related') {
    const content = mockCmsContents.find((row) => row.id === id);
    rows.push(...mockCmsContents.filter((row) => content?.relatedIds?.includes(row.id)).map((row) => ({ type: 'cms.content' as const, id: row.id, title: row.title, createdAt: row.createdAt })));
  }
  return rows.filter((row) => resolveAnchor({ type: row.type, key: String(row.id) }, session)).sort((a, b) => b.id - a.id).map((row) => ({
    ref: { type: row.type, key: String(row.id) }, relationKey: sectionKey, title: row.title,
    subtitle: row.subtitle, occurredAt: row.createdAt, capabilities: { view: true, open: true },
  }));
}

function pageOf<T>(items: T[], cursor: string | undefined, limit: number) {
  const offset = cursor && /^\d+$/.test(cursor) ? Number(cursor) : 0;
  const hasMore = offset + limit < items.length;
  return { items: items.slice(offset, offset + limit), hasMore, nextCursor: hasMore ? String(offset + limit) : null };
}

export const entityRelationsHandlers = [
  mock(globalSearchContract.search, ({ query, request, ok }) => {
    const session = currentMockSession(request);
    if (!session) return unauthorized('请先登录', { status: 401 });
    const groups: Array<[GlobalSearchType, Array<{ id: number; title: string; subtitle?: string | null }>]> = [
      ['user', mockUsers.map((row) => ({ id: row.id, title: row.nickname || row.username, subtitle: row.username }))],
      ['member', mockMembers.map((row) => ({ id: row.id, title: row.nickname || row.username || `会员 #${row.id}`, subtitle: row.username }))],
      ['order', mockPaymentOrders.map((row) => ({ id: row.id, title: row.orderNo, subtitle: row.subject }))],
      ['workflow', mockWorkflowInstances.map((row) => ({ id: row.id, title: row.title }))],
      ['file', mockDriveNodes.map((row) => ({ id: row.id, title: row.name }))],
      ['iot-device', mockIotDevices.map((row) => ({ id: row.id, title: row.name, subtitle: row.sn }))],
      ['iot-alarm', mockIotAlarms.map((row) => ({ id: row.id, title: row.ruleName, subtitle: row.message }))],
      ['cms-content', mockCmsContents.map((row) => ({ id: row.id, title: row.title }))],
      ['wiki-document', mockWikiDocs.map((row) => ({ id: row.id, title: row.title }))],
      ['operation-log', mockOperationLogs.map((row) => ({ id: row.id, title: row.description || row.module || `操作记录 #${row.id}` }))],
    ];
    const filter = query.types?.split(',');
    const keyword = query.q.toLocaleLowerCase();
    const results: GlobalSearchResult[] = groups.flatMap(([type, rows]) => {
      if (filter && !filter.includes(type)) return [];
      return rows.filter((row) => `${row.title} ${row.subtitle ?? ''}`.toLocaleLowerCase().includes(keyword)
        && resolveAnchor({ type: SEARCH_TYPE_ENTITY_TYPES[type], key: String(row.id) }, session)).slice(0, query.limit).map((row) => {
        const ref = { type: SEARCH_TYPE_ENTITY_TYPES[type], key: String(row.id) };
        return { type, id: String(row.id), title: row.title, subtitle: row.subtitle, highlights: [], actions: { view: true, download: false },
          route: entityDetailRoute(ref) ?? `/search?entityType=${encodeURIComponent(ref.type)}&entityKey=${encodeURIComponent(ref.key)}` };
      });
    });
    return ok({ results, partial: false, failedTypes: [] });
  }),
  mock(entityRelationsContract.link, ({ params, body, request, ok }) => {
    const session = currentMockSession(request);
    if (!session) return unauthorized('请先登录', { status: 401 });
    if (!canManageLinks(session)) return forbidden('无权管理关联', { status: 403 });
    if (!resolveAnchor(params, session) || !resolveAnchor(body.target, session)) return notFound('对象不存在', { status: 404 });
    if (refId(params) === refId(body.target)) return badRequest('不能关联对象自身', { status: 400 });
    manualLinks.set(linkId(params, body.target), [params, body.target]);
    return ok(null);
  }),
  mock(entityRelationsContract.unlink, ({ params, body, request, ok }) => {
    const session = currentMockSession(request);
    if (!session) return unauthorized('请先登录', { status: 401 });
    if (!canManageLinks(session)) return forbidden('无权管理关联', { status: 403 });
    if (!resolveAnchor(params, session) || !resolveAnchor(body.target, session)) return notFound('对象不存在', { status: 404 });
    manualLinks.delete(linkId(params, body.target));
    return ok(null);
  }),
  mock(entityRelationsContract.describe, ({ params, request, ok }) => {
    const session = currentMockSession(request);
    if (!session) return unauthorized('请先登录', { status: 401 });
    const anchor = resolveAnchor(params, session);
    return anchor ? ok({ anchor, sections: sectionsFor(params.type, session), canManageLinks: canManageLinks(session) }) : notFound('对象不存在', { status: 404 });
  }),
  mock(entityRelationsContract.section, ({ params, query, request, ok }) => {
    const session = currentMockSession(request);
    if (!session) return unauthorized('请先登录', { status: 401 });
    if (!resolveAnchor(params, session) || !sectionsFor(params.type, session).some((section) => section.key === params.sectionKey)) return notFound('对象或分组不存在', { status: 404 });
    const items = relationItems(params, params.sectionKey, session);
    return ok({ ...pageOf(items, query.cursor, query.limit), total: items.length });
  }),
];

export const entityTimelineHandlers = [
  mock(entityTimelineContract.timeline, ({ params, query, request, ok }) => {
    const session = currentMockSession(request);
    if (!session) return unauthorized('请先登录', { status: 401 });
    if (!resolveAnchor(params, session)) return notFound('对象不存在', { status: 404 });
    const events: TimelineEvent[] = [];
    if (params.type === 'payment.order') {
      const order = mockPaymentOrders.find((row) => String(row.id) === params.key);
      if (order) {
        const payload = { orderNo: order.orderNo, amount: order.amount, currency: order.currency };
        if (order.paidAt) events.push({ id: `order:${order.id}:paid`, eventType: 'payment.succeeded', occurredAt: dayjs(order.paidAt).toISOString(), sourceRef: params, subjectRefs: [{ ...params, role: 'primary' }], visibility: 'restricted', payload });
        for (const refund of mockPaymentRefunds.filter((row) => row.orderId === order.id && row.refundedAt)) {
          if (!canReadType(session, 'payment.refund')) continue;
          events.push({ id: `refund:${refund.id}:succeeded`, eventType: 'refund.succeeded', occurredAt: dayjs(refund.refundedAt!).toISOString(), sourceRef: { type: 'payment.refund', key: String(refund.id) }, subjectRefs: [{ ...params, role: 'related' }], visibility: 'restricted', payload: { ...payload, refundNo: refund.refundNo, refundAmount: refund.refundAmount } });
        }
      }
    }
    events.sort((a, b) => b.occurredAt.localeCompare(a.occurredAt) || b.id.localeCompare(a.id));
    return ok(pageOf(events, query.cursor, query.limit));
  }),
];
