/**
 * 主题色预设定义
 * 每种颜色包含浅色/深色模式下所需的 Semi Design 及自定义 CSS 变量
 * ThemeColor 为预设 key 或 #rrggbb 格式的自定义颜色
 */

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
  key: string;
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
  {
    key: 'rose',
    name: '玫瑰红',
    light: {
      primary: '#e11d48',
      hover: '#be123c',
      active: '#9f1239',
      lightDefault: 'rgba(225,29,72,0.10)',
      lightHover: 'rgba(225,29,72,0.15)',
      lightActive: 'rgba(225,29,72,0.20)',
      sidebarActive: 'rgba(225,29,72,0.10)',
    },
    dark: {
      primary: '#fb7185',
      hover: '#f43f5e',
      active: '#e11d48',
      lightDefault: 'rgba(251,113,133,0.15)',
      lightHover: 'rgba(251,113,133,0.20)',
      lightActive: 'rgba(251,113,133,0.25)',
      sidebarActive: 'rgba(251,113,133,0.25)',
    },
  },
  {
    key: 'fuchsia',
    name: '品红',
    light: {
      primary: '#c026d3',
      hover: '#a21caf',
      active: '#86198f',
      lightDefault: 'rgba(192,38,211,0.10)',
      lightHover: 'rgba(192,38,211,0.15)',
      lightActive: 'rgba(192,38,211,0.20)',
      sidebarActive: 'rgba(192,38,211,0.10)',
    },
    dark: {
      primary: '#e879f9',
      hover: '#d946ef',
      active: '#c026d3',
      lightDefault: 'rgba(232,121,249,0.15)',
      lightHover: 'rgba(232,121,249,0.20)',
      lightActive: 'rgba(232,121,249,0.25)',
      sidebarActive: 'rgba(232,121,249,0.25)',
    },
  },
  {
    key: 'teal',
    name: '青碧',
    light: {
      primary: '#0d9488',
      hover: '#0f766e',
      active: '#115e59',
      lightDefault: 'rgba(13,148,136,0.10)',
      lightHover: 'rgba(13,148,136,0.15)',
      lightActive: 'rgba(13,148,136,0.20)',
      sidebarActive: 'rgba(13,148,136,0.10)',
    },
    dark: {
      primary: '#2dd4bf',
      hover: '#14b8a6',
      active: '#0d9488',
      lightDefault: 'rgba(45,212,191,0.15)',
      lightHover: 'rgba(45,212,191,0.20)',
      lightActive: 'rgba(45,212,191,0.25)',
      sidebarActive: 'rgba(45,212,191,0.25)',
    },
  },
  {
    key: 'slate',
    name: '钢灰',
    light: {
      primary: '#475569',
      hover: '#334155',
      active: '#1e293b',
      lightDefault: 'rgba(71,85,105,0.10)',
      lightHover: 'rgba(71,85,105,0.15)',
      lightActive: 'rgba(71,85,105,0.20)',
      sidebarActive: 'rgba(71,85,105,0.10)',
    },
    dark: {
      primary: '#94a3b8',
      hover: '#7c8fa3',
      active: '#64748b',
      lightDefault: 'rgba(148,163,184,0.15)',
      lightHover: 'rgba(148,163,184,0.20)',
      lightActive: 'rgba(148,163,184,0.25)',
      sidebarActive: 'rgba(148,163,184,0.25)',
    },
  },
];

/** 根据颜色 key 快速查找预设，找不到返回 null */
function getPreset(color: string): ThemeColorPreset | null {
  return THEME_COLOR_PRESETS.find((p) => p.key === color) ?? null;
}

// ─── 自定义颜色推导工具 ───────────────────────────────────────────────────────

function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
  const clean = hex.replace('#', '');
  if (!/^[0-9a-f]{6}$/i.test(clean)) return null;
  return {
    r: Number.parseInt(clean.slice(0, 2), 16),
    g: Number.parseInt(clean.slice(2, 4), 16),
    b: Number.parseInt(clean.slice(4, 6), 16),
  };
}

function hueToRgb(p: number, q: number, t: number): number {
  let tt = t;
  if (tt < 0) tt += 1;
  if (tt > 1) tt -= 1;
  if (tt < 1 / 6) return p + (q - p) * 6 * tt;
  if (tt < 1 / 2) return q;
  if (tt < 2 / 3) return p + (q - p) * (2 / 3 - tt) * 6;
  return p;
}

function hslToHex(h: number, s: number, l: number): string {
  const hh = h / 360;
  const ss = s / 100;
  const ll = l / 100;
  let r: number, g: number, b: number;
  if (ss === 0) {
    r = g = b = ll;
  } else {
    const q = ll < 0.5 ? ll * (1 + ss) : ll + ss - ll * ss;
    const p = 2 * ll - q;
    r = hueToRgb(p, q, hh + 1 / 3);
    g = hueToRgb(p, q, hh);
    b = hueToRgb(p, q, hh - 1 / 3);
  }
  const toHex = (x: number) => Math.round(x * 255).toString(16).padStart(2, '0');
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

function rgbToHsl(r: number, g: number, b: number): { h: number; s: number; l: number } {
  const rr = r / 255;
  const gg = g / 255;
  const bb = b / 255;
  const max = Math.max(rr, gg, bb);
  const min = Math.min(rr, gg, bb);
  let h = 0;
  let s = 0;
  const l = (max + min) / 2;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case rr: h = ((gg - bb) / d + (gg < bb ? 6 : 0)) / 6; break;
      case gg: h = ((bb - rr) / d + 2) / 6; break;
      case bb: h = ((rr - gg) / d + 4) / 6; break;
    }
  }
  return { h: h * 360, s: s * 100, l: l * 100 };
}

/** 从任意 hex 颜色推导出完整的 ColorVars */
function deriveColorVars(hex: string, isDark: boolean): ColorVars {
  const rgb = hexToRgb(hex);
  if (!rgb) {
    return {
      primary: hex, hover: hex, active: hex,
      lightDefault: 'rgba(0,0,0,0.10)', lightHover: 'rgba(0,0,0,0.15)',
      lightActive: 'rgba(0,0,0,0.20)', sidebarActive: 'rgba(0,0,0,0.10)',
    };
  }
  const { r, g, b } = rgb;
  const { h, s, l } = rgbToHsl(r, g, b);
  if (isDark) {
    const primary = hslToHex(h, s, Math.min(l + 15, 88));
    const hover = hslToHex(h, s, Math.min(l + 8, 82));
    return {
      primary, hover, active: hex,
      lightDefault: `rgba(${r},${g},${b},0.15)`,
      lightHover: `rgba(${r},${g},${b},0.20)`,
      lightActive: `rgba(${r},${g},${b},0.25)`,
      sidebarActive: `rgba(${r},${g},${b},0.25)`,
    };
  } else {
    const hover = hslToHex(h, s, Math.max(l - 9, 8));
    const active = hslToHex(h, s, Math.max(l - 18, 5));
    return {
      primary: hex, hover, active,
      lightDefault: `rgba(${r},${g},${b},0.10)`,
      lightHover: `rgba(${r},${g},${b},0.15)`,
      lightActive: `rgba(${r},${g},${b},0.20)`,
      sidebarActive: `rgba(${r},${g},${b},0.10)`,
    };
  }
}

/**
 * 将主题色应用到文档 CSS 变量
 * @param color 颜色 key
 * @param isDark 当前是否为深色模式
 */
export function applyThemeColor(color: string, isDark: boolean): void {
  const preset = getPreset(color);
  let vars: ColorVars;
  if (preset) {
    vars = isDark ? preset.dark : preset.light;
  } else {
    vars = deriveColorVars(color, isDark);
  }
  const root = document.documentElement;

  // 自定义语义变量
  root.style.setProperty('--color-primary', vars.primary);
  root.style.setProperty('--color-sidebar-active', vars.sidebarActive);
  root.style.setProperty('--color-sidebar-text-active', isDark ? '#ffffff' : vars.primary);

  // Semi Design CSS 变量覆盖
  // 同时设置 html 与 body，确保覆盖 Semi 在 body 上挂载的变量。
  const semiVars: [string, string][] = [
    ['--semi-color-primary', vars.primary],
    ['--semi-color-primary-hover', vars.hover],
    ['--semi-color-primary-active', vars.active],
    ['--semi-color-primary-light-default', vars.lightDefault],
    ['--semi-color-primary-light-hover', vars.lightHover],
    ['--semi-color-primary-light-active', vars.lightActive],
  ];
  for (const [name, value] of semiVars) {
    root.style.setProperty(name, value);
    document.body.style.setProperty(name, value);
  }
}
