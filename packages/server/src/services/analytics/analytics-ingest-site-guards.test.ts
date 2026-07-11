import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  transaction,
  txInsert,
  txUpdate,
  touchEventMeta,
  evaluateEvents,
  recordQualityIssue,
  resolveSiteByKey,
  checkAndConsumeSiteQuota,
} = vi.hoisted(() => ({
  transaction: vi.fn(),
  txInsert: vi.fn(),
  txUpdate: vi.fn(),
  touchEventMeta: vi.fn(async () => undefined),
  evaluateEvents: vi.fn(),
  recordQualityIssue: vi.fn(async () => undefined),
  resolveSiteByKey: vi.fn(),
  checkAndConsumeSiteQuota: vi.fn(),
}));

vi.mock('../../db', () => ({
  db: { transaction },
}));

vi.mock('../../lib/context', () => ({
  currentUserOrNull: () => undefined,
  currentUser: () => undefined,
}));

vi.mock('../../lib/member-context', () => ({
  currentMemberOrNull: () => undefined,
}));

vi.mock('../../lib/tenant', () => ({
  getCreateTenantId: () => 11,
  tenantScope: () => undefined,
  getEffectiveTenantId: () => 11,
  isPlatformAdmin: () => false,
}));

vi.mock('../../lib/analytics-helpers', () => ({
  parseClientEnv: () => ({ browser: 'Chrome', browserVersion: '1', os: 'Windows', osVersion: '1', deviceType: 'desktop' }),
  lookupIpGeo: () => ({ country: '中国', region: '北京', city: '北京' }),
  anonymizeIpAddr: (ip: string) => ip,
  clampDays: (_value: unknown, fallback: number) => fallback,
  clampLimit: (_value: unknown, fallback: number) => fallback,
  startOfDaysAgo: () => new Date(),
  resolveIngestPlatformFields: (input: { source?: string; appId?: string; environment?: string }) => ({
    source: input.source === 'web_member' ? 'web_member' : 'web_admin',
    appId: input.appId ?? 'admin',
    environment: input.environment ?? 'production',
  }),
}));

vi.mock('./analytics-event-meta.service', () => ({ touchEventMeta }));
vi.mock('./analytics-settings.service', () => ({ getIngestPolicy: async () => ({ anonymizeIp: false }) }));
vi.mock('./analytics-governance.service', () => ({
  evaluateEvents,
  recordQualityIssue,
  recordSchemaIssues: vi.fn(async () => undefined),
}));
vi.mock('./analytics-sites.service', () => ({
  resolveSiteByKey,
  isSiteOriginAllowed: (origin: string | null | undefined, allowedOrigins: string[] | null | undefined) => {
    const whitelist = allowedOrigins?.map((value) => value.trim().replace(/\/+$/, '').toLowerCase()).filter(Boolean) ?? [];
    if (whitelist.length === 0) return true;
    if (!origin) return false;
    return whitelist.includes(origin.trim().replace(/\/+$/, '').toLowerCase());
  },
}));
vi.mock('./analytics-quota.service', () => ({ checkAndConsumeSiteQuota, refundSiteQuota: vi.fn(async () => undefined) }));
vi.mock('../../lib/ws-manager', () => ({ broadcast: vi.fn() }));

import { batchInsertEvents } from './analytics.service';

const event = {
  eventId: '0ec7ca87-c75a-42a2-b523-8f7f96a06f2a',
  sessionId: 's1',
  eventType: 'custom' as const,
  pagePath: '/',
  eventName: 'checkout',
};

describe('batchInsertEvents — site origin and quota guards', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resolveSiteByKey.mockResolvedValue({
      id: 7,
      tenantId: 11,
      appId: 'shop',
      status: 'enabled',
      allowedOrigins: ['https://allowed.example'],
      dailyEventQuota: 10,
    });
    evaluateEvents.mockResolvedValue({ accepted: [event], pendingSchemaIssues: [] });
    transaction.mockImplementation(async (callback: (tx: { insert: typeof txInsert; update: typeof txUpdate }) => Promise<unknown>) =>
      callback({ insert: txInsert, update: txUpdate }));
    txInsert
      .mockReturnValueOnce({ values: () => ({ onConflictDoNothing: () => ({ returning: async () => [{ eventId: event.eventId }] }) }) })
      .mockReturnValueOnce({ values: () => ({ onConflictDoUpdate: async () => undefined }) })
      .mockReturnValueOnce({ values: () => ({ onConflictDoNothing: async () => undefined }) });
    txUpdate.mockReturnValue({ set: () => ({ where: async () => undefined }) });
    checkAndConsumeSiteQuota.mockResolvedValue({ allowed: true, current: 1 });
  });

  it('silently rejects an anonymous site batch when Origin is not whitelisted', async () => {
    await batchInsertEvents([event], { ip: '127.0.0.1', ua: 'test', siteKey: 'zk_site', origin: 'https://evil.example/' });

    expect(transaction).not.toHaveBeenCalled();
    expect(evaluateEvents).not.toHaveBeenCalled();
    expect(recordQualityIssue).toHaveBeenCalledWith(11, 'checkout', 'origin_rejected');
  });

  it('silently rejects and records quota_exceeded when the fresh insert count exceeds daily site quota', async () => {
    checkAndConsumeSiteQuota.mockResolvedValue({ allowed: false, current: 10 });

    await batchInsertEvents([event], { ip: '127.0.0.1', ua: 'test', siteKey: 'zk_site', origin: 'https://allowed.example/' });

    expect(checkAndConsumeSiteQuota).toHaveBeenCalledWith(7, 10, 1);
    expect(recordQualityIssue).toHaveBeenCalledWith(11, 'checkout', 'quota_exceeded');
    expect(touchEventMeta).not.toHaveBeenCalled();
  });
});
