/**
 * 报表字段显示格式化（语义层 lite，纯函数，前后端共用）。
 * 数字/百分比/货币/日期/字典翻译。日期值约定已是 'YYYY-MM-DD HH:mm:ss' 字符串。
 */
import type { ReportFieldFormat, ReportResultField } from './types';

function fmtNumber(n: number, decimals: number | undefined, thousands: boolean | undefined): string {
  if (!Number.isFinite(n)) return '';
  return new Intl.NumberFormat('en-US', {
    minimumFractionDigits: decimals ?? 0,
    maximumFractionDigits: decimals ?? 2,
    useGrouping: thousands ?? true,
  }).format(n);
}

/**
 * 按字段格式化配置渲染显示值。
 * @param dictMap dict 类型的 value→label 映射（前端按 dictCode 预取）
 */
export function formatReportValue(
  value: unknown,
  format?: ReportFieldFormat,
  dictMap?: Record<string, string>,
): string {
  if (value === null || value === undefined) return '';
  if (!format) return String(value);
  const { kind, decimals, thousands, currencySymbol, prefix, suffix } = format;

  switch (kind) {
    case 'number': {
      const n = Number(value);
      return `${prefix ?? ''}${fmtNumber(n, decimals, thousands)}${suffix ?? ''}`;
    }
    case 'percent': {
      const n = Number(value);
      if (!Number.isFinite(n)) return String(value);
      return `${prefix ?? ''}${fmtNumber(n * 100, decimals ?? 2, thousands)}%${suffix ?? ''}`;
    }
    case 'currency': {
      const n = Number(value);
      return `${currencySymbol ?? '¥'}${fmtNumber(n, decimals ?? 2, thousands ?? true)}${suffix ?? ''}`;
    }
    case 'date': {
      const s = String(value);
      return s.length >= 10 ? s.slice(0, 10) : s;
    }
    case 'datetime': {
      const s = String(value);
      return s.length >= 19 ? s.slice(0, 19) : s;
    }
    case 'dict': {
      const key = String(value);
      return dictMap?.[key] ?? key;
    }
    default:
      return String(value);
  }
}

export function formatReportFieldValue(
  field: Pick<ReportResultField, 'format'> | null | undefined,
  value: unknown,
  dictMap?: Record<string, string>,
): string {
  return formatReportValue(value, field?.format, dictMap);
}
