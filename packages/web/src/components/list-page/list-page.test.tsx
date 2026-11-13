import { Toast } from '@douyinfe/semi-ui';
import type { ModalReactProps } from '@douyinfe/semi-ui/lib/es/modal';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { batchStatusHandler } from './batchStatus';
import { confirmAndDelete, deleteAction } from './deleteAction';
import { listTableProps } from './listTableProps';

// Modal.confirm 依赖 createRoot 命令式渲染，jsdom 下改为记录配置、由测试手动触发 onOk
const confirmCalls = vi.hoisted(() => [] as ModalReactProps[]);
vi.mock('@douyinfe/semi-ui', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@douyinfe/semi-ui')>();
  Object.assign(actual.Modal, { confirm: (config: ModalReactProps) => { confirmCalls.push(config); return { destroy() {}, update() {} }; } });
  return actual;
});

beforeEach(() => { confirmCalls.length = 0; });
afterEach(() => { vi.restoreAllMocks(); });

describe('batchStatusHandler', () => {
  it('批量变更使用选中 ID，停用确认前不执行', async () => {
    const success = vi.spyOn(Toast, 'success');
    const run = vi.fn(() => Promise.resolve());
    const clearSelection = vi.fn();
    const handle = batchStatusHandler({ selectedRowKeys: [1, 2], clearSelection, run });
    await handle('enabled');
    expect(confirmCalls).toHaveLength(0);
    expect(run).toHaveBeenCalledWith([1, 2], 'enabled');
    expect(clearSelection).toHaveBeenCalledTimes(1);
    expect(success).toHaveBeenCalledTimes(1);

    await handle('disabled');
    expect(confirmCalls).toHaveLength(1);
    expect(run).toHaveBeenCalledTimes(1);
    await confirmCalls[0].onOk?.({} as never);
    expect(run).toHaveBeenLastCalledWith([1, 2], 'disabled');
    expect(success).toHaveBeenCalledTimes(2);
  });

  it('confirm=always 时启用与停用均需确认', async () => {
    const run = vi.fn(() => Promise.resolve());
    const handle = batchStatusHandler({
      selectedRowKeys: [7], clearSelection: () => {}, run,
      confirm: 'always', disableLabel: '禁用', entity: '个用户', danger: true,
      confirmContent: (status) => (status === 'disabled' ? '停用后无法登录' : undefined),
      successMessage: () => '操作成功',
    });
    await handle('enabled');
    expect(run).not.toHaveBeenCalled();
    await confirmCalls[0].onOk?.({} as never);
    expect(run).toHaveBeenCalledWith([7], 'enabled');
    await handle('disabled');
    expect(run).toHaveBeenCalledTimes(1);
    await confirmCalls[1].onOk?.({} as never);
    expect(run).toHaveBeenCalledWith([7], 'disabled');
    expect(run).toHaveBeenCalledTimes(2);
  });

  it('空选中直接返回；confirm=never 时停用也不弹确认', async () => {
    const run = vi.fn(() => Promise.resolve());
    await batchStatusHandler({ selectedRowKeys: [], clearSelection: () => {}, run })('disabled');
    expect(run).not.toHaveBeenCalled();
    await batchStatusHandler({ selectedRowKeys: [3], clearSelection: () => {}, run, confirm: 'never' })('disabled');
    expect(confirmCalls).toHaveLength(0);
    expect(run).toHaveBeenCalledWith([3], 'disabled');
  });
});

describe('deleteAction', () => {
  it('确认后才执行删除，成功后回调 onDeleted', async () => {
    const success = vi.spyOn(Toast, 'success');
    const run = vi.fn(() => Promise.resolve());
    const onDeleted = vi.fn();
    const action = deleteAction({ title: '确定要删除标签「A」吗？', content: '删除后不可恢复', run, onDeleted, hidden: false });
    await action.onClick?.();
    expect(confirmCalls).toHaveLength(1);
    expect(run).not.toHaveBeenCalled();
    await confirmCalls[0].onOk?.({} as never);
    expect(run).toHaveBeenCalledTimes(1);
    expect(success).toHaveBeenCalledTimes(1);
    expect(onDeleted).toHaveBeenCalledTimes(1);
  });

  it('confirmAndDelete：successMessage / onDeleted 可拿到 run 的结果', async () => {
    const success = vi.spyOn(Toast, 'success');
    const onDeleted = vi.fn();
    confirmAndDelete({ title: '删除选中缓存？', run: () => Promise.resolve({ count: 3 }), successMessage: (r) => `已删除 ${r.count} 条`, onDeleted });
    await confirmCalls[0].onOk?.({} as never);
    expect(success).toHaveBeenCalledWith('已删除 3 条');
    expect(onDeleted).toHaveBeenCalledWith({ count: 3 });
  });

  it('confirmAndDelete：run 失败时不提示、不回调，异常继续抛给弹窗保持打开', async () => {
    const success = vi.spyOn(Toast, 'success');
    const onDeleted = vi.fn();
    confirmAndDelete({ title: '删除？', run: () => Promise.reject(new Error('boom')), onDeleted });
    await expect(confirmCalls[0].onOk?.({} as never)).rejects.toThrow('boom');
    expect(success).not.toHaveBeenCalled();
    expect(onDeleted).not.toHaveBeenCalled();
  });
});

describe('listTableProps', () => {
  const buildPagination = (total: number) => ({ currentPage: 1, pageSize: 10, total, onPageChange: () => {}, onPageSizeChange: () => {} });

  it('分页包络保留数据和总数，刷新时重新获取数据', () => {
    const refetch = vi.fn();
    const props = listTableProps({ data: { list: [{ id: 1 }], total: 7 }, isFetching: true, refetch }, { pagination: buildPagination });
    expect(props.dataSource).toEqual([{ id: 1 }]);
    expect(props.pagination && props.pagination.total).toBe(7);
    props.onRefresh();
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it('数组与未加载态归一为列表数据，缺少数据时总数为零', () => {
    const props = listTableProps<{ code: string }>({ data: [{ code: 'a' }, { code: 'b' }], isFetching: false, refetch: () => {} }, { rowKey: 'code', size: 'default', empty: '暂无数据', bordered: false });
    expect(props.dataSource).toEqual([{ code: 'a' }, { code: 'b' }]);
    expect(props.pagination).toBe(false);
    const pending = listTableProps({ data: undefined, isFetching: true, refetch: () => {} }, { pagination: buildPagination });
    expect(pending.dataSource).toEqual([]);
    expect(pending.pagination && pending.pagination.total).toBe(0);
  });
});
