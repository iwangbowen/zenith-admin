/**
 * 行为分析各 Tab 共用的纯函数与常量：数值 / 时长 / 百分比格式化、图表色号、页面路径分段。
 * 不含 React 组件（组件在 analytics-shared.tsx），便于被表格列 render 与图表 spec 直接复用。
 */
import type { CSSProperties } from 'react';
import type { AnalyticsDeviceType } from '@zenith/shared/analytics';
import { BEHAVIOR_DAYS_OPTIONS } from './behavior-days-context';

export function msToReadable(ms: number | null): string {
  if (ms == null) return '–';
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.floor(ms / 60_000)}m ${Math.floor((ms % 60_000) / 1000)}s`;
}

export const DAYS_OPTIONS = BEHAVIOR_DAYS_OPTIONS;

/** 无语义元素（elementLabel 缺失或就是裸标签名）的展示兜底：「未命名 button」比裸 "button" 更明确 */
const GENERIC_ELEMENT_LABELS = new Set(['button', 'a', 'div', 'span', 'input', 'svg', 'img', 'li', 'td', 'p', 'i', 'label']);
export function elementDisplayName(elementLabel: string | null | undefined, elementKey: string): string {
  const label = elementLabel?.trim();
  if (label && !GENERIC_ELEMENT_LABELS.has(label.toLowerCase())) return label;
  const tag = label || elementKey.split(':')[0] || '元素';
  return `未命名 ${tag}`;
}

/** 图表只做 TOP N 概览：treemap 叶子过多、饼图切片过多都读不出信息，因此与分页表格分开取数 */
export const CHART_TOP_N = 20;

export const ACCENT_COLORS = ['#22c55e', '#f59e0b', '#ef4444', '#8b5cf6', '#06b6d4', '#f97316', '#84cc16', '#ec4899', '#64748b'];

export const sectionStyle: CSSProperties = { display: 'flex', flexDirection: 'column', gap: 16 };

export function numberText(value: number): string {
  return String(Math.round(value)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

export function percentText(value: number | null | undefined, digits = 1): string {
  if (value == null || Number.isNaN(value)) return '–';
  return `${value.toFixed(digits)}%`;
}

export type ChartRow = Record<string, number | string>;

export function chartColor(index: number, primary: string): string {
  return index === 0 ? primary : ACCENT_COLORS[(index - 1) % ACCENT_COLORS.length];
}

export function getRouteSegments(pagePath: string): string[] {
  const parts = pagePath.split('/').filter(Boolean);
  return parts.length ? parts : ['首页'];
}

export type DeviceFilter = AnalyticsDeviceType;
