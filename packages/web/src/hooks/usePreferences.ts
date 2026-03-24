import { useState, useCallback } from 'react';
import { PREFERENCES_KEY } from '@zenith/shared';
import type { ThemeMode } from './useTheme';

export interface UserPreferences {
  enableTabs: boolean;
  tabsMaxCount: number;
  showTabIcon: boolean;
  colorMode: ThemeMode;
}

const defaultPreferences: UserPreferences = {
  enableTabs: true,
  tabsMaxCount: 20,
  showTabIcon: true,
  colorMode: 'light',
};

function loadPreferences(): UserPreferences {
  try {
    const raw = localStorage.getItem(PREFERENCES_KEY);
    if (raw) return { ...defaultPreferences, ...JSON.parse(raw) };
  } catch { /* ignore */ }
  return { ...defaultPreferences };
}

function savePreferences(prefs: UserPreferences) {
  localStorage.setItem(PREFERENCES_KEY, JSON.stringify(prefs));
}

export function usePreferences() {
  const [preferences, setPreferencesState] = useState<UserPreferences>(loadPreferences);

  const setPreferences = useCallback((partial: Partial<UserPreferences>) => {
    setPreferencesState((prev) => {
      const next = { ...prev, ...partial };
      savePreferences(next);
      return next;
    });
  }, []);

  return { preferences, setPreferences };
}
