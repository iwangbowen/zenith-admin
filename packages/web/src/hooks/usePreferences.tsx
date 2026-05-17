import { useState, useCallback, useContext, createContext } from 'react';
import type { ReactNode } from 'react';
import { PREFERENCES_KEY } from '@zenith/shared';

export type NavLayout = 'vertical' | 'horizontal' | 'mixed';
export type TabAnimation = 'none' | 'fade' | 'slide' | 'scale';

export interface UserPreferences {
  enableTabs: boolean;
  tabsMaxCount: number;
  showTabIcon: boolean;
  navLayout: NavLayout;
  showBreadcrumb: boolean;
  tabAnimation: TabAnimation;
  showMenuSearch: boolean;
  showFullscreen: boolean;
  showQuickChat: boolean;
  filesViewMode: 'list' | 'grid';
}

export const defaultPreferences: UserPreferences = {
  enableTabs: true,
  tabsMaxCount: 20,
  showTabIcon: true,
  navLayout: 'vertical',
  showBreadcrumb: false,
  tabAnimation: 'fade',
  showMenuSearch: true,
  showFullscreen: true,
  showQuickChat: true,
  filesViewMode: 'list',
};

function loadPreferences(): UserPreferences {
  try {
    const raw = localStorage.getItem(PREFERENCES_KEY);
    if (raw) {
      return { ...defaultPreferences, ...JSON.parse(raw) };
    }
  } catch { /* ignore */ }
  return { ...defaultPreferences };
}

function savePreferences(prefs: UserPreferences) {
  try {
    const raw = localStorage.getItem(PREFERENCES_KEY);
    const base = raw ? JSON.parse(raw) : {};
    localStorage.setItem(PREFERENCES_KEY, JSON.stringify({ ...base, ...prefs }));
  } catch {
    localStorage.setItem(PREFERENCES_KEY, JSON.stringify(prefs));
  }
}

interface PreferencesContextValue {
  preferences: UserPreferences;
  setPreferences: (partial: Partial<UserPreferences>) => void;
  resetPreferences: () => void;
}

const PreferencesContext = createContext<PreferencesContextValue | null>(null);

export function PreferencesProvider({ children }: { children: ReactNode }) {
  const [prefs, setPrefs] = useState<UserPreferences>(loadPreferences);

  const setPreferences = useCallback((partial: Partial<UserPreferences>) => {
    setPrefs((prev) => {
      const next = { ...prev, ...partial };
      savePreferences(next);
      return next;
    });
  }, []);

  const resetPreferences = useCallback(() => {
    localStorage.removeItem(PREFERENCES_KEY);
    setPrefs({ ...defaultPreferences });
  }, []);

  return (
    <PreferencesContext.Provider value={{ preferences: prefs, setPreferences, resetPreferences }}>
      {children}
    </PreferencesContext.Provider>
  );
}

export function usePreferences() {
  const ctx = useContext(PreferencesContext);
  if (!ctx) {
    throw new Error('usePreferences must be used within PreferencesProvider');
  }
  return ctx;
}
