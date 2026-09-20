import { and, desc, eq, exists, inArray, isNotNull, isNull, lt, or, sql, type AnyColumn } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import type { EntityRef, Permission } from '@zenith/shared/core';
import { PAYMENT_RECON_CASE_TYPE_LABELS, type PaymentReconCaseType } from '@zenith/shared/payment';
import type { CanonicalEntityType, EntityRelationItem, EntityRelationPage } from '@zenith/shared/platform';
import {
  paymentOrders as orders, paymentRefunds as refunds, paymentJournals as journals, paymentJournalLines as journalLines,
  paymentReconCases as cases, paymentReconAdjustments as adjustments, paymentChannelConfigs as configs,
  paymentSharingOrders as sharing, paymentSharingReceivers as receivers, paymentSharingReversals as reversals,
  paymentSettlementBatches as batches, paymentSettlementItems as settlementItems, paymentNotifyLogs as notifyLogs,
} from '../../db/schema';
import { hasPermission, runWithCurrentUser } from '../../lib/context';
import { exactTenantCondition, tenantCondition } from '../../lib/tenant';
import { buildWhere } from '../../lib/where-helpers';
import { buildOrdersWhere } from './payment.service';
import type { EntityAnchorResolver, RelationAccessContext, RelationProvider, VisibleEntityAnchor } from '../platform/relations/types';
import { decodeRelationCursor } from '../platform/relations/cursor';
import { relationPage } from '../platform/relations/page';

type Input = Parameters<RelationProvider['list']>[1];
type MoneyScope = { tenantId: number | null; appId: number; channelAccountId: number; currency: string };
type MoneyColumns = { tenantId: AnyColumn; appId: AnyColumn; channelAccountId: AnyColumn; currency: AnyColumn };
type JournalColumns = MoneyColumns & { id: AnyColumn; sourceType: AnyColumn; sourceId: AnyColumn; reversalOfJournalId: AnyColumn };
type PaymentScope = MoneyScope & { orderId: number; orderNo: string; channelConfigId: number; refundId?: number; refundNo?: string };
const ORDER_JOURNAL_TYPES = ['payment.capture', 'payment.preauth.capture', 'payment.fee'];
const REFUND_JOURNAL_TYPES = ['payment.refund', 'payment.fee_refund'];
const SETTLEMENT_JOURNAL_TYPES = ['settlement.initiated', 'settlement.paid', 'settlement.failed'];
const JOURNAL_SOURCE_LABELS: Record<string, string> = {
  'payment.capture': '支付入账', 'payment.preauth.capture': '预授权扣款', 'payment.fee': '支付手续费',
  'payment.refund': '退款入账', 'payment.fee_refund': '手续费退回', 'payment.sharing': '分账入账',
  'payment.sharing_reversal': '分账冲正', 'recon.adjust': '对账调整', 'recon.adjust.reversal': '对账调整冲正',
  'journal.reversal': '凭证冲正', 'settlement.initiated': '结算锁定', 'settlement.paid': '结算出账', 'settlement.failed': '结算退回',
};
function summarySubtitle(type: CanonicalEntityType, value: string | null | undefined): string | undefined {
  if (!value) return undefined;
  if (type === 'payment.journal') return JOURNAL_SOURCE_LABELS[value] ?? '账务入账';
  if (type === 'payment.recon-case') return PAYMENT_RECON_CASE_TYPE_LABELS[value as PaymentReconCaseType] ?? '对账差异';
  if (type === 'payment.notify-log') return value === 'refund' ? '退款回调' : '支付回调';
  return value.slice(0, 240);
}
const capabilities = { view: true, open: true };
const empty = (): EntityRelationPage => ({ items: [], nextCursor: null, hasMore: false });

function idOf(key: string): number | null {
  const id = Number(key);
  return /^[1-9]\d*$/.test(key) && Number.isSafeInteger(id) && id <= 2_147_483_647 ? id : null;
}
function moneyWhere(columns: MoneyColumns, scope: MoneyScope) {
  return and(exactTenantCondition(columns.tenantId, scope.tenantId), eq(columns.appId, scope.appId),
    eq(columns.channelAccountId, scope.channelAccountId), eq(columns.currency, scope.currency));
}
function sameMoney(left: MoneyColumns, right: MoneyColumns) {
  return and(sql`${left.tenantId} is not distinct from ${right.tenantId}`, eq(left.appId, right.appId),
    eq(left.channelAccountId, right.channelAccountId), eq(left.currency, right.currency));
}
function scopeOf(anchor: VisibleEntityAnchor): MoneyScope | null {
  const m = anchor.metadata;
  return typeof m?.appId === 'number' && typeof m.channelAccountId === 'number' && typeof m.currency === 'string'
    ? { tenantId: anchor.tenantId, appId: m.appId, channelAccountId: m.channelAccountId, currency: m.currency } : null;
}
const orderScope = { orderId: orders.id, orderNo: orders.orderNo, tenantId: orders.tenantId, appId: orders.appId,
  channelAccountId: orders.channelAccountId, currency: orders.currency, channelConfigId: orders.channelConfigId };
const refundOrderJoin = and(eq(refunds.orderId, orders.id), eq(refunds.orderNo, orders.orderNo),
  eq(refunds.channelAccountId, orders.channelAccountId), eq(refunds.channel, orders.channel), sql`${refunds.tenantId} is not distinct from ${orders.tenantId}`);

/** Reload only business identity/scope; no customer data or money payload crosses this boundary. */
async function paymentScope(anchor: VisibleEntityAnchor, access: RelationAccessContext): Promise<PaymentScope | null> {
  const id = idOf(anchor.ref.key);
  if (id == null) return null;
  if (anchor.ref.type === 'payment.order') {
    const [row] = await access.db.select(orderScope).from(orders).where(buildWhere(eq(orders.id, id),
      exactTenantCondition(orders.tenantId, anchor.tenantId), await buildOrdersWhere({}, access.db))).limit(1);
    return row ?? null;
  }
  if (anchor.ref.type === 'payment.refund') {
    const [row] = await access.db.select({ ...orderScope, refundId: refunds.id, refundNo: refunds.refundNo }).from(refunds)
      .innerJoin(orders, refundOrderJoin).where(buildWhere(eq(refunds.id, id), exactTenantCondition(refunds.tenantId, anchor.tenantId),
        tenantCondition(refunds, access.user))).limit(1);
    return row ?? null;
  }
  return null;
}

function page<T extends { id: number; title: string; status?: string | null; at?: Date | null; subtitle?: string | null }>(
  rows: T[], limit: number, type: CanonicalEntityType, relationKey: string,
): EntityRelationPage {
  return relationPage(rows, limit, (row): EntityRelationItem => ({ ref: { type, key: String(row.id) }, relationKey,
    title: row.title.slice(0, 160), subtitle: summarySubtitle(type, row.subtitle),
    status: type === 'payment.notify-log' && row.status?.startsWith('processed:') ? 'success' : row.status,
    occurredAt: row.at?.toISOString(), capabilities }));
}

const caseMoney = { tenantId: cases.tenantId, appId: cases.applicationId, channelAccountId: cases.accountId, currency: cases.currency };
const adjustmentCaseJoin = and(eq(adjustments.caseId, cases.id), eq(adjustments.applicationId, cases.applicationId),
  sql`${adjustments.tenantId} is not distinct from ${cases.tenantId}`);
const adjustmentConfigJoin = and(eq(configs.id, adjustments.channelConfigId), eq(configs.channelAccountId, cases.accountId),
  sql`${configs.tenantId} is not distinct from ${cases.tenantId}`);
const sharingOrderJoin = and(eq(sharing.orderNo, orders.orderNo), sql`${sharing.tenantId} is not distinct from ${orders.tenantId}`);
const reversalSharingJoin = and(eq(reversals.sharingOrderId, sharing.id), sql`${reversals.tenantId} is not distinct from ${sharing.tenantId}`);

/** Explicit journal producer semantics, verified against the corresponding posting services. */
function journalBusinessMatch(journal: JournalColumns, access: RelationAccessContext, refundOnly: boolean) {
  const refundIdentity = refundOnly ? eq(journal.sourceId, refunds.refundNo) : exists(access.db.select({ id: refunds.id }).from(refunds).where(and(
    eq(refunds.orderId, orders.id), eq(refunds.orderNo, orders.orderNo), eq(refunds.channelAccountId, orders.channelAccountId),
    sql`${refunds.tenantId} is not distinct from ${orders.tenantId}`, eq(journal.sourceId, refunds.refundNo),
  )).limit(1));
  const adjustmentIdentity = exists(access.db.select({ id: adjustments.id }).from(adjustments).innerJoin(cases, adjustmentCaseJoin)
    .innerJoin(configs, adjustmentConfigJoin).where(buildWhere(eq(adjustments.journalId, journal.id),
      eq(journal.sourceId, sql`${adjustments.id}::text`), sameMoney(caseMoney, orders), eq(cases.orderId, orders.id),
      refundOnly ? eq(cases.refundId, refunds.id) : undefined,
      or(and(eq(journal.sourceType, 'recon.adjust'), isNull(adjustments.reversalOfId)),
        and(eq(journal.sourceType, 'recon.adjust.reversal'), isNotNull(adjustments.reversalOfId))),
    )).limit(1));
  return buildWhere(sameMoney(journal, orders), or(
    refundOnly ? undefined : and(inArray(journal.sourceType, ORDER_JOURNAL_TYPES), eq(journal.sourceId, orders.orderNo)),
    and(inArray(journal.sourceType, REFUND_JOURNAL_TYPES), refundIdentity), adjustmentIdentity,
    refundOnly ? undefined : and(eq(journal.sourceType, 'payment.sharing'), exists(access.db.select({ id: sharing.id }).from(sharing)
      .where(and(eq(sharing.orderNo, orders.orderNo), sql`${sharing.tenantId} is not distinct from ${orders.tenantId}`, eq(sharing.sharingNo, journal.sourceId))).limit(1))),
    refundOnly ? undefined : and(eq(journal.sourceType, 'payment.sharing_reversal'), exists(access.db.select({ id: reversals.id }).from(reversals)
      .innerJoin(sharing, reversalSharingJoin).where(and(eq(sharing.orderNo, orders.orderNo), sql`${sharing.tenantId} is not distinct from ${orders.tenantId}`, eq(reversals.reversalNo, journal.sourceId))).limit(1))),
  ));
}
function journalForBusiness(access: RelationAccessContext, refundOnly: boolean) {
  const original = alias(journals, 'relation_original_journal');
  return or(journalBusinessMatch(journals, access, refundOnly), and(eq(journals.sourceType, 'journal.reversal'),
    exists(access.db.select({ id: original.id }).from(original).where(buildWhere(eq(original.id, journals.reversalOfJournalId),
      eq(journals.sourceId, original.journalNo), sameMoney(journals, original), journalBusinessMatch(original, access, refundOnly))).limit(1))));
}

async function resolveFinancialAnchor(ref: EntityRef, access: RelationAccessContext): Promise<VisibleEntityAnchor | null> {
  const id = idOf(ref.key);
  if (id == null) return null;
  switch (ref.type) {
    case 'payment.journal': {
      if (!(await hasPermission('payment:ledger:list'))) return null;
      const [row] = await access.db.select({ id: journals.id, title: journals.journalNo, tenantId: journals.tenantId,
        appId: journals.appId, channelAccountId: journals.channelAccountId, currency: journals.currency, sourceType: journals.sourceType,
        sourceId: journals.sourceId, reversalOfJournalId: journals.reversalOfJournalId }).from(journals)
        .where(buildWhere(eq(journals.id, id), tenantCondition(journals, access.user))).limit(1);
      return row ? { ref: { type: 'payment.journal', key: String(id) }, title: row.title, tenantId: row.tenantId, metadata: row } : null;
    }
    case 'payment.recon-case': {
      if (!(await hasPermission('payment:recon:list'))) return null;
      const [row] = await access.db.select({ id: cases.id, tenantId: cases.tenantId, appId: cases.applicationId, channelAccountId: cases.accountId,
        currency: cases.currency, orderId: cases.orderId, refundId: cases.refundId }).from(cases)
        .where(buildWhere(eq(cases.id, id), tenantCondition(cases, access.user))).limit(1);
      return row ? { ref: { type: 'payment.recon-case', key: String(id) }, title: `对账案件 #${id}`, tenantId: row.tenantId, metadata: row } : null;
    }
    case 'payment.recon-adjustment': {
      if (!(await hasPermission('payment:recon:list'))) return null;
      const [row] = await access.db.select({ id: adjustments.id, tenantId: adjustments.tenantId, appId: adjustments.applicationId,
        channelAccountId: cases.accountId, currency: cases.currency, orderId: cases.orderId, refundId: cases.refundId,
        caseId: cases.id, journalId: adjustments.journalId }).from(adjustments).innerJoin(cases, adjustmentCaseJoin).innerJoin(configs, adjustmentConfigJoin)
        .where(buildWhere(eq(adjustments.id, id), tenantCondition(adjustments, access.user))).limit(1);
      return row ? { ref: { type: 'payment.recon-adjustment', key: String(id) }, title: `对账调整 #${id}`, tenantId: row.tenantId, metadata: row } : null;
    }
    case 'payment.sharing-order': {
      if (!(await hasPermission('payment:sharing:list'))) return null;
      const [row] = await access.db.select({ id: sharing.id, title: sharing.sharingNo, receiverId: sharing.receiverId, ...orderScope })
        .from(sharing).innerJoin(orders, sharingOrderJoin).where(buildWhere(eq(sharing.id, id), tenantCondition(sharing, access.user))).limit(1);
      return row ? { ref: { type: 'payment.sharing-order', key: String(id) }, title: row.title, tenantId: row.tenantId, metadata: row } : null;
    }
    case 'payment.sharing-receiver': {
      if (!(await hasPermission('payment:sharing:list'))) return null;
      const [row] = await access.db.select({ title: receivers.name, tenantId: receivers.tenantId }).from(receivers)
        .where(buildWhere(eq(receivers.id, id), tenantCondition(receivers, access.user))).limit(1);
      return row ? { ref: { type: 'payment.sharing-receiver', key: String(id) }, title: row.title, tenantId: row.tenantId } : null;
    }
    case 'payment.sharing-reversal': {
      if (!(await hasPermission('payment:sharing:list'))) return null;
      const [row] = await access.db.select({ id: reversals.id, title: reversals.reversalNo, sharingOrderId: sharing.id, receiverId: sharing.receiverId, ...orderScope })
        .from(reversals).innerJoin(sharing, reversalSharingJoin).innerJoin(orders, sharingOrderJoin)
        .where(buildWhere(eq(reversals.id, id), tenantCondition(reversals, access.user))).limit(1);
      return row ? { ref: { type: 'payment.sharing-reversal', key: String(id) }, title: row.title, tenantId: row.tenantId, metadata: row } : null;
    }
    case 'payment.settlement-batch': {
      if (!(await hasPermission('payment:settlement:list'))) return null;
      const [row] = await access.db.select({ id: batches.id, title: batches.batchNo, tenantId: batches.tenantId, appId: batches.appId,
        channelAccountId: batches.channelAccountId, currency: batches.currency }).from(batches)
        .where(buildWhere(eq(batches.id, id), tenantCondition(batches, access.user))).limit(1);
      return row ? { ref: { type: 'payment.settlement-batch', key: String(id) }, title: row.title, tenantId: row.tenantId, metadata: row } : null;
    }
    case 'payment.notify-log': {
      if (!(await hasPermission('payment:log:list'))) return null;
      const [row] = await access.db.select({ id: notifyLogs.id, tenantId: notifyLogs.tenantId, appId: orders.appId,
        channelAccountId: configs.channelAccountId, currency: orders.currency, orderNo: notifyLogs.orderNo, channelConfigId: notifyLogs.channelConfigId,
        result: notifyLogs.result }).from(notifyLogs).innerJoin(configs, and(eq(configs.id, notifyLogs.channelConfigId), sql`${configs.tenantId} is not distinct from ${notifyLogs.tenantId}`))
        .leftJoin(orders, and(eq(notifyLogs.orderNo, orders.orderNo), eq(notifyLogs.appId, orders.appId), eq(notifyLogs.channelConfigId, orders.channelConfigId),
          eq(configs.channelAccountId, orders.channelAccountId), sql`${notifyLogs.tenantId} is not distinct from ${orders.tenantId}`,
          eq(notifyLogs.signatureValid, true), sql`${notifyLogs.result} like 'processed:%'`, or(isNull(notifyLogs.currency), eq(notifyLogs.currency, orders.currency))))
        .where(buildWhere(eq(notifyLogs.id, id), tenantCondition(notifyLogs, access.user))).limit(1);
      return row ? { ref: { type: 'payment.notify-log', key: String(id) }, title: `渠道回调 #${id}`, tenantId: row.tenantId, metadata: row } : null;
    }
    default: return null;
  }
}

async function listJournals(anchor: VisibleEntityAnchor, input: Input): Promise<EntityRelationPage> {
  const { access, limit, cursor } = input;
  const before = decodeRelationCursor(cursor);
  const key = `${anchor.ref.type}.journals`;
  if (anchor.ref.type === 'payment.order' || anchor.ref.type === 'payment.refund') {
    const scope = await paymentScope(anchor, access);
    if (!scope) return empty();
    const rows = await access.db.select({ id: journals.id, title: journals.journalNo, subtitle: journals.sourceType, at: journals.postedAt })
      .from(journals).innerJoin(orders, eq(orders.id, scope.orderId))
      .leftJoin(refunds, scope.refundId ? and(eq(refunds.id, scope.refundId), refundOrderJoin) : sql`false`)
      .where(buildWhere(moneyWhere(journals, scope), journalForBusiness(access, scope.refundId !== undefined),
        tenantCondition(journals, access.user), before ? lt(journals.id, before) : undefined)).orderBy(desc(journals.id)).limit(limit + 1);
    return page(rows, limit, 'payment.journal', key);
  }
  const scope = scopeOf(anchor);
  if (!scope) return empty();
  const id = idOf(anchor.ref.key)!;
  const relation = anchor.ref.type === 'payment.settlement-batch'
    ? or(and(inArray(journals.sourceType, SETTLEMENT_JOURNAL_TYPES), eq(journals.sourceId, String(anchor.metadata?.title))),
      exists(access.db.select({ id: settlementItems.id }).from(settlementItems).innerJoin(journalLines, eq(journalLines.id, settlementItems.journalLineId))
        .where(and(eq(settlementItems.batchId, id), eq(journalLines.journalId, journals.id), moneyWhere(settlementItems, scope), sameMoney(settlementItems, journals))).limit(1)))
    : anchor.ref.type === 'payment.recon-adjustment'
      ? and(eq(journals.id, Number(anchor.metadata?.journalId)), inArray(journals.sourceType, ['recon.adjust', 'recon.adjust.reversal']), eq(journals.sourceId, anchor.ref.key))
      : anchor.ref.type === 'payment.sharing-order'
        ? and(eq(journals.sourceType, 'payment.sharing'), eq(journals.sourceId, String(anchor.metadata?.title)))
        : and(eq(journals.sourceType, 'payment.sharing_reversal'), eq(journals.sourceId, String(anchor.metadata?.title)));
  const rows = await access.db.select({ id: journals.id, title: journals.journalNo, subtitle: journals.sourceType, at: journals.postedAt }).from(journals)
    .where(buildWhere(relation, moneyWhere(journals, scope), tenantCondition(journals, access.user), before ? lt(journals.id, before) : undefined))
    .orderBy(desc(journals.id)).limit(limit + 1);
  return page(rows, limit, 'payment.journal', key);
}

/** Exact recognition of ledger lines; date ranges and aggregate amounts are never association evidence. */
function settledJournal(anchor: VisibleEntityAnchor, access: RelationAccessContext) {
  const scope = scopeOf(anchor);
  if (!scope) return sql`false`;
  return exists(access.db.select({ id: settlementItems.id }).from(settlementItems).innerJoin(journalLines, eq(journalLines.id, settlementItems.journalLineId))
    .where(and(eq(settlementItems.batchId, Number(anchor.ref.key)), eq(journalLines.journalId, journals.id), moneyWhere(settlementItems, scope), sameMoney(settlementItems, journals))).limit(1));
}

async function listBusinessRecords(anchor: VisibleEntityAnchor, { access, limit, cursor }: Input, refundTarget: boolean): Promise<EntityRelationPage> {
  const scope = scopeOf(anchor);
  if (!scope) return empty();
  const before = decodeRelationCursor(cursor);
  let association;
  if (anchor.ref.type === 'payment.journal') {
    association = exists(access.db.select({ id: journals.id }).from(journals).where(buildWhere(eq(journals.id, Number(anchor.ref.key)), moneyWhere(journals, scope), journalForBusiness(access, refundTarget))).limit(1));
  } else if (anchor.ref.type === 'payment.settlement-batch') {
    association = exists(access.db.select({ id: journals.id }).from(journals).where(buildWhere(moneyWhere(journals, scope), settledJournal(anchor, access), journalForBusiness(access, refundTarget))).limit(1));
  } else if (anchor.ref.type === 'payment.notify-log') {
    // appId is populated only after applyNotify resolves and validates the business object.
    association = exists(access.db.select({ id: notifyLogs.id }).from(notifyLogs).where(and(eq(notifyLogs.id, Number(anchor.ref.key)),
      eq(notifyLogs.signatureValid, true), sql`${notifyLogs.result} like 'processed:%'`, eq(notifyLogs.orderNo, orders.orderNo),
      eq(notifyLogs.appId, orders.appId), eq(notifyLogs.channelConfigId, orders.channelConfigId),
      exactTenantCondition(notifyLogs.tenantId, anchor.tenantId), or(isNull(notifyLogs.currency), eq(notifyLogs.currency, orders.currency)))).limit(1));
  } else {
    const id = refundTarget ? anchor.metadata?.refundId : anchor.metadata?.orderId;
    if (typeof id !== 'number') return empty();
    association = refundTarget ? and(eq(refunds.id, id), eq(orders.id, Number(anchor.metadata?.orderId))) : eq(orders.id, id);
  }
  const key = `${anchor.ref.type}.${refundTarget ? 'refunds' : 'orders'}`;
  if (refundTarget) {
    const rows = await access.db.select({ id: refunds.id, title: refunds.refundNo, status: refunds.status, at: refunds.createdAt }).from(refunds).innerJoin(orders, refundOrderJoin)
      .where(buildWhere(association, moneyWhere(orders, scope), tenantCondition(refunds, access.user), before ? lt(refunds.id, before) : undefined))
      .orderBy(desc(refunds.id)).limit(limit + 1);
    return page(rows, limit, 'payment.refund', key);
  }
  const rows = await access.db.select({ id: orders.id, title: orders.orderNo, status: orders.status, at: orders.createdAt }).from(orders)
    .where(buildWhere(association, moneyWhere(orders, scope), await buildOrdersWhere({}, access.db), before ? lt(orders.id, before) : undefined))
    .orderBy(desc(orders.id)).limit(limit + 1);
  return page(rows, limit, 'payment.order', key);
}

async function listReconCases(anchor: VisibleEntityAnchor, { access, cursor, limit }: Input): Promise<EntityRelationPage> {
  const isPayment = anchor.ref.type === 'payment.order' || anchor.ref.type === 'payment.refund';
  const business = isPayment ? await paymentScope(anchor, access) : null;
  const scope = isPayment ? business : scopeOf(anchor);
  if (!scope) return empty();
  const before = decodeRelationCursor(cursor);
  const rows = await access.db.select({ id: cases.id, title: sql<string>`'对账案件 #' || ${cases.id}::text`, status: cases.status, subtitle: cases.type, at: cases.createdAt }).from(cases)
    .where(buildWhere(moneyWhere(caseMoney, scope), tenantCondition(cases, access.user),
      business ? eq(cases.orderId, business.orderId) : undefined,
      anchor.ref.type === 'payment.recon-adjustment' ? eq(cases.id, Number(anchor.metadata?.caseId)) :
        business?.refundId !== undefined ? eq(cases.refundId, business.refundId) : eq(cases.orderId, business!.orderId),
      before ? lt(cases.id, before) : undefined)).orderBy(desc(cases.id)).limit(limit + 1);
  return page(rows, limit, 'payment.recon-case', `${anchor.ref.type}.recon-cases`);
}

async function listReconAdjustments(anchor: VisibleEntityAnchor, { access, cursor, limit }: Input): Promise<EntityRelationPage> {
  const isPayment = anchor.ref.type === 'payment.order' || anchor.ref.type === 'payment.refund';
  const business = isPayment ? await paymentScope(anchor, access) : null;
  const scope = isPayment ? business : scopeOf(anchor);
  if (!scope) return empty();
  if (anchor.ref.type === 'payment.journal' && !['recon.adjust', 'recon.adjust.reversal'].includes(String(anchor.metadata?.sourceType))) return empty();
  const before = decodeRelationCursor(cursor);
  const rows = await access.db.select({ id: adjustments.id, title: sql<string>`'对账调整 #' || ${adjustments.id}::text`, status: adjustments.status, at: adjustments.createdAt })
    .from(adjustments).innerJoin(cases, adjustmentCaseJoin).innerJoin(configs, adjustmentConfigJoin)
    .where(buildWhere(moneyWhere(caseMoney, scope), tenantCondition(adjustments, access.user),
      business ? eq(cases.orderId, business.orderId) : undefined,
      anchor.ref.type === 'payment.journal' ? and(eq(adjustments.journalId, Number(anchor.ref.key)), eq(sql`${adjustments.id}::text`, String(anchor.metadata?.sourceId))) :
        anchor.ref.type === 'payment.recon-case' ? eq(adjustments.caseId, Number(anchor.ref.key)) :
          business?.refundId !== undefined ? eq(cases.refundId, business.refundId) : eq(cases.orderId, business!.orderId),
      before ? lt(adjustments.id, before) : undefined)).orderBy(desc(adjustments.id)).limit(limit + 1);
  return page(rows, limit, 'payment.recon-adjustment', `${anchor.ref.type}.recon-adjustments`);
}

async function listSharingOrders(anchor: VisibleEntityAnchor, { access, cursor, limit }: Input): Promise<EntityRelationPage> {
  const before = decodeRelationCursor(cursor);
  const scope = anchor.ref.type === 'payment.order' ? await paymentScope(anchor, access) : scopeOf(anchor);
  if (anchor.ref.type !== 'payment.sharing-receiver' && !scope) return empty();
  if (anchor.ref.type === 'payment.journal' && anchor.metadata?.sourceType !== 'payment.sharing') return empty();
  const rows = await access.db.select({ id: sharing.id, title: sharing.sharingNo, status: sharing.status, at: sharing.createdAt }).from(sharing)
    .innerJoin(orders, sharingOrderJoin).innerJoin(receivers, and(eq(receivers.id, sharing.receiverId), sql`${receivers.tenantId} is not distinct from ${sharing.tenantId}`))
    .where(buildWhere(exactTenantCondition(sharing.tenantId, anchor.tenantId), tenantCondition(sharing, access.user),
      scope ? moneyWhere(orders, scope) : undefined,
      anchor.ref.type === 'payment.sharing-receiver' ? eq(sharing.receiverId, Number(anchor.ref.key)) :
        anchor.ref.type === 'payment.sharing-reversal' ? eq(sharing.id, Number(anchor.metadata?.sharingOrderId)) :
          anchor.ref.type === 'payment.journal' ? eq(sharing.sharingNo, String(anchor.metadata?.sourceId)) : eq(orders.id, (scope as PaymentScope).orderId),
      before ? lt(sharing.id, before) : undefined)).orderBy(desc(sharing.id)).limit(limit + 1);
  return page(rows, limit, 'payment.sharing-order', `${anchor.ref.type}.sharing-orders`);
}

async function listReceivers(anchor: VisibleEntityAnchor, { access, cursor, limit }: Input): Promise<EntityRelationPage> {
  const scope = scopeOf(anchor);
  if (!scope) return empty();
  const before = decodeRelationCursor(cursor);
  const rows = await access.db.select({ id: receivers.id, title: receivers.name, status: receivers.status, at: receivers.createdAt }).from(receivers)
    .where(buildWhere(eq(receivers.id, Number(anchor.metadata?.receiverId)), exactTenantCondition(receivers.tenantId, anchor.tenantId), tenantCondition(receivers, access.user),
      before ? lt(receivers.id, before) : undefined)).orderBy(desc(receivers.id)).limit(limit + 1);
  return page(rows, limit, 'payment.sharing-receiver', `${anchor.ref.type}.receiver`);
}

async function listSharingReversals(anchor: VisibleEntityAnchor, { access, cursor, limit }: Input): Promise<EntityRelationPage> {
  const scope = scopeOf(anchor);
  if (!scope) return empty();
  if (anchor.ref.type === 'payment.journal' && anchor.metadata?.sourceType !== 'payment.sharing_reversal') return empty();
  const before = decodeRelationCursor(cursor);
  const rows = await access.db.select({ id: reversals.id, title: reversals.reversalNo, status: reversals.status, at: reversals.createdAt }).from(reversals)
    .innerJoin(sharing, reversalSharingJoin).innerJoin(orders, sharingOrderJoin).where(buildWhere(
      anchor.ref.type === 'payment.journal' ? eq(reversals.reversalNo, String(anchor.metadata?.sourceId)) : eq(sharing.id, Number(anchor.ref.key)),
      moneyWhere(orders, scope), exactTenantCondition(reversals.tenantId, anchor.tenantId), tenantCondition(reversals, access.user),
      before ? lt(reversals.id, before) : undefined)).orderBy(desc(reversals.id)).limit(limit + 1);
  return page(rows, limit, 'payment.sharing-reversal', `${anchor.ref.type}.${anchor.ref.type === 'payment.journal' ? 'sharing-reversals' : 'reversals'}`);
}

async function listSettlements(anchor: VisibleEntityAnchor, { access, cursor, limit }: Input): Promise<EntityRelationPage> {
  const isPayment = anchor.ref.type === 'payment.order' || anchor.ref.type === 'payment.refund';
  const business = isPayment ? await paymentScope(anchor, access) : null;
  const scope = isPayment ? business : scopeOf(anchor);
  if (!scope) return empty();
  const before = decodeRelationCursor(cursor);
  const ownedJournal = anchor.ref.type === 'payment.journal' ? eq(journals.id, Number(anchor.ref.key))
    : exists(access.db.select({ id: orders.id }).from(orders).leftJoin(refunds, business?.refundId !== undefined ? and(eq(refunds.id, business.refundId), refundOrderJoin) : sql`false`)
      .where(buildWhere(eq(orders.id, business!.orderId), moneyWhere(orders, scope), journalForBusiness(access, anchor.ref.type === 'payment.refund'))).limit(1));
  const rows = await access.db.select({ id: batches.id, title: batches.batchNo, status: batches.status, at: batches.createdAt }).from(batches)
    .where(buildWhere(moneyWhere(batches, scope), tenantCondition(batches, access.user),
      or(anchor.ref.type === 'payment.journal' ? exists(access.db.select({ id: journals.id }).from(journals)
        .where(and(eq(journals.id, Number(anchor.ref.key)), inArray(journals.sourceType, SETTLEMENT_JOURNAL_TYPES),
          eq(journals.sourceId, batches.batchNo), sameMoney(journals, batches))).limit(1)) : undefined,
      exists(access.db.select({ id: settlementItems.id }).from(settlementItems).innerJoin(journalLines, eq(journalLines.id, settlementItems.journalLineId))
        .innerJoin(journals, eq(journals.id, journalLines.journalId)).where(buildWhere(eq(settlementItems.batchId, batches.id),
          sameMoney(settlementItems, batches), sameMoney(journals, batches), ownedJournal)).limit(1))),
      before ? lt(batches.id, before) : undefined)).orderBy(desc(batches.id)).limit(limit + 1);
  return page(rows, limit, 'payment.settlement-batch', `${anchor.ref.type}.settlement-batches`);
}

async function listNotifyLogs(anchor: VisibleEntityAnchor, { access, cursor, limit }: Input): Promise<EntityRelationPage> {
  const scope = await paymentScope(anchor, access);
  if (!scope) return empty();
  const before = decodeRelationCursor(cursor);
  const rows = await access.db.select({ id: notifyLogs.id, title: sql<string>`'渠道回调 #' || ${notifyLogs.id}::text`, status: notifyLogs.result, subtitle: notifyLogs.scene, at: notifyLogs.createdAt })
    .from(notifyLogs).innerJoin(configs, and(eq(configs.id, notifyLogs.channelConfigId), exactTenantCondition(configs.tenantId, scope.tenantId)))
    .where(buildWhere(eq(notifyLogs.orderNo, scope.orderNo), eq(notifyLogs.appId, scope.appId), eq(notifyLogs.channelConfigId, scope.channelConfigId),
      eq(configs.channelAccountId, scope.channelAccountId), exactTenantCondition(notifyLogs.tenantId, scope.tenantId), tenantCondition(notifyLogs, access.user),
      eq(notifyLogs.signatureValid, true), sql`${notifyLogs.result} like 'processed:%'`, or(isNull(notifyLogs.currency), eq(notifyLogs.currency, scope.currency)),
      before ? lt(notifyLogs.id, before) : undefined)).orderBy(desc(notifyLogs.id)).limit(limit + 1);
  return page(rows, limit, 'payment.notify-log', `${anchor.ref.type}.notify-logs`);
}

function relation(sourceType: CanonicalEntityType, suffix: string, targetType: CanonicalEntityType, permission: Permission,
  list: RelationProvider['list'], cardinality: 'one' | 'many' = 'many'): RelationProvider {
  const key = `${sourceType}.${suffix}`;
  return { sourceType, key, permissions: [permission], descriptor: { key, labelKey: `relation.${key}`, targetTypes: [targetType], kind: 'derived', cardinality, capabilities },
    list: (anchor, input) => runWithCurrentUser(input.access.user, async () => (await hasPermission(permission)) ? list(anchor, input) : empty()) };
}

const financialTypes = ['payment.journal', 'payment.recon-case', 'payment.recon-adjustment', 'payment.sharing-order',
  'payment.sharing-receiver', 'payment.sharing-reversal', 'payment.settlement-batch', 'payment.notify-log'] as const;
export const paymentFinancialAnchorResolvers: readonly EntityAnchorResolver[] = financialTypes.map((type) => ({ type,
  resolve: (ref, access) => runWithCurrentUser(access.user, () => resolveFinancialAnchor(ref, access)) }));
export const paymentFinancialRelationProviders: readonly RelationProvider[] = [
  ...(['payment.order', 'payment.refund'] as const).flatMap((source) => [
    relation(source, 'journals', 'payment.journal', 'payment:ledger:list', listJournals),
    relation(source, 'recon-cases', 'payment.recon-case', 'payment:recon:list', listReconCases),
    relation(source, 'recon-adjustments', 'payment.recon-adjustment', 'payment:recon:list', listReconAdjustments),
    relation(source, 'settlement-batches', 'payment.settlement-batch', 'payment:settlement:list', listSettlements),
  ]),
  relation('payment.order', 'sharing-orders', 'payment.sharing-order', 'payment:sharing:list', listSharingOrders),
  relation('payment.order', 'notify-logs', 'payment.notify-log', 'payment:log:list', listNotifyLogs),
  ...(['payment.journal', 'payment.recon-case', 'payment.recon-adjustment', 'payment.settlement-batch'] as const).flatMap((source) => [
    relation(source, 'orders', 'payment.order', 'payment:order:list', (anchor, input) => listBusinessRecords(anchor, input, false)),
    relation(source, 'refunds', 'payment.refund', 'payment:refund:list', (anchor, input) => listBusinessRecords(anchor, input, true)),
  ]),
  ...(['payment.sharing-order', 'payment.sharing-reversal', 'payment.notify-log'] as const).map((source) =>
    relation(source, 'orders', 'payment.order', 'payment:order:list', (anchor, input) => listBusinessRecords(anchor, input, false), 'one')),
  relation('payment.journal', 'settlement-batches', 'payment.settlement-batch', 'payment:settlement:list', listSettlements),
  relation('payment.journal', 'recon-adjustments', 'payment.recon-adjustment', 'payment:recon:list', listReconAdjustments),
  relation('payment.journal', 'sharing-orders', 'payment.sharing-order', 'payment:sharing:list', listSharingOrders),
  relation('payment.journal', 'sharing-reversals', 'payment.sharing-reversal', 'payment:sharing:list', listSharingReversals),
  relation('payment.recon-case', 'recon-adjustments', 'payment.recon-adjustment', 'payment:recon:list', listReconAdjustments),
  relation('payment.recon-adjustment', 'recon-cases', 'payment.recon-case', 'payment:recon:list', listReconCases, 'one'),
  ...(['payment.recon-adjustment', 'payment.sharing-order', 'payment.sharing-reversal', 'payment.settlement-batch'] as const).map((source) =>
    relation(source, 'journals', 'payment.journal', 'payment:ledger:list', listJournals)),
  relation('payment.sharing-order', 'receiver', 'payment.sharing-receiver', 'payment:sharing:list', listReceivers, 'one'),
  relation('payment.sharing-order', 'reversals', 'payment.sharing-reversal', 'payment:sharing:list', listSharingReversals),
  relation('payment.sharing-receiver', 'sharing-orders', 'payment.sharing-order', 'payment:sharing:list', listSharingOrders),
  relation('payment.sharing-reversal', 'sharing-orders', 'payment.sharing-order', 'payment:sharing:list', listSharingOrders, 'one'),
];
