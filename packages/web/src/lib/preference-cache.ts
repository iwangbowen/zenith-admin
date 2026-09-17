import { PREFERENCES_KEY } from '@zenith/shared/core';
import {
  defaultPreferencePolicy,
  preferencePolicySchema,
  resolvePreferences,
  userPreferencesDocumentSchema,
  type PreferencePolicy,
  type PreferenceOverrides,
} from '@zenith/shared/preferences';

/** 仅缓存新模型；服务端仍是策略与个人覆盖的权威来源。 */
export function readPreferenceCache(): { policy: PreferencePolicy; overrides: PreferenceOverrides } {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(PREFERENCES_KEY) ?? 'null');
    if (raw && typeof raw === 'object' && 'schemaVersion' in raw && raw.schemaVersion === 1) {
      const document = userPreferencesDocumentSchema.safeParse({ overrides: 'overrides' in raw ? raw.overrides : undefined });
      const policy = preferencePolicySchema.safeParse('policy' in raw ? raw.policy : undefined);
      if (document.success && policy.success) return { policy: policy.data, overrides: document.data.overrides };
    }
  } catch { /* 本地缓存不可用时，仍可从服务端读取。 */ }
  return { policy: defaultPreferencePolicy, overrides: {} };
}

export function writePreferenceCache(policy: PreferencePolicy, overrides: PreferenceOverrides): void {
  try {
    localStorage.setItem(PREFERENCES_KEY, JSON.stringify({
      schemaVersion: 1,
      policy,
      overrides,
    }));
  } catch { /* 存储受限不影响当前会话和服务端保存。 */ }
}

export function readCachedPreferences() {
  const { policy, overrides } = readPreferenceCache();
  return resolvePreferences(policy, overrides);
}
