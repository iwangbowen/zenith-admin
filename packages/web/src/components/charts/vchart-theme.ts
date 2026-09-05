import { initVChartSemiTheme } from '@visactor/vchart-semi-theme';

declare global {
  interface Window {
    __zenithVChartSemiThemeInitialized__?: boolean;
  }
}

export function setupVChartSemiTheme() {
  if (typeof window === 'undefined' || window.__zenithVChartSemiThemeInitialized__) {
    return;
  }

  initVChartSemiTheme({ isWatchingThemeSwitch: true });
  window.__zenithVChartSemiThemeInitialized__ = true;
}
