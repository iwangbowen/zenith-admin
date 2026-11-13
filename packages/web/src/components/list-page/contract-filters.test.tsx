import { createPreferencesContext } from '@/test-utils/preferences';
/**
 * 保留筛选参数语义、操作权限及删除载荷边界，不限定列宽、动作顺序或展示文案。
 */
import { fireEvent, render, renderHook,} from '@testing-library/react';
import type { ModalReactProps } from '@douyinfe/semi-ui/lib/es/modal';
import { QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as z from 'zod';
import { dateRangeQuery, defineContract, entityStatusQuery, idParam, idQuery, keywordQuery, op, paginated, paginationQuery, queryBool, queryEnum } from '@zenith/shared/core';
import { PermissionContext } from '@/hooks/usePermission';
import { PreferencesContext } from '@/hooks/usePreferences';
import { useListPage } from '@/hooks/useListPage';
import { createTestQueryClient } from '@/test-utils/query-harness';
import { deriveFilterControls } from './ContractFilters';
import { useCrudOperationColumn } from './useCrudOperationColumn';
import type { CrudPermissionPrefix, Permission } from '@zenith/shared/core';

const confirmCalls = vi.hoisted(() => [] as ModalReactProps[]);
vi.mock('@douyinfe/semi-ui', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@douyinfe/semi-ui')>();
  Object.assign(actual.Modal, { confirm: (config: ModalReactProps) => { confirmCalls.push(config); return { destroy() {}, update() {} }; } });
  return actual;
});
vi.mock('@/hooks/useDictItems', () => ({
  useDictItems: (code: string) => ({
    items: [], loading: false, getLabel: (v: string) => v, getColor: () => undefined,
    options: code === 'common_status' ? [{ value: 'enabled', label: '启用' }, { value: 'disabled', label: '禁用' }] : [{ value: 'a', label: '甲' }],
  }),
}));

const rowSchema = z.object({ id: z.int(), name: z.string() });
const rowContract = defineContract('/api/test-filter-rows', {
  list: op.get('/', { access: 'authenticated',
    query: paginationQuery.extend({
      keyword: keywordQuery('名称 / 编码'),
      status: entityStatusQuery,
      level: queryEnum(['low', 'high'], { description: '等级；空 = 全部', options: [{ value: 'low', label: '低' }, { value: 'high', label: '高' }] }),
      kind: queryEnum(['x', 'y'], { description: '类型', dict: 'demo_kind' }),
      pinned: queryBool('是否置顶'),
      enabled: queryBool('启用状态', { labels: ['已启用', '已停用'] }),
      channelId: idQuery('栏目 ID'),
      ...dateRangeQuery('创建时间'),
      plain: z.string().optional(),
    }),
    response: paginated(rowSchema),
    summary: 'list',
  }),
  detail: op.get('/{id}', { access: 'authenticated', params: idParam, response: rowSchema, summary: 'detail' }),
});

const useListMock = vi.fn(() => ({ data: { list: [] as Array<{ id: number; name: string }>, total: 0 }, isFetching: false, refetch: vi.fn() }));

function wrapper(permissions: string[] = []) {
  const client = createTestQueryClient();
  const preferences = createPreferencesContext();
  return function Wrapper({ children }: { readonly children: ReactNode }) {
    return (
      <QueryClientProvider client={client}>
        <PreferencesContext.Provider value={preferences}>
          <PermissionContext.Provider value={permissions}>{children}</PermissionContext.Provider>
        </PreferencesContext.Provider>
      </QueryClientProvider>
    );
  };
}

beforeEach(() => { confirmCalls.length = 0; });
afterEach(() => { vi.restoreAllMocks(); });

describe('deriveFilterControls / ListSearchToolbar 契约写法', () => {
  it('未声明 x-filter 语义的键与单独出现的范围端点直接报错，而不是渲染空控件', () => {
    const page = renderHook(() => useListPage({ contract: rowContract, useList: useListMock }), { wrapper: wrapper() }).result.current;
    expect(() => deriveFilterControls({ page, specs: ['plain'] })).toThrow(/plain/);
    expect(() => deriveFilterControls({ page, specs: ['startTime'] })).toThrow(/成对/);
  });
});

describe('useCrudOperationColumn', () => {
  interface Row { id: number; name: string }
  const record: Row = { id: 7, name: '甲' };

  it('权限前缀派生 :update / :delete 门控，确认删除后按 [id] 调 mutateAsync', async () => {
    const openEdit = vi.fn();
    const mutateAsync = vi.fn().mockResolvedValue(null);
    const { result } = renderHook(() => useCrudOperationColumn<Row>({ permission: 'demo:item' as CrudPermissionPrefix, edit: { openEdit }, remove: { mutateAsync }, label: (r) => r.name, content: '不可恢复' }), { wrapper: wrapper(['demo:item:update', 'demo:item:delete']) });
    const cell = render(<>{result.current.render?.(undefined, record, 0)}</>);
    fireEvent.click(cell.getByRole('button', { name: '编辑' }));
    expect(openEdit).toHaveBeenCalledWith(record);
    fireEvent.click(cell.getByRole('button', { name: '删除' }));
    expect(confirmCalls).toHaveLength(1);
    expect(mutateAsync).not.toHaveBeenCalled();
    await (confirmCalls[0].onOk as () => Promise<void>)();
    expect(mutateAsync).toHaveBeenCalledWith([7]);
  });

  it('无权限时不提供编辑和删除动作', () => {
    const { result } = renderHook(() => useCrudOperationColumn<Row>({
      permission: 'demo:item' as CrudPermissionPrefix,
      edit: { openEdit: vi.fn() },
      remove: { mutateAsync: vi.fn() },
      extra: (r) => [{ key: 'test', label: `测试${r.name}`, onClick: vi.fn() }],
    }), { wrapper: wrapper([]) });
    const cell = render(<>{result.current.render?.(undefined, record, 0)}</>);
    expect(cell.queryByRole('button', { name: '编辑' })).toBeNull();
    expect(cell.queryByRole('button', { name: '删除' })).toBeNull();
    expect(cell.getByRole('button', { name: '测试甲' })).toBeTruthy();
  });

  it('permissions 映射覆盖前缀约定；edit / remove 传回调直接调用', async () => {
    const edit = vi.fn();
    const remove = vi.fn().mockResolvedValue(undefined);
    const { result } = renderHook(() => useCrudOperationColumn<Row>({ permissions: { edit: 'x:manage' as Permission, remove: 'x:manage' as Permission }, edit, remove }), { wrapper: wrapper(['x:manage']) });
    const cell = render(<>{result.current.render?.(undefined, record, 0)}</>);
    fireEvent.click(cell.getByRole('button', { name: '编辑' }));
    expect(edit).toHaveBeenCalledWith(record);
    fireEvent.click(cell.getByRole('button', { name: '删除' }));
    expect(remove).not.toHaveBeenCalled();
    await (confirmCalls[0].onOk as () => Promise<void>)();
    expect(remove).toHaveBeenCalledWith(record);
  });
});
