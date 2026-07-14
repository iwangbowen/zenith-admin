// ─── 明细子字段编辑器（拆分自 FieldConfigPanel.tsx）───
import { Button, Input, InputNumber, Select, TagInput, Tooltip } from '@douyinfe/semi-ui';
import { Plus, Trash2 } from 'lucide-react';
import type { WorkflowFormField, WorkflowFormFieldType } from '@zenith/shared';
import { createLocalFieldKey } from './helpers';

// ─── 明细子字段编辑器 ────────────────────────────────────────────────

const DETAIL_CHILD_TYPES: Array<{ value: WorkflowFormFieldType; label: string }> = [
  { value: 'text', label: '文本' },
  { value: 'number', label: '数字' },
  { value: 'amount', label: '金额' },
  { value: 'date', label: '日期' },
  { value: 'select', label: '单选' },
];

export function DetailChildrenEditor({
  items,
  onChange,
}: Readonly<{ items: WorkflowFormField[]; onChange: (fields: WorkflowFormField[]) => void }>) {
  const addChild = () => {
    const key = createLocalFieldKey('text');
    onChange([
      ...items,
      { key, label: `列${items.length + 1}`, type: 'text' },
    ]);
  };

  const updateChild = (index: number, updates: Partial<WorkflowFormField>) => {
    const updated = [...items];
    updated[index] = { ...updated[index], ...updates };
    onChange(updated);
  };

  const removeChild = (index: number) => {
    onChange(items.filter((_, i) => i !== index));
  };

  return (
    <div className="fd-detail-children">
      {items.map((child, i) => (
        <div key={child.key} className="fd-detail-children__row">
          <Input
            size="small"
            value={child.label}
            onChange={(v) => updateChild(i, { label: v })}
            placeholder="列名"
            style={{ flex: 1 }}
          />
          <Select
            size="small"
            value={child.type}
            onChange={(v) => updateChild(i, { type: v as WorkflowFormFieldType })}
            placeholder="选择类型"
            style={{ width: 90 }}
            optionList={DETAIL_CHILD_TYPES}
          />
          {(child.type === 'select') && (
            <TagInput
              size="small"
              value={child.options ?? []}
              onChange={(v) => updateChild(i, { options: v })}
              placeholder="选项"
              style={{ flex: 1 }}
            />
          )}
          {(child.type === 'number' || child.type === 'amount') && (
            <button
              type="button"
              className={`fd-detail-children__sum ${child.detailSummary ? 'fd-detail-children__sum--active' : ''}`}
              title={child.detailSummary ? '取消合计' : '在底部显示合计'}
              onClick={() => updateChild(i, { detailSummary: !child.detailSummary })}
            >
              Σ
            </button>
          )}
          <Tooltip content="列宽（px），留空自动均分">
            <InputNumber
              size="small"
              value={child.detailColumnWidth}
              onChange={(v) => updateChild(i, { detailColumnWidth: v === undefined || v === '' ? undefined : Number(v) })}
              min={40}
              max={800}
              placeholder="宽"
              hideButtons
              style={{ width: 56 }}
            />
          </Tooltip>
          <button
            type="button"
            className={`fd-detail-children__sum ${child.unique ? 'fd-detail-children__sum--active' : ''}`}
            title={child.unique ? '取消禁止重复' : '该列值不可重复'}
            onClick={() => updateChild(i, { unique: !child.unique || undefined })}
          >
            唯
          </button>
          <button
            type="button"
            className="fd-detail-children__delete"
            onClick={() => removeChild(i)}
          >
            <Trash2 size={12} />
          </button>
        </div>
      ))}
      <Button
        size="small"
        type="tertiary"
        icon={<Plus size={12} />}
        onClick={addChild}
      >
        添加列
      </Button>
    </div>
  );
}
