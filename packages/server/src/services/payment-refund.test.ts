/**
 * 退款可退余额计算逻辑单测（纯函数，无 DB 依赖）。
 *
 * 测试 `calcLockedRefundAmount`，覆盖：正常累计、状态过滤、边界（0/全额/超额）。
 */
import { describe, it, expect } from 'vitest';
import { calcLockedRefundAmount } from './payment.service';

type RefundLike = { amount: number; status: string };

describe('calcLockedRefundAmount', () => {
  it('空列表返回 0', () => {
    expect(calcLockedRefundAmount([])).toBe(0);
  });

  it('统计 pending + processing + success 状态，跳过 failed', () => {
    const refunds: RefundLike[] = [
      { amount: 1000, status: 'success' },
      { amount: 500, status: 'processing' },
      { amount: 200, status: 'pending' },
      { amount: 300, status: 'failed' },    // 不计
    ];
    expect(calcLockedRefundAmount(refunds)).toBe(1700);
  });

  it('全部为 failed 时返回 0', () => {
    const refunds: RefundLike[] = [
      { amount: 999, status: 'failed' },
      { amount: 1, status: 'failed' },
    ];
    expect(calcLockedRefundAmount(refunds)).toBe(0);
  });

  it('多次部分退款累加正确', () => {
    const refunds: RefundLike[] = [
      { amount: 3000, status: 'success' },
      { amount: 2000, status: 'success' },
    ];
    expect(calcLockedRefundAmount(refunds)).toBe(5000);
  });

  it('单笔全额退款返回完整金额', () => {
    expect(calcLockedRefundAmount([{ amount: 9900, status: 'success' }])).toBe(9900);
  });

  it('金额为 0 分的退款记录不影响总额', () => {
    const refunds: RefundLike[] = [
      { amount: 0, status: 'success' },
      { amount: 100, status: 'processing' },
    ];
    expect(calcLockedRefundAmount(refunds)).toBe(100);
  });
});

// ─── 退款超额逻辑验证（基于 calcLockedRefundAmount 的业务层逻辑）──────────────

describe('退款可退余额 - 业务层边界', () => {
  const ORDER_AMOUNT = 9900; // 99.00 元（分）

  function canRefund(refunds: RefundLike[], newRefundAmount: number): boolean {
    return calcLockedRefundAmount(refunds) + newRefundAmount <= ORDER_AMOUNT;
  }

  it('首次全额退款：可退', () => {
    expect(canRefund([], ORDER_AMOUNT)).toBe(true);
  });

  it('已退 5000，再退 4900：可退（恰好等于总额）', () => {
    const refunds: RefundLike[] = [{ amount: 5000, status: 'success' }];
    expect(canRefund(refunds, 4900)).toBe(true);
  });

  it('已退 5000，再退 4901：不可退（超出 1 分）', () => {
    const refunds: RefundLike[] = [{ amount: 5000, status: 'success' }];
    expect(canRefund(refunds, 4901)).toBe(false);
  });

  it('全额退款后再申请退款：不可退', () => {
    const refunds: RefundLike[] = [{ amount: ORDER_AMOUNT, status: 'success' }];
    expect(canRefund(refunds, 1)).toBe(false);
  });

  it('processing 中的退款计入锁定额，防止并发超退', () => {
    // 模拟：第一笔退款 processing 中，第二笔请求试图退剩余全额
    const refunds: RefundLike[] = [{ amount: 5000, status: 'processing' }];
    expect(canRefund(refunds, 5000)).toBe(false); // 5000 + 5000 > 9900
    expect(canRefund(refunds, 4900)).toBe(true);  // 5000 + 4900 = 9900 ≤ 9900
  });

  it('pending 审批中的退款计入锁定额，防止多笔待审批退款超退', () => {
    const refunds: RefundLike[] = [{ amount: 8000, status: 'pending' }];
    expect(canRefund(refunds, 2000)).toBe(false);
    expect(canRefund(refunds, 1900)).toBe(true);
  });

  it('failed 退款不影响可退余额（可重新申请）', () => {
    const refunds: RefundLike[] = [
      { amount: 9900, status: 'failed' }, // 失败的退款不占用
    ];
    expect(canRefund(refunds, ORDER_AMOUNT)).toBe(true);
  });
});
