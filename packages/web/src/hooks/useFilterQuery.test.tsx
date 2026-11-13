import { describe, expect, it } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useFilterQuery } from './useFilterQuery';

describe('useFilterQuery', () => {
  it('丢弃 undefined / null / 空串，保留 0 / false', () => {
    const { result } = renderHook(() => useFilterQuery({ keyword: '', status: undefined, tenantId: null, page: 0, archived: false, type: 'a' }));
    expect(result.current).toEqual({ page: 0, archived: false, type: 'a' });
  });

  it('映射里引用的外部值变化会直接反映（不依赖手写依赖数组）', () => {
    let imageOnly = false;
    const { result, rerender } = renderHook(() => useFilterQuery({ type: imageOnly ? 'image' : undefined }));
    expect(result.current).toEqual({});
    imageOnly = true;
    rerender();
    expect(result.current).toEqual({ type: 'image' });
  });
});
