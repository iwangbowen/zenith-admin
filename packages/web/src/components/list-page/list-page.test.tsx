import { fireEvent, render, screen } from '@testing-library/react';
import { Toast } from '@douyinfe/semi-ui';
import type { ModalReactProps } from '@douyinfe/semi-ui/lib/es/modal';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ListSearchToolbar } from './ListSearchToolbar';
import { deleteAction } from './deleteAction';
import { listTableProps } from './listTableProps';

// Modal.confirm 依赖 createRoot 命令式渲染，jsdom 下改为记录配置、由测试手动触发 onOk
const confirmCalls = vi.hoisted(() => [] as ModalReactProps[]);
vi.mock('@douyinfe/semi-ui', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@douyinfe/semi-ui')>();
  Object.assign(actual.Modal, { confirm: (config: ModalReactProps) => { confirmCalls.push(config); return { destroy() {}, update() {} }; } });
  return actual;
});

const controlLabel = (el: Element) => el.getAttribute('aria-label') || el.getAttribute('placeholder') || (el as HTMLElement).textContent;

beforeEach(() => { confirmCalls.length = 0; });
afterEach(() => { vi.restoreAllMocks(); });

describe('ListSearchToolbar', () => {
  it('桌面：关键词 → 筛选 → 查询 / 重置 → 新增 → 低频操作；移动：主区 关键词 + 查询 + 新增，筛选与更多按钮', () => {
    const onSearch = vi.fn();
    const onReset = vi.fn();
    const { container } = render(
      <ListSearchToolbar
        keyword={<input placeholder="搜索名称" />}
        filters={<select aria-label="状态"><option>全部状态</option></select>}
        create={<button type="button">新增</button>}
        actions={<button type="button">导出</button>}
        onSearch={onSearch}
        onReset={onReset}
      />,
    );
    const desktop = container.querySelector('.responsive-toolbar__desktop')!;
    expect([...desktop.querySelectorAll('button, input, select')].map(controlLabel)).toEqual(['搜索名称', '状态', '查询', '重置', '新增', '导出']);

    const mobilePrimary = container.querySelector('.responsive-toolbar__mobile-primary')!;
    expect([...mobilePrimary.querySelectorAll('button, input')].map(controlLabel)).toEqual(['搜索名称', '查询', '新增']);
    expect(screen.getByRole('button', { name: '筛选' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '更多操作' })).toBeTruthy();

    const desktopButtons = desktop.querySelectorAll('button');
    fireEvent.click(desktopButtons[0]);
    fireEvent.click(desktopButtons[1]);
    expect(onSearch).toHaveBeenCalledTimes(1);
    expect(onReset).toHaveBeenCalledTimes(1);
  });

  it('仅关键词 + 新增：桌面有新增，移动端没有筛选按钮也没有更多菜单（新增已在主区）', () => {
    const { container } = render(<ListSearchToolbar keyword={<input placeholder="搜索" />} create={<button type="button">新增</button>} onSearch={() => {}} onReset={() => {}} />);
    expect([...container.querySelector('.responsive-toolbar__desktop')!.querySelectorAll('button')].map(controlLabel)).toEqual(['查询', '重置', '新增']);
    expect(container.querySelector('.responsive-toolbar__mobile-extra')).toBeNull();
    expect(screen.queryByRole('button', { name: '筛选' })).toBeNull();
    expect(screen.queryByRole('button', { name: '更多操作' })).toBeNull();
  });
});

describe('deleteAction', () => {
  it('返回红色删除动作；弹 confirmDelete，确认后执行 run、提示并回调 onDeleted', async () => {
    const success = vi.spyOn(Toast, 'success');
    const run = vi.fn(() => Promise.resolve());
    const onDeleted = vi.fn();
    const action = deleteAction({ title: '确定要删除标签「A」吗？', content: '删除后不可恢复', run, onDeleted, hidden: false });
    expect(action).toMatchObject({ key: 'delete', label: '删除', danger: true, hidden: false });
    await action.onClick?.();
    expect(confirmCalls).toHaveLength(1);
    expect(confirmCalls[0]).toMatchObject({ title: '确定要删除标签「A」吗？', content: '删除后不可恢复', okButtonProps: { type: 'danger', theme: 'solid' } });
    expect(run).not.toHaveBeenCalled();
    await confirmCalls[0].onOk?.({} as never);
    expect(run).toHaveBeenCalledTimes(1);
    expect(success).toHaveBeenCalledWith('删除成功');
    expect(onDeleted).toHaveBeenCalledTimes(1);
  });

  it('自定义 key / label / okText；successMessage 为 null 时不提示', async () => {
    const success = vi.spyOn(Toast, 'success');
    const action = deleteAction({ key: 'purge', label: '彻底删除', title: '彻底删除？', okText: '彻底删除', run: () => Promise.resolve(), successMessage: null });
    expect(action.key).toBe('purge');
    expect(action.label).toBe('彻底删除');
    await action.onClick?.();
    expect(confirmCalls[0]).toMatchObject({ title: '彻底删除？', okText: '彻底删除' });
    await confirmCalls[0].onOk?.({} as never);
    expect(success).not.toHaveBeenCalled();
  });
});

describe('listTableProps', () => {
  const buildPagination = (total: number) => ({ currentPage: 1, pageSize: 10, total, onPageChange: () => {}, onPageSizeChange: () => {} });

  it('分页包络：数据源 / total / loading / 刷新接线，默认 id · small · bordered', () => {
    const refetch = vi.fn();
    const props = listTableProps({ data: { list: [{ id: 1 }], total: 7 }, isFetching: true, refetch }, { pagination: buildPagination });
    expect(props).toMatchObject({ bordered: true, rowKey: 'id', size: 'small', dataSource: [{ id: 1 }], loading: true, refreshLoading: true });
    expect(props.pagination?.total).toBe(7);
    props.onRefresh();
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it('数组型数据与未加载态；显式覆盖 rowKey / size / empty / bordered', () => {
    const props = listTableProps<{ code: string }>({ data: [{ code: 'a' }, { code: 'b' }], isFetching: false, refetch: () => {} }, { rowKey: 'code', size: 'default', empty: '暂无数据', bordered: false });
    expect(props).toMatchObject({ rowKey: 'code', size: 'default', empty: '暂无数据', bordered: false, dataSource: [{ code: 'a' }, { code: 'b' }] });
    expect('pagination' in props).toBe(false);
    const pending = listTableProps({ data: undefined, isFetching: true, refetch: () => {} }, { pagination: buildPagination });
    expect(pending.dataSource).toEqual([]);
    expect(pending.pagination?.total).toBe(0);
  });
});
