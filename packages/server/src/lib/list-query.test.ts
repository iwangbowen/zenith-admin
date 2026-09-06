import { describe, expect, it, vi } from 'vitest';
import { buildListResult } from './list-query';

describe('buildListResult', () => {
  it('count 与 rows 并行发出，结果套分页包络', async () => {
    const order: string[] = [];
    const count = vi.fn(async () => { order.push('count:start'); await Promise.resolve(); order.push('count:end'); return 42; });
    const rows = vi.fn(async () => { order.push('rows:start'); await Promise.resolve(); order.push('rows:end'); return [{ id: 1 }, { id: 2 }]; });
    const result = await buildListResult({ page: 2, pageSize: 20, count, rows });
    expect(result).toEqual({ list: [{ id: 1 }, { id: 2 }], total: 42, page: 2, pageSize: 20 });
    expect(order.slice(0, 2)).toEqual(['count:start', 'rows:start']);
  });

  it('map 支持同步与异步映射', async () => {
    const base = { page: 1, pageSize: 10, count: async () => 2, rows: async () => [{ id: 1, name: 'a' }, { id: 2, name: 'b' }] };
    const sync = await buildListResult({ ...base, map: (r) => ({ key: `${r.id}-${r.name}` }) });
    expect(sync.list).toEqual([{ key: '1-a' }, { key: '2-b' }]);
    const async = await buildListResult({ ...base, map: async (r) => ({ id: r.id, upper: r.name.toUpperCase() }) });
    expect(async.list).toEqual([{ id: 1, upper: 'A' }, { id: 2, upper: 'B' }]);
  });

  it('任一查询失败整体拒绝', async () => {
    await expect(buildListResult({ page: 1, pageSize: 10, count: async () => { throw new Error('count failed'); }, rows: async () => [] })).rejects.toThrow('count failed');
  });
});
