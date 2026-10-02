/**
 * 只读文本渲染（查看态）的纯函数部分。
 * 详情/审批查看场景下，简单值字段渲染为纯文本而非 disabled 输入框：
 * 可读性（灰字对比度）、可复制性、打印与无障碍朗读都优于禁用态控件。
 * 附件、签名等复杂类型仍由专用查看组件负责，明细复用同一值格式化器。
 */
import type { WorkflowFormField } from '@zenith/shared/workflow';
import { CURRENCY_OPTIONS } from '../../form-types';

export const READONLY_TEXT_TYPES = new Set<string>([
  'text', 'textarea', 'number', 'amount', 'phone', 'email', 'idCard', 'url',
  'date', 'time', 'dateRange', 'select', 'multiSelect', 'radio', 'checkbox',
  'switch', 'slider', 'rate', 'nps', 'tags', 'autoComplete', 'formula',
]);

function readOnlyOptionLabel(field: WorkflowFormField, value: string): string {
  const item = field.optionItems?.find((it) => it.value === value);
  return item?.label ?? value;
}

export function formatReadOnlyValue(field: WorkflowFormField, value: unknown): string {
  if (value === null || value === undefined || value === '') return '';
  switch (field.type) {
    case 'password':
    case 'pinCode':
      return '••••••';
    case 'signature':
      return '已签署';
    case 'attachment':
    case 'image':
      return Array.isArray(value) ? value.map((file) => file && typeof file === 'object' && 'name' in file ? String(file.name) : '').filter(Boolean).join('、') : '';
    case 'switch':
      return value ? '是' : '否';
    case 'multiSelect':
    case 'checkbox':
    case 'tags':
      return Array.isArray(value) ? value.map((v) => readOnlyOptionLabel(field, String(v))).join('、') : String(value);
    case 'select':
    case 'radio':
      return readOnlyOptionLabel(field, String(value));
    case 'dateRange':
      return Array.isArray(value) ? value.filter(Boolean).join(' ~ ') : String(value);
    case 'amount':
    case 'number':
    case 'formula': {
      if (typeof value !== 'number' && (typeof value !== 'string' || !value.trim() || !Number.isFinite(Number(value)))) return String(value);
      const num = typeof value === 'number' ? value : Number(value);
      const precision = field.precision ?? (field.type === 'number' ? undefined : 2);
      return Number.isFinite(num) ? num.toLocaleString('zh-CN', {
        minimumFractionDigits: precision,
        maximumFractionDigits: precision ?? 20,
      }) : String(value);
    }
    default:
      return typeof value === 'object' ? JSON.stringify(value) : String(value);
  }
}

export function readOnlyFieldLabel(field: WorkflowFormField): string {
  if (field.type === 'amount') {
    const currencyLabel = CURRENCY_OPTIONS.find(c => c.value === (field.currency ?? 'CNY'))?.label ?? 'CNY';
    const suffix = field.unit ? ` · ${field.unit}` : '';
    return `${field.label}（${currencyLabel}${suffix}）`;
  }
  if (field.unit) return `${field.label}（${field.unit}）`;
  return field.label;
}
