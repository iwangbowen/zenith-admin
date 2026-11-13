import { useCallback, useMemo } from 'react';
import type { Data } from '@douyinfe/semi-ui/lib/es/table';
import * as z from 'zod';
import { contractKey, type ResourceContract } from '@/lib/contract-query';
import { listTableProps, type ListQueryLike, type ListTablePropsOptions } from '@/components/list-page';
import { useFilterQuery } from '@/hooks/useFilterQuery';
import { useListSearch, useManualSearchLoading, type UseListSearchOptions, type UseListSearchReturn } from '@/hooks/useListSearch';
import type { CompactParams } from '@/lib/query';
import { formatDateTimeRangeValuesForApi } from '@/utils/date';
import type { AnyOperation, QueryOf } from '@zenith/shared/core';

interface PageParams {
  readonly page: number;
  readonly pageSize: number;
}

/** 分页包络或裸数组里的行类型；`never`（pending / error 成员的 `data: undefined`）不参与推导 */
type ItemOfData<TData> = [TData] extends [never] ? never : TData extends { list: (infer TItem)[] } ? TItem : TData extends (infer TItem)[] ? TItem : never;
/** 列表查询结果里的行类型：只看 `data` 的成功形态 */
type ItemOf<TList> = TList extends { data?: infer TData } ? ItemOfData<NonNullable<TData>> : never;

/**
 * 契约列表操作的筛选状态：query 去掉分页键，每个键都可缺省（草稿态允许为空）。
 * 值类型即契约解析后的类型（枚举收窄、`idQuery` 为 number、`queryBool` 为 boolean），控件回传的空值经 `compactParams` 丢弃。
 */
export type FilterStateOf<Op extends AnyOperation> = QueryOf<Op> extends infer Q
  ? { [K in Exclude<keyof Q, 'page' | 'pageSize'>]?: Q[K] | undefined }
  : Record<never, never>;

/** 契约里成对声明的时间范围端点键（`dateRangeBound` 的起 / 止） */
export type RangeKeys<TSearch> = readonly [start: keyof TSearch & string, end: keyof TSearch & string];

interface UseListPageBaseOptions<TSearch, TFixed extends Record<string, unknown>, TList extends ListQueryLike<Data>>
  extends Omit<UseListSearchOptions<TSearch>, 'defaults' | 'listKey'> {
  /**
   * 不经筛选映射、原样传给 `useList` 的固定 / 作用域参数（`siteId` / `accountId` / `taskType: 'data-import'`…）：
   * 契约里的必填键在这里给出，不会被 compact 掉
   */
  readonly params?: TFixed;
  /** 列表查询的启用开关（等待作用域就绪时传 false） */
  readonly enabled?: boolean;
  /** 表格接线选项：`rowSelection` / `empty` / `rowKey` / `size` / `bordered`；分页由本 hook 接好 */
  readonly table?: Omit<ListTablePropsOptions<ItemOf<TList>>, 'pagination'>;
}

/**
 * 契约模式：筛选状态类型 = 契约 list 操作的 query（去分页键），无需 `defaults` / `toQuery` / `listKey`——
 * 三者都从契约派生（`listKey = contractKey(contract.list)`，与 `createResourceQueries` 的 `keys.lists` 同键）。
 */
export interface UseListPageContractOptions<C extends ResourceContract, TFixed extends Record<string, unknown>, TList extends ListQueryLike<Data>>
  extends UseListPageBaseOptions<FilterStateOf<C['list']>, TFixed, TList> {
  readonly contract: C;
  /** 域 hooks 的列表查询（`createResourceQueries(contract).useList`）；参数类型即契约 `QueryOf` */
  readonly useList: (params: PageParams & NoInfer<TFixed> & NoInfer<CompactParams<FilterStateOf<C['list']>>>, enabled?: boolean) => TList;
  /** 初始筛选（如默认只看启用）；「重置」回到这里，缺省为空 */
  readonly defaults?: FilterStateOf<C['list']> | (() => FilterStateOf<C['list']>);
}

/**
 * 操作模式：列表不是契约的 `list`（`contract.events` / `contract.accessLogs` / `contract.adminList` 等分页子列表）时，
 * 直接给出该操作；筛选状态与 `listKey` 同样由该操作的 query 派生。
 */
export interface UseListPageOperationOptions<Op extends AnyOperation, TFixed extends Record<string, unknown>, TList extends ListQueryLike<Data>>
  extends UseListPageBaseOptions<FilterStateOf<Op>, TFixed, TList> {
  readonly op: Op;
  readonly useList: (params: PageParams & NoInfer<TFixed> & NoInfer<CompactParams<FilterStateOf<Op>>>, enabled?: boolean) => TList;
  readonly defaults?: FilterStateOf<Op> | (() => FilterStateOf<Op>);
}

/** 映射模式（非契约类型的搜索状态 + `toQuery`）：树形 / 客户端过滤 / 一页多列表等非标准形态使用 */
export interface UseListPageOptions<TSearch, TRaw extends Record<string, unknown>, TFixed extends Record<string, unknown>, TList extends ListQueryLike<Data>>
  extends UseListPageBaseOptions<TSearch, TFixed, TList>, Pick<UseListSearchOptions<TSearch>, 'defaults' | 'listKey'> {
  /**
   * 域 hooks 的列表查询（`createResourceQueries(...).useList` 或同签名的手写 hook）。
   * 与 `useEditModal({ useDetail })` 一样必须是模块级稳定函数；参数类型即契约 `QueryOf`，
   * `toQuery` / `params` 的结果会在这里被契约类型检查（`NoInfer` 保证映射类型只从 `toQuery` 推导）。
   */
  readonly useList: (params: PageParams & NoInfer<TFixed> & NoInfer<CompactParams<TRaw>>, enabled?: boolean) => TList;
  /** 已提交筛选 → 契约查询参数（不含 page / pageSize）；结果经 `useFilterQuery` 收口后再交给 `useList` */
  readonly toQuery: (submitted: TSearch) => TRaw;
}

export interface UseListPageReturn<TSearch, TRaw extends Record<string, unknown>, TList extends ListQueryLike<Data>>
  extends UseListSearchReturn<TSearch> {
  /** 已提交筛选映射出的契约查询参数（不含分页与固定参数）：给 `ExportButton query` / 深链 / 其它同源查询 */
  readonly filterQuery: CompactParams<TRaw>;
  /** 列表查询结果（`data` / `isFetching` / `refetch` …） */
  readonly listQuery: TList;
  /** 直接展开到 `ConfigurableTable`：数据源、loading、刷新、分页、多选 */
  readonly tableProps: ReturnType<typeof listTableProps<ItemOf<TList>>>;
  /** 直接展开到 `ListSearchToolbar`：查询 / 重置 */
  readonly toolbarProps: { readonly onSearch: () => void; readonly onReset: () => void };
  /** 契约 list 操作的 query schema（契约模式）；`ListSearchToolbar` 据其 `x-filter` 语义派生控件 */
  readonly filterSchema: z.ZodObject<z.ZodRawShape> | undefined;
  /**
   * 时间范围控件绑定：契约里成对的起 / 止端点键 ↔ `DateRangeFilter` 的 `[Date, Date] | null`，
   * 写回契约要求的 `YYYY-MM-DD HH:mm:ss`（止端取当日 23:59:59）
   */
  readonly bindRange: (keys: RangeKeys<TSearch>) => { readonly value: [Date, Date] | null; readonly onChange: (range: [Date, Date] | null) => void };
}

function isContractOptions(options: object): options is { contract: ResourceContract } {
  return 'contract' in options;
}
function isOperationOptions(options: object): options is { op: AnyOperation } {
  return 'op' in options;
}

/**
 * 标准分页列表页的一站式接线：搜索状态（`useListSearch`）→ 筛选映射（`useFilterQuery`）→ 列表查询 → 表格 props。
 *
 * 结构上杜绝三类接线错误：漏掉 `...filterQuery`、把草稿 `draftParams` 当作查询条件、漏传 `pagination: buildPagination`。
 * 树形 / 不分页 / 客户端过滤 / 一页多列表 / 会员端 `requestOptions` 等非标准形态退一层直接用
 * `useListSearch` + `useFilterQuery`。
 *
 * @example 契约模式（标准列表页的唯一写法）
 * const page = useListPage({ contract: xxxContract, useList: useXxxList, table: { rowSelection } });
 * <ListSearchToolbar page={page} filters={['keyword', 'status', ['startTime', 'endTime']]} create={...} />
 * <ConfigurableTable<Xxx> columns={columns} {...page.tableProps} />
 * <ExportButton entity="system.xxxs" query={page.filterQuery} permission="system:xxx:export" />
 *
 * @example 操作模式（列表是契约的子操作：事件 / 访问日志 / 管理端收件记录）
 * const page = useListPage({ op: monitorAlertContract.events, useList: useMonitorAlertEventList });
 *
 * @example 映射模式（搜索状态不是契约 query 的形状时）
 * const page = useListPage({
 *   defaults: defaultSearchParams,
 *   listKey: xxxKeys.lists,
 *   useList: useXxxList,
 *   toQuery: (s) => ({ keyword: s.keyword, ...formatDateTimeRangeForApi(s.range) }),
 * });
 */
export function useListPage<C extends ResourceContract, TFixed extends Record<string, unknown>, TList extends ListQueryLike<Data>>(
  options: UseListPageContractOptions<C, TFixed, TList>,
): UseListPageReturn<FilterStateOf<C['list']>, FilterStateOf<C['list']>, TList>;
export function useListPage<Op extends AnyOperation, TFixed extends Record<string, unknown>, TList extends ListQueryLike<Data>>(
  options: UseListPageOperationOptions<Op, TFixed, TList>,
): UseListPageReturn<FilterStateOf<Op>, FilterStateOf<Op>, TList>;
export function useListPage<TSearch, TRaw extends Record<string, unknown>, TFixed extends Record<string, unknown>, TList extends ListQueryLike<Data>>(
  options: UseListPageOptions<TSearch, TRaw, TFixed, TList>,
): UseListPageReturn<TSearch, TRaw, TList>;
export function useListPage(
  options:
    | UseListPageContractOptions<ResourceContract, Record<string, unknown>, ListQueryLike<Data>>
    | UseListPageOperationOptions<AnyOperation, Record<string, unknown>, ListQueryLike<Data>>
    | UseListPageOptions<Record<string, unknown>, Record<string, unknown>, Record<string, unknown>, ListQueryLike<Data>>,
): UseListPageReturn<Record<string, unknown>, Record<string, unknown>, ListQueryLike<Data>> {
  const listOp = isContractOptions(options) ? options.contract.list : isOperationOptions(options) ? options.op : undefined;
  const { useList, params, enabled, table } = options;
  const searchOptions: UseListSearchOptions<Record<string, unknown>> = listOp
    ? {
      ...options,
      defaults: ((options as { defaults?: unknown }).defaults ?? {}) as Record<string, unknown> | (() => Record<string, unknown>),
      listKey: contractKey(listOp),
    }
    : (options as UseListSearchOptions<Record<string, unknown>>);
  const search = useListSearch<Record<string, unknown>>(searchOptions);
  const raw = listOp ? search.submittedParams : (options as UseListPageOptions<Record<string, unknown>, Record<string, unknown>, Record<string, unknown>, ListQueryLike<Data>>).toQuery(search.submittedParams);
  const filterQuery = useFilterQuery(raw);
  const listQuery = useList({ page: search.page, pageSize: search.pageSize, ...params, ...filterQuery }, enabled);
  const manualLoading = useManualSearchLoading(search.searchVersion, listQuery.isFetching);
  const tableProps = listTableProps<Data>(listQuery as ListQueryLike<Data>, { pagination: search.buildPagination, ...table, manualLoading });
  const filterSchema = listOp ? (listOp.query as z.ZodObject<z.ZodRawShape> | undefined) : undefined;

  const { draftParams, setDraftParams, handleSearch, handleReset } = search;
  const bindRange = useCallback((keys: RangeKeys<Record<string, unknown>>) => {
    const [startKey, endKey] = keys;
    const start = draftParams[startKey];
    const end = draftParams[endKey];
    const value = typeof start === 'string' && start && typeof end === 'string' && end ? [new Date(start), new Date(end)] as [Date, Date] : null;
    return {
      value,
      onChange: (range: [Date, Date] | null) => {
        const [from, to] = formatDateTimeRangeValuesForApi(range, '');
        setDraftParams((prev) => ({ ...prev, [startKey]: from || undefined, [endKey]: to || undefined }));
      },
    };
  }, [draftParams, setDraftParams]);
  const toolbarProps = useMemo(() => ({ onSearch: handleSearch, onReset: handleReset }), [handleSearch, handleReset]);

  return { ...search, filterQuery, listQuery, tableProps, toolbarProps, filterSchema, bindRange };
}
