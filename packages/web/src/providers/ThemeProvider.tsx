import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { flushSync } from 'react-dom';
import { PREFERENCES_KEY } from '@zenith/shared';
import { useTheme, applyThemeToDom, type ThemeMode } from '@/hooks/useTheme';
import { usePrefersDark } from '@/hooks/useMediaQuery';
import { applyThemeColor } from '@/lib/theme-color';
import { withThemeTransition } from '@/lib/theme-transition';
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

  const prefersDark = usePrefersDark();
  const isDark = mode === 'dark' || (mode === 'system' && prefersDark);

  useEffect(() => {
    applyThemeColor(themeColor, isDark);
  }, [themeColor, isDark]);

  const setThemeMode = useCallback((nextMode: ThemeMode) => {
    const nextIsDark = nextMode === 'dark' || (nextMode === 'system' && prefersDark);
    if (nextIsDark === isDark) {
      // 明暗不变（如 dark → system 且系统为深色）无需过渡动画
      setThemeModeInternal(nextMode);
    } else {
      // View Transition 圆形扩散：DOM 变更与 React 状态更新须同步发生在快照回调内
      withThemeTransition(() => {
        applyThemeToDom(nextMode, prefersDark);
        applyThemeColor(themeColor, nextIsDark);
        flushSync(() => setThemeModeInternal(nextMode));
      });
    }
    if (syncPreferences) {
      syncPreferences({ colorMode: nextMode });
      return;
    }
    persistThemePrefs({ colorMode: nextMode });
  }, [setThemeModeInternal, syncPreferences, prefersDark, isDark, themeColor]);

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
