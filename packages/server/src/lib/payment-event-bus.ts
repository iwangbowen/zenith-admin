/**
 * 支付事件总线
 *
 * 进程内 pub-sub（照搬 workflow-event-bus 设计）。业务模块通过
 * `paymentEventBus.on('payment.succeeded', handler)` 订阅支付/退款结果，
 * 与支付中心解耦。emit 通过 queueMicrotask 异步隔离，任一 handler 抛错不影响其它。
 *
 * 用法：
 *   paymentEventBus.on('payment.succeeded', async (e) => { ... });
 *   paymentEventBus.emit({ type: 'payment.succeeded', orderNo, bizType, ... });
 */
import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import type { PaymentChannel, PaymentMethod } from '@zenith/shared/payment';
import type { SubjectRef } from '@zenith/shared/core';
import logger from './logger';
import { captureException } from './error-tracking/reporter';
import { formatDateTime } from './datetime';

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

type PaymentEventHandler = (event: PaymentEvent) => void | Promise<void>;

const ANY_CHANNEL = '__any__';

class PaymentEventBus {
  private readonly emitter = new EventEmitter();

  constructor() {
    this.emitter.setMaxListeners(50);
  }

  /** 订阅特定类型的事件 */
  on(type: PaymentEventType, handler: PaymentEventHandler): void {
    this.emitter.on(type, handler);
  }

  /** 订阅所有事件 */
  onAny(handler: PaymentEventHandler): void {
    this.emitter.on(ANY_CHANNEL, handler);
  }

  off(type: PaymentEventType | typeof ANY_CHANNEL, handler: PaymentEventHandler): void {
    this.emitter.off(type, handler);
  }

  /** 发射事件（异步隔离，不阻塞调用者） */
  emit(event: Omit<PaymentEvent, 'eventId' | 'occurredAt'> & { eventId?: string; occurredAt?: string }): void {
    const full: PaymentEvent = {
      ...event,
      eventId: event.eventId ?? randomUUID(),
      occurredAt: event.occurredAt ?? formatDateTime(new Date()),
    };

    queueMicrotask(() => {
      const handlers = [
        ...this.emitter.listeners(full.type),
        ...this.emitter.listeners(ANY_CHANNEL),
      ];
      for (const h of handlers) {
        try {
          const ret = (h as PaymentEventHandler)(full);
          if (ret instanceof Promise) {
            ret.catch((err) => {
              captureException(err, { kind: 'event_failure', job: { type: full.type, id: full.eventId, final: true } });
              logger.error('[payment-event-bus] async handler error', { type: full.type, err });
            });
          }
        } catch (err) {
          captureException(err, { kind: 'event_failure', job: { type: full.type, id: full.eventId, final: true } });
          logger.error('[payment-event-bus] sync handler error', { type: full.type, err });
        }
      }
    });
  }

  /** 同步等待所有 handler 执行完成（供 outbox 可靠投递使用，任一 handler 抛错会向上传播以触发重试）。 */
  async dispatch(event: Omit<PaymentEvent, 'eventId' | 'occurredAt'> & { eventId?: string; occurredAt?: string }): Promise<void> {
    const full: PaymentEvent = {
      ...event,
      eventId: event.eventId ?? randomUUID(),
      occurredAt: event.occurredAt ?? formatDateTime(new Date()),
    };
    const handlers = [
      ...this.emitter.listeners(full.type),
      ...this.emitter.listeners(ANY_CHANNEL),
    ];
    for (const h of handlers) {
      await (h as PaymentEventHandler)(full);
    }
  }
}

export const paymentEventBus = new PaymentEventBus();
