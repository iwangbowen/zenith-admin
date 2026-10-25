import { describe, expect, it } from 'vitest';
import { summarizeSettlementLines } from './payment-settlement.service';

describe('summarizeSettlementLines', () => {
  it('subtracts fee refunds from the settlement fee total', () => {
    const summary = summarizeSettlementLines([
      {
        sourceType: 'payment.capture',
        sourceId: 'PO-1',
        debitAmount: 0n,
        creditAmount: 10_000n,
      },
      {
        sourceType: 'payment.fee',
        sourceId: 'PO-1',
        debitAmount: 600n,
        creditAmount: 0n,
      },
      {
        sourceType: 'payment.refund',
        sourceId: 'RF-1',
        debitAmount: 3_000n,
        creditAmount: 0n,
      },
      {
        sourceType: 'payment.fee_refund',
        sourceId: 'RF-1',
        debitAmount: 0n,
        creditAmount: 180n,
      },
      {
        sourceType: 'payment.sharing',
        sourceId: 'PS-1',
        debitAmount: 200n,
        creditAmount: 0n,
      },
      {
        sourceType: 'payment.sharing_reversal',
        sourceId: 'PSR-1',
        debitAmount: 0n,
        creditAmount: 200n,
      },
    ]);

    expect(summary).toEqual({
      grossAmount: 10_000,
      feeAmount: 420,
      refundAmount: 3_000,
      sharingAmount: 0,
      netAmount: 6_580,
      orderCount: 1,
    });
  });
});
