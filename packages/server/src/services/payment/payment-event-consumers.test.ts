import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PaymentEvent } from '../../lib/payment-event-bus';

const { register, settle, prepareWebhook, prepareSharing, rememberEffect, sendToUser } = vi.hoisted(() => ({
  register: vi.fn(), settle: vi.fn(), prepareWebhook: vi.fn(), prepareSharing: vi.fn(), rememberEffect: vi.fn(), sendToUser: vi.fn(),
}));
vi.mock('../../lib/domain-events', () => ({ registerEventConsumer: register }));
vi.mock('./payment-local-settlement.service', () => ({ settlePaymentEventWithin: settle }));
vi.mock('./payment-open-webhook-bridge.service', () => ({ preparePaymentOpenWebhookWithin: prepareWebhook }));
vi.mock('./payment-sharing.service', () => ({ prepareAutomaticSharingWithin: prepareSharing }));
vi.mock('../../lib/transaction-effects', () => ({ rememberTransactionEffect: rememberEffect }));
vi.mock('../../lib/ws-manager', () => ({ sendToUser }));

import { __resetPaymentEventConsumersForTest, registerPaymentEventConsumers } from './payment-event-consumers';

const event: PaymentEvent = { eventId: 'e1', type: 'payment.succeeded', occurredAt: '2026-11-02 10:00:00', orderNo: 'PO-1',
  outTradeNo: 'OUT-1', bizType: 'demo', bizId: '1', channel: 'wechat', channelConfigId: 3, currency: 'CNY', amount: 100,
  userId: 9, tenantId: 2 };

beforeEach(() => { vi.clearAllMocks(); __resetPaymentEventConsumersForTest(); });

describe('payment durable consumers', () => {
  it('registers local settlement before WS, webhook and sharing handoffs', () => {
    registerPaymentEventConsumers();
    const registrations = register.mock.calls.map(([value]) => value);
    expect(registrations.map((item) => item.key)).toEqual(['payment.local-settlement', 'payment.ws', 'payment.open-webhook', 'payment.sharing.prepare']);
    expect(registrations.find((item) => item.key === 'payment.ws').after).toEqual(['payment.local-settlement']);
  });

  it('schedules the user websocket hint only after the receipt transaction commits', async () => {
    registerPaymentEventConsumers();
    const ws = register.mock.calls.map(([value]) => value).find((item) => item.key === 'payment.ws');
    const result = await ws.handle({}, { eventId: event.eventId, occurredAt: new Date('2026-11-02T02:00:00Z'), payload: event });
    expect(result).toEqual({ outcome: 'completed' });
    expect(rememberEffect).toHaveBeenCalledWith(expect.anything(), 'payment-ws:e1:9', expect.any(Function));
    expect(sendToUser).not.toHaveBeenCalled();
    await rememberEffect.mock.calls[0][2]();
    expect(sendToUser).toHaveBeenCalledWith(9, { type: 'payment:success', payload: { orderNo: 'PO-1', bizType: 'demo', bizId: '1', amount: 100 } });
  });
});
