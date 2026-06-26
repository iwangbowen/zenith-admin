import type React from 'react';
import type { IAreaChartSpec } from '@visactor/react-vchart';
import type { ChartPalette } from './palette';

/** VChart 在回调中传入的数据项类型 */
export type ChartDatum = Record<string, unknown> | undefined;

/** 图表初始化选项：桌面浏览器模式 + 适配设备像素比 */
export const chartOptions = {
  mode: 'desktop-browser' as const,
  dpr: typeof window === 'undefined' ? 1 : window.devicePixelRatio,
};

/** 通用区块样式（卡片容器） */
export const sectionStyle: React.CSSProperties = {
  background: 'var(--semi-color-bg-1)',
  border: '1px solid var(--semi-color-border)',
  borderRadius: 6,
  padding: '16px 20px',
};

/** 通用区块标题样式 */
export const sectionTitleStyle: React.CSSProperties = {
  fontSize: 14,
  fontWeight: 600,
  color: 'var(--semi-color-text-0)',
  marginBottom: 12,
};

/** 大数值压缩为「万」单位展示 */
export function compactCount(value: number): string {
  return value >= 10000 ? `${(value / 10000).toFixed(1)}万` : String(value);
}

// ── VChart 轴/数据项取值辅助（VChart 回调里的值可能是 string | string[]） ──

export function axisText(value: string | string[]): string {
  return Array.isArray(value) ? value.join('') : value;
}

export function axisNumber(value: string | string[]): number {
  return Number(axisText(value)) || 0;
}

export function datumText(datum: ChartDatum, field: string): string {
  const value = datum?.[field];
  return typeof value === 'string' || typeof value === 'number' ? String(value) : '';
}

export function datumNumber(datum: ChartDatum, field: string): number {
  const value = datum?.[field];
  return typeof value === 'number' ? value : Number(value) || 0;
}

export function datumBoolean(datum: ChartDatum, field: string): boolean {
  return datum?.[field] === true;
}

/** 统一风格的 tooltip 面板样式 */
export function makeCommonTooltip(palette: ChartPalette): NonNullable<IAreaChartSpec['tooltip']> {
  return {
    style: {
      panel: {
        backgroundColor: palette.tooltipBg,
        border: { color: palette.border, width: 1 },
        shadow: { x: 0, y: 8, blur: 10, spread: 0, color: palette.tooltipShadow },
      },
      titleLabel: { fill: palette.text1 },
      keyLabel: { fill: palette.text2 },
      valueLabel: { fill: palette.text0 },
    },
  };
}

/** 直角坐标系图表的公共 spec（内边距 / 透明背景 / 动画 / tooltip） */
export function makeCommonCartesianSpec(palette: ChartPalette) {
  return {
    padding: { top: 8, right: 12, bottom: 8, left: 8 },
    background: 'transparent',
    animation: true,
    tooltip: makeCommonTooltip(palette),
  };
}

/** 判断一组数据是否「全为空」（用于切换空状态占位） */
export function isEmptyValues(
  values: readonly { readonly count?: number; readonly value?: number }[],
): boolean {
  return values.length === 0 || values.every((d) => (d.count ?? d.value ?? 0) === 0);
}

/** 多系列配置：来自宽表的某个字段 + 展示名 + 颜色 */
export interface SeriesField {
  /** 宽表里的字段名 */
  readonly field: string;
  /** 系列展示名（图例 / tooltip） */
  readonly name: string;
  /** 系列颜色（省略时按调色板顺序取色） */
  readonly color?: string;
}

export interface LongDatum {
  readonly __x: string;
  readonly __type: string;
  readonly __value: number;
  readonly [key: string]: unknown;
}

/**
 * 宽表转长表（melt）。
 * 多系列数据常见的「一行多列」形态（如 `{ x, a, b }`），需要摊平成
 * `{ __x, __type, __value }`，以便 VChart 通用图表用 `seriesField` 区分系列。
 */
export function wideToLong(
  rows: readonly Record<string, unknown>[],
  xField: string,
  series: readonly SeriesField[],
): LongDatum[] {
  const result: LongDatum[] = [];
  for (const row of rows) {
    const x = row[xField];
    const xStr = typeof x === 'string' || typeof x === 'number' ? String(x) : '';
    for (const s of series) {
      const raw = row[s.field];
      result.push({
        ...row,
        __x: xStr,
        __type: s.name,
        __value: typeof raw === 'number' ? raw : Number(raw) || 0,
      });
    }
  }
  return result;
}

/** 取系列颜色数组（缺省颜色按调色板补齐） */
export function seriesColors(series: readonly SeriesField[], palette: ChartPalette): string[] {
  return series.map((s, i) => s.color ?? palette.dataColors[i % palette.dataColors.length]);
}
