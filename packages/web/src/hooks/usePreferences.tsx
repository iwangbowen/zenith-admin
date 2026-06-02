import { useContext, createContext } from 'react';
import type { ThemeMode } from '@/hooks/useTheme';

export type NavLayout = 'vertical' | 'horizontal' | 'mixed' | 'double';
export type TabAnimation = 'none' | 'fade' | 'slide' | 'scale';
export type TabStyle = 'line' | 'pill' | 'card';
export type TableSizePreference = 'small' | 'default' | 'middle';

export interface UserPreferences {
  enableTabs: boolean;
  keepTabs: boolean;
  tabsMaxCount: number;
  showTabIcon: boolean;
  tabStyle: TabStyle;
  navLayout: NavLayout;
  showBreadcrumb: boolean;
  /** 面包屑是否显示图标 */
  breadcrumbIcon: boolean;
  tabAnimation: TabAnimation;
  colorMode: ThemeMode;
  themeColor: string;
  sidebarDarkMode: boolean;
  headerDarkMode: boolean;
  showMenuSearch: boolean;
  showFullscreen: boolean;
  showQuickChat: boolean;
  showLogo: boolean;
  dynamicTitle: boolean;
  filesViewMode: 'list' | 'grid';
  sidebarStickyScroll: boolean;
  showTableColumnSettings: boolean;
  tableBordered: boolean;
  tableStriped: boolean;
  tableSize: TableSizePreference;
}

export const defaultPreferences: UserPreferences = {
  enableTabs: true,
  keepTabs: true,
  tabsMaxCount: 20,
  showTabIcon: true,
  tabStyle: 'line',
  navLayout: 'vertical',
  showBreadcrumb: false,
  breadcrumbIcon: true,
  tabAnimation: 'fade',
  colorMode: 'light',
  themeColor: 'blue',
  sidebarDarkMode: false,
  headerDarkMode: false,
  showMenuSearch: true,
  showFullscreen: true,
  showQuickChat: true,
  showLogo: true,
  dynamicTitle: true,
  filesViewMode: 'list',
  sidebarStickyScroll: true,
  showTableColumnSettings: true,
  tableBordered: true,
  tableStriped: false,
  tableSize: 'small',
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
