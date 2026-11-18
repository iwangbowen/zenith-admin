import { describe, expect, it, vi } from 'vitest';
import { listTableProps } from './listTableProps';

describe('listTableProps', () => {
  const buildPagination = (total: number) => ({ currentPage: 1, pageSize: 10, total, onPageChange: () => {}, onPageSizeChange: () => {} });

  it('分页包络保留数据和总数，刷新时重新获取数据', () => {
    const refetch = vi.fn();
    const props = listTableProps({ data: { list: [{ id: 1 }], total: 7 }, isFetching: true, refetch }, { pagination: buildPagination });
    expect(props.dataSource).toEqual([{ id: 1 }]);
    expect(props.pagination && props.pagination.total).toBe(7);
    props.onRefresh();
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it('数组与未加载态归一为列表数据，缺少数据时总数为零', () => {
    const props = listTableProps<{ code: string }>({ data: [{ code: 'a' }, { code: 'b' }], isFetching: false, refetch: () => {} }, { rowKey: 'code', size: 'default', empty: '暂无数据', bordered: false });
    expect(props.dataSource).toEqual([{ code: 'a' }, { code: 'b' }]);
    expect(props.pagination).toBe(false);
    const pending = listTableProps({ data: undefined, isFetching: true, refetch: () => {} }, { pagination: buildPagination });
    expect(pending.dataSource).toEqual([]);
    expect(pending.pagination && pending.pagination.total).toBe(0);
  });
});
