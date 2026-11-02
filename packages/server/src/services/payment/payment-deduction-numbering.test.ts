import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DbTransaction } from '../../db/types';
import type { PaymentContractRow } from '../../db/schema';

const mocks = vi.hoisted(() => ({ select: vi.fn(), update: vi.fn(), transaction: vi.fn(), plan: vi.fn(), allocate: vi.fn(), attach: vi.fn(), deduct: vi.fn(), sync: vi.fn() }));
vi.mock('../../db', () => ({ db: { select: mocks.select, update: mocks.update, transaction: mocks.transaction, query: { paymentDeductPlans: { findFirst: mocks.plan } } } }));
vi.mock('../../lib/context', () => ({ currentUser: () => ({ userId: 9, tenantId: 7 }), currentUserOrNull: () => ({ userId: 9, tenantId: 7 }) }));
vi.mock('../../lib/payment', () => ({ getAdapter: () => ({ deductContract: mocks.deduct }) }));
vi.mock('./payment-capability-evaluator', () => ({ assertEffectivePaymentOperation: vi.fn() }));
vi.mock('./payment-apps.service', () => ({ resolveApplicationChannelConfig: async () => ({ appId: 2, channelConfigId: 3 }) }));
vi.mock('./payment-outbox.service', () => ({ recordEvent: async () => null }));
vi.mock('./payment.service', () => ({ buildAdapterContext: () => ({}), markOrderPaid: vi.fn(), syncOrderStatus: mocks.sync }));
vi.mock('../platform/numbering-runtime', () => ({ allocateBusinessNumber: mocks.allocate, attachBusinessNumber: mocks.attach }));

import { paymentChannelConfigs, paymentContracts, paymentOrders } from '../../db/schema';
import { executeDeduction } from './payment-contract.service';

function fixture() {
  let contract: Record<string, unknown> = { id: 4, contractNo: 'CUSTOMCONTRACT', appId: 2, currency: 'CNY', channel: 'wechat', channelConfigId: 3,
    channelContractNo: 'provider-contract-4', bizType: 'subscription', bizId: 'subscription:6', planId: 5,
    status: 'signed', version: 1, tenantId: 7, totalDeductCount: 6, failCount: 0 };
  let order: Record<string, unknown> | undefined;
  let insertFailure = false;
  let inserts = 0;
  let inTransaction = false;
  const stages: string[] = [];
  const read = (table: unknown) => table === paymentContracts ? [contract] : table === paymentOrders ? (order ? [order] : [])
    : table === paymentChannelConfigs ? [{ id: 3, tenantId: 7, channel: 'wechat', channelAccountId: 8, credentialVersion: 1 }] : [];
  const select = () => ({ from: (table: unknown) => {
    const query = { where: (_where: unknown) => query, limit: (_limit: number) => query, for: (mode: string) => { expect(mode).toBe('update'); stages.push('lock'); return query; },
      then: (resolve: (value: unknown[]) => unknown) => Promise.resolve(read(table)).then(resolve) };
    return query;
  } });
  const update = (table: unknown) => ({ set: (patch: Record<string, unknown>) => ({ where: () => {
    const write = () => {
      if (table === paymentContracts) { contract = { ...contract, ...patch, version: Number(contract.version) + 1 }; return [contract]; }
      order = { ...order, ...patch, version: Number(order?.version ?? 0) + 1 }; return [order];
    };
    return { returning: async () => write(), then: (resolve: (value: unknown[]) => unknown) => Promise.resolve(write()).then(resolve) };
  } }) });
  mocks.select.mockImplementation(select); mocks.update.mockImplementation(update);
  mocks.plan.mockResolvedValue({ id: 5, name: 'Subscription', amount: 1000, period: 'monthly', maxRetries: 10, tenantId: 7 });
  mocks.sync.mockImplementation(async () => order);
  const tx = { select, update, insert: () => ({ values: (values: Record<string, unknown>) => ({ returning: async () => {
    if (insertFailure) throw new Error('order insert failed');
    order = { id: 12, version: 1, ...values }; inserts += 1; stages.push('insert'); return [order];
  } }) }) } as unknown as DbTransaction;
  let queue = Promise.resolve();
  mocks.transaction.mockImplementation(async (work: (executor: DbTransaction) => Promise<unknown>) => {
    const previousTransaction = queue;
    let release!: () => void;
    queue = new Promise(resolve => { release = resolve; });
    await previousTransaction;
    const previous = { contract: { ...contract }, order: order ? { ...order } : undefined };
    inTransaction = true;
    try { const result = await work(tx); stages.push('commit'); return result; }
    catch (error) { contract = previous.contract; order = previous.order; stages.push('rollback'); throw error; }
    finally { inTransaction = false; release(); }
  });
  mocks.allocate.mockImplementation(async (executor: DbTransaction) => { expect(executor).toBe(tx); expect(inTransaction).toBe(true); stages.push('allocate'); return 'CUSTOMDEDUCT0001'; });
  mocks.attach.mockImplementation(async (executor: DbTransaction) => { expect(executor).toBe(tx); stages.push('attach'); });
  mocks.deduct.mockImplementation(async () => { expect(inTransaction).toBe(false); stages.push('provider'); return { status: 'failed', failReason: 'declined' }; });
  return { tx, stages, input: () => contract as unknown as PaymentContractRow, order: () => order, inserts: () => inserts, failInsert: () => { insertFailure = true; } };
}

beforeEach(() => vi.clearAllMocks());

describe('deduction numbering and period idempotency', () => {
  it('uses contract identity and period instead of interpreting a configured order number', async () => {
    const f = fixture();
    const result = await executeDeduction(f.input());
    expect(result).toMatchObject({ orderNo: 'CUSTOMDEDUCT0001', deductStatus: 'failed' });
    expect(mocks.allocate).toHaveBeenCalledWith(f.tx, { scene: 'payment.deduction', tenantId: 7, allocationKey: 'contract:4:period:7', context: { amount: 1000, currency: 'CNY', appId: 2 } });
    expect(mocks.attach).toHaveBeenCalledWith(f.tx, { scene: 'payment.deduction', tenantId: 7, number: 'CUSTOMDEDUCT0001', businessKey: '12' });
    expect(f.stages.indexOf('commit')).toBeLessThan(f.stages.indexOf('provider'));
  });

  it('retries a failed period with the same business order and channel number', async () => {
    const f = fixture();
    await executeDeduction(f.input());
    await executeDeduction(f.input());
    expect(f.inserts()).toBe(1);
    expect(mocks.attach).toHaveBeenCalledTimes(1);
    expect(mocks.allocate.mock.calls.every(([, input]) => input.allocationKey === 'contract:4:period:7')).toBe(true);
    expect(mocks.deduct.mock.calls.every(([, input]) => input.outTradeNo === 'CUSTOMDEDUCT0001')).toBe(true);
  });

  it('reconciles unknown outcomes instead of charging the period again', async () => {
    const f = fixture(); mocks.deduct.mockRejectedValue(new Error('timeout'));
    await executeDeduction(f.input());
    const result = await executeDeduction(f.input());
    expect(result.deductStatus).toBe('processing');
    expect(mocks.deduct).toHaveBeenCalledTimes(1);
    expect(mocks.sync).toHaveBeenCalledTimes(1);
    expect(f.inserts()).toBe(1);
  });

  it('allows only one provider call when two workers race the same period', async () => {
    const f = fixture();
    mocks.deduct.mockResolvedValue({ status: 'processing' });
    const input = f.input();
    await Promise.all([executeDeduction(input), executeDeduction(input)]);
    expect(f.inserts()).toBe(1);
    expect(mocks.deduct).toHaveBeenCalledTimes(1);
    expect(mocks.sync).toHaveBeenCalledTimes(1);
  });

  it('avoids the channel and keeps contract linkage unchanged if the order cannot be inserted', async () => {
    const f = fixture(); f.failInsert();
    await expect(executeDeduction(f.input())).rejects.toThrow('order insert failed');
    expect(f.order()).toBeUndefined();
    expect(f.input().lastOrderNo).toBeUndefined();
    expect(mocks.deduct).not.toHaveBeenCalled();
  });
});
