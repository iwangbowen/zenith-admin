import { describe, expect, it } from 'vitest';
import { assertUniqueReconciliationEntries, parseReconciliationCsv, reconcileEntries, serializeReconciliationCsv, type ReconciliationEntry } from '@zenith/shared/payment';

const payment = (order: string, appId: number): ReconciliationEntry => ({ entryKey: `local:${order}`, type: 'payment', merchantOrderNo: order,
  providerTransactionId: `P${order}`, currency: 'CNY', amount: '10000', direction: 'in', status: 'success',
  occurredAt: '2026-09-17T10:00:00+08:00', applicationId: appId, accountId: 5 });

describe('account-scoped reconciliation and imports', () => {
  it('matches one merchant bill across multiple applications without inventing channel-only records', () => {
    const local = [payment('A', 11), payment('B', 12)];
    const provider = local.map((entry) => ({ ...entry, entryKey: `provider:${entry.providerTransactionId}`, applicationId: null }));
    expect(reconcileEntries(local, provider)).toMatchObject({ matchedCount: 2, differences: [] });
  });
  it('preserves separate partial refunds on a later day without reversing the original payment', () => {
    const local: ReconciliationEntry[] = ['R1', 'R2'].map((refund, index) => ({ ...payment('A', 11), entryKey: refund, type: 'refund',
      merchantRefundNo: refund, providerRefundId: `P${refund}`, direction: 'out', amount: String((index + 1) * 1000), occurredAt: '2026-09-18T10:00:00+08:00' }));
    const provider = local.map((entry) => ({ ...entry, applicationId: null, entryKey: `provider:${entry.entryKey}` }));
    expect(reconcileEntries(local, provider)).toMatchObject({ matchedCount: 2, differences: [] });
    expect(reconcileEntries(local, provider.map((entry, index) => ({ ...entry, status: index ? 'processing' : 'success' }))).differences[0]).toMatchObject({ type: 'status_diff', entryKey: 'R2' });
  });
  it('refuses duplicate business aliases even when row identifiers differ', () => {
    const first = payment('A', 11);
    expect(() => assertUniqueReconciliationEntries([first, { ...first, entryKey: 'another' }])).toThrow('重复业务标识');
    expect(() => reconcileEntries([first], [{ ...first, entryKey: 'one' }, { ...first, entryKey: 'two' }])).toThrow();
  });
  it('does not equate different accounts, currencies or conflicting provider identities', () => {
    const local = payment('A', 11);
    for (const changes of [{ accountId: 6 }, { currency: 'USD' }, { providerTransactionId: 'WRONG' }, { applicationId: 12 }]) {
      expect(reconcileEntries([local], [{ ...local, ...changes }]).differences[0]?.type).toBe('identity_diff');
    }
  });
  it('round-trips exact large money values through controlled CSV and rejects fractional cents', () => {
    const entry = { ...payment('order,with,commas', 11), amount: '9007199254740993' };
    expect(parseReconciliationCsv(serializeReconciliationCsv([entry]))[0]).toMatchObject({ merchantOrderNo: entry.merchantOrderNo, amount: entry.amount });
    expect(() => parseReconciliationCsv(serializeReconciliationCsv([entry]).replace('9007199254740993', '99.5'))).toThrow();
  });
});
