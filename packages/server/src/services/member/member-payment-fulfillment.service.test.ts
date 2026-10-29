import { beforeEach, describe, expect, it, vi } from 'vitest';
import dayjs from 'dayjs';
import type { DbTransaction } from '../../db/types';

const globalDb = vi.hoisted(() => ({ select: vi.fn(), transaction: vi.fn() }));
vi.mock('../../db', () => ({ db: globalDb }));
vi.mock('../payment/payment.service', () => ({ createPayment: vi.fn() }));
vi.mock('./member-auth.service', () => ({ ensureMemberExists: vi.fn() }));
vi.mock('../payment/payment-contract.service', () => ({
  advanceVipExpiry: (base: Date) => dayjs(base).add(1, 'month').toDate(),
  executeDeduction: vi.fn(), findActiveContractByBiz: vi.fn(), mapContract: vi.fn(), signContract: vi.fn(), terminateContract: vi.fn(),
}));
import { creditWalletOnRechargeWithin, reverseWalletRechargeOnRefundWithin } from './member-wallet.service';
import { extendVipOnRenewalWithin } from './member-renewal.service';

function chain(rows: unknown[] = []) {
  const q: Record<string, unknown> = {};
  for (const method of ['from', 'innerJoin', 'where', 'for', 'limit', 'values', 'set', 'returning', 'onConflictDoNothing', 'orderBy']) {
    q[method] = vi.fn(() => q);
  }
  q.then = (resolve: (value: unknown[]) => unknown) => Promise.resolve(rows).then(resolve);
  return q;
}
function transaction(rows: unknown[][]) {
  const writes: Array<Record<string, unknown>> = [];
  const updates: Array<Record<string, unknown>> = [];
  const tx = {
    select: vi.fn(() => chain(rows.shift() ?? [])),
    insert: vi.fn(() => { const q = chain(); q.values = vi.fn((v: Record<string, unknown>) => { writes.push(v); return q; }); return q; }),
    update: vi.fn(() => { const q = chain([{ id: 1 }]); q.set = vi.fn((v: Record<string, unknown>) => { updates.push(v); return q; }); return q; }),
    execute: vi.fn(async () => []),
  };
  return { tx: tx as unknown as DbTransaction, writes, updates };
}
const paidAt = new Date('2026-10-29T01:00:00Z');
const recharge = { eventId: 'paid-fact', bizId: '17', orderNo: 'PAID-1', amount: 9000, originalAmount: 10000, appId: 9, tenantId: 7 };
const wallet = { id: 1, memberId: 17, balance: 0, totalRecharge: 0, totalConsume: 0, version: 1 };
const paidOrder = { id: 11, userId: 17, amount: 10000, paidAmount: 9000, originalAmount: 10000, paidAt };

beforeEach(() => {
  vi.clearAllMocks();
  globalDb.select.mockImplementation(() => { throw new Error('global pool read inside transaction'); });
  globalDb.transaction.mockImplementation(() => { throw new Error('independent transaction'); });
});

describe('member fulfillment in the payment transaction', () => {
  it('credits the original recharge including subsidy and refunds only the paid amount', async () => {
    const { tx, writes, updates } = transaction([
      [paidOrder], [{ id: 17 }], [{ id: 1 }], [], [wallet],
      [{ id: 11 }], [{ userId: 17, bizType: 'member_recharge', refundAmount: 9000 }], [{ id: 17 }], [{ id: 1 }], [],
      [{ ...wallet, balance: 10000, totalRecharge: 10000, version: 2 }],
    ]);
    await creditWalletOnRechargeWithin(tx, recharge);
    await reverseWalletRechargeOnRefundWithin(tx, { ...recharge, eventId: 'refund-fact', refundNo: 'RF-1', refundAmount: 9000 });
    expect(updates.map((v) => v.balance)).toEqual([10000, 1000]);
    expect(writes.filter((v) => v.paymentEventId).map((v) => [v.paymentEventId, v.amount])).toEqual([['paid-fact', 10000], ['refund-fact', -9000]]);
    expect(globalDb.select).not.toHaveBeenCalled();
    expect(globalDb.transaction).not.toHaveBeenCalled();
  });

  it('does not re-credit an already recorded payment fact', async () => {
    const { tx, updates } = transaction([[paidOrder], [{ id: 17 }], [{ id: 1 }], [{ id: 99 }]]);
    await creditWalletOnRechargeWithin(tx, recharge);
    expect(updates).toEqual([]);
  });

  it('rejects a paid amount mismatch instead of acknowledging dropped fulfillment', async () => {
    const { tx, updates } = transaction([[{ ...paidOrder, paidAmount: 8500 }]]);
    await expect(creditWalletOnRechargeWithin(tx, recharge)).rejects.toThrow('does not match');
    expect(updates).toEqual([]);
  });

  it('rejects a mismatched member identity before creating a wallet', async () => {
    const { tx, writes } = transaction([[{ ...paidOrder, userId: 18 }]]);
    await expect(creditWalletOnRechargeWithin(tx, recharge)).rejects.toThrow('does not match');
    expect(writes).toEqual([]);
  });

  it('accepts a committed paid VIP order that has already reached refunded', async () => {
    const { tx, writes, updates } = transaction([
      [{ ...paidOrder, appId: 9, currency: 'CNY', tenantId: 7, status: 'refunded', bizType: 'member_renewal', bizId: '17' }],
      [], [{ vipExpireAt: null, status: 'active', deletedAt: null }], [],
    ]);
    await extendVipOnRenewalWithin(tx, { ...recharge, originalAmount: undefined });
    expect(writes).toEqual([expect.objectContaining({ memberId: 17, orderNo: 'PAID-1' })]);
    expect(updates).toEqual([expect.objectContaining({ vipExpireAt: expect.any(Date) })]);
    expect(globalDb.transaction).not.toHaveBeenCalled();
  });

  it('rejects VIP fulfillment from a different payment tenant', async () => {
    const { tx, writes } = transaction([[{ ...paidOrder, appId: 9, tenantId: 8, status: 'success', bizType: 'member_renewal', bizId: '17' }]]);
    await expect(extendVipOnRenewalWithin(tx, recharge)).rejects.toThrow('does not match');
    expect(writes).toEqual([]);
  });
});
