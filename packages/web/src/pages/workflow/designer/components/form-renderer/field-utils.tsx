/**
 * 工作流表单渲染器的纯函数工具：字段布局、级联选项、日期范围、增强选项与跨字段比较。
 * 不依赖 React 状态，供 FieldRenderer / 联动 hook / 自定义控件共用。
 */
import type { ReactNode } from 'react';
import { Space } from '@douyinfe/semi-ui';
import dayjs from 'dayjs';
import type { WorkflowFormField, WorkflowFormFieldColumn, WorkflowFormFieldOptionItem, WorkflowFormFieldCompareRule, WorkflowFormCascaderNode } from '@zenith/shared/workflow';

export const PHONE_REGEX = /^1[3-9]\d{9}$/;
export const EMAIL_REGEX = /^[\w.+-]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+$/;
export const ID_CARD_REGEX = /^[1-9]\d{5}(18|19|20)\d{2}(0[1-9]|1[0-2])(0[1-9]|[12]\d|3[01])\d{3}[0-9Xx]$/;
export const URL_REGEX = /^https?:\/\/.+/;

export const getColumnKey = (parentKey: string, column: WorkflowFormFieldColumn) =>
  `${parentKey}-col-${column.span}-${column.fields.map(field => field.key).join('-') || 'empty'}`;

// ─── 字段列宽（响应式并排） ──────────────────────────────────────────
const LAYOUT_FULL_WIDTH_TYPES = new Set<string>(['row', 'divider', 'group', 'description', 'detail', 'tabs', 'steps']);
const VALID_COLUMN_SPANS = new Set([12, 8, 6]);
export function colSpanOf(field: WorkflowFormField): number {
  if (LAYOUT_FULL_WIDTH_TYPES.has(field.type)) return 24;
  return field.columnSpan && VALID_COLUMN_SPANS.has(field.columnSpan) ? field.columnSpan : 24;
}

// 必填字段标签（带红色星号），用于 withField 自定义控件
export function fieldLabelNode(field: WorkflowFormField, required: boolean | undefined = field.required): ReactNode {
  if (!required) return field.label;
  return <span>{field.label}<span style={{ color: 'var(--semi-color-danger)' }}> *</span></span>;
}

// 级联选项 → Semi Cascader treeData
export function toCascaderTreeData(nodes: WorkflowFormCascaderNode[]): Array<{ label: string; value: string; children?: ReturnType<typeof toCascaderTreeData> }> {
  return nodes.map((n) => ({
    label: n.label || n.value,
    value: n.value,
    ...(n.children?.length ? { children: toCascaderTreeData(n.children) } : {}),
  }));
}

export function flattenFields(fields: WorkflowFormField[]): WorkflowFormField[] {
  const out: WorkflowFormField[] = [];
  for (const f of fields) {
    out.push(f);
    if (f.type === 'row' && f.columns) {
      for (const col of f.columns) out.push(...flattenFields(col.fields));
    } else if ((f.type === 'tabs' || f.type === 'steps') && f.panes) {
      for (const pane of f.panes) out.push(...flattenFields(pane.fields));
    } else if ((f.type === 'group' || f.type === 'detail') && f.children) {
      out.push(...flattenFields(f.children));
    }
  }
  return out;
}

export function getCascadeAllowedOptions(field: WorkflowFormField, values: Record<string, unknown>): string[] {
  if (!field.optionsFrom) return field.options ?? [];
  const parentValue = values[field.optionsFrom.sourceKey];
  if (Array.isArray(parentValue)) {
    return Array.from(new Set(parentValue.flatMap((value) => field.optionsFrom?.mapping[String(value)] ?? [])));
  }
  return parentValue === undefined || parentValue === null ? [] : (field.optionsFrom.mapping[String(parentValue)] ?? []);
}

// 显隐/条件求值统一走 shared workflow-form-runtime（与服务端发起校验同源），本模块不再本地实现

// ─── 日期可选范围 → disabledDate ─────────────────────────────────────
export function buildDisabledDate(field: WorkflowFormField): ((date?: Date) => boolean) | undefined {
  const mode = field.dateLimit;
  if (!mode || mode === 'none') return undefined;
  if (mode === 'noPast') return (d?: Date) => !!d && dayjs(d).isBefore(dayjs(), 'day');
  if (mode === 'noFuture') return (d?: Date) => !!d && dayjs(d).isAfter(dayjs(), 'day');
  const min = field.minDate ? dayjs(field.minDate) : null;
  const max = field.maxDate ? dayjs(field.maxDate) : null;
  if (!(min?.isValid()) && !(max?.isValid())) return undefined;
  return (d?: Date) => {
    if (!d) return false;
    const day = dayjs(d);
    if (min?.isValid() && day.isBefore(min, 'day')) return true;
    if (max?.isValid() && day.isAfter(max, 'day')) return true;
    return false;
  };
}

// ─── 增强选项：合并 optionItems 元信息，按级联允许值过滤排序 ──────────
export interface DisplayOption { value: string; label: string; color?: string; disabled?: boolean; imageUrl?: string }
export function getDisplayOptions(field: WorkflowFormField, values: Record<string, unknown>): DisplayOption[] {
  const allowed = getCascadeAllowedOptions(field, values);
  const itemMap = new Map<string, WorkflowFormFieldOptionItem>((field.optionItems ?? []).map((it) => [it.value, it]));
  return allowed.map((v) => {
    const it = itemMap.get(v);
    return { value: v, label: it?.label || v, color: it?.color, disabled: it?.disabled, imageUrl: it?.imageUrl };
  });
}

export function optionLabelNode(opt: DisplayOption): ReactNode {
  // 图片选项：图 + 文的卡片式标签（radio 单选配图）
  if (opt.imageUrl) {
    return (
      <Space vertical spacing={4}>
        <img
          src={opt.imageUrl}
          alt={opt.label}
          style={{ width: 72, height: 54, objectFit: 'cover', borderRadius: 'var(--semi-border-radius-small)', border: '1px solid var(--semi-color-border)' }}
        />
        {opt.label}
      </Space>
    );
  }
  if (!opt.color) return opt.label;
  return (
    <Space spacing={6}>
      <span style={{ width: 8, height: 8, borderRadius: '50%', background: opt.color, display: 'inline-block' }} />
      {opt.label}
    </Space>
  );
}

// ─── 跨字段比较校验 ──────────────────────────────────────────────────
export function evalCompare(op: WorkflowFormFieldCompareRule['operator'], a: unknown, b: unknown, isDate: boolean): boolean {
  if (a === null || a === undefined || a === '' || b === null || b === undefined || b === '') return true;
  if (Array.isArray(a) || Array.isArray(b)) return true;
  let x: number; let y: number;
  if (isDate) { x = dayjs(a as string).valueOf(); y = dayjs(b as string).valueOf(); }
  else { x = Number(a); y = Number(b); }
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

export const COMPARE_OP_TEXT: Record<WorkflowFormFieldCompareRule['operator'], string> = {
  gt: '大于', gte: '不小于', lt: '小于', lte: '不大于', eq: '等于', neq: '不等于',
};
