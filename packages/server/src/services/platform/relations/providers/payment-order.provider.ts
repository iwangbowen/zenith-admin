import { and, desc, eq } from 'drizzle-orm';
import { hasPermission, currentUser } from '../../../../lib/context';
import { getOrderDetail, getOrderDetailByNo, listOrderRefunds } from '../../../payment/payment.service';
import { db } from '../../../../db';
import { operationLogSubjects, operationLogs, workflowInstances } from '../../../../db/schema';
import { tenantCondition } from '../../../../lib/tenant';
import { buildWhere } from '../../../../lib/where-helpers';
import type { EntityRef } from '@zenith/shared/core';
import type { RelationProvider, RelationAccessContext, VisibleEntityAnchor } from '../types';
import { decodeRelationCursor, encodeRelationCursor } from '../cursor';

const PAYMENT_ORDER_TYPE = 'payment.order' as const;
const REFUND_TYPE = 'payment.refund' as const;
const REFUNDS_KEY = 'payment.order.refunds' as const;

async function resolvePaymentOrder(ref: EntityRef, _access: RelationAccessContext): Promise<VisibleEntityAnchor | null> {
  if (ref.type !== PAYMENT_ORDER_TYPE) return null;
  if (!(await hasPermission('payment:order:list'))) return null;
  try {
    const parsedId = Number(ref.key);
    const order = Number.isInteger(parsedId) && parsedId > 0
      ? await getOrderDetail(parsedId)
      : await getOrderDetailByNo(ref.key);
    return {
      ref: { type: PAYMENT_ORDER_TYPE, key: String(order.id) },
      title: order.subject || order.orderNo,
      tenantId: null,
      metadata: { id: order.id, orderNo: order.orderNo, bizType: order.bizType, bizId: order.bizId },
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

export const paymentOrderAuditProvider: RelationProvider = {
  sourceType: PAYMENT_ORDER_TYPE,
  key: 'payment.order.audit',
  permissions: ['system:log:operation'],
  descriptor: {
    key: 'payment.order.audit',
    labelKey: 'relation.payment.order.audit',
    targetTypes: ['platform.operation-log'],
    kind: 'activity',
    cardinality: 'many',
    capabilities: { view: true, open: true },
  },
  resolveAnchor: resolvePaymentOrder,
  async list(anchor, { cursor, limit }) {
    if (!(await hasPermission('system:log:operation'))) return { items: [], nextCursor: null, hasMore: false };
    const rows = await db.select({ log: operationLogs })
      .from(operationLogSubjects)
      .innerJoin(operationLogs, eq(operationLogSubjects.operationLogId, operationLogs.id))
      .where(and(
        eq(operationLogSubjects.entityType, PAYMENT_ORDER_TYPE),
        eq(operationLogSubjects.entityKey, anchor.ref.key),
        tenantCondition(operationLogs, currentUser()),
      ))
      .orderBy(desc(operationLogs.createdAt), desc(operationLogs.id));
    const unique = [...new Map(rows.map((row) => [row.log.id, row.log])).values()];
    const offset = decodeRelationCursor(cursor);
    const page = unique.slice(offset, offset + limit);
    const nextOffset = offset + page.length;
    const hasMore = nextOffset < unique.length;
    return {
      items: page.map((log) => ({
        ref: { type: 'platform.operation-log', key: String(log.id) },
        relationKey: 'payment.order.audit',
        title: log.description,
        subtitle: [log.module, log.method, log.path].filter(Boolean).join(' · '),
        status: log.responseCode == null ? null : String(log.responseCode),
        occurredAt: log.createdAt.toISOString(),
        capabilities: { view: true, open: true },
      })),
      nextCursor: hasMore ? encodeRelationCursor(nextOffset) : null,
      hasMore,
      total: unique.length,
    };
  },
};

export const paymentOrderWorkflowProvider: RelationProvider = {
  sourceType: PAYMENT_ORDER_TYPE,
  key: 'payment.order.workflow',
  permissions: ['workflow:instance:list', 'workflow:instance:monitor'],
  descriptor: {
    key: 'payment.order.workflow',
    labelKey: 'relation.payment.order.workflow',
    targetTypes: ['workflow.instance'],
    kind: 'derived',
    cardinality: 'many',
    capabilities: { view: true, open: true },
  },
  resolveAnchor: resolvePaymentOrder,
  async list(anchor, { cursor, limit }) {
    const canMonitor = await hasPermission('workflow:instance:monitor');
    if (!canMonitor && !(await hasPermission('workflow:instance:list'))) return { items: [], nextCursor: null, hasMore: false };
    const bizType = String(anchor.metadata?.bizType ?? '');
    const bizId = String(anchor.metadata?.bizId ?? '');
    if (!bizType || !bizId) return { items: [], nextCursor: null, hasMore: false };
    const rows = await db.select().from(workflowInstances)
      .where(buildWhere(
        eq(workflowInstances.bizType, bizType),
        eq(workflowInstances.bizId, bizId),
        tenantCondition(workflowInstances, currentUser()),
        canMonitor ? undefined : eq(workflowInstances.initiatorId, currentUser().userId),
      ))
      .orderBy(desc(workflowInstances.createdAt), desc(workflowInstances.id));
    const offset = decodeRelationCursor(cursor);
    const page = rows.slice(offset, offset + limit);
    const nextOffset = offset + page.length;
    const hasMore = nextOffset < rows.length;
    return {
      items: page.map((instance) => ({
        ref: { type: 'workflow.instance', key: String(instance.id) },
        relationKey: 'payment.order.workflow',
        title: instance.title,
        subtitle: instance.serialNo,
        status: instance.status,
        occurredAt: instance.createdAt.toISOString(),
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
