/**
 * permissions 单元测试
 *
 * 覆盖要点：
 *  1. isSuperAdmin          — 正确识别 super_admin 角色
 *  2. getUserPermissions    — 无角色 / 有角色 / 去重 / 过滤空值 / 缓存命中
 *  3. getUserMenuIds        — 返回去重菜单 ID
 *  4. clearUserPermissionCache — 清除单用户 / 全部用户缓存
 *
 * 测试策略：mock `../db`，避免真实数据库连接；
 * 通过 `db.query.users.findFirst()` 返回带嵌套 relations 的结果，验证 Drizzle RQB 聚合逻辑。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { db } from '../db';
import {
  isSuperAdmin,
  getUserPermissions,
  getUserMenuIds,
  clearUserPermissionCache,
} from './permissions';

function createUserResult(menuGroups: Array<Array<{ id: number; permission: string | null }>>) {
  return {
    userRoles: menuGroups.map((menus) => ({
      role: {
        roleMenus: menus.map((menu) => ({ menu })),
      },
    })),
    // 实现侧 getUserPermissions 还会读取 user.userMenus（直接菜单授权），需提供以免 undefined.map
    userMenus: [],
  };
}

// ─── Mock ────────────────────────────────────────────────────────────────────
vi.mock('../db', () => ({
  db: { query: { users: { findFirst: vi.fn() } } },
}));

const findUserMock = vi.mocked(db.query.users.findFirst);

// ─── Setup ───────────────────────────────────────────────────────────────────
beforeEach(() => {
  vi.clearAllMocks();
  clearUserPermissionCache(); // 每轮测试前清空缓存，防止相互干扰
});

// 确保 fake timers 在每次测试后恢复，防止影响后续测试
afterEach(() => {
  vi.useRealTimers();
});

// ─── isSuperAdmin ─────────────────────────────────────────────────────────────
describe('isSuperAdmin', () => {
  it('平台用户（tenantId 为 null）包含 super_admin 时返回 true', () => {
    expect(isSuperAdmin({ roles: ['user', 'super_admin'], tenantId: null })).toBe(true);
  });

  it('未携带 tenantId 字段时视为平台用户', () => {
    expect(isSuperAdmin({ roles: ['super_admin'] })).toBe(true);
  });

  it('租户用户即使角色 code 含 super_admin 也返回 false（防伪造提权）', () => {
    expect(isSuperAdmin({ roles: ['super_admin'], tenantId: 2 })).toBe(false);
  });

  it('不含 super_admin 时返回 false', () => {
    expect(isSuperAdmin({ roles: ['user', 'admin'], tenantId: null })).toBe(false);
  });

  it('空角色数组返回 false', () => {
    expect(isSuperAdmin({ roles: [], tenantId: null })).toBe(false);
  });
});

// ─── getUserPermissions ───────────────────────────────────────────────────────
describe('getUserPermissions', () => {
  it('用户无角色时返回空数组（仅查一次 DB）', async () => {
    findUserMock.mockResolvedValueOnce({ userRoles: [], userMenus: [] } as never);

    const perms = await getUserPermissions(1);

    expect(perms).toEqual([]);
    expect(findUserMock).toHaveBeenCalledTimes(1);
  });

  it('用户无角色对应的菜单时返回空数组', async () => {
    findUserMock.mockResolvedValueOnce(createUserResult([[]]) as never);

    const perms = await getUserPermissions(2);

    expect(perms).toEqual([]);
    expect(findUserMock).toHaveBeenCalledTimes(1);
  });

  it('正常情况返回权限码列表', async () => {
    findUserMock.mockResolvedValueOnce(createUserResult([[{ id: 10, permission: 'user:read' }, { id: 11, permission: 'user:write' }]]) as never);

    const perms = await getUserPermissions(3);

    expect(perms).toContain('user:read');
    expect(perms).toContain('user:write');
    expect(perms).toHaveLength(2);
  });

  it('合并启用用户组继承的角色权限，忽略禁用组', async () => {
    findUserMock.mockResolvedValueOnce({
      userRoles: [],
      userMenus: [],
      userGroupMembers: [
        {
          group: {
            status: 'enabled',
            groupRoles: [
              { role: { roleMenus: [{ menu: { id: 20, permission: 'group:perm', visible: true } }] } },
            ],
          },
        },
        {
          group: {
            status: 'disabled',
            groupRoles: [
              { role: { roleMenus: [{ menu: { id: 21, permission: 'disabled:perm', visible: true } }] } },
            ],
          },
        },
      ],
    } as never);

    const perms = await getUserPermissions(30);

    expect(perms).toContain('group:perm');
    expect(perms).not.toContain('disabled:perm');
    clearUserPermissionCache(30);
  });

  it('对权限码进行去重', async () => {
    findUserMock.mockResolvedValueOnce(createUserResult([
      [{ id: 10, permission: 'user:read' }],
      [{ id: 10, permission: 'user:read' }],
    ]) as never);

    const perms = await getUserPermissions(4);

    const count = perms.filter((p) => p === 'user:read').length;
    expect(count).toBe(1);
  });

  it('过滤掉 null 和空字符串权限码', async () => {
    findUserMock.mockResolvedValueOnce(createUserResult([[{ id: 10, permission: null }, { id: 11, permission: '' }]]) as never);

    const perms = await getUserPermissions(5);

    expect(perms).toEqual([]);
  });

  it('第二次调用命中缓存，不再查询 DB', async () => {
    findUserMock.mockResolvedValueOnce(createUserResult([[{ id: 20, permission: 'dashboard:view' }]]) as never);

    await getUserPermissions(10);
    await getUserPermissions(10); // 命中缓存

    expect(findUserMock).toHaveBeenCalledTimes(1);
  });

  it('缓存 TTL 过期后重新查询 DB', async () => {
    vi.useFakeTimers();

    findUserMock.mockResolvedValueOnce(createUserResult([[{ id: 20, permission: 'perm:a' }]]) as never);

    await getUserPermissions(50);
    expect(findUserMock).toHaveBeenCalledTimes(1);

    // 推进 5 分钟 + 1ms，超过 CACHE_TTL
    vi.advanceTimersByTime(5 * 60 * 1000 + 1);

    findUserMock.mockResolvedValueOnce({ userRoles: [], userMenus: [] } as never);
    await getUserPermissions(50);

    expect(findUserMock).toHaveBeenCalledTimes(2); // 缓存失效，多查一次
  });
});

// ─── getUserMenuIds ────────────────────────────────────────────────────────────
describe('getUserMenuIds', () => {
  it('用户无角色时返回空数组', async () => {
    findUserMock.mockResolvedValueOnce({ userRoles: [], userMenus: [] } as never);

    const ids = await getUserMenuIds(99);

    expect(ids).toEqual([]);
  });

  it('正常情况返回去重后的菜单 ID 列表', async () => {
    findUserMock.mockResolvedValueOnce(createUserResult([
      [{ id: 5, permission: 'p1' }, { id: 6, permission: 'p2' }],
      [{ id: 5, permission: 'p1' }],
    ]) as never);

    const ids = await getUserMenuIds(100);

    // menuIds 来自 fetchUserPermissionData 内部的去重逻辑
    expect(ids).toContain(5);
    expect(ids).toContain(6);
    expect(ids.filter((id) => id === 5)).toHaveLength(1); // 确认去重
  });
});

// ─── clearUserPermissionCache ─────────────────────────────────────────────────
describe('clearUserPermissionCache', () => {
  it('清除指定用户的缓存后，下次调用重新查询 DB', async () => {
    // 预热 user 1 的缓存（roles 为空，只查一次 DB）
    findUserMock.mockResolvedValueOnce({ userRoles: [], userMenus: [] } as never);
    await getUserPermissions(1);
    expect(findUserMock).toHaveBeenCalledTimes(1);

    clearUserPermissionCache(1);

    // 清除后再次调用应重查 DB
    findUserMock.mockResolvedValueOnce({ userRoles: [], userMenus: [] } as never);
    await getUserPermissions(1);
    expect(findUserMock).toHaveBeenCalledTimes(2);
  });

  it('不传 userId 时清除所有用户的缓存', async () => {
    // 预热 user 1 & user 2 的缓存
    findUserMock.mockResolvedValueOnce({ userRoles: [], userMenus: [] } as never);
    await getUserPermissions(1);
    findUserMock.mockResolvedValueOnce({ userRoles: [], userMenus: [] } as never);
    await getUserPermissions(2);
    const callsAfterWarmup = findUserMock.mock.calls.length;

    clearUserPermissionCache(); // 清除全部

    // 两个用户都应重查
    findUserMock.mockResolvedValueOnce({ userRoles: [], userMenus: [] } as never);
    await getUserPermissions(1);
    findUserMock.mockResolvedValueOnce({ userRoles: [], userMenus: [] } as never);
    await getUserPermissions(2);

    expect(findUserMock).toHaveBeenCalledTimes(callsAfterWarmup + 2);
  });
});
