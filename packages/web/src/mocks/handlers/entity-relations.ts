import { entityRelationsContract, entityTimelineContract } from '@zenith/shared/platform';
import { mock } from '@/mocks/utils/contract';

const paymentSections = [
  {
    key: 'payment.order.refunds',
    labelKey: 'relation.payment.order.refunds',
    targetTypes: ['payment.refund'] as const,
    kind: 'direct' as const,
    cardinality: 'many' as const,
    capabilities: { view: true, open: true },
  },
  {
    key: 'payment.order.workflow',
    labelKey: 'relation.payment.order.workflow',
    targetTypes: ['workflow.instance'] as const,
    kind: 'derived' as const,
    cardinality: 'many' as const,
    capabilities: { view: true, open: true },
  },
  {
    key: 'payment.order.audit',
    labelKey: 'relation.payment.order.audit',
    targetTypes: ['platform.operation-log'] as const,
    kind: 'activity' as const,
    cardinality: 'many' as const,
    capabilities: { view: true, open: true },
  },
];

export const entityRelationsHandlers = [
  mock(entityRelationsContract.describe, ({ params, ok }) => ok({
    anchor: { ref: { type: params.type, key: params.key }, title: `Demo ${params.key}` },
    sections: params.type === 'payment.order' ? paymentSections : [],
  })),
  mock(entityRelationsContract.list, ({ params, ok }) => ok({
    items: params.sectionKey === 'payment.order.refunds' ? [{
      ref: { type: 'payment.refund', key: 'demo-refund-1' },
      relationKey: params.sectionKey,
      title: 'RF-DEMO-0001',
      subtitle: 'Demo 退款记录',
      description: null,
      status: 'pending',
      occurredAt: new Date().toISOString(),
      capabilities: { view: true, open: true },
    }] : [],
    nextCursor: null,
    hasMore: false,
    total: params.sectionKey === 'payment.order.refunds' ? 1 : 0,
  })),
];

export const entityTimelineHandlers = [
  mock(entityTimelineContract.list, ({ ok }) => ok({ items: [], nextCursor: null, hasMore: false })),
];
