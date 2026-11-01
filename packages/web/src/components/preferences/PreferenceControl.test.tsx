import { render, screen,} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  canOverridePreference,
  defaultPreferencePolicy,
  getPreferenceValue,
  isPreferenceApplicable,
  LOADING_STYLE_OPTIONS,
  resolvePreferences,
  type PreferenceOverrides,
  type PreferencePolicy,
} from '@zenith/shared/preferences';
import type { PreferencesContextValue } from '@/hooks/usePreferences';
import { PrefsAppearanceSection, PrefsNavToolbarSection,} from '@/layouts/admin/PreferencesSections';
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
    expect(screen.getByRole('heading', { name: '标签页' })).toBeVisible();

    policy.defaults.enableTabs = false;
    setContext(policy);
    rerender(<PreferenceSection title={<h2>标签页</h2>}>
      <PreferenceControl path="enableTabs"><button>多标签页开关</button></PreferenceControl>
      <PreferenceControl path="tabStyle"><button>标签页风格</button></PreferenceControl>
    </PreferenceSection>);
    expect(screen.queryByText('标签页风格')).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: '标签页' })).not.toBeInTheDocument();
  });

  it('单项重置只清除指定字段的个人覆盖', async () => {
    setContext(defaultPreferencePolicy, { tablePageSize: 20, tableStriped: true });
    render(<PreferenceControl path="tablePageSize"><div><span>默认分页大小</span></div></PreferenceControl>);
    const reset = screen.getByRole('button', { name: '重置设置：默认分页大小' });
    expect(reset).not.toHaveTextContent('重置设置');
    // 重置图标位于设置名称之前：DOM 顺序与视觉顺序一致
    expect(reset.compareDocumentPosition(screen.getByText('默认分页大小')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    await userEvent.click(reset);
    expect(context.resetPreference).toHaveBeenCalledExactlyOnceWith('tablePageSize');
    expect(context.resetPreferences).not.toHaveBeenCalled();
  });

  it('未覆盖的项目不显示重置图标', () => {
    setContext(defaultPreferencePolicy, { tableStriped: true });
    render(<PreferenceControl path="tablePageSize"><div><span>默认分页大小</span></div></PreferenceControl>);
    expect(screen.queryByRole('button', { name: /^重置设置/ })).not.toBeInTheDocument();
  });
});

describe('加载动画选择行', () => {
  const originalScrollIntoView = window.HTMLElement.prototype.scrollIntoView;
  const scrollIntoView = vi.fn();
  beforeEach(() => {
    scrollIntoView.mockClear();
    Object.defineProperty(window.HTMLElement.prototype, 'scrollIntoView', {
      value: scrollIntoView, configurable: true, writable: true,
    });
    setContext();
  });
  afterEach(() => {
    Object.defineProperty(window.HTMLElement.prototype, 'scrollIntoView', {
      value: originalScrollIntoView, configurable: true, writable: true,
    });
  });

  function renderAppearance() {
    return render(<PrefsAppearanceSection preferences={context.preferences} setPreferences={context.setPreferences}
      matchesPref={() => true} prefSection={(label) => <h2>{label}</h2>}
      mode="light" handleThemeModeChange={vi.fn()} isDark={false}
      themeColor="blue" setThemeColor={vi.fn()} />);
  }

  it('无溢出时两箭头禁用，定位不滚动抽屉正文', () => {
    const { container } = renderAppearance();
    expect(screen.getByRole('button', { name: '上一个加载动画' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '下一个加载动画' })).toBeDisabled();
    // 数量由选项表派生：再加动画不必回来改这个数字
    expect(container.querySelectorAll('.loading-style-picker__option')).toHaveLength(LOADING_STYLE_OPTIONS.length);
    // 只用容器自身的 scrollLeft 定位：scrollIntoView 会连带滚动抽屉，一打开偏好设置就被拽到加载动画那一屏
    expect(scrollIntoView).not.toHaveBeenCalled();
  });
});

describe('顶栏时钟与定时深色', () => {
  function renderAppearance(policy = defaultPreferencePolicy, overrides: PreferenceOverrides = {}) {
    setContext(policy, overrides);
    return render(<PrefsAppearanceSection preferences={context.preferences} setPreferences={context.setPreferences}
      matchesPref={() => true} prefSection={(label) => <h2>{label}</h2>}
      mode="light" handleThemeModeChange={vi.fn()} isDark={false}
      themeColor="blue" setThemeColor={vi.fn()} />);
  }

  function renderNavToolbar(policy = defaultPreferencePolicy, overrides: PreferenceOverrides = {}) {
    setContext(policy, overrides);
    return render(<PrefsNavToolbarSection preferences={context.preferences} setPreferences={context.setPreferences}
      matchesPref={() => true} prefSection={(label) => <h2>{label}</h2>}
      prefsSearch="" quickChatEnabled />);
  }

  it('定时关闭时起止时间隐藏，自定义时段时显示', () => {
    const closed = renderAppearance();
    expect(closed.queryByText('深色开始时间')).not.toBeInTheDocument();
    expect(closed.queryByText('深色结束时间')).not.toBeInTheDocument();
    closed.unmount();
    const custom = renderAppearance(defaultPreferencePolicy, { scheduledDarkMode: 'custom' });
    expect(custom.getByText('深色开始时间')).toBeVisible();
    expect(custom.getByText('深色结束时间')).toBeVisible();
  });

  it('时钟关闭时日期开关隐藏，开启后显示', () => {
    const closed = renderNavToolbar();
    expect(closed.queryByText('时钟显示日期')).not.toBeInTheDocument();
    closed.unmount();
    const opened = renderNavToolbar(defaultPreferencePolicy, { topbarClock: '24h' });
    expect(opened.getByText('时钟显示日期')).toBeVisible();
    expect(opened.getByText('顶栏时钟')).toBeVisible();
  });

  it('锁定时钟后两项一起隐藏', () => {
    const policy = structuredClone(defaultPreferencePolicy);
    policy.allowUserOverride.topbarClock = false;
    const view = renderNavToolbar(policy);
    expect(view.queryByText('顶栏时钟')).not.toBeInTheDocument();
  });
});
