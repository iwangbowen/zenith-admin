/**
 * 主题色预设定义
 * 每种颜色包含浅色/深色模式下所需的 Semi Design 及自定义 CSS 变量
 * ThemeColor 为预设 key 或 #rrggbb 格式的自定义颜色
 */

export interface ColorVars {
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

/** 默认主题色预设 key（列表首项），与 `defaultPreferences.themeColor` 保持一致 */
export { DEFAULT_THEME_COLOR } from '@zenith/shared/preferences';

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
    key: 'wechat',
    name: '微信绿',
    light: {
      primary: '#07c160',
      hover: '#06a854',
      active: '#058f45',
      lightDefault: 'rgba(7,193,96,0.10)',
      lightHover: 'rgba(7,193,96,0.15)',
      lightActive: 'rgba(7,193,96,0.20)',
      sidebarActive: 'rgba(7,193,96,0.10)',
    },
    dark: {
      primary: '#4ecb71',
      hover: '#1db95f',
      active: '#07c160',
      lightDefault: 'rgba(78,203,113,0.15)',
      lightHover: 'rgba(78,203,113,0.20)',
      lightActive: 'rgba(78,203,113,0.25)',
      sidebarActive: 'rgba(78,203,113,0.25)',
    },
  },
  {
    key: 'navy',
    name: '藏青',
    light: {
      primary: '#1e40af',
      hover: '#1e3a8a',
      active: '#172554',
      lightDefault: 'rgba(30,64,175,0.10)',
      lightHover: 'rgba(30,64,175,0.15)',
      lightActive: 'rgba(30,64,175,0.20)',
      sidebarActive: 'rgba(30,64,175,0.10)',
    },
    dark: {
      primary: '#93c5fd',
      hover: '#60a5fa',
      active: '#3b82f6',
      lightDefault: 'rgba(147,197,253,0.15)',
      lightHover: 'rgba(147,197,253,0.20)',
      lightActive: 'rgba(147,197,253,0.25)',
      sidebarActive: 'rgba(147,197,253,0.25)',
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
    key: 'purple',
    name: '葡萄紫',
    light: {
      primary: '#9333ea',
      hover: '#7e22ce',
      active: '#6b21a8',
      lightDefault: 'rgba(147,51,234,0.10)',
      lightHover: 'rgba(147,51,234,0.15)',
      lightActive: 'rgba(147,51,234,0.20)',
      sidebarActive: 'rgba(147,51,234,0.10)',
    },
    dark: {
      primary: '#c084fc',
      hover: '#a855f7',
      active: '#9333ea',
      lightDefault: 'rgba(192,132,252,0.15)',
      lightHover: 'rgba(192,132,252,0.20)',
      lightActive: 'rgba(192,132,252,0.25)',
      sidebarActive: 'rgba(192,132,252,0.25)',
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
    key: 'peacock',
    name: '孔雀青',
    light: {
      primary: '#155e75',
      hover: '#164e63',
      active: '#083344',
      lightDefault: 'rgba(21,94,117,0.10)',
      lightHover: 'rgba(21,94,117,0.15)',
      lightActive: 'rgba(21,94,117,0.20)',
      sidebarActive: 'rgba(21,94,117,0.10)',
    },
    dark: {
      primary: '#67e8f9',
      hover: '#22d3ee',
      active: '#06b6d4',
      lightDefault: 'rgba(103,232,249,0.15)',
      lightHover: 'rgba(103,232,249,0.20)',
      lightActive: 'rgba(103,232,249,0.25)',
      sidebarActive: 'rgba(103,232,249,0.25)',
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
    key: 'forest',
    name: '松柏绿',
    light: {
      primary: '#15803d',
      hover: '#166534',
      active: '#14532d',
      lightDefault: 'rgba(21,128,61,0.10)',
      lightHover: 'rgba(21,128,61,0.15)',
      lightActive: 'rgba(21,128,61,0.20)',
      sidebarActive: 'rgba(21,128,61,0.10)',
    },
    dark: {
      primary: '#4ade80',
      hover: '#22c55e',
      active: '#16a34a',
      lightDefault: 'rgba(74,222,128,0.15)',
      lightHover: 'rgba(74,222,128,0.20)',
      lightActive: 'rgba(74,222,128,0.25)',
      sidebarActive: 'rgba(74,222,128,0.25)',
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
    key: 'wine',
    name: '酒红',
    light: {
      primary: '#9f1239',
      hover: '#881337',
      active: '#4c0519',
      lightDefault: 'rgba(159,18,57,0.10)',
      lightHover: 'rgba(159,18,57,0.15)',
      lightActive: 'rgba(159,18,57,0.20)',
      sidebarActive: 'rgba(159,18,57,0.10)',
    },
    dark: {
      primary: '#f43f5e',
      hover: '#e11d48',
      active: '#be123c',
      lightDefault: 'rgba(244,63,94,0.15)',
      lightHover: 'rgba(244,63,94,0.20)',
      lightActive: 'rgba(244,63,94,0.25)',
      sidebarActive: 'rgba(244,63,94,0.25)',
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
  {
    key: 'red',
    name: '朱砂红',
    light: {
      primary: '#dc2626',
      hover: '#b91c1c',
      active: '#991b1b',
      lightDefault: 'rgba(220,38,38,0.10)',
      lightHover: 'rgba(220,38,38,0.15)',
      lightActive: 'rgba(220,38,38,0.20)',
      sidebarActive: 'rgba(220,38,38,0.10)',
    },
    dark: {
      primary: '#f87171',
      hover: '#ef4444',
      active: '#dc2626',
      lightDefault: 'rgba(248,113,113,0.15)',
      lightHover: 'rgba(248,113,113,0.20)',
      lightActive: 'rgba(248,113,113,0.25)',
      sidebarActive: 'rgba(248,113,113,0.25)',
    },
  },
  {
    key: 'pink',
    name: '少女粉',
    light: {
      primary: '#db2777',
      hover: '#be185d',
      active: '#9d174d',
      lightDefault: 'rgba(219,39,119,0.10)',
      lightHover: 'rgba(219,39,119,0.15)',
      lightActive: 'rgba(219,39,119,0.20)',
      sidebarActive: 'rgba(219,39,119,0.10)',
    },
    dark: {
      primary: '#f472b6',
      hover: '#ec4899',
      active: '#db2777',
      lightDefault: 'rgba(244,114,182,0.15)',
      lightHover: 'rgba(244,114,182,0.20)',
      lightActive: 'rgba(244,114,182,0.25)',
      sidebarActive: 'rgba(244,114,182,0.25)',
    },
  },
  {
    key: 'amber',
    name: '琥珀金',
    light: {
      primary: '#f59e0b',
      hover: '#d97706',
      active: '#b45309',
      lightDefault: 'rgba(245,158,11,0.10)',
      lightHover: 'rgba(245,158,11,0.15)',
      lightActive: 'rgba(245,158,11,0.20)',
      sidebarActive: 'rgba(245,158,11,0.10)',
    },
    dark: {
      primary: '#fcd34d',
      hover: '#fbbf24',
      active: '#f59e0b',
      lightDefault: 'rgba(252,211,77,0.15)',
      lightHover: 'rgba(252,211,77,0.20)',
      lightActive: 'rgba(252,211,77,0.25)',
      sidebarActive: 'rgba(252,211,77,0.25)',
    },
  },
  {
    key: 'gold',
    name: '鎏金',
    light: {
      primary: '#a16207',
      hover: '#854d0e',
      active: '#713f12',
      lightDefault: 'rgba(161,98,7,0.10)',
      lightHover: 'rgba(161,98,7,0.15)',
      lightActive: 'rgba(161,98,7,0.20)',
      sidebarActive: 'rgba(161,98,7,0.10)',
    },
    dark: {
      primary: '#facc15',
      hover: '#eab308',
      active: '#ca8a04',
      lightDefault: 'rgba(250,204,21,0.15)',
      lightHover: 'rgba(250,204,21,0.20)',
      lightActive: 'rgba(250,204,21,0.25)',
      sidebarActive: 'rgba(250,204,21,0.25)',
    },
  },
  {
    key: 'sky',
    name: '天空蓝',
    light: {
      primary: '#0284c7',
      hover: '#0369a1',
      active: '#075985',
      lightDefault: 'rgba(2,132,199,0.10)',
      lightHover: 'rgba(2,132,199,0.15)',
      lightActive: 'rgba(2,132,199,0.20)',
      sidebarActive: 'rgba(2,132,199,0.10)',
    },
    dark: {
      primary: '#38bdf8',
      hover: '#0ea5e9',
      active: '#0284c7',
      lightDefault: 'rgba(56,189,248,0.15)',
      lightHover: 'rgba(56,189,248,0.20)',
      lightActive: 'rgba(56,189,248,0.25)',
      sidebarActive: 'rgba(56,189,248,0.25)',
    },
  },
  {
    key: 'coral',
    name: '珊瑚橙',
    light: {
      primary: '#f97316',
      hover: '#ea6c0d',
      active: '#c2540a',
      lightDefault: 'rgba(249,115,22,0.10)',
      lightHover: 'rgba(249,115,22,0.15)',
      lightActive: 'rgba(249,115,22,0.20)',
      sidebarActive: 'rgba(249,115,22,0.10)',
    },
    dark: {
      primary: '#fb923c',
      hover: '#f97316',
      active: '#ea6c0d',
      lightDefault: 'rgba(251,146,60,0.15)',
      lightHover: 'rgba(251,146,60,0.20)',
      lightActive: 'rgba(251,146,60,0.25)',
      sidebarActive: 'rgba(251,146,60,0.25)',
    },
  },
  {
    key: 'lime',
    name: '金橄榄',
    light: {
      primary: '#65a30d',
      hover: '#4d7c0f',
      active: '#3f6212',
      lightDefault: 'rgba(101,163,13,0.10)',
      lightHover: 'rgba(101,163,13,0.15)',
      lightActive: 'rgba(101,163,13,0.20)',
      sidebarActive: 'rgba(101,163,13,0.10)',
    },
    dark: {
      primary: '#a3e635',
      hover: '#84cc16',
      active: '#65a30d',
      lightDefault: 'rgba(163,230,53,0.15)',
      lightHover: 'rgba(163,230,53,0.20)',
      lightActive: 'rgba(163,230,53,0.25)',
      sidebarActive: 'rgba(163,230,53,0.25)',
    },
  },
  {
    key: 'brown',
    name: '深棕',
    light: {
      primary: '#92400e',
      hover: '#78350f',
      active: '#5c280a',
      lightDefault: 'rgba(146,64,14,0.10)',
      lightHover: 'rgba(146,64,14,0.15)',
      lightActive: 'rgba(146,64,14,0.20)',
      sidebarActive: 'rgba(146,64,14,0.10)',
    },
    dark: {
      primary: '#d97706',
      hover: '#b45309',
      active: '#92400e',
      lightDefault: 'rgba(217,119,6,0.15)',
      lightHover: 'rgba(217,119,6,0.20)',
      lightActive: 'rgba(217,119,6,0.25)',
      sidebarActive: 'rgba(217,119,6,0.25)',
    },
  },
  {
    key: 'charcoal',
    name: '墨黑',
    light: {
      primary: '#27272a',
      hover: '#18181b',
      active: '#09090b',
      lightDefault: 'rgba(39,39,42,0.10)',
      lightHover: 'rgba(39,39,42,0.15)',
      lightActive: 'rgba(39,39,42,0.20)',
      sidebarActive: 'rgba(39,39,42,0.10)',
    },
    dark: {
      primary: '#a1a1aa',
      hover: '#71717a',
      active: '#52525b',
      lightDefault: 'rgba(161,161,170,0.15)',
      lightHover: 'rgba(161,161,170,0.20)',
      lightActive: 'rgba(161,161,170,0.25)',
      sidebarActive: 'rgba(161,161,170,0.25)',
    },
  },
  {
    key: 'klein',
    name: '克莱因蓝',
    light: {
      primary: '#002fa7',
      hover: '#002685',
      active: '#001c63',
      lightDefault: 'rgba(0,47,167,0.10)',
      lightHover: 'rgba(0,47,167,0.15)',
      lightActive: 'rgba(0,47,167,0.20)',
      sidebarActive: 'rgba(0,47,167,0.10)',
    },
    dark: {
      primary: '#5c7cfa',
      hover: '#4263eb',
      active: '#3b5bdb',
      lightDefault: 'rgba(92,124,250,0.15)',
      lightHover: 'rgba(92,124,250,0.20)',
      lightActive: 'rgba(92,124,250,0.25)',
      sidebarActive: 'rgba(92,124,250,0.25)',
    },
  },
  {
    key: 'tiffany',
    name: '蒂芙尼青',
    light: {
      primary: '#0aa8a3',
      hover: '#088c88',
      active: '#06706d',
      lightDefault: 'rgba(10,168,163,0.10)',
      lightHover: 'rgba(10,168,163,0.15)',
      lightActive: 'rgba(10,168,163,0.20)',
      sidebarActive: 'rgba(10,168,163,0.10)',
    },
    dark: {
      primary: '#3dd9d3',
      hover: '#1cc7c1',
      active: '#0abab5',
      lightDefault: 'rgba(61,217,211,0.15)',
      lightHover: 'rgba(61,217,211,0.20)',
      lightActive: 'rgba(61,217,211,0.25)',
      sidebarActive: 'rgba(61,217,211,0.25)',
    },
  },
  {
    key: 'jade',
    name: '翡翠绿',
    light: {
      primary: '#00a86b',
      hover: '#008c59',
      active: '#007048',
      lightDefault: 'rgba(0,168,107,0.10)',
      lightHover: 'rgba(0,168,107,0.15)',
      lightActive: 'rgba(0,168,107,0.20)',
      sidebarActive: 'rgba(0,168,107,0.10)',
    },
    dark: {
      primary: '#3ecf95',
      hover: '#1dbd80',
      active: '#00a86b',
      lightDefault: 'rgba(62,207,149,0.15)',
      lightHover: 'rgba(62,207,149,0.20)',
      lightActive: 'rgba(62,207,149,0.25)',
      sidebarActive: 'rgba(62,207,149,0.25)',
    },
  },
  {
    key: 'mars',
    name: '马尔斯青',
    light: {
      primary: '#01847f',
      hover: '#016b67',
      active: '#01524f',
      lightDefault: 'rgba(1,132,127,0.10)',
      lightHover: 'rgba(1,132,127,0.15)',
      lightActive: 'rgba(1,132,127,0.20)',
      sidebarActive: 'rgba(1,132,127,0.10)',
    },
    dark: {
      primary: '#2eb8b2',
      hover: '#17a09b',
      active: '#01847f',
      lightDefault: 'rgba(46,184,178,0.15)',
      lightHover: 'rgba(46,184,178,0.20)',
      lightActive: 'rgba(46,184,178,0.25)',
      sidebarActive: 'rgba(46,184,178,0.25)',
    },
  },
  {
    key: 'bamboo',
    name: '竹青',
    light: {
      primary: '#6a8452',
      hover: '#586f43',
      active: '#465a35',
      lightDefault: 'rgba(106,132,82,0.10)',
      lightHover: 'rgba(106,132,82,0.15)',
      lightActive: 'rgba(106,132,82,0.20)',
      sidebarActive: 'rgba(106,132,82,0.10)',
    },
    dark: {
      primary: '#9dbb7f',
      hover: '#89a969',
      active: '#75925a',
      lightDefault: 'rgba(157,187,127,0.15)',
      lightHover: 'rgba(157,187,127,0.20)',
      lightActive: 'rgba(157,187,127,0.25)',
      sidebarActive: 'rgba(157,187,127,0.25)',
    },
  },
  {
    key: 'wisteria',
    name: '藤萝紫',
    light: {
      primary: '#7c6bb0',
      hover: '#69589e',
      active: '#56478b',
      lightDefault: 'rgba(124,107,176,0.10)',
      lightHover: 'rgba(124,107,176,0.15)',
      lightActive: 'rgba(124,107,176,0.20)',
      sidebarActive: 'rgba(124,107,176,0.10)',
    },
    dark: {
      primary: '#a99bd6',
      hover: '#9585ca',
      active: '#8271bd',
      lightDefault: 'rgba(169,155,214,0.15)',
      lightHover: 'rgba(169,155,214,0.20)',
      lightActive: 'rgba(169,155,214,0.25)',
      sidebarActive: 'rgba(169,155,214,0.25)',
    },
  },
  {
    key: 'sakura',
    name: '樱绯',
    light: {
      primary: '#e64980',
      hover: '#d6336c',
      active: '#c2255c',
      lightDefault: 'rgba(230,73,128,0.10)',
      lightHover: 'rgba(230,73,128,0.15)',
      lightActive: 'rgba(230,73,128,0.20)',
      sidebarActive: 'rgba(230,73,128,0.10)',
    },
    dark: {
      primary: '#f783ac',
      hover: '#f06595',
      active: '#e64980',
      lightDefault: 'rgba(247,131,172,0.15)',
      lightHover: 'rgba(247,131,172,0.20)',
      lightActive: 'rgba(247,131,172,0.25)',
      sidebarActive: 'rgba(247,131,172,0.25)',
    },
  },
  {
    key: 'ink',
    name: '黛蓝',
    light: {
      primary: '#37474f',
      hover: '#2b373e',
      active: '#1f282d',
      lightDefault: 'rgba(55,71,79,0.10)',
      lightHover: 'rgba(55,71,79,0.15)',
      lightActive: 'rgba(55,71,79,0.20)',
      sidebarActive: 'rgba(55,71,79,0.10)',
    },
    dark: {
      primary: '#90a4ae',
      hover: '#78909c',
      active: '#607d8b',
      lightDefault: 'rgba(144,164,174,0.15)',
      lightHover: 'rgba(144,164,174,0.20)',
      lightActive: 'rgba(144,164,174,0.25)',
      sidebarActive: 'rgba(144,164,174,0.25)',
    },
  },
  {
    key: 'copper',
    name: '古铜',
    light: {
      primary: '#a85e32',
      hover: '#8f4e28',
      active: '#753e1f',
      lightDefault: 'rgba(168,94,50,0.10)',
      lightHover: 'rgba(168,94,50,0.15)',
      lightActive: 'rgba(168,94,50,0.20)',
      sidebarActive: 'rgba(168,94,50,0.10)',
    },
    dark: {
      primary: '#d0916a',
      hover: '#c47d51',
      active: '#b56a3d',
      lightDefault: 'rgba(208,145,106,0.15)',
      lightHover: 'rgba(208,145,106,0.20)',
      lightActive: 'rgba(208,145,106,0.25)',
      sidebarActive: 'rgba(208,145,106,0.25)',
    },
  },
  {
    key: 'plum',
    name: '梅紫',
    light: {
      primary: '#9c3d72',
      hover: '#84315f',
      active: '#6b264d',
      lightDefault: 'rgba(156,61,114,0.10)',
      lightHover: 'rgba(156,61,114,0.15)',
      lightActive: 'rgba(156,61,114,0.20)',
      sidebarActive: 'rgba(156,61,114,0.10)',
    },
    dark: {
      primary: '#cf7bab',
      hover: '#c05f97',
      active: '#ad4a83',
      lightDefault: 'rgba(207,123,171,0.15)',
      lightHover: 'rgba(207,123,171,0.20)',
      lightActive: 'rgba(207,123,171,0.25)',
      sidebarActive: 'rgba(207,123,171,0.25)',
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

export function getThemeColorVars(color: string, isDark: boolean): ColorVars {
  const preset = getPreset(color);
  if (preset) return isDark ? preset.dark : preset.light;
  return deriveColorVars(color, isDark);
}

/**
 * 将主题色应用到文档 CSS 变量
 * @param color 颜色 key
 * @param isDark 当前是否为深色模式
 */
export function applyThemeColor(color: string, isDark: boolean): void {
  const vars = getThemeColorVars(color, isDark);
  const root = document.documentElement;

  // 自定义语义变量
  // 同时设置 html 与 body，避免 body[theme-mode='dark'] 中的默认变量覆盖动态主题色。
  const customVars: [string, string][] = [
    ['--color-primary', vars.primary],
    ['--color-sidebar-active', vars.sidebarActive],
    ['--color-sidebar-text-active', isDark ? '#ffffff' : vars.primary],
  ];
  for (const [name, value] of customVars) {
    root.style.setProperty(name, value);
    document.body.style.setProperty(name, value);
  }

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
