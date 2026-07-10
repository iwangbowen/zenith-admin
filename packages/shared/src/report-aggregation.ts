import type { ReportAlertAggregate, ReportAlertOp } from './types';

function toFiniteNumber(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return null;
    const parsed = Number(trimmed);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function collectNumericValues(rows: Record<string, unknown>[], field: string): number[] {
  return rows
    .map((row) => toFiniteNumber(row[field]))
    .filter((value): value is number => value !== null);
}

/**
 * 统一聚合报表行集。
 * - count / 缺失字段：返回行数
 * - 非数值：忽略
 * - 空集 / 无可用数值：返回 0
 */
export function aggregateReportRows(
  rows: Record<string, unknown>[],
  field: string | null | undefined,
  aggregate: ReportAlertAggregate = 'sum',
): number {
  if (aggregate === 'count' || !field) return rows.length;
  const values = collectNumericValues(rows, field);
  if (values.length === 0) return 0;
  switch (aggregate) {
    case 'avg':
      return values.reduce((sum, value) => sum + value, 0) / values.length;
    case 'max':
      return Math.max(...values);
    case 'min':
      return Math.min(...values);
    case 'first':
      return values[0] ?? 0;
    default:
      return values.reduce((sum, value) => sum + value, 0);
  }
}

export function compare(value: number, op: ReportAlertOp, threshold: number): boolean {
  switch (op) {
    case 'gt':
      return value > threshold;
    case 'gte':
      return value >= threshold;
    case 'lt':
      return value < threshold;
    case 'lte':
      return value <= threshold;
    case 'eq':
      return value === threshold;
    case 'neq':
      return value !== threshold;
    default:
      return false;
  }
}

