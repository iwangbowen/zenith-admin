/**
 * 支付领域事件载荷类型。
 *
 * 支付事实由 payment-outbox.service 在业务事务内写入共享领域事件账本（event_outbox），
 * 由 payment-event-consumers 注册的持久化消费者按 at-least-once 语义投递。
 */
import type { PaymentChannel, PaymentMethod } from '@zenith/shared/payment';
import type { SubjectRef } from '@zenith/shared/core';

export type PaymentEventType =
  | 'payment.succeeded'
  | 'payment.closed'
  | 'payment.failed'
  | 'refund.succeeded'
  | 'refund.failed';

export interface PaymentEvent {
  eventId: string;
  type: PaymentEventType;
  occurredAt: string;
  orderNo: string;
  outTradeNo: string;
  bizType: string;
  bizId: string;
  channel: PaymentChannel;
  channelConfigId: number;
  payMethod?: PaymentMethod;
  appId?: number | null;
  currency: string;
  amount: number;
  originalAmount?: number | null;
  /** 退款事件时为退款单号 */
  refundNo?: string;
  refundAmount?: number;
  userId?: number | null;
  tenantId?: number | null;
  /** Stable business identities persisted by the payment outbox, independent of trace IDs. */
  subjectRefs?: readonly SubjectRef[];
}
