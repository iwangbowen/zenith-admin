/**
 * 工作流表单运行时求值（前后端共享的纯函数）。
 *
 * 放在 shared 是为了让「前端表单渲染 / 后端发起校验 / MSW Mock」对
 * 字段显隐、条件必填的判定保持**完全一致**，避免服务端校验与前端渲染产生偏差。
 * 求值语义与 packages/web WorkflowFormRenderer 的运行时行为一一对应。
 */
import type {
  WorkflowFieldPermission,
  WorkflowFieldVisibilityCondition,
  WorkflowFieldVisibilityRule,
  WorkflowFieldVisibilityRuleGroup,
  WorkflowFormField,
  WorkflowFormFieldCompareRule,
} from './types';
import { evalFormula } from './workflow-formula';

const toComparableStr = (v: unknown): string => {
  if (v === null || v === undefined) return '';
  if (typeof v === 'object') return JSON.stringify(v);
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  return '';
};

/** 表单值是否为空（undefined / null / 空串 / 空数组） */
export const isWorkflowFormValueEmpty = (v: unknown): boolean =>
  v === undefined || v === null || v === '' || (Array.isArray(v) && v.length === 0);

/** 规则条目是否为嵌套子组 */
export const isWorkflowRuleGroup = (rule: WorkflowFieldVisibilityRule | null | undefined): rule is WorkflowFieldVisibilityRuleGroup =>
  !!rule && typeof rule === 'object' && 'logic' in rule && Array.isArray((rule as WorkflowFieldVisibilityRuleGroup).rules);

/** 展平规则组内的全部叶子条件（含嵌套子组），供依赖分析/校验/重命名复用 */
export function collectWorkflowRuleConditions(group: WorkflowFieldVisibilityRuleGroup | null | undefined): WorkflowFieldVisibilityCondition[] {
  if (!group?.rules) return [];
  const out: WorkflowFieldVisibilityCondition[] = [];
  for (const rule of group.rules) {
    if (isWorkflowRuleGroup(rule)) out.push(...collectWorkflowRuleConditions(rule));
    else if (rule) out.push(rule);
  }
  return out;
}

/** 单条显隐/必填条件求值 */
export function evalWorkflowFieldCondition(cond: WorkflowFieldVisibilityCondition, values: Record<string, unknown>): boolean {
  if (!cond?.field) return true;
  const left = values[cond.field];
  const right = cond.value;
  switch (cond.operator) {
    case 'eq': return left === right || toComparableStr(left) === toComparableStr(right);
    case 'neq': return left !== right && toComparableStr(left) !== toComparableStr(right);
    case 'in': {
      const arr = Array.isArray(right)
        ? right
        : (typeof right === 'string' ? right.split(',').map(s => s.trim()).filter(Boolean) : []);
      return arr.map(toComparableStr).includes(toComparableStr(left));
    }
    case 'contains': return Array.isArray(left) && left.map(toComparableStr).includes(toComparableStr(right));
    case 'gt': return Number(left) > Number(right);
    case 'lt': return Number(left) < Number(right);
    case 'gte': return Number(left) >= Number(right);
    case 'lte': return Number(left) <= Number(right);
    case 'isEmpty': return isWorkflowFormValueEmpty(left);
    case 'notEmpty': return !isWorkflowFormValueEmpty(left);
    default: return true;
  }
}

/** 条件组求值（and/or；空组恒真；子组递归求值，空子组视为真） */
export function evalWorkflowFieldRuleGroup(group: WorkflowFieldVisibilityRuleGroup, values: Record<string, unknown>): boolean {
  const rules = group.rules?.filter((r) => (isWorkflowRuleGroup(r) ? true : r?.field)) ?? [];
  if (rules.length === 0) return true;
  const evalOne = (rule: WorkflowFieldVisibilityRule): boolean =>
    isWorkflowRuleGroup(rule)
      ? evalWorkflowFieldRuleGroup(rule, values)
      : evalWorkflowFieldCondition(rule, values);
  return group.logic === 'or'
    ? rules.some(evalOne)
    : rules.every(evalOne);
}

/** 字段在当前表单值下是否可见（高级联动 > 默认隐藏 > 旧版单条件） */
export function isWorkflowFieldVisible(field: WorkflowFormField, values: Record<string, unknown>): boolean {
  if (field.visibilityRules && (field.visibilityRules.rules?.length ?? 0) > 0) {
    return evalWorkflowFieldRuleGroup(field.visibilityRules, values);
  }
  if (field.hidden) return false;
  if (field.visibilityCondition?.field) {
    return evalWorkflowFieldCondition(field.visibilityCondition, values);
  }
  return true;
}

/** 字段在当前表单值下是否必填（静态 required 或 requiredRules 条件满足） */
export function isWorkflowFieldRequired(field: WorkflowFormField, values: Record<string, unknown>): boolean {
  if (field.required) return true;
  if (field.requiredRules && (field.requiredRules.rules?.length ?? 0) > 0) {
    return evalWorkflowFieldRuleGroup(field.requiredRules, values);
  }
  return false;
}

/** 布局/展示类字段：无输入值，不参与必填校验 */
const NON_INPUT_FIELD_TYPES = new Set(['row', 'tabs', 'steps', 'group', 'divider', 'description']);

/**
 * 服务端发起必填校验：收集「可见、可编辑且必填但值为空」的字段 label。
 *
 * 与前端渲染语义一致的跳过规则：
 * - 布局/说明字段不参与；
 * - 不可见字段（显隐联动 / 默认隐藏 / 容器整体隐藏）不强制；
 * - `perms`（start 节点字段权限）标记 hidden/read 的字段由服务端剔除输入，不参与必填；
 * - formula/serialNumber 由系统生成，不参与；
 * - detail 明细校验自身必填（至少一行），子字段行级校验暂不下钻。
 */
export function collectMissingRequiredFields(
  fields: WorkflowFormField[],
  values: Record<string, unknown>,
  perms?: Record<string, WorkflowFieldPermission> | null,
): string[] {
  return collectWorkflowFormValidationErrors(fields, values, perms)
    .filter((e) => e.kind === 'required')
    .map((e) => e.label);
}

// ─── 全量校验（必填之外的规则：长度/范围/正则/日期限制/比较/校验公式/明细行级）────

export type WorkflowFormValidationKind =
  | 'required' | 'length' | 'range' | 'pattern' | 'dateLimit' | 'compare' | 'formula' | 'detail';

export interface WorkflowFormValidationError {
  kind: WorkflowFormValidationKind;
  /** 字段 key（明细行级错误为明细字段 key） */
  key: string;
  label: string;
  /** 完整的可读错误信息 */
  message: string;
}

const toNumber = (v: unknown): number => (typeof v === 'number' ? v : Number(v));

/** 日期比较用时间戳（无效返回 NaN）；数字比较直接 Number */
const toComparable = (v: unknown, isDate: boolean): number => {
  if (isDate) {
    const t = new Date(String(v)).getTime();
    return Number.isFinite(t) ? t : NaN;
  }
  return toNumber(v);
};

/** 跨字段比较（与前端 evalCompare 同语义：空值/数组/不可比较时放行） */
function evalCompareRule(op: WorkflowFormFieldCompareRule['operator'], a: unknown, b: unknown, isDate: boolean): boolean {
  if (a === null || a === undefined || a === '' || b === null || b === undefined || b === '') return true;
  if (Array.isArray(a) || Array.isArray(b)) return true;
  const x = toComparable(a, isDate);
  const y = toComparable(b, isDate);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return true;
  switch (op) {
    case 'gt': return x > y;
    case 'gte': return x >= y;
    case 'lt': return x < y;
    case 'lte': return x <= y;
    case 'eq': return x === y;
    case 'neq': return x !== y;
    default: return true;
  }
}

const COMPARE_OP_TEXT: Record<WorkflowFormFieldCompareRule['operator'], string> = {
  gt: '大于', gte: '大于等于', lt: '小于', lte: '小于等于', eq: '等于', neq: '不等于',
};

/** 校验公式求值：结果为真通过；不可计算（null）不阻塞 */
function passesValidationFormula(expr: string, ctx: Record<string, unknown>): boolean {
  const res = evalFormula(expr, ctx, 6);
  if (res === null) return true;
  return typeof res === 'number' ? res !== 0 : Boolean(res);
}

/** 单个标量字段的规则校验（不含必填；调用方保证可见/可编辑） */
function validateScalarField(
  f: WorkflowFormField,
  value: unknown,
  values: Record<string, unknown>,
  push: (kind: WorkflowFormValidationKind, message: string) => void,
): void {
  const label = f.label || f.key;
  // 长度（文本类）
  if (typeof value === 'string' && value !== '') {
    if (f.minLength !== undefined && value.length < f.minLength) {
      push('length', `${label}最少${f.minLength}个字符`);
    }
    if (f.maxLength !== undefined && value.length > f.maxLength) {
      push('length', `${label}最多${f.maxLength}个字符`);
    }
    if (f.pattern) {
      try {
        if (!new RegExp(f.pattern).test(value)) {
          push('pattern', f.patternMessage ? `${label}：${f.patternMessage}` : `${label}格式不正确`);
        }
      } catch { /* 无效正则不阻塞（体检已提示） */ }
    }
  }
  // 数值范围
  if (value !== undefined && value !== null && value !== '' && (f.type === 'number' || f.type === 'amount' || f.type === 'slider')) {
    const n = toNumber(value);
    if (Number.isFinite(n)) {
      if (f.min !== undefined && n < f.min) push('range', `${label}不小于${f.min}`);
      if (f.max !== undefined && n > f.max) push('range', `${label}不大于${f.max}`);
    }
  }
  // 日期可选范围
  if ((f.type === 'date' || f.type === 'dateRange') && f.dateLimit && f.dateLimit !== 'none') {
    const dates = (Array.isArray(value) ? value : [value])
      .filter((d): d is string => typeof d === 'string' && d !== '')
      .map((d) => new Date(d).getTime())
      .filter((t) => Number.isFinite(t));
    if (dates.length > 0) {
      const startOfToday = new Date(new Date().toDateString()).getTime();
      const endOfToday = startOfToday + 24 * 60 * 60 * 1000 - 1;
      for (const t of dates) {
        if (f.dateLimit === 'noPast' && t < startOfToday) push('dateLimit', `${label}不可选择过去的日期`);
        else if (f.dateLimit === 'noFuture' && t > endOfToday) push('dateLimit', `${label}不可选择未来的日期`);
        else if (f.dateLimit === 'custom') {
          if (f.minDate && t < new Date(f.minDate).getTime()) push('dateLimit', `${label}不可早于${f.minDate}`);
          if (f.maxDate && t > new Date(f.maxDate).getTime() + 24 * 60 * 60 * 1000 - 1) push('dateLimit', `${label}不可晚于${f.maxDate}`);
        }
      }
    }
  }
  // 跨字段比较
  if (f.compareRules?.length) {
    const isDate = f.type === 'date' || f.type === 'dateRange';
    for (const cr of f.compareRules) {
      if (!evalCompareRule(cr.operator, value, values[cr.field], isDate)) {
        push('compare', cr.message ? `${label}：${cr.message}` : `${label}需${COMPARE_OP_TEXT[cr.operator]}目标字段`);
      }
    }
  }
  // 自定义校验公式
  if (f.validationFormula?.trim() && !passesValidationFormula(f.validationFormula, { ...values, [f.key]: value })) {
    push('formula', f.validationMessage ? `${label}：${f.validationMessage}` : `${label}不满足校验条件`);
  }
}

/** 明细字段的行级校验（行必填/列唯一/行内校验公式；行内显隐字段跳过） */
function validateDetailField(
  f: WorkflowFormField,
  value: unknown,
  push: (kind: WorkflowFormValidationKind, message: string) => void,
): void {
  const label = f.label || f.key;
  if (!Array.isArray(value)) return;
  const rows = value.filter((r): r is Record<string, unknown> => r != null && typeof r === 'object');
  const children = f.children ?? [];

  const requiredChildren = children.filter((c) => c.required);
  for (const row of rows) {
    for (const c of requiredChildren) {
      if (!isWorkflowFieldVisible(c, row)) continue;
      if (isWorkflowFormValueEmpty(row[c.key])) {
        push('detail', `${label}存在必填子项「${c.label || c.key}」未填写`);
        break;
      }
    }
  }

  for (const uc of children.filter((c) => c.unique)) {
    const seen = new Set<string>();
    for (const row of rows) {
      const cell = row[uc.key];
      if (cell === undefined || cell === null || cell === '') continue;
      const k = String(cell);
      if (seen.has(k)) {
        push('detail', `${label}「${uc.label || uc.key}」列存在重复值`);
        break;
      }
      seen.add(k);
    }
  }

  for (const vc of children.filter((c) => c.validationFormula?.trim())) {
    const bad = rows.some((row) => isWorkflowFieldVisible(vc, row) && !passesValidationFormula(vc.validationFormula ?? '', row));
    if (bad) {
      push('detail', vc.validationMessage
        ? `${label}「${vc.label || vc.key}」列：${vc.validationMessage}`
        : `${label}「${vc.label || vc.key}」列存在不满足校验条件的行`);
    }
  }
}

/**
 * 服务端发起全量校验：与前端渲染器同源语义，收集所有校验错误。
 *
 * 覆盖：必填（含条件必填）、文本长度、正则、数值范围、日期可选范围、
 * 跨字段比较、自定义校验公式、明细行级（行必填/列唯一/行内校验公式）。
 *
 * 跳过规则与 {@link collectMissingRequiredFields} 一致：不可见字段、
 * perms hidden/read 字段、readOnly、布局/展示类、formula/serialNumber 不参与。
 */
export function collectWorkflowFormValidationErrors(
  fields: WorkflowFormField[],
  values: Record<string, unknown>,
  perms?: Record<string, WorkflowFieldPermission> | null,
): WorkflowFormValidationError[] {
  const errors: WorkflowFormValidationError[] = [];
  const walk = (list: WorkflowFormField[]): void => {
    for (const f of list) {
      if (!isWorkflowFieldVisible(f, values)) continue;
      const perm = perms?.[f.key];
      if (perm === 'hidden' || perm === 'read') continue;
      if (f.type === 'row' && f.columns) {
        for (const col of f.columns) walk(col.fields);
        continue;
      }
      if ((f.type === 'tabs' || f.type === 'steps') && f.panes) {
        for (const pane of f.panes) walk(pane.fields);
        continue;
      }
      if (f.type === 'group' && f.children) {
        walk(f.children);
        continue;
      }
      if (NON_INPUT_FIELD_TYPES.has(f.type)) continue;
      if (f.type === 'formula' || f.type === 'serialNumber') continue;
      if (f.readOnly) continue;

      const label = f.label || f.key;
      const value = values[f.key];
      const push = (kind: WorkflowFormValidationKind, message: string) =>
        errors.push({ kind, key: f.key, label, message });

      if (isWorkflowFieldRequired(f, values) && isWorkflowFormValueEmpty(value)) {
        push('required', `请填写${label}`);
      }
      if (f.type === 'detail') {
        validateDetailField(f, value, push);
        continue;
      }
      validateScalarField(f, value, values, push);
    }
  };
  walk(fields);
  return errors;
}
