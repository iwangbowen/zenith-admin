import dayjs from 'dayjs';
import type { WorkflowPathStatus } from './constants';
import type { WorkflowConditionGroup, WorkflowEdge, WorkflowEdgeCondition, WorkflowStarterContext } from './types';

export type WorkflowConditionStatus = WorkflowPathStatus;
export type WorkflowConditionResult = { status: WorkflowConditionStatus; reason: string };
export type WorkflowConditionStateContext = {
  formData: Readonly<Record<string, unknown>>;
  starter?: WorkflowStarterContext;
  now?: string | number | Date;
  /** Current draft gaps or values that a future node can change. '*' covers unknown output fields. */
  unknownFields?: Readonly<Record<string, string>>;
  requiredFields?: ReadonlySet<string>;
  fieldLabels?: Readonly<Record<string, string>>;
};

function parseIdList(value: string | number | boolean): number[] {
  if (typeof value === 'number') return Number.isFinite(value) ? [value] : [];
  if (typeof value === 'string') return value.split(',').map(s => s.trim()).filter(Boolean).map(Number).filter(Number.isFinite);
  return [];
}

function parseRange(value: string | number | boolean): [number, number] | null {
  if (typeof value !== 'string') return null;
  const parts = value.split(/[,~]/).map(s => Number(s.trim()));
  return parts.length === 2 && parts.every(Number.isFinite) ? [Math.min(parts[0], parts[1]), Math.max(parts[0], parts[1])] : null;
}

function compareNumber(value: number, operator: WorkflowEdgeCondition['operator'], target: WorkflowEdgeCondition['value']): boolean {
  const number = Number(target);
  switch (operator) {
    case 'eq': return value === number;
    case 'neq': return value !== number;
    case 'gt': return value > number;
    case 'gte': return value >= number;
    case 'lt': return value < number;
    case 'lte': return value <= number;
    case 'between': { const range = parseRange(target); return !!range && value >= range[0] && value <= range[1]; }
    default: return false;
  }
}

function primitive(value: unknown): value is string | number | boolean | null | undefined {
  return typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean' || value == null;
}

function targetList(target: WorkflowEdgeCondition['value']): string[] {
  // Preserve defensive support for historical imports with an array, although new contracts use comma strings.
  if (Array.isArray(target)) return target.map(v => String(v ?? '').trim()).filter(Boolean);
  return typeof target === 'string' ? target.split(',').map(s => s.trim()).filter(Boolean) : [String(target)];
}

/** Runtime boolean semantics, extracted unchanged from the existing engine. No assignee resolution or I/O. */
export function evaluateWorkflowCondition(
  condition: WorkflowEdgeCondition,
  formData: Readonly<Record<string, unknown>>,
  starter?: WorkflowStarterContext,
  now?: string | number | Date,
): boolean {
  if (condition.source === 'starter') {
    if (!starter) return false;
    const targetIds = parseIdList(condition.value);
    let actual: number[];
    switch (condition.field) {
      case 'user': actual = [starter.userId]; break;
      case 'dept': actual = starter.deptIds; break;
      case 'role': actual = starter.roleIds; break;
      case 'post': actual = starter.postIds; break;
      default: return false;
    }
    const hit = actual.some(id => targetIds.includes(id));
    return condition.operator === 'notIn' ? !hit : hit;
  }
  const fieldValue = formData[condition.field], target = condition.value;
  if (condition.aggregate) {
    const rows = Array.isArray(fieldValue) ? fieldValue : [];
    if (condition.aggregate === 'count') return compareNumber(rows.length, condition.operator, target);
    const numbers = rows.map(row => Number(condition.aggregateField ? (row as Record<string, unknown>)?.[condition.aggregateField] : row)).filter(Number.isFinite);
    const sum = numbers.reduce((a, b) => a + b, 0);
    return compareNumber(condition.aggregate === 'sum' ? sum : (numbers.length ? sum / numbers.length : 0), condition.operator, target);
  }
  if (condition.operator === 'withinDays' || condition.operator === 'beforeDays') {
    if (fieldValue == null || fieldValue === '') return false;
    const date = dayjs(fieldValue as string), days = Number(target);
    if (!date.isValid() || !Number.isFinite(days)) return false;
    const diff = dayjs(now).diff(date, 'day');
    return condition.operator === 'withinDays' ? Math.abs(diff) <= days : diff > days;
  }
  if (condition.operator === 'isEmpty' || condition.operator === 'isNotEmpty') {
    const empty = fieldValue == null || fieldValue === '' || (Array.isArray(fieldValue) && fieldValue.length === 0)
      || (typeof fieldValue === 'object' && fieldValue !== null && !Array.isArray(fieldValue) && Object.keys(fieldValue).length === 0);
    return condition.operator === 'isEmpty' ? empty : !empty;
  }
  if (Array.isArray(fieldValue)) {
    const values = fieldValue.filter(primitive).map(value => String(value ?? ''));
    if (condition.operator === 'contains') return values.includes(String(target));
    if (condition.operator === 'in' || condition.operator === 'notIn') {
      const hit = values.some(value => targetList(target).includes(value));
      return condition.operator === 'notIn' ? !hit : hit;
    }
    return false;
  }
  if (!primitive(fieldValue)) return false;
  switch (condition.operator) {
    case 'eq': return fieldValue === target || String(fieldValue ?? '') === String(target);
    case 'neq': return fieldValue !== target && String(fieldValue ?? '') !== String(target);
    case 'gt': return Number(fieldValue) > Number(target);
    case 'gte': return Number(fieldValue) >= Number(target);
    case 'lt': return Number(fieldValue) < Number(target);
    case 'lte': return Number(fieldValue) <= Number(target);
    case 'between': { const range = parseRange(target); return !!range && Number(fieldValue) >= range[0] && Number(fieldValue) <= range[1]; }
    case 'in': case 'notIn': { const hit = targetList(target).includes(String(fieldValue ?? '')); return condition.operator === 'notIn' ? !hit : hit; }
    case 'contains': return typeof fieldValue === 'string' && fieldValue.includes(String(target));
    default: return false;
  }
}

export function evaluateWorkflowConditionGroup(group: WorkflowConditionGroup, formData: Readonly<Record<string, unknown>>, starter?: WorkflowStarterContext, now?: string | number | Date): boolean {
  if (!group.rules.length) return false;
  return group.type === 'or' ? group.rules.some(rule => evaluateWorkflowCondition(rule, formData, starter, now)) : group.rules.every(rule => evaluateWorkflowCondition(rule, formData, starter, now));
}

export function evaluateWorkflowConditionGroups(groups: WorkflowConditionGroup[], formData: Readonly<Record<string, unknown>>, starter?: WorkflowStarterContext, now?: string | number | Date): boolean {
  return groups.some(group => evaluateWorkflowConditionGroup(group, formData, starter, now));
}

export function workflowEdgeHasCondition(edge: WorkflowEdge): boolean { return !!edge.condition || !!edge.conditions?.length; }
export function workflowEdgeMatchesCondition(edge: WorkflowEdge, formData: Readonly<Record<string, unknown>>, starter?: WorkflowStarterContext, now?: string | number | Date): boolean {
  if (edge.conditions?.length) return evaluateWorkflowConditionGroups(edge.conditions, formData, starter, now);
  return !!edge.condition && evaluateWorkflowCondition(edge.condition, formData, starter, now);
}
export function workflowEdgeIsDefault(edge: WorkflowEdge, target?: { data: { isDefault?: boolean } }): boolean {
  return !!edge.isDefault || !!target?.data.isDefault || !workflowEdgeHasCondition(edge);
}

/** A blank required input must not silently become a confident numeric zero/default branch. */
export function evaluateWorkflowConditionState(condition: WorkflowEdgeCondition, context: WorkflowConditionStateContext): WorkflowConditionResult {
  const unknown = (reason: string): WorkflowConditionResult => ({ status: 'unknown', reason });
  if (condition.source === 'starter') {
    if (!context.starter) return unknown('尚未提供发起人信息');
  } else {
    const root = condition.field.split(/[.[]/, 1)[0];
    const future = context.unknownFields?.['*'] ?? context.unknownFields?.[condition.field] ?? context.unknownFields?.[root]
      ?? (condition.aggregateField ? context.unknownFields?.[`${condition.field}.${condition.aggregateField}`] : undefined);
    if (future) return unknown(future);
    const value = context.formData[condition.field];
    const blank = value == null || value === '' || (Array.isArray(value) && value.length === 0);
    const emptyOperator = condition.operator === 'isEmpty' || condition.operator === 'isNotEmpty';
    if (blank && (context.requiredFields?.has(condition.field) || (!emptyOperator && !(condition.aggregate && Array.isArray(value))))) {
      return unknown(`「${context.fieldLabels?.[condition.field] ?? condition.field}」尚未填写`);
    }
    if (condition.aggregate && condition.aggregate !== 'count' && Array.isArray(value) && value.some(row => !Number.isFinite(Number(condition.aggregateField ? (row as Record<string, unknown>)?.[condition.aggregateField] : row)))) {
      return unknown(`「${context.fieldLabels?.[condition.field] ?? condition.field}」包含尚不可计算的数值`);
    }
    if (!condition.aggregate && ['gt', 'gte', 'lt', 'lte', 'between'].includes(condition.operator) && !Array.isArray(value) && !Number.isFinite(Number(value))) {
      return unknown(`「${context.fieldLabels?.[condition.field] ?? condition.field}」尚不是有效数值`);
    }
    if ((condition.operator === 'withinDays' || condition.operator === 'beforeDays') && !dayjs(value as string).isValid()) {
      return unknown(`「${context.fieldLabels?.[condition.field] ?? condition.field}」日期尚不有效`);
    }
  }
  const matched = evaluateWorkflowCondition(condition, context.formData, context.starter, context.now);
  return { status: matched ? 'matched' : 'excluded', reason: matched ? '条件成立' : '条件不成立' };
}

function combine(results: WorkflowConditionResult[], logic: 'and' | 'or'): WorkflowConditionResult {
  if (!results.length) return { status: 'excluded', reason: '条件组为空' };
  const decisive = logic === 'and' ? 'excluded' : 'matched';
  if (results.some(result => result.status === decisive)) return { status: decisive, reason: decisive === 'matched' ? '条件组成立' : '条件组不成立' };
  const uncertain = results.find(result => result.status === 'unknown');
  if (uncertain) return uncertain;
  return { status: logic === 'and' ? 'matched' : 'excluded', reason: logic === 'and' ? '条件组成立' : '条件组不成立' };
}
export function evaluateWorkflowConditionGroupState(group: WorkflowConditionGroup, context: WorkflowConditionStateContext): WorkflowConditionResult {
  return combine(group.rules.map(rule => evaluateWorkflowConditionState(rule, context)), group.type);
}
export function evaluateWorkflowConditionGroupsState(groups: WorkflowConditionGroup[], context: WorkflowConditionStateContext): WorkflowConditionResult {
  return combine(groups.map(group => evaluateWorkflowConditionGroupState(group, context)), 'or');
}
export function workflowEdgeConditionState(edge: WorkflowEdge, context: WorkflowConditionStateContext): WorkflowConditionResult {
  if (edge.conditions?.length) return evaluateWorkflowConditionGroupsState(edge.conditions, context);
  return edge.condition ? evaluateWorkflowConditionState(edge.condition, context) : { status: 'excluded', reason: '此连线未配置条件' };
}
