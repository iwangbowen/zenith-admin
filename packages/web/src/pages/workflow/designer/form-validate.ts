/**
 * 表单 schema 体检：保存前/设计中统一校验，汇总空标签、重复 key、空选项、
 * 区间非法、无效正则、孤儿依赖、公式错误等问题。供保存阻断与体检面板复用。
 */
import type { WorkflowFormField, WorkflowFormFieldType } from '@zenith/shared';
import { flattenAllFields, formulaReferencesKey } from './form-tree';
import { evalFormula } from './form-formula';
import { findValueDependencyCycles } from './form-graph';

export interface FormIssue {
  level: 'error' | 'warning';
  fieldKey?: string;
  fieldLabel?: string;
  message: string;
}

const OPTION_TYPES = new Set<WorkflowFormFieldType>(['select', 'multiSelect', 'radio', 'checkbox', 'autoComplete']);

export function validateFormSchema(fields: WorkflowFormField[]): FormIssue[] {
  const issues: FormIssue[] = [];
  const all = flattenAllFields(fields);
  const keys = new Set(all.map((f) => f.key));

  const keyCount = new Map<string, number>();
  for (const f of all) keyCount.set(f.key, (keyCount.get(f.key) ?? 0) + 1);

  if (fields.length === 0) {
    issues.push({ level: 'warning', message: '表单还没有任何字段' });
  }

  const reportedDupKeys = new Set<string>();

  for (const f of all) {
    const label = f.label || f.key;

    if (!f.label?.trim() && f.type !== 'divider') {
      issues.push({ level: 'error', fieldKey: f.key, fieldLabel: label, message: '字段名称为空' });
    }

    if ((keyCount.get(f.key) ?? 0) > 1 && !reportedDupKeys.has(f.key)) {
      reportedDupKeys.add(f.key);
      issues.push({ level: 'error', fieldKey: f.key, fieldLabel: label, message: `字段 key 重复：${f.key}` });
    }

    if (OPTION_TYPES.has(f.type) && !f.dataSourceId) {
      const opts = (f.options ?? []).map((o) => o.trim()).filter(Boolean);
      if (opts.length === 0) {
        issues.push({ level: 'error', fieldKey: f.key, fieldLabel: label, message: '选项为空' });
      } else if (new Set(opts).size !== opts.length) {
        issues.push({ level: 'warning', fieldKey: f.key, fieldLabel: label, message: '存在重复选项' });
      }
    }

    if (f.min !== undefined && f.max !== undefined && f.min > f.max) {
      issues.push({ level: 'error', fieldKey: f.key, fieldLabel: label, message: '最小值大于最大值' });
    }
    if (f.minLength !== undefined && f.maxLength !== undefined && f.minLength > f.maxLength) {
      issues.push({ level: 'error', fieldKey: f.key, fieldLabel: label, message: '最小长度大于最大长度' });
    }

    if (f.pattern) {
      try { new RegExp(f.pattern); } catch { issues.push({ level: 'error', fieldKey: f.key, fieldLabel: label, message: '正则表达式无效' }); }
    }

    const refKeys: string[] = [];
    if (f.visibilityCondition?.field) refKeys.push(f.visibilityCondition.field);
    if (f.visibilityRules?.rules) for (const r of f.visibilityRules.rules) if (r.field) refKeys.push(r.field);
    if (f.requiredRules?.rules) for (const r of f.requiredRules.rules) if (r.field) refKeys.push(r.field);
    if (f.readOnlyRules?.rules) for (const r of f.readOnlyRules.rules) if (r.field) refKeys.push(r.field);
    for (const rk of refKeys) {
      if (!keys.has(rk)) issues.push({ level: 'error', fieldKey: f.key, fieldLabel: label, message: `联动条件引用了不存在的字段：${rk}` });
    }

    if (f.optionsFrom?.sourceKey && !keys.has(f.optionsFrom.sourceKey)) {
      issues.push({ level: 'error', fieldKey: f.key, fieldLabel: label, message: `级联父字段不存在：${f.optionsFrom.sourceKey}` });
    }

    if (f.autoFill) {
      for (const t of f.autoFill.targets) {
        if (!keys.has(t)) issues.push({ level: 'error', fieldKey: f.key, fieldLabel: label, message: `联动赋值目标字段不存在：${t}` });
      }
    }

    if (f.daysFromKey && !keys.has(f.daysFromKey)) {
      issues.push({ level: 'error', fieldKey: f.key, fieldLabel: label, message: `天数联动来源字段不存在：${f.daysFromKey}` });
    }

    if (f.type === 'formula') {
      if (!f.formula?.trim()) {
        issues.push({ level: 'warning', fieldKey: f.key, fieldLabel: label, message: '公式为空' });
      } else {
        const refs = Array.from(f.formula.matchAll(/\{([^}]+)\}/g), (m) => m[1].trim());
        // 明细列引用 {明细key.列key} 取点号前的字段 key 校验存在性
        const unknown = refs.filter((rk) => {
          const base = rk.split('.')[0];
          return base !== f.key && !keys.has(base);
        });
        if (unknown.length > 0) {
          issues.push({ level: 'error', fieldKey: f.key, fieldLabel: label, message: `公式引用不存在的字段：${unknown.join('、')}` });
        } else {
          const sample = Object.fromEntries(refs.map((rk) => [rk, 1]));
          if (evalFormula(f.formula, sample, 2) === null) {
            issues.push({ level: 'error', fieldKey: f.key, fieldLabel: label, message: '公式表达式无效' });
          }
        }
      }
    }
    // 标记公式引用自身（无意义）
    if (f.type === 'formula' && f.formula && formulaReferencesKey(f.formula, f.key)) {
      issues.push({ level: 'warning', fieldKey: f.key, fieldLabel: label, message: '公式引用了自身' });
    }

    // 跨字段比较校验：目标字段必须存在且不能是自身
    if (f.compareRules?.length) {
      for (const cr of f.compareRules) {
        if (!cr.field) {
          issues.push({ level: 'warning', fieldKey: f.key, fieldLabel: label, message: '比较校验未选择目标字段' });
        } else if (cr.field === f.key) {
          issues.push({ level: 'error', fieldKey: f.key, fieldLabel: label, message: '比较校验不能引用字段自身' });
        } else if (!keys.has(cr.field)) {
          issues.push({ level: 'error', fieldKey: f.key, fieldLabel: label, message: `比较校验引用了不存在的字段：${cr.field}` });
        }
      }
    }

    // 自定义日期范围：最早不得晚于最晚
    if (f.dateLimit === 'custom' && f.minDate && f.maxDate && f.minDate > f.maxDate) {
      issues.push({ level: 'error', fieldKey: f.key, fieldLabel: label, message: '最早可选日期晚于最晚可选日期' });
    }

    // tabs / steps 容器至少保留一个面板
    if ((f.type === 'tabs' || f.type === 'steps') && (f.panes?.length ?? 0) === 0) {
      issues.push({ level: 'warning', fieldKey: f.key, fieldLabel: label, message: '容器没有任何面板' });
    }
  }

  // 值联动循环依赖（公式/天数/赋值互相触发重算，运行时会震荡）
  const labelOf = (key: string) => all.find((f) => f.key === key)?.label || key;
  for (const cycle of findValueDependencyCycles(fields)) {
    issues.push({
      level: 'error',
      fieldKey: cycle[0],
      fieldLabel: labelOf(cycle[0]),
      message: `字段联动存在循环依赖：${cycle.map(labelOf).join(' → ')}`,
    });
  }

  return issues;
}

export function countErrors(issues: FormIssue[]): number {
  return issues.filter((i) => i.level === 'error').length;
}
