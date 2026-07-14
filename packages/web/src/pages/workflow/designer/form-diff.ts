/**
 * 表单变更摘要（F14）：对比服务端基线与当前编辑态，产出 新增/删除/重命名/修改 明细。
 * 供保存前审阅（配合 InlineEditor 的 baseline + 重命名跟踪）。
 */
import type { WorkflowFormField } from '@zenith/shared';
import { flattenAllFields } from './form-tree';

export type FormDiffKind = 'added' | 'removed' | 'renamed' | 'modified';

export interface FormFieldDiffEntry {
  kind: FormDiffKind;
  /** 当前 key（removed 为原 key） */
  key: string;
  label: string;
  /** 变更说明（modified 列出属性；renamed 展示 旧 → 新） */
  detail?: string;
}

/** 属性名 → 展示名（未收录的直接显示原属性名） */
const PROP_LABELS: Record<string, string> = {
  label: '名称', type: '类型', required: '必填', placeholder: '提示文字', helpText: '帮助提示',
  options: '选项', optionItems: '选项', defaultValue: '默认值', defaultFormula: '默认值公式',
  formula: '公式', validationFormula: '校验公式', validationMessage: '校验提示',
  visibilityRules: '显隐规则', requiredRules: '条件必填', readOnlyRules: '条件只读',
  visibilityCondition: '显隐条件', optionsFrom: '级联', autoFill: '联动赋值', daysFromKey: '天数联动',
  minLength: '最小长度', maxLength: '最大长度', min: '最小值', max: '最大值',
  pattern: '正则', patternMessage: '正则提示', unique: '禁止重复', compareRules: '比较校验',
  dateLimit: '日期范围', minDate: '最早日期', maxDate: '最晚日期', dateFormat: '日期格式', timeFormat: '时间格式',
  accept: '文件类型', maxSize: '文件大小', maxCount: '数量上限', precision: '小数位', step: '步长',
  unit: '单位', currency: '币种', amountInWords: '金额大写', columnSpan: '字段宽度',
  readOnly: '只读', hidden: '默认隐藏', children: '子字段', columns: '分栏列', panes: '面板',
  title: '标题', collapsible: '可折叠', defaultCollapsed: '默认折叠', description: '说明内容',
  serialPrefix: '编号前缀', rateMax: '评分上限', detailSummary: '合计', detailColumnWidth: '列宽',
  dictCode: '字典', multiple: '多选', dataSourceId: '数据源', regionLevel: '地区层级',
  relationDefinitionId: '关联流程', relationDisplayField: '关联展示字段',
  cascaderOptions: '级联选项', cascaderChangeOnSelect: '任意层级可选',
  npsMinLabel: '低分说明', npsMaxLabel: '高分说明', sliderMarks: '刻度', alpha: '透明度',
  labelPosition: '标签位置', labelAlign: '标签对齐', labelWidth: '标签宽度', allowOther: '允许其他',
};

const stringify = (v: unknown): string => (v === undefined ? '∅' : JSON.stringify(v));

/** 对比同 key 字段的属性差异，返回变更属性展示名列表（子字段集合由展平比对单独覆盖，不在此重复报告） */
function changedProps(before: WorkflowFormField, after: WorkflowFormField): string[] {
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  keys.delete('key');
  keys.delete('children');
  keys.delete('columns');
  keys.delete('panes');
  const out: string[] = [];
  for (const k of keys) {
    const b = (before as unknown as Record<string, unknown>)[k];
    const a = (after as unknown as Record<string, unknown>)[k];
    if (stringify(b) !== stringify(a)) out.push(PROP_LABELS[k] ?? k);
  }
  return out;
}

/**
 * 生成变更摘要。
 * @param baseline 服务端已知字段（加载/保存后的快照）
 * @param current  当前编辑态字段
 * @param renames  已跟踪的 key 重命名映射（旧 key → 新 key）
 */
export function diffFormFields(
  baseline: WorkflowFormField[],
  current: WorkflowFormField[],
  renames: Record<string, string> = {},
): FormFieldDiffEntry[] {
  const baseFlat = flattenAllFields(baseline);
  const curFlat = flattenAllFields(current);
  const curByKey = new Map(curFlat.map((f) => [f.key, f]));

  // 基线字段按「重命名后的有效 key」对齐当前态
  const baseByEffKey = new Map<string, { field: WorkflowFormField; originalKey: string }>();
  for (const f of baseFlat) {
    const eff = renames[f.key] && curByKey.has(renames[f.key]) && !curByKey.has(f.key) ? renames[f.key] : f.key;
    baseByEffKey.set(eff, { field: f, originalKey: f.key });
  }

  const entries: FormFieldDiffEntry[] = [];

  for (const cur of curFlat) {
    const base = baseByEffKey.get(cur.key);
    if (!base) {
      entries.push({ kind: 'added', key: cur.key, label: cur.label || cur.key });
      continue;
    }
    if (base.originalKey !== cur.key) {
      entries.push({ kind: 'renamed', key: cur.key, label: cur.label || cur.key, detail: `${base.originalKey} → ${cur.key}` });
    }
    const props = changedProps(base.field, cur);
    if (props.length > 0) {
      entries.push({ kind: 'modified', key: cur.key, label: cur.label || cur.key, detail: props.join('、') });
    }
  }

  for (const [effKey, base] of baseByEffKey) {
    if (!curByKey.has(effKey)) {
      entries.push({ kind: 'removed', key: base.originalKey, label: base.field.label || base.originalKey });
    }
  }

  return entries;
}
