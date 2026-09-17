import * as C from './constants';
import { defaultPreferences } from './validation';
import type { PreferenceCondition, PreferenceDefinition, PreferencePath } from './types';

const tabs: PreferenceCondition = { field: 'enableTabs', equals: true };
const breadcrumb: PreferenceCondition = { field: 'showBreadcrumb', equals: true };
const sidebar: PreferenceCondition = { field: 'navLayout', in: ['vertical', 'mixed', 'double'] };
const motion: PreferenceCondition = { field: 'reduceMotion', equals: false };
const dark: PreferenceCondition = { field: 'colorMode', in: ['dark', 'system'] };
const light: PreferenceCondition = { field: 'colorMode', in: ['light', 'system'] };
const options = (values: readonly (string | number)[], labels: readonly string[]) => values.map((value, index) => ({ value, label: labels[index] ?? String(value) }));

type Entry = Omit<PreferenceDefinition, 'path' | 'kind'> & { kind?: PreferenceDefinition['kind'] };
/** 字段目录必须完整覆盖每个可配置叶子；收藏目录属于个人内容，不属于策略。 */
const metadata: Record<PreferencePath, Entry> = {
  navLayout: { label: '导航布局', group: 'layout', options: options(C.NAV_LAYOUTS, ['左侧菜单', '顶部菜单', '混合菜单', '双列菜单']) },
  contentWidth: { label: '内容宽度', group: 'layout', options: options(C.CONTENT_WIDTHS, ['流式充满', '固定宽度居中']) },
  showLogo: { label: '显示 Logo 图标', group: 'layout' },
  tabsSize: { label: '页面标签栏尺寸', group: 'appearance', options: options(C.TAB_SIZES, ['小', '中', '大']), description: '控制页面内部标签栏的尺寸，与多标签页开关无关。' },
  tabsType: { label: '页面标签栏样式', group: 'appearance', options: options(C.TAB_TYPES, ['线条', '按钮', '卡片', '斜线']) },
  colorMode: { label: '颜色模式', group: 'appearance', options: options(C.THEME_MODES, ['浅色', '深色', '跟随系统']) },
  themeColor: { label: '主题颜色', group: 'appearance', kind: 'color', options: C.THEME_COLOR_OPTIONS },
  headerDarkMode: { label: '顶部栏深色模式', group: 'appearance', applicableWhen: light },
  sidebarDarkMode: { label: '侧边栏深色模式', group: 'appearance', applicableWhen: { all: [sidebar, light] } },
  darkSidebarTone: { label: '侧边栏底色', group: 'appearance', options: C.DARK_SURFACE_TONE_OPTIONS, applicableWhen: { all: [sidebar, { any: [dark, { field: 'sidebarDarkMode', equals: true }] }] } },
  darkHeaderTone: { label: '顶部底色', group: 'appearance', options: C.DARK_SURFACE_TONE_OPTIONS, applicableWhen: { any: [dark, { field: 'headerDarkMode', equals: true }] } },
  darkContentTone: { label: '主区域底色', group: 'appearance', options: C.DARK_SURFACE_TONE_OPTIONS, applicableWhen: dark },
  borderRadius: { label: '圆角大小', group: 'appearance', options: options(C.BORDER_RADII, ['直角', '小', '默认', '大']) },
  uiScale: { label: '界面缩放', group: 'appearance', options: C.UI_SCALE_OPTIONS },
  fontFamily: { label: '界面字体', group: 'appearance', options: C.FONT_FAMILY_OPTIONS },
  loadingStyle: { label: '加载动画', group: 'appearance', options: C.LOADING_STYLE_OPTIONS, description: '加载指示不受减弱动效影响。' },
  grayscale: { label: '灰色模式', group: 'appearance', description: '与色弱模式互斥；强制开启时优先于个人选择。' },
  colorBlind: { label: '色弱模式', group: 'appearance', description: '与灰色模式互斥；强制开启时优先于个人选择。' },
  reduceMotion: { label: '减弱动效', group: 'appearance', description: '关闭路由、标签页和主题切换装饰动效，加载指示继续显示。' },
  dynamicTitle: { label: '动态浏览器标题', group: 'navigation' },
  showBreadcrumb: { label: '显示面包屑', group: 'navigation' },
  breadcrumbIcon: { label: '面包屑显示图标', group: 'navigation', applicableWhen: breadcrumb },
  breadcrumbShowHome: { label: '面包屑显示首页', group: 'navigation', applicableWhen: breadcrumb },
  breadcrumbClickable: { label: '面包屑可点击跳转', group: 'navigation', applicableWhen: breadcrumb },
  breadcrumbSubMenu: { label: '面包屑子菜单', group: 'navigation', applicableWhen: breadcrumb },
  showMenuSearch: { label: '显示菜单搜索', group: 'navigation' },
  showFavorites: { label: '显示收藏入口', group: 'navigation' },
  showFullscreen: { label: '显示全屏按钮', group: 'navigation' },
  showBackTop: { label: '显示回到顶部', group: 'navigation' },
  showQuickChat: { label: '显示快捷聊天', group: 'navigation', description: '还需开启系统“快捷聊天按钮”功能。' },
  sidebarWidth: { label: '侧边栏宽度', group: 'sidebar', min: 160, max: 320, step: 1, unit: 'px', applicableWhen: sidebar },
  sidebarToggleIconPosition: { label: '子菜单箭头位置', group: 'sidebar', options: options(C.SIDEBAR_TOGGLE_ICON_POSITIONS, ['左侧', '右侧']), applicableWhen: sidebar },
  sidebarStickyScroll: { label: '固定侧边栏分组标题', group: 'sidebar', applicableWhen: sidebar },
  sidebarAccordion: { label: '侧边栏手风琴展开', group: 'sidebar', applicableWhen: sidebar },
  sidebarHoverTrigger: { label: '侧边栏悬浮展开', group: 'sidebar', applicableWhen: sidebar },
  scrollMenuIntoView: { label: '自动定位当前菜单', group: 'sidebar', applicableWhen: sidebar },
  homePath: { label: '默认首页', group: 'general', kind: 'home-path', description: '登录后进入的页面；没有该页面权限时回退到可访问页面。' },
  timeDisplay: { label: '时间显示方式', group: 'general', options: options(C.TIME_DISPLAYS, ['绝对时间', '相对时间']) },
  weekStart: { label: '一周起始日', group: 'general', options: options(C.WEEK_STARTS, ['周一', '周日']) },
  refetchOnFocus: { label: '切回窗口自动刷新', group: 'general', description: '仅控制业务数据；系统策略更新始终同步。' },
  showProgressBar: { label: '页面加载进度条', group: 'general' },
  enableShortcuts: { label: '启用全局快捷键', group: 'general' },
  syncPageStateToUrl: { label: '页面状态同步到地址栏', group: 'general' },
  confirmLogout: { label: '退出登录前确认', group: 'general' },
  modalClickMaskToClose: { label: '点击遮罩关闭弹窗', group: 'general' },
  filesViewMode: { label: '文件列表默认视图', group: 'general', options: options(C.FILES_VIEW_MODES, ['列表', '网格']) },
  enableLockScreen: { label: '开启屏幕锁', group: 'general', description: '需用户在当前设备设置锁屏密码后才能使用。' },
  autoLockMinutes: { label: '无操作自动锁屏', group: 'general', options: options(C.AUTO_LOCK_MINUTES, ['关闭', '5 分钟', '10 分钟', '30 分钟']), applicableWhen: { field: 'enableLockScreen', equals: true } },
  tableBordered: { label: '显示表格边框', group: 'table' },
  tableStriped: { label: '启用表格斑马纹', group: 'table' },
  tableSize: { label: '表格尺寸', group: 'table', options: options(C.TABLE_SIZES, ['紧凑', '宽松', '适中']) },
  tablePageSize: { label: '默认分页大小', group: 'table', options: C.TABLE_PAGE_SIZES.map((value) => ({ value, label: `${value} 条` })), description: '用户查看单张表格时仍可临时调整分页大小。' },
  showTableColumnSettings: { label: '显示表格列设置按钮', group: 'table' },
  rememberListFilters: { label: '记住列表筛选条件', group: 'table' },
  enableTabs: { label: '启用多标签页', group: 'tabs' },
  keepTabs: { label: '保存标签页', group: 'tabs', applicableWhen: tabs },
  enablePageCache: { label: '启用页面缓存', group: 'tabs', applicableWhen: tabs },
  showTabIcon: { label: '标签页显示图标', group: 'tabs', applicableWhen: tabs },
  compactTabs: { label: '紧凑标签页', group: 'tabs', applicableWhen: tabs },
  showTabSwitcher: { label: '显示标签切换器', group: 'tabs', applicableWhen: tabs },
  tabsMaxCount: { label: '最大标签数', group: 'tabs', min: 5, max: 50, step: 1, applicableWhen: tabs },
  tabEvictPolicy: { label: '标签超限关闭策略', group: 'tabs', options: options(C.TAB_EVICT_POLICIES, ['最早打开（FIFO）', '最久未使用（LRU）']), applicableWhen: tabs },
  openTabBehavior: { label: '新标签插入位置', group: 'tabs', options: options(C.OPEN_TAB_BEHAVIORS, ['末尾', '当前标签后方']), applicableWhen: tabs },
  tabDoubleClickAction: { label: '双击标签行为', group: 'tabs', options: options(C.TAB_DOUBLE_CLICK_ACTIONS, ['刷新', '关闭', '无']), applicableWhen: tabs },
  tabStyle: { label: '标签页风格', group: 'tabs', options: options(C.TAB_STYLES, ['线条', '胶囊', '卡片', '谷歌']), applicableWhen: tabs },
  tabAnimation: { label: '标签页动画', group: 'tabs', options: options(C.TAB_ANIMATIONS, ['无', '淡入', '滑入', '缩放']), applicableWhen: { all: [tabs, motion] } },
  routeAnimation: { label: '路由切换动画', group: 'tabs', options: options(C.ROUTE_ANIMATIONS, ['无', '淡入', '上滑', '左滑']), applicableWhen: motion },
  notificationSound: { label: '通知提示音', group: 'notifications', description: '浏览器首次播放前需要用户交互。' },
  notificationSoundStyle: { label: '通知提示音音色', group: 'notifications', options: C.NOTIFICATION_SOUND_STYLE_OPTIONS, applicableWhen: { field: 'notificationSound', equals: true } },
  desktopNotification: { label: '桌面通知', group: 'notifications', description: '需要用户授予当前浏览器通知权限。' },
  desktopNotificationContent: { label: '桌面通知内容', group: 'notifications', options: options(C.DESKTOP_NOTIFICATION_CONTENTS, ['消息摘要', '仅通知类型']), applicableWhen: { field: 'desktopNotification', equals: true } },
  'terminal.defaultShell': { label: '默认 Shell', group: 'terminal', description: '留空使用服务器探测的默认 Shell；具体可用项取决于服务器。' },
  'terminal.themeDark': { label: '暗色终端主题', group: 'terminal', kind: 'terminal-theme', options: C.TERMINAL_DARK_THEMES },
  'terminal.themeLight': { label: '亮色终端主题', group: 'terminal', kind: 'terminal-theme', options: C.TERMINAL_LIGHT_THEMES },
  'terminal.fontFamily': { label: '终端字体', group: 'terminal', description: '使用当前设备已安装的等宽字体，可填写 CSS 字体栈。' },
  'terminal.fontSize': { label: '终端字号', group: 'terminal', min: 10, max: 28, step: 1, unit: 'px' },
  'terminal.lineHeight': { label: '终端行高', group: 'terminal', min: 1, max: 2, step: 0.1 },
  'terminal.scrollback': { label: '终端滚回行数', group: 'terminal', min: 100, max: 100000, step: 1000, unit: '行' },
  'terminal.tabPosition': { label: '终端标签栏位置', group: 'terminal', options: options(C.TERMINAL_TAB_POSITIONS, ['顶部', '左侧', '右侧', '底部']) },
  'terminal.tabCollapsed': { label: '终端侧边标签栏折叠', group: 'terminal', applicableWhen: { field: 'terminal.tabPosition', in: ['left', 'right'] } },
  'terminal.cursorStyle': { label: '终端光标样式', group: 'terminal', options: options(C.TERMINAL_CURSOR_STYLES, ['块状', '下划线', '竖线']) },
  'terminal.cursorBlink': { label: '终端光标闪烁', group: 'terminal' },
  'terminal.copyOnSelect': { label: '选中文字自动复制', group: 'terminal' },
  'terminal.rendererType': { label: '终端渲染模式', group: 'terminal', options: options(C.TERMINAL_RENDERER_TYPES, ['Canvas', 'WebGL']), description: '重新打开终端生效；WebGL 需要浏览器 GPU 支持。' },
  'terminal.fastScrollSensitivity': { label: '终端快速滚动倍率', group: 'terminal', min: 1, max: 20, step: 1, unit: '倍' },
  'terminal.letterSpacing': { label: '终端字母间距', group: 'terminal', min: 0, max: 8, step: 0.5, unit: 'px' },
  'terminal.fontWeight': { label: '终端字体粗细', group: 'terminal', options: options(C.TERMINAL_FONT_WEIGHTS, ['正常', '粗体', '半粗（600）', '细体（300）']) },
  'terminal.rightClickSelectsWord': { label: '终端右键选词', group: 'terminal' },
  'terminal.minimumContrastRatio': { label: '终端最小对比度', group: 'terminal', min: 1, max: 21, step: 1, description: '1 表示不限制；4.5 对应 WCAG AA 对比度。' },
  'terminal.showStatusBar': { label: '显示终端状态栏', group: 'terminal' },
};

export const preferenceDefinitions: readonly PreferenceDefinition[] = (Object.entries(metadata) as [PreferencePath, Entry][]).map(([path, entry]) => {
  const value = path.startsWith('terminal.')
    ? defaultPreferences.terminal[path.slice(9) as keyof typeof defaultPreferences.terminal]
    : defaultPreferences[path as Exclude<keyof typeof defaultPreferences, 'terminal'>];
  return { ...entry, path, kind: entry.kind ?? (entry.options ? 'select' : typeof value === 'boolean' ? 'boolean' : typeof value === 'number' ? 'number' : 'text') };
});
export const preferenceDefinitionMap = Object.fromEntries(preferenceDefinitions.map((definition) => [definition.path, definition])) as Record<PreferencePath, PreferenceDefinition>;
export const preferencePaths = preferenceDefinitions.map((definition) => definition.path);
