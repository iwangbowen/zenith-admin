/**
 * 支付结算批次 Service。
 * 按渠道 + 账期聚合成功订单生成结算批次（净额 = 收款 - 手续费 - 退款 - 分账），
 * 状态机：生成(pending) → 结算中(settling) → 已结算(settled)/失败(failed)，结算时记资金台账。
 */
import { and, between, desc, eq, inArray, isNull, lte, sql, type SQL } from 'drizzle-orm';
import { HTTPException } from 'hono/http-exception';
import { genPaymentNo } from './payment-no';
import { db } from '../../db';
import { buildListResult } from '../../lib/list-query';
import {
  paymentApps,
  paymentChannelConfigs,
  paymentJournalLines,
  paymentJournals,
  paymentLedgerAccounts,
  paymentSettlementBatches,
  paymentSettlementItems,
  type PaymentSettlementBatchRow,
} from '../../db/schema';
import { requireRow } from '../../lib/db-assert';
import { currentUser } from '../../lib/context';
import { requireTenantScopeId, tenantCondition, exactTenantCondition } from '../../lib/tenant';
import { buildWhere, withPagination } from '../../lib/where-helpers';
import { formatDate, formatDateTime, formatNullableDateTime, parseDateRangeStart, parseDateRangeEnd } from '../../lib/datetime';
import { isPgUniqueViolation, rethrowPgUniqueViolation } from '../../lib/db-errors';
import { postSystemJournalWithin } from './payment-journal.service';
import logger from '../../lib/logger';
import type { PaymentChannel, PaymentSettlementBatch, PaymentSettlementItem, PaymentSettlementStatus } from '@zenith/shared/payment';

// Only provider-derived and explicitly approved reconciliation movements are
// eligible for payout. Manual adjustments, reservations and transfer journals
// must never be swept into a settlement batch automatically.
const SETTLEMENT_ELIGIBLE_SOURCE_TYPES = [
  'payment.capture',
  'payment.preauth.capture',
  'payment.fee',
  'payment.fee_refund',
  'payment.refund',
  'payment.sharing',
  'payment.sharing_reversal',
  'recon.adjust',
] as const;

/** 待结算分录的公共过滤：商户可用账户、可结算来源类型、尚未被任何结算批次认领 */
function unsettledEligibleLineConditions(): SQL[] {
  return [
    isNull(paymentSettlementItems.id),
    inArray(paymentJournals.sourceType, SETTLEMENT_ELIGIBLE_SOURCE_TYPES),
    eq(paymentLedgerAccounts.code, 'merchant_available'),
  ];
}

export function mapSettlementBatch(row: PaymentSettlementBatchRow): PaymentSettlementBatch {
  return {
    id: row.id,
    batchNo: row.batchNo,
    channel: row.channel,
    appId: row.appId,
    channelConfigId: row.channelConfigId,
    currency: row.currency,
    periodStart: row.periodStart,
    periodEnd: row.periodEnd,
    status: row.status,
    orderCount: row.orderCount,
    grossAmount: row.grossAmount,
    feeAmount: row.feeAmount,
    refundAmount: row.refundAmount,
    sharingAmount: row.sharingAmount,
    netAmount: row.netAmount,
    settledAt: formatNullableDateTime(row.settledAt),
    failureReason: row.failureReason ?? null,
    payoutReference: row.payoutReference ?? null,
    version: row.version,
    remark: row.remark ?? null,
    createdAt: formatDateTime(row.createdAt),
    updatedAt: formatDateTime(row.updatedAt),
  };
}

export interface ListSettlementsQuery {
  page?: number;
  pageSize?: number;
  channel?: PaymentChannel;
  status?: PaymentSettlementStatus;
}

export async function listSettlements(q: ListSettlementsQuery) {
  const page = q.page ?? 1;
  const pageSize = q.pageSize ?? 10;
  const conds = [];
  if (q.channel) conds.push(eq(paymentSettlementBatches.channel, q.channel));
  if (q.status) conds.push(eq(paymentSettlementBatches.status, q.status));
  const where = buildWhere(...conds, tenantCondition(paymentSettlementBatches, currentUser()));
  return buildListResult({
    page,
    pageSize,
    count: () => db.$count(paymentSettlementBatches, where),
    rows: () => withPagination(db.select().from(paymentSettlementBatches).where(where).orderBy(desc(paymentSettlementBatches.id)).$dynamic(), page, pageSize),
    map: mapSettlementBatch,
  });
}

async function ensureBatch(id: number): Promise<PaymentSettlementBatchRow> {
  const tc = tenantCondition(paymentSettlementBatches, currentUser());
  const [row] = await db.select().from(paymentSettlementBatches).where(and(eq(paymentSettlementBatches.id, id), tc)).limit(1);
  requireRow(row, '结算批次不存在');
  return row;
}

async function ensureWritableBatch(id: number, tenantId: number | null): Promise<PaymentSettlementBatchRow> {
  const [row] = await db
    .select()
    .from(paymentSettlementBatches)
    .where(and(
      eq(paymentSettlementBatches.id, id),
      exactTenantCondition(paymentSettlementBatches.tenantId, tenantId),
    ))
    .limit(1);
  requireRow(row, '结算批次不存在');
  return row;
}

export async function getSettlement(id: number): Promise<PaymentSettlementBatch> {
  return mapSettlementBatch(await ensureBatch(id));
}

export async function listSettlementItems(id: number): Promise<PaymentSettlementItem[]> {
  await ensureBatch(id);
  const rows = await db
    .select()
    .from(paymentSettlementItems)
    .where(eq(paymentSettlementItems.batchId, id))
    .orderBy(paymentSettlementItems.id);
  return rows.map((row) => ({
    id: row.id,
    batchId: row.batchId,
    journalLineId: row.journalLineId,
    amount: row.amount.toString(),
    appId: row.appId,
    channelConfigId: row.channelConfigId,
    currency: row.currency,
    createdAt: formatDateTime(row.createdAt),
  }));
}

export interface GenerateSettlementInput {
  applicationId: number;
  channelConfigId: number;
  currency?: string;
  periodStart: string;
  periodEnd: string;
  remark?: string;
}

/** 生成结算批次：逐条认领 merchant_available 分录的带符号净额贡献；同一账期允许增量批次，分录行不可重复认领。 */
export async function generateSettlement(input: GenerateSettlementInput, tenantIdOverride?: number | null): Promise<PaymentSettlementBatch> {
  const tenantId = tenantIdOverride === undefined ? requireTenantScopeId(currentUser()) : tenantIdOverride;
  const configTenant = exactTenantCondition(paymentChannelConfigs.tenantId, tenantId);
  const [maybeScope] = await db
    .select({
      appId: paymentApps.id,
      wechatConfigId: paymentApps.wechatConfigId,
      alipayConfigId: paymentApps.alipayConfigId,
      unionpayConfigId: paymentApps.unionpayConfigId,
      channel: paymentChannelConfigs.channel,
    })
    .from(paymentApps)
    .innerJoin(paymentChannelConfigs, eq(paymentChannelConfigs.id, input.channelConfigId))
    .where(and(
      eq(paymentApps.id, input.applicationId),
      eq(paymentApps.status, 'enabled'),
      eq(paymentChannelConfigs.status, 'enabled'),
      configTenant,
      exactTenantCondition(paymentApps.tenantId, tenantId),
    ))
    .limit(1);
  const scope = requireRow(maybeScope, '支付应用或商户配置不存在、未启用或不属于当前租户', 400);
  const boundConfigId = scope.channel === 'wechat'
    ? scope.wechatConfigId
    : scope.channel === 'alipay'
      ? scope.alipayConfigId
      : scope.unionpayConfigId;
  if (boundConfigId !== input.channelConfigId) throw new HTTPException(400, { message: '商户配置未绑定到所选支付应用' });

  const start = parseDateRangeStart(input.periodStart);
  const end = parseDateRangeEnd(input.periodEnd);
  if (!start || !end) throw new HTTPException(400, { message: '账期格式不正确（YYYY-MM-DD）' });
  if (start > end) throw new HTTPException(400, { message: '账期开始不能晚于结束' });
  const currency = input.currency ?? 'CNY';
  const tenantScope = exactTenantCondition(paymentJournals.tenantId, tenantId);
  const [earliest] = await db
    .select({ postedAt: sql<Date>`min(${paymentJournals.postedAt})` })
    .from(paymentJournalLines)
    .innerJoin(paymentJournals, eq(paymentJournals.id, paymentJournalLines.journalId))
    .innerJoin(paymentLedgerAccounts, eq(paymentLedgerAccounts.id, paymentJournalLines.accountId))
    .leftJoin(paymentSettlementItems, eq(paymentSettlementItems.journalLineId, paymentJournalLines.id))
    .where(and(
      ...unsettledEligibleLineConditions(),
      eq(paymentJournals.appId, input.applicationId),
      eq(paymentJournals.channelConfigId, input.channelConfigId),
      eq(paymentJournals.currency, currency),
      tenantScope,
      lte(paymentJournals.postedAt, end),
    ));
  if (earliest?.postedAt && start && earliest.postedAt < start) {
    throw new HTTPException(400, { message: `账期不能跳过更早的未结算资金，请从 ${formatDate(earliest.postedAt)} 开始` });
  }
  const lines = await db
    .select({
      lineId: paymentJournalLines.id,
      debitAmount: paymentJournalLines.debitAmount,
      creditAmount: paymentJournalLines.creditAmount,
      sourceType: paymentJournals.sourceType,
      sourceId: paymentJournals.sourceId,
    })
    .from(paymentJournalLines)
    .innerJoin(paymentJournals, eq(paymentJournals.id, paymentJournalLines.journalId))
    .innerJoin(paymentLedgerAccounts, eq(paymentLedgerAccounts.id, paymentJournalLines.accountId))
    .leftJoin(paymentSettlementItems, eq(paymentSettlementItems.journalLineId, paymentJournalLines.id))
    .where(and(
      ...unsettledEligibleLineConditions(),
      eq(paymentJournals.appId, input.applicationId),
      eq(paymentJournals.channelConfigId, input.channelConfigId),
      eq(paymentJournals.currency, currency),
      tenantScope,
      between(paymentJournals.postedAt, start, end),
    ));
  if (lines.length === 0) throw new HTTPException(400, { message: '该账期没有未结算的可用资金分录' });
  const signedAmounts = lines.map((line) => line.creditAmount - line.debitAmount);
  const netBigInt = signedAmounts.reduce((sum, amount) => sum + amount, 0n);
  if (netBigInt <= 0n) throw new HTTPException(400, { message: '该账期可结算净额不大于 0，请先处理资金差异' });
  const netAmount = Number(netBigInt);
  if (!Number.isSafeInteger(netAmount) || netAmount > 2_147_483_647) {
    throw new HTTPException(400, { message: '结算净额超出当前批次金额上限，请缩小账期' });
  }
  const sumBy = (predicate: (line: typeof lines[number]) => bigint): number => {
    const value = lines.reduce((sum, line) => sum + predicate(line), 0n);
    const numberValue = Number(value);
    if (!Number.isSafeInteger(numberValue) || numberValue > 2_147_483_647 || numberValue < -2_147_483_648) {
      throw new HTTPException(400, { message: '结算汇总超出当前批次金额上限' });
    }
    return numberValue;
  };
  const grossAmount = sumBy((line) => line.sourceType === 'payment.capture' || line.sourceType === 'payment.preauth.capture' ? line.creditAmount - line.debitAmount : 0n);
  const feeAmount = sumBy((line) => line.sourceType === 'payment.fee' ? line.debitAmount - line.creditAmount : line.sourceType === 'payment.fee_refund' ? line.creditAmount - line.debitAmount : 0n);
  const refundAmount = sumBy((line) => line.sourceType === 'payment.refund' ? line.debitAmount - line.creditAmount : 0n);
  const sharingAmount = sumBy((line) => line.sourceType === 'payment.sharing' ? line.debitAmount - line.creditAmount : line.sourceType === 'payment.sharing_reversal' ? line.creditAmount - line.debitAmount : 0n);
  const orderCount = new Set(lines.filter((line) => line.sourceType === 'payment.capture' || line.sourceType === 'payment.preauth.capture').map((line) => line.sourceId)).size;
  try {
    const row = await db.transaction(async (tx) => {
      const [batch] = await tx.insert(paymentSettlementBatches).values({
        batchNo: genPaymentNo('SETTLE'),
        channel: scope.channel,
        appId: input.applicationId,
        channelConfigId: input.channelConfigId,
        currency,
        periodStart: input.periodStart,
        periodEnd: input.periodEnd,
        status: 'pending',
        orderCount,
        grossAmount,
        feeAmount,
        refundAmount,
        sharingAmount,
        netAmount,
        remark: input.remark ?? null,
        tenantId,
      }).returning();
      await tx.insert(paymentSettlementItems).values(lines.map((line, index) => ({
        batchId: batch.id,
        journalLineId: line.lineId,
        amount: signedAmounts[index],
        appId: input.applicationId,
        channelConfigId: input.channelConfigId,
        currency,
        tenantId,
      })));
      return batch;
    });
    return mapSettlementBatch(row);
  } catch (err) {
    rethrowPgUniqueViolation(err, '结算批次与其他账期包含重复资金分录，请刷新后重试');
  }
}

/** T+1 定时结算：认领截至昨日的全部未结算分录，负净额自动结转到后续账期。 */
export async function generateDailySettlements(): Promise<{ generated: number; skipped: number }> {
  const billDate = formatDate(new Date(Date.now() - 24 * 60 * 60 * 1000));
  const end = parseDateRangeEnd(billDate);
  if (!end) return { generated: 0, skipped: 0 };

  const scopes = await db
    .select({
      applicationId: paymentJournals.appId,
      channelConfigId: paymentJournals.channelConfigId,
      currency: paymentJournals.currency,
      tenantId: paymentJournals.tenantId,
      firstPostedAt: sql<Date>`min(${paymentJournals.postedAt})`,
    })
    .from(paymentJournalLines)
    .innerJoin(paymentJournals, eq(paymentJournals.id, paymentJournalLines.journalId))
    .innerJoin(paymentLedgerAccounts, eq(paymentLedgerAccounts.id, paymentJournalLines.accountId))
    .leftJoin(paymentSettlementItems, eq(paymentSettlementItems.journalLineId, paymentJournalLines.id))
    .where(and(
      ...unsettledEligibleLineConditions(),
      lte(paymentJournals.postedAt, end),
    ))
    .groupBy(
      paymentJournals.appId,
      paymentJournals.channelConfigId,
      paymentJournals.currency,
      paymentJournals.tenantId,
    );

  let generated = 0;
  let skipped = 0;
  for (const { applicationId, channelConfigId, currency, tenantId, firstPostedAt } of scopes) {
    try {
      await generateSettlement({
        applicationId,
        channelConfigId,
        currency,
        periodStart: formatDate(firstPostedAt),
        periodEnd: billDate,
        remark: 'T+1 自动结算',
      }, tenantId ?? null);
      generated++;
    } catch (err) {
      if (err instanceof HTTPException && err.status === 400) {
        skipped++; // 当前账期没有可认领分录或配置不满足生成条件
        continue;
      }
      if (isPgUniqueViolation(err)) {
        skipped++;
        continue;
      }
      logger.error('[payment-settlement] auto generate failed', { applicationId, channelConfigId, tenantId, billDate, err });
    }
  }
  return { generated, skipped };
}

const ALLOWED_TRANSITIONS: Record<PaymentSettlementStatus, PaymentSettlementStatus[]> = {
  pending: ['settling'],
  settling: ['settled', 'failed'],
  settled: [],
  failed: [],
};

/** 状态机流转与双分录同事务提交，避免结算状态和资金凭证分离。 */
export async function transitionSettlement(
  id: number,
  input: { status: PaymentSettlementStatus; failureReason?: string; payoutReference?: string },
): Promise<PaymentSettlementBatch> {
  const user = currentUser();
  const tenantId = requireTenantScopeId(user);
  const batch = await ensureWritableBatch(id, tenantId);
  const target = input.status;
  if (!ALLOWED_TRANSITIONS[batch.status].includes(target)) {
    throw new HTTPException(400, { message: `不允许从「${batch.status}」流转到「${target}」` });
  }
  if (target === 'failed' && !input.failureReason?.trim()) {
    throw new HTTPException(400, { message: '标记结算失败时必须填写失败原因' });
  }
  if (target === 'settled' && !input.payoutReference?.trim()) {
    throw new HTTPException(400, { message: '确认结算到账时必须填写出款或到账参考号' });
  }
  const operatorId = user.userId;
  const row = await db.transaction(async (tx) => {
    const [maybeUpdated] = await tx
      .update(paymentSettlementBatches)
      .set({
        status: target,
        settledAt: target === 'settled' ? new Date() : batch.settledAt,
        failureReason: target === 'failed' ? input.failureReason!.trim() : null,
        payoutReference: target === 'settled' ? input.payoutReference!.trim() : batch.payoutReference,
        version: sql`${paymentSettlementBatches.version} + 1`,
      })
      .where(and(
        eq(paymentSettlementBatches.id, id),
        exactTenantCondition(paymentSettlementBatches.tenantId, tenantId),
        eq(paymentSettlementBatches.status, batch.status),
        eq(paymentSettlementBatches.version, batch.version),
      ))
      .returning();
    const updated = requireRow(maybeUpdated, '结算批次状态已变化，请刷新后重试', 409);

    const baseJournal = {
      tenantId: updated.tenantId ?? null,
      operatorId,
      sourceId: updated.batchNo,
      appId: updated.appId,
      channelConfigId: updated.channelConfigId,
      currency: updated.currency,
    };
    if (batch.status === 'pending' && target === 'settling') {
      await postSystemJournalWithin(tx, {
        ...baseJournal,
        sourceType: 'settlement.initiated',
        description: `结算批次 ${updated.batchNo} 开始出款`,
        lines: [
          { accountCode: 'merchant_available', debitAmount: String(updated.netAmount), memo: '结算锁定商户可用余额' },
          { accountCode: 'payout_payable', creditAmount: String(updated.netAmount), memo: '形成结算出款应付' },
        ],
      });
    } else if (batch.status === 'settling' && target === 'settled') {
      await postSystemJournalWithin(tx, {
        ...baseJournal,
        sourceType: 'settlement.paid',
        description: `结算批次 ${updated.batchNo} 出款完成（${input.payoutReference!.trim()}）`,
        lines: [
          { accountCode: 'payout_payable', debitAmount: String(updated.netAmount), memo: '结算出款应付清偿' },
          { accountCode: 'provider_clearing', creditAmount: String(updated.netAmount), memo: '渠道清算资金减少' },
        ],
      });
    } else if (batch.status === 'settling' && target === 'failed') {
      await postSystemJournalWithin(tx, {
        ...baseJournal,
        sourceType: 'settlement.failed',
        description: `结算批次 ${updated.batchNo} 出款失败：${input.failureReason!.trim()}`,
        lines: [
          { accountCode: 'payout_payable', debitAmount: String(updated.netAmount), memo: '释放结算出款应付' },
          { accountCode: 'merchant_available', creditAmount: String(updated.netAmount), memo: '恢复商户可用余额' },
        ],
      });
      // 失败批次保留批次审计记录，但释放逐笔认领，使后续结算可重新生成。
      await tx.delete(paymentSettlementItems).where(eq(paymentSettlementItems.batchId, updated.id));
    }
    return updated;
  });
  return mapSettlementBatch(row);
}

export async function deleteSettlement(id: number): Promise<void> {
  const tenantId = requireTenantScopeId(currentUser());
  const batch = await ensureWritableBatch(id, tenantId);
  if (batch.status !== 'pending') throw new HTTPException(400, { message: '只有未开始的结算批次可以删除；处理中及终态批次必须保留审计记录' });
  await db.transaction(async (tx) => {
    await tx.delete(paymentSettlementItems).where(eq(paymentSettlementItems.batchId, id));
    const [maybeDeleted] = await tx
      .delete(paymentSettlementBatches)
      .where(and(
        eq(paymentSettlementBatches.id, id),
        exactTenantCondition(paymentSettlementBatches.tenantId, tenantId),
        eq(paymentSettlementBatches.status, 'pending'),
        eq(paymentSettlementBatches.version, batch.version),
      ))
      .returning({ id: paymentSettlementBatches.id });
    requireRow(maybeDeleted, '结算批次状态已变化，请刷新后重试', 409);
  });
}
