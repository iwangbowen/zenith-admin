import { describe, expect, it } from 'vitest';
import { PAYMENT_RECON_ADJUSTMENT_BIZ_TYPE } from '@zenith/shared/payment';
import { assertIndependentReconApproval, assertReconAdjustmentAmount, reconEvidenceHash } from './payment-recon-adjustment-policy';

const difference = { type: 'amount_diff' as const, status: 'open' as const, applicationId: 3, localAmount: 100n, channelAmount: 125n };

describe('payment reconciliation adjustment evidence and money controls', () => {
  it('rejects a self approval and every automatic/external actor while allowing an independent human', () => {
    for (const actorId of [0, -1, 12]) expect(() => assertIndependentReconApproval(PAYMENT_RECON_ADJUSTMENT_BIZ_TYPE, 12, actorId)).toThrow('真实用户人工审批');
    expect(() => assertIndependentReconApproval(PAYMENT_RECON_ADJUSTMENT_BIZ_TYPE, 12, 13)).not.toThrow();
    expect(() => assertIndependentReconApproval('biz_leave', 12, 12)).not.toThrow();
  });
  it('rejects funding an unallocated channel-only record even if an operator selects an application', () => {
    expect(() => assertReconAdjustmentAmount({ ...difference, type: 'channel_only', applicationId: null, localAmount: null }, { applicationId: 3, amount: '125', direction: 'in' })).toThrow('明确本地归属');
  });
  it('derives a refund difference with the correct signed direction', () => {
    const refund = { ...difference, localAmount: -100n, channelAmount: -125n };
    expect(() => assertReconAdjustmentAmount(refund, { applicationId: 3, amount: '25', direction: 'out' })).not.toThrow();
    expect(() => assertReconAdjustmentAmount(refund, { applicationId: 3, amount: '25', direction: 'in' })).toThrow('精确等于');
  });
  it('keeps exact cents above the JavaScript safe integer limit', () => {
    expect(() => assertReconAdjustmentAmount({ ...difference, localAmount: 9007199254740992n, channelAmount: 9007199254740993n }, { applicationId: 3, amount: '1', direction: 'in' })).not.toThrow();
    expect(() => assertReconAdjustmentAmount(difference, { applicationId: 3, amount: '24', direction: 'in' })).toThrow('精确等于');
  });
  it('rejects a resolved case, another application, and status-only differences', () => {
    expect(() => assertReconAdjustmentAmount({ ...difference, status: 'resolved' }, { applicationId: 3, amount: '25', direction: 'in' })).toThrow('未解决');
    expect(() => assertReconAdjustmentAmount(difference, { applicationId: 4, amount: '25', direction: 'in' })).toThrow('归属不一致');
    expect(() => assertReconAdjustmentAmount({ ...difference, type: 'status_diff' }, { applicationId: 3, amount: '25', direction: 'in' })).toThrow('金额差异');
  });
  it('survives PostgreSQL JSONB key reordering but detects changed cents and source versions', () => {
    const frozen = { amount: '9007199254740993', fact: { id: 4, version: 2 }, lines: [{ debit: '1', credit: '0' }] };
    expect(reconEvidenceHash(frozen)).toBe(reconEvidenceHash({ lines: [{ credit: '0', debit: '1' }], fact: { version: 2, id: 4 }, amount: '9007199254740993' }));
    expect(reconEvidenceHash(frozen)).not.toBe(reconEvidenceHash({ ...frozen, amount: '9007199254740992' }));
    expect(reconEvidenceHash(frozen)).not.toBe(reconEvidenceHash({ ...frozen, fact: { id: 4, version: 3 } }));
  });
});
