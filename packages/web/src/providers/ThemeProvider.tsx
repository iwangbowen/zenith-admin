import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { PREFERENCES_KEY } from '@zenith/shared';
import { useTheme, type ThemeMode } from '@/hooks/useTheme';
import { applyThemeColor } from '@/lib/theme-color';
import { defaultPreferences, useOptionalPreferences } from '@/hooks/usePreferences';
import { ThemeControllerContext, type ThemeControllerValue } from './theme-controller';

type ThemePrefs = {
  colorMode: ThemeMode;
  themeColor: string;
};

const THEME_DEFAULTS: ThemePrefs = {
  colorMode: defaultPreferences.colorMode,
  themeColor: defaultPreferences.themeColor,
};

function loadThemePrefs(): ThemePrefs {
  try {
    const raw = localStorage.getItem(PREFERENCES_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<ThemePrefs>;
      return {
        colorMode: parsed.colorMode ?? THEME_DEFAULTS.colorMode,
        themeColor: parsed.themeColor ?? THEME_DEFAULTS.themeColor,
      };
    }
  } catch {
    // ignore
  }
  return {
    colorMode: THEME_DEFAULTS.colorMode,
    themeColor: THEME_DEFAULTS.themeColor,
  };
}

function persistThemePrefs(partial: Partial<ThemePrefs>) {
  try {
    const raw = localStorage.getItem(PREFERENCES_KEY);
    const base = raw ? { ...defaultPreferences, ...JSON.parse(raw) } : { ...defaultPreferences };
    localStorage.setItem(PREFERENCES_KEY, JSON.stringify({ ...base, ...partial }));
  } catch {
    // ignore
  }
}

export function ThemeProvider({ children }: Readonly<{ children: ReactNode }>) {
  const preferencesContext = useOptionalPreferences();
  const serverSyncedPreferences = preferencesContext?.preferences;
  const syncPreferences = preferencesContext?.setPreferences;
  const initial = useMemo(() => loadThemePrefs(), []);
  const [localThemeColor, setLocalThemeColor] = useState<string>(initial.themeColor);
  const themeColor = serverSyncedPreferences?.themeColor ?? localThemeColor;
  const { mode, setThemeMode: setThemeModeInternal } = useTheme(serverSyncedPreferences?.colorMode ?? initial.colorMode);

  const isDark = mode === 'dark' || (mode === 'system' && globalThis.matchMedia?.('(prefers-color-scheme: dark)').matches);

  useEffect(() => {
    applyThemeColor(themeColor, isDark);
  }, [themeColor, isDark]);

  const setThemeMode = useCallback((nextMode: ThemeMode) => {
    setThemeModeInternal(nextMode);
    if (syncPreferences) {
      syncPreferences({ colorMode: nextMode });
      return;
    }
    persistThemePrefs({ colorMode: nextMode });
  }, [setThemeModeInternal, syncPreferences]);

  const updateThemeColor = useCallback((nextColor: string) => {
    setLocalThemeColor(nextColor);
    if (syncPreferences) {
      syncPreferences({ themeColor: nextColor });
      return;
    }
    persistThemePrefs({ themeColor: nextColor });
  }, [syncPreferences]);

  const cycleTheme = useCallback(() => {
    const order: ThemeMode[] = ['light', 'dark', 'system'];
    const next = order[(order.indexOf(mode) + 1) % order.length];
    setThemeMode(next);
  }, [mode, setThemeMode]);

  const resetTheme = useCallback(() => {
    const defaultMode = THEME_DEFAULTS.colorMode;
    const defaultColor = THEME_DEFAULTS.themeColor;
    setThemeModeInternal(defaultMode);
    setLocalThemeColor(defaultColor);
    if (syncPreferences) {
      syncPreferences({ colorMode: defaultMode, themeColor: defaultColor });
      return;
    }
    persistThemePrefs({ colorMode: defaultMode, themeColor: defaultColor });
  }, [setThemeModeInternal, syncPreferences]);

  const value = useMemo<ThemeControllerValue>(() => ({
    mode,
    themeColor,
    isDark,
    setThemeMode,
    setThemeColor: updateThemeColor,
    cycleTheme,
    resetTheme,
  }), [mode, themeColor, isDark, setThemeMode, updateThemeColor, cycleTheme, resetTheme]);

  return (
    <ThemeControllerContext.Provider value={value}>
      {children}
    </ThemeControllerContext.Provider>
  );
}
