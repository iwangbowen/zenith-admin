import { usePreferences, type TerminalPreferences } from '@/hooks/usePreferences';
import { DEFAULT_DARK_THEME_ID, DEFAULT_LIGHT_THEME_ID, DEFAULT_FONT_FAMILY } from './themes';

/** 终端偏好默认值（与 usePreferences.defaultPreferences.terminal 保持一致） */
export const defaultTerminalPreferences: TerminalPreferences = {
  defaultShell: '',
  themeDark: DEFAULT_DARK_THEME_ID,
  themeLight: DEFAULT_LIGHT_THEME_ID,
  fontSize: 14,
  fontFamily: DEFAULT_FONT_FAMILY,
  lineHeight: 1.2,
  favorites: [],
  tabPosition: 'top',
  tabCollapsed: false,
  scrollback: 5000,
  cursorStyle: 'block',
  cursorBlink: true,
  copyOnSelect: true,
  rendererType: 'canvas',
  fastScrollSensitivity: 5,
  letterSpacing: 0,
  fontWeight: 'normal',
  rightClickSelectsWord: false,
  minimumContrastRatio: 1,
};

/**
 * 终端偏好派生 hook。
 *
 * 对 `preferences.terminal` 做默认值兜底——规避 PreferencesProvider 从服务器拉取时
 * `{ ...defaultPreferences, ...res.data }` 浅合并会整体覆盖 terminal 子对象、导致新增字段丢失的问题。
 */
export function useTerminalPreferences() {
  const { preferences, setPreferences } = usePreferences();

  const stored = preferences.terminal;
  const terminal: TerminalPreferences = {
    ...defaultTerminalPreferences,
    ...stored,
    favorites: stored?.favorites ?? defaultTerminalPreferences.favorites,
  };

  const setTerminalPref = (partial: Partial<TerminalPreferences>) => {
    setPreferences({ terminal: { ...terminal, ...partial } });
  };

  return { terminal, setTerminalPref };
}
