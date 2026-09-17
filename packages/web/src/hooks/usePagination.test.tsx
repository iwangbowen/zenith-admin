import type { ReactNode } from 'react';
import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { PreferencesContext } from '@/hooks/usePreferences';
import { createPreferencesContext } from '@/test-utils/preferences';
import { defaultPreferencePolicy, type UserPreferences } from '@zenith/shared/preferences';
import { usePagination, type UsePaginationOptions } from './usePagination';

function setup(options: UsePaginationOptions = {}) {
  let context = createPreferencesContext();
  const Wrapper = ({ children }: { readonly children: ReactNode }) => (
    <PreferencesContext.Provider value={context}>{children}</PreferencesContext.Provider>
  );
  const hook = renderHook((props: UsePaginationOptions) => usePagination(props), { wrapper: Wrapper, initialProps: options });
  const updateDefault = (tablePageSize: UserPreferences['tablePageSize'], nextOptions = options) => {
    context = createPreferencesContext({}, {
      ...defaultPreferencePolicy,
      defaults: { ...defaultPreferencePolicy.defaults, tablePageSize },
    });
    hook.rerender(nextOptions);
  };
  return { ...hook, updateDefault };
}

describe('usePagination preference defaults', () => {
  it('策略异步加载及后续更新时，未选择过条数的列表跟随新默认并回到首页', () => {
    const hook = setup();
    expect(hook.result.current.pageSize).toBe(10);
    act(() => hook.result.current.setPage(3));
    hook.updateDefault(50);
    expect(hook.result.current.pageSize).toBe(50);
    expect(hook.result.current.page).toBe(1);
    hook.updateDefault(20);
    expect(hook.result.current.buildPagination(200).pageSize).toBe(20);
  });

  it('临时选择即使等于旧默认也保留，策略更新不改变当前条数与页码', () => {
    const hook = setup();
    const fetch = vi.fn();
    act(() => hook.result.current.buildPagination(500, fetch).onPageSizeChange(10));
    expect(fetch).toHaveBeenLastCalledWith(1, 10);
    act(() => hook.result.current.setPage(4));
    hook.updateDefault(50);
    expect(hook.result.current.pageSize).toBe(10);
    expect(hook.result.current.page).toBe(4);
  });

  it('页面显式默认优先于系统偏好，未临时选择时也响应页面默认的变化', () => {
    const hook = setup({ pageSize: 24 });
    act(() => hook.result.current.setPage(2));
    hook.updateDefault(50, { pageSize: 24 });
    expect(hook.result.current.pageSize).toBe(24);
    expect(hook.result.current.page).toBe(2);
    hook.rerender({ pageSize: 36 });
    expect(hook.result.current.pageSize).toBe(36);
    expect(hook.result.current.page).toBe(1);
  });

  it('程序设置条数同样保留；切换列表作用域只重置页码', () => {
    const hook = setup({ resetKey: ['space', 1] });
    act(() => {
      hook.result.current.setPageSize(100);
      hook.result.current.setPage(4);
    });
    hook.updateDefault(20, { resetKey: ['space', 1] });
    expect(hook.result.current.page).toBe(4);
    hook.rerender({ resetKey: ['space', 2] });
    expect(hook.result.current.page).toBe(1);
    expect(hook.result.current.pageSize).toBe(100);
  });
});
