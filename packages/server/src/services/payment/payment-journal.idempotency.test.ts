import { describe, expect, it } from 'vitest';
import { systemJournalRequestHash } from './payment-journal.service';

function systemJournal(overrides: Record<string, unknown> = {}) {
  return {
    tenantId: null,
    operatorId: null,
    sourceType: 'payment.fee',
    sourceId: 'PO-IDEMPOTENCY-1',
    description: '支付手续费（规则 A） PO-IDEMPOTENCY-1',
    appId: 2,
    channelConfigId: 2,
    currency: 'CNY',
    lines: [
      { accountCode: 'merchant_available', debitAmount: '12', creditAmount: '0', memo: '扣减商户可用余额' },
      { accountCode: 'platform_fee', debitAmount: '0', creditAmount: '12', memo: '规则 A' },
    ],
    ...overrides,
  };
}

describe('systemJournalRequestHash', () => {
  it('ignores presentation text so an at-least-once replay reuses the same journal', () => {
    const first = systemJournalRequestHash(systemJournal(), null, 3);
    const replay = systemJournalRequestHash(systemJournal({
      description: '支付手续费 PO-IDEMPOTENCY-1',
      lines: [
        { accountCode: 'merchant_available', debitAmount: '12', creditAmount: '0', memo: '通用描述' },
        { accountCode: 'platform_fee', debitAmount: '0', creditAmount: '12', memo: null },
      ],
    }), null, 3);

    expect(replay).toBe(first);
  });

  it('changes when an immutable financial fact changes', () => {
    const first = systemJournalRequestHash(systemJournal(), null, 3);
    const changedAmount = systemJournalRequestHash(systemJournal({
      lines: [
        { accountCode: 'merchant_available', debitAmount: '13', creditAmount: '0', memo: '别的描述' },
        { accountCode: 'platform_fee', debitAmount: '0', creditAmount: '13', memo: '别的描述' },
      ],
    }), null, 3);

    expect(changedAmount).not.toBe(first);
  });
});
