import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ health: vi.fn(), select: vi.fn(), count: vi.fn(), scope: vi.fn(), user: vi.fn() }));
vi.mock('../../db', () => ({ db: { select: mocks.select, $count: mocks.count } }));
vi.mock('./payment-events.service', () => ({ getPaymentEventHealth: mocks.health }));
vi.mock('../../lib/context', () => ({ currentUser: mocks.user }));
vi.mock('../../lib/tenant', () => ({ getTenantScopeId: mocks.scope, tenantCondition: vi.fn() }));
vi.mock('./payment.service', () => ({ buildAdapterContext: vi.fn(), handleNotify: vi.fn(), mapOrder: vi.fn(), loadOrderConfig: vi.fn() }));
vi.mock('./payment-outbox.service', () => ({ processEvent: vi.fn() }));
import { getPaymentAlertMetrics } from './payment-alert-metrics.service';
import { getPaymentHealth } from './payment-ops.service';

beforeEach(() => {
  vi.resetAllMocks();
  const builder: Record<string, unknown> = {};
  for (const method of ['from', 'innerJoin', 'where']) builder[method] = () => builder;
  mocks.select.mockReturnValue(builder);
  mocks.count.mockResolvedValue(0);
  mocks.health.mockResolvedValue({ counts: { pending: 8, running: 0, stuck: 3, dead: 2, failed24h: 1, succeeded24h: 20 }, oldestPendingAgeSec: 600, issues: [] });
  mocks.user.mockReturnValue({ userId: 1, tenantId: 12, roles: [] });
});

describe('payment event health reuse', () => {
  it.each([null, 12])('retains alert scope and backlog semantics for tenant %s', async tenantId => {
    const result = await getPaymentAlertMetrics(tenantId);
    expect(mocks.health).toHaveBeenCalledWith(tenantId ?? undefined);
    expect(result.paymentEventBacklog).toBe(5);
  });
  it.each([undefined, null, 12])('retains the exact operational scope %s without expanding null to all tenants', async scope => {
    mocks.scope.mockReturnValue(scope);
    const result = await getPaymentHealth();
    expect(mocks.scope).toHaveBeenCalledWith(mocks.user.mock.results[0].value);
    expect(mocks.health).toHaveBeenCalledWith(scope);
    expect(result).toMatchObject({ outboxPending: 8, outboxFailed: 2 });
  });
});
