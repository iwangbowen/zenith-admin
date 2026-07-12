import { formatDate, formatDateTime } from '../datetime';
import { applyMask, maskCustom, maskEmail, maskIdCard, maskPhone } from '../masking';
import type { ExportColumn, ExportRuntimeContext } from './types';

export function formatExportValue<TRow extends Record<string, unknown>>(
  column: ExportColumn<TRow>,
  row: TRow,
): unknown {
  const raw = column.key ? row[column.key] : undefined;
  const value = column.transform ? column.transform(raw, row) : raw;
  if (value == null) return '';
  if (column.enumMap && typeof value === 'string') return column.enumMap[value] ?? value;
  if (column.type === 'datetime') return formatDateTime(value as Date | string | number);
  if (column.type === 'date') return formatDate(value as Date | string | number);
  if (column.type === 'boolean') return value ? '是' : '否';
  if (column.type === 'money') {
    const cents = typeof value === 'number' ? value : Number(value);
    return Number.isFinite(cents) ? (cents / 100).toFixed(2) : '';
  }
  return value;
}

/** 敏感列在无 DB 规则时的回退脱敏：按字段名匹配内置类型，兜底保留前后各 1 位 */
function fallbackMask(fieldName: string, value: string): string {
  if (/phone|mobile/i.test(fieldName)) return maskPhone(value);
  if (/email/i.test(fieldName)) return maskEmail(value);
  if (/id_?card/i.test(fieldName)) return maskIdCard(value);
  return maskCustom(value, { prefixKeep: 1, suffixKeep: 1 });
}

/**
 * 格式化 + 脱敏一体的单元格取值。
 * 脱敏导出（masked）时敏感列统一打码：优先命中数据脱敏中心规则（maskEntity/maskField），
 * 未配置规则的敏感列按字段名回退内置脱敏，确保 raw=false 时绝不输出明文敏感数据。
 */
export function formatExportCell<TRow extends Record<string, unknown>>(
  column: ExportColumn<TRow>,
  row: TRow,
  ctx: ExportRuntimeContext,
): unknown {
  const value = formatExportValue(column, row);
  if (ctx.raw || !column.sensitive) return value;
  if (typeof value !== 'string' || value === '') return value;
  const rule = column.maskEntity && column.maskField
    ? ctx.maskRules?.get(`${column.maskEntity}.${column.maskField}`)
    : undefined;
  if (rule) return applyMask(value, rule.maskType, rule.customRule) ?? value;
  return fallbackMask(column.maskField ?? column.key ?? '', value);
}
