/**
 * 会员标签服务单测。
 *
 * 重点锁定列表接口的查询数：`listMemberTags` 曾按行 `Promise.all(rows.map(db.$count(...)))`
 * 逐个统计绑定数，标签数越多并发查询越多（连接池默认 max=20，易被单请求占满）。
 * 现改为一条 GROUP BY 聚合，这里用「select 调用次数 + $count 未被调用」把回归钉住。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../db', () => {
  const db = {
    select: vi.fn(),
    insert: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    $count: vi.fn(),
    transaction: vi.fn(async (callback: (tx: typeof db) => unknown) => callback(db)),
  };
  return { db };
});

import { db } from '../../db';
import { listMemberTags } from './member-tags.service';

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

const TAG_ROWS = [
  { id: 1, name: 'VIP', color: null, description: null, sort: 0, status: 'enabled', createdAt: new Date(), updatedAt: new Date() },
  { id: 2, name: '沉默', color: null, description: null, sort: 1, status: 'enabled', createdAt: new Date(), updatedAt: new Date() },
  { id: 3, name: '新客', color: null, description: null, sort: 2, status: 'enabled', createdAt: new Date(), updatedAt: new Date() },
];

beforeEach(() => {
  vi.resetAllMocks();
});

describe('listMemberTags', () => {
  it('无论多少标签都只发一条聚合查询（不退化为按行 count）', async () => {
    dbMock.select.mockReturnValueOnce(createChain(TAG_ROWS));
    const countChain = createChain([
      { tagId: 1, n: 5 },
      { tagId: 3, n: 2 },
    ]);
    dbMock.select.mockReturnValueOnce(countChain);

    await listMemberTags();

    // 1 次取标签行 + 1 次聚合统计 = 2，与标签数量无关
    expect(dbMock.select).toHaveBeenCalledTimes(2);
    expect(dbMock.$count).not.toHaveBeenCalled();
    expect(countChain.groupBy).toHaveBeenCalledTimes(1);
  });

  it('聚合结果按 tagId 对号入座，无绑定的标签计 0', async () => {
    dbMock.select.mockReturnValueOnce(createChain(TAG_ROWS));
    dbMock.select.mockReturnValueOnce(createChain([
      { tagId: 1, n: 5 },
      { tagId: 3, n: 2 },
    ]));

    const list = await listMemberTags();

    expect(list.map((t) => [t.id, t.memberCount])).toEqual([
      [1, 5],
      [2, 0], // 未出现在聚合结果中 → 兜底 0，而非 undefined
      [3, 2],
    ]);
  });

  it('没有任何标签时不发聚合查询', async () => {
    dbMock.select.mockReturnValueOnce(createChain([]));

    const list = await listMemberTags();

    expect(list).toEqual([]);
    expect(dbMock.select).toHaveBeenCalledTimes(1);
  });
});
