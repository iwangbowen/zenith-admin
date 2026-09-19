import { describe, expect, it } from 'vitest';
import {
  canOverridePreference,
  defaultPreferences,
  getPreferenceValue,
  isPreferenceApplicable,
  preferenceDefinitions,
  preferenceOverridesSchema,
  preferencePolicySchema,
  preferenceValuesSchema,
  readUserPreferencesDocument,
  removePreferenceOverride,
  resolvePreferences,
  sanitizePreferenceOverrides,
  setPreferenceValue,
  userPreferencesDocumentSchema,
  validatePreferenceDefinitions,
} from './index';

describe('偏好策略与个人覆盖', () => {
  it('保留全部现有默认值，96 项策略排除个人收藏', () => {
    const policy = preferencePolicySchema.parse({});
    expect(preferenceDefinitions).toHaveLength(96);
    expect(defaultPreferences.topbarClock).toBe('off');
    expect(defaultPreferences.topbarClockShowDate).toBe(true);
    expect(defaultPreferences.scheduledDarkMode).toBe('off');
    expect(defaultPreferences.scheduledDarkStart).toBe('18:00');
    expect(defaultPreferences.scheduledDarkEnd).toBe('06:00');
    expect(resolvePreferences(policy, {})).toEqual(defaultPreferences);
    expect(defaultPreferences.themeColor).toBe('blue');
    expect(defaultPreferences.terminal.copyOnSelect).toBe(true);
    expect('favorites' in policy.defaults.terminal).toBe(false);
    expect(preferenceDefinitions.every(({ path }) => canOverridePreference(path, policy))).toBe(true);
  });

  it('个人覆盖始终稀疏，保留显式选择即使与当时默认值相同', () => {
    const override = preferenceOverridesSchema.parse({ colorMode: 'light', terminal: { fontSize: 14 } });
    expect(override).toEqual({ colorMode: 'light', terminal: { fontSize: 14 } });
    expect(preferenceOverridesSchema.parse({})).toEqual({});
    const policy = preferencePolicySchema.parse({ defaults: { colorMode: 'dark', terminal: { fontSize: 18 } } });
    expect(resolvePreferences(policy, override)).toMatchObject({ colorMode: 'light', terminal: { fontSize: 14 } });
    expect(resolvePreferences(policy, {})).toMatchObject({ colorMode: 'dark', terminal: { fontSize: 18 } });
  });

  it('强制值暂停个人覆盖，解除后恢复，其他嵌套叶子互不影响', () => {
    const policy = preferencePolicySchema.parse({
      defaults: { terminal: { fontSize: 18 } },
      allowUserOverride: { terminal: { fontSize: false } },
    });
    const overrides = { terminal: { fontSize: 22, cursorBlink: false, favorites: [{ path: '/tmp', name: '临时目录' }] } };
    expect(resolvePreferences(policy, overrides).terminal).toMatchObject({ fontSize: 18, cursorBlink: false, favorites: overrides.terminal.favorites });
    policy.allowUserOverride.terminal.fontSize = true;
    expect(resolvePreferences(policy, overrides).terminal.fontSize).toBe(22);
    expect(overrides.terminal.fontSize).toBe(22);
  });

  it('跟随系统只删除一个覆盖，并清除空的嵌套对象', () => {
    const overrides = { colorMode: 'dark' as const, terminal: { fontSize: 22, cursorBlink: false } };
    expect(removePreferenceOverride(overrides, 'terminal.fontSize')).toEqual({ colorMode: 'dark', terminal: { cursorBlink: false } });
    expect(removePreferenceOverride({ terminal: { fontSize: 22 } }, 'terminal.fontSize')).toEqual({});
    expect(overrides.terminal.fontSize).toBe(22);
  });

  it('路径更新不可变且保留相邻叶子', () => {
    const before = preferencePolicySchema.parse({});
    const next = setPreferenceValue(before.defaults, 'terminal.fontSize', 22);
    expect(getPreferenceValue(next, 'terminal.fontSize')).toBe(22);
    expect(before.defaults.terminal.fontSize).toBe(14);
    expect(next.terminal.themeDark).toBe(before.defaults.terminal.themeDark);
  });

  it('禁止历史完整值格式，未知字段和非法嵌套值不会写入', () => {
    expect(userPreferencesDocumentSchema.safeParse(defaultPreferences).success).toBe(false);
    expect(readUserPreferencesDocument(defaultPreferences)).toEqual({ overrides: {} });
    expect(readUserPreferencesDocument({ overrides: { tableBordered: false } })).toEqual({ overrides: { tableBordered: false } });
    expect(preferenceOverridesSchema.safeParse({ unknown: true }).success).toBe(false);
    expect(preferenceOverridesSchema.safeParse({ terminal: { fontSize: 0 } }).success).toBe(false);
    expect(preferencePolicySchema.safeParse({ defaults: { terminal: { favorites: [] } } }).success).toBe(false);
    expect(preferenceValuesSchema.safeParse({ homePath: '//example.com' }).success).toBe(false);
  });

  it('导入逐叶过滤，数值范围和枚举同样校验，不补默认值', () => {
    expect(sanitizePreferenceOverrides({
      tableBordered: false,
      navLayout: 'invalid',
      sidebarWidth: 10,
      terminal: { fontSize: 20, cursorStyle: 'invalid', favorites: [{ path: '/tmp', name: '临时目录' }] },
      unknown: true,
    })).toEqual({ tableBordered: false, terminal: { fontSize: 20, favorites: [{ path: '/tmp', name: '临时目录' }] } });
    expect(sanitizePreferenceOverrides({ terminal: { fontSize: 0 } })).toBeNull();
  });
});

describe('偏好依赖与互斥', () => {
  it('锁定父项不会级联锁定，只有父功能关闭才隐藏子项', () => {
    const policy = preferencePolicySchema.parse({ allowUserOverride: { enableTabs: false } });
    expect(canOverridePreference('tabStyle', policy)).toBe(true);
    expect(isPreferenceApplicable('tabStyle', resolvePreferences(policy, { enableTabs: false }))).toBe(true);
    policy.defaults.enableTabs = false;
    expect(isPreferenceApplicable('tabStyle', resolvePreferences(policy, { enableTabs: true }))).toBe(false);
  });

  it('依赖使用个人覆盖参与合并后的值，并递归评估父项是否适用', () => {
    const policy = preferencePolicySchema.parse({});
    expect(isPreferenceApplicable('breadcrumbIcon', resolvePreferences(policy, {}))).toBe(false);
    expect(isPreferenceApplicable('breadcrumbIcon', resolvePreferences(policy, { showBreadcrumb: true }))).toBe(true);
    expect(isPreferenceApplicable('darkSidebarTone', resolvePreferences(policy, { sidebarDarkMode: true }))).toBe(true);
    expect(isPreferenceApplicable('darkSidebarTone', resolvePreferences(policy, { sidebarDarkMode: true, navLayout: 'horizontal' }))).toBe(false);
    expect(isPreferenceApplicable('terminal.tabCollapsed', resolvePreferences(policy, { terminal: { tabPosition: 'right' } }))).toBe(true);
    expect(isPreferenceApplicable('terminal.tabCollapsed', resolvePreferences(policy, {}))).toBe(false);
    expect(isPreferenceApplicable('doubleRailStyle', resolvePreferences(policy, { navLayout: 'double' }))).toBe(true);
    expect(isPreferenceApplicable('doubleRailStyle', resolvePreferences(policy, { navLayout: 'vertical' }))).toBe(false);
    expect(resolvePreferences(policy, {}).doubleRailStyle).toBe('icon');
  });

  it('减弱动效优先，加载动画和页面内部标签栏保持适用', () => {
    const policy = preferencePolicySchema.parse({});
    const values = resolvePreferences(policy, { reduceMotion: true, enableTabs: false });
    expect(values.routeAnimation).toBe('none');
    expect(values.tabAnimation).toBe('none');
    expect(isPreferenceApplicable('routeAnimation', values)).toBe(false);
    expect(isPreferenceApplicable('loadingStyle', values)).toBe(true);
    expect(isPreferenceApplicable('tabsSize', values)).toBe(true);
  });

  it('灰色与色弱互斥，强制值优先且不删除原个人选择', () => {
    expect(preferencePolicySchema.safeParse({ defaults: { grayscale: true, colorBlind: true } }).success).toBe(false);
    // 个人覆盖可能包含被系统暂停的旧值，互斥只约束生效值。
    expect(preferenceOverridesSchema.safeParse({ grayscale: true, colorBlind: true }).success).toBe(true);
    const policy = preferencePolicySchema.parse({ defaults: { grayscale: true }, allowUserOverride: { grayscale: false } });
    const overrides = { colorBlind: true };
    expect(resolvePreferences(policy, overrides)).toMatchObject({ grayscale: true, colorBlind: false });
    policy.allowUserOverride.grayscale = true;
    expect(resolvePreferences(policy, overrides)).toMatchObject({ grayscale: false, colorBlind: true });
    expect(overrides).toEqual({ colorBlind: true });
  });

  it('强制关闭灰色时保留旧覆盖，同时允许个人开启色弱', () => {
    const policy = preferencePolicySchema.parse({ allowUserOverride: { grayscale: false } });
    const overrides = preferenceOverridesSchema.parse({ grayscale: true, colorBlind: true });
    expect(sanitizePreferenceOverrides(overrides)).toEqual(overrides);
    expect(resolvePreferences(policy, overrides)).toMatchObject({ grayscale: false, colorBlind: true });
    policy.allowUserOverride.grayscale = true;
    expect(resolvePreferences(policy, overrides)).toMatchObject({ grayscale: true, colorBlind: false });
    expect(overrides).toEqual({ grayscale: true, colorBlind: true });
  });

  it('依赖目录拒绝不存在字段和循环', () => {
    expect(() => validatePreferenceDefinitions()).not.toThrow();
    const field = preferenceDefinitions.find((definition) => definition.path === 'enableTabs')!;
    expect(() => validatePreferenceDefinitions([{ ...field, applicableWhen: { field: 'tabStyle', equals: 'line' } }])).toThrow('未知字段');
    expect(() => validatePreferenceDefinitions([{ ...field, applicableWhen: { field: 'enableTabs', equals: true } }])).toThrow('循环');
  });
});
