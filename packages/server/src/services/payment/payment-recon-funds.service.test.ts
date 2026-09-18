import { describe, expect, it, vi } from 'vitest';
import { reconcileEntries, type ReconciliationEntry } from '@zenith/shared/payment';

vi.mock('../../db', () => ({ db: {} }));
vi.mock('../../lib/context', () => ({ currentUser: vi.fn() }));
vi.mock('./payment-recon-common', () => ({ assertReconWriteScope: vi.fn(), requireReconAccount: vi.fn(), reconJson: vi.fn() }));

import { applyFundFactAdjustments, balanceDifference, bankFactsFromAllocations, validateBankAllocationAmounts } from './payment-recon-funds.service';

function bankRow(id: number, amount: bigint, direction: 'in' | 'out' = 'in') {
  return { id, entryKey: `bank:${id}`, type: 'settlement' as const, reference: `REFERENCE${id}`, currency: 'CNY', amount,
    direction, status: 'success', occurredAt: new Date('2026-09-17T10:00:00+08:00'), applicationId: null };
}
function providerRow(id: number, amount: string): ReconciliationEntry {
  return { entryKey: `bank:${id}`, type: 'settlement', reference: `REFERENCE${id}`, currency: 'CNY', amount,
    direction: 'in', status: 'success', occurredAt: '2026-09-17 10:00:00', accountId: 1 };
}

describe('bank receipt evidence', () => {
  it('keeps unallocated deposits and outgoing settlements unresolved even when their references agree', () => {
    const bank = bankRow(1, 10000n);
    const settlement = { ...bankRow(2, 10000n, 'out'), reference: bank.reference };
    const facts = bankFactsFromAllocations([bank], [settlement], [], 1);
    const result = reconcileEntries(facts, [providerRow(1, '10000')]);
    expect(result.matchedCount).toBe(0);
    expect(result.differences.map((difference) => difference.type)).toEqual(['channel_only', 'local_only']);
  });

  it('supports one settlement split across deposits and one deposit combining settlements', () => {
    const banks = [bankRow(1, 60n), bankRow(2, 140n)];
    const settlements = [bankRow(3, 100n, 'out'), bankRow(4, 100n, 'out')];
    const allocations = [{ id: 1, bankEntryId: 1, settlementEntryId: 3, amount: 60n },
      { id: 2, bankEntryId: 2, settlementEntryId: 3, amount: 40n }, { id: 3, bankEntryId: 2, settlementEntryId: 4, amount: 100n }];
    const facts = bankFactsFromAllocations(banks, settlements, allocations, 1);
    expect(facts).toHaveLength(2);
    expect(reconcileEntries(facts, [providerRow(1, '60'), providerRow(2, '140')])).toMatchObject({ matchedCount: 2, differences: [] });
  });

  it('preserves partial allocation differences on both sides', () => {
    const facts = bankFactsFromAllocations([bankRow(1, 100n)], [bankRow(2, 100n, 'out')], [{ id: 1, bankEntryId: 1, settlementEntryId: 2, amount: 70n }], 1);
    const result = reconcileEntries(facts, [providerRow(1, '100')]);
    expect(result.differences.map((difference) => difference.type)).toEqual(['amount_diff', 'local_only']);
    expect(facts.find((entry) => entry.entryKey === 'unallocated-settlement:2')?.amount).toBe('30');
  });
});

describe('allocation financial invariants', () => {
  it('uses exact bigint capacities and accepts same-pair retries without reallocating money', () => {
    const amount = 9007199254740993n;
    const entries = [{ id: 1, amount }, { id: 2, amount }];
    const proposed = [{ bankEntryId: 1, settlementEntryId: 2, amount: amount.toString() }];
    expect(validateBankAllocationAmounts(entries, [], proposed)).toEqual(proposed);
    expect(validateBankAllocationAmounts(entries, [{ id: 1, bankEntryId: 1, settlementEntryId: 2, amount }], proposed)).toEqual([]);
  });

  it('rejects changed idempotency payloads and combined overallocations', () => {
    const entries = [{ id: 1, amount: 100n }, { id: 2, amount: 100n }, { id: 3, amount: 100n }];
    const existing = [{ id: 1, bankEntryId: 1, settlementEntryId: 2, amount: 60n }];
    expect(() => validateBankAllocationAmounts(entries, existing, [{ bankEntryId: 1, settlementEntryId: 2, amount: '70' }])).toThrow('不同金额');
    expect(() => validateBankAllocationAmounts(entries, existing, [{ bankEntryId: 1, settlementEntryId: 3, amount: '41' }])).toThrow('剩余金额');
    expect(() => validateBankAllocationAmounts(entries, [], [{ bankEntryId: 1, settlementEntryId: 2, amount: '60' }, { bankEntryId: 3, settlementEntryId: 2, amount: '50' }])).toThrow('剩余金额');
  });
});

describe('fund balance conservation', () => {
  const rows: ReconciliationEntry[] = [
    { entryKey: 'F1', type: 'payment', amount: '100', direction: 'in', status: 'success', currency: 'CNY', occurredAt: '2026-09-17 10:00:00', balance: '110' },
    { entryKey: 'F2', type: 'fee', amount: '1', direction: 'out', status: 'success', currency: 'CNY', occurredAt: '2026-09-17 11:00:00', balance: '109' },
    { entryKey: 'F3', type: 'settlement', amount: '100', direction: 'out', status: 'success', currency: 'CNY', occurredAt: '2026-09-17 12:00:00', balance: '9' },
  ];
  it('checks opening, each movement and closing against a frozen journal snapshot', () => {
    expect(balanceDifference(rows, { opening: '10', closing: '9' })).toEqual([]);
    expect(balanceDifference(rows, { opening: '0', closing: '9' })[0]?.caseKey).toBe('balance:opening');
    expect(balanceDifference(rows, { opening: '10', closing: '10' })[0]?.caseKey).toBe('balance:closing');
  });
  it('detects a corrupt running balance even when total income and expense still balance', () => {
    const changed = rows.map((entry) => entry.entryKey === 'F2' ? { ...entry, balance: '108' } : entry);
    expect(balanceDifference(changed).map((difference) => difference.caseKey)).toEqual(['balance:transition:F2', 'balance:transition:F3']);
  });
  it('nets approved adjustments and linked reversals into one original journal fact', () => {
    const original = { ...rows[0], raw: { journalId: 11 }, merchantOrderNo: 'ORDER1' };
    const correction = { ...original, entryKey: 'J12', amount: '20', raw: { journalId: 12, adjustmentId: 1, adjustmentOriginalJournalId: 11 } };
    const reversal = { ...correction, entryKey: 'J13', direction: 'out' as const, raw: { journalId: 13, adjustmentId: 2, adjustmentOriginalJournalId: 11 } };
    expect(applyFundFactAdjustments([original, correction])).toMatchObject([{ amount: '120', merchantOrderNo: 'ORDER1', raw: { adjustmentJournalIds: [12] } }]);
    expect(applyFundFactAdjustments([original, correction, reversal])).toMatchObject([{ amount: '100', raw: { adjustmentJournalIds: [12, 13] } }]);
    expect(applyFundFactAdjustments([correction, reversal])).toEqual([]);
  });
});
