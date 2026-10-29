import { describe, expect, it } from 'vitest';
import type { ReportWidget } from './contracts/dashboards';
import { resolveReportWidgetQuery } from './widget-query';

const table = (pageSize = 0): ReportWidget => ({ i: 'table', type: 'table', title: '明细', options: { pageSize } });

describe('report widget query policy', () => {
  it('requests an exact first page for a configured paginated table before overrides exist', () => {
    expect(resolveReportWidgetQuery(table(20), 5000, undefined)).toMatchObject({ page: 1, pageSize: 20 });
    expect(resolveReportWidgetQuery(table(20), 5000, undefined)).not.toHaveProperty('limit');
  });
  it('retains explicit page, page size and sorting overrides', () => {
    expect(resolveReportWidgetQuery(table(20), 100, { table: { page: 3, pageSize: 50, sortField: 'amount', sortOrder: 'desc' } }))
      .toMatchObject({ page: 3, pageSize: 50, sortField: 'amount', sortOrder: 'desc' });
  });
  it('keeps non-paginated tables and their sorting free of count requests', () => {
    const query = resolveReportWidgetQuery(table(), 100, { table: { sortField: 'amount', sortOrder: 'asc' } });
    expect(query).toMatchObject({ limit: 100, sortField: 'amount', sortOrder: 'asc' });
    expect(query).not.toHaveProperty('page');
    expect(query).not.toHaveProperty('pageSize');
  });
  it('charts only use bounded rows, even if a stale table override is present', () => {
    expect(resolveReportWidgetQuery({ ...table(20), type: 'bar' }, 1000, { table: { page: 1, pageSize: 20, limit: 300 } }))
      .toEqual({ limit: 300 });
  });
});
