import { useContext, createContext } from 'react';
import type { PreferenceOverrides, PreferencePath, PreferencePolicy, UserPreferences } from '@zenith/shared/preferences';
export {
  defaultPreferences, LOADING_STYLES, LOADING_STYLE_OPTIONS, isLoadingStyle,
  UI_SCALES, UI_SCALE_OPTIONS, FONT_FAMILIES, FONT_FAMILY_OPTIONS, TIME_DISPLAYS, WEEK_STARTS,
  DARK_SURFACE_TONES, DARK_SURFACE_TONE_OPTIONS,
} from '@zenith/shared/preferences';
export type {
  NavLayout, TabAnimation, TabStyle, TabSize, TabType, TableSizePreference, RouteAnimation,
  SidebarToggleIconPosition, BorderRadiusPreference, LoadingStyle, UiScale, FontFamilyPreference,
  TimeDisplay, DesktopNotificationContent, WeekStart, DarkSurfaceTone,
  TerminalFavorite, TerminalTabPosition, TerminalPreferences, UserPreferences,
} from '@zenith/shared/preferences';
export { sanitizePreferenceOverrides as sanitizeImportedPreferences } from '@zenith/shared/preferences';

export interface PreferenceChangeResult {
  applied: number;
  skipped: number;
}

export interface PreferencesContextValue {
  preferences: UserPreferences;
  overrides: PreferenceOverrides;
  policy: PreferencePolicy;
  setPreferences: (partial: PreferenceOverrides) => PreferenceChangeResult;
  resetPreferences: () => void;
  resetPreference: (path: PreferencePath | readonly PreferencePath[]) => void;
  canEditPreference: (path: PreferencePath) => boolean;
  canOverridePreference: (path: PreferencePath) => boolean;
  isPreferenceOverridden: (path: PreferencePath) => boolean;
  hasEditablePreferences: boolean;
  hasManagedPreferences: boolean;
  /** 策略与个人偏好已完成首轮读取，之后再做默认首页等一次性决策。 */
  ready: boolean;
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

/**
 * 路由切换动画的生效值（供 AdminLayout / KeepAliveOutlet / RouteSuspense 共用）：
 * 减弱动态效果时强制关闭；Provider 之外或旧版本持久化偏好缺省时视为关闭。
 */
export function useRouteAnimation(): UserPreferences['routeAnimation'] {
  const prefs = useOptionalPreferences()?.preferences;
  if (!prefs || prefs.reduceMotion) return 'none';
  return prefs.routeAnimation ?? 'none';
}
