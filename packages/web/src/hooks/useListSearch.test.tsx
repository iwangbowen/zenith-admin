import { createPreferencesContext } from '@/test-utils/preferences';
/**
 * useListSearch 契约测试。
 *
 * 核心是锁住「**查询 / 重置必回源**」——条件没变化时 query key 不变，
 * staleTime 内不会重新发请求，而本系统的「查询」按钮兼具刷新语义。
 * 此前这段样板由每个列表页手抄，91 个页面里有 5 个漏了 invalidateQueries，
 * 表现为「点查询没反应」且不报错。契约焊进 hook 后，调用方漏不掉。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ReactNode } from 'react';
import { act, renderHook } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import { createTestQueryClient, isInvalidated } from '@/test-utils/query-harness';
import { PreferencesContext, defaultPreferences } from '@/hooks/usePreferences';
import { readListFilterSnapshot, writeListFilterSnapshot } from '@/lib/list-filter-memory';
import { useListSearch } from './useListSearch';

interface SearchParams {
  keyword: string;
  status: string;
}
const defaults: SearchParams = { keyword: '', status: '' };
const listKey = ['tags', 'list'] as const;
const otherKey = ['groups', 'list'] as const;

function setup(options?: Partial<Parameters<typeof useListSearch<SearchParams>>[0]>, prefOverrides?: Partial<typeof defaultPreferences>) {
  const client = createTestQueryClient();
  // 预置两条已存在的列表缓存，用于观察是否被失效
  client.setQueryData([...listKey, { page: 1 }], { list: [], total: 0 });
  client.setQueryData([...otherKey, { page: 1 }], { list: [], total: 0 });

  const preferences = createPreferencesContext(prefOverrides);

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

  it('refetchOnSearch: false 显式关闭回源：静态数据集只重新过滤，查询 / 重置都不失效缓存', () => {
    const { result, client } = setup({ refetchOnSearch: false, extraKeys: [otherKey] });
    act(() => { result.current.setField('keyword')('a'); });
    act(() => { result.current.handleSearch(); });
    expect(result.current.submittedParams.keyword).toBe('a');
    expect(isInvalidated(client, [...listKey, { page: 1 }])).toBe(false);
    expect(isInvalidated(client, [...otherKey, { page: 1 }])).toBe(false);

    act(() => { result.current.applySearch({ keyword: 'b', status: '' }); });
    act(() => { result.current.handleReset(); });
    expect(result.current.submittedParams).toEqual(defaults);
    expect(isInvalidated(client, [...listKey, { page: 1 }])).toBe(false);
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

  it('resetKey 变化时回到第 1 页、条件保留；重渲染但键不变则页码不动', () => {
    const client = createTestQueryClient();
    const preferences = createPreferencesContext();
    const view = renderHook(
      ({ scope }: { scope: number }) => useListSearch<SearchParams>({ defaults, listKey, resetKey: scope }),
      {
        initialProps: { scope: 1 },
        wrapper: ({ children }) => (
          <QueryClientProvider client={client}>
            <PreferencesContext.Provider value={preferences}>{children}</PreferencesContext.Provider>
          </QueryClientProvider>
        ),
      },
    );
    act(() => { view.result.current.setField('keyword')('abc'); });
    act(() => { view.result.current.handleSearch(); });
    act(() => { view.result.current.setPage(4); });
    expect(view.result.current.page).toBe(4);

    view.rerender({ scope: 1 });
    expect(view.result.current.page).toBe(4);

    view.rerender({ scope: 2 });
    expect(view.result.current.page).toBe(1);
    expect(view.result.current.submittedParams.keyword).toBe('abc');
  });

  it('resetKey 为数组时按元素比较：同值新数组不重置，任一元素变化才重置', () => {
    const client = createTestQueryClient();
    const preferences = createPreferencesContext();
    const view = renderHook(
      ({ spaceId, folderId }: { spaceId: number; folderId: number | null }) => useListSearch<SearchParams>({ defaults, listKey, resetKey: [spaceId, folderId] }),
      {
        initialProps: { spaceId: 1, folderId: null as number | null },
        wrapper: ({ children }) => (
          <QueryClientProvider client={client}>
            <PreferencesContext.Provider value={preferences}>{children}</PreferencesContext.Provider>
          </QueryClientProvider>
        ),
      },
    );
    act(() => { view.result.current.setPage(3); });
    view.rerender({ spaceId: 1, folderId: null });
    expect(view.result.current.page).toBe(3);
    view.rerender({ spaceId: 1, folderId: 7 });
    expect(view.result.current.page).toBe(1);
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

describe('bind / bindKeyword 受控控件绑定', () => {
  it('bind 展开为当前草稿值 + 该字段的 setter', () => {
    const { result } = setup();
    expect(result.current.bind('status').value).toBe('');
    expect(result.current.bind('status').onChange).toBe(result.current.setField('status'));

    act(() => { result.current.bind('status').onChange('enabled'); });
    expect(result.current.draftParams).toEqual({ keyword: '', status: 'enabled' });
    expect(result.current.bind('status').value).toBe('enabled');
  });

  it('bind 带 parse 时先把控件回传值收窄再写入字段', () => {
    const { result } = setup();
    const parse = (raw: unknown) => (raw === 'enabled' || raw === 'disabled' ? raw : '');

    act(() => { result.current.bind('status', parse).onChange('enabled'); });
    expect(result.current.draftParams.status).toBe('enabled');

    act(() => { result.current.bind('status', parse).onChange('bogus'); });
    expect(result.current.draftParams.status).toBe('');
  });

  it('bindKeyword 额外接回车查询：onSearch 即 handleSearch，提交草稿并回源', () => {
    const { result, client } = setup();
    expect(result.current.bindKeyword('keyword').onSearch).toBe(result.current.handleSearch);

    act(() => { result.current.bindKeyword('keyword').onChange('abc'); });
    expect(result.current.submittedParams.keyword).toBe('');

    act(() => { result.current.bindKeyword('keyword').onSearch(); });
    expect(result.current.submittedParams.keyword).toBe('abc');
    expect(isInvalidated(client, [...listKey, { page: 1 }])).toBe(true);
  });
});

describe('偏好「记住列表筛选条件」', () => {
  beforeEach(() => { sessionStorage.clear(); });

  it('关闭时既不读也不写快照（默认行为不变）', () => {
    writeListFilterSnapshot(listKey, { keyword: 'stale', status: 'enabled' });
    const { result } = setup();
    expect(result.current.submittedParams).toEqual(defaults);

    act(() => { result.current.setField('keyword')('abc'); });
    act(() => { result.current.handleSearch(); });
    expect(readListFilterSnapshot(listKey)).toEqual({ keyword: 'stale', status: 'enabled' });
  });

  it('开启时查询写入快照，重新挂载以快照替代 defaults 作为初始条件', () => {
    const first = setup(undefined, { rememberListFilters: true });
    act(() => { first.result.current.setField('keyword')('abc'); });
    act(() => { first.result.current.setField('status')('enabled'); });
    act(() => { first.result.current.handleSearch(); });
    expect(readListFilterSnapshot(listKey)).toEqual({ keyword: 'abc', status: 'enabled' });
    first.unmount();

    const second = setup(undefined, { rememberListFilters: true });
    expect(second.result.current.draftParams).toEqual({ keyword: 'abc', status: 'enabled' });
    expect(second.result.current.submittedParams).toEqual({ keyword: 'abc', status: 'enabled' });
    // 只记条件不记页码
    expect(second.result.current.page).toBe(1);
  });

  it('applySearch 同样写入，重置清除快照并回到 defaults', () => {
    const { result } = setup(undefined, { rememberListFilters: true });
    act(() => { result.current.applySearch({ keyword: 'x', status: 'disabled' }); });
    expect(readListFilterSnapshot(listKey)).toEqual({ keyword: 'x', status: 'disabled' });

    act(() => { result.current.handleReset(); });
    expect(readListFilterSnapshot(listKey)).toBeUndefined();
    expect(result.current.submittedParams).toEqual(defaults);
  });

  it('快照缺少的字段回落到 defaults（契约新增筛选字段后旧快照仍可用）', () => {
    writeListFilterSnapshot(listKey, { keyword: 'partial' });
    const { result } = setup(undefined, { rememberListFilters: true });
    expect(result.current.submittedParams).toEqual({ keyword: 'partial', status: '' });
  });
});
