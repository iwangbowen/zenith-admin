/**
 * 通知 outbox 补投单测：小批量认领 → 有界并发派发 → 循环直到耗尽 / 用完时间预算。
 *
 * 覆盖：认领批与并发上限、单行失败不影响同批其他行且落 attempts / claimedAt、
 * 认领结果不足一批时结束、时间预算耗尽时结束、单条派发路径的认领条件。
 *
 * Mock 策略：db / 派发引擎 deliverOutboxRow / logger mock；UPDATE 链按 set() 的内容区分「认领」与「落状态」。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { domainEvents, notificationOutboxSubjects, type NotificationOutboxRow } from '../../db/schema';
import type { DbTransaction } from '../../db/types';

vi.mock('../../db', () => {
  const db = { select: vi.fn(), insert: vi.fn(), update: vi.fn(), transaction: vi.fn() };
  return { db };
});

vi.mock('../../lib/notification/dispatch', () => ({
  deliverOutboxRow: vi.fn(),
}));

vi.mock('../../lib/logger', () => ({
  default: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));
vi.mock('./notification-delivery-events', () => ({ recordNotificationOutcome: vi.fn() }));

import { db } from '../../db';
import { deliverOutboxRow } from '../../lib/notification/dispatch';
import { dispatchPendingNotifications, processNotificationOutbox, notify } from './notification-outbox.service';
import { recordNotificationOutcome } from './notification-delivery-events';

const dbMock = vi.mocked(db);
const deliverMock = vi.mocked(deliverOutboxRow);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function createChain(resolveWith: (setValues: Record<string, unknown> | undefined) => unknown[]): any {
  const chain: Record<string, unknown> = {};
  let setValues: Record<string, unknown> | undefined;
  for (const m of ['from', 'where', 'limit', 'orderBy', 'for', 'values', 'returning']) {
    chain[m] = vi.fn(() => chain);
  }
  chain.set = vi.fn((values: Record<string, unknown>) => {
    setValues = values;
    return chain;
  });
  chain.getSQL = () => ({});
  chain.then = (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
    Promise.resolve().then(() => resolveWith(setValues)).then(resolve, reject);
  return chain;
}

function makeRow(id: number, overrides: Partial<NotificationOutboxRow> = {}): NotificationOutboxRow {
  return {
    id,
    eventKey: 'ops.monitor.alert_test',
    recipients: [{ type: 'external', channel: 'webhook', address: `https://hooks.invalid/${id}` }],
    vars: {},
    channelPolicy: null,
    channelOptions: null,
    link: null,
    dedupeKey: null,
    status: 'pending',
    attempts: 0,
    lastError: null,
    claimedAt: null,
    scheduledAt: null,
    digestKey: null,
    traceId: null,
    parentRef: null,
    tenantId: null,
    createdAt: new Date('2026-09-06T00:00:00Z'),
    ...overrides,
  } as NotificationOutboxRow;
}

/** 认领：set 只含 claimedAt → 依次返回预置的批；落状态：其他 set → 记录并返回空 */
function installUpdateMock(batches: NotificationOutboxRow[][]) {
  const statusWrites: Record<string, unknown>[] = [];
  const claimedRows = batches.flat();
  let claimCalls = 0;
  dbMock.update.mockImplementation(() => createChain((setValues) => {
    const keys = Object.keys(setValues ?? {});
    if (keys.length === 1 && keys[0] === 'claimedAt') {
      claimCalls += 1;
      return batches.shift() ?? [];
    }
    statusWrites.push(setValues ?? {});
    const row = claimedRows.shift();
    return row ? [{ ...row, ...setValues }] : [];
  }));
  return { statusWrites, claimCalls: () => claimCalls };
}

beforeEach(() => {
  vi.resetAllMocks();
  dbMock.select.mockImplementation(() => createChain(() => []));
  dbMock.transaction.mockImplementation(async (run) => run(db as unknown as DbTransaction));
  deliverMock.mockResolvedValue({ sent: 1, suppressed: 0, deferred: 0, failed: 0 });
});

describe('dispatchPendingNotifications', () => {
  it('按批认领并以有界并发派发，直到认领结果不足一批；返回处理行数', async () => {
    const batch1 = Array.from({ length: 32 }, (_, i) => makeRow(i + 1));
    const batch2 = Array.from({ length: 5 }, (_, i) => makeRow(100 + i));
    const { statusWrites, claimCalls } = installUpdateMock([batch1, batch2]);
    let active = 0;
    let peak = 0;
    deliverMock.mockImplementation(async () => {
      active += 1;
      peak = Math.max(peak, active);
      await new Promise((r) => setTimeout(r, 2));
      active -= 1;
      return { sent: 1, suppressed: 0, deferred: 0, failed: 0 };
    });

    const processed = await dispatchPendingNotifications();

    expect(processed).toBe(37);
    // 第二批只有 5 行（< 批大小）即结束，不再发起第三次认领
    expect(claimCalls()).toBe(2);
    expect(deliverMock).toHaveBeenCalledTimes(37);
    expect(peak).toBeGreaterThan(1);
    expect(peak).toBeLessThanOrEqual(8);
    expect(statusWrites).toHaveLength(37);
    expect(statusWrites.every((w) => w.status === 'done')).toBe(true);
  });

  it('单行派发失败只影响该行：attempts+1、保留认领时间作为重试间隔，同批其余行照常置 done', async () => {
    const rows = [makeRow(1), makeRow(2, { attempts: 4 }), makeRow(3)];
    const { statusWrites } = installUpdateMock([rows]);
    deliverMock.mockImplementation(async (row) => {
      if (row.id === 2) throw new Error('webhook 503');
      return { sent: 1, suppressed: 0, deferred: 0, failed: 0 };
    });

    const processed = await dispatchPendingNotifications();

    expect(processed).toBe(3);
    const done = statusWrites.filter((w) => w.status === 'done');
    const failed = statusWrites.find((w) => w.status === 'failed');
    expect(done).toHaveLength(2);
    // 第 5 次失败达到上限 → failed 终态；重试间隔由 claimedAt 承担，不再清空
    expect(failed).toMatchObject({ attempts: 5, lastError: 'webhook 503' });
    expect(failed?.claimedAt).toBeInstanceOf(Date);
  });

  it('未到上限的失败保持 pending 且带认领时间，不会在同一轮被立刻重打', async () => {
    const { statusWrites } = installUpdateMock([[makeRow(7, { attempts: 1 })]]);
    deliverMock.mockRejectedValue(new Error('smtp timeout'));

    await dispatchPendingNotifications();

    expect(statusWrites).toHaveLength(1);
    expect(statusWrites[0]).toMatchObject({ status: 'pending', attempts: 2, lastError: 'smtp timeout' });
    expect(statusWrites[0].claimedAt).toBeInstanceOf(Date);
  });

  it('时间预算耗尽时结束本轮，即使仍有整批可认领', async () => {
    const full = () => Array.from({ length: 32 }, (_, i) => makeRow(i + 1));
    const { claimCalls } = installUpdateMock([full(), full(), full()]);
    const realNow = Date.now;
    let calls = 0;
    // 第一次 Date.now() 取预算起点，随后的检查已越过 45s 预算
    vi.spyOn(Date, 'now').mockImplementation(() => {
      calls += 1;
      return calls === 1 ? realNow() : realNow() + 60_000;
    });

    const processed = await dispatchPendingNotifications();

    expect(processed).toBe(32);
    expect(claimCalls()).toBe(1);
  });

  it('没有可认领的行时直接返回 0，不触发派发', async () => {
    installUpdateMock([[]]);
    expect(await dispatchPendingNotifications()).toBe(0);
    expect(deliverMock).not.toHaveBeenCalled();
  });
});

describe('processNotificationOutbox', () => {
  it('认领命中即派发并置 done', async () => {
    const { statusWrites } = installUpdateMock([[makeRow(9)]]);
    await processNotificationOutbox(9);
    expect(deliverMock).toHaveBeenCalledTimes(1);
    expect(statusWrites).toEqual([{ status: 'done' }]);
    expect(recordNotificationOutcome).toHaveBeenCalledWith(db, expect.objectContaining({ id: 9, status: 'done' }), 'done', { sent: 1, failed: 0, deferred: 0, suppressed: 0 });
  });

  it('认领未命中（已被他人占用 / 非 pending）时不派发', async () => {
    installUpdateMock([[]]);
    await processNotificationOutbox(9);
    expect(deliverMock).not.toHaveBeenCalled();
  });
});

describe('notification subject transaction', () => {
  function fixture(failSubjects = false) {
    const committed: Array<{ table: unknown; values: unknown }> = [];
    const staged: Array<{ table: unknown; values: unknown }> = [];
    const tx = { insert: vi.fn((table: unknown) => ({ values: (values: unknown) => {
      if (failSubjects && table === notificationOutboxSubjects) return Promise.reject(new Error('subject insert failed'));
      staged.push({ table, values });
      const result = [{ id: 71 }];
      return { onConflictDoNothing: () => ({ returning: async () => result }) };
    } })) } as unknown as DbTransaction;
    dbMock.transaction.mockImplementation(async (work) => {
      const result = await work(tx);
      committed.push(...staged);
      return result;
    });
    return { committed, tx };
  }

  const input = {
    recipients: [{ type: 'user' as const, id: 7 }], vars: {}, tenantId: 12,
    scheduledAt: new Date('2099-01-01T00:00:00Z'),
    subjectRefs: [{ type: 'payment.order', key: '41', role: 'primary' as const }],
  };

  it('commits outbox, subjects and a safe timeline event together', async () => {
    const f = fixture();
    await expect(notify('ops.monitor.alert_test', input)).resolves.toBe(71);
    expect(dbMock.transaction).toHaveBeenCalledOnce();
    expect(f.committed).toHaveLength(4);
    expect(f.committed.find((write) => write.table === domainEvents)?.values).toMatchObject({
      tenantId: 12, sourceType: 'notification.outbox', sourceKey: '71', payload: { eventKey: 'ops.monitor.alert_test' },
    });
    expect(deliverMock).not.toHaveBeenCalled();
  });

  it('does not commit an orphan outbox row when subject persistence fails', async () => {
    const f = fixture(true);
    await expect(notify('ops.monitor.alert_test', input)).rejects.toThrow('subject insert failed');
    expect(f.committed).toEqual([]);
    expect(deliverMock).not.toHaveBeenCalled();
  });
});
