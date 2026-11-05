import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ publish: vi.fn(), timeline: vi.fn() }));
vi.mock('../../lib/domain-events', () => ({ publishEventInTx: mocks.publish }));
vi.mock('../platform/relations/events.service', () => ({ recordDomainEvent: mocks.timeline }));
vi.mock('../../lib/context', () => ({ currentCorrelationId: vi.fn(), currentParentRef: vi.fn() }));

import { recordEvent } from './payment-outbox.service';

const payload = { type: 'payment.succeeded' as const, orderNo: 'PO-1', outTradeNo: 'OUT-1', bizType: 'demo', bizId: '1',
  channel: 'wechat' as const, channelConfigId: 3, currency: 'CNY', amount: 100, tenantId: 2,
  subjectRefs: [{ type: 'payment.order', key: '1', role: 'primary' as const }] };

beforeEach(() => { vi.clearAllMocks(); mocks.publish.mockResolvedValue({}); mocks.timeline.mockResolvedValue(undefined); });

describe('payment event publication', () => {
  it('writes only the shared domain-event ledger in the caller transaction', async () => {
    const tx = {} as never;
    const eventId = await recordEvent(tx, { type: 'payment.succeeded', orderNo: 'PO-1', tenantId: 2, payload });
    expect(eventId).toMatch(/^[0-9a-f-]{36}$/);
    expect(mocks.publish).toHaveBeenCalledWith(tx, expect.objectContaining({ domain: 'payment', eventId, businessKey: eventId, orderingKey: 'payment:PO-1' }));
    expect(mocks.timeline).toHaveBeenCalledWith(tx, expect.objectContaining({ dedupeKey: `payment:${eventId}` }));
  });

  it('rejects a missing business identity before publication', async () => {
    await expect(recordEvent({} as never, { type: 'payment.succeeded', orderNo: 'PO-1', tenantId: 2,
      payload: { ...payload, subjectRefs: [] } })).rejects.toThrow('explicit business subjects');
    expect(mocks.publish).not.toHaveBeenCalled();
  });
});
