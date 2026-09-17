import { createPreferencesContext } from '@/test-utils/preferences';
/**
 * 契约派生筛选控件 + 标准操作列：锁住「x-filter 语义 → 控件」的映射、关键字进主区其余进筛选区、
 * override / 范围端点 / 未声明语义的处理，以及操作列的权限门控与删除确认接线。
 */
import { fireEvent, render, renderHook, screen } from '@testing-library/react';
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
import { ListSearchToolbar } from './ListSearchToolbar';
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

const controlLabel = (el: Element) => el.getAttribute('aria-label') || el.getAttribute('placeholder') || (el as HTMLElement).textContent;

beforeEach(() => { confirmCalls.length = 0; });
afterEach(() => { vi.restoreAllMocks(); });

describe('deriveFilterControls / ListSearchToolbar 契约写法', () => {
  function Harness({ filters, overrides, extra }: { filters: Parameters<typeof deriveFilterControls<Record<string, unknown>>>[0]['specs']; overrides?: Record<string, () => ReactNode>; extra?: ReactNode }) {
    const page = useListPage({ contract: rowContract, useList: useListMock });
    return <ListSearchToolbar page={page} filters={filters as never} overrides={overrides as never} extraFilters={extra} create={<button type="button">新增</button>} />;
  }

  it('keyword → 主区搜索框（占位「搜索 + 匹配字段」）；enum / bool / id / 范围 → 筛选区，顺序按声明', () => {
    const { container } = render(<Harness filters={['keyword', 'status', 'level', 'kind', 'pinned', 'channelId', ['startTime', 'endTime']]} />, { wrapper: wrapper() });
    const desktop = container.querySelector('.responsive-toolbar__desktop')!;
    const labels = [...desktop.querySelectorAll('input, [role="combobox"], .semi-select, .semi-datepicker')].map(controlLabel).filter(Boolean);
    expect(labels[0]).toBe('搜索名称 / 编码');
    expect(desktop.textContent).toContain('全部状态');
    expect(desktop.textContent).toContain('全部等级');
    expect(desktop.textContent).toContain('全部类型');
    expect(desktop.textContent).toContain('是否置顶');
    expect(desktop.querySelector('input[placeholder="栏目 ID"]')).toBeTruthy();
    expect(desktop.querySelector('input[placeholder="开始时间"]')).toBeTruthy();
    const mobilePrimary = container.querySelector('.responsive-toolbar__mobile-primary')!;
    expect([...mobilePrimary.querySelectorAll('input, button')].map(controlLabel)).toEqual(['搜索名称 / 编码', '查询', '新增']);
    expect(screen.getByRole('button', { name: '筛选' })).toBeTruthy();
  });

  it('搜索框回车触发查询并把值送进列表参数；下拉标签来自字典 / 静态 options', () => {
    const { container } = render(<Harness filters={['keyword', 'level']} />, { wrapper: wrapper() });
    const input = container.querySelector<HTMLInputElement>('.responsive-toolbar__desktop input[placeholder="搜索名称 / 编码"]')!;
    fireEvent.change(input, { target: { value: 'abc' } });
    // Semi 在 keyPress 而非 keyDown 上派发 onEnterPress
    fireEvent.keyPress(input, { key: 'Enter', charCode: 13 });
    expect(useListMock).toHaveBeenLastCalledWith({ page: 1, pageSize: 10, keyword: 'abc' }, undefined);
    fireEvent.click(container.querySelector('.responsive-toolbar__desktop .semi-select')!);
    expect(screen.getByText('低')).toBeTruthy();
    expect(screen.getByText('高')).toBeTruthy();
  });

  it('bool 的契约 labels 替换缺省的「是 / 否」', () => {
    const { container } = render(<Harness filters={['enabled']} />, { wrapper: wrapper() });
    fireEvent.click(container.querySelector('.responsive-toolbar__desktop .semi-select')!);
    expect(screen.getByText('已启用')).toBeTruthy();
    expect(screen.getByText('已停用')).toBeTruthy();
  });

  it('override 替换指定键的控件，extraFilters 追加在派生控件之后', () => {
    const { container } = render(
      <Harness filters={['keyword', 'status']} overrides={{ status: () => <select aria-label="自定义状态"><option>x</option></select> }} extra={<input placeholder="额外" />} />,
      { wrapper: wrapper() },
    );
    const desktop = container.querySelector('.responsive-toolbar__desktop')!;
    expect(desktop.textContent).not.toContain('全部状态');
    expect(desktop.querySelector('select[aria-label="自定义状态"]')).toBeTruthy();
    expect(desktop.querySelector('input[placeholder="额外"]')).toBeTruthy();
  });

  it('未声明 x-filter 语义的键与单独出现的范围端点直接报错，而不是渲染空控件', () => {
    const page = renderHook(() => useListPage({ contract: rowContract, useList: useListMock }), { wrapper: wrapper() }).result.current;
    expect(() => deriveFilterControls({ page, specs: ['plain'] })).toThrow(/plain/);
    expect(() => deriveFilterControls({ page, specs: ['startTime'] })).toThrow(/成对/);
  });
});

describe('useCrudOperationColumn', () => {
  interface Row { id: number; name: string }
  const record: Row = { id: 7, name: '甲' };

  it('权限前缀派生 :update / :delete 门控；删除弹确认（含对象名）并按 [id] 调 mutateAsync', async () => {
    const openEdit = vi.fn();
    const mutateAsync = vi.fn().mockResolvedValue(null);
    const { result } = renderHook(() => useCrudOperationColumn<Row>({ permission: 'demo:item' as CrudPermissionPrefix, edit: { openEdit }, remove: { mutateAsync }, label: (r) => r.name, content: '不可恢复' }), { wrapper: wrapper(['demo:item:update', 'demo:item:delete']) });
    const cell = render(<>{result.current.render?.(undefined, record, 0)}</>);
    fireEvent.click(cell.getByRole('button', { name: '编辑' }));
    expect(openEdit).toHaveBeenCalledWith(record);
    fireEvent.click(cell.getByRole('button', { name: '删除' }));
    expect(confirmCalls).toHaveLength(1);
    expect(confirmCalls[0].title).toBe('确定要删除「甲」吗？');
    expect(confirmCalls[0].content).toBe('不可恢复');
    await (confirmCalls[0].onOk as () => Promise<void>)();
    expect(mutateAsync).toHaveBeenCalledWith([7]);
    expect(result.current.width).toBe(150);
  });

  it('无权限时动作隐藏；extra 动作排在编辑之前并加宽', () => {
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
    expect(result.current.width).toBe(210);
  });

  it('permissions 映射覆盖前缀约定；edit / remove 传回调直接调用', async () => {
    const edit = vi.fn();
    const remove = vi.fn().mockResolvedValue(undefined);
    const { result } = renderHook(() => useCrudOperationColumn<Row>({ permissions: { edit: 'x:manage' as Permission, remove: 'x:manage' as Permission }, edit, remove }), { wrapper: wrapper(['x:manage']) });
    const cell = render(<>{result.current.render?.(undefined, record, 0)}</>);
    fireEvent.click(cell.getByRole('button', { name: '编辑' }));
    expect(edit).toHaveBeenCalledWith(record);
    fireEvent.click(cell.getByRole('button', { name: '删除' }));
    expect(confirmCalls[0].title).toBe('确定要删除吗？');
    await (confirmCalls[0].onOk as () => Promise<void>)();
    expect(remove).toHaveBeenCalledWith(record);
  });
});
