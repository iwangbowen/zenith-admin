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
   * - `initial`（默认）：仅首屏没有数据快照时显示；后台重拉只让刷新按钮转圈，避免整表闪烁
   * - `always`：任何请求（查询 / 刷新 / 翻页 / 失效重拉）期间都显示整表蒙层
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
    // `initial` 只在还没有数据快照（首载）时盖 Spin 蒙层：Semi 的 Spin 会把子树压暗到 50% 再弹回，
    // 若让后台重拉（mutation 后的失效刷新、翻页时的 placeholder 数据）也盖蒙层，
    // 批量上传一类场景会每个文件闪一次整表；后台重拉只让列头刷新按钮转圈（refreshLoading）。
    // `always` 用于要求「每次请求都有明确反馈」的列表：查询 / 刷新 / 翻页 / 失效重拉都显示整表蒙层。
    loading: query.isFetching && (options.loadingMode === 'always' || query.data === undefined),
    onRefresh: () => { void query.refetch(); },
    refreshLoading: query.isFetching,
    pagination: options.pagination ? options.pagination(total) : (false as const),
    ...(options.empty === undefined ? {} : { empty: options.empty }),
    ...(options.rowSelection === undefined ? {} : { rowSelection: options.rowSelection }),
  };
}
