import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { useRowSelection } from './useRowSelection';

describe('useRowSelection', () => {
  it('把 Semi 回传的 keys 归一为选中数组，clear 引用稳定并清空', () => {
    const { result } = renderHook(() => useRowSelection());
    expect(result.current.selectedRowKeys).toEqual([]);
    expect(result.current.hasSelection).toBe(false);
    const clearRef = result.current.clear;

    act(() => result.current.rowSelection.onChange?.([3, 5]));
    expect(result.current.selectedRowKeys).toEqual([3, 5]);
    expect(result.current.hasSelection).toBe(true);
    expect(result.current.rowSelection.selectedRowKeys).toEqual([3, 5]);

    // Semi 全不选时可能回传 undefined
    act(() => result.current.rowSelection.onChange?.(undefined));
    expect(result.current.selectedRowKeys).toEqual([]);

    act(() => result.current.setSelectedRowKeys([7]));
    act(() => result.current.clear());
    expect(result.current.selectedRowKeys).toEqual([]);
    expect(result.current.clear).toBe(clearRef);
  });

  it('extra 里的 getCheckboxProps 等附加属性原样并入 rowSelection', () => {
    const getCheckboxProps = (record: { id: number; locked?: boolean }) => ({ disabled: !!record.locked });
    const { result } = renderHook(() => useRowSelection<number, { id: number; locked?: boolean }>({ extra: { getCheckboxProps, fixed: true } }));
    expect(result.current.rowSelection.getCheckboxProps).toBe(getCheckboxProps);
    expect(result.current.rowSelection.fixed).toBe(true);
    act(() => result.current.rowSelection.onChange?.([1]));
    expect(result.current.rowSelection.selectedRowKeys).toEqual([1]);
  });
});
