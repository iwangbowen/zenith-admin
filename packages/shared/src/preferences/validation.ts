import * as z from 'zod';
import { partialForUpdate } from '../core/validation';
import * as C from './constants';

export const terminalFavoriteSchema = z.strictObject({ path: z.string().min(1).max(4096), name: z.string().min(1).max(200) });
export type TerminalFavorite = z.output<typeof terminalFavoriteSchema>;

export const terminalPreferencesSchema = z.strictObject({
  defaultShell: z.string().max(128).default(''),
  themeDark: z.enum(C.TERMINAL_DARK_THEMES_IDS).default('catppuccin-mocha'),
  themeLight: z.enum(C.TERMINAL_LIGHT_THEMES_IDS).default('vscode-light'),
  fontSize: z.int().min(10).max(28).default(14),
  fontFamily: z.string().min(1).max(512).default('"Cascadia Code", "JetBrains Mono", Menlo, Monaco, "Courier New", monospace'),
  lineHeight: z.number().min(1).max(2).default(1.2),
  scrollback: z.int().min(100).max(100000).default(5000),
  favorites: z.array(terminalFavoriteSchema).max(200).default([]),
  tabPosition: z.enum(C.TERMINAL_TAB_POSITIONS).default('top'),
  tabCollapsed: z.boolean().default(false),
  cursorStyle: z.enum(C.TERMINAL_CURSOR_STYLES).default('block'),
  cursorBlink: z.boolean().default(true),
  copyOnSelect: z.boolean().default(true),
  rendererType: z.enum(C.TERMINAL_RENDERER_TYPES).default('canvas'),
  fastScrollSensitivity: z.int().min(1).max(20).default(5),
  letterSpacing: z.number().min(0).max(8).default(0),
  fontWeight: z.enum(C.TERMINAL_FONT_WEIGHTS).default('normal'),
  rightClickSelectsWord: z.boolean().default(false),
  minimumContrastRatio: z.number().min(1).max(21).default(1),
  showStatusBar: z.boolean().default(true),
});
export type TerminalPreferences = z.output<typeof terminalPreferencesSchema>;

/** 内置默认值只在本 schema 声明。 */
export const preferenceValuesSchema = z.strictObject({
  enableTabs: z.boolean().default(true),
  keepTabs: z.boolean().default(true),
  enablePageCache: z.boolean().default(true),
  tabsMaxCount: z.int().min(5).max(50).default(20),
  showTabIcon: z.boolean().default(true),
  compactTabs: z.boolean().default(true),
  tabsSize: z.enum(C.TAB_SIZES).default('small'),
  tabsType: z.enum(C.TAB_TYPES).default('line'),
  tabStyle: z.enum(C.TAB_STYLES).default('line'),
  navLayout: z.enum(C.NAV_LAYOUTS).default('vertical'),
  showBreadcrumb: z.boolean().default(false),
  breadcrumbIcon: z.boolean().default(true),
  breadcrumbShowHome: z.boolean().default(true),
  tabAnimation: z.enum(C.TAB_ANIMATIONS).default('fade'),
  colorMode: z.enum(C.THEME_MODES).default('light'),
  themeColor: z.string().refine((value) => C.THEME_COLOR_KEYS.includes(value as (typeof C.THEME_COLOR_KEYS)[number]) || /^#[\da-f]{6}$/i.test(value), '请选择主题色或输入六位十六进制颜色').default(C.DEFAULT_THEME_COLOR),
  sidebarDarkMode: z.boolean().default(false),
  headerDarkMode: z.boolean().default(false),
  darkSidebarTone: z.enum(C.DARK_SURFACE_TONES).default('bg-1'),
  darkHeaderTone: z.enum(C.DARK_SURFACE_TONES).default('bg-1'),
  darkContentTone: z.enum(C.DARK_SURFACE_TONES).default('bg-1'),
  showMenuSearch: z.boolean().default(true),
  showFullscreen: z.boolean().default(true),
  showQuickChat: z.boolean().default(true),
  showLogo: z.boolean().default(true),
  showFavorites: z.boolean().default(false),
  dynamicTitle: z.boolean().default(true),
  filesViewMode: z.enum(C.FILES_VIEW_MODES).default('list'),
  sidebarStickyScroll: z.boolean().default(true),
  showTableColumnSettings: z.boolean().default(true),
  tableBordered: z.boolean().default(true),
  tableStriped: z.boolean().default(false),
  tableSize: z.enum(C.TABLE_SIZES).default('small'),
  tablePageSize: z.union(C.TABLE_PAGE_SIZES.map((value) => z.literal(value))).default(10),
  enableLockScreen: z.boolean().default(false),
  sidebarAccordion: z.boolean().default(true),
  sidebarHoverTrigger: z.boolean().default(false),
  sidebarToggleIconPosition: z.enum(C.SIDEBAR_TOGGLE_ICON_POSITIONS).default('right'),
  breadcrumbClickable: z.boolean().default(true),
  breadcrumbSubMenu: z.boolean().default(false),
  openTabBehavior: z.enum(C.OPEN_TAB_BEHAVIORS).default('append'),
  scrollMenuIntoView: z.boolean().default(true),
  tabDoubleClickAction: z.enum(C.TAB_DOUBLE_CLICK_ACTIONS).default('refresh'),
  tabEvictPolicy: z.enum(C.TAB_EVICT_POLICIES).default('fifo'),
  routeAnimation: z.enum(C.ROUTE_ANIMATIONS).default('fade'),
  grayscale: z.boolean().default(false),
  colorBlind: z.boolean().default(false),
  contentWidth: z.enum(C.CONTENT_WIDTHS).default('fluid'),
  sidebarWidth: z.int().min(160).max(320).default(216),
  borderRadius: z.enum(C.BORDER_RADII).default('medium'),
  showBackTop: z.boolean().default(true),
  showProgressBar: z.boolean().default(true),
  loadingStyle: z.enum(C.LOADING_STYLES).default('flip'),
  enableShortcuts: z.boolean().default(true),
  syncPageStateToUrl: z.boolean().default(false),
  homePath: z.string().max(512).regex(/^\/(?!\/)[^\s\\]*$/, '请选择站内页面路径').default('/'),
  autoLockMinutes: z.union(C.AUTO_LOCK_MINUTES.map((value) => z.literal(value))).default(0),
  reduceMotion: z.boolean().default(false),
  confirmLogout: z.boolean().default(true),
  modalClickMaskToClose: z.boolean().default(false),
  showTabSwitcher: z.boolean().default(true),
  notificationSound: z.boolean().default(false),
  notificationSoundStyle: z.enum(C.NOTIFICATION_SOUND_STYLES).default(C.DEFAULT_NOTIFICATION_SOUND_STYLE),
  desktopNotification: z.boolean().default(false),
  desktopNotificationContent: z.enum(C.DESKTOP_NOTIFICATION_CONTENTS).default('summary'),
  uiScale: z.union(C.UI_SCALES.map((value) => z.literal(value))).default(100),
  fontFamily: z.enum(C.FONT_FAMILIES).default('system'),
  timeDisplay: z.enum(C.TIME_DISPLAYS).default('absolute'),
  weekStart: z.enum(C.WEEK_STARTS).default('monday'),
  refetchOnFocus: z.boolean().default(false),
  rememberListFilters: z.boolean().default(false),
  terminal: terminalPreferencesSchema.prefault({}),
});
export type UserPreferences = z.output<typeof preferenceValuesSchema>;
export const defaultPreferences: UserPreferences = preferenceValuesSchema.parse({});

/** 未提交的字段始终缺省，不能被默认值补齐。 */
export const preferenceOverridesSchema = partialForUpdate(preferenceValuesSchema.omit({ terminal: true }))
  .extend({ terminal: partialForUpdate(terminalPreferencesSchema).strict().optional() })
  .strict();
export type PreferenceOverrides = z.output<typeof preferenceOverridesSchema>;

export const userPreferencesDocumentSchema = z.strictObject({ overrides: preferenceOverridesSchema.default({}) });
export type UserPreferencesDocument = z.output<typeof userPreferencesDocumentSchema>;

export const preferencePolicyValuesSchema = preferenceValuesSchema.omit({ terminal: true }).extend({
  terminal: terminalPreferencesSchema.omit({ favorites: true }).prefault({}),
}).refine((value) => !(value.grayscale && value.colorBlind), { message: '灰色模式与色弱模式不能同时开启', path: ['colorBlind'] });
export type PreferencePolicyValues = z.output<typeof preferencePolicyValuesSchema>;

function allowedShape<T extends z.ZodRawShape>(shape: T): { [K in keyof T]: z.ZodDefault<z.ZodBoolean> } {
  return Object.fromEntries(Object.keys(shape).map((key) => [key, z.boolean().default(true)])) as { [K in keyof T]: z.ZodDefault<z.ZodBoolean> };
}
export const preferenceOverridePermissionsSchema = z.strictObject({
  ...allowedShape(preferenceValuesSchema.omit({ terminal: true }).shape),
  terminal: z.strictObject(allowedShape(terminalPreferencesSchema.omit({ favorites: true }).shape)).prefault({}),
});
export const preferencePolicySchema = z.strictObject({
  defaults: preferencePolicyValuesSchema.prefault({}),
  allowUserOverride: preferenceOverridePermissionsSchema.prefault({}),
});
export type PreferencePolicy = z.output<typeof preferencePolicySchema>;
export const defaultPreferencePolicy: PreferencePolicy = preferencePolicySchema.parse({});
