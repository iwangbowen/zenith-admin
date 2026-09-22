import { and, desc, eq, exists, gte, lt } from 'drizzle-orm';
import type { CanonicalEntityType, EntityRelationItem } from '@zenith/shared/platform';
import { operationLogs, operationLogSubjects, notificationOutbox, notificationOutboxSubjects, asyncTasks, asyncTaskSubjects } from '../../../../db/schema';
import { exactTenantCondition, tenantCondition } from '../../../../lib/tenant';
import { buildWhere } from '../../../../lib/where-helpers';
import { hasPermission } from '../../../../lib/context';
import type { EntityAnchorResolver, RelationAccessContext, RelationProvider, VisibleEntityAnchor } from '../types';
import { decodeRelationCursor } from '../cursor';
import { relationPage } from '../page';
import { getNotificationEvent, isNotificationEventKey } from '@zenith/shared/messaging';
import { relationSummaryQuery } from '../summary-query';

function notificationTitle(key: string): string {
  return isNotificationEventKey(key) ? getNotificationEvent(key).label : '业务通知';
}

const capabilities = { view: true, open: true };
function auditWhere(anchor: VisibleEntityAnchor, access: RelationAccessContext) {
  return buildWhere(exactTenantCondition(operationLogs.tenantId, anchor.tenantId), tenantCondition(operationLogs, access.user),
    exists(access.db.select({ id: operationLogSubjects.operationLogId }).from(operationLogSubjects).where(and(
      eq(operationLogSubjects.operationLogId, operationLogs.id), eq(operationLogSubjects.entityType, anchor.ref.type),
      eq(operationLogSubjects.entityKey, anchor.ref.key), exactTenantCondition(operationLogSubjects.tenantId, anchor.tenantId)))));
}
function notificationWhere(anchor: VisibleEntityAnchor, access: RelationAccessContext) {
  return buildWhere(exactTenantCondition(notificationOutbox.tenantId, anchor.tenantId), tenantCondition(notificationOutbox, access.user),
    exists(access.db.select({ id: notificationOutboxSubjects.outboxId }).from(notificationOutboxSubjects).where(and(
      eq(notificationOutboxSubjects.outboxId, notificationOutbox.id), eq(notificationOutboxSubjects.entityType, anchor.ref.type),
      eq(notificationOutboxSubjects.entityKey, anchor.ref.key), exactTenantCondition(notificationOutboxSubjects.tenantId, anchor.tenantId)))));
}
function taskWhere(anchor: VisibleEntityAnchor, access: RelationAccessContext) {
  return buildWhere(exactTenantCondition(asyncTasks.tenantId, anchor.tenantId), tenantCondition(asyncTasks, access.user),
    exists(access.db.select({ id: asyncTaskSubjects.taskId }).from(asyncTaskSubjects).where(and(
      eq(asyncTaskSubjects.taskId, asyncTasks.id), eq(asyncTaskSubjects.entityType, anchor.ref.type),
      eq(asyncTaskSubjects.entityKey, anchor.ref.key), exactTenantCondition(asyncTaskSubjects.tenantId, anchor.tenantId)))));
}
export const subjectAnchorResolvers: readonly EntityAnchorResolver[] = [
  { type: 'platform.operation-log', async resolve(ref, access) {
    if (!(await hasPermission('system:log:operation')) || !/^[1-9]\d*$/.test(ref.key)) return null;
    const [row] = await access.db.select({ title: operationLogs.description, tenantId: operationLogs.tenantId }).from(operationLogs)
      .where(buildWhere(eq(operationLogs.id, Number(ref.key)), tenantCondition(operationLogs, access.user))).limit(1);
    return row ? { ref: { type: 'platform.operation-log', key: ref.key }, title: row.title, tenantId: row.tenantId } : null;
  } },
  { type: 'notification.outbox', async resolve(ref, access) {
    if (!(await hasPermission('system:notify-policy:list')) || !/^[1-9]\d*$/.test(ref.key)) return null;
    const [row] = await access.db.select({ title: notificationOutbox.eventKey, tenantId: notificationOutbox.tenantId }).from(notificationOutbox)
      .where(buildWhere(eq(notificationOutbox.id, Number(ref.key)), tenantCondition(notificationOutbox, access.user))).limit(1);
    return row ? { ref: { type: 'notification.outbox', key: ref.key }, title: notificationTitle(row.title), tenantId: row.tenantId } : null;
  } },
];
export function subjectProviders(sourceType: CanonicalEntityType): readonly RelationProvider[] {
  const spec = (suffix: string, target: EntityRelationItem['ref']['type'], permission: Exclude<RelationProvider['permissions'], 'authenticated'>,
    list: RelationProvider['list'], summaryQuery: NonNullable<RelationProvider['summaryQuery']>): RelationProvider => ({
    sourceType, key: `${sourceType}.${suffix}`, permissions: permission,
    descriptor: { key: `${sourceType}.${suffix}`, labelKey: `relation.common.${suffix}`, targetTypes: [target], kind: 'activity', cardinality: 'many', capabilities }, list, summaryQuery,
  });
  return [
    spec('audit', 'platform.operation-log', ['system:log:operation'], async (anchor, { cursor, limit, access }) => {
      const before = decodeRelationCursor(cursor);
      const rows = await access.db.select({ id: operationLogs.id, title: operationLogs.description, createdAt: operationLogs.createdAt, status: operationLogs.responseCode })
        .from(operationLogs).where(buildWhere(auditWhere(anchor, access),
          before ? lt(operationLogs.id, before) : undefined)).orderBy(desc(operationLogs.id)).limit(limit + 1);
      return relationPage(rows, limit, (row) => ({ ref: { type: 'platform.operation-log', key: String(row.id) }, relationKey: `${sourceType}.audit`, title: row.title.slice(0, 160),
        occurredAt: row.createdAt.toISOString(), status: String(row.status ?? ''), capabilities }));
    }, (anchor, { access }) => {
      const visible = auditWhere(anchor, access);
      return relationSummaryQuery(access.db.select({ id: operationLogs.id }).from(operationLogs).where(visible),
        access.db.select({ id: operationLogs.id }).from(operationLogs).where(buildWhere(visible, gte(operationLogs.responseCode, 400))));
    }),
    spec('notifications', 'notification.outbox', ['system:notify-policy:list'], async (anchor, { cursor, limit, access }) => {
      const before = decodeRelationCursor(cursor);
      const rows = await access.db.select({ id: notificationOutbox.id, title: notificationOutbox.eventKey, createdAt: notificationOutbox.createdAt, status: notificationOutbox.status })
        .from(notificationOutbox).where(buildWhere(notificationWhere(anchor, access),
          before ? lt(notificationOutbox.id, before) : undefined)).orderBy(desc(notificationOutbox.id)).limit(limit + 1);
      return relationPage(rows, limit, (row) => ({ ref: { type: 'notification.outbox', key: String(row.id) }, relationKey: `${sourceType}.notifications`, title: notificationTitle(row.title),
        occurredAt: row.createdAt.toISOString(), status: row.status, origin: { kind: 'activity', eventType: row.title }, capabilities }));
    }, (anchor, { access }) => {
      const visible = notificationWhere(anchor, access);
      return relationSummaryQuery(access.db.select({ id: notificationOutbox.id }).from(notificationOutbox).where(visible),
        access.db.select({ id: notificationOutbox.id }).from(notificationOutbox).where(buildWhere(visible, eq(notificationOutbox.status, 'failed'))));
    }),
    spec('tasks', 'tasks.async', ['system:async-task:list'], async (anchor, { cursor, limit, access }) => {
      const before = decodeRelationCursor(cursor);
      const rows = await access.db.select({ id: asyncTasks.id, title: asyncTasks.title, createdAt: asyncTasks.createdAt, status: asyncTasks.status })
        .from(asyncTasks).where(buildWhere(taskWhere(anchor, access),
          before ? lt(asyncTasks.id, before) : undefined)).orderBy(desc(asyncTasks.id)).limit(limit + 1);
      return relationPage(rows, limit, (row) => ({ ref: { type: 'tasks.async', key: String(row.id) }, relationKey: `${sourceType}.tasks`, title: row.title,
        occurredAt: row.createdAt.toISOString(), status: row.status, capabilities }));
    }, (anchor, { access }) => {
      const visible = taskWhere(anchor, access);
      return relationSummaryQuery(access.db.select({ id: asyncTasks.id }).from(asyncTasks).where(visible),
        access.db.select({ id: asyncTasks.id }).from(asyncTasks).where(buildWhere(visible, eq(asyncTasks.status, 'failed'))));
    }),
  ];
}
