import { beforeEach, describe, expect, it, vi } from 'vitest';

const { select, count } = vi.hoisted(() => ({
  select: vi.fn(),
  count: vi.fn(async () => 0),
}));

vi.mock('../../db', () => ({
  db: { select, $count: count },
}));

vi.mock('../../config', () => ({
  config: { multiTenantMode: true },
}));

let effectiveTenantId: number | null = 7;
let platformAdmin = false;
vi.mock('../../lib/tenant', () => ({
  getEffectiveTenantId: () => effectiveTenantId,
  isPlatformAdmin: () => platformAdmin,
  tenantScope: () => (effectiveTenantId === null && platformAdmin ? undefined : { __tenantScopeFor: effectiveTenantId }),
}));

vi.mock('../../lib/context', () => ({
  currentUser: () => ({ userId: 1, tenantId: effectiveTenantId, roles: ['user'] }),
}));

import { analyticsDebugEventsQuery } from '@zenith/shared/analytics';
import { listDebugEvents, qualityTenantScope, queryQuality } from './analytics-quality.service';

describe('qualityTenantScope — tenant safety aligned with rollupTenantScope semantics', () => {
  beforeEach(() => {
    effectiveTenantId = 7;
    platformAdmin = false;
  });

  it('scopes to the effective tenant (0-sentinel for null) for a regular tenant user', () => {
    effectiveTenantId = 7;
    expect(qualityTenantScope()).toBeTruthy();
  });

  it('returns undefined (no filter → cross-tenant aggregate) for a platform admin with no viewing tenant selected', () => {
    platformAdmin = true;
    effectiveTenantId = null;
    expect(qualityTenantScope()).toBeUndefined();
  });
});

describe('queryQuality', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    effectiveTenantId = 7;
    platformAdmin = false;
  });

  it('runs items/totalCount/totals in parallel and maps rows to the DTO shape', async () => {
    const itemRow = {
      id: 1, tenantId: 7, statDate: '2026-01-01', eventName: 'checkout', issueType: 'missing_required',
      count: 3, sample: { issues: [{ key: 'amount', expected: 'number', actualType: 'undefined' }] },
      lastSeenAt: new Date('2026-01-01T00:00:00Z'), createdAt: new Date('2026-01-01T00:00:00Z'), updatedAt: new Date('2026-01-01T00:00:00Z'),
    };
    let selectCall = 0;
    select.mockImplementation(() => {
      selectCall += 1;
      if (selectCall === 1) {
        // items query
        return { from: () => ({ where: () => ({ orderBy: () => ({ limit: () => ({ offset: async () => [itemRow] }) }) }) }) };
      }
      // totals groupBy query
      return { from: () => ({ where: () => ({ groupBy: async () => [{ issueType: 'missing_required', count: 3 }] }) }) };
    });
    count.mockResolvedValue(1);

    const result = await queryQuality({ days: 7 });
    expect(result.totalCount).toBe(1);
    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({ eventName: 'checkout', issueType: 'missing_required', count: 3 });
    expect(result.totals).toEqual([{ issueType: 'missing_required', count: 3 }]);
  });
});

describe('listDebugEvents', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    effectiveTenantId = 7;
    platformAdmin = false;
  });

  it('pageSize 上限由契约 analyticsDebugEventsQuery 守住（≤200），服务层按解析值原样下发 limit', async () => {
    expect(analyticsDebugEventsQuery.safeParse({ pageSize: 500 }).success).toBe(false);
    select.mockReturnValue({ from: () => ({ where: () => ({ orderBy: () => ({ limit: (n: number) => { expect(n).toBe(200); return { offset: () => Promise.resolve([]) }; } }) }) }) });
    count.mockResolvedValue(0);
    await listDebugEvents(analyticsDebugEventsQuery.parse({ pageSize: '200' }));
  });

  it('attaches deduplicated same-day issueTypes for each returned event by eventName', async () => {
    const eventRow = {
      id: 1, eventId: 'evt-1', eventType: 'custom', eventName: 'checkout', source: 'web_admin', appId: 'admin',
      environment: 'production', distinctId: 'u:1', memberId: null, userId: 1, pagePath: '/checkout',
      properties: { amount: 10 }, createdAt: new Date('2026-01-01T00:00:00Z'),
    };
    let selectCall = 0;
    select.mockImplementation(() => {
      selectCall += 1;
      if (selectCall === 1) {
        return { from: () => ({ where: () => ({ orderBy: () => ({ limit: () => ({ offset: async () => [eventRow] }) }) }) }) };
      }
      return {
        from: () => ({
          where: async () => [
            { eventName: 'checkout', issueType: 'missing_required' },
            { eventName: 'checkout', issueType: 'missing_required' }, // duplicate — should be deduped
            { eventName: 'checkout', issueType: 'invalid_enum' },
          ],
        }),
      };
    });
    count.mockResolvedValue(1);

    const result = await listDebugEvents({});
    expect(result.total).toBe(1);
    const [debugEvent] = result.list;
    expect(debugEvent.issueTypes.sort()).toEqual(['invalid_enum', 'missing_required']);
    expect(debugEvent.properties).toEqual({ amount: 10 });
  });
});
