import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  canOverridePreference,
  defaultPreferencePolicy,
  getPreferenceValue,
  isPreferenceApplicable,
  resolvePreferences,
  type PreferenceOverrides,
  type PreferencePolicy,
} from '@zenith/shared/preferences';
import type { PreferencesContextValue } from '@/hooks/usePreferences';
import { PreferenceControl, PreferenceSection } from '@/components/settings/SettingRow';

let context: PreferencesContextValue;
vi.mock('@/hooks/usePreferences', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/hooks/usePreferences')>(),
  usePreferences: () => context,
}));

function setContext(policy: PreferencePolicy = defaultPreferencePolicy, overrides: PreferenceOverrides = {}) {
  const preferences = resolvePreferences(policy, overrides);
  context = {
    preferences, policy, overrides,
    canOverridePreference: (path) => canOverridePreference(path, policy),
    canEditPreference: (path) => canOverridePreference(path, policy) && isPreferenceApplicable(path, preferences),
    isPreferenceOverridden: (path) => getPreferenceValue(overrides, path) !== undefined,
    resetPreference: vi.fn(), resetPreferences: vi.fn(), setPreferences: vi.fn(),
    hasEditablePreferences: true, hasManagedPreferences: false, ready: true,
  };
}

describe('个人偏好策略控件', () => {
  beforeEach(() => setContext());

  it('父项被强制开启时仍可调整子项，强制关闭时隐藏子项和空分组', () => {
    const policy = structuredClone(defaultPreferencePolicy);
    policy.defaults.enableTabs = true;
    policy.allowUserOverride.enableTabs = false;
    setContext(policy);
    const view = (
      <PreferenceSection title={<h2>标签页</h2>}>
        <PreferenceControl path="enableTabs"><button>多标签页开关</button></PreferenceControl>
        <PreferenceControl path="tabStyle"><button>标签页风格</button></PreferenceControl>
      </PreferenceSection>
    );
    const { rerender } = render(view);
    expect(screen.queryByText('多标签页开关')).not.toBeInTheDocument();
    expect(screen.getByText('标签页风格')).toBeVisible();

    policy.defaults.enableTabs = false;
    setContext(policy);
    rerender(<PreferenceSection title={<h2>标签页</h2>}>
      <PreferenceControl path="enableTabs"><button>多标签页开关</button></PreferenceControl>
      <PreferenceControl path="tabStyle"><button>标签页风格</button></PreferenceControl>
    </PreferenceSection>);
    expect(screen.queryByText('标签页风格')).not.toBeInTheDocument();
  });

  it('单项重置只清除指定字段的个人覆盖', async () => {
    setContext(defaultPreferencePolicy, { tablePageSize: 20, tableStriped: true });
    render(<PreferenceControl path="tablePageSize"><div><span>默认分页大小</span></div></PreferenceControl>);
    const reset = screen.getByRole('button', { name: '重置设置：默认分页大小' });
    await userEvent.click(reset);
    expect(context.resetPreference).toHaveBeenCalledExactlyOnceWith('tablePageSize');
    expect(context.resetPreferences).not.toHaveBeenCalled();
  });
});
