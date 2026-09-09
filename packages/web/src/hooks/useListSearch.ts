import { useCallback, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { QueryKey } from '@tanstack/react-query';
import { usePagination, type UsePaginationReturn } from '@/hooks/usePagination';

export interface UseListSearchOptions<T> {
  /**
   * 搜索条件的初始值；「重置」会回到这里。
   * 传函数时按 React 的惰性初始化约定处理，且**每次重置都会重新求值**——
   * 用于「最近 7 天」这类相对当前时间计算的默认条件。
   */
  readonly defaults: T | (() => T);
  /** 「查询 / 重置」时要失效的列表 key，通常是域 hooks 的 `xxxKeys.lists` */
  readonly listKey: QueryKey;
  /** 同一页面还驱动了其它列表时，在此追加它们的 key */
  readonly extraKeys?: readonly QueryKey[];
  /** 覆盖默认页大小（默认取用户偏好） */
  readonly pageSize?: number;
  /** 查询后的额外副作用，如清空已选中的行 */
  readonly onSearch?: () => void;
  /** 重置后的额外副作用 */
  readonly onReset?: () => void;
}

export interface UseListSearchReturn<T> extends UsePaginationReturn {
  /** 绑定到输入框；变化不触发请求 */
  readonly draftParams: T;
  readonly setDraftParams: React.Dispatch<React.SetStateAction<T>>;
  /**
   * 单个草稿字段的 setter。受控筛选控件优先用 `bind` / `bindKeyword` 整体绑定；
   * 只有控件不是 `value` / `onChange` 形态（如 `Checkbox` 的 `checked` + `e.target.checked`）时才直接用它：
   * `onChange={(e) => setField('archived')(!!e.target.checked)}`。
   * 同一 key 跨渲染返回同一引用，可直接交给 memo 化的子组件。
   * 一次改多个字段仍用 `setDraftParams((p) => ({ ...p, a, b }))`。
   */
  readonly setField: <K extends keyof T>(key: K) => (value: T[K]) => void;
  /**
   * 受控筛选控件的标准绑定：`<StatusSelect items={statusItems} {...bind('status')} />`，
   * 展开为 `value={draftParams.status} onChange={setField('status')}`。
   * 控件回传类型比字段宽（枚举收窄、`null` / `undefined` 归一）时传 `parse`：
   * `{...bind('status', (v) => enumValueOf(STATUSES, v))}`；`parse` 的入参即控件 `onChange` 的实参。
   */
  readonly bind: {
    <K extends keyof T>(key: K): { readonly value: T[K]; readonly onChange: (value: T[K]) => void };
    <K extends keyof T, R = unknown>(key: K, parse: (raw: R) => T[K]): { readonly value: T[K]; readonly onChange: (raw: NoInfer<R>) => void };
  };
  /**
   * 关键字输入框绑定：`<KeywordInput placeholder="搜索名称" {...bindKeyword('keyword')} />`，
   * 在 `bind` 之上再接回车触发查询的 `onSearch`。只用于 `KeywordInput`——
   * 下拉类控件的 `onSearch` 是 Semi 的下拉搜索回调，不能混入。
   */
  readonly bindKeyword: <K extends keyof T>(key: K) => { readonly value: T[K]; readonly onChange: (value: T[K]) => void; readonly onSearch: () => void };
  /** 进入 query key；变化自动触发请求 */
  readonly submittedParams: T;
  /** 提交草稿条件、回到第 1 页，并强制失效列表 */
  readonly handleSearch: () => void;
  /**
   * 以指定条件立即查询（点击部门树、标签、保存的视图等「不经输入框直接筛选」的场景）。
   * 同步更新 draft 与 submitted，并同样保证回源——
   * 因此**不要**为这类场景去改 `submittedParams` 的裸 setter，那会绕过页码重置与失效。
   */
  readonly applySearch: (params: T) => void;
  /** 清空条件、回到第 1 页，并强制失效列表 */
  readonly handleReset: () => void;
}

/**
 * 列表页搜索状态。
 *
 * 把此前每个列表页手抄一遍的三件套收敛到一处：
 * `draft`/`submitted` 双状态、页码重置、以及**查询/重置必回源**的失效调用。
 *
 * ## 为什么必须失效
 * 条件没变化时 query key 不变，`staleTime` 内 TanStack Query 不会重新发请求。
 * 但本系统的「查询」按钮兼具刷新语义——用户点它就是想看最新数据。
 * 手写这段样板时很容易漏掉 `invalidateQueries`，页面表现为「点查询没反应」，
 * 且因为列表仍有数据、不报错，极难被发现。契约焊在 hook 里，调用方漏不掉。
 *
 * @example
 * const {
 *   page, pageSize, buildPagination,
 *   bind, bindKeyword, submittedParams,
 *   handleSearch, handleReset,
 * } = useListSearch<SearchParams>({ defaults: defaultSearchParams, listKey: tagKeys.lists });
 *
 * const listQuery = useTagList({ page, pageSize, keyword: submittedParams.keyword || undefined });
 * <KeywordInput placeholder="搜索名称" {...bindKeyword('keyword')} />
 * <StatusSelect items={statusItems} {...bind('status')} />
 */
export function useListSearch<T>({
  defaults,
  listKey,
  extraKeys,
  pageSize: overridePageSize,
  onSearch,
  onReset,
}: UseListSearchOptions<T>): UseListSearchReturn<T> {
  const queryClient = useQueryClient();
  const pagination = usePagination(overridePageSize);
  const { setPage } = pagination;

  const [draftParams, setDraftParams] = useState<T>(defaults);
  const [submittedParams, setSubmittedParams] = useState<T>(defaults);

  // setDraftParams 本身稳定，按 key 缓存后 setField('x') 每次渲染都返回同一函数
  const fieldSetters = useRef(new Map<keyof T, (value: unknown) => void>());
  const setField = useCallback(<K extends keyof T>(key: K) => {
    let setter = fieldSetters.current.get(key);
    if (!setter) {
      setter = (value: unknown) => setDraftParams((prev) => ({ ...prev, [key]: value }) as T);
      fieldSetters.current.set(key, setter);
    }
    return setter as (value: T[K]) => void;
  }, []);

  const invalidate = useCallback(() => {
    for (const queryKey of [listKey, ...(extraKeys ?? [])]) {
      void queryClient.invalidateQueries({ queryKey });
    }
    // key 通常是页面里的字面量数组，每次渲染引用都不同，按值快照做依赖
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queryClient, JSON.stringify(listKey), JSON.stringify(extraKeys)]);

  const applySearch = useCallback((params: T) => {
    setPage(1);
    setDraftParams(params);
    setSubmittedParams(params);
    invalidate();
    onSearch?.();
  }, [setPage, invalidate, onSearch]);

  const handleSearch = useCallback(() => {
    setPage(1);
    setSubmittedParams(draftParams);
    invalidate();
    onSearch?.();
  }, [setPage, draftParams, invalidate, onSearch]);

  const handleReset = useCallback(() => {
    // defaults 为函数时每次重置都重新求值，保证「最近 7 天」这类相对区间是最新的
    const next = typeof defaults === 'function' ? (defaults as () => T)() : defaults;
    setPage(1);
    setDraftParams(next);
    setSubmittedParams(next);
    invalidate();
    onReset?.();
  }, [setPage, invalidate, onReset, defaults]);

  const bind = useCallback(<K extends keyof T, R>(key: K, parse?: (raw: R) => T[K]) => {
    const setter = setField(key);
    return {
      value: draftParams[key],
      onChange: parse ? (raw: R) => setter(parse(raw)) : setter,
    };
  }, [draftParams, setField]) as UseListSearchReturn<T>['bind'];

  const bindKeyword = useCallback(<K extends keyof T>(key: K) => ({
    value: draftParams[key],
    onChange: setField(key),
    onSearch: handleSearch,
  }), [draftParams, setField, handleSearch]);

  return {
    ...pagination,
    draftParams,
    setDraftParams,
    setField,
    bind,
    bindKeyword,
    submittedParams,
    handleSearch,
    applySearch,
    handleReset,
  };
}
