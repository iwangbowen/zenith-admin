/**
 * 验证新增 / 编辑数据、异步详情与保存边界，不限定弹窗标题、表单 key 或 DOM 重挂载方式。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, renderHook } from '@testing-library/react';

const toastSuccess = vi.fn();
vi.mock('@douyinfe/semi-ui', () => ({
  Toast: {
    success: (...args: unknown[]) => toastSuccess(...args),
  },
}));

import { useEditModal, type DetailHook } from './useEditModal';
import { SubmitAborted } from '@/lib/abort-submit';

interface Row {
  id: number;
  name: string;
  remark?: string;
}

/** 可控的表单替身：validate 要么返回值，要么按 Semi 的行为 reject */
function makeFormApi(values: Record<string, unknown>, shouldFail = false) {
  return {
    validate: vi.fn(() => (shouldFail ? Promise.reject(new Error('field required')) : Promise.resolve(values))),
  };
}

function makeSave(impl?: (v: { id?: number; values: unknown }) => Promise<Row>) {
  const mutateAsync = vi.fn(impl ?? (async ({ id }) => ({ id: id ?? 99, name: 'saved' })));
  return { mutateAsync, isPending: false };
}

beforeEach(() => {
  toastSuccess.mockClear();
});

describe('打开与初始值', () => {
  it('新增时使用 defaults', () => {
    const save = makeSave();
    const { result } = renderHook(() => useEditModal<Row>({ entityName: '角色', save, defaults: { name: '' } }));

    act(() => result.current.openCreate());

    expect(result.current.visible).toBe(true);
    expect(result.current.isEdit).toBe(false);
    expect(result.current.formProps.initValues).toEqual({ name: '' });
  });

  it('defaults 为函数时每次打开重新求值', () => {
    const save = makeSave();
    let seq = 0;
    const { result } = renderHook(() =>
      useEditModal<Row>({ entityName: '角色', save, defaults: () => ({ name: `n${++seq}` }) }),
    );

    act(() => result.current.openCreate());
    expect(result.current.formProps.initValues).toEqual({ name: 'n1' });

    act(() => result.current.close());
    act(() => result.current.openCreate());
    expect(result.current.formProps.initValues).toEqual({ name: 'n2' });
  });

  it('编辑时以记录为初始值，并可用 toValues 裁剪字段', () => {
    const save = makeSave();
    const { result } = renderHook(() =>
      useEditModal<Row>({
        entityName: '角色',
        save,
        toValues: (r) => ({ name: r.name }),
      }),
    );

    act(() => result.current.openEdit({ id: 7, name: 'admin', remark: 'x' }));

    expect(result.current.isEdit).toBe(true);
    expect(result.current.formProps.initValues).toEqual({ name: 'admin' });
  });
});

describe('异步详情数据', () => {
  it('详情到达后使用完整记录，加载期间禁止提交占位数据', () => {
    const save = makeSave();
    // 先返回 undefined（加载中），再返回详情——模拟弹窗打开后详情才到达
    let detailData: Row | undefined = undefined;
    const useDetail: DetailHook<Row> = () => ({ data: detailData, isFetching: detailData === undefined });

    const { result, rerender } = renderHook(() => useEditModal<Row>({ entityName: '租户', save, useDetail }));

    act(() => result.current.openEdit({ id: 12, name: '列表行' }));
    // 详情未到达：用列表行占位
    expect(result.current.formProps.initValues).toMatchObject({ name: '列表行' });
    expect(result.current.detailLoading).toBe(true);
    // 详情加载期间禁止提交，避免把占位数据当成完整记录保存
    expect(result.current.modalProps.okButtonProps.disabled).toBe(true);

    detailData = { id: 12, name: '详情名', remark: '仅详情返回的字段' };
    rerender();

    expect(result.current.formProps.initValues).toMatchObject({ name: '详情名', remark: '仅详情返回的字段' });
    expect(result.current.detailLoading).toBe(false);
    expect(result.current.modalProps.okButtonProps.disabled).toBe(false);
  });

  it('未配置 useDetail 时不产生详情态', () => {
    const save = makeSave();
    const { result } = renderHook(() => useEditModal<Row>({ entityName: '角色', save }));
    act(() => result.current.openEdit({ id: 3, name: 'a' }));
    expect(result.current.detailLoading).toBe(false);
  });
});

describe('提交编排', () => {
  it('校验失败时抛出 SubmitAborted 以中断，且不调用保存、不关闭弹窗', async () => {
    const save = makeSave();
    const { result } = renderHook(() => useEditModal<Row>({ entityName: '角色', save }));

    act(() => result.current.openCreate());
    act(() => result.current.formProps.getFormApi(makeFormApi({}, true) as never));

    // 必须是 SubmitAborted 而非裸 Error：全局兜底靠类型放行，
    // 裸 Error 一旦带多词消息就会穿透，用户会额外收到「操作失败：xxx」并误报错误监控
    await expect(result.current.modalProps.onOk()).rejects.toBeInstanceOf(SubmitAborted);

    expect(save.mutateAsync).not.toHaveBeenCalled();
    expect(result.current.visible).toBe(true);
    expect(toastSuccess).not.toHaveBeenCalled();
  });

  it('新增成功：以无 id 保存、提示创建成功、关闭并清空 editing', async () => {
    const save = makeSave();
    const { result } = renderHook(() => useEditModal<Row>({ entityName: '角色', save }));

    act(() => result.current.openCreate());
    act(() => result.current.formProps.getFormApi(makeFormApi({ name: 'new' }) as never));
    await act(async () => {
      await result.current.modalProps.onOk();
    });

    expect(save.mutateAsync).toHaveBeenCalledWith({ id: undefined, values: { name: 'new' } });
    expect(toastSuccess).toHaveBeenCalledWith('创建成功');
    expect(result.current.visible).toBe(false);
    expect(result.current.editing).toBeNull();
  });

  it('编辑成功：带 id 保存并提示更新成功', async () => {
    const save = makeSave();
    const { result } = renderHook(() => useEditModal<Row>({ entityName: '角色', save }));

    act(() => result.current.openEdit({ id: 5, name: 'old' }));
    act(() => result.current.formProps.getFormApi(makeFormApi({ name: 'new' }) as never));
    await act(async () => {
      await result.current.modalProps.onOk();
    });

    expect(save.mutateAsync).toHaveBeenCalledWith({ id: 5, values: { name: 'new' } });
    expect(toastSuccess).toHaveBeenCalledWith('更新成功');
  });

  it('beforeSave 可注入页面级上下文', async () => {
    const save = makeSave();
    const { result } = renderHook(() =>
      useEditModal<Row, Record<string, unknown>>({
        entityName: '友链',
        save,
        beforeSave: (values, ctx) => (ctx.isEdit ? values : { ...values, siteId: 42 }),
      }),
    );

    act(() => result.current.openCreate());
    act(() => result.current.formProps.getFormApi(makeFormApi({ name: 'a' }) as never));
    await act(async () => {
      await result.current.modalProps.onOk();
    });

    expect(save.mutateAsync).toHaveBeenCalledWith({ id: undefined, values: { name: 'a', siteId: 42 } });
  });

  it('保存后再点新增，不会带出上一次编辑的记录', async () => {
    const save = makeSave();
    const { result } = renderHook(() => useEditModal<Row>({ entityName: '角色', save, defaults: { name: '' } }));

    act(() => result.current.openEdit({ id: 8, name: 'old' }));
    act(() => result.current.formProps.getFormApi(makeFormApi({ name: 'x' }) as never));
    await act(async () => {
      await result.current.modalProps.onOk();
    });

    act(() => result.current.openCreate());
    expect(result.current.isEdit).toBe(false);
    expect(result.current.formProps.initValues).toEqual({ name: '' });
  });

  it('successMessage 可覆盖默认提示，onSaved 拿到保存结果', async () => {
    const save = makeSave(async () => ({ id: 100, name: 'saved' }));
    const onSaved = vi.fn();
    const { result } = renderHook(() =>
      useEditModal<Row>({ save, successMessage: () => '已提交审核', onSaved }),
    );

    act(() => result.current.openCreate());
    act(() => result.current.formProps.getFormApi(makeFormApi({ name: 'a' }) as never));
    await act(async () => {
      await result.current.modalProps.onOk();
    });

    expect(toastSuccess).toHaveBeenCalledWith('已提交审核');
    expect(onSaved).toHaveBeenCalledWith({ id: 100, name: 'saved' }, { editing: null, isEdit: false });
  });
  it('successMessage 返回 null 时不弹提示，但仍关闭并回调 onSaved', async () => {
    const save = makeSave();
    const onSaved = vi.fn();
    const { result } = renderHook(() =>
      useEditModal<Row>({ save, successMessage: () => null, onSaved }),
    );

    act(() => result.current.openCreate());
    act(() => result.current.formProps.getFormApi(makeFormApi({ name: 'a' }) as never));
    await act(async () => {
      await result.current.modalProps.onOk();
    });

    expect(toastSuccess).not.toHaveBeenCalled();
    expect(result.current.visible).toBe(false);
    expect(onSaved).toHaveBeenCalled();
  });
});
