import { describe, expect, it } from 'vitest';
import type { ReportDatasetQueryOptions } from '@zenith/shared/report';
import { reportTableColumnSortOrder, reportTableSortQuery } from './table-query';

describe('report table sort query mapping', () => {
  it('maps ascending, descending and cleared sorts while resetting server pagination', () => {
    const current: ReportDatasetQueryOptions = { page: 2, pageSize: 10 };
    for (const [sortOrder, expectedOrder] of [['ascend', 'asc'], ['descend', 'desc'], [false, undefined]] as const) {
      const query = reportTableSortQuery({
        sorter: { dataIndex: 'value', sortOrder, sorter: true },
        extra: { changeType: 'sorter' },
      }, current, 10);
      expect(query).toEqual({ page: 1, pageSize: 10, sortField: expectedOrder ? 'value' : undefined, sortOrder: expectedOrder });
      expect(reportTableColumnSortOrder(query ?? {}, 'value')).toBe(sortOrder);
    }
  });
  it('keeps non-paginated sorting without page keys, and ignores unrelated pagination notifications', () => {
    expect(reportTableSortQuery({ pagination: { currentPage: 2 }, sorter: { dataIndex: 'value', sortOrder: 'descend', sorter: true }, extra: { changeType: 'pagination' } }, {}, 10)).toBeUndefined();
    const query = reportTableSortQuery({ sorter: { dataIndex: 'value', sortOrder: 'descend', sorter: true }, extra: { changeType: 'sorter' } }, { limit: 100 }, undefined);
    expect(query).toEqual({ limit: 100, sortField: 'value', sortOrder: 'desc' });
    expect(query).not.toHaveProperty('page');
    expect(query).not.toHaveProperty('pageSize');
  });
});
