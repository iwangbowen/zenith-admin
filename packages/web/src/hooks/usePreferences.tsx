import { useContext, createContext } from 'react';
import type { ThemeMode } from '@/hooks/useTheme';

export type NavLayout = 'vertical' | 'horizontal' | 'mixed' | 'double';
export type TabAnimation = 'none' | 'fade' | 'slide' | 'scale';
export type TabStyle = 'line' | 'pill' | 'card';
export type TableSizePreference = 'small' | 'default' | 'middle';
export type RouteAnimation = 'none' | 'fade' | 'slide-up' | 'slide-left';

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
  /** 面包屑导航是否从首页开始（显示首页作为第一项） */
  breadcrumbShowHome: boolean;
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
  /** 列表默认分页大小 */
  tablePageSize: number;
  enableLockScreen: boolean;
  /** 侧边栏手风琴展开：同级只允许展开一个子菜单 */
  sidebarAccordion: boolean;
  /** 路由切换动画 */
  routeAnimation: RouteAnimation;
  /** 最大标签页超限后的关闭策略: fifo 最早打开，lru 最近最少使用 */
  tabEvictPolicy: 'fifo' | 'lru';
  /** 灰色模式（国家公祭日等场景） */
  grayscale: boolean;
  /** 色弱模式（反转色/高对比） */
  colorBlind: boolean;
}

export const defaultPreferences: UserPreferences = {
  enableTabs: true,
  keepTabs: true,
  tabsMaxCount: 20,
  showTabIcon: true,
  tabStyle: 'line',
  navLayout: 'vertical',
  showBreadcrumb: true,
  breadcrumbIcon: true,
  breadcrumbShowHome: true,
  tabAnimation: 'fade',
  colorMode: 'light',
  themeColor: 'wechat',
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
  tablePageSize: 10,
  enableLockScreen: false,
  sidebarAccordion: true,
  tabEvictPolicy: 'fifo',
  routeAnimation: 'fade',
  grayscale: false,
  colorBlind: false,
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
