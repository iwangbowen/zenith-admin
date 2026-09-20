import { desc, eq, inArray, isNull, notInArray } from 'drizzle-orm';
import type { EntityRef } from '@zenith/shared/core';
import type { CanonicalEntityType } from '@zenith/shared/platform';
import { db } from '../../../../db';
import {
  members,
  operationLogSubjects,
  operationLogs,
  paymentOrders,
  users,
} from '../../../../db/schema';
import { getDataScopeCondition } from '../../../../lib/data-scope';
import { hasPermission } from '../../../../lib/context';
import { tenantCondition } from '../../../../lib/tenant';
import { buildWhere } from '../../../../lib/where-helpers';
import type { EntityRelationItem, EntityRelationPage } from '@zenith/shared/platform';
import type { RelationAccessContext, RelationProvider, VisibleEntityAnchor } from '../types';
import { decodeRelationCursor, encodeRelationCursor } from '../cursor';

const USER_TYPE = 'identity.user' as const satisfies CanonicalEntityType;
const MEMBER_TYPE = 'member.member' as const satisfies CanonicalEntityType;
const PAYMENT_ORDER_TYPE = 'payment.order' as const satisfies CanonicalEntityType;
const OPERATION_LOG_TYPE = 'platform.operation-log' as const satisfies CanonicalEntityType;

const USER_PAYMENT_KEY = 'identity.user.payment-orders' as const;
const MEMBER_PAYMENT_KEY = 'member.member.payment-orders' as const;
const USER_AUDIT_KEY = 'identity.user.audit' as const;
const MEMBER_AUDIT_KEY = 'member.member.audit' as const;

/** Payment business keys whose ownership is a member rather than an admin user. */
const MEMBER_PAYMENT_BIZ_TYPES = ['member_recharge', 'member_renewal'] as const;

function parseEntityId(ref: EntityRef): number | null {
  const id = Number(ref.key);
  return Number.isInteger(id) && id > 0 ? id : null;
}

function emptyPage(): EntityRelationPage {
  return { items: [], nextCursor: null, hasMore: false };
}

function pageFromRows<T>(rows: readonly T[], cursor: string | undefined, limit: number, map: (row: T) => EntityRelationItem): EntityRelationPage {
  const offset = decodeRelationCursor(cursor);
  const pageRows = rows.slice(offset, offset + limit);
  const nextOffset = offset + pageRows.length;
  const hasMore = nextOffset < rows.length;
  return {
    items: pageRows.map(map),
    nextCursor: hasMore ? encodeRelationCursor(nextOffset) : null,
    hasMore,
  };
}

async function resolveUserAnchor(ref: EntityRef, access: RelationAccessContext): Promise<VisibleEntityAnchor | null> {
  if (ref.type !== USER_TYPE || !(await hasPermission('system:user:list'))) return null;
  const id = parseEntityId(ref);
  if (id == null) return null;
  const scope = await getDataScopeCondition({
    currentUserId: access.user.userId,
    deptColumn: users.departmentId,
    ownerColumn: users.id,
  });
  const [row] = await db.select({
    id: users.id,
    nickname: users.nickname,
    username: users.username,
    tenantId: users.tenantId,
  })
    .from(users)
    .where(buildWhere(eq(users.id, id), tenantCondition(users, access.user), scope))
    .limit(1);
  if (!row) return null;
  return {
    ref: { type: USER_TYPE, key: String(row.id) },
    title: row.nickname || row.username,
    tenantId: row.tenantId,
    metadata: { id: row.id },
  };
}

async function resolveMemberAnchor(ref: EntityRef, access: RelationAccessContext): Promise<VisibleEntityAnchor | null> {
  if (ref.type !== MEMBER_TYPE || !(await hasPermission('member:member:list'))) return null;
  const id = parseEntityId(ref);
  if (id == null) return null;
  const scope = await getDataScopeCondition({
    currentUserId: access.user.userId,
    ownerColumn: members.createdBy,
  });
  const [row] = await db.select({
    id: members.id,
    nickname: members.nickname,
    username: members.username,
    tenantId: members.tenantId,
  })
    .from(members)
    .where(buildWhere(
      eq(members.id, id),
      isNull(members.deletedAt),
      tenantCondition(members, access.user),
      scope,
    ))
    .limit(1);
  if (!row) return null;
  return {
    ref: { type: MEMBER_TYPE, key: String(row.id) },
    title: row.nickname || row.username || `会员 #${row.id}`,
    tenantId: row.tenantId,
    metadata: { id: row.id },
  };
}

async function listPaymentOrders(
  anchor: VisibleEntityAnchor,
  input: { readonly cursor?: string; readonly limit: number; readonly access: RelationAccessContext },
  owner: 'user' | 'member',
  relationKey: typeof USER_PAYMENT_KEY | typeof MEMBER_PAYMENT_KEY,
): Promise<EntityRelationPage> {
  if (!(await hasPermission('payment:order:list'))) return emptyPage();
  const id = typeof anchor.metadata?.id === 'number' ? anchor.metadata.id : parseEntityId(anchor.ref);
  if (id == null) return emptyPage();
  const scope = await getDataScopeCondition({
    currentUserId: input.access.user.userId,
    deptColumn: paymentOrders.departmentId,
    ownerColumn: paymentOrders.createdBy,
  });
  const where = owner === 'user'
    ? buildWhere(
        eq(paymentOrders.userId, id),
        // Member payment flows historically reuse payment_orders.user_id. They
        // have an explicit biz key and must not appear under an admin user when
        // numeric IDs happen to overlap.
        notInArray(paymentOrders.bizType, MEMBER_PAYMENT_BIZ_TYPES),
        tenantCondition(paymentOrders, input.access.user),
        scope,
      )
    : buildWhere(
        inArray(paymentOrders.bizType, MEMBER_PAYMENT_BIZ_TYPES),
        eq(paymentOrders.bizId, String(id)),
        tenantCondition(paymentOrders, input.access.user),
        scope,
      );
  const rows = await db.select({
    id: paymentOrders.id,
    orderNo: paymentOrders.orderNo,
    subject: paymentOrders.subject,
    status: paymentOrders.status,
    createdAt: paymentOrders.createdAt,
  })
    .from(paymentOrders)
    .where(where)
    .orderBy(desc(paymentOrders.createdAt), desc(paymentOrders.id));
  return pageFromRows(rows, input.cursor, input.limit, (order) => ({
    ref: { type: PAYMENT_ORDER_TYPE, key: String(order.id) },
    relationKey,
    title: order.subject || order.orderNo,
    subtitle: order.orderNo,
    status: order.status,
    occurredAt: order.createdAt.toISOString(),
    capabilities: { view: true, open: true },
  }));
}

async function listAuditLogs(
  anchor: VisibleEntityAnchor,
  input: { readonly cursor?: string; readonly limit: number; readonly access: RelationAccessContext },
  relationKey: typeof USER_AUDIT_KEY | typeof MEMBER_AUDIT_KEY,
): Promise<EntityRelationPage> {
  if (!(await hasPermission('system:log:operation'))) return emptyPage();
  const rows = await db.select({ log: operationLogs })
    .from(operationLogSubjects)
    .innerJoin(operationLogs, eq(operationLogSubjects.operationLogId, operationLogs.id))
    .where(buildWhere(
      eq(operationLogSubjects.entityType, anchor.ref.type),
      eq(operationLogSubjects.entityKey, anchor.ref.key),
      tenantCondition(operationLogSubjects, input.access.user),
      tenantCondition(operationLogs, input.access.user),
    ))
    .orderBy(desc(operationLogs.createdAt), desc(operationLogs.id));
  const unique = [...new Map(rows.map(({ log }) => [log.id, log])).values()];
  return pageFromRows(unique, input.cursor, input.limit, (log) => ({
    ref: { type: OPERATION_LOG_TYPE, key: String(log.id) },
    relationKey,
    title: log.description,
    subtitle: [log.module, log.method, log.path].filter(Boolean).join(' · '),
    status: log.responseCode == null ? null : String(log.responseCode),
    occurredAt: log.createdAt.toISOString(),
    capabilities: { view: true, open: true },
  }));
}

export const identityUserPaymentsProvider: RelationProvider = {
  sourceType: USER_TYPE,
  key: USER_PAYMENT_KEY,
  permissions: ['payment:order:list'],
  descriptor: {
    key: USER_PAYMENT_KEY,
    labelKey: 'relation.identity.user.payment-orders',
    targetTypes: [PAYMENT_ORDER_TYPE],
    kind: 'derived',
    cardinality: 'many',
    capabilities: { view: true, open: true },
  },
  resolveAnchor: resolveUserAnchor,
  list: (anchor, input) => listPaymentOrders(anchor, input, 'user', USER_PAYMENT_KEY),
};

export const identityUserAuditProvider: RelationProvider = {
  sourceType: USER_TYPE,
  key: USER_AUDIT_KEY,
  permissions: ['system:log:operation'],
  descriptor: {
    key: USER_AUDIT_KEY,
    labelKey: 'relation.identity.user.audit',
    targetTypes: [OPERATION_LOG_TYPE],
    kind: 'activity',
    cardinality: 'many',
    capabilities: { view: true, open: true },
  },
  resolveAnchor: resolveUserAnchor,
  list: (anchor, input) => listAuditLogs(anchor, input, USER_AUDIT_KEY),
};

export const memberPaymentsProvider: RelationProvider = {
  sourceType: MEMBER_TYPE,
  key: MEMBER_PAYMENT_KEY,
  permissions: ['payment:order:list'],
  descriptor: {
    key: MEMBER_PAYMENT_KEY,
    labelKey: 'relation.member.member.payment-orders',
    targetTypes: [PAYMENT_ORDER_TYPE],
    kind: 'derived',
    cardinality: 'many',
    capabilities: { view: true, open: true },
  },
  resolveAnchor: resolveMemberAnchor,
  list: (anchor, input) => listPaymentOrders(anchor, input, 'member', MEMBER_PAYMENT_KEY),
};

export const memberAuditProvider: RelationProvider = {
  sourceType: MEMBER_TYPE,
  key: MEMBER_AUDIT_KEY,
  permissions: ['system:log:operation'],
  descriptor: {
    key: MEMBER_AUDIT_KEY,
    labelKey: 'relation.member.member.audit',
    targetTypes: [OPERATION_LOG_TYPE],
    kind: 'activity',
    cardinality: 'many',
    capabilities: { view: true, open: true },
  },
  resolveAnchor: resolveMemberAnchor,
  list: (anchor, input) => listAuditLogs(anchor, input, MEMBER_AUDIT_KEY),
};

export const identityRelationProviders: readonly RelationProvider[] = [
  identityUserPaymentsProvider,
  identityUserAuditProvider,
  memberPaymentsProvider,
  memberAuditProvider,
];
