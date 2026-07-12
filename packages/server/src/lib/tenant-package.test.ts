/**
 * tenant-package 单元测试
 *
 * 覆盖要点：
 *  1. 多租户关闭 / tenantId 为空 / 未绑定套餐 → 返回 null（不限制）
 *  2. 套餐禁用 → 返回空集（fail-closed）
 *  3. 正常套餐 → 白名单 + button 子节点自动并入（按钮权限随页面开放）
 *
 * 测试策略：mock `../db` 的 select 链与 `../config`，不连接真实数据库。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { db } from '../db';
import { config } from '../config';
import { getTenantPackageMenuIdSet } from './tenant-package';

vi.mock('../db', () => ({
  db: { select: vi.fn() },
}));

vi.mock('../config', () => ({
  config: { multiTenantMode: true },
}));

// 可链式调用且 await 得到指定结果的 select mock chain
function createChain(result: unknown[]) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const chain: Record<string, any> = {};
  chain.from = vi.fn(() => chain);
  chain.where = vi.fn(() => chain);
  chain.limit = vi.fn(() => chain);
  chain.then = (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
    Promise.resolve(result).then(resolve, reject);
  return chain;
}

const selectMock = vi.mocked(db.select);

beforeEach(() => {
  vi.clearAllMocks();
  (config as { multiTenantMode: boolean }).multiTenantMode = true;
});

describe('getTenantPackageMenuIdSet', () => {
  it('多租户模式关闭 → 返回 null（不限制）', async () => {
    (config as { multiTenantMode: boolean }).multiTenantMode = false;
    expect(await getTenantPackageMenuIdSet(1)).toBeNull();
    expect(selectMock).not.toHaveBeenCalled();
  });

  it('tenantId 为空 → 返回 null', async () => {
    expect(await getTenantPackageMenuIdSet(null)).toBeNull();
    expect(selectMock).not.toHaveBeenCalled();
  });

  it('租户未绑定套餐 → 返回 null', async () => {
    selectMock.mockReturnValueOnce(createChain([{ packageId: null }]) as never);
    expect(await getTenantPackageMenuIdSet(1)).toBeNull();
    expect(selectMock).toHaveBeenCalledTimes(1);
  });

  it('套餐被禁用 → 返回空集（fail-closed，功能全关）', async () => {
    selectMock.mockReturnValueOnce(createChain([{ packageId: 9 }]) as never);
    selectMock.mockReturnValueOnce(createChain([{ status: 'disabled' }]) as never);

    const result = await getTenantPackageMenuIdSet(1);

    expect(result).toBeInstanceOf(Set);
    expect(result?.size).toBe(0);
  });

  it('正常套餐 → 白名单菜单 + button 子节点自动并入', async () => {
    selectMock.mockReturnValueOnce(createChain([{ packageId: 9 }]) as never);
    selectMock.mockReturnValueOnce(createChain([{ status: 'enabled' }]) as never);
    selectMock.mockReturnValueOnce(createChain([{ menuId: 3 }, { menuId: 5 }]) as never);
    // 白名单页面下的 button 子节点（如新增/编辑/删除按钮）
    selectMock.mockReturnValueOnce(createChain([{ id: 10 }, { id: 11 }]) as never);

    const result = await getTenantPackageMenuIdSet(1);

    expect(result).toEqual(new Set([3, 5, 10, 11]));
  });

  it('套餐白名单为空 → 返回空集，不再查询按钮', async () => {
    selectMock.mockReturnValueOnce(createChain([{ packageId: 9 }]) as never);
    selectMock.mockReturnValueOnce(createChain([{ status: 'enabled' }]) as never);
    selectMock.mockReturnValueOnce(createChain([]) as never);

    const result = await getTenantPackageMenuIdSet(1);

    expect(result?.size).toBe(0);
    expect(selectMock).toHaveBeenCalledTimes(3);
  });
});
