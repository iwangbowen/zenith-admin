/**
 * 租户用户数配额单测（多租户资源上限强制）。
 *
 * 覆盖：多租户关闭/平台级用户/未设上限 → 不限制；
 * 达到与超过上限的边界判定（400）。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../config', () => ({
  config: { multiTenantMode: true },
}));

vi.mock('../db', () => {
  const db = { select: vi.fn(), $count: vi.fn() };
  return { db };
});

import { db } from '../db';
import { config } from '../config';
import { getTenantUserLimit, ensureTenantUserQuota } from './tenant-quota';

const dbMock = vi.mocked(db);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function createChain(result: unknown[]): any {
  const chain: Record<string, unknown> = {};
  for (const m of ['from', 'where', 'limit']) {
    chain[m] = vi.fn(() => chain);
  }
  chain.then = (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
    Promise.resolve(result).then(resolve, reject);
  return chain;
}

beforeEach(() => {
  vi.resetAllMocks();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (config as any).multiTenantMode = true;
});

describe('getTenantUserLimit', () => {
  it('多租户模式关闭 → null（不限制，不查库）', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (config as any).multiTenantMode = false;
    expect(await getTenantUserLimit(1)).toBeNull();
    expect(dbMock.select).not.toHaveBeenCalled();
  });

  it('tenantId 为空（平台级用户）→ null', async () => {
    expect(await getTenantUserLimit(null)).toBeNull();
    expect(await getTenantUserLimit(undefined)).toBeNull();
  });

  it('租户未设置 maxUsers → null', async () => {
    dbMock.select.mockReturnValueOnce(createChain([{ maxUsers: null }]));
    expect(await getTenantUserLimit(1)).toBeNull();
  });

  it('租户不存在 → null', async () => {
    dbMock.select.mockReturnValueOnce(createChain([]));
    expect(await getTenantUserLimit(999)).toBeNull();
  });

  it('返回租户配置的上限', async () => {
    dbMock.select.mockReturnValueOnce(createChain([{ maxUsers: 50 }]));
    expect(await getTenantUserLimit(1)).toBe(50);
  });
});

describe('ensureTenantUserQuota', () => {
  it('不限制场景直接通过（不数用户）', async () => {
    dbMock.select.mockReturnValueOnce(createChain([{ maxUsers: null }]));
    await expect(ensureTenantUserQuota(1)).resolves.toBeUndefined();
    expect(dbMock.$count).not.toHaveBeenCalled();
  });

  it('新增后恰好等于上限 → 通过（边界允许）', async () => {
    dbMock.select.mockReturnValueOnce(createChain([{ maxUsers: 10 }]));
    dbMock.$count.mockResolvedValueOnce(9);
    await expect(ensureTenantUserQuota(1, 1)).resolves.toBeUndefined();
  });

  it('新增后超过上限 1 → 400', async () => {
    dbMock.select.mockReturnValueOnce(createChain([{ maxUsers: 10 }]));
    dbMock.$count.mockResolvedValueOnce(10);
    await expect(ensureTenantUserQuota(1, 1)).rejects.toMatchObject({
      status: 400,
      message: '该租户用户数已达上限（10），无法新增',
    });
  });

  it('批量新增按数量校验', async () => {
    dbMock.select.mockReturnValueOnce(createChain([{ maxUsers: 10 }]));
    dbMock.$count.mockResolvedValueOnce(5);
    await expect(ensureTenantUserQuota(1, 6)).rejects.toMatchObject({ status: 400 });
  });
});
