import { createPreferencesContext } from '@/test-utils/preferences';
/**
 * useListPage 契约测试：搜索状态 → 筛选映射 → 列表查询 → 表格 props 一次接好，
 * 锁住「查询参数只含 page / pageSize + compact 后的 toQuery 结果」「查询 / 重置回源」「表格接线含分页与多选」。
 */
import { describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { act, renderHook } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import { createTestQueryClient, isInvalidated } from '@/test-utils/query-harness';
import { PreferencesContext } from '@/hooks/usePreferences';
import * as z from 'zod';
import { contractKey } from '@/lib/contract-query';
import { dateRangeQuery, defineContract, entityStatusQuery, idParam, keywordQuery, op, paginated, paginationQuery } from '@zenith/shared/core';
import { useListPage } from './useListPage';

interface Row { id: number; name: string }
interface SearchParams { keyword: string; status?: string }
const defaults: SearchParams = { keyword: '', status: undefined };
const listKey = ['rows', 'list'] as const;

const useListMock = vi.fn((params: { page: number; pageSize: number; keyword?: string; status?: 'enabled' | 'disabled' }, enabled?: boolean) => ({
  data: { list: [{ id: 1, name: `p${params.page}` }] as Row[], total: 42 },
  isFetching: false,
  refetch: vi.fn(),
  enabled,
}));

function createWrapper(client: ReturnType<typeof createTestQueryClient>) {
  const preferences = createPreferencesContext();
  return function Wrapper({ children }: { readonly children: ReactNode }) {
    return (
      <QueryClientProvider client={client}>
        <PreferencesContext.Provider value={preferences}>{children}</PreferencesContext.Provider>
      </QueryClientProvider>
    );
  };
}

function setup() {
  const client = createTestQueryClient();
  client.setQueryData([...listKey, { page: 1 }], { list: [], total: 0 });
  const Wrapper = createWrapper(client);
  const view = renderHook(() => useListPage({
    defaults,
    listKey,
    useList: useListMock,
    toQuery: (s) => ({ keyword: s.keyword, status: s.status as 'enabled' | 'disabled' | undefined }),
    table: { empty: '暂无数据' },
  }), { wrapper: Wrapper });
  return { ...view, client };
}

describe('useListPage', () => {
  it('列表查询参数 = page / pageSize + compact 后的 toQuery 结果；filterQuery 不含分页', () => {
    const { result } = setup();
    expect(useListMock).toHaveBeenLastCalledWith({ page: 1, pageSize: 10 }, undefined);
    expect(result.current.filterQuery).toEqual({});

    act(() => { result.current.setField('keyword')('abc'); result.current.setField('status')('enabled'); });
    // 草稿变化不触发查询参数变化
    expect(useListMock).toHaveBeenLastCalledWith({ page: 1, pageSize: 10 }, undefined);

    act(() => { result.current.handleSearch(); });
    expect(useListMock).toHaveBeenLastCalledWith({ page: 1, pageSize: 10, keyword: 'abc', status: 'enabled' }, undefined);
    expect(result.current.filterQuery).toEqual({ keyword: 'abc', status: 'enabled' });
  });

  it('查询 / 重置失效 listKey（继承 useListSearch 的回源契约）', () => {
    const { result, client } = setup();
    act(() => { result.current.handleSearch(); });
    expect(isInvalidated(client, [...listKey, { page: 1 }])).toBe(true);
  });

  it('tableProps 接好数据源 / 分页 / 空态，翻页驱动查询参数', () => {
    const { result } = setup();
    expect(result.current.tableProps.dataSource).toEqual([{ id: 1, name: 'p1' }]);
    expect(result.current.tableProps.empty).toBe('暂无数据');
    expect(result.current.tableProps.rowKey).toBe('id');
    const pagination = result.current.tableProps.pagination;
    expect(pagination && pagination.total).toBe(42);

    act(() => { if (pagination) pagination.onPageChange(3); });
    expect(useListMock).toHaveBeenLastCalledWith({ page: 3, pageSize: 10 }, undefined);
    expect(result.current.listQuery.data?.list[0]?.name).toBe('p3');
  });
});

// ─── 契约模式 ────────────────────────────────────────────────────────────────

const rowSchema = z.object({ id: z.int(), name: z.string() });
const rowContract = defineContract('/api/test-rows', {
  list: op.get('/', { access: 'authenticated', query: paginationQuery.extend({ keyword: keywordQuery('名称'), status: entityStatusQuery, ...dateRangeQuery('创建时间') }), response: paginated(rowSchema), summary: 'list' }),
  detail: op.get('/{id}', { access: 'authenticated', params: idParam, response: rowSchema, summary: 'detail' }),
  events: op.get('/events', { access: 'authenticated', query: paginationQuery.extend({ level: keywordQuery('级别') }), response: paginated(rowSchema), summary: 'events' }),
});

const useContractListMock = vi.fn((params: { page: number; pageSize: number; keyword?: string; status?: 'enabled' | 'disabled'; startTime?: string; endTime?: string }, enabled?: boolean) => ({
  data: { list: [{ id: 1, name: `p${params.page}` }] as Row[], total: 42 },
  isFetching: false,
  refetch: vi.fn(),
  enabled,
}));

function setupContract(defaults?: { status?: 'enabled' | 'disabled' }) {
  const client = createTestQueryClient();
  const listsKey = contractKey(rowContract.list);
  client.setQueryData([...listsKey, { page: 1 }], { list: [], total: 0 });
  const view = renderHook(() => useListPage({ contract: rowContract, useList: useContractListMock, defaults }), { wrapper: createWrapper(client) });
  return { ...view, client, listsKey };
}

describe('useListPage · 契约模式', () => {
  it('操作模式：列表为契约子操作时，筛选状态 / listKey / filterSchema 取该操作', () => {
    const useEventsMock = vi.fn((params: { page: number; pageSize: number; level?: string }, enabled?: boolean) => ({
      data: { list: [] as Row[], total: 0 }, isFetching: false, refetch: vi.fn(), enabled, params,
    }));
    const client = createTestQueryClient();
    const eventsKey = contractKey(rowContract.events);
    client.setQueryData([...eventsKey, { page: 1 }], { list: [], total: 0 });
    const { result } = renderHook(() => useListPage({ op: rowContract.events, useList: useEventsMock }), { wrapper: createWrapper(client) });
    expect(result.current.filterSchema).toBe(rowContract.events.query);
    act(() => { result.current.setField('level')('error'); });
    act(() => { result.current.handleSearch(); });
    expect(useEventsMock).toHaveBeenLastCalledWith({ page: 1, pageSize: 10, level: 'error' }, undefined);
    expect(isInvalidated(client, [...eventsKey, { page: 1 }])).toBe(true);
  });

  it('筛选状态即契约 query（去分页键）；listKey 取 contractKey(contract.list)，与 createResourceQueries 同键', () => {
    const { result, client, listsKey } = setupContract();
    expect(useContractListMock).toHaveBeenLastCalledWith({ page: 1, pageSize: 10 }, undefined);
    expect(result.current.filterSchema).toBe(rowContract.list.query);

    act(() => { result.current.setField('keyword')('abc'); result.current.setField('status')('enabled'); });
    act(() => { result.current.handleSearch(); });
    expect(useContractListMock).toHaveBeenLastCalledWith({ page: 1, pageSize: 10, keyword: 'abc', status: 'enabled' }, undefined);
    expect(result.current.filterQuery).toEqual({ keyword: 'abc', status: 'enabled' });
    expect(isInvalidated(client, [...listsKey, { page: 1 }])).toBe(true);
  });

  it('defaults 作为初始筛选并在重置时恢复', () => {
    const { result } = setupContract({ status: 'disabled' });
    expect(useContractListMock).toHaveBeenLastCalledWith({ page: 1, pageSize: 10, status: 'disabled' }, undefined);
    act(() => { result.current.setField('status')('enabled'); });
    act(() => { result.current.handleSearch(); });
    expect(useContractListMock).toHaveBeenLastCalledWith({ page: 1, pageSize: 10, status: 'enabled' }, undefined);
    act(() => { result.current.handleReset(); });
    expect(useContractListMock).toHaveBeenLastCalledWith({ page: 1, pageSize: 10, status: 'disabled' }, undefined);
  });

  it('bindRange 把 [Date, Date] 写回契约的起 / 止端点（YYYY-MM-DD HH:mm:ss），清空回到 undefined', () => {
    const { result } = setupContract();
    const range = result.current.bindRange(['startTime', 'endTime']);
    expect(range.value).toBeNull();
    act(() => { range.onChange([new Date(2026, 8, 1, 0, 0, 0), new Date(2026, 8, 30, 23, 59, 59)]); });
    expect(result.current.draftParams).toEqual({ startTime: '2026-09-01 00:00:00', endTime: '2026-09-30 23:59:59' });
    expect(result.current.bindRange(['startTime', 'endTime']).value).toEqual([new Date('2026-09-01 00:00:00'), new Date('2026-09-30 23:59:59')]);
    act(() => { result.current.handleSearch(); });
    expect(useContractListMock).toHaveBeenLastCalledWith({ page: 1, pageSize: 10, startTime: '2026-09-01 00:00:00', endTime: '2026-09-30 23:59:59' }, undefined);
    act(() => { result.current.bindRange(['startTime', 'endTime']).onChange(null); });
    expect(result.current.draftParams).toEqual({ startTime: undefined, endTime: undefined });
  });

  it('toolbarProps 即查询 / 重置，引用随 handleSearch 稳定', () => {
    const { result } = setupContract();
    expect(result.current.toolbarProps).toEqual({ onSearch: result.current.handleSearch, onReset: result.current.handleReset });
  });
});
