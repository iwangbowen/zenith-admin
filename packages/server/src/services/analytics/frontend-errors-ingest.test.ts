/**
 * 行为中心阶段 1：前端错误上报（reportError）身份归属测试。
 *
 * 覆盖点：
 * - 已登录管理员上报 → source=web_admin，userId 归属，memberId=null
 * - 已登录会员上报 → source=web_member，memberId 归属，userId=null，displayName 取 identifier
 * - 匿名上报 → 不接受客户端伪造 source='server'，默认回退 web_admin
 * - 错误指纹 tenant 隔离（tenantId 因子已在 computeErrorFingerprint 内置，这里只验证透传）
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { transaction, txInsert, evaluateAlertsForError, resolveSiteByKey, recordQualityIssue } = vi.hoisted(() => ({
  transaction: vi.fn(),
  txInsert: vi.fn(),
  evaluateAlertsForError: vi.fn(async () => undefined),
  resolveSiteByKey: vi.fn(),
  recordQualityIssue: vi.fn(async () => undefined),
}));

vi.mock('../../db', () => ({
  db: { transaction },
}));

let mockUser: { userId: number; username: string; roles: string[]; tenantId: number | null } | undefined;
let mockMember: { memberId: number; identifier: string; type: 'member'; tenantId: number | null } | undefined;

vi.mock('../../lib/context', () => ({
  currentUserOrNull: () => mockUser,
}));

vi.mock('../../lib/member-context', () => ({
  currentMemberOrNull: () => mockMember,
}));

vi.mock('../../lib/tenant', () => ({
  getCreateTenantId: (user: { tenantId: number | null }) => user.tenantId ?? 11,
  tenantScope: () => undefined,
}));

vi.mock('../../lib/analytics-helpers', () => ({
  parseClientEnv: () => ({ browser: 'Chrome', browserVersion: '1', os: 'Windows', osVersion: '1', deviceType: 'desktop' }),
  computeErrorFingerprint: (input: { tenantId: number | null }) => `fp-${input.tenantId ?? 'global'}`,
  resolveIngestPlatformFields: (
    input: { source?: string; appId?: string; environment?: string },
    identity: { hasAdmin: boolean; hasMember: boolean },
  ) => ({
    source: identity.hasMember ? 'web_member' : identity.hasAdmin ? 'web_admin' : (input.source === 'web_member' ? 'web_member' : 'web_admin'),
    appId: input.appId ?? (identity.hasMember ? 'member' : 'admin'),
    environment: input.environment ?? 'production',
  }),
}));

vi.mock('./error-alert.service', () => ({
  evaluateAlertsForError,
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

vi.mock('./analytics-governance.service', () => ({
  recordQualityIssue,
}));

import { reportError } from './frontend-errors.service';

describe('reportError — 身份归属与平台字段（行为中心阶段 1）', () => {
  let capturedEventRow: Record<string, unknown> | undefined;

  beforeEach(() => {
    vi.clearAllMocks();
    mockUser = undefined;
    mockMember = undefined;
    resolveSiteByKey.mockImplementation(async (siteKey?: string | null) => siteKey ? ({
      id: 7,
      tenantId: 11,
      appId: 'shop',
      status: 'enabled',
      allowedOrigins: ['https://allowed.example'],
      dailyEventQuota: 1000,
    }) : null);
    capturedEventRow = undefined;
    transaction.mockImplementation(async (callback: (tx: { insert: typeof txInsert }) => Promise<unknown>) => callback({ insert: txInsert }));
    txInsert
      .mockReturnValueOnce({
        values: () => ({
          onConflictDoUpdate: () => ({
            returning: async () => [{ id: 1, count: 1 }],
          }),
        }),
      })
      .mockReturnValueOnce({
        values: async (row: Record<string, unknown>) => {
          capturedEventRow = row;
        },
      });
  });

  it('已登录管理员上报 → source=web_admin，归属 userId，memberId=null', async () => {
    mockUser = { userId: 42, username: 'alice', roles: ['user'], tenantId: 11 };
    await reportError({ errorType: 'js_error', message: 'boom' }, { ip: '127.0.0.1', ua: 'test' });

    expect(capturedEventRow).toMatchObject({
      source: 'web_admin',
      appId: 'admin',
      environment: 'production',
      userId: 42,
      username: 'alice',
      memberId: null,
    });
  });

  it('已登录会员上报 → source=web_member，归属 memberId，userId=null，displayName 取 identifier', async () => {
    mockMember = { memberId: 7, identifier: '13800001111', type: 'member', tenantId: null };
    await reportError({ errorType: 'js_error', message: 'boom' }, { ip: '127.0.0.1', ua: 'test' });

    expect(capturedEventRow).toMatchObject({
      source: 'web_member',
      appId: 'member',
      environment: 'production',
      userId: null,
      username: '13800001111',
      memberId: 7,
    });
  });

  it('匿名上报试图伪造 source=server → 被忽略，回退 web_admin', async () => {
    await reportError({ errorType: 'js_error', message: 'boom', source: 'server' as never }, { ip: '127.0.0.1', ua: 'test' });

    expect(capturedEventRow).toMatchObject({
      source: 'web_admin',
      userId: null,
      memberId: null,
    });
  });

  it('匿名上报显式声明 web_member → 允许', async () => {
    await reportError({ errorType: 'js_error', message: 'boom', source: 'web_member' as never }, { ip: '127.0.0.1', ua: 'test' });

    expect(capturedEventRow).toMatchObject({ source: 'web_member', memberId: null });
  });

  it('匿名 site 命中且 Origin 不在白名单时静默拒收并记录 origin_rejected', async () => {
    await reportError({ errorType: 'js_error', message: 'boom' }, { ip: '127.0.0.1', ua: 'test', siteKey: 'zk_site', origin: 'https://evil.example/' });

    expect(transaction).not.toHaveBeenCalled();
    expect(recordQualityIssue).toHaveBeenCalledWith(11, '$frontend_error', 'origin_rejected');
  });
});
