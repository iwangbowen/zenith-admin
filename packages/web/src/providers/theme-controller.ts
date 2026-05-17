import { createContext, useContext } from 'react';
import type { ThemeMode } from '@/hooks/useTheme';

export interface ThemeControllerValue {
  mode: ThemeMode;
  themeColor: string;
  isDark: boolean;
  setThemeMode: (mode: ThemeMode) => void;
  setThemeColor: (color: string) => void;
  cycleTheme: () => void;
  resetTheme: () => void;
}

export const ThemeControllerContext = createContext<ThemeControllerValue | null>(null);

export function useThemeController(): ThemeControllerValue {
  const context = useContext(ThemeControllerContext);
  if (!context) {
    throw new Error('useThemeController must be used within ThemeProvider');
  }
  return context;
}
