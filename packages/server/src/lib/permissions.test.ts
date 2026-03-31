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
 * db.select().from().where() 整条链均通过可 await 的 mock chain 模拟。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { db } from '../db';
import {
  isSuperAdmin,
  getUserPermissions,
  getUserMenuIds,
  clearUserPermissionCache,
} from './permissions';

// ─── 工具：创建可链式调用且 await 可以拿到指定结果的 mock chain ────────────────
function createChain(result: unknown[]) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const chain: Record<string, any> = {};
  chain.from = vi.fn(() => chain);
  chain.where = vi.fn(() => chain);
  chain.innerJoin = vi.fn(() => chain);
  chain.limit = vi.fn(() => chain);
  // 让 chain 本身可以被 await（thenable）
  chain.then = (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
    Promise.resolve(result).then(resolve, reject);
  chain.catch = (fn: (e: unknown) => unknown) => Promise.resolve(result).catch(fn);
  chain.finally = (fn: () => void) => Promise.resolve(result).finally(fn);
  return chain;
}

// ─── Mock ────────────────────────────────────────────────────────────────────
vi.mock('../db', () => ({
  db: { select: vi.fn() },
}));

const dbMock = vi.mocked(db);

// ─── Setup ───────────────────────────────────────────────────────────────────
beforeEach(() => {
  vi.clearAllMocks();
  clearUserPermissionCache(); // 每轮测试前清空缓存，防止相互干扰
});

// ─── isSuperAdmin ─────────────────────────────────────────────────────────────
describe('isSuperAdmin', () => {
  it('包含 super_admin 时返回 true', () => {
    expect(isSuperAdmin(['user', 'super_admin'])).toBe(true);
  });

  it('不含 super_admin 时返回 false', () => {
    expect(isSuperAdmin(['user', 'admin'])).toBe(false);
  });

  it('空角色数组返回 false', () => {
    expect(isSuperAdmin([])).toBe(false);
  });
});

// ─── getUserPermissions ───────────────────────────────────────────────────────
describe('getUserPermissions', () => {
  it('用户无角色时返回空数组（仅查一次 DB）', async () => {
    dbMock.select.mockReturnValueOnce(createChain([])); // userRoles → empty

    const perms = await getUserPermissions(1);

    expect(perms).toEqual([]);
    expect(dbMock.select).toHaveBeenCalledTimes(1);
  });

  it('用户无角色对应的菜单时返回空数组', async () => {
    dbMock.select
      .mockReturnValueOnce(createChain([{ roleId: 1 }])) // userRoles → has role
      .mockReturnValueOnce(createChain([]));              // roleMenus → empty

    const perms = await getUserPermissions(2);

    expect(perms).toEqual([]);
    expect(dbMock.select).toHaveBeenCalledTimes(2);
  });

  it('正常情况返回权限码列表', async () => {
    dbMock.select
      .mockReturnValueOnce(createChain([{ roleId: 1 }]))
      .mockReturnValueOnce(createChain([{ menuId: 10 }, { menuId: 11 }]))
      .mockReturnValueOnce(
        createChain([
          { id: 10, permission: 'user:read' },
          { id: 11, permission: 'user:write' },
        ]),
      );

    const perms = await getUserPermissions(3);

    expect(perms).toContain('user:read');
    expect(perms).toContain('user:write');
    expect(perms).toHaveLength(2);
  });

  it('对权限码进行去重', async () => {
    dbMock.select
      .mockReturnValueOnce(createChain([{ roleId: 1 }, { roleId: 2 }]))
      .mockReturnValueOnce(createChain([{ menuId: 10 }, { menuId: 10 }]))
      .mockReturnValueOnce(createChain([{ id: 10, permission: 'user:read' }]));

    const perms = await getUserPermissions(4);

    const count = perms.filter((p) => p === 'user:read').length;
    expect(count).toBe(1);
  });

  it('过滤掉 null 和空字符串权限码', async () => {
    dbMock.select
      .mockReturnValueOnce(createChain([{ roleId: 1 }]))
      .mockReturnValueOnce(createChain([{ menuId: 10 }, { menuId: 11 }]))
      .mockReturnValueOnce(
        createChain([
          { id: 10, permission: null },
          { id: 11, permission: '' },
        ]),
      );

    const perms = await getUserPermissions(5);

    expect(perms).toEqual([]);
  });

  it('第二次调用命中缓存，不再查询 DB', async () => {
    dbMock.select
      .mockReturnValueOnce(createChain([{ roleId: 1 }]))
      .mockReturnValueOnce(createChain([{ menuId: 20 }]))
      .mockReturnValueOnce(createChain([{ id: 20, permission: 'dashboard:view' }]));

    await getUserPermissions(10);
    await getUserPermissions(10); // 命中缓存

    expect(dbMock.select).toHaveBeenCalledTimes(3); // 只查了一次（3次链式调用）
  });
});

// ─── getUserMenuIds ────────────────────────────────────────────────────────────
describe('getUserMenuIds', () => {
  it('用户无角色时返回空数组', async () => {
    dbMock.select.mockReturnValueOnce(createChain([]));

    const ids = await getUserMenuIds(99);

    expect(ids).toEqual([]);
  });

  it('正常情况返回去重后的菜单 ID 列表', async () => {
    dbMock.select
      .mockReturnValueOnce(createChain([{ roleId: 1 }]))
      .mockReturnValueOnce(createChain([{ menuId: 5 }, { menuId: 6 }, { menuId: 5 }]))
      .mockReturnValueOnce(
        createChain([
          { id: 5, permission: 'p1' },
          { id: 6, permission: 'p2' },
        ]),
      );

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
    dbMock.select.mockReturnValueOnce(createChain([]));
    await getUserPermissions(1);
    expect(dbMock.select).toHaveBeenCalledTimes(1);

    clearUserPermissionCache(1);

    // 清除后再次调用应重查 DB
    dbMock.select.mockReturnValueOnce(createChain([]));
    await getUserPermissions(1);
    expect(dbMock.select).toHaveBeenCalledTimes(2);
  });

  it('不传 userId 时清除所有用户的缓存', async () => {
    // 预热 user 1 & user 2 的缓存
    dbMock.select.mockReturnValueOnce(createChain([]));
    await getUserPermissions(1);
    dbMock.select.mockReturnValueOnce(createChain([]));
    await getUserPermissions(2);
    const callsAfterWarmup = dbMock.select.mock.calls.length;

    clearUserPermissionCache(); // 清除全部

    // 两个用户都应重查
    dbMock.select.mockReturnValueOnce(createChain([]));
    await getUserPermissions(1);
    dbMock.select.mockReturnValueOnce(createChain([]));
    await getUserPermissions(2);

    expect(dbMock.select).toHaveBeenCalledTimes(callsAfterWarmup + 2);
  });
});
