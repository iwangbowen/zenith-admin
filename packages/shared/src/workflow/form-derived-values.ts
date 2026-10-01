import dayjs from 'dayjs';
import { evalFormula } from './formula';
import type { WorkflowFormField } from './types';

type Values = Record<string, unknown>;

/** 布局容器共享父级值空间；明细行保留独立值空间。 */
function fieldsInScope(fields: WorkflowFormField[]): WorkflowFormField[] {
  const out: WorkflowFormField[] = [];
  for (const field of fields) {
    out.push(field);
    if (field.type === 'row') {
      for (const column of field.columns ?? []) out.push(...fieldsInScope(column.fields));
    } else if (field.type === 'tabs' || field.type === 'steps') {
      for (const pane of field.panes ?? []) out.push(...fieldsInScope(pane.fields));
    } else if (field.type === 'group') {
      out.push(...fieldsInScope(field.children ?? []));
    }
  }
  return out;
}

function derivedDayValue(range: unknown): number | undefined {
  if (!Array.isArray(range) || range.length !== 2 || !range[0] || !range[1]) return undefined;
  const start = dayjs(range[0] as string | Date);
  const end = dayjs(range[1] as string | Date);
  if (!start.isValid() || !end.isValid() || end.isBefore(start, 'day')) return undefined;
  return end.diff(start, 'day') + 1;
}

/**
 * 归一可编辑表单的派生值。按依赖计算日期天数、行内公式、明细聚合与公式链，
 * 不依赖字段排列或 Form 的事件时序；循环依赖和无效表达式清空旧结果。
 * 查看已提交快照时不得调用，避免改写历史展示值。
 */
export function computeWorkflowDerivedValues(fields: WorkflowFormField[], values: Values): Values {
  return computeScope(fields, values, false);
}

function computeScope(fields: WorkflowFormField[], values: Values, detailRow: boolean): Values {
  const scoped = fieldsInScope(fields);
  const byKey = new Map(scoped.map((field) => [field.key, field]));
  let next = values;
  const write = (key: string, value: unknown) => {
    if (Object.is(next[key], value)) return;
    if (next === values) next = { ...values };
    next[key] = value;
  };
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const cyclic = new Set<string>();
  const compute = (key: string): void => {
    if (visited.has(key)) return;
    const field = byKey.get(key);
    if (!field) return;
    if (visiting.has(key)) {
      for (const pending of visiting) cyclic.add(pending);
      return;
    }
    visiting.add(key);
    if (field.type === 'detail' && Array.isArray(next[key])) {
      const rows = next[key] as unknown[];
      const computed = rows.map((row) => (
        row && typeof row === 'object' && !Array.isArray(row)
          ? computeScope(field.children ?? [], row as Values, true)
          : row
      ));
      if (computed.some((row, index) => row !== rows[index])) write(key, computed);
    } else if (field.daysFromKey && (field.type === 'number' || field.type === 'amount')) {
      compute(field.daysFromKey);
      write(key, derivedDayValue(next[field.daysFromKey]));
    } else if ((field.type === 'formula' || detailRow) && field.formula?.trim()) {
      for (const match of field.formula.matchAll(/\{([^}]+)\}/g)) {
        compute(match[1].trim().split('.', 1)[0].split('[', 1)[0]);
      }
      write(key, cyclic.has(key) ? undefined : evalFormula(field.formula, next, field.precision ?? 2) ?? undefined);
    }
    visiting.delete(key);
    visited.add(key);
  };
  for (const field of scoped) compute(field.key);
  return next;
}

/** 静态默认值与外部初值合并后计算；默认值公式只填空字段，派生字段总是重算。 */
export function initializeWorkflowFormValues(fields: WorkflowFormField[], values: Values = {}): Values {
  const scoped = fieldsInScope(fields);
  const next: Values = {};
  for (const field of scoped) {
    if (field.defaultValue !== undefined) next[field.key] = field.defaultValue;
    else if (field.type === 'switch') next[field.key] = false;
    else if (field.type === 'rate') next[field.key] = 0;
  }
  Object.assign(next, values);
  for (const field of scoped) {
    if (!field.defaultFormula?.trim() || (next[field.key] !== undefined && next[field.key] !== null && next[field.key] !== '')) continue;
    const value = evalFormula(field.defaultFormula, next, field.precision ?? 2);
    if (value !== null) next[field.key] = value;
  }
  return computeWorkflowDerivedValues(fields, next);
}
