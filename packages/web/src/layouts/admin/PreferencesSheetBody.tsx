import type { ReactNode } from 'react';
import type { NavLayout, UserPreferences } from '@/hooks/usePreferences';
import type { ThemeMode } from '@/hooks/useTheme';
import {
  PrefsActionsSection,
  PrefsAppearanceSection,
  PrefsGeneralSection,
  PrefsLayoutSection,
  PrefsNavToolbarSection,
  PrefsSidebarSection,
  PrefsTableSection,
  PrefsTabsSection,
} from './PreferencesSections';

export interface PreferencesSheetBodyProps {
  readonly prefSection: (label: string) => ReactNode;
  readonly matchesPref: (keywords: string[]) => boolean;
  readonly preferences: UserPreferences;
  readonly setPreferences: (prefs: Partial<UserPreferences>) => void;
  readonly navLayout: NavLayout;
  readonly mode: ThemeMode;
  readonly handleThemeModeChange: (newMode: ThemeMode) => void;
  readonly isDark: boolean;
  readonly themeColor: string;
  readonly setThemeColor: (color: string) => void;
  readonly prefsSearch: string;
  readonly quickChatEnabled: boolean;
  readonly homePathOptions: { value: string; label: string }[];
  readonly autoLockMinutes: number;
  readonly hasPassword: () => boolean;
  readonly clearLockPassword: () => void;
  readonly openLockPasswordModal: (mode: 'set' | 'change') => void;
  readonly handleCopyPreferences: () => void;
  readonly onOpenImport: () => void;
  readonly resetPreferences: () => void;
}

/**
 * 偏好设置抽屉的正文：全部分区 + ColorPicker / Radio / Select 等仅在此处使用的控件。
 * 作为 AdminLayout 的懒加载边界，首次打开抽屉时才下载，不进入布局首屏。
 */
export default function PreferencesSheetBody(props: PreferencesSheetBodyProps) {
  const base = {
    prefSection: props.prefSection,
    matchesPref: props.matchesPref,
    preferences: props.preferences,
    setPreferences: props.setPreferences,
  };
  return (
    <>
      <PrefsLayoutSection {...base} navLayout={props.navLayout} />
      <PrefsAppearanceSection
        {...base}
        mode={props.mode}
        handleThemeModeChange={props.handleThemeModeChange}
        isDark={props.isDark}
        themeColor={props.themeColor}
        setThemeColor={props.setThemeColor}
      />
      <PrefsNavToolbarSection {...base} prefsSearch={props.prefsSearch} quickChatEnabled={props.quickChatEnabled} />
      <PrefsSidebarSection {...base} navLayout={props.navLayout} />
      <PrefsGeneralSection
        {...base}
        homePathOptions={props.homePathOptions}
        autoLockMinutes={props.autoLockMinutes}
        hasPassword={props.hasPassword}
        clearLockPassword={props.clearLockPassword}
        openLockPasswordModal={props.openLockPasswordModal}
      />
      <PrefsTableSection {...base} />
      <PrefsTabsSection {...base} prefsSearch={props.prefsSearch} />
      <PrefsActionsSection
        handleCopyPreferences={props.handleCopyPreferences}
        onOpenImport={props.onOpenImport}
        resetPreferences={props.resetPreferences}
      />
    </>
  );
}
