import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DbTransaction } from '../../db/types';
import type { PaymentEvent } from '../../lib/payment-event-bus';

const effects = vi.hoisted(() => {
  const order: string[] = [];
  const effect = (key: string) => vi.fn(async () => { order.push(key); });
  return { order, cashier: effect('cashier'), wallet: effect('wallet'), walletRefund: effect('walletRefund'),
    vip: effect('vip'), contract: effect('contract'), coupon: effect('coupon'), demo: effect('demo'),
    dispute: effect('dispute'), disputeFailure: effect('disputeFailure'), journal: effect('journal'),
    fee: effect('fee'), feeRefund: effect('feeRefund') };
});
vi.mock('../member/member-wallet.service', () => ({ WALLET_RECHARGE_BIZ_TYPE: 'member_recharge', creditWalletOnRechargeWithin: effects.wallet, reverseWalletRechargeOnRefundWithin: effects.walletRefund }));
vi.mock('../member/member-renewal.service', () => ({ extendVipOnRenewalWithin: effects.vip }));
vi.mock('./payment-cashier-session.service', () => ({ updateCashierSessionFromPaymentEventWithin: effects.cashier }));
vi.mock('./payment-contract.service', () => ({ advanceContractOnPaidWithin: effects.contract }));
vi.mock('./payment-coupon.service', () => ({ settlePaymentCouponWithin: effects.coupon }));
vi.mock('./payment-dispute.service', () => ({ completeDisputeRefundWithin: effects.dispute, recordDisputeRefundFailureWithin: effects.disputeFailure }));
vi.mock('./biz-pay-demo.service', () => ({ BIZ_PAY_DEMO_TYPE: 'biz_pay_demo', markBizPayDemoPaidWithin: effects.demo }));
vi.mock('./payment-journal-subscribers.service', () => ({ postPaymentEventJournalWithin: effects.journal }));
vi.mock('./payment-fee.service', () => ({ settleOrderFeeWithin: effects.fee, reverseFeeOnRefundWithin: effects.feeRefund }));
import { settlePaymentEventWithin } from './payment-local-settlement.service';

const paidAt = new Date('2026-10-29T01:00:00Z');
const fact: PaymentEvent = { eventId: 'c63aaec1-3b58-4f42-b00b-37fd6edd6716', type: 'payment.succeeded',
  occurredAt: '2026-10-29 09:00:00', orderNo: 'PO-FROZEN', outTradeNo: 'PO-FROZEN', bizType: 'member_recharge',
  bizId: '17', channel: 'wechat', channelConfigId: 3, appId: 9, currency: 'CNY', amount: 9000, originalAmount: 10000, tenantId: 7 };

function transaction(rows: unknown[][]): DbTransaction {
  const select = vi.fn(() => {
    const chain = { from: vi.fn(), where: vi.fn(), for: vi.fn(), limit: vi.fn() };
    chain.from.mockReturnValue(chain); chain.where.mockReturnValue(chain); chain.for.mockReturnValue(chain);
    chain.limit.mockResolvedValue(rows.shift() ?? []);
    return chain;
  });
  return { select } as unknown as DbTransaction;
}
function order(overrides = {}) { return { ...fact, id: 11, paidAt, status: 'refunded', paidAmount: 9000, amount: 10000, ...overrides }; }

beforeEach(() => { vi.clearAllMocks(); effects.order.length = 0; });

describe('payment local settlement transaction boundary', () => {
  it('uses one caller transaction for a delayed paid fact even after the source order was refunded', async () => {
    const tx = transaction([[order()]]);
    await settlePaymentEventWithin(tx, fact);
    expect(effects.wallet).toHaveBeenCalledWith(tx, fact);
    expect(effects.order).toEqual(['cashier', 'wallet', 'contract', 'coupon', 'journal', 'fee']);
    expect(effects.journal).toHaveBeenCalledWith(tx, fact);
    expect(effects.fee).toHaveBeenCalledWith(tx, fact.orderNo);
    expect(effects.vip).not.toHaveBeenCalled();
  });

  it('releases the refundable fee before posting the gross refund debit', async () => {
    const event: PaymentEvent = { ...fact, type: 'refund.succeeded', refundNo: 'RF-1', refundAmount: 9000 };
    const tx = transaction([[order()], [{ amount: 9000, status: 'success' }]]);
    await settlePaymentEventWithin(tx, event);
    expect(effects.order).toEqual(['dispute', 'walletRefund', 'feeRefund', 'journal']);
    expect(effects.feeRefund).toHaveBeenCalledWith(tx, event);
    expect(effects.walletRefund).toHaveBeenCalledWith(tx, event);
  });

  it('propagates an effect failure so the caller cannot confirm or commit partial settlement', async () => {
    const failure = new Error('journal unavailable');
    effects.journal.mockRejectedValueOnce(failure);
    await expect(settlePaymentEventWithin(transaction([[order()]]), fact)).rejects.toBe(failure);
    expect(effects.fee).not.toHaveBeenCalled();
  });

  it.each([
    { ...fact, tenantId: undefined }, { ...fact, appId: null }, { ...fact, amount: 0 }, { ...fact, amount: 1.25 },
  ])('rejects a missing scope or invalid amount before any effect', async (event) => {
    await expect(settlePaymentEventWithin(transaction([]), event)).rejects.toThrow('Payment settlement requires');
    expect(effects.order).toEqual([]);
  });

  it('rejects a mismatched source amount instead of reporting successful fulfillment', async () => {
    await expect(settlePaymentEventWithin(transaction([[order({ paidAmount: 8000 })]]), fact)).rejects.toThrow('does not match');
    expect(effects.order).toEqual([]);
  });

  it('requires a real paid timestamp before wallet or journal effects', async () => {
    await expect(settlePaymentEventWithin(transaction([[order({ paidAt: null })]]), fact)).rejects.toThrow('committed paid fact');
    expect(effects.order).toEqual([]);
  });

  it('rejects a mismatched refund before closing disputes or changing a wallet', async () => {
    const event: PaymentEvent = { ...fact, type: 'refund.succeeded', refundNo: 'RF-1', refundAmount: 9000 };
    await expect(settlePaymentEventWithin(transaction([[order()], [{ amount: 8000, status: 'success' }]]), event)).rejects.toThrow('source refund');
    expect(effects.order).toEqual([]);
  });
});
