import type { CanonicalEntityRef, CanonicalEntityType, EntityRelationItem, EntityRelationSection } from '@zenith/shared/platform';
import type { PaymentJournal, PaymentOrder } from '@zenith/shared/payment';
import { mockPaymentOrders, mockPaymentRefunds, mockPaymentLogs, mockPaymentNotifyLogScopes } from '@/mocks/data/payment';
import { mockPaymentJournals } from './payment-journals';
import { mockPaymentReconAdjustments, mockPaymentReconCases } from './payment-ext';
import { mockPaymentSettlements, mockPaymentSharingOrders, mockPaymentSharingReceivers, mockPaymentSharingReversals, mockSettlementLines } from './payment-bext';

const ref = (type: CanonicalEntityType, id: number): CanonicalEntityRef => ({ type, key: String(id) });
const refKey = (value: CanonicalEntityRef) => `${value.type}:${value.key}`;
const definitions: Partial<Record<CanonicalEntityType, Array<[string, CanonicalEntityType]>>> = {
  'payment.order': [['journals', 'payment.journal'], ['recon-cases', 'payment.recon-case'], ['recon-adjustments', 'payment.recon-adjustment'], ['sharing-orders', 'payment.sharing-order'], ['settlement-batches', 'payment.settlement-batch'], ['notify-logs', 'payment.notify-log']],
  'payment.refund': [['journals', 'payment.journal'], ['recon-cases', 'payment.recon-case'], ['recon-adjustments', 'payment.recon-adjustment'], ['settlement-batches', 'payment.settlement-batch']],
  'payment.journal': [['orders', 'payment.order'], ['refunds', 'payment.refund'], ['settlement-batches', 'payment.settlement-batch'], ['recon-adjustments', 'payment.recon-adjustment'], ['sharing-orders', 'payment.sharing-order'], ['sharing-reversals', 'payment.sharing-reversal']],
  'payment.recon-case': [['orders', 'payment.order'], ['refunds', 'payment.refund'], ['recon-adjustments', 'payment.recon-adjustment']],
  'payment.recon-adjustment': [['orders', 'payment.order'], ['refunds', 'payment.refund'], ['recon-cases', 'payment.recon-case'], ['journals', 'payment.journal']],
  'payment.sharing-order': [['orders', 'payment.order'], ['receiver', 'payment.sharing-receiver'], ['reversals', 'payment.sharing-reversal'], ['journals', 'payment.journal']],
  'payment.sharing-receiver': [['sharing-orders', 'payment.sharing-order']],
  'payment.sharing-reversal': [['orders', 'payment.order'], ['sharing-orders', 'payment.sharing-order'], ['journals', 'payment.journal']],
  'payment.settlement-batch': [['orders', 'payment.order'], ['refunds', 'payment.refund'], ['journals', 'payment.journal']],
  'payment.notify-log': [['orders', 'payment.order']],
};

export function mockFinancialSections(type: CanonicalEntityType): EntityRelationSection[] {
  return (definitions[type] ?? []).map(([suffix, targetType]) => ({ key: `${type}.${suffix}`, labelKey: `relation.${type}.${suffix}`, targetTypes: [targetType],
    kind: 'derived', cardinality: 'many', capabilities: { view: true, open: true }, summaryState: 'unavailable' }));
}

export function mockFinancialItem(value: CanonicalEntityRef, relationKey = ''): EntityRelationItem | undefined {
  const id = Number(value.key);
  let row: { title: string; subtitle?: string | null; status?: string | null; createdAt: string } | undefined;
  switch (value.type) {
    case 'payment.order': { const item = mockPaymentOrders.find((item) => item.id === id); row = item && { ...item, title: item.orderNo, subtitle: item.subject }; break; }
    case 'payment.refund': { const item = mockPaymentRefunds.find((item) => item.id === id); row = item && { ...item, title: item.refundNo, subtitle: item.reason }; break; }
    case 'payment.journal': { const item = mockPaymentJournals.find((item) => item.id === id); row = item && { ...item, title: item.journalNo, subtitle: item.description }; break; }
    case 'payment.recon-case': { const item = mockPaymentReconCases.find((item) => item.id === id); row = item && { ...item, title: `对账差异 #${item.id}`, subtitle: item.entryKey }; break; }
    case 'payment.recon-adjustment': { const item = mockPaymentReconAdjustments.find((item) => item.id === id); row = item && { ...item, title: `对账调整 #${item.id}`, subtitle: item.reason }; break; }
    case 'payment.sharing-order': { const item = mockPaymentSharingOrders.find((item) => item.id === id); row = item && { ...item, title: item.sharingNo }; break; }
    case 'payment.sharing-receiver': { const item = mockPaymentSharingReceivers.find((item) => item.id === id); row = item && { ...item, title: item.name }; break; }
    case 'payment.sharing-reversal': { const item = mockPaymentSharingReversals.find((item) => item.id === id); row = item && { ...item, title: item.reversalNo }; break; }
    case 'payment.settlement-batch': { const item = mockPaymentSettlements.find((item) => item.id === id); row = item && { ...item, title: item.batchNo }; break; }
    case 'payment.notify-log': { const item = mockPaymentLogs.find((item) => item.id === id); row = item && { ...item, title: `渠道回调 #${item.id}`, subtitle: item.orderNo }; break; }
  }
  return row ? { ref: value, relationKey, title: row.title, subtitle: row.subtitle, status: row.status, occurredAt: row.createdAt, capabilities: { view: true, open: true } } : undefined;
}

function sameJournalScope(journal: PaymentJournal, order: PaymentOrder) {
  return journal.appId === order.appId && journal.channelAccountId === order.channelAccountId && journal.currency === order.currency;
}

/** Build only documented FK/producer edges from the same stores used by each Demo business page. */
export function mockFinancialRelationRefs(source: CanonicalEntityRef, sectionKey: string): CanonicalEntityRef[] {
  const graph = new Map<string, Map<string, CanonicalEntityRef[]>>();
  const add = (from: CanonicalEntityRef, suffix: string, to: CanonicalEntityRef) => {
    const groups = graph.get(refKey(from)) ?? new Map<string, CanonicalEntityRef[]>();
    groups.set(suffix, [...(groups.get(suffix) ?? []), to]);
    graph.set(refKey(from), groups);
  };
  const pair = (left: CanonicalEntityRef, suffix: string, right: CanonicalEntityRef, reverse: string) => { add(left, suffix, right); add(right, reverse, left); };
  const targets = (from: CanonicalEntityRef, suffix: string) => graph.get(refKey(from))?.get(suffix) ?? [];

  for (const sharing of mockPaymentSharingOrders) {
    const shareRef = ref('payment.sharing-order', sharing.id);
    const order = mockPaymentOrders.find((order) => order.orderNo === sharing.orderNo);
    if (order) pair(shareRef, 'orders', ref('payment.order', order.id), 'sharing-orders');
    if (mockPaymentSharingReceivers.some((receiver) => receiver.id === sharing.receiverId)) pair(shareRef, 'receiver', ref('payment.sharing-receiver', sharing.receiverId), 'sharing-orders');
    for (const reversal of mockPaymentSharingReversals.filter((item) => item.sharingOrderId === sharing.id)) {
      const reversalRef = ref('payment.sharing-reversal', reversal.id);
      pair(shareRef, 'reversals', reversalRef, 'sharing-orders');
      if (order) add(reversalRef, 'orders', ref('payment.order', order.id));
    }
  }
  for (const item of mockPaymentReconCases) {
    const caseRef = ref('payment.recon-case', item.id);
    const order = mockPaymentOrders.find((order) => order.id === item.orderId && order.appId === item.applicationId && order.channelAccountId === item.accountId && order.currency === item.currency);
    if (order) pair(caseRef, 'orders', ref('payment.order', order.id), 'recon-cases');
    const refund = order && mockPaymentRefunds.find((refund) => refund.id === item.refundId && refund.orderId === order.id);
    if (refund) pair(caseRef, 'refunds', ref('payment.refund', refund.id), 'recon-cases');
    for (const adjustment of mockPaymentReconAdjustments.filter((adjustment) => adjustment.caseId === item.id && adjustment.applicationId === item.applicationId)) {
      const adjustmentRef = ref('payment.recon-adjustment', adjustment.id);
      pair(caseRef, 'recon-adjustments', adjustmentRef, 'recon-cases');
      if (order) pair(adjustmentRef, 'orders', ref('payment.order', order.id), 'recon-adjustments');
      if (refund) pair(adjustmentRef, 'refunds', ref('payment.refund', refund.id), 'recon-adjustments');
    }
  }
  for (const journal of mockPaymentJournals) {
    const journalRef = ref('payment.journal', journal.id);
    for (const order of mockPaymentOrders.filter((order) => sameJournalScope(journal, order))) {
      let belongsToOrder = ['payment.capture', 'payment.preauth.capture', 'payment.fee'].includes(journal.sourceType) && journal.sourceId === order.orderNo;
      for (const refund of mockPaymentRefunds.filter((refund) => refund.orderId === order.id && refund.orderNo === order.orderNo && refund.channelAccountId === order.channelAccountId)) {
        if (['payment.refund', 'payment.fee_refund'].includes(journal.sourceType) && journal.sourceId === refund.refundNo) {
          pair(journalRef, 'refunds', ref('payment.refund', refund.id), 'journals'); belongsToOrder = true;
        }
      }
      for (const sharing of mockPaymentSharingOrders.filter((sharing) => sharing.orderNo === order.orderNo)) {
        if (journal.sourceType === 'payment.sharing' && journal.sourceId === sharing.sharingNo) {
          pair(journalRef, 'sharing-orders', ref('payment.sharing-order', sharing.id), 'journals'); belongsToOrder = true;
        }
        for (const reversal of mockPaymentSharingReversals.filter((reversal) => reversal.sharingOrderId === sharing.id)) {
          if (journal.sourceType === 'payment.sharing_reversal' && journal.sourceId === reversal.reversalNo) {
            pair(journalRef, 'sharing-reversals', ref('payment.sharing-reversal', reversal.id), 'journals'); belongsToOrder = true;
          }
        }
      }
      for (const adjustment of mockPaymentReconAdjustments.filter((adjustment) => adjustment.journalId === journal.id && String(adjustment.id) === journal.sourceId
        && journal.sourceType === (adjustment.reversalOfId == null ? 'recon.adjust' : 'recon.adjust.reversal'))) {
        const adjustmentRef = ref('payment.recon-adjustment', adjustment.id);
        if (!targets(adjustmentRef, 'orders').some((target) => target.key === String(order.id))) continue;
        pair(journalRef, 'recon-adjustments', adjustmentRef, 'journals'); belongsToOrder = true;
        for (const target of targets(adjustmentRef, 'refunds')) pair(journalRef, 'refunds', target, 'journals');
      }
      if (belongsToOrder) pair(journalRef, 'orders', ref('payment.order', order.id), 'journals');
    }
  }
  for (const journal of mockPaymentJournals.filter((journal) => journal.sourceType === 'journal.reversal')) {
    const original = mockPaymentJournals.find((original) => original.id === journal.reversalOfJournalId && original.journalNo === journal.sourceId && original.appId === journal.appId
      && original.channelAccountId === journal.channelAccountId && original.currency === journal.currency);
    if (!original) continue;
    for (const suffix of ['orders', 'refunds']) for (const target of targets(ref('payment.journal', original.id), suffix)) pair(ref('payment.journal', journal.id), suffix, target, 'journals');
  }
  for (const batch of mockPaymentSettlements) {
    const batchRef = ref('payment.settlement-batch', batch.id);
    for (const journal of mockPaymentJournals.filter((journal) => journal.appId === batch.appId && journal.channelConfigId === batch.channelConfigId && journal.currency === batch.currency)) {
      const hasLine = mockSettlementLines.some((line) => line.batchId === batch.id && line.appId === batch.appId && line.channelConfigId === batch.channelConfigId && line.currency === batch.currency && journal.lines.some((journalLine) => journalLine.id === line.journalLineId));
      if (!hasLine && !(['settlement.initiated', 'settlement.paid', 'settlement.failed'].includes(journal.sourceType) && journal.sourceId === batch.batchNo)) continue;
      const journalRef = ref('payment.journal', journal.id);
      pair(batchRef, 'journals', journalRef, 'settlement-batches');
      for (const suffix of ['orders', 'refunds']) for (const target of targets(journalRef, suffix)) pair(batchRef, suffix, target, 'settlement-batches');
    }
  }
  for (const log of mockPaymentLogs.filter((log) => log.signatureValid && log.result?.startsWith('processed:'))) {
    const scope = mockPaymentNotifyLogScopes.get(log.id);
    const order = scope && mockPaymentOrders.find((order) => order.orderNo === log.orderNo && order.channelConfigId === log.channelConfigId && order.channel === log.channel && order.appId === scope.appId && order.currency === scope.currency);
    if (order) pair(ref('payment.notify-log', log.id), 'orders', ref('payment.order', order.id), 'notify-logs');
  }
  const suffix = sectionKey.slice(`${source.type}.`.length);
  return [...new Map(targets(source, suffix).map((target) => [refKey(target), target])).values()];
}
