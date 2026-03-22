import { useState, useEffect, useCallback } from 'react';

export type ThemeMode = 'light' | 'dark' | 'system';

const STORAGE_KEY = 'zenith_theme';

function getSystemDark(): boolean {
  return globalThis.matchMedia('(prefers-color-scheme: dark)').matches;
}

function applyTheme(mode: ThemeMode) {
  const isDark = mode === 'dark' || (mode === 'system' && getSystemDark());
  document.documentElement.dataset.theme = isDark ? 'dark' : 'light';
  // Semi Design dark mode: body[theme-mode="dark"]
  if (isDark) {
    document.body.setAttribute('theme-mode', 'dark');
  } else {
    document.body.removeAttribute('theme-mode');
  }
}

export function useTheme() {
  const [mode, setMode] = useState<ThemeMode>(() => {
    return (localStorage.getItem(STORAGE_KEY) as ThemeMode) ?? 'light';
  });

  // Apply on mount + mode change
  useEffect(() => {
    applyTheme(mode);
  }, [mode]);

  // Listen to system preference changes when mode === 'system'
  useEffect(() => {
    if (mode !== 'system') return;
    const mq = globalThis.matchMedia('(prefers-color-scheme: dark)');
    const handler = () => applyTheme('system');
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, [mode]);

  const setThemeMode = useCallback((newMode: ThemeMode) => {
    localStorage.setItem(STORAGE_KEY, newMode);
    setMode(newMode);
  }, []);

  const cycleTheme = useCallback(() => {
    const order: ThemeMode[] = ['light', 'dark', 'system'];
    const next = order[(order.indexOf(mode) + 1) % order.length];
    setThemeMode(next);
  }, [mode, setThemeMode]);

  return { mode, setThemeMode, cycleTheme };
}
