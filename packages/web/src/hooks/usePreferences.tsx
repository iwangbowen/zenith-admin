import { useContext, createContext } from 'react';
import type { ThemeMode } from '@/hooks/useTheme';

export type NavLayout = 'vertical' | 'horizontal' | 'mixed' | 'double';
export type TabAnimation = 'none' | 'fade' | 'slide' | 'scale';
export type TabStyle = 'line' | 'pill' | 'card';
export type TableSizePreference = 'small' | 'default' | 'middle';
export type RouteAnimation = 'none' | 'fade' | 'slide-up' | 'slide-left';

/** Web 终端文件夹收藏项 */
export interface TerminalFavorite {
  /** 目录绝对路径 */
  path: string;
  /** 展示名称 */
  name: string;
}

export type TerminalTabPosition = 'top' | 'left' | 'right' | 'bottom';

/** Web 终端个性化配置 */
export interface TerminalPreferences {
  /** 默认 shell id（空字符串表示用服务端探测到的默认值） */
  defaultShell: string;
  /** 暗色模式下使用的主题 id */
  themeDark: string;
  /** 亮色模式下使用的主题 id */
  themeLight: string;
  /** 字号 */
  fontSize: number;
  /** 字体 */
  fontFamily: string;
  /** 行高 */
  lineHeight: number;
  /** 文件夹收藏列表 */
  favorites: TerminalFavorite[];
  /** 标签栏位置（top / right / bottom），默认 top */
  tabPosition: TerminalTabPosition;
  /** 右侧标签栏是否折叠为仅图标模式（仅 tabPosition=right 时生效） */
  tabCollapsed: boolean;
  /** 滚回缓冲区行数（默认 5000） */
  scrollback: number;
  /** 光标样式 */
  cursorStyle: 'block' | 'underline' | 'bar';
  /** 光标是否闪烁 */
  cursorBlink: boolean;
  /** 选中文本时自动复制到剪贴板 */
  copyOnSelect: boolean;
  /** 渲染模式：canvas（默认）或 webgl（性能更好，部分环境不支持） */
  rendererType: 'canvas' | 'webgl';
  /** 按住 Alt 快速滚动时的行数倍率（默认 5） */
  fastScrollSensitivity: number;
  /** 字母间距（px，默认 0） */
  letterSpacing: number;
  /** 字体粗细，如 'normal'、'bold'、'600' */
  fontWeight: string;
  /** 响铃方式：不响铃 / 闪屏 / 声音 */
  bellStyle: 'none' | 'visual' | 'sound';
  /** 右键是否选词（false = 弹出浏览器菜单） */
  rightClickSelectsWord: boolean;
  /** 最小对比度（1–21，1 = 不限制） */
  minimumContrastRatio: number;
}

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
  /** 侧边栏展开宽度（px），默认 216 */
  sidebarWidth: number;
  /** 显示回到顶部按钮（滚动超过 400px 后浮现） */
  showBackTop: boolean;
  /** 标签栏右侧显示标签切换器（chevron 下拉列表） */
  showTabSwitcher: boolean;
  /** Web 终端个性化配置（主题/字体/默认 shell/文件夹收藏） */
  terminal: TerminalPreferences;
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
  sidebarWidth: 216,
  showBackTop: true,
  showTabSwitcher: true,
  terminal: {
    defaultShell: '',
    themeDark: 'catppuccin-mocha',
    themeLight: 'vscode-light',
    fontSize: 14,
    fontFamily: '"Cascadia Code", "JetBrains Mono", Menlo, Monaco, "Courier New", monospace',
    lineHeight: 1.2,
    scrollback: 5000,
    favorites: [],
    tabPosition: 'top' as const,
    tabCollapsed: false,
    cursorStyle: 'block' as const,
    cursorBlink: true,
    copyOnSelect: true,
    rendererType: 'canvas' as const,
    fastScrollSensitivity: 5,
  },
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
