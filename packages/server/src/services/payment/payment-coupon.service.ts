/**
 * 支付立减（会员券）Service。
 *
 * 生命周期与支付订单严格对齐，防双花/防丢券：
 * 下单锁券（unused→frozen 原子条件更新）→ 支付成功核销（frozen→used，事件订阅者幂等）
 * → 订单关闭/支付失败释放（frozen→unused）。事件由 outbox 可靠投递，崩溃后补投。
 * 券规则：amount 满减券按面值立减；percent 折扣券按折扣计算并受 maxDiscount 封顶；
 * 实付至少 1 分（渠道不支持 0 元单）。
 */
import { and, eq, gt, isNull, or } from 'drizzle-orm';
import { HTTPException } from 'hono/http-exception';
import { db } from '../../db';
import { memberCoupons, paymentOrders } from '../../db/schema';
import { paymentEventBus } from '../../lib/payment-event-bus';
import logger from '../../lib/logger';

export interface CouponLockResult {
  memberCouponId: number;
  /** 立减金额（分） */
  discount: number;
  couponName: string;
}

/** 计算券的立减金额（订单金额为优惠前原价） */
function calcDiscount(coupon: { type: string; faceValue: number; maxDiscount: number | null }, orderAmount: number): number {
  let discount: number;
  if (coupon.type === 'amount') {
    discount = coupon.faceValue;
  } else {
    // percent：faceValue=90 表示 9 折，立减 10%
    discount = Math.floor((orderAmount * (100 - coupon.faceValue)) / 100);
    if (coupon.maxDiscount != null) discount = Math.min(discount, coupon.maxDiscount);
  }
  // 实付至少 1 分
  return Math.max(0, Math.min(discount, orderAmount - 1));
}

/**
 * 下单锁券：校验归属/状态/门槛后原子冻结（unused→frozen），并发下单同一张券仅一单成功。
 * 返回立减金额；任何校验失败抛 HTTPException（此时券未被冻结）。
 */
export async function lockCouponForPayment(memberCouponId: number, expectedMemberId: number, orderAmount: number): Promise<CouponLockResult> {
  const row = await db.query.memberCoupons.findFirst({
    where: eq(memberCoupons.id, memberCouponId),
    with: { coupon: true },
  });
  if (!row || row.memberId !== expectedMemberId) throw new HTTPException(404, { message: '优惠券不存在' });
  if (row.status !== 'unused') throw new HTTPException(400, { message: '优惠券不可用（已使用/已冻结/已过期）' });
  const now = new Date();
  if (row.expireAt && row.expireAt <= now) throw new HTTPException(400, { message: '优惠券已过期' });
  const coupon = row.coupon;
  if (!coupon) throw new HTTPException(400, { message: '优惠券模板不存在' });
  if (orderAmount < coupon.threshold) {
    throw new HTTPException(400, { message: `未达到用券门槛（满 ${(coupon.threshold / 100).toFixed(2)} 元可用）` });
  }
  const discount = calcDiscount(coupon, orderAmount);
  if (discount <= 0) throw new HTTPException(400, { message: '该券对当前金额无优惠' });

  const [locked] = await db
    .update(memberCoupons)
    .set({ status: 'frozen' })
    .where(and(
      eq(memberCoupons.id, memberCouponId),
      eq(memberCoupons.status, 'unused'),
      or(isNull(memberCoupons.expireAt), gt(memberCoupons.expireAt, now)),
    ))
    .returning({ id: memberCoupons.id });
  if (!locked) throw new HTTPException(400, { message: '优惠券已被其他订单占用，请刷新后重试' });
  return { memberCouponId, discount, couponName: coupon.name };
}

/** 释放锁定的券（frozen→unused；下单落库失败/订单关闭/支付失败时调用，幂等） */
export async function releaseCouponForPayment(memberCouponId: number): Promise<void> {
  await db
    .update(memberCoupons)
    .set({ status: 'unused' })
    .where(and(eq(memberCoupons.id, memberCouponId), eq(memberCoupons.status, 'frozen')));
}

/** 支付成功核销（frozen→used，记录核销订单号；重投幂等：已 used 直接跳过） */
export async function redeemCouponForPayment(memberCouponId: number, orderNo: string): Promise<void> {
  await db
    .update(memberCoupons)
    .set({ status: 'used', usedAt: new Date(), bizType: 'payment', bizId: orderNo })
    .where(and(eq(memberCoupons.id, memberCouponId), eq(memberCoupons.status, 'frozen')));
}

async function couponIdOfOrder(orderNo: string): Promise<number | null> {
  const [order] = await db
    .select({ memberCouponId: paymentOrders.memberCouponId })
    .from(paymentOrders)
    .where(eq(paymentOrders.orderNo, orderNo))
    .limit(1);
  return order?.memberCouponId ?? null;
}

let registered = false;

/** 订阅支付结果事件，驱动券的核销/释放（幂等，注册一次） */
export function registerCouponPaymentSubscribers(): void {
  if (registered) return;
  registered = true;
  paymentEventBus.on('payment.succeeded', async (e) => {
    const couponId = await couponIdOfOrder(e.orderNo);
    if (couponId == null) return;
    await redeemCouponForPayment(couponId, e.orderNo);
    logger.info('[payment-coupon] coupon redeemed', { orderNo: e.orderNo, memberCouponId: couponId });
  });
  const release = async (orderNo: string) => {
    const couponId = await couponIdOfOrder(orderNo);
    if (couponId == null) return;
    await releaseCouponForPayment(couponId);
    logger.info('[payment-coupon] coupon released', { orderNo, memberCouponId: couponId });
  };
  paymentEventBus.on('payment.closed', (e) => release(e.orderNo));
  paymentEventBus.on('payment.failed', (e) => release(e.orderNo));
  logger.info('Payment coupon subscribers registered');
}
