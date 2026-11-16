/* eslint-disable react-refresh/only-export-components -- 派生函数与其内部字典下拉控件同文件，本模块不是热刷新边界 */
import { Fragment, type ReactNode } from 'react';
import * as z from 'zod';
import { filterMetaOf, type FilterMeta } from '@zenith/shared/core';
import { DateRangeFilter, FilterSelect, KeywordInput, NumberFilter, StatusSelect, type FilterOption } from '@/components/search-filters';
import { useDictItems } from '@/hooks/useDictItems';
import type { UseListSearchReturn } from '@/hooks/useListSearch';
import type { RangeKeys } from '@/hooks/useListPage';

/**
 * 由契约 query schema 的 `x-filter` 语义派生筛选控件。
 *
 * 契约（`keywordQuery('名称 / 编码')` / `queryEnum(values, { dict | options })` / `queryBool` / `idQuery` / `dateRangeQuery`）
 * 已经说明每个参数「是什么」，页面只需列出**要展示哪些键、按什么顺序**；kind → 控件的映射写在这一处：
 * keyword → `KeywordInput`（占位「搜索 + 匹配字段」）、enum → `StatusSelect` / `FilterSelect`（标签来自字典或静态选项）、
 * bool → 是 / 否下拉、id → `NumberFilter`、成对的 date-bound → `DateRangeFilter`。
 * 需要专用控件（部门 / 用户选择器、级联…）的键在 `overrides` 里以 JSX 给出，其余键仍派生。
 */

/** 页面在工具栏里声明的一个筛选项：单键，或成对的时间范围端点键 */
export type FilterSpec<TSearch> = (keyof TSearch & string) | RangeKeys<TSearch>;

/** 派生控件所需的列表页能力子集（`useListPage` 的返回满足） */
export interface FilterPageLike<TSearch> extends Pick<UseListSearchReturn<TSearch>, 'bind' | 'bindKeyword'> {
  readonly filterSchema: z.ZodObject<z.ZodRawShape> | undefined;
  readonly bindRange: (keys: RangeKeys<TSearch>) => { readonly value: [Date, Date] | null; readonly onChange: (range: [Date, Date] | null) => void };
}

export type FilterOverrides<TSearch> = Partial<Record<keyof TSearch & string, (page: FilterPageLike<TSearch>) => ReactNode>>;

const specKey = <TSearch,>(spec: FilterSpec<TSearch>): string => (typeof spec === 'string' ? spec : `${spec[0]}~${spec[1]}`);

/** `description` 里「；空 = 全部」之前的主体即字段名：「状态；空 = 全部」→「状态」 */
function labelOf(schema: z.ZodType | undefined, fallback: string): string {
  const description = schema?.meta()?.description;
  if (typeof description !== 'string' || !description) return fallback;
  return description.split(/[；;（(]/)[0].trim() || fallback;
}

const BOOL_ITEMS: readonly FilterOption[] = [{ value: 'true', label: '是' }, { value: 'false', label: '否' }];

type AnyBinding = { readonly value: unknown; readonly onChange: (value: unknown) => void };
type KeywordBinding = { readonly value: string | undefined; readonly onChange: (value: string) => void; readonly onSearch: () => void };

function DictSelect<TSearch>({ page, name, dict, placeholder }: { page: FilterPageLike<TSearch>; name: keyof TSearch & string; dict: string; placeholder: string }) {
  const { options } = useDictItems(dict);
  const binding = page.bind(name) as unknown as AnyBinding;
  const props = { items: options, value: binding.value as string | undefined, onChange: binding.onChange };
  return dict === 'common_status' ? <StatusSelect {...props} /> : <FilterSelect placeholder={placeholder} {...props} />;
}

function renderControl<TSearch>(page: FilterPageLike<TSearch>, name: keyof TSearch & string, field: z.ZodType | undefined, meta: FilterMeta | undefined): ReactNode {
  // 契约 query 的键值类型在这里已被 x-filter 语义确定，控件按语义收窄
  const binding = page.bind(name) as unknown as AnyBinding;
  switch (meta?.kind) {
    case 'keyword':
      return <KeywordInput key={name} placeholder={meta.fields ? `搜索${meta.fields}` : '搜索关键字'} {...(page.bindKeyword(name) as unknown as KeywordBinding)} />;
    case 'enum': {
      const label = labelOf(field, '');
      const placeholder = label ? `全部${label}` : '全部';
      if (meta.dict) return <DictSelect key={name} page={page} name={name} dict={meta.dict} placeholder={placeholder} />;
      const items: FilterOption[] = meta.options ? meta.options.map((o) => ({ value: o.value, label: o.label })) : meta.values.map((v) => ({ value: v, label: v }));
      return <FilterSelect key={name} placeholder={placeholder} items={items} value={binding.value as string | undefined} onChange={binding.onChange} />;
    }
    case 'bool': {
      const items: readonly FilterOption[] = meta.labels ? [{ value: 'true', label: meta.labels[0] }, { value: 'false', label: meta.labels[1] }] : BOOL_ITEMS;
      return (
        <FilterSelect
          key={name}
          placeholder={labelOf(field, name)}
          items={items}
          value={binding.value === undefined ? undefined : String(binding.value)}
          onChange={(v) => binding.onChange(v === 'true' ? true : v === 'false' ? false : undefined)}
        />
      );
    }
    case 'id':
      return <NumberFilter key={name} placeholder={labelOf(field, name)} value={binding.value as number | undefined} onChange={binding.onChange} />;
    case 'date-bound':
      throw new Error(`筛选键「${name}」是时间范围端点，请成对声明：['${name}', '<止端键>']`);
    default:
      throw new Error(`筛选键「${name}」在契约 query 上没有 x-filter 语义，请在 overrides 里给出控件`);
  }
}

export interface ContractFiltersInput<TSearch> {
  readonly page: FilterPageLike<TSearch>;
  readonly specs: ReadonlyArray<FilterSpec<TSearch>>;
  readonly overrides?: FilterOverrides<TSearch>;
}

/**
 * 把声明的筛选键渲染成控件，并按工具栏槽位拆分：关键字类进 `keyword`（桌面 / 移动主区），其余进 `filters`（移动端进抽屉）。
 * 纯函数：控件本身（`DictSelect`）内部才调用 hooks。
 */
export function deriveFilterControls<TSearch>({ page, specs, overrides }: ContractFiltersInput<TSearch>): { keyword: ReactNode[]; filters: ReactNode[] } {
  const shape = page.filterSchema?.shape ?? {};
  const keyword: ReactNode[] = [];
  const filters: ReactNode[] = [];
  for (const spec of specs) {
    if (typeof spec !== 'string') {
      const override = overrides?.[spec[0]];
      filters.push(override ? <Fragment key={specKey(spec)}>{override(page)}</Fragment> : <DateRangeFilter key={specKey(spec)} {...page.bindRange(spec)} />);
      continue;
    }
    const field = shape[spec] as z.ZodType | undefined;
    const meta = filterMetaOf(field);
    const override = overrides?.[spec];
    const node = override ? <Fragment key={spec}>{override(page)}</Fragment> : renderControl(page, spec, field, meta);
    (meta?.kind === 'keyword' ? keyword : filters).push(node);
  }
  return { keyword, filters };
}
