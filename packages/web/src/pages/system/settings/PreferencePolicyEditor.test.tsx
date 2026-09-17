import { useState } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { defaultPreferencePolicy, defaultPreferences, type PreferencePolicy } from '@zenith/shared/preferences';
import { desktopToolbar } from '@/test-utils/toolbar';
import { PreferencePolicyEditor } from './PreferencePolicyEditor';

vi.mock('@/hooks/queries/menus', () => ({
  useMenuTree: () => ({ data: [], isFetching: false }),
  useCurrentUserMenuTree: () => ({ data: [], isFetching: false }),
}));
vi.mock('@/hooks/usePermission', () => ({
  usePermission: () => ({ hasPermission: () => false, hasAnyPermission: () => false }),
}));
vi.mock('@/hooks/usePreferences', () => ({
  usePreferences: () => ({ preferences: defaultPreferences }),
  useOptionalPreferences: () => null,
}));
vi.mock('@/lib/contract-query', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/lib/contract-query')>(),
  useApiQuery: () => ({ data: undefined, isFetching: false, isError: false }),
}));

function setup(initial: PreferencePolicy) {
  const changed = vi.fn();
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  function Harness() {
    const [policy, setPolicy] = useState(initial);
    return <PreferencePolicyEditor value={policy} onChange={(next) => { changed(next); setPolicy(next); }} />;
  }
  const result = render(<QueryClientProvider client={client}><Harness /></QueryClientProvider>);
  return { ...result, changed };
}

describe('系统偏好策略编辑器', () => {
  it('父功能强制关闭时仍可预先配置子项，并显示适用条件', () => {
    const policy = structuredClone(defaultPreferencePolicy);
    policy.defaults.enableTabs = false;
    policy.allowUserOverride.enableTabs = false;
    const { container } = setup(policy);
    fireEvent.change(desktopToolbar(container).getByPlaceholderText('搜索偏好名称 / 说明'), { target: { value: '标签页风格' } });
    const row = container.querySelector('[data-preference-path="tabStyle"]') as HTMLElement;
    expect(row).not.toBeNull();
    expect(within(row).getByText(/适用条件：/)).toBeVisible();
    expect(within(row).getByText(/当前系统默认组合不满足条件/)).toBeVisible();
    expect(screen.getByRole('switch', { name: '标签页风格用户可修改' })).not.toBeDisabled();
  });

  it('单项锁定保留默认值；恢复内置策略同时恢复默认值及用户修改权限', () => {
    const policy = structuredClone(defaultPreferencePolicy);
    policy.defaults.tablePageSize = 20;
    policy.defaults.themeColor = 'wechat';
    const { container, changed } = setup(policy);
    fireEvent.change(desktopToolbar(container).getByPlaceholderText('搜索偏好名称 / 说明'), { target: { value: '默认分页大小' } });
    fireEvent.click(screen.getByRole('switch', { name: '默认分页大小用户可修改' }));
    const locked = changed.mock.lastCall?.[0] as PreferencePolicy;
    expect(locked.defaults.tablePageSize).toBe(20);
    expect(locked.allowUserOverride.tablePageSize).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: '恢复默认分页大小内置策略' }));
    const restored = changed.mock.lastCall?.[0] as PreferencePolicy;
    expect(restored.defaults.tablePageSize).toBe(defaultPreferences.tablePageSize);
    expect(restored.allowUserOverride.tablePageSize).toBe(true);
    expect(restored.defaults.themeColor).toBe('wechat');
  });
});
