import { and, desc, eq, exists, isNull, lt, notInArray, or } from 'drizzle-orm';
import type { EntityRef } from '@zenith/shared/core';
import type { EntityRelationPage } from '@zenith/shared/platform';
import { MEMBER_RENEWAL_BIZ_TYPE } from '@zenith/shared/member';
import {
  members, memberVipRenewals, memberWalletTransactions, operationLogSubjects, operationLogs, paymentOrders, users,
} from '../../../../db/schema';
import { getDataScopeCondition } from '../../../../lib/data-scope';
import { hasPermission, runWithCurrentUser } from '../../../../lib/context';
import { exactTenantCondition, tenantCondition } from '../../../../lib/tenant';
import { buildWhere } from '../../../../lib/where-helpers';
import { buildOrdersWhere } from '../../../payment/payment.service';
import { WALLET_RECHARGE_BIZ_TYPE } from '../../../member/member-wallet.service';
import type { EntityAnchorResolver, RelationAccessContext, RelationProvider, VisibleEntityAnchor } from '../types';
import { decodeRelationCursor } from '../cursor';
import { relationPage as page } from '../page';

type RelationInput = Parameters<RelationProvider['list']>[1];
const MEMBER_PAYMENT_BIZ_TYPES = [WALLET_RECHARGE_BIZ_TYPE, MEMBER_RENEWAL_BIZ_TYPE];
const emptyPage = (): EntityRelationPage => ({ items: [], nextCursor: null, hasMore: false });

function parseId(key: string): number | null {
  if (!/^[1-9]\d*$/.test(key)) return null;
  const id = Number(key);
  return Number.isSafeInteger(id) && id <= 2_147_483_647 ? id : null;
}

async function resolveUser(ref: EntityRef, access: RelationAccessContext): Promise<VisibleEntityAnchor | null> {
  return runWithCurrentUser(access.user, async () => {
    if (ref.type !== 'identity.user' || !(await hasPermission('system:user:list'))) return null;
    const id = parseId(ref.key);
    if (id == null) return null;
    const scope = await getDataScopeCondition({ currentUserId: access.user.userId, deptColumn: users.departmentId, ownerColumn: users.id });
    const [row] = await access.db.select({ id: users.id, nickname: users.nickname, username: users.username, tenantId: users.tenantId })
      .from(users).where(buildWhere(eq(users.id, id), tenantCondition(users, access.user), scope)).limit(1);
    return row ? { ref: { type: 'identity.user', key: String(row.id) }, title: row.nickname || row.username, tenantId: row.tenantId } : null;
  });
}

async function resolveMember(ref: EntityRef, access: RelationAccessContext): Promise<VisibleEntityAnchor | null> {
  return runWithCurrentUser(access.user, async () => {
    if (ref.type !== 'member.member' || !(await hasPermission('member:member:list'))) return null;
    const id = parseId(ref.key);
    if (id == null) return null;
    const scope = await getDataScopeCondition({ currentUserId: access.user.userId, ownerColumn: members.createdBy });
    const [row] = await access.db.select({ id: members.id, nickname: members.nickname, tenantId: members.tenantId })
      .from(members).where(buildWhere(eq(members.id, id), isNull(members.deletedAt), tenantCondition(members, access.user), scope)).limit(1);
    return row ? { ref: { type: 'member.member', key: String(row.id) }, title: row.nickname || `会员 #${row.id}`, tenantId: row.tenantId } : null;
  });
}

async function listPayments(anchor: VisibleEntityAnchor, { cursor, limit, access }: RelationInput): Promise<EntityRelationPage> {
  return runWithCurrentUser(access.user, async () => {
    if (!(await hasPermission('payment:order:list'))) return emptyPage();
    const id = parseId(anchor.ref.key);
    if (id == null) return emptyPage();
    const beforeId = decodeRelationCursor(cursor);
    // An admin user and a member with the same integer ID are distinct identities.
    // A member relationship requires an explicit settled business record carrying
    // the payment intention number; pending orders without that evidence are omitted.
    const ownership = anchor.ref.type === 'identity.user'
      ? and(eq(paymentOrders.userId, id), notInArray(paymentOrders.bizType, MEMBER_PAYMENT_BIZ_TYPES))
      : or(
          and(eq(paymentOrders.bizType, WALLET_RECHARGE_BIZ_TYPE), exists(access.db.select({ id: memberWalletTransactions.id })
            .from(memberWalletTransactions).where(and(
              eq(memberWalletTransactions.memberId, id),
              eq(memberWalletTransactions.type, 'recharge'),
              eq(memberWalletTransactions.bizType, WALLET_RECHARGE_BIZ_TYPE),
              eq(memberWalletTransactions.paymentIntentNo, paymentOrders.orderNo),
            )).limit(1))),
          and(eq(paymentOrders.bizType, MEMBER_RENEWAL_BIZ_TYPE), exists(access.db.select({ id: memberVipRenewals.id })
            .from(memberVipRenewals).where(and(eq(memberVipRenewals.memberId, id), eq(memberVipRenewals.orderNo, paymentOrders.orderNo))).limit(1))),
        );
    const rows = await access.db.select({ id: paymentOrders.id, orderNo: paymentOrders.orderNo, subject: paymentOrders.subject, status: paymentOrders.status, createdAt: paymentOrders.createdAt })
      .from(paymentOrders).where(buildWhere(
        ownership,
        exactTenantCondition(paymentOrders.tenantId, anchor.tenantId),
        await buildOrdersWhere({}),
        beforeId ? lt(paymentOrders.id, beforeId) : undefined,
      )).orderBy(desc(paymentOrders.id)).limit(limit + 1);
    return page(rows, limit, (order) => ({
      ref: { type: 'payment.order', key: String(order.id) }, relationKey: `${anchor.ref.type}.payment-orders`,
      title: (order.subject || order.orderNo).slice(0, 160), subtitle: order.orderNo, status: order.status,
      occurredAt: order.createdAt.toISOString(), capabilities: { view: true, open: true },
    }));
  });
}

async function listAudit(anchor: VisibleEntityAnchor, { cursor, limit, access }: RelationInput): Promise<EntityRelationPage> {
  return runWithCurrentUser(access.user, async () => {
    if (!(await hasPermission('system:log:operation'))) return emptyPage();
    const beforeId = decodeRelationCursor(cursor);
    const rows = await access.db.select({ id: operationLogs.id, description: operationLogs.description, module: operationLogs.module, method: operationLogs.method, responseCode: operationLogs.responseCode, createdAt: operationLogs.createdAt })
      .from(operationLogs).where(buildWhere(
        exactTenantCondition(operationLogs.tenantId, anchor.tenantId), tenantCondition(operationLogs, access.user),
        exists(access.db.select({ id: operationLogSubjects.operationLogId }).from(operationLogSubjects).where(and(
          eq(operationLogSubjects.operationLogId, operationLogs.id), eq(operationLogSubjects.entityType, anchor.ref.type),
          eq(operationLogSubjects.entityKey, anchor.ref.key), exactTenantCondition(operationLogSubjects.tenantId, anchor.tenantId),
        )).limit(1)),
        beforeId ? lt(operationLogs.id, beforeId) : undefined,
      )).orderBy(desc(operationLogs.id)).limit(limit + 1);
    return page(rows, limit, (log) => ({
      ref: { type: 'platform.operation-log', key: String(log.id) }, relationKey: `${anchor.ref.type}.audit`,
      title: log.description.slice(0, 160), subtitle: [log.module, log.method].filter(Boolean).join(' · '),
      status: log.responseCode == null ? null : String(log.responseCode), occurredAt: log.createdAt.toISOString(),
      capabilities: { view: true, open: true },
    }));
  });
}

export const identityAnchorResolvers: readonly EntityAnchorResolver[] = [
  { type: 'identity.user', resolve: resolveUser },
  { type: 'member.member', resolve: resolveMember },
];

function paymentsProvider(sourceType: 'identity.user' | 'member.member'): RelationProvider {
  const key = `${sourceType}.payment-orders`;
  return { sourceType, key, permissions: ['payment:order:list'], descriptor: {
    key, labelKey: `relation.${key}`, targetTypes: ['payment.order'], kind: 'derived', cardinality: 'many', capabilities: { view: true, open: true },
  }, list: listPayments };
}

function auditProvider(sourceType: 'identity.user' | 'member.member'): RelationProvider {
  const key = `${sourceType}.audit`;
  return { sourceType, key, permissions: ['system:log:operation'], descriptor: {
    key, labelKey: `relation.${key}`, targetTypes: ['platform.operation-log'], kind: 'activity', cardinality: 'many', capabilities: { view: true, open: true },
  }, list: listAudit };
}

export const identityUserPaymentsProvider = paymentsProvider('identity.user');
export const memberPaymentsProvider = paymentsProvider('member.member');
export const identityUserAuditProvider = auditProvider('identity.user');
export const memberAuditProvider = auditProvider('member.member');
export const identityRelationProviders: readonly RelationProvider[] = [identityUserPaymentsProvider, identityUserAuditProvider, memberPaymentsProvider, memberAuditProvider];
