import { canReadBusinessChainFixtures, mockBusinessChainItem, mockBusinessChainRefs, mockBusinessChainSections } from './entity-business-chains';
import { mockIotBusinessEvents } from '@/mocks/data/entity-watch-events';
import { canonicalEntityRefSchema, MANUAL_RELATION_CATALOG, type ManualRelationType } from '@zenith/shared/platform';
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
import { mockAsyncTasks, mockAsyncTaskTerminalEvents } from './async-tasks';
import { mockEntitySubjects, mockNotificationOutboxes, mockNotificationDispatches } from '@/mocks/data/entity-subjects';
import { mockFinancialItem, mockFinancialRelationRefs, mockFinancialSections } from './entity-financial-relations';
import { WORKFLOW_BUSINESS_ENTITY_TYPES } from '@zenith/shared/platform/workflow-business-catalog';
import { mockBizLeaves } from '@/mocks/data/biz-leave';
import { mockPaymentReconAdjustments } from './payment-ext';
import { mockWorkflowAttachmentLinks, canReadMockWorkflowAttachmentForSession } from '@/mocks/utils/workflow-attachments';
import { entityRelationRecordFilters, explainEntityRelation, normalizeEntityRelationFilters, supportsEntityRelationFilters } from '@zenith/shared/platform';
import { includesKeyword, matchesFilter, withinDateRange } from '@/mocks/utils/filter';
import { formatDateTime } from '@/utils/date';

const manualLinks = new Map<string, { source: CanonicalEntityRef; target: CanonicalEntityRef; type: ManualRelationType; note: string | null; createdByName: string | null; createdAt: string }>();
function refId(ref: CanonicalEntityRef) { return `${ref.type}:${ref.key}`; }
function linkId(source: CanonicalEntityRef, target: CanonicalEntityRef, type: ManualRelationType) {
  const endpoints = [refId(source), refId(target)];
  return [type, ...(MANUAL_RELATION_CATALOG[type].symmetric ? endpoints.sort() : endpoints)].join('|');
}
function canManageLinks(session: MockSession) {
  const permissions = mockUserPermissions(session.user);
  return !session.impersonation?.readOnly && (permissions.includes('*') || permissions.includes('system:relation:manage'));
}

function needsAttention(item: EntityRelationItem): boolean {
  if (item.attention !== undefined) return item.attention;
  const id = Number(item.ref.key);
  switch (item.ref.type) {
    case 'payment.refund': {
      const refund = mockPaymentRefunds.find((row) => row.id === id);
      return refund?.approvalStatus === 'pending' || refund?.status === 'failed' || refund?.status === 'unknown';
    }
    case 'workflow.instance':
      return mockWorkflowInstances.some((row) => row.id === id && row.status === 'running')
        && mockWorkflowTasks.some((task) => task.instanceId === id && task.status === 'pending');
    case 'workflow.task': {
      const task = mockWorkflowTasks.find((row) => row.id === id);
      return task?.status === 'pending' && mockWorkflowInstances.some((row) => row.id === task.instanceId && row.status === 'running');
    }
    case 'notification.outbox': return mockNotificationOutboxes.some((row) => row.id === id && row.status === 'failed');
    case 'tasks.async': return mockAsyncTasks.some((row) => row.id === id && row.status === 'failed');
    case 'platform.operation-log': return mockOperationLogs.some((row) => row.id === id && (row.responseCode ?? 0) >= 400);
    case 'iot.alarm': return mockIotAlarms.some((row) => row.id === id && (row.status === 'firing' || row.status === 'acknowledged'));
    default: return false;
  }
}

const READ_PERMISSIONS: Partial<Record<CanonicalEntityType, string>> = {
  'member.wallet-transaction': 'member:wallet:list', 'member.vip-renewal': 'member:member:list',
  'iot.ota-task': 'iot:ota:list', 'iot.ota-device': 'iot:ota:list', 'iot.firmware': 'iot:ota:list', 'messaging.announcement': 'system:announcement:list',
  'identity.user': 'system:user:list', 'member.member': 'member:member:list', 'payment.order': 'payment:order:list',
  'payment.refund': 'payment:refund:list', 'iot.device': 'iot:device:list', 'iot.alarm': 'iot:alarm:list',
  'workflow.definition': 'workflow:definition:list', 'workflow.instance': 'workflow:instance:list',
  'workflow.task': 'workflow:task:list', 'drive.file': 'drive:node:list', 'wiki.document': 'wiki:doc:list', 'cms.content': 'cms:content:list',
  'platform.operation-log': 'system:log:operation', 'notification.outbox': 'system:notify-policy:list', 'tasks.async': 'system:async-task:list',
  'payment.journal': 'payment:ledger:list', 'payment.recon-case': 'payment:recon:list', 'payment.recon-adjustment': 'payment:recon:list',
  'payment.sharing-order': 'payment:sharing:list', 'payment.sharing-receiver': 'payment:sharing:list', 'payment.sharing-reversal': 'payment:sharing:list',
  'payment.settlement-batch': 'payment:settlement:list', 'payment.notify-log': 'payment:log:list',
};

function canReadType(session: MockSession, type: CanonicalEntityType) {
  const permissions = mockUserPermissions(session.user);
  if (type === 'platform.managed-file') return canReadBusinessChainFixtures(session);
  if (type === 'biz.leave') return true;
  if (type === 'workflow.archive') return isMockPlatformAdmin(session.user);
  if (type === 'workflow.attachment') return permissions.includes('*') || ['workflow:instance:list', 'workflow:task:handle', 'workflow:instance:monitor'].some((permission) => permissions.includes(permission));
  return permissions.includes('*') || Boolean(READ_PERMISSIONS[type] && permissions.includes(READ_PERMISSIONS[type]!));
}

export function resolveAnchor(ref: CanonicalEntityRef, session: MockSession): { ref: CanonicalEntityRef; title: string } | undefined {
  const chain = canReadBusinessChainFixtures(session) && canReadType(session, ref.type) ? mockBusinessChainItem(ref) : undefined;
  if (chain) return { ref, title: chain.title };
  if (!canReadType(session, ref.type) || !/^[1-9]\d*$/.test(ref.key)) return undefined;
  const id = Number(ref.key);
  if (ref.type === 'workflow.attachment') {
    const row = mockWorkflowAttachmentLinks.find((item) => item.id === id);
    return row && canReadMockWorkflowAttachmentForSession(session, row) ? { ref, title: row.name } : undefined;
  }
  if (ref.type === 'biz.leave') {
    const row = mockBizLeaves.find((item) => item.id === id && item.applicantId === session.user.id);
    const tenantId = session.viewingTenantId ?? session.user.tenantId;
    return row && (tenantId == null ? isMockPlatformAdmin(session.user) || row.tenantId == null : row.tenantId === tenantId)
      ? { ref, title: `请假申请 #${id}` } : undefined;
  }
  if (ref.type === 'workflow.archive') {
    const row = mockWorkflowInstances.find((item) => item.id === id);
    return row?.archive && resolveAnchor({ type: 'workflow.instance', key: ref.key }, session) ? { ref, title: `${row.title} · 审批归档件` } : undefined;
  }
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
    case 'tasks.async': { const row = mockAsyncTasks.find((item) => item.id === id); return row ? { ref, title: row.title } : undefined; }
    case 'notification.outbox': { const row = mockNotificationOutboxes.find((item) => item.id === id); return row ? { ref, title: row.title } : undefined; }
    default: { const item = mockFinancialItem(ref); return item ? { ref, title: item.title } : undefined; }
  }
}

function sectionsFor(type: CanonicalEntityType, session: MockSession, key: string): EntityRelationSection[] {
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
    key, labelKey: `relation.${key}`, targetTypes: [target], kind: 'direct', cardinality: 'many', capabilities: { view: true, open: true }, summaryState: 'unavailable',
  }));
  sections.push(...mockBusinessChainSections({ type, key }).filter((section) => section.targetTypes.some((target) => canReadType(session, target))));
  sections.push(...mockFinancialSections(type).filter((section) => section.targetTypes.some((target) => canReadType(session, target))));
  const addWorkflowSection = (suffix: string, target: CanonicalEntityType) => {
    if (canReadType(session, target)) sections.push({ key: `${type}.${suffix}`, labelKey: `relation.${type}.${suffix}`, targetTypes: [target], kind: 'derived', cardinality: 'many', capabilities: { view: true, open: true }, summaryState: 'unavailable' });
  };
  if (WORKFLOW_BUSINESS_ENTITY_TYPES.some((item) => item.entityType === type)) {
    addWorkflowSection('workflow-instances', 'workflow.instance'); addWorkflowSection('archives', 'workflow.archive'); addWorkflowSection('attachments', 'workflow.attachment');
  }
  if (type === 'workflow.instance') {
    const source = mockWorkflowInstances.find((item) => item.id === Number(key));
    const business = WORKFLOW_BUSINESS_ENTITY_TYPES.find((item) => item.bizType === source?.bizType);
    if (business && source?.bizId) { addWorkflowSection(business.reverseRelation, business.entityType); addWorkflowSection('business-history', 'workflow.instance'); }
    addWorkflowSection('archives', 'workflow.archive'); addWorkflowSection('attachments', 'workflow.attachment');
  }
  if (type === 'workflow.task') addWorkflowSection('attachments', 'workflow.attachment');
  if (type === 'workflow.attachment') { addWorkflowSection('instance', 'workflow.instance'); addWorkflowSection('approval-tasks', 'workflow.task'); }
  if (type === 'workflow.archive') addWorkflowSection('instance', 'workflow.instance');
  if (['platform.operation-log', 'tasks.async', 'notification.outbox'].includes(type)) {
    sections.push({ key: `${type}.subjects`, labelKey: 'relation.common.subjects', targetTypes: [...ENTITY_RELATION_TYPES], kind: 'direct', cardinality: 'many', capabilities: { view: true, open: true }, summaryState: 'unavailable' });
  }
  for (const [suffix, target] of [['audit', 'platform.operation-log'], ['tasks', 'tasks.async'], ['notifications', 'notification.outbox']] as const) {
    if (canReadType(session, target)) sections.push({ key: `${type}.${suffix}`, labelKey: `relation.common.${suffix}`, targetTypes: [target], kind: 'activity', cardinality: 'many', capabilities: { view: true, open: true }, summaryState: 'unavailable' });
  }
  sections.push({ key: `${type}.links`, labelKey: 'relation.common.related', targetTypes: [...ENTITY_RELATION_TYPES], kind: 'direct', cardinality: 'many', capabilities: { view: true, open: true }, summaryState: 'unavailable' });
  return sections.map((section) => {
    const items = relationItems({ type, key }, section.key, session);
    const hasAttention = items.some(needsAttention);
    const keywordOnly = section.key.endsWith('.links') || section.key.endsWith('.subjects')
      || type === 'workflow.attachment' || type === 'workflow.archive'
      || (type === 'workflow.instance' && WORKFLOW_BUSINESS_ENTITY_TYPES.some((business) => section.key === `workflow.instance.${business.reverseRelation}`));
    const financial = mockFinancialSections(type).some((entry) => entry.key === section.key);
    const target = section.targetTypes[0];
    const attentionOnly = !financial && ['payment.refund', 'workflow.instance', 'workflow.task', 'notification.outbox', 'tasks.async', 'platform.operation-log', 'iot.alarm'].includes(target);
    return { ...section, filters: section.filters ?? (keywordOnly ? { keyword: true } : entityRelationRecordFilters(target, attentionOnly)),
      summaryState: hasAttention ? 'attention' : items.length > 0 ? 'has-data' : 'empty' };
  });
}

function relationItems(ref: CanonicalEntityRef, sectionKey: string, session: MockSession): EntityRelationItem[] {
  const id = Number(ref.key);
  const rows: Array<{ type: CanonicalEntityType; id: number; title: string; subtitle?: string | null; createdAt?: string | null }> = [];
  const fromRefs = (refs: readonly CanonicalEntityRef[]): EntityRelationItem[] => refs.flatMap((target) => {
    const anchor = resolveAnchor(target, session);
    return anchor ? [mockBusinessChainItem(target, sectionKey) ?? mockFinancialItem(target, sectionKey) ?? { ref: target, title: anchor.title, relationKey: sectionKey, capabilities: { view: true, open: true } }] : [];
  });
  const chainRefs = mockBusinessChainRefs(ref, sectionKey);
  if (chainRefs !== undefined) return fromRefs(chainRefs);
  if (sectionKey === `${ref.type}.subjects`) return fromRefs(mockEntitySubjects.get(refId(ref)) ?? []);
  if (ref.type === 'workflow.attachment') {
    const link = mockWorkflowAttachmentLinks.find((item) => item.id === id);
    if (!link || !canReadMockWorkflowAttachmentForSession(session, link)) return [];
    if (sectionKey === 'workflow.attachment.instance') return fromRefs([{ type: 'workflow.instance', key: String(link.instanceId) }]);
    if (sectionKey === 'workflow.attachment.approval-tasks') return link.taskId ? fromRefs([{type:'workflow.task',key:String(link.taskId)}]) : [];
  }
  const business = WORKFLOW_BUSINESS_ENTITY_TYPES.find((item) => item.entityType === ref.type);
  const sourceInstance = mockWorkflowInstances.find((item) => item.id === id);
  const businessTenant = ref.type === 'biz.leave' ? mockBizLeaves.find((item) => item.id === id)?.tenantId
    : ref.type === 'cms.content' ? null : mockPaymentReconAdjustments.find((item) => item.id === id)?.tenantId;
  if (sectionKey === `${ref.type}.attachments`) {
    const rounds = business ? mockWorkflowInstances.filter((item) => item.bizType === business.bizType && item.bizId === ref.key && (item.tenantId ?? null) === (businessTenant ?? null)).map((item)=>item.id) : [];
    return fromRefs(mockWorkflowAttachmentLinks.filter((link) => ref.type === 'workflow.instance' ? link.instanceId === id : ref.type === 'workflow.task' ? link.taskId === id : rounds.includes(link.instanceId))
      .toSorted((a,b)=>b.instanceId-a.instanceId||b.id-a.id).map((link)=>({type:'workflow.attachment',key:String(link.id)})));
  }
  if (business && ["workflow-instances", "archives"].some((suffix) => sectionKey === `${ref.type}.${suffix}`)) {
    const archives = sectionKey.endsWith('.archives');
    return fromRefs(mockWorkflowInstances.filter((item) => item.bizType === business.bizType && item.bizId === ref.key && (item.tenantId ?? null) === (businessTenant ?? null) && (!archives || item.archive))
      .toSorted((a, b) => b.id - a.id).map((item) => ({ type: archives ? 'workflow.archive' : 'workflow.instance', key: String(item.id) })));
  }
  if (ref.type === 'workflow.instance' && sourceInstance) {
    const target = WORKFLOW_BUSINESS_ENTITY_TYPES.find((item) => sectionKey === `workflow.instance.${item.reverseRelation}` && item.bizType === sourceInstance.bizType);
    if (target && sourceInstance.bizId) return fromRefs([{ type: target.entityType, key: sourceInstance.bizId }]);
    if (sectionKey === 'workflow.instance.business-history') return fromRefs(mockWorkflowInstances.filter((item) => sourceInstance.bizType && sourceInstance.bizId && item.id !== id && item.bizType === sourceInstance.bizType && item.bizId === sourceInstance.bizId && item.tenantId === sourceInstance.tenantId)
      .toSorted((a,b) => b.id-a.id).map((item) => ({type:'workflow.instance',key:String(item.id)})));
    if (sectionKey === 'workflow.instance.archives' && sourceInstance.archive) return fromRefs([{type:'workflow.archive',key:ref.key}]);
  }
  if (ref.type === 'workflow.archive' && sectionKey === 'workflow.archive.instance') return fromRefs([{type:'workflow.instance',key:ref.key}]);
  const commonTarget = ({ audit: 'platform.operation-log', tasks: 'tasks.async', notifications: 'notification.outbox' } as const)[sectionKey.slice(`${ref.type}.`.length) as 'audit' | 'tasks' | 'notifications'];
  if (commonTarget) return fromRefs([...mockEntitySubjects.entries()].flatMap(([source, subjects]) => {
    if (!source.startsWith(`${commonTarget}:`) || !subjects.some((subject) => refId(subject) === refId(ref))) return [];
    return [{ type: commonTarget, key: source.slice(commonTarget.length + 1) }];
  }));
  if (mockFinancialSections(ref.type).some((section) => section.key === sectionKey)) return fromRefs(mockFinancialRelationRefs(ref, sectionKey));
  if (sectionKey === `${ref.type}.links`) return [...manualLinks.values()].flatMap(({ source, target, type, note, createdByName, createdAt }) => {
    const other = refId(source) === refId(ref) ? target : refId(target) === refId(ref) ? source : undefined;
    const anchor = other && resolveAnchor(other, session);
    const definition = MANUAL_RELATION_CATALOG[type];
    const forward = refId(source) === refId(ref);
    return anchor ? [{ ref: anchor.ref, title: anchor.title, relationKey: sectionKey, subtitle: forward ? definition.label : definition.reverseLabel, description: note,
      manual: { type, direction: definition.symmetric ? 'symmetric' as const : forward ? 'outgoing' as const : 'incoming' as const, note, createdByName },
      origin: { kind: 'direct' as const, relatedAt: createdAt }, capabilities: { view: true, open: true } }] : [];
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

/** Reuse the same backing records as the business pages, before any pagination. */
function relationRecordFields(item: EntityRelationItem): EntityRelationItem {
  const id = Number(item.ref.key);
  let record: { status?: string | number | null; createdAt?: string | null; updatedAt?: string | null } | undefined;
  let occurredAt = item.occurredAt;
  switch (item.ref.type) {
    case 'payment.order': record = mockPaymentOrders.find((row) => row.id === id); break;
    case 'payment.refund': record = mockPaymentRefunds.find((row) => row.id === id); break;
    case 'workflow.instance': record = mockWorkflowInstances.find((row) => row.id === id); break;
    case 'workflow.task': record = mockWorkflowTasks.find((row) => row.id === id); break;
    case 'iot.device': record = mockIotDevices.find((row) => row.id === id); break;
    case 'iot.alarm': {
      const alarm = mockIotAlarms.find((row) => row.id === id);
      record = alarm; occurredAt = alarm?.firedAt ?? occurredAt; break;
    }
    case 'cms.content': record = mockCmsContents.find((row) => row.id === id); occurredAt = record?.updatedAt ?? occurredAt; break;
    case 'wiki.document': record = mockWikiDocs.find((row) => row.id === id); occurredAt = record?.updatedAt ?? occurredAt; break;
    case 'drive.file': record = mockDriveNodes.find((row) => row.id === id); occurredAt = record?.updatedAt ?? occurredAt; break;
    case 'workflow.attachment': record = mockWorkflowAttachmentLinks.find((row) => row.id === id); break;
    case 'workflow.archive': occurredAt = mockWorkflowInstances.find((row) => row.id === id)?.archive?.archivedAt; break;
    case 'notification.outbox': record = mockNotificationOutboxes.find((row) => row.id === id); break;
    case 'tasks.async': record = mockAsyncTasks.find((row) => row.id === id); break;
    case 'platform.operation-log': {
      const log = mockOperationLogs.find((row) => row.id === id);
      record = log ? { status: log.responseCode, createdAt: log.createdAt } : undefined; break;
    }
  }
  return { ...item, status: record?.status == null ? item.status : String(record.status),
    occurredAt: occurredAt ?? record?.createdAt, attention: item.attention ?? needsAttention(item) };
}

function relationAction(item: EntityRelationItem, session: MockSession): EntityRelationItem['action'] {
  const permissions = mockUserPermissions(session.user);
  const allowed = (permission: string) => !session.impersonation?.readOnly && (permissions.includes('*') || permissions.includes(permission));
  const id = Number(item.ref.key);
  if (item.ref.type === 'payment.refund' && allowed('payment:refund:approve') && mockPaymentRefunds.some((row) => row.id === id && row.approvalStatus === 'pending')) return { label: '审核退款', target: item.ref };
  if (item.ref.type === 'tasks.async' && allowed('system:async-task:manage') && ['failed', 'cancelled'].includes(item.status ?? '')) return { label: '处理任务', target: item.ref };
  if (item.ref.type === 'iot.alarm' && allowed('iot:alarm:resolve') && ['firing', 'acknowledged'].includes(item.status ?? '')) return { label: '处理告警', target: item.ref };
  if (item.ref.type === 'workflow.task' && allowed('workflow:task:handle')) {
    const task = mockWorkflowTasks.find((row) => row.id === id && row.status === 'pending' && row.assigneeId === session.user.id);
    if (task && mockWorkflowInstances.some((instance) => instance.id === task.instanceId && instance.status === 'running')) return { label: '办理审批', target: { type: 'workflow.instance', key: String(task.instanceId) } };
  }
  if (item.ref.type === 'workflow.instance' && allowed('workflow:task:handle') && item.status === 'running'
    && mockWorkflowTasks.some((task) => task.instanceId === id && task.status === 'pending' && task.assigneeId === session.user.id)) return { label: '办理审批', target: item.ref };
  return undefined;
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
    const key = linkId(params, body.target, body.relationType);
    if (!manualLinks.has(key)) manualLinks.set(key, { source: params, target: body.target, type: body.relationType, note: body.note?.trim() || null,
      createdByName: session.user.nickname, createdAt: formatDateTime(new Date()) });
    return ok(null);
  }),
  mock(entityRelationsContract.unlink, ({ params, body, request, ok }) => {
    const session = currentMockSession(request);
    if (!session) return unauthorized('请先登录', { status: 401 });
    if (!canManageLinks(session)) return forbidden('无权管理关联', { status: 403 });
    if (!resolveAnchor(params, session)) return notFound('对象不存在', { status: 404 });
    const [source, target] = body.direction === 'incoming' ? [body.target, params] : [params, body.target];
    manualLinks.delete(linkId(source, target, body.relationType));
    return ok(null);
  }),
  mock(entityRelationsContract.describe, ({ params, request, ok }) => {
    const session = currentMockSession(request);
    if (!session) return unauthorized('请先登录', { status: 401 });
    const anchor = resolveAnchor(params, session);
    return anchor ? ok({ anchor, sections: sectionsFor(params.type, session, params.key), canManageLinks: canManageLinks(session) }) : notFound('对象不存在', { status: 404 });
  }),
  mock(entityRelationsContract.section, ({ params, query, request, ok }) => {
    const session = currentMockSession(request);
    if (!session) return unauthorized('请先登录', { status: 401 });
    const section = sectionsFor(params.type, session, params.key).find((entry) => entry.key === params.sectionKey);
    if (!resolveAnchor(params, session) || !section) return notFound('对象或分组不存在', { status: 404 });
    const filters = normalizeEntityRelationFilters(query);
    if (!supportsEntityRelationFilters(filters, section.filters)) return badRequest('该关联分组不支持所选筛选条件', { status: 400 });
    const scope = JSON.stringify([params.type, params.key, params.sectionKey, filters, session.user.id,
      session.user.tenantId, session.viewingTenantId ?? null, session.impersonation ?? null]);
    let offset = 0;
    if (query.cursor) {
      try {
        const decoded = JSON.parse(decodeURIComponent(query.cursor)) as { scope: string; offset: number };
        if (decoded.scope !== scope || !Number.isSafeInteger(decoded.offset) || decoded.offset < 0) throw new Error();
        offset = decoded.offset;
      } catch { return badRequest('关联分页游标无效或不属于当前筛选', { status: 400 }); }
    }
    const items = relationItems(params, params.sectionKey, session).map(relationRecordFields).map((item) => ({ ...item, action: relationAction(item, session),
      origin: { ...item.origin, kind: section.kind, explanation: explainEntityRelation(section) },
    })).filter((item) => includesKeyword(filters.keyword, item.title, item.subtitle, item.description, item.ref.key, { caseInsensitive: true })
      && (!filters.status || item.status === filters.status)
      && withinDateRange(item.occurredAt ? formatDateTime(item.occurredAt) : undefined, filters.startTime, filters.endTime)
      && (!filters.attentionOnly || item.attention));
    const page = pageOf(items, String(offset), query.limit);
    return ok({ ...page, nextCursor: page.hasMore ? encodeURIComponent(JSON.stringify({ scope, offset: offset + query.limit })) : null });
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
    for (const task of mockAsyncTasks) {
      const sourceRef = { type: 'tasks.async', key: String(task.id) } as const;
      const related = mockEntitySubjects.get(refId(sourceRef)) ?? [];
      if (refId(sourceRef) !== refId(params) && !related.some((ref) => refId(ref) === refId(params))) continue;
      if (!resolveAnchor(sourceRef, session)) continue;
      events.push({ id: `task:${task.id}:created`, eventType: 'tasks.async-task.created', occurredAt: dayjs(task.createdAt).toISOString(),
        sourceRef, subjectRefs: [{ ...params, role: 'related' }], visibility: 'restricted', payload: { taskType: task.taskType } });
    }
    for (const event of mockAsyncTaskTerminalEvents) {
      if (!event.sourceRef || (refId(event.sourceRef as CanonicalEntityRef) !== refId(params) && !event.subjectRefs.some((ref) => refId(ref as CanonicalEntityRef) === refId(params)))) continue;
      if (!resolveAnchor(event.sourceRef as CanonicalEntityRef, session)) continue;
      events.push({ ...event, subjectRefs: [{ ...params, role: 'related' }] });
    }
    for (const outbox of mockNotificationOutboxes) {
      const sourceRef = { type: 'notification.outbox', key: String(outbox.id) } as const;
      const related = mockEntitySubjects.get(refId(sourceRef)) ?? [];
      if (refId(sourceRef) !== refId(params) && !related.some((ref) => refId(ref) === refId(params))) continue;
      if (!resolveAnchor(sourceRef, session)) continue;
      events.push({ id: `outbox:${outbox.id}:queued`, eventType: 'messaging.notification.queued', occurredAt: dayjs(outbox.createdAt).toISOString(),
        sourceRef, subjectRefs: [{ ...params, role: 'related' }], visibility: 'restricted', payload: { eventKey: outbox.eventKey } });
      const dispatches = mockNotificationDispatches.filter((dispatch) => dispatch.outboxId === outbox.id);
      const completedAt = dispatches.at(-1)?.createdAt;
      if (completedAt && ['done', 'failed'].includes(outbox.status)) events.push({
        id: `outbox:${outbox.id}:${outbox.status}`, eventType: outbox.status === 'done' ? 'messaging.notification.dispatched' : 'messaging.notification.failed',
        occurredAt: dayjs(completedAt).toISOString(), sourceRef, subjectRefs: [{ ...params, role: 'related' }], visibility: 'restricted',
        payload: { eventKey: outbox.eventKey, status: outbox.status, sent: dispatches.filter((item) => item.decision === 'sent').length,
          failed: dispatches.filter((item) => item.decision === 'failed').length, deferred: 0, suppressed: 0 },
      });
    }
    for (const event of mockIotBusinessEvents) {
      const source = canonicalEntityRefSchema.safeParse(event.sourceRef);
      if (source.success && resolveAnchor(source.data, session) && event.subjectRefs.some((ref) => ref.type === params.type && ref.key === params.key)) {
        events.push({ ...event, subjectRefs: [{ ...params, role: 'related' }] });
      }
    }
    const filtered = events.filter((event) => matchesFilter(event.eventType, query.eventType)
      && withinDateRange(formatDateTime(event.occurredAt), query.startTime, query.endTime));
    filtered.sort((a, b) => b.occurredAt.localeCompare(a.occurredAt) || b.id.localeCompare(a.id));
    const scope = JSON.stringify([params.type, params.key, query.eventType ?? null, query.startTime ?? null, query.endTime ?? null,
      session.user.id, session.viewingTenantId ?? null, session.impersonation ?? null]);
    let offset = 0;
    if (query.cursor) {
      try {
        const decoded = JSON.parse(decodeURIComponent(query.cursor)) as { scope: string; offset: number };
        if (decoded.scope !== scope || !Number.isSafeInteger(decoded.offset) || decoded.offset < 0) throw new Error();
        offset = decoded.offset;
      } catch { return badRequest('时间线分页游标无效', { status: 400 }); }
    }
    const page = pageOf(filtered, String(offset), query.limit);
    return ok({ ...page, nextCursor: page.hasMore ? encodeURIComponent(JSON.stringify({ scope, offset: offset + query.limit })) : null });
  }),
];
