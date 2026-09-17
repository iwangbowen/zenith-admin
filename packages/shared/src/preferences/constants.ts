/** 偏好枚举的唯一来源；浏览器控件与接口校验共同使用。 */
export const NAV_LAYOUTS = ['vertical', 'horizontal', 'mixed', 'double'] as const;
export type NavLayout = (typeof NAV_LAYOUTS)[number];
export const TAB_ANIMATIONS = ['none', 'fade', 'slide', 'scale'] as const;
export type TabAnimation = (typeof TAB_ANIMATIONS)[number];
export const TAB_STYLES = ['line', 'pill', 'card', 'chrome'] as const;
export type TabStyle = (typeof TAB_STYLES)[number];
export const TAB_SIZES = ['small', 'medium', 'large'] as const;
export type TabSize = (typeof TAB_SIZES)[number];
export const TAB_TYPES = ['line', 'button', 'card', 'slash'] as const;
export type TabType = (typeof TAB_TYPES)[number];
export const TABLE_SIZES = ['small', 'default', 'middle'] as const;
export type TableSizePreference = (typeof TABLE_SIZES)[number];
export const ROUTE_ANIMATIONS = ['none', 'fade', 'slide-up', 'slide-left'] as const;
export type RouteAnimation = (typeof ROUTE_ANIMATIONS)[number];
export const SIDEBAR_TOGGLE_ICON_POSITIONS = ['left', 'right'] as const;
export type SidebarToggleIconPosition = (typeof SIDEBAR_TOGGLE_ICON_POSITIONS)[number];
export const BORDER_RADII = ['none', 'small', 'medium', 'large'] as const;
export type BorderRadiusPreference = (typeof BORDER_RADII)[number];
export const THEME_MODES = ['light', 'dark', 'system'] as const;
export type ThemeMode = (typeof THEME_MODES)[number];
export const TOPBAR_CLOCK_MODES = ['off', '12h', '24h'] as const;
export type TopbarClockMode = (typeof TOPBAR_CLOCK_MODES)[number];
export const TOPBAR_CLOCK_MODE_OPTIONS = [
  { value: 'off', label: '关闭', isDefault: true },
  { value: '12h', label: '12小时制', isDefault: false },
  { value: '24h', label: '24小时制', isDefault: false },
] as const;
export const SCHEDULED_DARK_MODES = ['off', 'custom'] as const;
export type ScheduledDarkMode = (typeof SCHEDULED_DARK_MODES)[number];
export const SCHEDULED_DARK_MODE_OPTIONS = [
  { value: 'off', label: '关闭', isDefault: true },
  { value: 'custom', label: '自定义时段', isDefault: false },
] as const;
/**
 * HH:mm 24 小时制时刻（定时深色起止用）；起止相同视为空窗口，不触发深色。
 * 个人面板输入框与服务端导入校验共用，非法值会被偏好清洗丢弃。
 */
export const SCHEDULE_TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;
export function isScheduleTime(value: unknown): value is string {
  return typeof value === 'string' && SCHEDULE_TIME_PATTERN.test(value);
}
export function scheduleTimeToMinutes(value: string): number {
  const [hours, minutes] = value.split(':').map(Number);
  return hours * 60 + minutes;
}
export const LOADING_STYLES = ['flip', 'dots', 'ring', 'bars', 'spinner', 'bounce', 'ripple', 'progress'] as const;
export type LoadingStyle = (typeof LOADING_STYLES)[number];
export const LOADING_STYLE_OPTIONS = [
  { value: 'flip', label: '翻转方块', isDefault: true },
  { value: 'dots', label: '跳动圆点', isDefault: false },
  { value: 'ring', label: '旋转圆环', isDefault: false },
  { value: 'bars', label: '律动条', isDefault: false },
  { value: 'spinner', label: '菊花转', isDefault: false },
  { value: 'bounce', label: '双弹跳', isDefault: false },
  { value: 'ripple', label: '水波纹', isDefault: false },
  { value: 'progress', label: '进度条', isDefault: false },
] as const;
export function isLoadingStyle(value: unknown): value is LoadingStyle {
  return typeof value === 'string' && LOADING_STYLES.includes(value as LoadingStyle);
}
export const UI_SCALES = [90, 100, 110, 120] as const;
export type UiScale = (typeof UI_SCALES)[number];
export const UI_SCALE_OPTIONS = UI_SCALES.map((value) => ({ value, label: `${value}%` }));
export const FONT_FAMILIES = ['system', 'inter', 'noto-sans-sc', 'mono'] as const;
export type FontFamilyPreference = (typeof FONT_FAMILIES)[number];
export const FONT_FAMILY_OPTIONS = [
  { value: 'system', label: '系统默认' },
  { value: 'inter', label: 'Inter' },
  { value: 'noto-sans-sc', label: '思源黑体' },
  { value: 'mono', label: '等宽字体' },
] as const;
export const TIME_DISPLAYS = ['absolute', 'relative'] as const;
export type TimeDisplay = (typeof TIME_DISPLAYS)[number];
export const WEEK_STARTS = ['monday', 'sunday'] as const;
export type WeekStart = (typeof WEEK_STARTS)[number];
export const DARK_SURFACE_TONES = ['bg-1', 'bg-0'] as const;
export type DarkSurfaceTone = (typeof DARK_SURFACE_TONES)[number];
export const DARK_SURFACE_TONE_OPTIONS = [
  { value: 'bg-1', label: '标准' },
  { value: 'bg-0', label: '更深' },
] as const;
export const DESKTOP_NOTIFICATION_CONTENTS = ['summary', 'type'] as const;
export type DesktopNotificationContent = (typeof DESKTOP_NOTIFICATION_CONTENTS)[number];
export const NOTIFICATION_SOUND_STYLES = ['chime', 'ding', 'pop'] as const;
export type NotificationSoundStyle = (typeof NOTIFICATION_SOUND_STYLES)[number];
export const NOTIFICATION_SOUND_STYLE_LABELS: Record<NotificationSoundStyle, string> = {
  chime: '清脆双音', ding: '单音提示', pop: '轻柔气泡',
};
export const NOTIFICATION_SOUND_STYLE_OPTIONS = NOTIFICATION_SOUND_STYLES.map((value) => ({ value, label: NOTIFICATION_SOUND_STYLE_LABELS[value] }));
export const DEFAULT_NOTIFICATION_SOUND_STYLE: NotificationSoundStyle = 'chime';
export const DEFAULT_THEME_COLOR = 'blue';
export const FILES_VIEW_MODES = ['list', 'grid'] as const;
export const CONTENT_WIDTHS = ['fluid', 'fixed'] as const;
export const OPEN_TAB_BEHAVIORS = ['append', 'insert-next'] as const;
export const TAB_DOUBLE_CLICK_ACTIONS = ['refresh', 'close', 'none'] as const;
export const TAB_EVICT_POLICIES = ['fifo', 'lru'] as const;
export const TABLE_PAGE_SIZES = [10, 20, 50, 100] as const;
export const AUTO_LOCK_MINUTES = [0, 5, 10, 30] as const;
export const TERMINAL_TAB_POSITIONS = ['top', 'left', 'right', 'bottom'] as const;
export type TerminalTabPosition = (typeof TERMINAL_TAB_POSITIONS)[number];
export const TERMINAL_CURSOR_STYLES = ['block', 'underline', 'bar'] as const;
export const TERMINAL_RENDERER_TYPES = ['canvas', 'webgl'] as const;
export const TERMINAL_FONT_WEIGHTS = ['normal', 'bold', '600', '300'] as const;

export const preferenceGroups = [
  { id: 'layout', label: '布局' },
  { id: 'appearance', label: '外观' },
  { id: 'navigation', label: '导航与工具栏' },
  { id: 'sidebar', label: '侧边栏' },
  { id: 'general', label: '通用' },
  { id: 'table', label: '表格' },
  { id: 'tabs', label: '标签页' },
  { id: 'notifications', label: '通知' },
  { id: 'terminal', label: '终端' },
] as const;
export type PreferenceGroup = (typeof preferenceGroups)[number]['id'];

export const TERMINAL_DARK_THEMES = [
  { value: 'catppuccin-mocha', label: 'Catppuccin Mocha' },
  { value: 'vscode-dark', label: 'VS Code Dark' },
  { value: 'dracula', label: 'Dracula' },
  { value: 'one-dark', label: 'One Dark' },
  { value: 'solarized-dark', label: 'Solarized Dark' },
  { value: 'github-dark', label: 'GitHub Dark' },
  { value: 'nord', label: 'Nord' },
  { value: 'monokai', label: 'Monokai' },
  { value: 'tokyo-night', label: 'Tokyo Night' },
  { value: 'gruvbox-dark', label: 'Gruvbox Dark' },
  { value: 'night-owl', label: 'Night Owl' },
  { value: 'ayu-dark', label: 'Ayu Dark' },
  { value: 'palenight', label: 'Palenight' },
  { value: 'everforest-dark', label: 'Everforest Dark' },
  { value: 'cobalt2', label: 'Cobalt2' },
  { value: 'rose-pine', label: 'Rosé Pine' },
  { value: 'rose-pine-moon', label: 'Rosé Pine Moon' },
  { value: 'kanagawa', label: 'Kanagawa Wave' },
  { value: 'synthwave-84', label: "Synthwave '84" },
  { value: 'catppuccin-macchiato', label: 'Catppuccin Macchiato' },
  { value: 'catppuccin-frappe', label: 'Catppuccin Frappé' },
  { value: 'tokyo-night-storm', label: 'Tokyo Night Storm' },
  { value: 'material-dark', label: 'Material Dark' },
  { value: 'horizon', label: 'Horizon' },
  { value: 'panda', label: 'Panda' },
  { value: 'oxocarbon', label: 'Oxocarbon' },
  { value: 'monokai-pro', label: 'Monokai Pro' },
  { value: 'shades-of-purple', label: 'Shades of Purple' },
  { value: 'flexoki-dark', label: 'Flexoki Dark' },
  { value: 'zenburn', label: 'Zenburn' },
] as const;
export const TERMINAL_DARK_THEMES_IDS = TERMINAL_DARK_THEMES.map((item) => item.value);

export const TERMINAL_LIGHT_THEMES = [
  { value: 'vscode-light', label: 'VS Code Light' },
  { value: 'catppuccin-latte', label: 'Catppuccin Latte' },
  { value: 'one-light', label: 'One Light' },
  { value: 'solarized-light', label: 'Solarized Light' },
  { value: 'github-light', label: 'GitHub Light' },
  { value: 'gruvbox-light', label: 'Gruvbox Light' },
  { value: 'ayu-light', label: 'Ayu Light' },
  { value: 'everforest-light', label: 'Everforest Light' },
  { value: 'rose-pine-dawn', label: 'Rosé Pine Dawn' },
  { value: 'kanagawa-lotus', label: 'Kanagawa Lotus' },
  { value: 'tokyo-day', label: 'Tokyo Day' },
  { value: 'material-light', label: 'Material Light' },
  { value: 'flexoki-light', label: 'Flexoki Light' },
  { value: 'pencil-light', label: 'Pencil Light' },
] as const;
export const TERMINAL_LIGHT_THEMES_IDS = TERMINAL_LIGHT_THEMES.map((item) => item.value);

export const THEME_COLOR_OPTIONS = [
  { value: 'blue', label: '飞书蓝' },
  { value: 'wechat', label: '微信绿' },
  { value: 'navy', label: '藏青' },
  { value: 'indigo', label: '靛紫' },
  { value: 'violet', label: '薰衣草紫' },
  { value: 'purple', label: '葡萄紫' },
  { value: 'cyan', label: '湖蓝' },
  { value: 'peacock', label: '孔雀青' },
  { value: 'green', label: '碧绿' },
  { value: 'forest', label: '松柏绿' },
  { value: 'orange', label: '橙珀' },
  { value: 'rose', label: '玫瑰红' },
  { value: 'wine', label: '酒红' },
  { value: 'fuchsia', label: '品红' },
  { value: 'teal', label: '青碧' },
  { value: 'slate', label: '钢灰' },
  { value: 'red', label: '朱砂红' },
  { value: 'pink', label: '少女粉' },
  { value: 'amber', label: '琥珀金' },
  { value: 'gold', label: '鎏金' },
  { value: 'sky', label: '天空蓝' },
  { value: 'coral', label: '珊瑚橙' },
  { value: 'lime', label: '金橄榄' },
  { value: 'brown', label: '深棕' },
  { value: 'charcoal', label: '墨黑' },
  { value: 'klein', label: '克莱因蓝' },
  { value: 'tiffany', label: '蒂芙尼青' },
  { value: 'jade', label: '翡翠绿' },
  { value: 'mars', label: '马尔斯青' },
  { value: 'bamboo', label: '竹青' },
  { value: 'wisteria', label: '藤萝紫' },
  { value: 'sakura', label: '樱绯' },
  { value: 'ink', label: '黛蓝' },
  { value: 'copper', label: '古铜' },
  { value: 'plum', label: '梅紫' },
] as const;
export const THEME_COLOR_KEYS = THEME_COLOR_OPTIONS.map((item) => item.value);
