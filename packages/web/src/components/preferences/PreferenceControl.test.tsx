import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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
import { PrefsAppearanceSection, PrefsGeneralSection, PrefsNavToolbarSection, PrefsTableSection, PrefsTabsSection } from '@/layouts/admin/PreferencesSections';
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

  it('单项恢复只清除指定字段的个人覆盖', async () => {
    setContext(defaultPreferencePolicy, { tablePageSize: 20, tableStriped: true });
    render(<PreferenceControl path="tablePageSize"><span>默认分页大小</span></PreferenceControl>);
    await userEvent.click(screen.getByRole('button', { name: 'tablePageSize恢复系统默认' }));
    expect(context.resetPreference).toHaveBeenCalledExactlyOnceWith('tablePageSize');
    expect(context.resetPreferences).not.toHaveBeenCalled();
  });

  it('关闭多标签页仍可调整路由动画', () => {
    const policy = structuredClone(defaultPreferencePolicy);
    policy.defaults.enableTabs = false;
    setContext(policy);
    const { preferences, setPreferences } = context;
    const { container } = render(<PrefsTabsSection preferences={preferences} setPreferences={setPreferences}
      matchesPref={() => true} prefSection={(label) => <h2>{label}</h2>} prefsSearch="" />);
    expect(container.querySelector('[data-preference-path="routeAnimation"]')).not.toBeNull();
    expect(container.querySelector('[data-preference-path="tabStyle"]')).toBeNull();
  });

  it('表格偏好逐项隐藏，全部不可编辑时隐藏表格标题', () => {
    const policy = structuredClone(defaultPreferencePolicy);
    policy.allowUserOverride.tableBordered = false;
    setContext(policy);
    const { container, rerender } = render(<PrefsTableSection preferences={context.preferences} setPreferences={context.setPreferences}
      matchesPref={() => true} prefSection={(label) => <h2>{label}</h2>} />);
    expect(container.querySelector('[data-preference-path="tableBordered"]')).toBeNull();
    expect(container.querySelector('[data-preference-path="tableSize"]')).not.toBeNull();
    policy.allowUserOverride.tableStriped = false;
    policy.allowUserOverride.tableSize = false;
    policy.allowUserOverride.tablePageSize = false;
    policy.allowUserOverride.showTableColumnSettings = false;
    policy.allowUserOverride.rememberListFilters = false;
    setContext(policy);
    rerender(<PrefsTableSection preferences={context.preferences} setPreferences={context.setPreferences}
      matchesPref={() => true} prefSection={(label) => <h2>{label}</h2>} />);
    expect(screen.queryByRole('heading', { name: '表格' })).not.toBeInTheDocument();
  });

  it('锁屏开关被系统强制开启时仍提供设备密码设置', async () => {
    const policy = structuredClone(defaultPreferencePolicy);
    policy.defaults.enableLockScreen = true;
    policy.allowUserOverride.enableLockScreen = false;
    setContext(policy);
    const openLockPasswordModal = vi.fn();
    const { container } = render(<PrefsGeneralSection preferences={context.preferences} setPreferences={context.setPreferences}
      matchesPref={() => true} prefSection={(label) => <h2>{label}</h2>}
      homePathOptions={[{ value: '/', label: '首页' }]} autoLockMinutes={0}
      hasPassword={() => false} clearLockPassword={vi.fn()} openLockPasswordModal={openLockPasswordModal} />);
    expect(container.querySelector('[data-preference-path="enableLockScreen"]')).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: '设置密码' }));
    expect(openLockPasswordModal).toHaveBeenCalledExactlyOnceWith('set');
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

  it('无溢出时两箭头禁用，选中项挂载即滚入可见区', () => {
    const { container } = renderAppearance();
    expect(screen.getByRole('button', { name: '上一个加载动画' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '下一个加载动画' })).toBeDisabled();
    expect(container.querySelectorAll('.loading-style-picker__option')).toHaveLength(8);
    expect(scrollIntoView).toHaveBeenCalledExactlyOnceWith({ block: 'nearest', inline: 'nearest' });
  });

  it('溢出时箭头按滚动位置启用，点击滚动一屏', () => {
    const { container, rerender } = renderAppearance();
    const scroller = container.querySelector('.loading-style-picker') as HTMLElement;
    Object.defineProperties(scroller, {
      scrollWidth: { value: 640, configurable: true },
      clientWidth: { value: 280, configurable: true },
    });
    const scrollBy = vi.fn();
    Object.defineProperty(scroller, 'scrollBy', { value: scrollBy, configurable: true });
    const prev = screen.getByRole('button', { name: '上一个加载动画' });
    const next = screen.getByRole('button', { name: '下一个加载动画' });

    scroller.scrollLeft = 100;
    fireEvent.scroll(scroller);
    expect(prev).toBeEnabled();
    expect(next).toBeEnabled();
    fireEvent.click(next);
    expect(scrollBy).toHaveBeenCalledExactlyOnceWith({ left: 280, behavior: 'smooth' });

    scroller.scrollLeft = 360;
    fireEvent.scroll(scroller);
    expect(prev).toBeEnabled();
    expect(next).toBeDisabled();

    // 选中项变化后重新定位
    setContext(defaultPreferencePolicy, { loadingStyle: 'progress' });
    rerender(<PrefsAppearanceSection preferences={context.preferences} setPreferences={context.setPreferences}
      matchesPref={() => true} prefSection={(label) => <h2>{label}</h2>}
      mode="light" handleThemeModeChange={vi.fn()} isDark={false}
      themeColor="blue" setThemeColor={vi.fn()} />);
    expect(scrollIntoView).toHaveBeenCalledTimes(2);
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
