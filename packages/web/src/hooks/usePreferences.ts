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
}

export const defaultPreferences: UserPreferences = {
  enableTabs: true,
  tabsMaxCount: 20,
  showTabIcon: true,
  colorMode: 'light',
  navLayout: 'vertical',
  showBreadcrumb: true,
  themeColor: 'blue',
  tabAnimation: 'fade',
};

function loadPreferences(): UserPreferences {
  try {
    const raw = localStorage.getItem(PREFERENCES_KEY);
    if (raw) {
      const loaded: UserPreferences = { ...defaultPreferences, ...JSON.parse(raw) };
      // 初始化时立即应用主题色
      applyThemeColor(loaded.themeColor, loaded.colorMode === 'dark');
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
