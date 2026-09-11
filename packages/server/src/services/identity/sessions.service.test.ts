import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = {
  user: { userId: 1, username: 'admin', roles: ['super_admin'], tenantId: null as number | null, viewingTenantId: undefined as number | null | undefined },
  multiTenantMode: true,
};

vi.mock('../../config', () => ({ config: { get multiTenantMode() { return state.multiTenantMode; } } }));
vi.mock('../../lib/context', () => ({ currentUser: () => state.user }));
vi.mock('../../lib/ws-manager', () => ({
  sendToToken: vi.fn(), closeTokenConnection: vi.fn(), sendToUser: vi.fn(), closeUserConnections: vi.fn(),
}));
vi.mock('../../lib/session-manager', () => ({
  getOnlineSessions: vi.fn(),
  forceLogout: vi.fn().mockResolvedValue(true),
  forceLogoutAllByUser: vi.fn().mockResolvedValue(['t']),
}));
vi.mock('./role-grant', () => ({ listPlatformSuperUserIds: vi.fn().mockResolvedValue(new Set([1])) }));

const { getOnlineSessions, forceLogout, forceLogoutAllByUser } = await import('../../lib/session-manager');
const { listSessions, forceLogoutSession, forceLogoutVisibleUserSessions } = await import('./sessions.service');

function session(tokenId: string, userId: number, tenantId: number | null) {
  return {
    tokenId, userId, username: `u${userId}`, nickname: `U${userId}`, tenantId,
    ip: '10.0.0.1', location: null, browser: 'Chrome', os: 'Windows', loginAt: new Date(), lastActiveAt: new Date(),
  };
}

const ALL = [
  session('super', 1, null),     // 平台超管
  session('global', 2, null),    // 无租户的普通管理员
  session('t1-a', 10, 1),
  session('t1-b', 11, 1),
  session('t2-a', 20, 2),
];

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getOnlineSessions).mockResolvedValue(ALL);
  state.multiTenantMode = true;
  state.user = { userId: 1, username: 'admin', roles: ['super_admin'], tenantId: null, viewingTenantId: undefined };
});

describe('在线会话可见范围（M2）', () => {
  it('平台超管平台视角看到全部会话', async () => {
    const result = await listSessions({ page: 1, pageSize: 50 });
    expect(result.total).toBe(5);
  });

  it('平台超管切到租户视角只看该租户', async () => {
    state.user.viewingTenantId = 1;
    const result = await listSessions({ page: 1, pageSize: 50 });
    expect(result.list.map((s) => s.tokenId).sort()).toEqual(['t1-a', 't1-b']);
  });

  it('租户管理员只看本租户会话，且不能强制下线其它租户 / 平台会话', async () => {
    state.user = { userId: 10, username: 'tenant-admin', roles: ['admin'], tenantId: 1, viewingTenantId: undefined };
    const result = await listSessions({ page: 1, pageSize: 50 });
    expect(result.list.map((s) => s.tokenId).sort()).toEqual(['t1-a', 't1-b']);

    await expect(forceLogoutSession('t2-a')).rejects.toMatchObject({ status: 404 });
    await expect(forceLogoutSession('super')).rejects.toMatchObject({ status: 404 });
    await expect(forceLogoutVisibleUserSessions(20)).rejects.toMatchObject({ status: 404 });
    expect(forceLogout).not.toHaveBeenCalled();
    expect(forceLogoutAllByUser).not.toHaveBeenCalled();

    await forceLogoutSession('t1-b');
    expect(forceLogout).toHaveBeenCalledWith('t1-b');
    await forceLogoutVisibleUserSessions(11);
    expect(forceLogoutAllByUser).toHaveBeenCalledWith(11);
  });

  it('无租户的非超管看不到平台超管会话（多租户与单租户模式一致）', async () => {
    state.user = { userId: 2, username: 'ops', roles: ['admin'], tenantId: null, viewingTenantId: undefined };
    let result = await listSessions({ page: 1, pageSize: 50 });
    expect(result.list.map((s) => s.tokenId)).toEqual(['global']);
    await expect(forceLogoutSession('super')).rejects.toMatchObject({ status: 404 });

    state.multiTenantMode = false;
    result = await listSessions({ page: 1, pageSize: 50 });
    expect(result.list.map((s) => s.tokenId)).not.toContain('super');
    expect(result.total).toBe(4);
  });
});

