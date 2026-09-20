import { and, desc, eq, exists, lt, sql } from 'drizzle-orm';
import type { EntityRef } from '@zenith/shared/core';
import type { EntityRelationItem } from '@zenith/shared/platform';
import { paymentOrders, paymentRefunds, paymentDisputes, paymentRiskHits, paymentRiskReviews } from '../../db/schema';
import { hasPermission } from '../../lib/context';
import { buildWhere } from '../../lib/where-helpers';
import { exactTenantCondition, tenantCondition } from '../../lib/tenant';
import { buildOrdersWhere } from './payment.service';
import type { EntityAnchorResolver, RelationAccessContext, RelationProvider, VisibleEntityAnchor } from '../platform/relations/types';
import { decodeRelationCursor } from '../platform/relations/cursor';
import { relationPage } from '../platform/relations/page';
import { paymentReconAdjustments, paymentReconCases, workflowInstances } from '../../db/schema';
import { workflowVisibility } from '../platform/relations/providers/workflow-file.provider';
import { PAYMENT_RECON_ADJUSTMENT_BIZ_TYPE } from '@zenith/shared/payment';

function idOf(key: string): number | null {
  const id = Number(key);
  return /^[1-9]\d*$/.test(key) && Number.isSafeInteger(id) && id <= 2147483647 ? id : null;
}
export async function resolvePaymentOrderAnchor(ref: EntityRef, access: RelationAccessContext): Promise<VisibleEntityAnchor | null> {
  if (ref.type !== 'payment.order' || !(await hasPermission('payment:order:list'))) return null;
  const id = idOf(ref.key);
  if (id == null) return null;
  const [row] = await access.db.select({ id: paymentOrders.id, title: paymentOrders.subject, orderNo: paymentOrders.orderNo,
    tenantId: paymentOrders.tenantId, appId: paymentOrders.appId, bizType: paymentOrders.bizType, bizId: paymentOrders.bizId })
    .from(paymentOrders).where(buildWhere(eq(paymentOrders.id, id), await buildOrdersWhere({}))).limit(1);
  return row ? { ref: { type: 'payment.order', key: String(row.id) }, title: row.title || row.orderNo,
    tenantId: row.tenantId, metadata: { orderNo: row.orderNo, appId: row.appId, bizType: row.bizType, bizId: row.bizId } } : null;
}

async function resolvePaymentRecord(ref: EntityRef, access: RelationAccessContext): Promise<VisibleEntityAnchor | null> {
  const id = idOf(ref.key);
  if (id == null) return null;
  switch (ref.type) {
    case 'payment.refund': {
      if (!(await hasPermission('payment:refund:list'))) return null;
      const [row] = await access.db.select({ id: paymentRefunds.id, title: paymentRefunds.refundNo, tenantId: paymentRefunds.tenantId, orderId: paymentRefunds.orderId })
        .from(paymentRefunds).where(buildWhere(eq(paymentRefunds.id, id), tenantCondition(paymentRefunds, access.user))).limit(1);
      return row ? { ref: { type: 'payment.refund', key: String(id) }, title: row.title, tenantId: row.tenantId, metadata: { orderId: row.orderId } } : null;
    }
    case 'payment.dispute': {
      if (!(await hasPermission('payment:dispute:list'))) return null;
      const [row] = await access.db.select({ title: paymentDisputes.disputeNo, tenantId: paymentDisputes.tenantId, orderNo: paymentDisputes.orderNo })
        .from(paymentDisputes).where(buildWhere(eq(paymentDisputes.id, id), tenantCondition(paymentDisputes, access.user))).limit(1);
      return row ? { ref: { type: 'payment.dispute', key: String(id) }, title: row.title, tenantId: row.tenantId, metadata: { orderNo: row.orderNo } } : null;
    }
    case 'payment.risk-hit': {
      if (!(await hasPermission('payment:risk:list'))) return null;
      const [row] = await access.db.select({ title: paymentRiskHits.ruleName, tenantId: paymentRiskHits.tenantId, orderNo: paymentRiskHits.orderNo })
        .from(paymentRiskHits).where(buildWhere(eq(paymentRiskHits.id, id), tenantCondition(paymentRiskHits, access.user))).limit(1);
      return row ? { ref: { type: 'payment.risk-hit', key: String(id) }, title: row.title, tenantId: row.tenantId, metadata: { orderNo: row.orderNo } } : null;
    }
    case 'payment.risk-review': {
      if (!(await hasPermission('payment:risk:review'))) return null;
      const [row] = await access.db.select({ title: paymentRiskReviews.reviewNo, tenantId: paymentRiskReviews.tenantId, orderNo: paymentRiskReviews.orderNo })
        .from(paymentRiskReviews).where(buildWhere(eq(paymentRiskReviews.id, id), tenantCondition(paymentRiskReviews, access.user))).limit(1);
      return row ? { ref: { type: 'payment.risk-review', key: String(id) }, title: row.title, tenantId: row.tenantId, metadata: { orderNo: row.orderNo } } : null;
    }
    default: return null;
  }
}

const capabilities = { view: true, open: true };
function provider(key: string, target: EntityRelationItem['ref']['type'], permission: Exclude<RelationProvider['permissions'], 'authenticated'>,
  list: RelationProvider['list']): RelationProvider {
  return { sourceType: 'payment.order', key, permissions: permission, descriptor: {
    key, labelKey: `relation.${key}`, targetTypes: [target], kind: 'direct', cardinality: 'many', capabilities,
  }, list };
}

export const paymentOrderRefundsProvider = provider('payment.order.refunds', 'payment.refund', ['payment:refund:list'], async (anchor, { cursor, limit, access }) => {
  const before = decodeRelationCursor(cursor);
  const rows = await access.db.select({ id: paymentRefunds.id, title: paymentRefunds.refundNo, status: paymentRefunds.status, createdAt: paymentRefunds.createdAt })
    .from(paymentRefunds).where(buildWhere(eq(paymentRefunds.orderId, Number(anchor.ref.key)), exactTenantCondition(paymentRefunds.tenantId, anchor.tenantId),
      tenantCondition(paymentRefunds, access.user), before ? lt(paymentRefunds.id, before) : undefined)).orderBy(desc(paymentRefunds.id)).limit(limit + 1);
  return relationPage(rows, limit, (row) => ({ ref: { type: 'payment.refund', key: String(row.id) }, relationKey: 'payment.order.refunds',
    title: row.title, status: row.status, occurredAt: row.createdAt.toISOString(), capabilities }));
});
export const paymentOrderDisputesProvider = provider('payment.order.disputes', 'payment.dispute', ['payment:dispute:list'], async (anchor, { cursor, limit, access }) => {
  const before = decodeRelationCursor(cursor);
  const rows = await access.db.select({ id: paymentDisputes.id, title: paymentDisputes.disputeNo, status: paymentDisputes.status, createdAt: paymentDisputes.createdAt })
    .from(paymentDisputes).where(buildWhere(eq(paymentDisputes.orderNo, String(anchor.metadata?.orderNo)), exactTenantCondition(paymentDisputes.tenantId, anchor.tenantId),
      tenantCondition(paymentDisputes, access.user), before ? lt(paymentDisputes.id, before) : undefined)).orderBy(desc(paymentDisputes.id)).limit(limit + 1);
  return relationPage(rows, limit, (row) => ({ ref: { type: 'payment.dispute', key: String(row.id) }, relationKey: 'payment.order.disputes',
    title: row.title, status: row.status, occurredAt: row.createdAt.toISOString(), capabilities }));
});
export const paymentOrderRiskHitsProvider = provider('payment.order.risk-hits', 'payment.risk-hit', ['payment:risk:list'], async (anchor, { cursor, limit, access }) => {
  const before = decodeRelationCursor(cursor);
  // A hit before order creation has no order identity. Do not conflate it with later payment attempts sharing a business key.
  const rows = await access.db.select({ id: paymentRiskHits.id, title: paymentRiskHits.ruleName, status: paymentRiskHits.action, createdAt: paymentRiskHits.createdAt })
    .from(paymentRiskHits).where(buildWhere(eq(paymentRiskHits.orderNo, String(anchor.metadata?.orderNo)), exactTenantCondition(paymentRiskHits.tenantId, anchor.tenantId),
      tenantCondition(paymentRiskHits, access.user), before ? lt(paymentRiskHits.id, before) : undefined)).orderBy(desc(paymentRiskHits.id)).limit(limit + 1);
  return relationPage(rows, limit, (row) => ({ ref: { type: 'payment.risk-hit', key: String(row.id) }, relationKey: 'payment.order.risk-hits',
    title: row.title.slice(0, 160), status: row.status, occurredAt: row.createdAt.toISOString(), capabilities }));
});
export const paymentOrderRiskReviewsProvider = provider('payment.order.risk-reviews', 'payment.risk-review', ['payment:risk:review'], async (anchor, { cursor, limit, access }) => {
  const before = decodeRelationCursor(cursor);
  const rows = await access.db.select({ id: paymentRiskReviews.id, title: paymentRiskReviews.reviewNo, status: paymentRiskReviews.status, createdAt: paymentRiskReviews.createdAt })
    .from(paymentRiskReviews).where(buildWhere(eq(paymentRiskReviews.orderNo, String(anchor.metadata?.orderNo)), eq(paymentRiskReviews.appId, Number(anchor.metadata?.appId)),
      exactTenantCondition(paymentRiskReviews.tenantId, anchor.tenantId), tenantCondition(paymentRiskReviews, access.user), before ? lt(paymentRiskReviews.id, before) : undefined))
    .orderBy(desc(paymentRiskReviews.id)).limit(limit + 1);
  return relationPage(rows, limit, (row) => ({ ref: { type: 'payment.risk-review', key: String(row.id) }, relationKey: 'payment.order.risk-reviews',
    title: row.title, status: row.status, occurredAt: row.createdAt.toISOString(), capabilities }));
});
const recordTypes = ['payment.refund', 'payment.dispute', 'payment.risk-hit', 'payment.risk-review'] as const;
const paymentOrderWorkflowProvider: RelationProvider = {
  sourceType: 'payment.order', key: 'payment.order.workflow',
  permissions: ['workflow:instance:list', 'workflow:task:handle', 'workflow:instance:monitor'], allPermissions: ['payment:recon:list'],
  descriptor: { key: 'payment.order.workflow', labelKey: 'relation.payment.order.workflow', targetTypes: ['workflow.instance'], kind: 'derived', cardinality: 'many', capabilities },
  async list(anchor, { cursor, limit, access }) {
    const before = decodeRelationCursor(cursor);
    const rows = await access.db.select({ id: workflowInstances.id, title: workflowInstances.title, status: workflowInstances.status, createdAt: workflowInstances.createdAt })
      .from(workflowInstances).where(buildWhere(exactTenantCondition(workflowInstances.tenantId, anchor.tenantId), tenantCondition(workflowInstances, access.user),
        await workflowVisibility(access), eq(workflowInstances.bizType, PAYMENT_RECON_ADJUSTMENT_BIZ_TYPE),
        exists(access.db.select({ id: paymentReconAdjustments.id }).from(paymentReconAdjustments)
          .innerJoin(paymentReconCases, eq(paymentReconCases.id, paymentReconAdjustments.caseId)).where(and(
            eq(paymentReconCases.orderId, Number(anchor.ref.key)), eq(paymentReconAdjustments.applicationId, Number(anchor.metadata?.appId)),
            eq(workflowInstances.bizId, sql`${paymentReconAdjustments.id}::text`),
            exactTenantCondition(paymentReconCases.tenantId, anchor.tenantId), exactTenantCondition(paymentReconAdjustments.tenantId, anchor.tenantId)))),
        before ? lt(workflowInstances.id, before) : undefined)).orderBy(desc(workflowInstances.id)).limit(limit + 1);
    return relationPage(rows, limit, (row) => ({ ref: { type: 'workflow.instance', key: String(row.id) }, relationKey: 'payment.order.workflow',
      title: row.title, status: row.status, occurredAt: row.createdAt.toISOString(), capabilities }));
  },
};
export const paymentAnchorResolvers: readonly EntityAnchorResolver[] = [
  { type: 'payment.order', resolve: resolvePaymentOrderAnchor }, ...recordTypes.map((type) => ({ type, resolve: resolvePaymentRecord })),
];
export const paymentRelationProviders: readonly RelationProvider[] = [paymentOrderRefundsProvider, paymentOrderDisputesProvider, paymentOrderRiskHitsProvider, paymentOrderRiskReviewsProvider, paymentOrderWorkflowProvider,
  ...recordTypes.map((sourceType): RelationProvider => ({ sourceType, key: `${sourceType}.order`, permissions: ['payment:order:list'],
    descriptor: { key: `${sourceType}.order`, labelKey: 'relation.payment.record.order', targetTypes: ['payment.order'], kind: 'direct', cardinality: 'one', capabilities },
    async list(anchor, { access }) {
      if (!anchor.metadata?.orderId && !anchor.metadata?.orderNo) return { items: [], hasMore: false, nextCursor: null };
      const [row] = await access.db.select({ id: paymentOrders.id, title: paymentOrders.subject, orderNo: paymentOrders.orderNo, status: paymentOrders.status })
        .from(paymentOrders).where(buildWhere(anchor.metadata.orderId ? eq(paymentOrders.id, Number(anchor.metadata.orderId)) : eq(paymentOrders.orderNo, String(anchor.metadata.orderNo)),
          exactTenantCondition(paymentOrders.tenantId, anchor.tenantId), await buildOrdersWhere({}))).limit(1);
      return { items: row ? [{ ref: { type: 'payment.order', key: String(row.id) }, relationKey: `${sourceType}.order`, title: row.title.slice(0, 160), subtitle: row.orderNo, status: row.status, capabilities }] : [], hasMore: false, nextCursor: null };
    },
  })),
];
