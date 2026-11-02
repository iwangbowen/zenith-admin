import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PaymentEvent } from '../../lib/payment-event-bus';
import type { WorkflowEvent } from '@zenith/shared/workflow';

const { registerEvent, registerWorkflow, rememberEffect, trackServerEvent } = vi.hoisted(() => ({
  registerEvent: vi.fn(), registerWorkflow: vi.fn(), rememberEffect: vi.fn(), trackServerEvent: vi.fn(),
}));
vi.mock('../../lib/domain-events', () => ({ registerEventConsumer: registerEvent }));
vi.mock('../../lib/workflow-event-consumer', () => ({ registerWorkflowEventConsumer: registerWorkflow }));
vi.mock('../../lib/transaction-effects', () => ({ rememberTransactionEffect: rememberEffect }));
vi.mock('./analytics-server-events.service', () => ({ trackServerEvent }));

import { __resetAnalyticsServerEventSubscribersForTest, registerAnalyticsServerEventSubscribers } from './analytics-server-event-subscribers';

function makePaymentEvent(overrides: Partial<PaymentEvent> = {}): PaymentEvent {
  return { eventId: 'pay-evt-1', type: 'payment.succeeded', occurredAt: '2026-07-05 10:00:00', orderNo: 'SO-1001',
    outTradeNo: 'OUT-SECRET-1001', bizType: 'member_recharge', bizId: 'RC-1', channel: 'wechat', channelConfigId: 3,
    currency: 'CNY', amount: 1000, userId: 5, tenantId: 3, ...overrides } as PaymentEvent;
}

function makeWorkflowEvent(overrides: Partial<WorkflowEvent> = {}): WorkflowEvent {
  return { eventId: 'wf-evt-1', type: 'instance.created', occurredAt: '2026-07-05 11:00:00', instanceId: 100,
    definitionId: 10, tenantId: 7, actor: { userId: 1, name: '张三' },
    instance: { id: 100, status: 'pending', initiatorId: 2, formData: { secret: 'should-not-leak' } },
    ...overrides } as unknown as WorkflowEvent;
}

beforeEach(() => {
  vi.clearAllMocks();
  __resetAnalyticsServerEventSubscribersForTest();
  rememberEffect.mockImplementation((_tx, _key, effect: () => Promise<unknown>) => effect());
});

describe('durable analytics event consumers', () => {
  it('registers payment and workflow analytics once in the analytics lane', () => {
    registerAnalyticsServerEventSubscribers();
    registerAnalyticsServerEventSubscribers();
    expect(registerEvent).toHaveBeenCalledTimes(1);
    expect(registerEvent.mock.calls[0][0]).toMatchObject({ key: 'payment.analytics', lane: 'analytics', after: ['payment.local-settlement'] });
    expect(registerWorkflow).toHaveBeenCalledTimes(1);
    expect(registerWorkflow.mock.calls[0][3]).toEqual({ lane: 'analytics' });
  });

  it('maps payment facts after the receipt transaction commits without leaking provider ids', async () => {
    registerAnalyticsServerEventSubscribers();
    const event = makePaymentEvent({ type: 'refund.succeeded', refundNo: 'RF-1', refundAmount: 500 });
    await registerEvent.mock.calls[0][0].handle({}, { eventId: event.eventId, occurredAt: new Date('2026-07-05T02:00:00Z'), payload: event });
    expect(rememberEffect).toHaveBeenCalledWith(expect.anything(), 'payment-analytics:pay-evt-1', expect.any(Function));
    expect(trackServerEvent).toHaveBeenCalledWith(expect.objectContaining({
      eventName: 'refund.succeeded', eventId: 'pay-evt-1', tenantId: 3, userId: 5,
      properties: { orderNo: 'SO-1001', bizType: 'member_recharge', bizId: 'RC-1', channel: 'wechat', amount: 1000, refundNo: 'RF-1', refundAmount: 500 },
    }));
    expect(trackServerEvent.mock.calls[0][0].properties).not.toHaveProperty('outTradeNo');
  });

  it('maps workflow facts through a post-commit hint with actor precedence', async () => {
    registerAnalyticsServerEventSubscribers();
    const event = makeWorkflowEvent();
    await registerWorkflow.mock.calls[0][2]({}, event);
    expect(rememberEffect).toHaveBeenCalledWith(expect.anything(), 'workflow-analytics:wf-evt-1', expect.any(Function));
    expect(trackServerEvent).toHaveBeenCalledWith(expect.objectContaining({
      eventName: 'workflow.instance.created', userId: 1, displayName: '张三',
      properties: { instanceId: 100, definitionId: 10, status: 'pending' },
    }));
  });
});
