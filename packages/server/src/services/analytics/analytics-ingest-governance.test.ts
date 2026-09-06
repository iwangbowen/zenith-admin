import { beforeEach, describe, expect, it, vi } from 'vitest';

const { transaction, txInsert, txUpdate, touchEventMeta, evaluateEvents, recordSchemaIssues } = vi.hoisted(() => ({
  transaction: vi.fn(),
  txInsert: vi.fn(),
  txUpdate: vi.fn(),
  touchEventMeta: vi.fn(async () => undefined),
  evaluateEvents: vi.fn(),
  recordSchemaIssues: vi.fn(async () => undefined),
}));

vi.mock('../../db', () => ({
  db: { transaction },
}));

vi.mock('../../lib/context', () => ({
  currentUserOrNull: () => ({ userId: 42, username: 'alice', roles: ['user'], tenantId: 11 }),
  currentUser: () => ({ userId: 42, username: 'alice', roles: ['user'], tenantId: 11 }),
}));

vi.mock('../../lib/member-context', () => ({
  currentMemberOrNull: () => undefined,
}));

vi.mock('../../lib/tenant', async () => {
  const { eq, isNull } = await import('drizzle-orm');
  return {
    getCreateTenantId: () => 11,
    tenantScope: () => undefined,
    getEffectiveTenantId: () => 11,
    isPlatformAdmin: () => false,
    exactTenantCondition: (column: Parameters<typeof eq>[0], tenantId: number | null) => (tenantId == null ? isNull(column) : eq(column, tenantId)),
  };
});

vi.mock('../../lib/analytics-helpers', () => ({
  parseClientEnv: () => ({ browser: 'Chrome', browserVersion: '1', os: 'Windows', osVersion: '1', deviceType: 'desktop' }),
  lookupIpGeo: () => ({ country: '中国', region: '北京', city: '北京' }),
  anonymizeIpAddr: (ip: string) => ip,
  clampDays: (_value: unknown, fallback: number) => fallback,
  clampLimit: (_value: unknown, fallback: number) => fallback,
  startOfDaysAgo: () => new Date(),
  resolveIngestPlatformFields: (
    input: { source?: string; appId?: string; environment?: string },
    identity: { hasAdmin: boolean; hasMember: boolean },
  ) => ({
    source: identity.hasMember ? 'web_member' : identity.hasAdmin ? 'web_admin' : (input.source === 'web_member' ? 'web_member' : 'web_admin'),
    appId: input.appId ?? (identity.hasMember ? 'member' : 'admin'),
    environment: input.environment ?? 'production',
  }),
}));

vi.mock('./analytics-event-meta.service', () => ({ touchEventMeta }));
vi.mock('./analytics-governance.service', () => ({ evaluateEvents, recordSchemaIssues }));
vi.mock('./analytics-settings.service', () => ({ getIngestPolicy: async () => ({ anonymizeIp: false }) }));
vi.mock('../../lib/ws-manager', () => ({ broadcast: vi.fn() }));

import { batchInsertEvents } from './analytics.service';

describe('batchInsertEvents — governance integration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    transaction.mockImplementation(async (callback: (tx: { insert: typeof txInsert; update: typeof txUpdate }) => Promise<unknown>) =>
      callback({ insert: txInsert, update: txUpdate }));
  });

  it('never opens a DB transaction when governance rejects every event', async () => {
    evaluateEvents.mockResolvedValue({ accepted: [], pendingSchemaIssues: [] });
    await batchInsertEvents([{
      eventId: 'evt-blocked', sessionId: 'session-1', eventType: 'custom', pagePath: '/', eventName: 'bad_event',
    }], { ip: '127.0.0.1', ua: 'test' });
    expect(transaction).not.toHaveBeenCalled();
    expect(touchEventMeta).not.toHaveBeenCalled();
  });

  it('records schema-issue quality counts only for events that are freshly inserted (fresh-gated, avoids double counting replays)', async () => {
    const freshEvent = { eventId: 'evt-fresh', sessionId: 's1', eventType: 'custom', pagePath: '/', eventName: 'order_submit', properties: {} };
    const dupEvent = { eventId: 'evt-dup', sessionId: 's2', eventType: 'custom', pagePath: '/', eventName: 'order_submit', properties: {} };
    evaluateEvents.mockResolvedValue({
      accepted: [freshEvent, dupEvent],
      pendingSchemaIssues: [
        { event: freshEvent, tenantId: 11, issues: [{ key: 'amount', issueType: 'missing_required', expected: 'number', actualType: 'undefined' }] },
        { event: dupEvent, tenantId: 11, issues: [{ key: 'amount', issueType: 'missing_required', expected: 'number', actualType: 'undefined' }] },
      ],
    });
    txInsert
      .mockReturnValueOnce({
        values: () => ({
          onConflictDoNothing: () => ({
            // Only the "fresh" event survives onConflictDoNothing; the duplicate is filtered out by the DB
            returning: async () => [{ eventId: 'evt-fresh' }],
          }),
        }),
      })
      .mockReturnValueOnce({ values: () => ({ onConflictDoUpdate: async () => undefined }) })
      .mockReturnValueOnce({ values: () => ({ onConflictDoNothing: async () => undefined }) });
    txUpdate.mockReturnValue({ set: () => ({ where: async () => undefined }) });

    await batchInsertEvents([freshEvent, dupEvent], { ip: '127.0.0.1', ua: 'test' });

    expect(recordSchemaIssues).toHaveBeenCalledTimes(1);
    expect(recordSchemaIssues).toHaveBeenCalledWith(11, 'order_submit', expect.arrayContaining([expect.objectContaining({ key: 'amount' })]));
    expect(touchEventMeta).toHaveBeenCalledTimes(1);
  });

  it('degrades gracefully (accepts all events) when evaluateEvents itself throws', async () => {
    evaluateEvents.mockRejectedValue(new Error('governance cache down'));
    txInsert
      .mockReturnValueOnce({ values: () => ({ onConflictDoNothing: () => ({ returning: async () => [{ eventId: 'evt-x' }] }) }) })
      .mockReturnValueOnce({ values: () => ({ onConflictDoUpdate: async () => undefined }) })
      .mockReturnValueOnce({ values: () => ({ onConflictDoNothing: async () => undefined }) });
    txUpdate.mockReturnValue({ set: () => ({ where: async () => undefined }) });

    await batchInsertEvents([{
      eventId: 'evt-x', sessionId: 's1', eventType: 'custom', pagePath: '/',
    }], { ip: '127.0.0.1', ua: 'test' });

    expect(transaction).toHaveBeenCalledTimes(1);
  });
});
