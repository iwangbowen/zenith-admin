/**
 * 租户服务单测。
 *
 * 重点锁定 `listTenants` 的查询数：此前每行都发一条
 * `db.$count(users, eq(users.tenantId, r.id))`，而 pageSize 由调用方控制（上限 200），
 * 单个列表请求即可并发打出 200 条 COUNT，把默认 max=20 的连接池占满、拖垮同实例其他请求。
 * 现改为一条 GROUP BY 聚合，这里把「查询数与 pageSize 解耦」钉死。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../db', () => {
  const db = {
    select: vi.fn(),
    insert: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    $count: vi.fn(),
    query: { tenants: { findMany: vi.fn() } },
    transaction: vi.fn(async (callback: (tx: typeof db) => unknown) => callback(db)),
  };
  return { db };
});

// redis 在模块加载时即建连（lib/permissions → lib/redis），单测中隔离掉
vi.mock('../../lib/redis', () => ({
  default: { get: vi.fn(), set: vi.fn(), del: vi.fn(), scan: vi.fn() },
}));

import { db } from '../../db';
import { listTenants } from './tenants.service';

const dbMock = vi.mocked(db);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function createChain(result: unknown[]): any {
  const chain: Record<string, unknown> = {};
  for (const m of ['from', 'where', 'limit', 'orderBy', 'groupBy', 'set', 'values', 'returning']) {
    chain[m] = vi.fn(() => chain);
  }
  chain.then = (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
    Promise.resolve(result).then(resolve, reject);
  return chain;
}

function tenantRow(id: number) {
  return {
    id,
    name: `租户${id}`,
    code: `t${id}`,
    status: 'enabled',
    packageId: null,
    expireAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    package: null,
  };
}

beforeEach(() => {
  vi.resetAllMocks();
});

describe('listTenants', () => {
  it('pageSize=200 时仍只发一条聚合查询统计用户数', async () => {
    const rows = Array.from({ length: 200 }, (_, i) => tenantRow(i + 1));
    dbMock.$count.mockResolvedValueOnce(200);
    dbMock.query.tenants.findMany.mockResolvedValueOnce(rows);
    const countChain = createChain(rows.map((r) => ({ tenantId: r.id, n: 3 })));
    dbMock.select.mockReturnValueOnce(countChain);

    const res = await listTenants({ page: 1, pageSize: 200 });

    // 用户数统计只发 1 条，与 pageSize 无关（此前是 200 条）
    expect(dbMock.select).toHaveBeenCalledTimes(1);
    expect(countChain.groupBy).toHaveBeenCalledTimes(1);
    // $count 只用于 total，不再用于逐行统计
    expect(dbMock.$count).toHaveBeenCalledTimes(1);
    expect(res.list).toHaveLength(200);
    expect(res.total).toBe(200);
  });

  it('聚合结果按 tenantId 对号入座，无用户的租户计 0', async () => {
    const rows = [tenantRow(10), tenantRow(20), tenantRow(30)];
    dbMock.$count.mockResolvedValueOnce(3);
    dbMock.query.tenants.findMany.mockResolvedValueOnce(rows);
    dbMock.select.mockReturnValueOnce(createChain([
      { tenantId: 10, n: 7 },
      { tenantId: 30, n: 1 },
    ]));

    const res = await listTenants({});

    expect(res.list.map((t) => [t.id, t.userCount])).toEqual([
      [10, 7],
      [20, 0], // 未出现在聚合结果中 → 兜底 0，而非 undefined
      [30, 1],
    ]);
  });

  it('本页没有租户时不发聚合查询', async () => {
    dbMock.$count.mockResolvedValueOnce(0);
    dbMock.query.tenants.findMany.mockResolvedValueOnce([]);

    const res = await listTenants({ page: 99 });

    expect(res.list).toEqual([]);
    expect(dbMock.select).not.toHaveBeenCalled();
  });
});
