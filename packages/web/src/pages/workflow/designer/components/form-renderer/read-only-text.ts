/**
 * 只读文本渲染（查看态）的纯函数部分。
 * 详情/审批查看场景下，简单值字段渲染为纯文本而非 disabled 输入框：
 * 可读性（灰字对比度）、可复制性、打印与无障碍朗读都优于禁用态控件。
 * 复杂类型（附件/图片/签名/明细/富文本/级联/人员部门等）保持原控件的禁用态展示。
 */
import type { WorkflowFormField } from '@zenith/shared/workflow';
import { CURRENCY_OPTIONS } from '../../form-types';

export const READONLY_TEXT_TYPES = new Set<string>([
  'text', 'textarea', 'number', 'amount', 'phone', 'email', 'idCard', 'url',
  'date', 'time', 'dateRange', 'select', 'multiSelect', 'radio', 'checkbox',
  'switch', 'slider', 'rate', 'nps', 'tags', 'autoComplete',
]);

function readOnlyOptionLabel(field: WorkflowFormField, value: string): string {
  const item = field.optionItems?.find((it) => it.value === value);
  return item?.label ?? value;
}

export function formatReadOnlyValue(field: WorkflowFormField, value: unknown): string {
  if (value === null || value === undefined || value === '') return '';
  switch (field.type) {
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
    case 'amount': {
      const num = typeof value === 'number' ? value : Number(value);
      return Number.isFinite(num) ? num.toLocaleString('zh-CN') : String(value);
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
