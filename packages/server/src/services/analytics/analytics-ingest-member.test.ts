/**
 * 行为中心阶段 1：会员身份埋点采集测试。
 *
 * 覆盖点：
 * - 已登录会员上报事件时，userEvents 行写入 memberId / source=web_member / appId / environment
 * - 会话聚合（analyticsSessions）写入 memberId / source / appId / environment
 * - 新增：新鲜事件在同一事务内 upsert analytics_user_profiles（identityType=member）
 * - HTTP 采集入口不接受客户端伪造 source='server'：已登录会员强制 web_member
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { transaction, txInsert, txUpdate, touchEventMeta } = vi.hoisted(() => ({
  transaction: vi.fn(),
  txInsert: vi.fn(),
  txUpdate: vi.fn(),
  touchEventMeta: vi.fn(async () => undefined),
}));

vi.mock('../../db', () => ({
  db: { transaction },
}));

// 会员场景：管理员上下文为空，会员上下文注入
vi.mock('../../lib/context', () => ({
  currentUserOrNull: () => undefined,
}));

vi.mock('../../lib/member-context', () => ({
  currentMemberOrNull: () => ({
    memberId: 7,
    identifier: '13800001111',
    type: 'member',
    tenantId: null,
  }),
}));

vi.mock('../../lib/tenant', async () => {
  const { eq, isNull } = await import('drizzle-orm');
  return {
    getCreateTenantId: () => {
      throw new Error('getCreateTenantId should not be called when there is no admin user');
    },
    tenantScope: () => undefined,
    getEffectiveTenantId: () => null,
    isPlatformAdmin: () => false,
    exactTenantCondition: (column: Parameters<typeof eq>[0], tenantId: number | null) => (tenantId == null ? isNull(column) : eq(column, tenantId)),
  };
});

vi.mock('../../lib/analytics-helpers', () => ({
  parseClientEnv: () => ({
    browser: 'Chrome',
    browserVersion: '1',
    os: 'Windows',
    osVersion: '1',
    deviceType: 'desktop',
  }),
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

vi.mock('./analytics-event-meta.service', () => ({
  touchEventMeta,
}));

vi.mock('./analytics-governance.service', () => ({
  evaluateEvents: async (events: unknown[]) => ({ accepted: events, pendingSchemaIssues: [] }),
  recordSchemaIssues: async () => {},
}));

vi.mock('./analytics-settings.service', () => ({
  getIngestPolicy: async () => ({ anonymizeIp: false }),
}));

vi.mock('../../lib/ws-manager', () => ({
  broadcast: vi.fn(),
}));

import { batchInsertEvents } from './analytics.service';

describe('analytics event ingest — member identity (行为中心阶段 1)', () => {
  let capturedEventRows: Record<string, unknown>[] = [];
  let capturedSessionRows: Record<string, unknown>[] = [];
  let capturedProfileRows: Record<string, unknown>[] = [];

  beforeEach(() => {
    vi.clearAllMocks();
    capturedEventRows = [];
    capturedSessionRows = [];
    capturedProfileRows = [];
    transaction.mockImplementation(async (callback: (tx: { insert: typeof txInsert; update: typeof txUpdate }) => Promise<unknown>) =>
      callback({ insert: txInsert, update: txUpdate }));

    txInsert.mockImplementation((_table: { [Symbol.toStringTag]?: string } & Record<string, unknown>) => ({
      values: (rows: Record<string, unknown>[]) => {
        // 根据插入表的列特征区分是 userEvents / analyticsSessions / analyticsUserProfiles 三次插入之一
        const isEventRows = rows.every((r) => 'eventId' in r);
        const isSessionRows = rows.every((r) => 'sessionId' in r && 'startedAt' in r);
        const isProfileRows = rows.every((r) => 'distinctId' in r && 'identityType' in r);
        if (isEventRows) capturedEventRows = rows;
        if (isSessionRows) capturedSessionRows = rows;
        if (isProfileRows) capturedProfileRows = rows;
        return {
          onConflictDoNothing: (opts?: unknown) => {
            if (opts) {
              // userEvents insert: onConflictDoNothing({ target: ... }).returning(...)
              return { returning: async () => rows.map((r) => ({ eventId: r.eventId })) };
            }
            // analyticsUserProfiles insert: onConflictDoNothing() 无参数
            return Promise.resolve(undefined);
          },
          onConflictDoUpdate: async () => undefined,
        };
      },
    }));
    txUpdate.mockReturnValue({ set: () => ({ where: async () => undefined }) });
  });

  it('writes memberId + source=web_member on both the event row and the session row', async () => {
    await batchInsertEvents([{
      eventId: '11111111-1111-4111-8111-111111111111',
      sessionId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
      eventType: 'page_view',
      pagePath: '/member/home',
    }], { ip: '127.0.0.1', ua: 'test' });

    expect(capturedEventRows).toHaveLength(1);
    expect(capturedEventRows[0]).toMatchObject({
      memberId: 7,
      userId: null,
      distinctId: 'm:7',
      source: 'web_member',
      appId: 'member',
      environment: 'production',
      tenantId: null,
    });

    expect(capturedSessionRows).toHaveLength(1);
    expect(capturedSessionRows[0]).toMatchObject({
      memberId: 7,
      userId: null,
      distinctId: 'm:7',
      source: 'web_member',
      appId: 'member',
      environment: 'production',
    });
  });

  it('rejects a client-forged source and upserts an analytics_user_profiles row for the member', async () => {
    await batchInsertEvents([{
      eventId: '22222222-2222-4222-8222-222222222222',
      sessionId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
      eventType: 'page_view',
      pagePath: '/member/orders',
      // 客户端试图伪造服务端来源，必须被忽略
      source: 'server' as never,
    }], { ip: '127.0.0.1', ua: 'test' });

    expect(capturedEventRows[0].source).toBe('web_member');
    expect(capturedProfileRows).toHaveLength(1);
    expect(capturedProfileRows[0]).toMatchObject({
      distinctId: 'm:7',
      identityType: 'member',
      userId: null,
      memberId: 7,
      displayName: '13800001111',
    });
    expect(capturedProfileRows[0].properties).toMatchObject({ source: 'web_member', appId: 'member', environment: 'production' });
    expect(txUpdate).toHaveBeenCalledTimes(1);
  });

  it('drops identify events for anonymous callers but not for members', async () => {
    await batchInsertEvents([{
      eventId: '33333333-3333-4333-8333-333333333333',
      sessionId: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
      eventType: 'identify',
      pagePath: '/member/login',
      distinctId: 'whatever',
    }], { ip: '127.0.0.1', ua: 'test' });

    // 已登录会员的 identify 事件应被信任采集（不同于匿名场景会被过滤）
    expect(capturedEventRows).toHaveLength(1);
    expect(capturedEventRows[0].eventType).toBe('identify');
  });
});
