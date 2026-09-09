import type { PaymentOrderRow } from '../../db/schema';
import type { PaymentEvent, PaymentEventType } from '../../lib/payment-event-bus';

/**
 * 由订单行构造支付事件载荷（outbox 持久化与事件总线派发共用的唯一形态）。
 * 支付成功 / 失败 / 关单与退款事件均经此构造，保证订阅方（Webhook、行为分析、业务桥接）拿到一致的字段集。
 */
export function buildPaymentEventPayload(
  type: PaymentEventType,
  order: PaymentOrderRow,
  extra?: { refundNo?: string; refundAmount?: number },
): Omit<PaymentEvent, 'eventId' | 'occurredAt'> {
  return {
    type,
    orderNo: order.orderNo,
    outTradeNo: order.outTradeNo,
    bizType: order.bizType,
    bizId: order.bizId,
    channel: order.channel,
    channelConfigId: order.channelConfigId,
    payMethod: order.payMethod,
    appId: order.appId,
    currency: order.currency,
    amount: order.paidAmount ?? order.amount,
    originalAmount: order.originalAmount ?? null,
    userId: order.userId,
    tenantId: order.tenantId,
    refundNo: extra?.refundNo,
    refundAmount: extra?.refundAmount,
  };
}
