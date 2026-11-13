import type { ReactNode } from 'react';
import type { Data, TableProps } from '@douyinfe/semi-ui/lib/es/table';
import type { PaginationConfig } from '@/hooks/usePagination';

/** TanStack Query 列表查询结果的最小形状（`{ list, total }` 分页包络或直接数组） */
export interface ListQueryLike<T> {
  data?: { list: T[]; total: number } | T[] | undefined;
  isFetching: boolean;
  refetch: () => unknown;
}

export interface ListTablePropsOptions<T extends Data> {
  /** `usePagination().buildPagination`；不传则关闭分页（Semi Table 缺省会做客户端分页，这里显式传 `false`） */
  pagination?: (total: number) => PaginationConfig;
  /** 默认 `id` */
  rowKey?: TableProps<T>['rowKey'];
  /** 默认 `small` */
  size?: TableProps<T>['size'];
  /** 默认带边框 */
  bordered?: boolean;
  empty?: ReactNode;
  rowSelection?: TableProps<T>['rowSelection'];
  /**
   * 整表 loading 蒙层的显示时机：
   * - `always`（默认）：任何请求（查询 / 刷新 / 翻页 / 失效重拉）期间都显示整表蒙层
   * - `initial`：仅首屏没有数据快照时显示；持续轮询、后台自动刷新频繁的列表用它避免整表反复闪烁
   */
  loadingMode?: 'initial' | 'always';
}

/**
 * 把列表查询接到 `ConfigurableTable`：数据源、loading、刷新按钮、分页一次接好，页面只保留 `columns`。
 *
 * @example
 * <ConfigurableTable<Tag> columns={columns} {...listTableProps(listQuery, { pagination: buildPagination })} />
 */
export function listTableProps<T extends Data>(query: ListQueryLike<T>, options: ListTablePropsOptions<T> = {}) {
  const data = query.data;
  const list: T[] = Array.isArray(data) ? data : (data?.list ?? []);
  const total = Array.isArray(data) ? data.length : (data?.total ?? 0);
  return {
    bordered: options.bordered ?? true,
    rowKey: options.rowKey ?? 'id',
    size: options.size ?? 'small',
    dataSource: list,
    // 默认任何请求都盖 Spin 蒙层，查询 / 刷新 / 翻页 / 失效重拉都有明确反馈。
    // `initial` 只给持续轮询、后台自动刷新频繁的列表：仅首屏无数据快照时盖蒙层，避免整表反复闪烁。
    loading: query.isFetching && (options.loadingMode !== 'initial' || query.data === undefined),
    onRefresh: () => { void query.refetch(); },
    refreshLoading: query.isFetching,
    pagination: options.pagination ? options.pagination(total) : (false as const),
    ...(options.empty === undefined ? {} : { empty: options.empty }),
    ...(options.rowSelection === undefined ? {} : { rowSelection: options.rowSelection }),
  };
}
