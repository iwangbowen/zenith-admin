/**
 * 主题色预设定义
 * 每种颜色包含浅色/深色模式下所需的 Semi Design 及自定义 CSS 变量
 */

export type ThemeColor = 'blue' | 'indigo' | 'violet' | 'cyan' | 'green' | 'orange';

interface ColorVars {
  primary: string;
  hover: string;
  active: string;
  lightDefault: string;
  lightHover: string;
  lightActive: string;
  sidebarActive: string;
}

interface ThemeColorPreset {
  key: ThemeColor;
  name: string;
  light: ColorVars;
  dark: ColorVars;
}

export const THEME_COLOR_PRESETS: ThemeColorPreset[] = [
  {
    key: 'blue',
    name: '飞书蓝',
    light: {
      primary: '#3370ff',
      hover: '#2860e1',
      active: '#1d4ed8',
      lightDefault: 'rgba(51,112,255,0.10)',
      lightHover: 'rgba(51,112,255,0.15)',
      lightActive: 'rgba(51,112,255,0.20)',
      sidebarActive: 'rgba(51,112,255,0.10)',
    },
    dark: {
      primary: '#618bff',
      hover: '#4d78ff',
      active: '#3370ff',
      lightDefault: 'rgba(97,139,255,0.15)',
      lightHover: 'rgba(97,139,255,0.20)',
      lightActive: 'rgba(97,139,255,0.25)',
      sidebarActive: 'rgba(97,139,255,0.25)',
    },
  },
  {
    key: 'indigo',
    name: '靛紫',
    light: {
      primary: '#4f46e5',
      hover: '#4338ca',
      active: '#3730a3',
      lightDefault: 'rgba(79,70,229,0.10)',
      lightHover: 'rgba(79,70,229,0.15)',
      lightActive: 'rgba(79,70,229,0.20)',
      sidebarActive: 'rgba(79,70,229,0.10)',
    },
    dark: {
      primary: '#818cf8',
      hover: '#6d66f5',
      active: '#4f46e5',
      lightDefault: 'rgba(129,140,248,0.15)',
      lightHover: 'rgba(129,140,248,0.20)',
      lightActive: 'rgba(129,140,248,0.25)',
      sidebarActive: 'rgba(129,140,248,0.25)',
    },
  },
  {
    key: 'violet',
    name: '薰衣草紫',
    light: {
      primary: '#7c3aed',
      hover: '#6d28d9',
      active: '#5b21b6',
      lightDefault: 'rgba(124,58,237,0.10)',
      lightHover: 'rgba(124,58,237,0.15)',
      lightActive: 'rgba(124,58,237,0.20)',
      sidebarActive: 'rgba(124,58,237,0.10)',
    },
    dark: {
      primary: '#a78bfa',
      hover: '#9b6df5',
      active: '#7c3aed',
      lightDefault: 'rgba(167,139,250,0.15)',
      lightHover: 'rgba(167,139,250,0.20)',
      lightActive: 'rgba(167,139,250,0.25)',
      sidebarActive: 'rgba(167,139,250,0.25)',
    },
  },
  {
    key: 'cyan',
    name: '湖蓝',
    light: {
      primary: '#0891b2',
      hover: '#0e7490',
      active: '#155e75',
      lightDefault: 'rgba(8,145,178,0.10)',
      lightHover: 'rgba(8,145,178,0.15)',
      lightActive: 'rgba(8,145,178,0.20)',
      sidebarActive: 'rgba(8,145,178,0.10)',
    },
    dark: {
      primary: '#22d3ee',
      hover: '#06b6d4',
      active: '#0891b2',
      lightDefault: 'rgba(34,211,238,0.15)',
      lightHover: 'rgba(34,211,238,0.20)',
      lightActive: 'rgba(34,211,238,0.25)',
      sidebarActive: 'rgba(34,211,238,0.25)',
    },
  },
  {
    key: 'green',
    name: '碧绿',
    light: {
      primary: '#059669',
      hover: '#047857',
      active: '#065f46',
      lightDefault: 'rgba(5,150,105,0.10)',
      lightHover: 'rgba(5,150,105,0.15)',
      lightActive: 'rgba(5,150,105,0.20)',
      sidebarActive: 'rgba(5,150,105,0.10)',
    },
    dark: {
      primary: '#34d399',
      hover: '#10b981',
      active: '#059669',
      lightDefault: 'rgba(52,211,153,0.15)',
      lightHover: 'rgba(52,211,153,0.20)',
      lightActive: 'rgba(52,211,153,0.25)',
      sidebarActive: 'rgba(52,211,153,0.25)',
    },
  },
  {
    key: 'orange',
    name: '橙珀',
    light: {
      primary: '#d97706',
      hover: '#b45309',
      active: '#92400e',
      lightDefault: 'rgba(217,119,6,0.10)',
      lightHover: 'rgba(217,119,6,0.15)',
      lightActive: 'rgba(217,119,6,0.20)',
      sidebarActive: 'rgba(217,119,6,0.10)',
    },
    dark: {
      primary: '#fbbf24',
      hover: '#f59e0b',
      active: '#d97706',
      lightDefault: 'rgba(251,191,36,0.15)',
      lightHover: 'rgba(251,191,36,0.20)',
      lightActive: 'rgba(251,191,36,0.25)',
      sidebarActive: 'rgba(251,191,36,0.25)',
    },
  },
];

/** 根据颜色 key 快速查找预设 */
function getPreset(color: ThemeColor): ThemeColorPreset {
  return THEME_COLOR_PRESETS.find((p) => p.key === color) ?? THEME_COLOR_PRESETS[0];
}

/**
 * 将主题色应用到文档 CSS 变量
 * @param color 颜色 key
 * @param isDark 当前是否为深色模式
 */
export function applyThemeColor(color: ThemeColor, isDark: boolean): void {
  const preset = getPreset(color);
  const vars = isDark ? preset.dark : preset.light;
  const root = document.documentElement;

  // 自定义 CSS 变量
  root.style.setProperty('--color-primary', vars.primary);
  root.style.setProperty('--color-sidebar-active', vars.sidebarActive);
  root.style.setProperty('--color-sidebar-text-active', isDark ? '#ffffff' : vars.primary);

  // Semi Design CSS 变量覆盖
  root.style.setProperty('--semi-color-primary', vars.primary);
  root.style.setProperty('--semi-color-primary-hover', vars.hover);
  root.style.setProperty('--semi-color-primary-active', vars.active);
  root.style.setProperty('--semi-color-primary-light-default', vars.lightDefault);
  root.style.setProperty('--semi-color-primary-light-hover', vars.lightHover);
  root.style.setProperty('--semi-color-primary-light-active', vars.lightActive);
}
