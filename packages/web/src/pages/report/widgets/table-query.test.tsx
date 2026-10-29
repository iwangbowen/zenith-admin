import { fireEvent, render, screen } from '@testing-library/react';
import { Table } from '@douyinfe/semi-ui';
import { describe, expect, it, vi } from 'vitest';
import { useState } from 'react';
import type { ReportDatasetQueryOptions } from '@zenith/shared/report';
import { reportTableColumnSortOrder, reportTableSortQuery } from './table-query';

describe('report table sorting contract with Semi', () => {
  it('forwards the real sort event and resets server pagination for ascending, descending and cleared sorts', () => {
    const query = vi.fn();
    function Harness() {
      const [current, setCurrent] = useState<ReportDatasetQueryOptions>({ page: 2, pageSize: 10 });
      return <Table<Record<string, unknown>> rowKey="value" dataSource={[{ value: 2 }, { value: 1 }]}
        columns={[{ title: '序号', dataIndex: 'value', sorter: true, sortOrder: reportTableColumnSortOrder(current, 'value') }]} pagination={false}
        onChange={(change) => { const next = reportTableSortQuery(change, current, 10); query(next); if (next) setCurrent(next); }} />;
    }
    render(<Harness />);
    fireEvent.click(screen.getByRole('button', { name: /Current sort order/ }));
    expect(query).toHaveBeenLastCalledWith({ page: 1, pageSize: 10, sortField: 'value', sortOrder: 'asc' });
    fireEvent.click(screen.getByRole('button', { name: /Current sort order/ }));
    expect(query).toHaveBeenLastCalledWith({ page: 1, pageSize: 10, sortField: 'value', sortOrder: 'desc' });
    fireEvent.click(screen.getByRole('button', { name: /Current sort order/ }));
    expect(query).toHaveBeenLastCalledWith({ page: 1, pageSize: 10, sortField: undefined, sortOrder: undefined });
  });
  it('keeps non-paginated sorting without page keys, and ignores unrelated pagination notifications', () => {
    expect(reportTableSortQuery({ pagination: { currentPage: 2 }, sorter: { dataIndex: 'value', sortOrder: 'descend', sorter: true }, extra: { changeType: 'pagination' } }, {}, 10)).toBeUndefined();
    const query = reportTableSortQuery({ sorter: { dataIndex: 'value', sortOrder: 'descend', sorter: true }, extra: { changeType: 'sorter' } }, { limit: 100 }, undefined);
    expect(query).toEqual({ limit: 100, sortField: 'value', sortOrder: 'desc' });
    expect(query).not.toHaveProperty('page');
    expect(query).not.toHaveProperty('pageSize');
  });
});
