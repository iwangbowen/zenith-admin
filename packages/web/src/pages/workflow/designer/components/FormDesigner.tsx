/**
 * 表单设计器主组件
 * 三栏布局：左侧控件面板 | 中间画布预览 | 右侧属性配置
 */
import { useCallback, useState } from 'react';
import type { WorkflowFormField, WorkflowFormFieldType } from '@zenith/shared';
import { FORM_FIELD_TYPES } from '../form-types';
import FieldPalette from './FieldPalette';
import FormCanvas from './FormCanvas';
import FieldConfigPanel from './FieldConfigPanel';
import './FormDesigner.css';

interface FormDesignerProps {
  fields: WorkflowFormField[];
  onChange: (fields: WorkflowFormField[]) => void;
}

let fieldCounter = 0;

function generateKey(type: WorkflowFormFieldType): string {
  fieldCounter++;
  return `${type}_${Date.now()}_${fieldCounter}`;
}

function getDefaultLabel(type: WorkflowFormFieldType): string {
  const info = FORM_FIELD_TYPES.find(t => t.type === type);
  return info?.label ?? '字段';
}

// 深拷贝字段并为自身及所有嵌套子字段重新生成 key（用于复制字段）
function cloneFieldWithNewKeys(field: WorkflowFormField): WorkflowFormField {
  const copy: WorkflowFormField = structuredClone(field);
  const reassign = (f: WorkflowFormField) => {
    f.key = generateKey(f.type);
    f.children?.forEach(reassign);
    f.columns?.forEach(col => col.fields.forEach(reassign));
  };
  reassign(copy);
  copy.label = field.label ? `${field.label} 副本` : copy.label;
  return copy;
}

function createField(type: WorkflowFormFieldType): WorkflowFormField {
  const field: WorkflowFormField = {
    key: generateKey(type),
    label: getDefaultLabel(type),
    type,
  };

  // 类型特定默认值
  switch (type) {
    case 'row':
      return {
        key: `field_${Date.now()}`,
        label: '分栏',
        type: 'row',
        columns: [
          { span: 12, fields: [] },
          { span: 12, fields: [] },
        ],
      };
    case 'divider':
      return {
        key: `field_${Date.now()}`,
        label: '分割线',
        type: 'divider',
      };
    case 'group':
      return {
        key: `field_${Date.now()}`,
        label: '分组',
        type: 'group',
        title: '分组标题',
        children: [],
      };
    case 'select':
    case 'multiSelect':
      field.options = ['选项1', '选项2', '选项3'];
      break;
    case 'amount':
      field.currency = 'CNY';
      field.precision = 2;
      break;
    case 'number':
      field.precision = 0;
      break;
    case 'date':
    case 'dateRange':
      field.dateFormat = 'YYYY-MM-DD';
      break;
    case 'time':
      field.timeFormat = 'HH:mm';
      break;
    case 'region':
      field.regionLevel = 'district';
      break;
    case 'attachment':
    case 'image':
      field.maxCount = 5;
      break;
    case 'description':
      return {
        key: `field_${Date.now()}`,
        label: '说明文字',
        type: 'description',
        description: '请在此处填写说明文字...',
      };
    case 'serialNumber':
      field.serialPrefix = '';
      break;
    case 'phone':
      field.placeholder = '请输入手机号';
      break;
    case 'email':
      field.placeholder = '请输入邮箱';
      break;
    case 'idCard':
      field.placeholder = '请输入身份证号';
      break;
    case 'url':
      field.placeholder = '请输入网址（含 https://）';
      break;
    case 'rate':
      field.rateMax = 5;
      break;
    case 'formula':
      field.formula = '';
      field.precision = 2;
      break;
    case 'detail':
      field.children = [
        { key: `child_${Date.now()}_1`, label: '列1', type: 'text' },
        { key: `child_${Date.now()}_2`, label: '列2', type: 'number' },
      ];
      break;
  }

  return field;
}

export default function FormDesigner({ fields, onChange }: Readonly<FormDesignerProps>) {
  const [selectedKey, setSelectedKey] = useState<string | null>(null);

  const selectedField = fields.find(f => f.key === selectedKey) ?? null;

  // 点击左侧面板添加字段
  const handleAddField = useCallback((type: WorkflowFormFieldType) => {
    const newField = createField(type);
    onChange([...fields, newField]);
    setSelectedKey(newField.key);
  }, [fields, onChange]);

  // 从面板拖放到画布指定位置
  const handleDropNew = useCallback((type: WorkflowFormFieldType, index: number) => {
    const newField = createField(type);
    const updated = [...fields];
    updated.splice(index, 0, newField);
    onChange(updated);
    setSelectedKey(newField.key);
  }, [fields, onChange]);

  // 拖拽排序
  const handleReorder = useCallback((reordered: WorkflowFormField[]) => {
    onChange(reordered);
  }, [onChange]);

  // 删除字段
  const handleRemove = useCallback((key: string) => {
    onChange(fields.filter(f => f.key !== key));
    if (selectedKey === key) setSelectedKey(null);
  }, [fields, onChange, selectedKey]);

  // 复制字段（插入到原字段之后）
  const handleCopy = useCallback((key: string) => {
    const index = fields.findIndex(f => f.key === key);
    if (index < 0) return;
    const cloned = cloneFieldWithNewKeys(fields[index]);
    const updated = [...fields];
    updated.splice(index + 1, 0, cloned);
    onChange(updated);
    setSelectedKey(cloned.key);
  }, [fields, onChange]);

  // 修改字段属性
  const handleFieldChange = useCallback((updates: Partial<WorkflowFormField>) => {
    if (!selectedKey) return;
    onChange(fields.map(f => f.key === selectedKey ? { ...f, ...updates } : f));
  }, [fields, onChange, selectedKey]);

  return (
    <div className="fd-form-designer">
      {/* 左侧：控件面板 */}
      <div className="fd-form-designer__palette">
        <FieldPalette onAddField={handleAddField} />
      </div>

      {/* 中间：画布 */}
      <div className="fd-form-designer__canvas">
        <FormCanvas
          fields={fields}
          selectedKey={selectedKey}
          onSelect={setSelectedKey}
          onReorder={handleReorder}
          onRemove={handleRemove}
          onCopy={handleCopy}
          onDropNew={handleDropNew}
        />
      </div>

      {/* 右侧：属性配置 */}
      <div className="fd-form-designer__config">
        {selectedField ? (
          <FieldConfigPanel
            field={selectedField}
            allFields={fields}
            onChange={handleFieldChange}
          />
        ) : (
          <div className="fd-form-designer__config-empty">
            <span>点击左侧字段进行配置</span>
          </div>
        )}
      </div>
    </div>
  );
}
