/**
 * 右侧字段属性配置面板
 */
import { useState } from 'react';
import { Button, Input, InputNumber, Select, Switch, Typography, TextArea, TagInput } from '@douyinfe/semi-ui';
import { Plus, Trash2 } from 'lucide-react';
import type { WorkflowFormField, WorkflowFormFieldType } from '@zenith/shared';
import { CURRENCY_OPTIONS, DATE_FORMAT_OPTIONS, FORM_FIELD_TYPES } from '../form-types';

interface FieldConfigPanelProps {
  field: WorkflowFormField;
  allFields: WorkflowFormField[];
  onChange: (updates: Partial<WorkflowFormField>) => void;
}

export default function FieldConfigPanel({
  field,
  allFields,
  onChange,
}: Readonly<FieldConfigPanelProps>) {

  const [activeSection, setActiveSection] = useState<'basic' | 'visibility'>('basic');
  const fieldInfo = FORM_FIELD_TYPES.find(t => t.type === field.type);

  // 可用作条件依赖的字段（select/multiSelect 类型，且不是当前字段）
  const conditionFields = allFields.filter(
    f => f.key !== field.key && (f.type === 'select' || f.type === 'multiSelect' || f.type === 'number' || f.type === 'text')
  );

  const hasOptions = field.type === 'select' || field.type === 'multiSelect';
  const hasChildren = field.type === 'detail';
  const isDescription = field.type === 'description';
  const isSerialNumber = field.type === 'serialNumber';
  const isAmountOrNumber = field.type === 'amount' || field.type === 'number';
  const isAmount = field.type === 'amount';
  const isDate = field.type === 'date' || field.type === 'dateRange';
  const isFileType = field.type === 'attachment' || field.type === 'image';
  const isLayout = field.type === 'row' || field.type === 'divider' || field.type === 'group';

  return (
    <div className="fd-form-config">
      {/* 字段类型标识 */}
      <div className="fd-form-config__header">
        {fieldInfo && (
          <div className="fd-form-config__type-badge">
            <fieldInfo.icon size={14} />
            <span>{fieldInfo.label}</span>
          </div>
        )}
      </div>

      {/* 切换 Tab */}
      <div className="fd-form-config__tabs">
        <button
          type="button"
          className={`fd-form-config__tab ${activeSection === 'basic' ? 'fd-form-config__tab--active' : ''}`}
          onClick={() => setActiveSection('basic')}
        >
          基础设置
        </button>
        <button
          type="button"
          className={`fd-form-config__tab ${activeSection === 'visibility' ? 'fd-form-config__tab--active' : ''}`}
          onClick={() => setActiveSection('visibility')}
        >
          显隐设置
        </button>
      </div>

      {/* 基础设置 */}
      {activeSection === 'basic' && (
        <div className="fd-form-config__section">
          {/* 字段名称 */}
          <div className="fd-form-config__field">
            <Typography.Text strong size="small">名称</Typography.Text>
            <Input
              value={field.label}
              onChange={(v) => onChange({ label: v })}
              placeholder="字段名称"
            />
          </div>

          {/* 占位文字（非说明文字、流水号、布局类型） */}
          {!isDescription && !isSerialNumber && !isLayout && (
            <div className="fd-form-config__field">
              <Typography.Text strong size="small">提示文字</Typography.Text>
              <Input
                value={field.placeholder ?? ''}
                onChange={(v) => onChange({ placeholder: v || undefined })}
                placeholder="请输入提示文字"
              />
            </div>
          )}

          {/* 必填开关（非说明文字、流水号、布局类型） */}
          {!isDescription && !isSerialNumber && !isLayout && (
            <div className="fd-form-config__field fd-form-config__field--inline">
              <Typography.Text strong size="small">必填</Typography.Text>
              <Switch
                checked={field.required ?? false}
                onChange={(v) => onChange({ required: v })}
                size="small"
              />
            </div>
          )}

          {/* 选项列表（select/multiSelect） */}
          {hasOptions && (
            <div className="fd-form-config__field">
              <Typography.Text strong size="small">选项</Typography.Text>
              <OptionsEditor
                options={field.options ?? []}
                onChange={(opts) => onChange({ options: opts })}
              />
            </div>
          )}

          {/* 数字/金额精度 */}
          {isAmountOrNumber && (
            <div className="fd-form-config__field">
              <Typography.Text strong size="small">小数位数</Typography.Text>
              <InputNumber
                value={field.precision ?? 0}
                onChange={(v) => onChange({ precision: v as number })}
                min={0}
                max={6}
                style={{ width: '100%' }}
              />
            </div>
          )}

          {/* 金额币种 */}
          {isAmount && (
            <div className="fd-form-config__field">
              <Typography.Text strong size="small">币种</Typography.Text>
              <Select
                value={field.currency ?? 'CNY'}
                onChange={(v) => onChange({ currency: v as string })}
                style={{ width: '100%' }}
                optionList={CURRENCY_OPTIONS}
              />
            </div>
          )}

          {/* 日期格式 */}
          {isDate && (
            <div className="fd-form-config__field">
              <Typography.Text strong size="small">日期格式</Typography.Text>
              <Select
                value={field.dateFormat ?? 'YYYY-MM-DD'}
                onChange={(v) => onChange({ dateFormat: v as string })}
                style={{ width: '100%' }}
                optionList={DATE_FORMAT_OPTIONS}
              />
            </div>
          )}

          {/* 附件/图片限制数 */}
          {isFileType && (
            <div className="fd-form-config__field">
              <Typography.Text strong size="small">最大数量</Typography.Text>
              <InputNumber
                value={field.maxCount ?? 5}
                onChange={(v) => onChange({ maxCount: v as number })}
                min={1}
                max={20}
                style={{ width: '100%' }}
              />
            </div>
          )}

          {/* 说明文字内容 */}
          {isDescription && (
            <div className="fd-form-config__field">
              <Typography.Text strong size="small">说明内容</Typography.Text>
              <TextArea
                value={field.description ?? ''}
                onChange={(v) => onChange({ description: v })}
                placeholder="请输入说明内容"
                rows={4}
              />
            </div>
          )}

          {/* 流水号前缀 */}
          {isSerialNumber && (
            <div className="fd-form-config__field">
              <Typography.Text strong size="small">编号前缀</Typography.Text>
              <Input
                value={field.serialPrefix ?? ''}
                onChange={(v) => onChange({ serialPrefix: v })}
                placeholder="如：REQ-"
              />
            </div>
          )}

          {/* 明细子字段 */}
          {hasChildren && (
            <div className="fd-form-config__field">
              <Typography.Text strong size="small">明细子字段</Typography.Text>
              <DetailChildrenEditor
                items={field.children ?? []}
                onChange={(children) => onChange({ children })}
              />
            </div>
          )}

          {/* --- 分栏设置 --- */}
          {field.type === 'row' && (
            <div className="fd-form-config__section" style={{ borderTop: 'none', padding: 0, marginTop: 12 }}>
              <div className="fd-form-config__section-title">分栏设置</div>
              <div className="fd-form-config__field">
                <Typography.Text strong size="small" style={{ marginBottom: 4, display: 'block' }}>列数</Typography.Text>
                <InputNumber
                  min={2} max={4}
                  value={field.columns?.length || 2}
                  onChange={(val) => {
                    const num = Number(val) || 2;
                    const existing = field.columns || [];
                    const newCols = Array.from({ length: num }, (_, i) =>
                      existing[i] || { span: Math.floor(24 / num), fields: [] }
                    );
                    onChange({ columns: newCols });
                  }}
                  style={{ width: '100%' }}
                />
              </div>
              {field.columns?.map((col, i) => (
                <div className="fd-form-config__field" key={i}>
                  <Typography.Text size="small" style={{ marginBottom: 4, display: 'block' }}>第 {i + 1} 列宽度 (24栅格)</Typography.Text>
                  <InputNumber
                    min={1} max={24}
                    value={col.span}
                    onChange={(val) => {
                      const newCols = [...(field.columns || [])];
                      newCols[i] = { ...newCols[i], span: Number(val) || 1 };
                      onChange({ columns: newCols });
                    }}
                    style={{ width: '100%' }}
                  />
                </div>
              ))}
              <div style={{ color: 'var(--semi-color-text-2)', fontSize: 12, marginTop: 4 }}>
                总宽度: {field.columns?.reduce((s, c) => s + c.span, 0) || 0} / 24
                {(field.columns?.reduce((s, c) => s + c.span, 0) || 0) !== 24 && (
                  <span style={{ color: 'var(--semi-color-danger)', marginLeft: 8 }}>⚠ 建议总宽度为24</span>
                )}
              </div>
            </div>
          )}

          {/* --- 分割线设置 --- */}
          {field.type === 'divider' && (
            <div className="fd-form-config__field" style={{ marginTop: 12 }}>
              <div style={{ color: 'var(--semi-color-text-2)', fontSize: 13 }}>
                分割线用于视觉分隔表单区域，除了上方可配置的"名称"外无需额外配置。
              </div>
            </div>
          )}

          {/* --- 分组设置 --- */}
          {field.type === 'group' && (
            <div className="fd-form-config__section" style={{ borderTop: 'none', padding: 0, marginTop: 12 }}>
              <div className="fd-form-config__section-title">分组设置</div>
              <div className="fd-form-config__field">
                <Typography.Text strong size="small" style={{ marginBottom: 4, display: 'block' }}>分组标题</Typography.Text>
                <Input
                  value={field.title || ''}
                  onChange={(val) => onChange({ title: val })}
                  placeholder="输入分组标题"
                />
              </div>
            </div>
          )}
        </div>
      )}

      {/* 显隐设置 */}
      {activeSection === 'visibility' && (
        <div className="fd-form-config__section">
          <Typography.Text type="tertiary" size="small" style={{ display: 'block', marginBottom: 12 }}>
            当满足指定条件时，该字段才会显示
          </Typography.Text>

          {conditionFields.length === 0 ? (
            <Typography.Text type="tertiary" size="small">
              暂无可作为条件的字段（需要先添加单选/多选/数字/文本类型字段）
            </Typography.Text>
          ) : (
            <>
              <div className="fd-form-config__field fd-form-config__field--inline">
                <Typography.Text strong size="small">启用显隐条件</Typography.Text>
                <Switch
                  checked={!!field.visibilityCondition}
                  onChange={(v) => {
                    if (v) {
                      onChange({
                        visibilityCondition: {
                          field: conditionFields[0].key,
                          operator: 'eq',
                          value: '',
                        },
                      });
                    } else {
                      onChange({ visibilityCondition: undefined });
                    }
                  }}
                  size="small"
                />
              </div>

              {field.visibilityCondition && (
                <div className="fd-form-config__visibility">
                  <div className="fd-form-config__field">
                    <Typography.Text size="small">当字段</Typography.Text>
                    <Select
                      value={field.visibilityCondition.field}
                      onChange={(v) =>
                        onChange({
                          visibilityCondition: { ...field.visibilityCondition!, field: v as string },
                        })
                      }
                      style={{ width: '100%' }}
                      optionList={conditionFields.map(f => ({ value: f.key, label: f.label }))}
                    />
                  </div>
                  <div className="fd-form-config__field">
                    <Typography.Text size="small">条件</Typography.Text>
                    <Select
                      value={field.visibilityCondition.operator}
                      onChange={(v) =>
                        onChange({
                          visibilityCondition: { ...field.visibilityCondition!, operator: v as 'eq' | 'neq' | 'in' | 'contains' },
                        })
                      }
                      style={{ width: '100%' }}
                      optionList={[
                        { value: 'eq', label: '等于' },
                        { value: 'neq', label: '不等于' },
                        { value: 'in', label: '包含在' },
                        { value: 'contains', label: '包含' },
                      ]}
                    />
                  </div>
                  <div className="fd-form-config__field">
                    <Typography.Text size="small">值</Typography.Text>
                    <Input
                      value={String(field.visibilityCondition.value ?? '')}
                      onChange={(v) =>
                        onChange({
                          visibilityCondition: { ...field.visibilityCondition!, value: v },
                        })
                      }
                      placeholder="条件值"
                    />
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

// ─── 选项编辑器 ──────────────────────────────────────────────────────

function OptionsEditor({
  options,
  onChange,
}: Readonly<{ options: string[]; onChange: (opts: string[]) => void }>) {
  return (
    <div className="fd-options-editor">
      {options.map((opt, i) => (
        <div key={`opt-${opt}-${i}`} className="fd-options-editor__row">
          <Input
            size="small"
            value={opt}
            onChange={(v) => {
              const updated = [...options];
              updated[i] = v;
              onChange(updated);
            }}
            placeholder={`选项 ${i + 1}`}
          />
          <button
            type="button"
            className="fd-options-editor__delete"
            onClick={() => onChange(options.filter((_, idx) => idx !== i))}
          >
            <Trash2 size={12} />
          </button>
        </div>
      ))}
      <Button
        size="small"
        type="tertiary"
        icon={<Plus size={12} />}
        onClick={() => onChange([...options, `选项${options.length + 1}`])}
      >
        添加选项
      </Button>
    </div>
  );
}

// ─── 明细子字段编辑器 ────────────────────────────────────────────────

const DETAIL_CHILD_TYPES: Array<{ value: WorkflowFormFieldType; label: string }> = [
  { value: 'text', label: '文本' },
  { value: 'number', label: '数字' },
  { value: 'amount', label: '金额' },
  { value: 'date', label: '日期' },
  { value: 'select', label: '单选' },
];

function DetailChildrenEditor({
  items,
  onChange,
}: Readonly<{ items: WorkflowFormField[]; onChange: (fields: WorkflowFormField[]) => void }>) {
  const addChild = () => {
    const key = `child_${Date.now()}`;
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
