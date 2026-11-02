import { beforeEach, describe, expect, it, vi } from 'vitest';
import { HTTPException } from 'hono/http-exception';
import type { DbTransaction } from '../../db/types';

const mocks = vi.hoisted(() => ({ select: vi.fn(), update: vi.fn(), transaction: vi.fn(), allocate: vi.fn(), attach: vi.fn(), capture: vi.fn(), query: vi.fn() }));
vi.mock('../../db', () => ({ db: { select: mocks.select, update: mocks.update, transaction: mocks.transaction } }));
vi.mock('../../lib/context', () => ({ currentUser: () => ({ userId: 9, tenantId: 7 }), currentUserOrNull: () => ({ userId: 9, tenantId: 7 }) }));
vi.mock('../../lib/payment', () => ({ getAdapter: () => ({ preauthCapture: mocks.capture, queryPreauth: mocks.query }) }));
vi.mock('./payment-capability-evaluator', () => ({ assertEffectivePaymentOperation: vi.fn() }));
vi.mock('./payment-apps.service', () => ({ resolveApplicationChannelConfig: vi.fn() }));
vi.mock('./payment-journal.service', () => ({ postSystemJournalWithin: vi.fn() }));
vi.mock('./payment-outbox.service', () => ({ recordEvent: async () => null }));
vi.mock('./payment.service', () => ({ buildAdapterContext: () => ({}), markOrderPaid: vi.fn() }));
vi.mock('../platform/numbering-runtime', () => ({ allocateBusinessNumber: mocks.allocate, attachBusinessNumber: mocks.attach }));

import { paymentChannelConfigs, paymentOrders, paymentPreauths } from '../../db/schema';
import { capturePreauth } from './payment-preauth.service';

function chain(rows: () => unknown[]) {
  const query = { where: (_where: unknown) => query, limit: (_limit: number) => query, for: (_mode: string) => query,
    then: (resolve: (value: unknown[]) => unknown, reject?: (reason: unknown) => unknown) => Promise.resolve().then(rows).then(resolve, reject) };
  return query;
}

function fixture() {
  const stages: string[] = [];
  let preauth: Record<string, unknown> = { id: 4, preauthNo: 'CUSTOMPREAUTH', appId: 2, currency: 'CNY', channel: 'wechat', channelConfigId: 3,
    channelAccountId: 5, channelPreauthNo: 'provider-freeze-4', bizType: 'deposit', bizId: 'deposit:6', subject: 'Deposit',
    payerAccount: 'openid', frozenAmount: 1000, status: 'frozen', unknownOperation: null, version: 1, tenantId: 7, captureOrderNo: null };
  let order: Record<string, unknown> | undefined;
  let allocationAmount: number | undefined;
  let inTransaction = false;
  let insertFailure = false;
  let inserts = 0;
  const rows = (table: unknown) => table === paymentPreauths ? [preauth] : table === paymentOrders ? (order ? [order] : [])
    : table === paymentChannelConfigs ? [{ id: 3, channel: 'wechat', tenantId: 7, currency: 'CNY', credentialVersion: 1, channelAccountId: 5 }] : [];
  const update = (table: unknown) => ({ set: (patch: Record<string, unknown>) => ({ where: () => {
    const write = () => {
      if (table === paymentPreauths) { preauth = { ...preauth, ...patch, version: Number(preauth.version) + 1 }; stages.push('preauth'); return [preauth]; }
      order = { ...order, ...patch, version: Number(order?.version ?? 0) + 1 }; stages.push('order'); return [order];
    };
    return { returning: async () => write(), then: (resolve: (value: unknown[]) => unknown) => Promise.resolve(write()).then(resolve) };
  } }) });
  mocks.select.mockImplementation(() => ({ from: (table: unknown) => chain(() => rows(table)) }));
  mocks.update.mockImplementation(update);
  const tx = {
    select: mocks.select, update,
    insert: () => ({ values: (values: Record<string, unknown>) => ({ returning: async () => {
      if (insertFailure) throw new Error('insert failed');
      order = { id: 12, version: 1, ...values }; inserts += 1; stages.push('insert'); return [order];
    } }) }),
  } as unknown as DbTransaction;
  mocks.transaction.mockImplementation(async (work: (executor: DbTransaction) => Promise<unknown>) => {
    const previous = { preauth: { ...preauth }, order: order ? { ...order } : undefined, allocationAmount };
    inTransaction = true;
    try { const result = await work(tx); stages.push('commit'); return result; }
    catch (error) { preauth = previous.preauth; order = previous.order; allocationAmount = previous.allocationAmount; stages.push('rollback'); throw error; }
    finally { inTransaction = false; }
  });
  mocks.allocate.mockImplementation(async (executor: DbTransaction, input: { context: { amount: number } }) => {
    expect(executor).toBe(tx); expect(inTransaction).toBe(true); stages.push('allocate');
    if (allocationAmount !== undefined && allocationAmount !== input.context.amount) throw new HTTPException(409, { message: '同一编号分配请求的业务参数发生变化' });
    allocationAmount = input.context.amount;
    return 'CUSTOMCAPTURE202610110001';
  });
  mocks.attach.mockImplementation(async (executor: DbTransaction) => { expect(executor).toBe(tx); stages.push('attach'); });
  mocks.capture.mockImplementation(async () => { expect(inTransaction).toBe(false); stages.push('provider'); return { status: 'failed', failReason: 'declined' }; });
  mocks.query.mockResolvedValue({ status: 'pending' });
  return { tx, stages, order: () => order, preauth: () => preauth, inserts: () => inserts, failInsert: () => { insertFailure = true; } };
}

beforeEach(() => vi.clearAllMocks());

describe('preauthorization numbering and capture persistence', () => {
  it('commits allocation, capture order and preauthorization claim before invoking the channel', async () => {
    const f = fixture();
    await capturePreauth(4, 2, { captureAmount: 600 });
    expect(f.stages.slice(0, 6)).toEqual(['allocate', 'insert', 'attach', 'preauth', 'commit', 'provider']);
    expect(mocks.allocate).toHaveBeenCalledWith(f.tx, { scene: 'payment.capture', tenantId: 7, allocationKey: 'preauth:4', context: { amount: 600 } });
    expect(mocks.attach).toHaveBeenCalledWith(f.tx, { scene: 'payment.capture', tenantId: 7, number: 'CUSTOMCAPTURE202610110001', businessKey: '12' });
  });

  it('reuses the same failed capture order and channel number when retrying', async () => {
    const f = fixture();
    await capturePreauth(4, 2, { captureAmount: 600 });
    await capturePreauth(4, 2, { captureAmount: 600 });
    expect(f.inserts()).toBe(1);
    expect(mocks.attach).toHaveBeenCalledTimes(1);
    expect(mocks.capture).toHaveBeenCalledTimes(2);
    expect(mocks.capture.mock.calls.every(([, input]) => input.outTradeNo === 'CUSTOMCAPTURE202610110001')).toBe(true);
  });

  it('rejects a changed capture amount before channel execution and rolls back local changes', async () => {
    const f = fixture();
    await capturePreauth(4, 2, { captureAmount: 600 });
    await expect(capturePreauth(4, 2, { captureAmount: 700 })).rejects.toThrow('同一编号分配请求的业务参数发生变化');
    expect(mocks.capture).toHaveBeenCalledTimes(1);
    expect(f.order()?.amount).toBe(600);
    expect(f.preauth().status).toBe('frozen');
  });

  it('rolls back the number and claim when inserting the business order fails', async () => {
    const f = fixture(); f.failInsert();
    await expect(capturePreauth(4, 2, { captureAmount: 600 })).rejects.toThrow('insert failed');
    expect(f.order()).toBeUndefined();
    expect(f.preauth().status).toBe('frozen');
    expect(f.preauth().captureOrderNo).toBeNull();
    expect(mocks.capture).not.toHaveBeenCalled();
  });

  it('queries an unknown capture result without sending a second capture request', async () => {
    fixture();
    mocks.capture.mockRejectedValue(new Error('timeout'));
    await capturePreauth(4, 2, { captureAmount: 600 });
    await capturePreauth(4, 2, { captureAmount: 600 });
    expect(mocks.capture).toHaveBeenCalledTimes(1);
    expect(mocks.allocate).toHaveBeenCalledTimes(1);
    expect(mocks.query).toHaveBeenCalledTimes(1);
    expect(mocks.query).toHaveBeenCalledWith({}, expect.objectContaining({ operation: 'capture', outTradeNo: 'CUSTOMCAPTURE202610110001', amount: 600 }));
  });

  it('can retry the same capture order after a query confirms an unknown attempt failed', async () => {
    const f = fixture();
    mocks.capture.mockRejectedValueOnce(new Error('timeout'));
    await capturePreauth(4, 2, { captureAmount: 600 });
    mocks.query.mockResolvedValueOnce({ status: 'failed', failReason: 'provider declined' });
    await capturePreauth(4, 2, { captureAmount: 600 });
    expect(f.preauth().status).toBe('frozen');
    expect(f.order()?.status).toBe('failed');
    await capturePreauth(4, 2, { captureAmount: 600 });
    expect(f.inserts()).toBe(1);
    expect(mocks.capture).toHaveBeenCalledTimes(2);
    expect(mocks.capture.mock.calls.every(([, input]) => input.outTradeNo === 'CUSTOMCAPTURE202610110001')).toBe(true);
  });
});
