import { useState, useCallback, useContext, createContext, useEffect, useMemo, useRef } from 'react';
import type { ReactNode } from 'react';
import { PREFERENCES_KEY } from '@zenith/shared';
import { request } from '@/utils/request';
import type { ThemeMode } from '@/hooks/useTheme';

export type NavLayout = 'vertical' | 'horizontal' | 'mixed';
export type TabAnimation = 'none' | 'fade' | 'slide' | 'scale';

export interface UserPreferences {
  enableTabs: boolean;
  tabsMaxCount: number;
  showTabIcon: boolean;
  navLayout: NavLayout;
  showBreadcrumb: boolean;
  tabAnimation: TabAnimation;
  colorMode: ThemeMode;
  themeColor: string;
  showMenuSearch: boolean;
  showFullscreen: boolean;
  showQuickChat: boolean;
  filesViewMode: 'list' | 'grid';
  sidebarStickyScroll: boolean;
  showTableColumnSettings: boolean;
}

export const defaultPreferences: UserPreferences = {
  enableTabs: true,
  tabsMaxCount: 20,
  showTabIcon: true,
  navLayout: 'vertical',
  showBreadcrumb: false,
  tabAnimation: 'fade',
  colorMode: 'light',
  themeColor: 'blue',
  showMenuSearch: true,
  showFullscreen: true,
  showQuickChat: true,
  filesViewMode: 'list',
  sidebarStickyScroll: true,
  showTableColumnSettings: true,
};

function loadPreferences(): UserPreferences {
  try {
    const raw = localStorage.getItem(PREFERENCES_KEY);
    if (raw) {
      return { ...defaultPreferences, ...JSON.parse(raw) };
    }
  } catch { /* ignore */ }
  return { ...defaultPreferences };
}

function savePreferences(prefs: UserPreferences) {
  try {
    const raw = localStorage.getItem(PREFERENCES_KEY);
    const base = raw ? JSON.parse(raw) : {};
    localStorage.setItem(PREFERENCES_KEY, JSON.stringify({ ...base, ...prefs }));
  } catch {
    localStorage.setItem(PREFERENCES_KEY, JSON.stringify(prefs));
  }
}

interface PreferencesContextValue {
  preferences: UserPreferences;
  setPreferences: (partial: Partial<UserPreferences>) => void;
  resetPreferences: () => void;
}

const PreferencesContext = createContext<PreferencesContextValue | null>(null);

export function useOptionalPreferences() {
  return useContext(PreferencesContext);
}

export function PreferencesProvider({ children }: { children: ReactNode }) {
  const [prefs, setPrefs] = useState<UserPreferences>(loadPreferences);
  const prefsRef = useRef(prefs);
  const syncTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const applyLocalPreferences = useCallback((next: UserPreferences, persist = true) => {
    prefsRef.current = next;
    setPrefs(next);
    if (persist) savePreferences(next);
  }, []);

  const putPreferences = useCallback((next: UserPreferences) => {
    request.put('/api/auth/preferences', next, { silent: true }).catch(() => { /* ignore */ });
  }, []);

  const scheduleSync = useCallback((next: UserPreferences) => {
    if (syncTimerRef.current) clearTimeout(syncTimerRef.current);
    syncTimerRef.current = setTimeout(() => {
      syncTimerRef.current = null;
      putPreferences(next);
    }, 500);
  }, [putPreferences]);

  const syncNow = useCallback((next: UserPreferences) => {
    if (syncTimerRef.current) {
      clearTimeout(syncTimerRef.current);
      syncTimerRef.current = null;
    }
    putPreferences(next);
  }, [putPreferences]);

  // 组件挂载时（用户已登录）从服务器拉取偏好，覆盖本地缓存
  useEffect(() => {
    let cancelled = false;
    request.get<Record<string, unknown> | null>('/api/auth/preferences', { silent: true })
      .then((res) => {
        if (cancelled || res.code !== 0) return;
        if (res.code === 0 && res.data) {
          const merged = { ...defaultPreferences, ...(res.data as Partial<UserPreferences>) };
          applyLocalPreferences(merged);
          return;
        }
        // 老用户服务器端暂无偏好时，把本地缓存迁移到服务器。
        scheduleSync(prefsRef.current);
      })
      .catch(() => { /* ignore */ });
    return () => { cancelled = true; };
  }, [applyLocalPreferences, scheduleSync]);

  useEffect(() => () => {
    if (syncTimerRef.current) clearTimeout(syncTimerRef.current);
  }, []);

  const setPreferences = useCallback((partial: Partial<UserPreferences>) => {
    const next = { ...prefsRef.current, ...partial };
    applyLocalPreferences(next);
    scheduleSync(next);
  }, [applyLocalPreferences, scheduleSync]);

  const resetPreferences = useCallback(() => {
    const next = { ...defaultPreferences };
    localStorage.removeItem(PREFERENCES_KEY);
    applyLocalPreferences(next, false);
    syncNow(next);
  }, [applyLocalPreferences, syncNow]);

  const value = useMemo(
    () => ({ preferences: prefs, setPreferences, resetPreferences }),
    [prefs, setPreferences, resetPreferences],
  );

  return (
    <PreferencesContext.Provider value={value}>
      {children}
    </PreferencesContext.Provider>
  );
}

export function usePreferences() {
  const ctx = useContext(PreferencesContext);
  if (!ctx) {
    throw new Error('usePreferences must be used within PreferencesProvider');
  }
  return ctx;
}
