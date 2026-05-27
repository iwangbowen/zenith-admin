import { useContext, createContext } from 'react';
import type { ThemeMode } from '@/hooks/useTheme';

export type NavLayout = 'vertical' | 'horizontal' | 'mixed';
export type TabAnimation = 'none' | 'fade' | 'slide' | 'scale';

export interface UserPreferences {
  enableTabs: boolean;
  keepTabs: boolean;
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
  keepTabs: true,
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

export interface PreferencesContextValue {
  preferences: UserPreferences;
  setPreferences: (partial: Partial<UserPreferences>) => void;
  resetPreferences: () => void;
}

export const PreferencesContext = createContext<PreferencesContextValue | null>(null);

export function useOptionalPreferences() {
  return useContext(PreferencesContext);
}

export function usePreferences() {
  const ctx = useContext(PreferencesContext);
  if (!ctx) {
    throw new Error('usePreferences must be used within PreferencesProvider');
  }
  return ctx;
}
