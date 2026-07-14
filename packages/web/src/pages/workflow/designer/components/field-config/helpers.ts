// ─── 字段配置面板纯工具函数与常量（拆分自 FieldConfigPanel.tsx）───
import { pinyin } from 'pinyin-pro';
import type { WorkflowFormField, WorkflowFormFieldType, WorkflowFormFieldOptionItem } from '@zenith/shared';
import { evalFormula } from '../../form-formula';
import { flattenAllFields } from '../../form-tree';
import { findValueDependencyCycles } from '../../form-graph';

export const FIELD_KEY_PATTERN = /^[A-Za-z][A-Za-z0-9_]*$/;

// 动态默认值占位符（发起时按登录用户/部门/时间解析）
export const DYNAMIC_DEFAULT_TOKENS: Array<{ token: string; label: string }> = [
  { token: '${currentUser}', label: '当前用户姓名' },
  { token: '${currentUserId}', label: '当前用户ID' },
  { token: '${currentDept}', label: '当前部门名称' },
  { token: '${currentDeptId}', label: '当前部门ID' },
  { token: '${today}', label: '今天（日期）' },
  { token: '${now}', label: '现在（日期时间）' },
];

// 根据字段名称生成可读 key：中文转拼音（无声调），非中文连续保留，输出 camelCase
export function slugifyToKey(label: string, fallbackType: string): string {
  const source = (label ?? '').trim();
  const py = source
    ? pinyin(source, { toneType: 'none', type: 'string', nonZh: 'consecutive', v: true })
    : '';
  const parts = py.split(/[^A-Za-z0-9]+/).filter(Boolean);
  let key = parts
    .map((p, i) => (i === 0 ? p.toLowerCase() : p.charAt(0).toUpperCase() + p.slice(1).toLowerCase()))
    .join('');
  // 必须以字母开头
  if (!FIELD_KEY_PATTERN.test(key)) {
    const suffix = key ? key.charAt(0).toUpperCase() + key.slice(1) : '';
    key = `${fallbackType}${suffix}`;
  }
  return key || fallbackType || 'field';
}

// 追加数字后缀确保唯一
export function uniqueKey(base: string, taken: Set<string>): string {
  if (!taken.has(base)) return base;
  let n = 2;
  while (taken.has(`${base}${n}`)) n += 1;
  return `${base}${n}`;
}

export function formatVisibilityValue(value: unknown): string {
  if (typeof value === 'string') {
    return value;
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  return '';
}

export function regexError(pattern?: string): string | null {
  if (!pattern) return null;
  try {
    new RegExp(pattern);
    return null;
  } catch (error) {
    return error instanceof Error ? error.message : '正则表达式无效';
  }
}

export function formulaError(formula: string | undefined, fields: WorkflowFormField[], currentKey: string): string | null {
  const expr = formula?.trim();
  if (!expr) return null;
  const refs = Array.from(expr.matchAll(/\{([^}]+)\}/g), (match) => match[1]?.trim())
    .filter((key): key is string => Boolean(key));
  const keys = new Set(fields.map((field) => field.key));
  // 明细列引用 {明细key.列key} 取点号前的字段 key 校验
  const unknown = refs.filter((key) => {
    const base = key.split('.')[0];
    return base !== currentKey && !keys.has(base);
  });
  if (unknown.length > 0) return `引用字段不存在：${unknown.join('、')}`;
  const sampleValues = Object.fromEntries(refs.map((key) => [key, 1]));
  return evalFormula(expr, sampleValues, 2) === null ? '公式表达式无效，请检查函数与括号是否匹配' : null;
}

/** 当前字段是否处于值联动循环依赖中（公式/天数/赋值边成环），返回可读的环路径提示 */
export function formulaCycleError(fields: WorkflowFormField[], currentKey: string): string | null {
  const cycle = findValueDependencyCycles(fields).find((c) => c.includes(currentKey));
  if (!cycle) return null;
  const labelOf = (key: string) => flattenAllFields(fields).find((f) => f.key === key)?.label || key;
  return `存在循环依赖：${cycle.map(labelOf).join(' → ')}，请调整引用关系`;
}

export function createsCascadeCycle(fieldKey: string, sourceKey: string, fields: WorkflowFormField[]): boolean {
  const byKey = new Map(fields.map((field) => [field.key, field]));
  const visited = new Set<string>([fieldKey]);
  let cursor: string | undefined = sourceKey;
  while (cursor) {
    if (visited.has(cursor)) return true;
    visited.add(cursor);
    cursor = byKey.get(cursor)?.optionsFrom?.sourceKey;
  }
  return false;
}

export function createLocalFieldKey(type: WorkflowFormFieldType): string {
  const random = globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2, 10);
  return `${type}_${Date.now()}_${random.replace(/-/g, '').slice(0, 8)}`;
}

// ─── 显隐联动规则编辑器（多条件 and/or） ──────────────────────────────

// 可作为显隐条件依赖的字段类型
export const CONDITION_FIELD_TYPES = new Set<WorkflowFormFieldType>([
  'text', 'textarea', 'number', 'amount', 'slider', 'nps',
  'select', 'multiSelect', 'radio', 'checkbox', 'switch', 'dictSelect', 'cascader',
  'date', 'dateRange',
]);

const VISIBILITY_OP = {
  eq: { value: 'eq', label: '等于' },
  neq: { value: 'neq', label: '不等于' },
  in: { value: 'in', label: '包含在' },
  contains: { value: 'contains', label: '包含' },
  gt: { value: 'gt', label: '大于' },
  lt: { value: 'lt', label: '小于' },
  gte: { value: 'gte', label: '大于等于' },
  lte: { value: 'lte', label: '小于等于' },
  isEmpty: { value: 'isEmpty', label: '为空' },
  notEmpty: { value: 'notEmpty', label: '不为空' },
} as const;

export const NO_VALUE_OPERATORS = new Set<string>(['isEmpty', 'notEmpty']);

// 按依赖字段类型给出合适的操作符
export function operatorsForField(f: WorkflowFormField | undefined) {
  switch (f?.type) {
    case 'number': case 'amount': case 'slider': case 'nps':
      return [VISIBILITY_OP.eq, VISIBILITY_OP.neq, VISIBILITY_OP.gt, VISIBILITY_OP.lt, VISIBILITY_OP.gte, VISIBILITY_OP.lte, VISIBILITY_OP.isEmpty, VISIBILITY_OP.notEmpty];
    case 'multiSelect': case 'checkbox': case 'cascader':
      return [VISIBILITY_OP.contains, VISIBILITY_OP.isEmpty, VISIBILITY_OP.notEmpty];
    case 'select': case 'radio': case 'dictSelect':
      return [VISIBILITY_OP.eq, VISIBILITY_OP.neq, VISIBILITY_OP.in, VISIBILITY_OP.isEmpty, VISIBILITY_OP.notEmpty];
    case 'switch':
      return [VISIBILITY_OP.eq, VISIBILITY_OP.neq];
    default:
      return [VISIBILITY_OP.eq, VISIBILITY_OP.neq, VISIBILITY_OP.in, VISIBILITY_OP.isEmpty, VISIBILITY_OP.notEmpty];
  }
}

// ─── 选项编辑器（增强：value/label/颜色/禁用） ───────────────────────

export function deriveOptionItems(field: WorkflowFormField): WorkflowFormFieldOptionItem[] {
  if (field.optionItems?.length) return field.optionItems;
  return (field.options ?? []).map((v) => ({ value: v }));
}

// ─── dateRange → 天数 联动配置 ────────────────────────────────────

/** 展平所有层级字段（分栏列/分组/明细子字段/标签页与分步面板），供条件与联动选择器使用 */
export const collectFlat = flattenAllFields;

// ─── select 联动赋值：选中某选项时自动填充其它字段 ──────────────────

export const AUTOFILL_EXCLUDE = new Set<WorkflowFormFieldType>(['row', 'group', 'divider', 'description', 'detail']);
