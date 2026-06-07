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
  /** 显示收藏快捷入口（面包屑收藏按鈕 + 顶部 Popover） */
  showFavorites: boolean;
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
  /** 侧边栏悬浮模式：开启后，侧边栏居按展开，鼠标入内时临时滑出，移开则自动收起 */
  sidebarHoverTrigger: boolean;
  /** 面包屑可点击跳转：false 时仅展示文字路径，防止误触导致表单中断 */
  breadcrumbClickable: boolean;
  /** 项目目录节点的子菜单 Popover */
  breadcrumbSubMenu: boolean;
  /** 新开标签页插入行为：append 数尾 / insert-next 现当前标签页后插入 */
  openTabBehavior: 'append' | 'insert-next';
  /** 菜单选中时自动滚动到可视区 */
  scrollMenuIntoView: boolean;
  /** 双击页签行为：refresh 刷新 / close 关闭 / none 无 */
  tabDoubleClickAction: 'refresh' | 'close' | 'none';
  /** 路由切换动画 */
  routeAnimation: RouteAnimation;
  /** 最大标签页超限后的关闭策略: fifo 最早打开，lru 最近最少使用 */
  tabEvictPolicy: 'fifo' | 'lru';
  /** 灰色模式（国家公祭日等场景） */
  grayscale: boolean;
  /** 色弱模式（反转色/高对比） */
  colorBlind: boolean;
  /** 内容区域宽度模式：fluid 流式充满（默认）/ fixed 固定最大宽度居中 */
  contentWidth: 'fluid' | 'fixed';
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
  showFavorites: false,
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
  sidebarHoverTrigger: false,
  breadcrumbClickable: true,
  breadcrumbSubMenu: false,
  openTabBehavior: 'append',
  scrollMenuIntoView: true,
  tabDoubleClickAction: 'refresh',
  tabEvictPolicy: 'fifo',
  routeAnimation: 'fade',
  grayscale: false,
  colorBlind: false,
  contentWidth: 'fluid',
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
