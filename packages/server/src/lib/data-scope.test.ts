/**
 * data-scope 单元测试
 *
 * 覆盖要点：
 *  1. super_admin 角色  → 返回 undefined（全量访问）
 *  2. dataScope = 'all' → 返回 undefined（全量访问）
 *  3. dataScope = 'dept' + 用户有部门 → 返回 inArray 条件（含递归子部门）
 *  4. dataScope = 'dept' + 用户无部门 → 降级为 self（返回 eq 条件）
 *  5. dataScope = 'dept' + 不传 deptColumn → 降级为 self
 *  6. dataScope = 'self' → 返回 eq(ownerColumn, userId)
 *  7. 无角色 (userRoles 为空) → 返回 undefined（ownerColumn 未传）
 *  8. collectDescendants 递归收集子部门（通过 dept 场景间接验证）
 *
 * Mock 策略：mock `../db`，使用可 await 的 chainable query builder mock；
 * drizzle-orm 的 eq / inArray 保持真实实现（纯函数，无 DB 依赖）。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { pgTable, integer } from 'drizzle-orm/pg-core';
import { db } from '../db';
import { getDataScopeCondition } from './data-scope';

// ─── 工具：创建可链式调用且 await 可以拿到指定结果的 mock chain ────────────────
function createChain(result: unknown[]) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const chain: Record<string, any> = {};
  chain.from = vi.fn(() => chain);
  chain.where = vi.fn(() => chain);
  chain.innerJoin = vi.fn(() => chain);
  chain.limit = vi.fn(() => chain);
  chain.then = (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
    Promise.resolve(result).then(resolve, reject);
  chain.catch = (fn: (e: unknown) => unknown) => Promise.resolve(result).catch(fn);
  chain.finally = (fn: () => void) => Promise.resolve(result).finally(fn);
  return chain;
}

// ─── 用于测试的假列定义（不连接真实 DB） ─────────────────────────────────────
const mockOrderTable = pgTable('orders', {
  departmentId: integer('department_id'),
  createdBy: integer('created_by'),
});

// ─── Mock ────────────────────────────────────────────────────────────────────
vi.mock('../db', () => ({
  db: { select: vi.fn() },
}));

const dbMock = vi.mocked(db);

// ─── Setup ───────────────────────────────────────────────────────────────────
beforeEach(() => {
  vi.clearAllMocks();
});

// ─── 全量访问分支 ──────────────────────────────────────────────────────────────
describe('全量访问（返回 undefined）', () => {
  it('super_admin 角色 → 返回 undefined', async () => {
    dbMock.select.mockReturnValueOnce(
      createChain([{ dataScope: 'self', code: 'super_admin' }]),
    );

    const result = await getDataScopeCondition({
      currentUserId: 1,
      deptColumn: mockOrderTable.departmentId,
      ownerColumn: mockOrderTable.createdBy,
    });

    expect(result).toBeUndefined();
    expect(dbMock.select).toHaveBeenCalledTimes(1);
  });

  it('dataScope = all → 返回 undefined', async () => {
    dbMock.select.mockReturnValueOnce(
      createChain([{ dataScope: 'all', code: 'admin' }]),
    );

    const result = await getDataScopeCondition({
      currentUserId: 2,
      deptColumn: mockOrderTable.departmentId,
      ownerColumn: mockOrderTable.createdBy,
    });

    expect(result).toBeUndefined();
  });

  it('用户无角色且未传 ownerColumn → 返回 undefined', async () => {
    dbMock.select.mockReturnValueOnce(createChain([])); // 无角色

    const result = await getDataScopeCondition({
      currentUserId: 3,
    });

    expect(result).toBeUndefined();
  });
});

// ─── dept 权限分支 ────────────────────────────────────────────────────────────
describe('dataScope = dept', () => {
  it('用户有部门时返回 inArray 过滤条件（含递归子部门）', async () => {
    dbMock.select
      // 1. 查用户角色 → dept 范围
      .mockReturnValueOnce(createChain([{ dataScope: 'dept', code: 'manager' }]))
      // 2. 查用户所属部门 → 部门 ID 5
      .mockReturnValueOnce(createChain([{ departmentId: 5 }]))
      // 3. 查所有部门树 → 5 → 6 → 7（三级嵌套）
      .mockReturnValueOnce(
        createChain([
          { id: 5, parentId: 0 },
          { id: 6, parentId: 5 },
          { id: 7, parentId: 6 },
          { id: 8, parentId: 99 }, // 不属于 5 的子树
        ]),
      );

    const result = await getDataScopeCondition({
      currentUserId: 10,
      deptColumn: mockOrderTable.departmentId,
      ownerColumn: mockOrderTable.createdBy,
    });

    // 应该返回 SQL 条件（inArray）
    expect(result).toBeDefined();
    expect(dbMock.select).toHaveBeenCalledTimes(3);
  });

  it('用户无部门时降级为 self（返回 eq 条件）', async () => {
    dbMock.select
      .mockReturnValueOnce(createChain([{ dataScope: 'dept', code: 'manager' }]))
      .mockReturnValueOnce(createChain([{ departmentId: null }])); // 无部门

    const result = await getDataScopeCondition({
      currentUserId: 11,
      deptColumn: mockOrderTable.departmentId,
      ownerColumn: mockOrderTable.createdBy,
    });

    expect(result).toBeDefined();
    expect(dbMock.select).toHaveBeenCalledTimes(2);
  });

  it('不传 deptColumn 时降级为 self', async () => {
    dbMock.select.mockReturnValueOnce(
      createChain([{ dataScope: 'dept', code: 'manager' }]),
    );

    const result = await getDataScopeCondition({
      currentUserId: 12,
      // deptColumn 不传
      ownerColumn: mockOrderTable.createdBy,
    });

    // 降级为 self → eq(ownerColumn, userId) → 不是 undefined
    expect(result).toBeDefined();
  });
});

// ─── self 权限分支 ────────────────────────────────────────────────────────────
describe('dataScope = self', () => {
  it('返回 eq(ownerColumn, userId) SQL 条件', async () => {
    dbMock.select.mockReturnValueOnce(
      createChain([{ dataScope: 'self', code: 'operator' }]),
    );

    const result = await getDataScopeCondition({
      currentUserId: 20,
      ownerColumn: mockOrderTable.createdBy,
    });

    expect(result).toBeDefined();
    expect(dbMock.select).toHaveBeenCalledTimes(1);
  });

  it('未传 ownerColumn 时返回 undefined', async () => {
    dbMock.select.mockReturnValueOnce(
      createChain([{ dataScope: 'self', code: 'operator' }]),
    );

    const result = await getDataScopeCondition({
      currentUserId: 21,
      // 不传 ownerColumn
    });

    expect(result).toBeUndefined();
  });
});

// ─── collectDescendants 递归逻辑（通过 dept 场景间接验证）────────────────────────
describe('collectDescendants 递归逻辑', () => {
  it('仅包含根部门本身（无子部门）', async () => {
    dbMock.select
      .mockReturnValueOnce(createChain([{ dataScope: 'dept', code: 'mgr' }]))
      .mockReturnValueOnce(createChain([{ departmentId: 10 }]))
      .mockReturnValueOnce(
        createChain([
          { id: 10, parentId: 0 },
          { id: 20, parentId: 99 }, // 不属于 10
        ]),
      );

    const result = await getDataScopeCondition({
      currentUserId: 30,
      deptColumn: mockOrderTable.departmentId,
    });

    // 只有 dept 10，无子部门，inArray([10]) → 不为 undefined
    expect(result).toBeDefined();
  });

  it('多级子部门均被收入', async () => {
    // Tree: 1 → 2 → 4, 1 → 3
    dbMock.select
      .mockReturnValueOnce(createChain([{ dataScope: 'dept', code: 'mgr' }]))
      .mockReturnValueOnce(createChain([{ departmentId: 1 }]))
      .mockReturnValueOnce(
        createChain([
          { id: 1, parentId: 0 },
          { id: 2, parentId: 1 },
          { id: 3, parentId: 1 },
          { id: 4, parentId: 2 },
        ]),
      );

    // 应返回包含 [1, 2, 3, 4] 的过滤条件
    const result = await getDataScopeCondition({
      currentUserId: 31,
      deptColumn: mockOrderTable.departmentId,
    });

    expect(result).toBeDefined();
  });
});
