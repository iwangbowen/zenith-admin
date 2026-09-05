/**
 * 字段校验规则构建：静态 required / 长度 / 正则 / 数值范围，叠加条件必填、跨字段比较与自定义校验公式。
 * 规则对象直接交给 Semi Form 字段的 `rules`，validator 闭包捕获调用时的表单值快照。
 */
import type { WorkflowFormField } from '@zenith/shared/workflow';
import { evalWorkflowFieldRuleGroup as evalRuleGroup, isWorkflowFieldVisible as isFieldVisible } from '@zenith/shared/workflow';
import { evalFormula } from '../../form-formula';
import { COMPARE_OP_TEXT, evalCompare } from './field-utils';

export type FieldRule = Record<string, unknown>;

export interface FieldRuleSet {
  /** 静态必填 或 条件必填规则命中 */
  dynamicRequired: boolean;
  /** 条件只读规则命中（叠加静态 readOnly） */
  dynamicReadOnly: boolean;
  /** 文本类字段规则：required / 长度 / 正则 / 比较 / 公式；为空时 undefined */
  rules: FieldRule[] | undefined;
  /** 数值类字段规则：required / min / max / 比较 / 公式；为空时 undefined */
  numberRules: FieldRule[] | undefined;
}

/** 仅必填规则（手机号 / 邮箱 / 身份证 / 网址等自带格式校验的字段在其后追加 pattern） */
export function requiredRules(field: WorkflowFormField, dynamicRequired: boolean): FieldRule[] {
  return dynamicRequired ? [{ required: true, message: `请填写${field.label}` }] : [];
}

export function buildFieldRules(field: WorkflowFormField, values: Record<string, unknown>): FieldRuleSet {
  // 条件必填 / 条件只读：满足规则时动态生效（叠加静态 required/readOnly）
  const dynamicRequired = field.required || (!!field.requiredRules?.rules?.length && evalRuleGroup(field.requiredRules, values));
  const dynamicReadOnly = !!field.readOnlyRules?.rules?.length && evalRuleGroup(field.readOnlyRules, values);
  const baseRules: FieldRule[] = [];
  if (dynamicRequired) baseRules.push({ required: true, message: `请填写${field.label}` });
  if (field.minLength !== undefined) baseRules.push({ type: 'string', minLength: field.minLength, message: `最少${field.minLength}个字符` });
  if (field.maxLength !== undefined) baseRules.push({ type: 'string', maxLength: field.maxLength, message: `最多${field.maxLength}个字符` });
  if (field.pattern) {
    try {
      baseRules.push({ pattern: new RegExp(field.pattern), message: field.patternMessage ?? '格式不正确' });
    } catch { /* invalid regex */ }
  }
  const numberRules: FieldRule[] = [];
  if (dynamicRequired) numberRules.push({ required: true, message: `请填写${field.label}` });
  if (field.min !== undefined) numberRules.push({ type: 'number', min: field.min, message: `不小于${field.min}` });
  if (field.max !== undefined) numberRules.push({ type: 'number', max: field.max, message: `不大于${field.max}` });
  // 跨字段比较校验（number/amount/date）
  if (field.compareRules?.length) {
    const isDateField = field.type === 'date' || field.type === 'dateRange';
    for (const cr of field.compareRules) {
      const message = cr.message || `需${COMPARE_OP_TEXT[cr.operator]}目标字段`;
      const validator = (_r: unknown, value: unknown, _cb: unknown, source?: Record<string, unknown>) => {
        const other = source && typeof source === 'object' && cr.field in source ? source[cr.field] : values[cr.field];
        return evalCompare(cr.operator, value, other, isDateField);
      };
      baseRules.push({ validator, message });
      numberRules.push({ validator, message });
    }
  }
  // 自定义校验公式：结果为真通过（公式不可计算时不阻塞提交）
  if (field.validationFormula?.trim()) {
    const vf = field.validationFormula;
    const message = field.validationMessage || `${field.label}不满足校验条件`;
    const validator = (_r: unknown, value: unknown, _cb: unknown, source?: Record<string, unknown>) => {
      const ctx = { ...values, ...(source && typeof source === 'object' ? source : {}), [field.key]: value };
      const res = evalFormula(vf, ctx, 6);
      if (res === null) return true;
      return typeof res === 'number' ? res !== 0 : Boolean(res);
    };
    baseRules.push({ validator, message });
    numberRules.push({ validator, message });
  }
  return {
    dynamicRequired,
    dynamicReadOnly,
    rules: baseRules.length > 0 ? baseRules : undefined,
    numberRules: numberRules.length > 0 ? numberRules : undefined,
  };
}

/** 明细 / 子表规则：至少一行、行内必填子项、行内校验公式、列值唯一 */
export function buildDetailRules(field: WorkflowFormField, children: WorkflowFormField[], dynamicRequired: boolean): FieldRule[] | undefined {
  const requiredChildren = children.filter(c => c.required);
  const detailRules: FieldRule[] = [];
  if (dynamicRequired) {
    detailRules.push({ validator: (_r: unknown, v: unknown) => Array.isArray(v) && v.length > 0, message: `请至少添加一行${field.label}` });
  }
  if (requiredChildren.length > 0) {
    detailRules.push({
      validator: (_r: unknown, v: unknown) =>
        Array.isArray(v) && v.every((row) => requiredChildren.every((c) => {
          // 行内被显隐规则隐藏的列不参与必填
          if (!isFieldVisible(c, row as Record<string, unknown>)) return true;
          const cell = (row as Record<string, unknown>)[c.key];
          return cell !== undefined && cell !== null && cell !== '';
        })),
      message: `${field.label}存在必填子项未填写`,
    });
  }
  // 行内校验公式（引用同行列，结果为真通过）
  const formulaChildren = children.filter((c) => c.validationFormula?.trim());
  for (const vc of formulaChildren) {
    const vf = vc.validationFormula ?? '';
    detailRules.push({
      validator: (_r: unknown, v: unknown) =>
        !Array.isArray(v) || v.every((row) => {
          const ctx = row as Record<string, unknown>;
          if (!isFieldVisible(vc, ctx)) return true;
          const res = evalFormula(vf, ctx, 6);
          if (res === null) return true;
          return typeof res === 'number' ? res !== 0 : Boolean(res);
        }),
      message: vc.validationMessage || `${field.label}「${vc.label}」列存在不满足校验条件的行`,
    });
  }
  const uniqueChildren = children.filter(c => c.unique);
  for (const uc of uniqueChildren) {
    detailRules.push({
      validator: (_r: unknown, v: unknown) => {
        if (!Array.isArray(v)) return true;
        const seen = new Set<string>();
        for (const row of v) {
          const cell = (row as Record<string, unknown>)[uc.key];
          if (cell === undefined || cell === null || cell === '') continue;
          const k = String(cell);
          if (seen.has(k)) return false;
          seen.add(k);
        }
        return true;
      },
      message: `${field.label}「${uc.label}」列存在重复值`,
    });
  }
  return detailRules.length > 0 ? detailRules : undefined;
}
