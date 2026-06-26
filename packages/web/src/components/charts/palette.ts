import { useEffect, useState } from 'react';
import { useThemeController } from '@/providers/theme-controller';

/**
 * 主题感知的图表调色板。
 * 颜色优先取 Semi Design 的 CSS 变量，保证亮/暗主题与主题色切换时自动同步。
 */
export interface ChartPalette {
  readonly success: string;
  readonly danger: string;
  readonly warning: string;
  readonly risk: string;
  readonly active: string;
  readonly primary: string;
  readonly text0: string;
  readonly text1: string;
  readonly text2: string;
  readonly border: string;
  readonly fill0: string;
  readonly fill1: string;
  readonly grid: string;
  readonly bg1: string;
  readonly tooltipBg: string;
  readonly tooltipShadow: string;
  readonly dataColors: string[];
}

export function cssVar(name: string, fallback: string): string {
  const fromBody = getComputedStyle(document.body).getPropertyValue(name).trim();
  if (fromBody) return fromBody;
  const fromRoot = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return fromRoot || fallback;
}

const RISK_COLOR = '#f43f5e';
const SEMI_SMALL_DATA_COLOR_INDICES = [0, 2, 4, 6, 8, 10, 12, 14, 16, 18] as const;
const SEMI_SMALL_DATA_COLOR_FALLBACKS = [
  '#1664ff',
  '#1ac6ff',
  '#ff8a00',
  '#3cc780',
  '#7442d4',
  '#ffc400',
  '#304d77',
  '#b48deb',
  '#009488',
  '#ff7dda',
] as const;

export function readChartPalette(isDark: boolean): ChartPalette {
  const primary = cssVar('--semi-color-primary', isDark ? '#6aa1ff' : '#1664ff');
  const fill0 = cssVar('--semi-color-fill-0', isDark ? 'rgba(255, 255, 255, 0.04)' : 'rgba(28, 31, 35, 0.03)');
  const fill1 = cssVar('--semi-color-fill-1', isDark ? 'rgba(255, 255, 255, 0.08)' : 'rgba(28, 31, 35, 0.06)');

  return {
    success: cssVar('--semi-color-success', isDark ? '#37d196' : '#00b42a'),
    danger: cssVar('--semi-color-danger', isDark ? '#ff7875' : '#f53f3f'),
    warning: cssVar('--semi-color-warning', isDark ? '#ffb44b' : '#ff7d00'),
    risk: isDark ? '#ff6b8a' : RISK_COLOR,
    active: cssVar('--semi-color-data-2', isDark ? '#74d8ff' : '#1ac6ff'),
    primary,
    text0: cssVar('--semi-color-text-0', isDark ? 'rgba(255, 255, 255, 0.9)' : 'rgba(0, 0, 0, 0.9)'),
    text1: cssVar('--semi-color-text-1', isDark ? 'rgba(255, 255, 255, 0.75)' : 'rgba(0, 0, 0, 0.62)'),
    text2: cssVar('--semi-color-text-2', isDark ? 'rgba(255, 255, 255, 0.55)' : 'rgba(0, 0, 0, 0.36)'),
    border: cssVar('--semi-color-border', isDark ? 'rgba(255, 255, 255, 0.12)' : 'rgba(28, 31, 35, 0.12)'),
    fill0,
    fill1,
    grid: isDark ? 'rgba(255, 255, 255, 0.12)' : 'rgba(28, 31, 35, 0.10)',
    bg1: cssVar('--semi-color-bg-1', isDark ? '#16161a' : '#ffffff'),
    tooltipBg: cssVar('--semi-color-bg-2', isDark ? '#2f3037' : '#ffffff'),
    tooltipShadow: isDark ? 'rgba(0, 0, 0, 0.35)' : 'rgba(0, 0, 0, 0.10)',
    dataColors: SEMI_SMALL_DATA_COLOR_INDICES.map((index, i) => (
      cssVar(`--semi-color-data-${index}`, SEMI_SMALL_DATA_COLOR_FALLBACKS[i])
    )),
  };
}

/**
 * 订阅主题切换并在下一帧重新读取 CSS 变量，确保切换亮/暗或主题色后图表配色即时更新。
 */
export function useChartPalette(): ChartPalette {
  const { isDark, themeColor } = useThemeController();
  const [palette, setPalette] = useState(() => readChartPalette(isDark));

  useEffect(() => {
    const refresh = () => setPalette(readChartPalette(isDark));
    refresh();
    const raf = window.requestAnimationFrame(refresh);
    return () => window.cancelAnimationFrame(raf);
  }, [isDark, themeColor]);

  return palette;
}
