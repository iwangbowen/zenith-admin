import { hasPermission } from '../../../../lib/context';
import { getOrderDetail, listOrderRefunds } from '../../../payment/payment.service';
import type { EntityRef } from '@zenith/shared/core';
import type { RelationProvider, RelationAccessContext, VisibleEntityAnchor } from '../types';
import { decodeRelationCursor, encodeRelationCursor } from '../cursor';

const PAYMENT_ORDER_TYPE = 'payment.order' as const;
const REFUND_TYPE = 'payment.refund' as const;
const REFUNDS_KEY = 'payment.order.refunds' as const;

async function resolvePaymentOrder(ref: EntityRef, _access: RelationAccessContext): Promise<VisibleEntityAnchor | null> {
  if (ref.type !== PAYMENT_ORDER_TYPE) return null;
  if (!(await hasPermission('payment:order:list'))) return null;
  const id = Number(ref.key);
  if (!Number.isInteger(id) || id <= 0) return null;
  try {
    const order = await getOrderDetail(id);
    return {
      ref: { type: PAYMENT_ORDER_TYPE, key: String(order.id) },
      title: order.subject || order.orderNo,
      tenantId: null,
      metadata: { id: order.id, orderNo: order.orderNo },
    };
  } catch {
    return null;
  }
}

export const paymentOrderRefundsProvider: RelationProvider = {
  sourceType: PAYMENT_ORDER_TYPE,
  key: REFUNDS_KEY,
  permissions: ['payment:refund:list', 'payment:order:refund'],
  descriptor: {
    key: REFUNDS_KEY,
    labelKey: 'relation.payment.order.refunds',
    targetTypes: [REFUND_TYPE],
    kind: 'direct',
    cardinality: 'many',
    capabilities: { view: true, open: true },
  },
  resolveAnchor: resolvePaymentOrder,
  async list(anchor, { cursor, limit }) {
    if (!(await hasPermission('payment:refund:list')) && !(await hasPermission('payment:order:refund'))) {
      return { items: [], nextCursor: null, hasMore: false };
    }
    const orderId = Number(anchor.metadata?.id);
    if (!Number.isInteger(orderId) || orderId <= 0) return { items: [], nextCursor: null, hasMore: false };
    const rows = await listOrderRefunds(orderId);
    const offset = decodeRelationCursor(cursor);
    const page = rows.slice(offset, offset + limit);
    const nextOffset = offset + page.length;
    const hasMore = nextOffset < rows.length;
    return {
      items: page.map((refund) => ({
        ref: { type: REFUND_TYPE, key: String(refund.id) },
        relationKey: REFUNDS_KEY,
        title: refund.refundNo,
        subtitle: refund.reason ?? refund.orderNo,
        status: refund.status,
        occurredAt: refund.createdAt,
        capabilities: { view: true, open: true },
      })),
      nextCursor: hasMore ? encodeRelationCursor(nextOffset) : null,
      hasMore,
      total: rows.length,
    };
  },
};

export async function resolvePaymentOrderAnchor(ref: EntityRef, access: RelationAccessContext) {
  return resolvePaymentOrder(ref, access);
}
