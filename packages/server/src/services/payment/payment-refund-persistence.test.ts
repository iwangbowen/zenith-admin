import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DbTransaction } from '../../db/types';

const mocks = vi.hoisted(() => ({ select: vi.fn(), update: vi.fn(), transaction: vi.fn(), provider: vi.fn() }));
vi.mock('../../db', () => ({ db: { select: mocks.select, update: mocks.update, transaction: mocks.transaction, $count: async () => 0 } }));
vi.mock('../../lib/context', () => ({ currentUser: () => ({ userId: 9, tenantId: 7 }), currentUserOrNull: () => ({ userId: 9, tenantId: 7 }), setAuditSubjects: vi.fn() }));
vi.mock('../../lib/settings', () => ({ getSettings: async () => ({ refundApprovalThreshold: 0 }) }));
vi.mock('../../lib/encryption', () => ({ decryptField: () => null }));
vi.mock('../../lib/payment', () => ({ getAdapter: () => ({ refund: mocks.provider }) }));
vi.mock('./payment-channel-config-resolver', () => ({ assertPaymentEngineConfig: vi.fn(), resolvePaymentChannelConfig: vi.fn() }));
vi.mock('./payment-capability-evaluator', () => ({ assertEffectivePaymentOperation: vi.fn() }));
vi.mock('./payment-risk.service', () => ({ assertNoPendingRiskReview: vi.fn(), evaluateRisk: vi.fn(), recordRiskHit: vi.fn(), suspendOrderForReview: vi.fn() }));

import { paymentChannelConfigs, paymentOrders, paymentRefunds } from '../../db/schema';
import { refund } from './payment.service';

function selectChain(rows: () => unknown[]) {
  const chain = { where: (_where: unknown) => chain, limit: (_limit: number) => chain,
    then: (resolve: (value: unknown[]) => unknown, reject?: (reason: unknown) => unknown) => Promise.resolve().then(rows).then(resolve, reject) };
  return chain;
}

function fixture() {
  const stages: string[] = [];
  let inserted: Record<string, unknown> | undefined;
  let committed = false;
  const order = { id: 41, orderNo: 'PO41', status: 'success', amount: 1000, channel: 'wechat', channelConfigId: 2, channelAccountId: 3, tenantId: 7, payMethod: 'wechat_native', currency: 'CNY' };
  mocks.select.mockImplementation(() => ({ from: (table: unknown) => selectChain(() => table === paymentOrders ? [order]
    : table === paymentChannelConfigs ? [{ id: 2, channel: 'wechat', sandbox: true, tenantId: 7, credentialVersion: 1, notifyUrl: 'https://payment.test', callbackToken: 'test' }] : []) }));
  mocks.update.mockImplementation(() => ({ set: () => ({ where: async () => undefined }) }));
  const tx = {
    execute: async () => undefined,
    select: () => ({ from: (table: unknown) => selectChain(() => table === paymentOrders ? [order] : table === paymentRefunds && inserted ? [inserted] : []) }),
    insert: () => ({ values: (values: Record<string, unknown>) => ({ returning: async () => {
      stages.push('refund'); inserted = { id: 8, ...values }; return [inserted];
    } }) }),
    update: mocks.update,
  } as unknown as DbTransaction;
  mocks.transaction.mockImplementation(async (work: (executor: DbTransaction) => Promise<unknown>) => {
    const result = await work(tx); committed = true; stages.push('commit'); return result;
  });
  mocks.provider.mockImplementation(async () => { stages.push('provider'); return { status: 'processing' }; });
  return { tx, stages, committed: () => committed };
}

beforeEach(() => vi.clearAllMocks());

describe('refund domain linkage', () => {
  it('commits internal business linkage with the refund before invoking the provider', async () => {
    const f = fixture();
    await refund({ orderNo: 'PO41', refundAmount: 100, idempotencyKey: 'dispute-4', onPersisted: async (tx, row) => {
      expect(tx).toBe(f.tx); expect(row.id).toBe(8); expect(row.tenantId).toBe(7); f.stages.push('link');
    } });
    expect(f.stages).toEqual(['refund', 'link', 'commit', 'provider']);
    expect(f.committed()).toBe(true);
  });

  it('rolls back the refund and avoids the provider when internal linkage fails', async () => {
    const f = fixture();
    await expect(refund({ orderNo: 'PO41', refundAmount: 100, idempotencyKey: 'dispute-4', onPersisted: async () => {
      throw new Error('dispute already closed');
    } })).rejects.toThrow('dispute already closed');
    expect(f.committed()).toBe(false);
    expect(mocks.provider).not.toHaveBeenCalled();
  });
});
