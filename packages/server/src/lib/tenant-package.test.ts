/**
 * 套餐功能集解析单测。
 *
 * 锁定三类关键语义：
 * 1. 「不限制」返回 null 的三种情形（多租户关闭 / 无租户 / 未绑定套餐）；
 * 2. fail-closed：套餐被禁用时返回**空集**（全部可授权功能关闭），
 *    而不是回退为 null（那会静默变成全功能放行）；
 * 3. 进程内副本：同租户只回源一次，`tenants` 广播按键失效、套餐侧广播整段清空。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const configMock = vi.hoisted(() => ({ multiTenantMode: true }));
vi.mock('../config', () => ({ config: configMock }));

vi.mock('../db', () => ({
  db: { select: vi.fn() },
}));

// invalidation-bus 依赖 logger（其模块初始化读取 config.log），这里与 config 一样打桩
vi.mock('./logger', () => ({
  default: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

import { db } from '../db';
import { dispatchInvalidation } from './invalidation-bus';
import { getTenantPackageFeatureSet, resetTenantPackageFeatureCache } from './tenant-package';

const dbMock = vi.mocked(db);

/** 构造一次 select().from().leftJoin().leftJoin().where() 链，resolve 指定行 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function createChain(result: unknown[]): any {
  const chain: Record<string, unknown> = {};
  for (const m of ['from', 'leftJoin', 'where']) chain[m] = vi.fn(() => chain);
  chain.then = (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
    Promise.resolve(result).then(resolve, reject);
  return chain;
}

/** 租户 ⟕ 套餐 ⟕ 功能 的 JOIN 行 */
function joined(packageId: number | null, packageStatus: string | null, featureKeys: (string | null)[] = [null]) {
  return featureKeys.map((featureKey) => ({ packageId, packageStatus, featureKey }));
}

beforeEach(() => {
  vi.clearAllMocks();
  resetTenantPackageFeatureCache();
  configMock.multiTenantMode = true;
});

describe('getTenantPackageFeatureSet', () => {
  it('多租户关闭时返回 null（不限制），不触发任何查询', async () => {
    configMock.multiTenantMode = false;
    expect(await getTenantPackageFeatureSet(1)).toBeNull();
    expect(dbMock.select).not.toHaveBeenCalled();
  });

  it('tenantId 为空（平台级视角）时返回 null', async () => {
    expect(await getTenantPackageFeatureSet(null)).toBeNull();
    expect(await getTenantPackageFeatureSet(undefined)).toBeNull();
    expect(dbMock.select).not.toHaveBeenCalled();
  });

  it('租户不存在时返回 null', async () => {
    dbMock.select.mockReturnValueOnce(createChain([]));
    expect(await getTenantPackageFeatureSet(1)).toBeNull();
  });

  it('租户未绑定套餐时返回 null（不限制）', async () => {
    dbMock.select.mockReturnValueOnce(createChain(joined(null, null)));
    expect(await getTenantPackageFeatureSet(1)).toBeNull();
  });

  it('套餐被禁用时返回空集（fail-closed，而不是 null）', async () => {
    dbMock.select.mockReturnValueOnce(createChain(joined(10, 'disabled', ['wiki'])));
    const set = await getTenantPackageFeatureSet(1);
    expect(set).toBeInstanceOf(Set);
    expect(set!.size).toBe(0);
  });

  it('启用套餐但未分配任何功能 → 空集', async () => {
    dbMock.select.mockReturnValueOnce(createChain(joined(10, 'enabled')));
    const set = await getTenantPackageFeatureSet(1);
    expect(set).toBeInstanceOf(Set);
    expect(set!.size).toBe(0);
  });

  it('启用套餐返回其分配的功能 key 集合，且一次 JOIN 完成', async () => {
    dbMock.select.mockReturnValueOnce(createChain(joined(10, 'enabled', ['wiki', 'workflow'])));
    const set = await getTenantPackageFeatureSet(1);
    expect([...set!].sort()).toEqual(['wiki', 'workflow']);
    expect(dbMock.select).toHaveBeenCalledTimes(1);
  });
});

describe('getTenantPackageFeatureSet - 进程内副本', () => {
  it('同租户连续读取只回源一次；不同租户各自回源', async () => {
    dbMock.select
      .mockReturnValueOnce(createChain(joined(10, 'enabled', ['wiki'])))
      .mockReturnValueOnce(createChain(joined(11, 'enabled', ['drive'])));
    expect([...(await getTenantPackageFeatureSet(1))!]).toEqual(['wiki']);
    expect([...(await getTenantPackageFeatureSet(1))!]).toEqual(['wiki']);
    expect(dbMock.select).toHaveBeenCalledTimes(1);
    expect([...(await getTenantPackageFeatureSet(2))!]).toEqual(['drive']);
    expect(dbMock.select).toHaveBeenCalledTimes(2);
  });

  it('「不限制」的 null 同样缓存，未绑定套餐的租户不会反复回源', async () => {
    dbMock.select.mockReturnValue(createChain(joined(null, null)));
    expect(await getTenantPackageFeatureSet(1)).toBeNull();
    expect(await getTenantPackageFeatureSet(1)).toBeNull();
    expect(dbMock.select).toHaveBeenCalledTimes(1);
  });

  it('tenants 触发器广播 → 仅该租户副本失效（改绑套餐立即生效）', async () => {
    dbMock.select
      .mockReturnValueOnce(createChain(joined(10, 'enabled', ['wiki'])))
      .mockReturnValueOnce(createChain(joined(11, 'enabled', ['drive'])));
    await getTenantPackageFeatureSet(1);
    await getTenantPackageFeatureSet(2);

    dbMock.select.mockReturnValueOnce(createChain(joined(12, 'enabled', ['ai'])));
    dispatchInvalidation({ topic: 'tenants', key: '1' });

    expect([...(await getTenantPackageFeatureSet(1))!]).toEqual(['ai']);
    // 租户 2 的副本未受影响
    expect([...(await getTenantPackageFeatureSet(2))!]).toEqual(['drive']);
    expect(dbMock.select).toHaveBeenCalledTimes(3);
  });

  it('tenant_packages / tenant_package_features 广播 → 全部副本清空（套餐禁用 fail-closed 立即生效）', async () => {
    dbMock.select.mockReturnValueOnce(createChain(joined(10, 'enabled', ['wiki'])));
    expect((await getTenantPackageFeatureSet(1))!.size).toBe(1);

    dbMock.select.mockReturnValueOnce(createChain(joined(10, 'disabled', ['wiki'])));
    dispatchInvalidation({ topic: 'tenant_packages', key: '10' });
    expect((await getTenantPackageFeatureSet(1))!.size).toBe(0);

    dbMock.select.mockReturnValueOnce(createChain(joined(10, 'enabled', ['wiki', 'drive'])));
    dispatchInvalidation({ topic: 'tenant_package_features', key: '10' });
    expect((await getTenantPackageFeatureSet(1))!.size).toBe(2);
    expect(dbMock.select).toHaveBeenCalledTimes(3);
  });

  it('resetTenantPackageFeatureCache 清空后重新回源', async () => {
    dbMock.select.mockReturnValue(createChain(joined(10, 'enabled', ['wiki'])));
    await getTenantPackageFeatureSet(1);
    resetTenantPackageFeatureCache();
    await getTenantPackageFeatureSet(1);
    expect(dbMock.select).toHaveBeenCalledTimes(2);
  });
});
