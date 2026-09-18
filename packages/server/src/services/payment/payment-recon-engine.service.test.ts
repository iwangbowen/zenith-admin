import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DbExecutor } from '../../db/types';
import type { PaymentStatementPeriodRow } from '../../db/schema';
import type { TaskRunContext } from '../../lib/task-center';

const mocks = vi.hoisted(() => ({ select: vi.fn(), update: vi.fn(), insert: vi.fn(), transaction: vi.fn(), readSnapshot: vi.fn(), notify: vi.fn(),
  fundFacts: vi.fn(), bankFacts: vi.fn(), balances: vi.fn(), rows: [] as unknown[][], sets: [] as Record<string, unknown>[] }));
vi.mock('../../db', () => ({ db: { select: mocks.select, update: mocks.update, insert: mocks.insert, transaction: mocks.transaction }, readSnapshot: mocks.readSnapshot }));
vi.mock('../../lib/context', () => ({ currentUserOrNull: () => ({ userId: 7, tenantId: null }) }));
vi.mock('../messaging/notification-outbox.service', () => ({ notifyWithin: mocks.notify }));
vi.mock('./payment-recon-common', () => ({ reconJson: (value: unknown) => JSON.parse(JSON.stringify(value, (_key, item: unknown) => typeof item === 'bigint' ? item.toString() : item)),
  reconNotificationPolicy: async () => ({ settings: { reconCaseSlaHours: 24 }, recipients: [{ type: 'user', id: 7 }] }) }));
vi.mock('./payment-recon-funds.service', () => ({ loadFundFacts: mocks.fundFacts, loadBankFacts: mocks.bankFacts, loadFundBalanceSnapshot: mocks.balances, balanceDifference: () => [] }));

import { executeReconRun, loadTradeFacts, statementDateBounds } from './payment-recon-engine.service';

function chain(result?: unknown[]) {
  const q: Record<string, unknown> = {};
  for (const method of ['from', 'where', 'innerJoin', 'limit', 'for', 'returning', 'orderBy']) q[method] = vi.fn(() => q);
  q.set = vi.fn((value: Record<string, unknown>) => { mocks.sets.push(value); return q; });
  q.then = (resolve: (value: unknown[]) => unknown, reject: (error: unknown) => unknown) => Promise.resolve(result ?? mocks.rows.shift() ?? []).then(resolve, reject);
  return q;
}
const period = { id: 3, accountId: 5, type: 'trade', billDate: '2026-09-17', currency: 'CNY', tenantId: null, currentStatementId: 4 } as PaymentStatementPeriodRow;
const context = () => ({ taskId: 42, attempt: 1, progress: vi.fn().mockResolvedValue({ cancelRequested: false }), isCancelRequested: vi.fn().mockResolvedValue(false) }) as unknown as TaskRunContext;
const stamp = new Date('2026-09-17T10:00:00+08:00');

beforeEach(() => {
  vi.clearAllMocks(); mocks.rows = []; mocks.sets = [];
  mocks.select.mockImplementation(() => chain()); mocks.update.mockImplementation(() => chain([]));
  mocks.transaction.mockImplementation(async (work: (executor: unknown) => unknown) => work({ select: mocks.select, update: mocks.update, insert: mocks.insert }));
});

describe('reconciliation execution evidence', () => {
  it('uses timezone midnight boundaries even across DST transitions', () => {
    const bounds = statementDateBounds('2026-03-08', 'America/New_York');
    expect(bounds.end.getTime() - bounds.start.getTime()).toBe(23 * 3_600_000);
    const shanghai = statementDateBounds('2026-09-17', 'Asia/Shanghai');
    expect(shanghai.start.getTime()).toBe(Date.parse('2026-09-17T00:00:00+08:00'));
  });

  it('retains multiple application facts while excluding the original payment referenced only by a cross-day refund', async () => {
    const order = (id: number, paidAt: Date, appId: number) => ({ id, outTradeNo: `ORDER${id}`, channelTradeNo: `WX${id}`, amount: 10000,
      currency: 'CNY', status: 'success', paidAt, createdAt: paidAt, appId, orderNo: `PAY${id}`, version: 1 });
    const current = [order(1, stamp, 11), order(2, stamp, 12)];
    const yesterday = order(3, new Date('2026-09-16T10:00:00+08:00'), 11);
    const refund = { id: 8, outRefundNo: 'REF8', channelRefundNo: 'WXR8', refundAmount: 2000, status: 'success', refundedAt: stamp, createdAt: stamp, version: 1, refundNo: 'LOCALREF8' };
    mocks.rows = [[...current, yesterday], [{ refund, order: yesterday }], current.map((entry) => ({ no: entry.outTradeNo, provider: entry.channelTradeNo }))];
    const facts = await loadTradeFacts({ select: mocks.select } as unknown as DbExecutor, period, 'Asia/Shanghai', 4);
    expect(facts.filter((entry) => entry.type === 'payment').map((entry) => entry.applicationId)).toEqual([11, 12]);
    expect(facts.find((entry) => entry.type === 'refund')).toMatchObject({ merchantOrderNo: 'ORDER3', merchantRefundNo: 'REF8', refundId: 8, amount: '2000' });
  });

  it('returns completed run results without reading mutable facts or publishing again', async () => {
    mocks.rows = [[{ id: 1, status: 'completed', matchedCount: 8, diffCount: 2 }]];
    expect(await executeReconRun(1, null, context())).toEqual({ runId: 1, matchedCount: 8, diffCount: 2 });
    expect(mocks.readSnapshot).not.toHaveBeenCalled(); expect(mocks.transaction).not.toHaveBeenCalled(); expect(mocks.notify).not.toHaveBeenCalled();
  });

  it('replays a started run from its frozen snapshot even when current business data is unavailable', async () => {
    const local = { entryKey: 'payment:ORDER1', type: 'payment', merchantOrderNo: 'ORDER1', providerTransactionId: 'WX1', currency: 'CNY', amount: '10000', direction: 'in', status: 'success', occurredAt: '2026-09-17 10:00:00', accountId: 5 };
    const run = { id: 1, statementId: 4, taskId: 42, status: 'running', startedAt: stamp, localSnapshot: [local], snapshotContext: { cases: [], adjustments: [] }, createdBy: 7 };
    const statement = { id: 4, periodId: 3, version: 1, status: 'validated', source: 'provider_download' };
    mocks.rows = [[run], [statement], [period], [{ id: 5, name: '商户账户', billTimezone: 'Asia/Shanghai' }],
      [{ ...local, id: 9, amount: 10000n, occurredAt: stamp }], [period], [run], [{ id: 42, status: 'running', cancelRequested: false, attempts: 1 }], []];
    expect(await executeReconRun(1, null, context())).toMatchObject({ matchedCount: 1, diffCount: 0 });
    expect(mocks.readSnapshot).not.toHaveBeenCalled(); expect(mocks.fundFacts).not.toHaveBeenCalled();
    expect(mocks.sets).toContainEqual(expect.objectContaining({ status: 'completed', matchedCount: 1 }));
  });

  it('rejects publication if a newer bill replaced the one captured by the run', async () => {
    const run = { id: 1, statementId: 4, status: 'running', startedAt: stamp, localSnapshot: [], snapshotContext: { cases: [] } };
    mocks.rows = [[run], [{ id: 4, periodId: 3, status: 'validated' }], [period], [{ id: 5, billTimezone: 'Asia/Shanghai' }], [], [{ ...period, currentStatementId: 8 }]];
    await expect(executeReconRun(1, null, context())).rejects.toThrow('版本发生变化');
    expect(mocks.insert).not.toHaveBeenCalled(); expect(mocks.notify).not.toHaveBeenCalled();
  });
});
