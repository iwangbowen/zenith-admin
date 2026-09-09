/**
 * useListSearch 契约测试。
 *
 * 核心是锁住「**查询 / 重置必回源**」——条件没变化时 query key 不变，
 * staleTime 内不会重新发请求，而本系统的「查询」按钮兼具刷新语义。
 * 此前这段样板由每个列表页手抄，91 个页面里有 5 个漏了 invalidateQueries，
 * 表现为「点查询没反应」且不报错。契约焊进 hook 后，调用方漏不掉。
 */
import { describe, it, expect, vi } from 'vitest';
import type { ReactNode } from 'react';
import { act, renderHook } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import { createTestQueryClient, isInvalidated } from '@/test-utils/query-harness';
import { PreferencesContext, defaultPreferences } from '@/hooks/usePreferences';
import type { PreferencesContextValue } from '@/hooks/usePreferences';
import { useListSearch } from './useListSearch';

interface SearchParams {
  keyword: string;
  status: string;
}
const defaults: SearchParams = { keyword: '', status: '' };
const listKey = ['tags', 'list'] as const;
const otherKey = ['groups', 'list'] as const;

function setup(options?: Partial<Parameters<typeof useListSearch<SearchParams>>[0]>) {
  const client = createTestQueryClient();
  // 预置两条已存在的列表缓存，用于观察是否被失效
  client.setQueryData([...listKey, { page: 1 }], { list: [], total: 0 });
  client.setQueryData([...otherKey, { page: 1 }], { list: [], total: 0 });

  const preferences = {
    preferences: defaultPreferences,
    updatePreferences: vi.fn(),
    resetPreferences: vi.fn(),
  } as unknown as PreferencesContextValue;

  function Wrapper({ children }: { readonly children: ReactNode }) {
    return (
      <QueryClientProvider client={client}>
        <PreferencesContext.Provider value={preferences}>{children}</PreferencesContext.Provider>
      </QueryClientProvider>
    );
  }

  const view = renderHook(
    () => useListSearch<SearchParams>({ defaults, listKey, ...options }),
    { wrapper: Wrapper },
  );
  return { ...view, client };
}

describe('查询 / 重置必回源（核心契约）', () => {
  it('handleSearch 失效列表缓存，即使搜索条件没有任何变化', () => {
    const { result, client } = setup();
    expect(isInvalidated(client, [...listKey, { page: 1 }])).toBe(false);

    act(() => { result.current.handleSearch(); });

    expect(isInvalidated(client, [...listKey, { page: 1 }])).toBe(true);
  });

  it('handleReset 同样失效列表缓存', () => {
    const { result, client } = setup();
    act(() => { result.current.handleReset(); });
    expect(isInvalidated(client, [...listKey, { page: 1 }])).toBe(true);
  });

  it('extraKeys 一并失效（一个页面驱动多个列表时）', () => {
    const { result, client } = setup({ extraKeys: [otherKey] });
    act(() => { result.current.handleSearch(); });
    expect(isInvalidated(client, [...listKey, { page: 1 }])).toBe(true);
    expect(isInvalidated(client, [...otherKey, { page: 1 }])).toBe(true);
  });

  it('未声明 extraKeys 时不误伤其它域的缓存', () => {
    const { result, client } = setup();
    act(() => { result.current.handleSearch(); });
    expect(isInvalidated(client, [...otherKey, { page: 1 }])).toBe(false);
  });
});

describe('draft / submitted 双状态', () => {
  it('改 draft 不影响 submitted（输入过程不触发请求）', () => {
    const { result } = setup();
    act(() => { result.current.setDraftParams((p) => ({ ...p, keyword: 'abc' })); });
    expect(result.current.draftParams.keyword).toBe('abc');
    expect(result.current.submittedParams.keyword).toBe('');
  });

  it('handleSearch 才把 draft 提交进 submitted', () => {
    const { result } = setup();
    act(() => { result.current.setDraftParams((p) => ({ ...p, keyword: 'abc' })); });
    act(() => { result.current.handleSearch(); });
    expect(result.current.submittedParams.keyword).toBe('abc');
  });

  it('handleReset 把 draft 与 submitted 一并清回默认值', () => {
    const { result } = setup();
    act(() => { result.current.setDraftParams({ keyword: 'abc', status: 'enabled' }); });
    act(() => { result.current.handleSearch(); });
    act(() => { result.current.handleReset(); });
    expect(result.current.draftParams).toEqual(defaults);
    expect(result.current.submittedParams).toEqual(defaults);
  });
});

describe('setField 单字段绑定', () => {
  it('只改指定字段，其余草稿字段保持不变', () => {
    const { result } = setup();
    act(() => { result.current.setField('status')('enabled'); });
    act(() => { result.current.setField('keyword')('abc'); });
    expect(result.current.draftParams).toEqual({ keyword: 'abc', status: 'enabled' });
    expect(result.current.submittedParams).toEqual(defaults);
  });

  it('同一 tick 内连续写不同字段互不覆盖（函数式更新）', () => {
    const { result } = setup();
    act(() => {
      result.current.setField('keyword')('abc');
      result.current.setField('status')('enabled');
    });
    expect(result.current.draftParams).toEqual({ keyword: 'abc', status: 'enabled' });
  });

  it('同一 key 跨渲染返回同一引用，可安全交给 memo 化子组件', () => {
    const { result } = setup();
    const first = result.current.setField('keyword');
    act(() => { first('abc'); });
    expect(result.current.setField('keyword')).toBe(first);
    expect(result.current.setField('status')).not.toBe(first);
  });

  it('handleReset 后 setField 仍作用于最新草稿', () => {
    const { result } = setup();
    act(() => { result.current.setField('keyword')('abc'); });
    act(() => { result.current.handleReset(); });
    act(() => { result.current.setField('status')('disabled'); });
    expect(result.current.draftParams).toEqual({ keyword: '', status: 'disabled' });
  });
});

describe('页码联动', () => {
  it('handleSearch 回到第 1 页（避免停在越界页看到空列表）', () => {
    const { result } = setup();
    act(() => { result.current.setPage(3); });
    expect(result.current.page).toBe(3);
    act(() => { result.current.handleSearch(); });
    expect(result.current.page).toBe(1);
  });

  it('handleReset 同样回到第 1 页', () => {
    const { result } = setup();
    act(() => { result.current.setPage(5); });
    act(() => { result.current.handleReset(); });
    expect(result.current.page).toBe(1);
  });

  it('透传 usePagination 的 buildPagination', () => {
    const { result } = setup();
    const config = result.current.buildPagination(42);
    expect(config).toMatchObject({ currentPage: 1, total: 42 });
  });

  it('pageSize 可被调用方覆盖', () => {
    const { result } = setup({ pageSize: 50 });
    expect(result.current.pageSize).toBe(50);
  });
});

describe('额外副作用回调', () => {
  it('onSearch / onReset 在对应动作后触发（如清空已选中的行）', () => {
    const onSearch = vi.fn();
    const onReset = vi.fn();
    const { result } = setup({ onSearch, onReset });

    act(() => { result.current.handleSearch(); });
    expect(onSearch).toHaveBeenCalledTimes(1);
    expect(onReset).not.toHaveBeenCalled();

    act(() => { result.current.handleReset(); });
    expect(onReset).toHaveBeenCalledTimes(1);
    expect(onSearch).toHaveBeenCalledTimes(1);
  });
});
