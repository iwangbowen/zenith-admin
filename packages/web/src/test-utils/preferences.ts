import { vi } from 'vitest';
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

/** 非 Provider 单测的完整上下文，避免组件新增策略行为时被不完整的类型强转掩盖。 */
export function createPreferencesContext(
  overrides: PreferenceOverrides = {},
  policy: PreferencePolicy = defaultPreferencePolicy,
): PreferencesContextValue {
  const preferences = resolvePreferences(policy, overrides);
  return {
    preferences,
    overrides,
    policy,
    setPreferences: vi.fn(() => ({ applied: 0, skipped: 0 })),
    resetPreferences: vi.fn(),
    resetPreference: vi.fn(),
    canOverridePreference: (path) => canOverridePreference(path, policy),
    canEditPreference: (path) => canOverridePreference(path, policy) && isPreferenceApplicable(path, preferences),
    isPreferenceOverridden: (path) => getPreferenceValue(overrides, path) !== undefined,
    hasEditablePreferences: true,
    hasManagedPreferences: false,
    ready: true,
  };
}
