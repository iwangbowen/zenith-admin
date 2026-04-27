import { useState, useEffect, useCallback } from 'react';

export type ThemeMode = 'light' | 'dark' | 'system';

function getSystemDark(): boolean {
  return globalThis.matchMedia('(prefers-color-scheme: dark)').matches;
}

function applyTheme(mode: ThemeMode) {
  const isDark = mode === 'dark' || (mode === 'system' && getSystemDark());
  // Semi Design dark mode: body[theme-mode="dark"]
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

  // Keep mode synced with external source of truth
  useEffect(() => {
    setMode(initialMode);
  }, [initialMode]);

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
    setMode(newMode);
  }, []);

  const cycleTheme = useCallback(() => {
    const order: ThemeMode[] = ['light', 'dark', 'system'];
    const next = order[(order.indexOf(mode) + 1) % order.length];
    setThemeMode(next);
  }, [mode, setThemeMode]);

  return { mode, setThemeMode, cycleTheme };
}
