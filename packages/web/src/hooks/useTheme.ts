import { useState, useEffect, useCallback } from 'react';
import { usePrefersDark } from '@/hooks/useMediaQuery';

export type ThemeMode = 'light' | 'dark' | 'system';

/** 将主题模式直接应用到 DOM（Semi Design 通过 body[theme-mode="dark"] 切换深色） */
export function applyThemeToDom(mode: ThemeMode, systemDark: boolean) {
  const isDark = mode === 'dark' || (mode === 'system' && systemDark);
  if (isDark) {
    document.body.setAttribute('theme-mode', 'dark');
    document.body.style.colorScheme = 'dark';
  } else {
    document.body.removeAttribute('theme-mode');
    document.body.style.colorScheme = 'light';
  }
}

export function useTheme(initialMode: ThemeMode = 'light') {
  const [mode, setMode] = useState<ThemeMode>(initialMode);
  // 系统深色偏好统一走 usePrefersDark；其变化会自动触发重渲染并重新应用主题
  const systemDark = usePrefersDark();

  // Keep mode synced with external source of truth
  useEffect(() => {
    setMode(initialMode);
  }, [initialMode]);

  // Apply on mount + mode change + 系统偏好变化（mode === 'system' 时生效）
  useEffect(() => {
    applyThemeToDom(mode, systemDark);
  }, [mode, systemDark]);

  const setThemeMode = useCallback((newMode: ThemeMode) => {
    setMode(newMode);
  }, []);

  const cycleTheme = useCallback(() => {
    const order: ThemeMode[] = ['light', 'dark', 'system'];
    const next = order[(order.indexOf(mode) + 1) % order.length];
    setThemeMode(next);
  }, [mode, setThemeMode]);

  return { mode, setThemeMode, cycleTheme };
}
