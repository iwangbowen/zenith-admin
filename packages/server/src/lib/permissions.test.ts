import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  findUser: vi.fn(), cache: new Map<string, string>(), bus: 'listening' as 'listening' | 'degraded',
  navigation: [{ id: 1, parentId: 0, permission: null as string | null, status: 'enabled', type: 'directory' }, { id: 2, parentId: 1, permission: 'system:user:list', status: 'enabled', type: 'menu' }],
  handlers: new Map<string, (message: { key?: string }) => void>(),
}));
vi.mock('../db', () => ({ db: { query: { users: { findFirst: state.findUser } }, select: () => ({ from: async () => state.navigation }) } }));
vi.mock('./tenant-package', () => ({ getTenantPackageFeatureSet: async () => null }));
vi.mock('./ws-manager', () => ({ sendToUser: vi.fn() }));
vi.mock('./invalidation-bus', () => ({
  onInvalidate: (topic: string, handler: (message: { key?: string }) => void) => state.handlers.set(topic, handler),
  onInvalidationReset: vi.fn(), invalidationBusState: () => state.bus,
}));
vi.mock('./redis', () => ({ default: {
  get: vi.fn(async (key: string) => state.cache.get(key) ?? null),
  set: vi.fn(async (key: string, value: string) => { state.cache.set(key, value); return 'OK'; }),
  incr: vi.fn(async (key: string) => { const value = Number(state.cache.get(key) ?? 0) + 1; state.cache.set(key, String(value)); return value; }),
  del: vi.fn(async (...keys: string[]) => { keys.forEach(key => state.cache.delete(key)); return keys.length; }),
  scan: vi.fn(async (_cursor: string, _match: string, pattern: string) => ['0', [...state.cache.keys()].filter(key => key.startsWith(pattern.slice(0, -1)))]),
} }));

import redis from './redis';
import { clearUserPermissionCache, getUserEffectiveAccess, getUserMenuIds, getUserPermissions, getUserPermissionBoundary, isSuperAdmin, runWithFreshUserPermissions } from './permissions';

const role = (permissionCodes: string[], status = 'enabled', menuIds: number[] = []) => ({ role: {
  name: '测试角色', tenantId: null, code: 'test_role', dataScope: 'dept', deptScopes: [], permissionCodes, status, roleMenus: menuIds.map(menuId => ({ menuId })),
} });
function user(overrides: Record<string, unknown> = {}) {
  return { tenantId: null, status: 'enabled', departmentId: null, userDataScope: null, userDeptScopes: [], userRoles: [], userMenus: [], userGroupMembers: [], directPermissions: [], accessGrants: [], ...overrides };
}
const now = new Date('2030-01-01T00:00:00Z');
function item(permissionCode: string, from: number, until: number | null) {
  return { id: 1, permissionCode, status: 'active', dataScope: 'self', deptScopeIds: [], startsAt: new Date(now.getTime() + from), expiresAt: until === null ? null : new Date(now.getTime() + until) };
}
const grant = (items: ReturnType<typeof item>[]) => ({ id: 5, tenantId: null, status: 'active', startsAt: new Date(0), expiresAt: null, items, menus: [] });

beforeEach(async () => {
  vi.useRealTimers(); vi.clearAllMocks(); state.cache.clear(); state.bus = 'listening';
  state.findUser.mockReset();
  state.navigation = [{ id: 1, parentId: 0, permission: null, status: 'enabled', type: 'directory' }, { id: 2, parentId: 1, permission: 'system:user:list', status: 'enabled', type: 'menu' }];
  await clearUserPermissionCache();
});

describe('permission source aggregation', () => {
  it.each([null, user({ status: 'disabled', userRoles: [role(['system:user:list'])] }), user()])('grants no capability for absent, disabled or unassigned users', async account => {
    state.findUser.mockResolvedValue(account);
    expect(await getUserPermissions(7)).toEqual([]);
  });
  it('merges current role content, active groups, direct permissions and grants without duplicates', async () => {
    state.findUser.mockResolvedValue(user({
      userRoles: [role(['system:user:list']), role(['system:user:delete'], 'disabled')],
      userGroupMembers: [{ group: { id: 1, name: '工作组', status: 'enabled', groupRoles: [role(['system:user:list', 'system:user:update'])] } }, { group: { id: 2, name: '停用组', status: 'disabled', groupRoles: [role(['system:user:create'])] } }],
      directPermissions: [{ permissionCode: 'system:role:list' }],
      accessGrants: [grant([{ ...item('system:dict:list', 0, null), startsAt: new Date(0) }])],
    }));
    expect(await getUserPermissions(7)).toEqual(['system:dict:list', 'system:role:list', 'system:user:list', 'system:user:update']);
  });
  it('projects page reads with their source scope and removes them when the last source ends', async () => {
    state.findUser.mockResolvedValue(user({
      userRoles: [role([], 'enabled', [2])],
      directPermissions: [{ permissionCode: 'system:user:list', dataScope: 'self', deptScopeIds: [] }],
    }));
    expect((await getUserEffectiveAccess(7)).sources).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'role', dataScope: 'dept', permissionCodes: ['system:user:list'], explicitPermissionCodes: [], menuIds: [2] }),
    ]));
    state.findUser.mockResolvedValue(user({ directPermissions: [{ permissionCode: 'system:user:list', dataScope: 'self', deptScopeIds: [] }] }));
    await clearUserPermissionCache(7);
    expect(await getUserMenuIds(7)).toEqual([]);
    expect(await getUserPermissions(7)).toEqual(['system:user:list']);
    state.findUser.mockResolvedValue(user());
    await clearUserPermissionCache(7);
    expect(await getUserPermissions(7)).toEqual([]);
  });
  it('filters reads from pages under disabled ancestors', async () => {
    state.navigation[0].status = 'disabled';
    state.findUser.mockResolvedValue(user({ userMenus: [{ menuId: 2 }] }));
    expect(await getUserMenuIds(7)).toEqual([]);
    expect(await getUserPermissions(7)).toEqual([]);
  });
  it('operation permissions do not project menus unless the page is explicitly granted', async () => {
    state.findUser.mockResolvedValue(user({ userRoles: [role(['system:user:list', 'unregistered:capability'])] }));
    expect(await getUserPermissions(7)).toEqual(['system:user:list']);
    expect(await getUserMenuIds(7)).toEqual([]);
  });
  it('re-evaluates both activation and expiry at the exact time boundary', async () => {
    vi.useFakeTimers(); vi.setSystemTime(now);
    state.findUser.mockResolvedValue(user({ accessGrants: [grant([item('system:user:list', 1000, 2000)])] }));
    expect(await getUserPermissions(7)).toEqual([]);
    expect(await getUserPermissionBoundary(7)).toBe(now.getTime() + 1000);
    vi.setSystemTime(now.getTime() + 1000);
    expect(await getUserPermissions(7)).toEqual(['system:user:list']);
    vi.setSystemTime(now.getTime() + 2000);
    expect(await getUserPermissions(7)).toEqual([]);
    vi.useRealTimers();
  });
});

describe('permission cache revocation', () => {
  it('reuses a current cache and re-reads after explicit invalidation', async () => {
    state.findUser.mockResolvedValue(user({ userRoles: [role(['system:user:list'])] }));
    await getUserPermissions(7); await getUserMenuIds(7);
    expect(state.findUser).toHaveBeenCalledTimes(1);
    state.findUser.mockResolvedValue(user()); await clearUserPermissionCache(7);
    expect(await getUserPermissions(7)).toEqual([]);
  });
  it('cannot repopulate a revoked generation from an older in-flight read', async () => {
    let release!: (value: unknown) => void;
    state.findUser.mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
    const reading = getUserPermissions(7);
    await vi.waitFor(() => expect(release).toBeDefined());
    await clearUserPermissionCache(7);
    release(user({ userRoles: [role(['system:user:list'])] })); await reading;
    state.findUser.mockResolvedValue(user());
    expect(await getUserPermissions(7)).toEqual([]);
  });
  it('reads the database when Redis or invalidation delivery is unavailable', async () => {
    state.findUser.mockResolvedValue(user({ userRoles: [role(['system:user:list'])] })); await getUserPermissions(7);
    state.findUser.mockResolvedValue(user());
    vi.mocked(redis.get).mockRejectedValueOnce(new Error('Redis unavailable'));
    expect(await getUserPermissions(7)).toEqual([]);
    state.bus = 'degraded'; state.findUser.mockResolvedValue(user({ userRoles: [role(['system:user:update'])] }));
    expect(await getUserPermissions(7)).toEqual(['system:user:update']);
  });
  it('fresh guards ignore cached permissions', async () => {
    state.findUser.mockResolvedValue(user({ userRoles: [role(['system:user:list'])] })); await getUserPermissions(7);
    state.findUser.mockResolvedValue(user());
    expect(await runWithFreshUserPermissions(7, () => getUserPermissions(7))).toEqual([]);
  });
});

describe('platform administrator identity', () => {
  it('requires both the reserved role and platform tenancy', () => {
    expect(isSuperAdmin({ roles: ['super_admin'], tenantId: null })).toBe(true);
    expect(isSuperAdmin({ roles: ['super_admin'], tenantId: 9 })).toBe(false);
    expect(isSuperAdmin({ roles: ['user'], tenantId: null })).toBe(false);
  });
});
