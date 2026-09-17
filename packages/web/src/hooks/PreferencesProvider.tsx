import { useState, useCallback, useEffect, useMemo, useRef, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useDebouncer } from '@tanstack/react-pacer';
import {
  canOverridePreference, getPreferenceValue, isPreferenceApplicable, preferenceDefinitions,
  removePreferenceOverride, resolvePreferences, sanitizePreferenceOverrides, setPreferenceValue,
  type PreferenceOverrides, type PreferencePath,
} from '@zenith/shared/preferences';
import { applyWeekStart } from '@/lib/week-start';
import { readPreferenceCache, writePreferenceCache } from '@/lib/preference-cache';
import { settingsKeys, useMySettings } from './queries/settings';
import { preferencesKey, usePersonalPreferences, useSavePersonalPreferences } from './queries/preferences';
import { subscribeWsStatus, useWebSocket } from './useWebSocket';
import { PreferencesContext, type PreferenceChangeResult } from './usePreferences';

export function PreferencesProvider({ children }: Readonly<{ children: ReactNode }>) {
  const [cached] = useState(readPreferenceCache);
  const queryClient = useQueryClient();
  const personal = usePersonalPreferences();
  const settings = useMySettings();
  const { mutateAsync } = useSavePersonalPreferences();
  const [draft, setDraft] = useState<PreferenceOverrides | null>(null);
  const revision = useRef(0);
  const policy = settings.data?.ui.preferences ?? cached.policy;
  const overrides = draft ?? personal.data?.overrides ?? cached.overrides;
  const preferences = useMemo(() => resolvePreferences(policy, overrides), [policy, overrides]);
  const ready = personal.isFetched && settings.isFetched;
  // 缓存只用于渲染，策略和个人数据未成功读取时不允许写入。
  const writable = Boolean(personal.data && settings.data);
  const current = useRef({ policy, overrides, writable });
  current.current = { policy, overrides, writable };

  // DatePicker 的 defaultProps 必须在子树构造前更新，动态加载也由 applyWeekStart 同步。
  void applyWeekStart(preferences.weekStart);
  useEffect(() => { writePreferenceCache(policy, overrides); }, [policy, overrides]);
  useEffect(() => {
    const options = queryClient.getDefaultOptions();
    queryClient.setDefaultOptions({
      ...options, queries: { ...options.queries, refetchOnWindowFocus: preferences.refetchOnFocus },
    });
  }, [queryClient, preferences.refetchOnFocus]);

  const refreshPolicy = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: settingsKeys.me });
  }, [queryClient]);
  useWebSocket((message) => { if (message.type === 'preferences:policy-updated') refreshPolicy(); });
  useEffect(() => subscribeWsStatus((connected) => { if (connected) refreshPolicy(); }), [refreshPolicy]);

  const persist = useCallback(async (next: PreferenceOverrides, version: number) => {
    try {
      await mutateAsync({ body: { overrides: next } });
      if (revision.current === version) setDraft(null);
    } catch {
      // 请求层展示错误；回源策略与个人值，撤销仍属于本次失败写入的乐观状态。
      refreshPolicy();
      await queryClient.invalidateQueries({ queryKey: preferencesKey });
      if (revision.current === version) setDraft(null);
    }
  }, [mutateAsync, queryClient, refreshPolicy]);
  const sync = useDebouncer(persist, { wait: 500 });
  const update = useCallback((next: PreferenceOverrides, immediate = false) => {
    current.current.overrides = next;
    setDraft(next);
    const version = ++revision.current;
    if (immediate) { sync.cancel(); void persist(next, version); }
    else sync.maybeExecute(next, version);
  }, [persist, sync]);

  const setPreferences = useCallback((partial: PreferenceOverrides): PreferenceChangeResult => {
    const valid = sanitizePreferenceOverrides(partial);
    if (!valid || !current.current.writable) return { applied: 0, skipped: 0 };
    let next = current.current.overrides;
    let applied = 0;
    let skipped = 0;
    for (const { path } of preferenceDefinitions) {
      const value = getPreferenceValue(valid, path);
      if (value === undefined) continue;
      if (!canOverridePreference(path, current.current.policy)) { skipped++; continue; }
      const otherMode = path === 'grayscale' ? 'colorBlind' : path === 'colorBlind' ? 'grayscale' : null;
      if (value === true && otherMode && !current.current.policy.allowUserOverride[otherMode] && current.current.policy.defaults[otherMode]) {
        skipped++;
        continue;
      }
      next = setPreferenceValue(next, path, value);
      applied++;
    }
    // 明确开启某种显示模式时，关闭另一项可编辑模式；受系统锁定的旧覆盖仍保留。
    if (valid.grayscale === true && current.current.policy.allowUserOverride.grayscale && current.current.policy.allowUserOverride.colorBlind) {
      next = { ...next, colorBlind: false };
    } else if (valid.colorBlind === true && current.current.policy.allowUserOverride.colorBlind && current.current.policy.allowUserOverride.grayscale) {
      next = { ...next, grayscale: false };
    }
    if (valid.terminal?.favorites !== undefined) {
      next = { ...next, terminal: { ...next.terminal, favorites: valid.terminal.favorites } };
      applied++;
    }
    if (applied > 0) update(next);
    return { applied, skipped };
  }, [update]);
  const resetPreference = useCallback((path: PreferencePath | readonly PreferencePath[]) => {
    if (!current.current.writable) return;
    const paths: readonly PreferencePath[] = typeof path === 'string' ? [path] : path;
    const next = paths.reduce((value, field) => removePreferenceOverride(value, field), current.current.overrides);
    update(next, true);
  }, [update]);
  const resetPreferences = useCallback(() => {
    if (!current.current.writable) return;
    // 收藏目录是个人数据，不随“恢复系统默认”清空。
    const favorites = current.current.overrides.terminal?.favorites;
    update(favorites === undefined ? {} : { terminal: { favorites } }, true);
  }, [update]);

  const canOverride = useCallback((path: PreferencePath) => writable && canOverridePreference(path, policy), [writable, policy]);
  const canEdit = useCallback((path: PreferencePath) => {
    if (!canOverride(path) || !isPreferenceApplicable(path, preferences)) return false;
    if (path === 'showQuickChat' && !settings.data?.ui.quickChatEnabled) return false;
    if (path === 'grayscale' && !policy.allowUserOverride.colorBlind && preferences.colorBlind) return false;
    if (path === 'colorBlind' && !policy.allowUserOverride.grayscale && preferences.grayscale) return false;
    return true;
  }, [canOverride, preferences, policy, settings.data?.ui.quickChatEnabled]);
  const isOverridden = useCallback((path: PreferencePath) => getPreferenceValue(overrides, path) !== undefined, [overrides]);
  const hasEditablePreferences = preferenceDefinitions.some(({ path, group }) => group !== 'terminal' && group !== 'notifications' && canEdit(path));
  const hasManagedPreferences = preferenceDefinitions.some(({ path }) => !canOverridePreference(path, policy));
  const value = useMemo(() => ({
    preferences, overrides, policy, setPreferences, resetPreferences, resetPreference,
    canEditPreference: canEdit, canOverridePreference: canOverride, isPreferenceOverridden: isOverridden,
    hasEditablePreferences, hasManagedPreferences, ready,
  }), [preferences, overrides, policy, setPreferences, resetPreferences, resetPreference, canEdit, canOverride, isOverridden, hasEditablePreferences, hasManagedPreferences, ready]);
  return <PreferencesContext.Provider value={value}>{children}</PreferencesContext.Provider>;
}
