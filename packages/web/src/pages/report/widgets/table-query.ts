import type { ChangeInfo } from '@douyinfe/semi-ui/lib/es/table/interface';
import type { ReportDatasetQueryOptions } from '@zenith/shared/report';

export function reportTableColumnSortOrder(query: ReportDatasetQueryOptions | undefined, field: string): 'ascend' | 'descend' | false {
  if (query?.sortField !== field) return false;
  return query.sortOrder === 'asc' ? 'ascend' : query.sortOrder === 'desc' ? 'descend' : false;
}

/** Semi emits one change object; its sorter identifies columns with dataIndex. */
export function reportTableSortQuery(
  change: ChangeInfo<Record<string, unknown>>,
  current: ReportDatasetQueryOptions | undefined,
  pageSize: number | undefined,
): ReportDatasetQueryOptions | undefined {
  if (change.extra?.changeType !== 'sorter') return undefined;
  const sorter = change.sorter;
  if (!sorter) return undefined;
  const sortOrder = sorter.sortOrder === 'ascend' ? 'asc' : sorter.sortOrder === 'descend' ? 'desc' : undefined;
  const { page: _page, pageSize: _pageSize, ...query } = current ?? {};
  return {
    ...query,
    ...(pageSize ? { page: 1, pageSize } : {}),
    sortField: sortOrder && typeof sorter.dataIndex === 'string' ? sorter.dataIndex : undefined,
    sortOrder,
  };
}
