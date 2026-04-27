import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { PREFERENCES_KEY } from '@zenith/shared';
import { useTheme, type ThemeMode } from '@/hooks/useTheme';
import { applyThemeColor, type ThemeColor } from '@/lib/theme-color';
import { defaultPreferences } from '@/hooks/usePreferences';

type ThemePrefs = {
  colorMode: ThemeMode;
  themeColor: ThemeColor;
};

const THEME_DEFAULTS: ThemePrefs = {
  colorMode: 'light',
  themeColor: 'blue',
};

interface ThemeControllerValue {
  mode: ThemeMode;
  themeColor: ThemeColor;
  isDark: boolean;
  setThemeMode: (mode: ThemeMode) => void;
  setThemeColor: (color: ThemeColor) => void;
  cycleTheme: () => void;
  resetTheme: () => void;
}

const ThemeControllerContext = createContext<ThemeControllerValue | null>(null);

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
  const initial = useMemo(() => loadThemePrefs(), []);
  const [themeColor, setThemeColor] = useState<ThemeColor>(initial.themeColor);
  const { mode, setThemeMode: setThemeModeInternal } = useTheme(initial.colorMode);

  const isDark = mode === 'dark' || (mode === 'system' && globalThis.matchMedia?.('(prefers-color-scheme: dark)').matches);

  useEffect(() => {
    applyThemeColor(themeColor, isDark);
  }, [themeColor, isDark]);

  const setThemeMode = useCallback((nextMode: ThemeMode) => {
    setThemeModeInternal(nextMode);
    persistThemePrefs({ colorMode: nextMode });
  }, [setThemeModeInternal]);

  const updateThemeColor = useCallback((nextColor: ThemeColor) => {
    setThemeColor(nextColor);
    persistThemePrefs({ themeColor: nextColor });
  }, []);

  const cycleTheme = useCallback(() => {
    const order: ThemeMode[] = ['light', 'dark', 'system'];
    const next = order[(order.indexOf(mode) + 1) % order.length];
    setThemeMode(next);
  }, [mode, setThemeMode]);

  const resetTheme = useCallback(() => {
    const defaultMode = THEME_DEFAULTS.colorMode;
    const defaultColor = THEME_DEFAULTS.themeColor;
    setThemeModeInternal(defaultMode);
    setThemeColor(defaultColor);
    persistThemePrefs({ colorMode: defaultMode, themeColor: defaultColor });
  }, [setThemeModeInternal]);

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

export function useThemeController(): ThemeControllerValue {
  const context = useContext(ThemeControllerContext);
  if (!context) {
    throw new Error('useThemeController must be used within ThemeProvider');
  }
  return context;
}
