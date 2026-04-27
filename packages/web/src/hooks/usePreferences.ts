import { useState, useCallback } from 'react';
import { PREFERENCES_KEY } from '@zenith/shared';
import type { ThemeMode } from './useTheme';
import { applyThemeColor, type ThemeColor } from '@/lib/theme-color';

export type NavLayout = 'vertical' | 'horizontal' | 'mixed';
export type TabAnimation = 'none' | 'fade' | 'slide' | 'scale';

export interface UserPreferences {
  enableTabs: boolean;
  tabsMaxCount: number;
  showTabIcon: boolean;
  colorMode: ThemeMode;
  navLayout: NavLayout;
  showBreadcrumb: boolean;
  themeColor: ThemeColor;
  tabAnimation: TabAnimation;
  showMenuSearch: boolean;
  showFullscreen: boolean;
}

export const defaultPreferences: UserPreferences = {
  enableTabs: true,
  tabsMaxCount: 20,
  showTabIcon: true,
  colorMode: 'light',
  navLayout: 'vertical',
  showBreadcrumb: false,
  themeColor: 'blue',
  tabAnimation: 'fade',
  showMenuSearch: true,
  showFullscreen: true,
};

function loadPreferences(): UserPreferences {
  try {
    const raw = localStorage.getItem(PREFERENCES_KEY);
    if (raw) {
      const loaded: UserPreferences = { ...defaultPreferences, ...JSON.parse(raw) };
      const isDark = loaded.colorMode === 'dark'
        || (loaded.colorMode === 'system' && globalThis.matchMedia?.('(prefers-color-scheme: dark)').matches);
      // 初始化时立即应用主题色
      applyThemeColor(loaded.themeColor, isDark);
      return loaded;
    }
  } catch { /* ignore */ }
  return { ...defaultPreferences };
}

function savePreferences(prefs: UserPreferences) {
  localStorage.setItem(PREFERENCES_KEY, JSON.stringify(prefs));
}

export function usePreferences() {
  const [prefs, setPrefs] = useState<UserPreferences>(loadPreferences);

  const setPreferences = useCallback((partial: Partial<UserPreferences>) => {
    setPrefs((prev) => {
      const next = { ...prev, ...partial };
      savePreferences(next);
      return next;
    });
  }, []);

  const resetPreferences = useCallback(() => {
    localStorage.removeItem(PREFERENCES_KEY);
    applyThemeColor(defaultPreferences.themeColor, false);
    setPrefs({ ...defaultPreferences });
  }, []);

  return { preferences: prefs, setPreferences, resetPreferences };
}
