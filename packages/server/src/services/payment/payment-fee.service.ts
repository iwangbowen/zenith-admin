/**
 * 支付手续费/费率 Service。
 * 维护费率规则（按渠道/支付方式匹配，万分比 + 固定费，clamp 上下限），
 * 监听 payment.succeeded 计算手续费：回写订单 feeAmount/netAmount 并记资金台账（type=fee）。
 */
import { and, desc, eq, isNull, ne, or, sql } from 'drizzle-orm';
import { HTTPException } from 'hono/http-exception';
import { db } from '../../db';
import type { DbTransaction } from '../../db/types';
import { paymentFeeRules, paymentJournalLines, paymentJournals, paymentLedgerAccounts, paymentOrders, paymentRefunds, type PaymentFeeRuleRow } from '../../db/schema';
import { currentUser } from '../../lib/context';
import { requireTenantScopeId, tenantCondition, exactTenantCondition } from '../../lib/tenant';
import { postSystemJournalWithin } from './payment-journal.service';
import { paymentEventBus } from '../../lib/payment-event-bus';
import logger from '../../lib/logger';
import { PAYMENT_METHOD_CHANNEL, paymentFeeRuleContract, paymentFeeRuleSchema } from '@zenith/shared/payment';
import type { PaymentChannel, PaymentMethod } from '@zenith/shared/payment';
import { defineCrudService } from '../../lib/crud-service';
import { entityMapper } from '../../lib/entity-map';

export const mapFeeRule = entityMapper(paymentFeeRuleSchema);

function assertFeeBounds(min?: number | null, max?: number | null): void {
  if (min != null && max != null && min > max) {
    throw new HTTPException(400, { message: '最低手续费不能大于最高手续费' });
  }
}

function assertFeeMethodChannel(channel: PaymentChannel, payMethod?: PaymentMethod | null): void {
  if (payMethod && PAYMENT_METHOD_CHANNEL[payMethod] !== channel) {
    throw new HTTPException(400, { message: '支付方式与渠道不匹配，无法创建不会命中的费率规则' });
  }
}

export const paymentFeeRuleService = defineCrudService(paymentFeeRuleContract, {
  table: paymentFeeRules,
  map: mapFeeRule,
  notFound: '费率规则不存在',
  scope: () => tenantCondition(paymentFeeRules, currentUser()),
  list: (q) => ({
    where: [
      q.channel ? eq(paymentFeeRules.channel, q.channel) : undefined,
      q.status ? eq(paymentFeeRules.status, q.status) : undefined,
    ],
    orderBy: [desc(paymentFeeRules.priority), desc(paymentFeeRules.id)],
  }),
  create: {
    before: (input) => {
      requireTenantScopeId(currentUser());
      assertFeeBounds(input.minFee, input.maxFee);
      assertFeeMethodChannel(input.channel, input.payMethod);
    },
    toRow: (input) => ({
      name: input.name,
      channel: input.channel,
      payMethod: input.payMethod ?? null,
      rateBps: input.rateBps ?? 0,
      fixedFee: input.fixedFee ?? 0,
      minFee: input.minFee ?? null,
      maxFee: input.maxFee ?? null,
      status: input.status ?? 'enabled',
      priority: input.priority ?? 0,
      remark: input.remark ?? null,
      tenantId: requireTenantScopeId(currentUser()),
    }),
  },
  update: {
    before: (input, existing) => {
      requireTenantScopeId(currentUser());
      const min = input.minFee !== undefined ? input.minFee : existing.minFee;
      const max = input.maxFee !== undefined ? input.maxFee : existing.maxFee;
      assertFeeBounds(min, max);
      assertFeeMethodChannel(input.channel ?? existing.channel, input.payMethod !== undefined ? input.payMethod : existing.payMethod);
    },
    toRow: (input) => ({
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.channel !== undefined ? { channel: input.channel } : {}),
      ...(input.payMethod !== undefined ? { payMethod: input.payMethod ?? null } : {}),
      ...(input.rateBps !== undefined ? { rateBps: input.rateBps } : {}),
      ...(input.fixedFee !== undefined ? { fixedFee: input.fixedFee } : {}),
      ...(input.minFee !== undefined ? { minFee: input.minFee ?? null } : {}),
      ...(input.maxFee !== undefined ? { maxFee: input.maxFee ?? null } : {}),
      ...(input.status !== undefined ? { status: input.status } : {}),
      ...(input.priority !== undefined ? { priority: input.priority } : {}),
      ...(input.remark !== undefined ? { remark: input.remark ?? null } : {}),
    }),
  },
  remove: {
    before: () => {
      requireTenantScopeId(currentUser());
    },
  },
});

export const {
  list: listFeeRules,
  ensure: ensureFeeRule,
  get: getFeeRule,
  create: createFeeRule,
  update: updateFeeRule,
  remove: deleteFeeRule,
} = paymentFeeRuleService;

/** 计算手续费（分）：rate*amount/10000 + fixed，clamp[min,max]。无匹配规则返回 0。 */
export function computeFeeByRule(rule: PaymentFeeRuleRow, amount: number): number {
  let fee = Math.round((amount * rule.rateBps) / 10000) + rule.fixedFee;
  if (rule.minFee != null) fee = Math.max(fee, rule.minFee);
  if (rule.maxFee != null) fee = Math.min(fee, rule.maxFee);
  return Math.max(0, Math.min(fee, amount));
}

/** 匹配最优费率规则（按 tenant + channel + payMethod，优先 payMethod 精确，再按 priority 降序）。 */
export async function matchFeeRule(channel: PaymentChannel, payMethod: PaymentMethod, tenantId: number | null, executor: Pick<DbTransaction, 'select'> = db): Promise<PaymentFeeRuleRow | null> {
  const tenantCond = exactTenantCondition(paymentFeeRules.tenantId, tenantId);
  const rows = await executor
    .select()
    .from(paymentFeeRules)
    .where(and(eq(paymentFeeRules.status, 'enabled'), eq(paymentFeeRules.channel, channel), or(isNull(paymentFeeRules.payMethod), eq(paymentFeeRules.payMethod, payMethod)), tenantCond))
    .orderBy(desc(paymentFeeRules.priority), desc(paymentFeeRules.id));
  if (rows.length === 0) return null;
  const exact = rows.find((r) => r.payMethod === payMethod);
  return exact ?? rows[0];
}

/** 支付成功后结算手续费：回写订单 feeAmount/netAmount + 记双分录。
 * 幂等与并发安全：feeAmount 回写用条件 UPDATE（仅未计费订单命中）充当 claim，
 * Journal 以 orderNo 作为来源键，事件重复投递/并发双投均不会重复记账。 */
export async function settleOrderFee(orderNo: string): Promise<void> {
  return db.transaction((tx) => settleOrderFeeWithin(tx, orderNo));
}

export async function settleOrderFeeWithin(tx: DbTransaction, orderNo: string): Promise<void> {
  const [order] = await tx.select().from(paymentOrders).where(eq(paymentOrders.orderNo, orderNo)).limit(1);
  if (!order) return;
  const amount = order.paidAmount ?? order.amount;
  let fee = order.feeAmount;

  if (fee == null) {
    const rule = await matchFeeRule(order.channel, order.payMethod, order.tenantId, tx);
    fee = rule ? computeFeeByRule(rule, amount) : 0;
    const claimed = await tx
      .update(paymentOrders)
      .set({ feeAmount: fee, netAmount: amount - fee })
      .where(and(eq(paymentOrders.id, order.id), isNull(paymentOrders.feeAmount)))
      .returning({ feeAmount: paymentOrders.feeAmount });
    if (claimed.length === 0) {
      // 竞争失败：另一次投递已计费，读回真实费用仅做台账补偿（崩溃恢复场景）
      const [fresh] = await tx.select({ feeAmount: paymentOrders.feeAmount }).from(paymentOrders).where(eq(paymentOrders.id, order.id)).limit(1);
      fee = fresh?.feeAmount ?? fee;
    }
  } else if (order.netAmount == null) {
    await tx
      .update(paymentOrders)
      .set({ netAmount: amount - fee })
      .where(and(eq(paymentOrders.id, order.id), isNull(paymentOrders.netAmount)));
  }

  if (fee != null && fee > 0) {
    const amountString = fee.toString();
    const description = '支付手续费';
    await postSystemJournalWithin(tx, {
      tenantId: order.tenantId ?? null,
      operatorId: null,
      sourceType: 'payment.fee',
      sourceId: order.orderNo,
      description: `${description} ${order.orderNo}`,
      appId: order.appId,
      channelConfigId: order.channelConfigId,
      currency: order.currency,
      lines: [
        { accountCode: 'merchant_available', debitAmount: amountString, memo: '扣减商户可用余额' },
        { accountCode: 'platform_fee', creditAmount: amountString, memo: description },
      ],
    });
  }
}

let registered = false;
/** 注册手续费订阅者（支付成功结算手续费，退款成功按比例冲销）。 */
export function registerFeeSubscribers(): void {
  if (registered) return;
  registered = true;
  paymentEventBus.on('payment.succeeded', (e) => {
    return settleOrderFee(e.orderNo).catch((err) => {
      logger.error('[payment-fee] settle fee failed', { orderNo: e.orderNo, err });
      throw err;
    });
  });
  paymentEventBus.on('refund.succeeded', (e) => {
    return reverseFeeOnRefund({ orderNo: e.orderNo, refundNo: e.refundNo, refundAmount: e.refundAmount }).catch((err) => {
      logger.error('[payment-fee] reverse fee failed', { orderNo: e.orderNo, refundNo: e.refundNo, err });
      throw err;
    });
  });
  logger.info('Payment fee subscribers registered');
}

/**
 * 退款成功后按退款比例冲销手续费（对齐渠道真实行为：退款时按比例返还手续费）。
 *
 * - 冲销额 = round(订单手续费 × 本次退款额 / 实付额)；
 * - 末笔补差：累计成功退款打满实付额时，冲销额 = 手续费 − 已冲销，消除多笔部分退款的舍入残差；
 * - 幂等：Journal 按 refundNo + sourceType='payment.fee_refund' 去重；
 * - 订单 feeAmount 保持下单时快照不变，资金事实以双分录凭证为准。
 */
export async function reverseFeeOnRefund(e: { orderNo: string; refundNo?: string; refundAmount?: number }): Promise<void> {
  return db.transaction((tx) => reverseFeeOnRefundWithin(tx, e));
}

export async function reverseFeeOnRefundWithin(tx: DbTransaction, e: { orderNo: string; refundNo?: string; refundAmount?: number }): Promise<void> {
  if (!e.refundNo || typeof e.refundAmount !== 'number' || !Number.isSafeInteger(e.refundAmount) || e.refundAmount <= 0) throw new Error('Fee reversal requires a refund identity and positive amount');
  const refundNo = e.refundNo;
  const refundAmount = e.refundAmount;
  await tx.execute(sql`SELECT id FROM payment_orders WHERE order_no = ${e.orderNo} FOR UPDATE`);
  const [order] = await tx.select().from(paymentOrders).where(eq(paymentOrders.orderNo, e.orderNo)).limit(1);
  if (!order || order.feeAmount == null || order.feeAmount <= 0) return;
  const paidAmount = order.paidAmount ?? order.amount;
  if (paidAmount <= 0) return;

  const [existing] = await tx.select({ id: paymentJournals.id }).from(paymentJournals).where(and(
    eq(paymentJournals.sourceType, 'payment.fee_refund'), eq(paymentJournals.sourceId, refundNo),
    eq(paymentJournals.appId, order.appId), eq(paymentJournals.channelConfigId, order.channelConfigId),
    eq(paymentJournals.currency, order.currency), exactTenantCondition(paymentJournals.tenantId, order.tenantId),
  )).limit(1);
  if (existing) return;

  const [refundedRow] = await tx
    .select({ total: sql<number>`coalesce(sum(${paymentRefunds.refundAmount}),0)` })
    .from(paymentRefunds)
    .innerJoin(paymentJournals, and(eq(paymentJournals.sourceId, paymentRefunds.refundNo), eq(paymentJournals.sourceType, 'payment.refund')))
    .where(and(eq(paymentRefunds.orderId, order.id), ne(paymentRefunds.refundNo, refundNo),
      eq(paymentJournals.appId, order.appId), eq(paymentJournals.channelConfigId, order.channelConfigId),
      eq(paymentJournals.currency, order.currency), exactTenantCondition(paymentJournals.tenantId, order.tenantId)));
  const [reversedRow] = await tx
    .select({ total: sql<string>`coalesce(sum(${paymentJournalLines.debitAmount}), 0)::text` })
    .from(paymentJournals)
    .innerJoin(paymentJournalLines, eq(paymentJournalLines.journalId, paymentJournals.id))
    .innerJoin(paymentLedgerAccounts, eq(paymentLedgerAccounts.id, paymentJournalLines.accountId))
    .innerJoin(paymentRefunds, eq(paymentRefunds.refundNo, paymentJournals.sourceId))
    .where(and(
      eq(paymentRefunds.orderId, order.id),
      eq(paymentJournals.sourceType, 'payment.fee_refund'),
      eq(paymentJournals.appId, order.appId),
      eq(paymentJournals.channelConfigId, order.channelConfigId),
      eq(paymentJournals.currency, order.currency),
      eq(paymentLedgerAccounts.code, 'platform_fee'),
    ));
  // Later source refunds may already be successful before their events are
  // consumed. Tail rounding belongs to the last locally settled refund.
  const refundedTotal = Number(refundedRow?.total ?? 0) + refundAmount;
  const reversedTotal = Number(reversedRow?.total ?? 0);

  const fullyRefunded = refundedTotal >= paidAmount;
  let reverse = fullyRefunded
    ? order.feeAmount - reversedTotal
    : Math.round((order.feeAmount * refundAmount) / paidAmount);
  reverse = Math.min(reverse, order.feeAmount - reversedTotal);
  if (reverse <= 0) return;

  const description = fullyRefunded ? '退款手续费返还（全额退款）' : '退款手续费返还（按比例）';
  const amountString = reverse.toString();
  await postSystemJournalWithin(tx, {
    tenantId: order.tenantId ?? null,
    operatorId: null,
    sourceType: 'payment.fee_refund',
    sourceId: refundNo,
    description: `${description} ${refundNo}`,
    appId: order.appId,
    channelConfigId: order.channelConfigId,
    currency: order.currency,
    lines: [
      { accountCode: 'platform_fee', debitAmount: amountString, memo: '冲减平台手续费' },
      { accountCode: 'merchant_available', creditAmount: amountString, memo: '返还商户可用余额' },
    ],
  });
}
