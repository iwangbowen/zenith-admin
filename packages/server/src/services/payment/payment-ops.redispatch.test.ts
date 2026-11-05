import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ select: vi.fn(), retry: vi.fn(), wake: vi.fn(), currentUser: vi.fn() }));
vi.mock('../../db', () => ({ db: { select: mocks.select } }));
vi.mock('../../lib/context', () => ({ currentUser: mocks.currentUser }));
vi.mock('../../lib/tenant', () => ({ getTenantScopeId: vi.fn(() => undefined), optionalExactTenantCondition: vi.fn(), tenantCondition: vi.fn() }));
vi.mock('../../lib/domain-events', () => ({ retryEventConsumer: mocks.retry, wakeEventConsumers: mocks.wake }));
vi.mock('./payment-events.service', () => ({ getPaymentEventHealth: vi.fn() }));
vi.mock('./payment.service', () => ({ buildAdapterContext: vi.fn(), handleNotify: vi.fn(), mapOrder: vi.fn(), loadOrderConfig: vi.fn() }));

import { redispatchEvent } from './payment-ops.service';

function row(status: string) {
  return { delivery: { id: 9, eventId: 1, consumerKey: 'payment.local-settlement', orderingKey: 'payment:PO-9', after: [], lane: 'business',
    status, attempts: 5, maxAttempts: 5, generation: 1, leaseToken: null, leaseUntil: null, runAt: new Date(), checkpoint: {}, result: null,
    lastError: status === 'dead' ? 'failed' : null, finishedAt: status === 'dead' ? new Date() : null },
  event: { id: 1, eventId: '00000000-0000-4000-8000-000000000009', domain: 'payment', eventType: 'payment.succeeded', schemaVersion: 1,
    tenantId: null, businessKey: 'event-9', orderingKey: 'payment:PO-9', subjectRefs: [], scope: {}, payload: { orderNo: 'PO-9' },
    payloadHash: 'x', occurredAt: new Date(), correlationId: null, parentRef: null } };
}

function selectChain(rows: unknown[]) {
  const chain = { from: vi.fn(), innerJoin: vi.fn(), where: vi.fn(), limit: vi.fn() };
  chain.from.mockReturnValue(chain); chain.innerJoin.mockReturnValue(chain); chain.where.mockReturnValue(chain); chain.limit.mockResolvedValue(rows);
  return chain;
}

beforeEach(() => { vi.clearAllMocks(); mocks.currentUser.mockReturnValue({ userId: 1, tenantId: null, roles: ['super_admin'] }); mocks.retry.mockResolvedValue(true); mocks.wake.mockResolvedValue(undefined); });

describe('redispatchEvent', () => {
  it('requeues only the selected failed consumer and wakes the shared ledger', async () => {
    mocks.select.mockReturnValueOnce(selectChain([row('dead')])).mockReturnValueOnce(selectChain([row('pending')]));
    const result = await redispatchEvent(9);
    expect(mocks.retry).toHaveBeenCalledWith(9);
    expect(mocks.wake).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ id: 9, consumerKey: 'payment.local-settlement', status: 'pending' });
  });

  it('rejects retry of a successful consumer', async () => {
    mocks.select.mockReturnValueOnce(selectChain([row('succeeded')]));
    mocks.retry.mockResolvedValue(false);
    await expect(redispatchEvent(9)).rejects.toMatchObject({ status: 409 });
    expect(mocks.wake).not.toHaveBeenCalled();
  });
});
