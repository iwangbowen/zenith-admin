import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DbTransaction } from '../../db/types';

const mocks = vi.hoisted(() => ({
  select: vi.fn(), insert: vi.fn(), update: vi.fn(), transaction: vi.fn(), detail: vi.fn(),
  event: vi.fn(), audit: vi.fn(), addAudit: vi.fn(), refund: vi.fn(),
}));
vi.mock('../../db', () => ({ db: { select: mocks.select, insert: mocks.insert, update: mocks.update, transaction: mocks.transaction,
  query: { paymentDisputes: { findFirst: mocks.detail } } } }));
vi.mock('../../lib/context', () => ({ currentUser: () => ({ userId: 9, tenantId: 7 }), currentUserOrNull: () => ({ userId: 9, tenantId: 7 }), setAuditSubjects: mocks.audit, addAuditSubject: mocks.addAudit }));
vi.mock('../../lib/tenant', () => ({ tenantCondition: () => undefined, exactTenantCondition: () => undefined, inheritedTenantCondition: () => undefined, requireTenantScopeId: () => 7 }));
vi.mock('../platform/relations/events.service', () => ({ recordDomainEvent: mocks.event }));
vi.mock('./payment-outbox.service', () => ({ recordEvent: async () => null, processEvent: async () => undefined }));
vi.mock('./payment.service', () => ({ refund: mocks.refund }));

import { paymentDisputes, paymentDisputeReplies, paymentOrders, paymentRefunds, paymentRiskReviews } from '../../db/schema';
import { parseDomainEventSummary, type DomainEventType } from '@zenith/shared/platform';
import { approveRiskReview } from './payment-risk.service';
import { completeDisputeRefund, refundDispute, replyDispute, resolveDispute } from './payment-dispute.service';

const stamp = new Date('2026-09-20T00:00:00Z');
const review = { id: 2, reviewNo: 'RSK2', hitId: 3, orderNo: 'PO41', status: 'pending', tenantId: 7, createdAt: stamp, updatedAt: stamp };
const dispute = { id: 4, disputeNo: 'DSP4', orderNo: 'PO41', status: 'pending', tenantId: 7, refundNo: null, amount: 100, deadline: null, createdAt: stamp, updatedAt: stamp };

function query(result: () => unknown[]) {
  const chain = {
    from: (_table: unknown) => chain, where: (_where: unknown) => chain, limit: (_limit: number) => chain,
    for: (_mode: string) => chain,
    then: (resolve: (rows: unknown[]) => unknown, reject?: (error: unknown) => unknown) => Promise.resolve().then(result).then(resolve, reject),
  };
  return chain;
}

function fixture(options: { eventFails?: boolean; claimFails?: boolean } = {}) {
  const committed: Array<{ table: unknown; values: unknown }> = [];
  const stages: string[] = [];
  const rows = (table: unknown) => table === paymentRiskReviews ? [review] : table === paymentDisputes ? [dispute]
    : table === paymentOrders ? [{ id: 41, orderNo: 'PO41', status: 'pending', amount: 100, paidAt: null }]
      : table === paymentRefunds ? [{ id: 8, refundNo: 'REF8', status: 'pending' }] : [];
  mocks.select.mockImplementation(() => ({ from: (table: unknown) => query(() => rows(table)) }));
  const tx = {
    select: mocks.select,
    insert: (table: unknown) => ({ values: async (values: unknown) => { stages.push('reply'); staged.push({ table, values }); } }),
    update: (table: unknown) => ({ set: (patch: object) => {
      const updated = { ...(table === paymentRiskReviews ? review : table === paymentDisputes ? dispute : { id: 41 }), ...patch };
      const result = options.claimFails ? [] : [updated];
      staged.push({ table, values: patch });
      return { where: () => ({ returning: async () => result }) };
    } }),
  } as unknown as DbTransaction;
  let staged: Array<{ table: unknown; values: unknown }> = [];
  mocks.transaction.mockImplementation(async (work: (executor: DbTransaction) => Promise<unknown>) => {
    staged = [];
    const result = await work(tx);
    committed.push(...staged); stages.push('commit');
    return result;
  });
  mocks.event.mockImplementation(async (executor: DbTransaction, input: { eventType: DomainEventType; payload: unknown }) => {
    expect(executor).toBe(tx);
    parseDomainEventSummary(input.eventType, input.payload);
    stages.push('event');
    if (options.eventFails) throw new Error('timeline unavailable');
    return 55;
  });
  mocks.detail.mockResolvedValue({ ...dispute, replies: [] });
  return { tx, committed, stages };
}

beforeEach(() => vi.clearAllMocks());

describe('payment relationship writes', () => {
  it('commits a review decision and order update with its safe event and subjects', async () => {
    const f = fixture();
    await approveRiskReview(2, 'secret manual explanation');
    expect(mocks.event).toHaveBeenCalledWith(f.tx, expect.objectContaining({
      eventType: 'payment.risk.review.decided', tenantId: 7,
      source: { type: 'payment.risk-review', key: '2' },
      payload: { reviewNo: 'RSK2', status: 'approved' },
      subjects: expect.arrayContaining([{ type: 'payment.order', key: '41', role: 'related' }]),
    }));
    expect(f.stages).toEqual(['event', 'commit']);
    expect(mocks.audit).toHaveBeenCalledWith(expect.any(Array), 7);
  });

  it('rolls back a review decision when its event cannot be persisted', async () => {
    const f = fixture({ eventFails: true });
    await expect(approveRiskReview(2, 'approve')).rejects.toThrow('timeline unavailable');
    expect(f.committed).toEqual([]);
  });

  it('records dispute reply and resolution without exposing response content', async () => {
    const f = fixture();
    await replyDispute(4, 'private customer communication');
    await resolveDispute(4, 'private settlement explanation');
    expect(mocks.event.mock.calls.map(([, value]) => value.payload)).toEqual([
      { disputeNo: 'DSP4', status: 'processing' }, { disputeNo: 'DSP4', status: 'resolved' },
    ]);
    expect(f.committed.filter((write) => write.table === paymentDisputeReplies)).toHaveLength(2);
  });

  it('does not append a reply or event after a concurrent terminal-state transition', async () => {
    const f = fixture({ claimFails: true });
    await expect(replyDispute(4, 'late reply')).rejects.toThrow('工单已被其他操作完结');
    expect(mocks.event).not.toHaveBeenCalled();
    expect(f.committed).toEqual([]);
  });

  it('binds the dispute to the refund inside the refund persistence callback', async () => {
    const f = fixture();
    mocks.refund.mockImplementation(async (input: { onPersisted: (tx: DbTransaction, row: unknown) => Promise<void> }) => {
      await input.onPersisted(f.tx, { id: 8, refundNo: 'REF8', status: 'pending' });
      f.stages.push('provider');
      return { refundNo: 'REF8', status: 'pending' };
    });
    await refundDispute(4, {});
    expect(f.stages).toEqual(['reply', 'event', 'provider']);
    expect(mocks.event).toHaveBeenCalledWith(f.tx, expect.objectContaining({ eventType: 'payment.dispute.refund-requested' }));
    expect(mocks.addAudit).toHaveBeenCalledWith({ type: 'payment.dispute', key: '4', role: 'primary' }, 7);
  });

  it('finishes a refunded dispute in the same transaction as its history and event', async () => {
    const f = fixture();
    await completeDisputeRefund('REF8', 7);
    expect(f.stages).toEqual(['reply', 'event', 'commit']);
    expect(mocks.event).toHaveBeenCalledWith(f.tx, expect.objectContaining({ eventType: 'payment.dispute.refunded', tenantId: 7 }));
  });
});
