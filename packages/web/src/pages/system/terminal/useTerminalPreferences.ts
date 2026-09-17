import { defaultPreferences, preferenceDefinitions, type TerminalPreferences } from '@zenith/shared/preferences';
import { usePreferences } from '@/hooks/usePreferences';

export const defaultTerminalPreferences: TerminalPreferences = defaultPreferences.terminal;
const terminalPaths = preferenceDefinitions.filter(({ path }) => path.startsWith('terminal.')).map(({ path }) => path);

/** 只写本次变化的叶子，其他终端字段继续继承系统默认值。 */
export function useTerminalPreferences() {
  const { preferences, setPreferences, resetPreference, canEditPreference, isPreferenceOverridden } = usePreferences();
  const setTerminalPref = (partial: Partial<TerminalPreferences>) => setPreferences({ terminal: partial });
  const resetTerminalPreferences = () => {
    resetPreference(terminalPaths);
  };
  return {
    terminal: preferences.terminal,
    setTerminalPref,
    resetTerminalPreferences,
    canEditTerminalPreferences: terminalPaths.some(canEditPreference),
    hasTerminalOverrides: terminalPaths.some(isPreferenceOverridden),
  };
}
