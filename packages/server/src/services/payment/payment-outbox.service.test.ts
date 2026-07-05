/**
 * 支付事件 Outbox 服务单测（履约事件可靠投递，资金一致性关键）。
 *
 * 覆盖要点：
 *  1. recordEvent：事务内原子落库（payload JSON 化、status=pending）
 *  2. processEvent：条件 claim（pending + 未超限 + 未被占用）未命中直接返回；
 *     投递成功置 done；失败 attempts+1 保持 pending 可重试（processedAt 清空）；
 *     达重试上限（5）置 failed 终态
 *  3. dispatchPendingPaymentEvents：cron 兜底扫描补投，返回扫描数
 *
 * Mock 策略：db / payment-event-bus / logger mock。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../db', () => {
  const db = { select: vi.fn(), insert: vi.fn(), update: vi.fn() };
  return { db };
});

vi.mock('../../lib/payment-event-bus', () => ({
  paymentEventBus: { dispatch: vi.fn(), emit: vi.fn(), on: vi.fn() },
}));

vi.mock('../../lib/logger', () => ({
  default: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

import { db } from '../../db';
import { paymentEventBus } from '../../lib/payment-event-bus';
import { recordEvent, processEvent, dispatchPendingPaymentEvents } from './payment-outbox.service';
import type { PaymentEventRow } from '../../db/schema';

const dbMock = vi.mocked(db);
const dispatchMock = vi.mocked(paymentEventBus.dispatch);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function createChain(result: unknown[]): any {
  const chain: Record<string, unknown> = {};
  for (const m of ['from', 'where', 'limit', 'set', 'values', 'returning']) {
    chain[m] = vi.fn(() => chain);
  }
  chain.then = (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
    Promise.resolve(result).then(resolve, reject);
  return chain;
}

function makeEventRow(overrides: Partial<PaymentEventRow> = {}): PaymentEventRow {
  return {
    id: 100,
    type: 'payment.succeeded',
    orderNo: 'PO-1',
    payload: JSON.stringify({ type: 'payment.succeeded', orderNo: 'PO-1', bizType: 'member_recharge' }),
    status: 'pending',
    attempts: 0,
    lastError: null,
    processedAt: null,
    tenantId: null,
    createdAt: new Date('2026-07-05T10:00:00'),
    ...overrides,
  } as PaymentEventRow;
}

beforeEach(() => {
  vi.resetAllMocks();
  dispatchMock.mockResolvedValue(undefined);
  dbMock.update.mockImplementation(() => createChain([]));
});

describe('recordEvent', () => {
  it('事务内插入 pending 事件，payload JSON 序列化，返回事件 id', async () => {
    const insertChain = createChain([{ id: 7 }]);
    const tx = { insert: vi.fn(() => insertChain) };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const id = await recordEvent(tx as any, {
      type: 'payment.succeeded',
      orderNo: 'PO-9',
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      payload: { type: 'payment.succeeded', orderNo: 'PO-9', bizType: 'demo' } as any,
      tenantId: null,
    });

    expect(id).toBe(7);
    const values = insertChain.values.mock.calls[0][0];
    expect(values.status).toBe('pending');
    expect(JSON.parse(values.payload)).toMatchObject({ orderNo: 'PO-9' });
  });
});

describe('processEvent', () => {
  it('claim 未命中（已被处理/超限/占用中）→ 直接返回不投递', async () => {
    dbMock.update.mockReturnValueOnce(createChain([]));
    await processEvent(100);
    expect(dispatchMock).not.toHaveBeenCalled();
    expect(dbMock.update).toHaveBeenCalledTimes(1);
  });

  it('claim 成功 + 投递成功 → 置 done', async () => {
    dbMock.update.mockReturnValueOnce(createChain([makeEventRow()]));
    const doneChain = createChain([]);
    dbMock.update.mockReturnValueOnce(doneChain);

    await processEvent(100);

    expect(dispatchMock).toHaveBeenCalledWith(
      expect.objectContaining({ orderNo: 'PO-1', eventId: 'payment-outbox-100', occurredAt: expect.any(String) }),
    );
    expect(doneChain.set).toHaveBeenCalledWith(expect.objectContaining({ status: 'done' }));
  });

  it('投递失败（未达上限）→ attempts+1 保持 pending，processedAt 清空以便补投', async () => {
    dispatchMock.mockRejectedValueOnce(new Error('subscriber boom'));
    dbMock.update.mockReturnValueOnce(createChain([makeEventRow({ attempts: 1 })]));
    const retryChain = createChain([]);
    dbMock.update.mockReturnValueOnce(retryChain);

    await processEvent(100);

    expect(retryChain.set).toHaveBeenCalledWith(
      expect.objectContaining({ attempts: 2, status: 'pending', lastError: 'subscriber boom', processedAt: null }),
    );
  });

  it('投递失败达重试上限（5）→ 置 failed 终态', async () => {
    dispatchMock.mockRejectedValueOnce(new Error('still down'));
    dbMock.update.mockReturnValueOnce(createChain([makeEventRow({ attempts: 4 })]));
    const failChain = createChain([]);
    dbMock.update.mockReturnValueOnce(failChain);

    await processEvent(100);

    expect(failChain.set).toHaveBeenCalledWith(
      expect.objectContaining({ attempts: 5, status: 'failed', processedAt: expect.any(Date) }),
    );
  });

  it('错误消息截断至 500 字符（防超长报错撑爆列）', async () => {
    dispatchMock.mockRejectedValueOnce(new Error('x'.repeat(600)));
    dbMock.update.mockReturnValueOnce(createChain([makeEventRow()]));
    const retryChain = createChain([]);
    dbMock.update.mockReturnValueOnce(retryChain);

    await processEvent(100);

    expect(retryChain.set.mock.calls[0][0].lastError).toHaveLength(500);
  });
});

describe('dispatchPendingPaymentEvents', () => {
  it('无待投事件 → 返回 0', async () => {
    dbMock.select.mockReturnValueOnce(createChain([]));
    expect(await dispatchPendingPaymentEvents()).toBe(0);
    expect(dispatchMock).not.toHaveBeenCalled();
  });

  it('逐条补投 pending 事件并返回扫描条数', async () => {
    dbMock.select.mockReturnValueOnce(createChain([{ id: 1 }, { id: 2 }]));
    // 两次 processEvent：各 claim 成功 + done 更新
    dbMock.update
      .mockReturnValueOnce(createChain([makeEventRow({ id: 1 })]))
      .mockReturnValueOnce(createChain([]))
      .mockReturnValueOnce(createChain([makeEventRow({ id: 2 })]))
      .mockReturnValueOnce(createChain([]));

    expect(await dispatchPendingPaymentEvents()).toBe(2);
    expect(dispatchMock).toHaveBeenCalledTimes(2);
  });
});
