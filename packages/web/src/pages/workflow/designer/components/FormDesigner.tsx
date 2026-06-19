/**
 * 表单设计器主组件
 * 三栏布局：左侧控件面板 | 中间画布预览 | 右侧属性配置
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { Button, Tooltip } from '@douyinfe/semi-ui';
import { Undo2, Redo2 } from 'lucide-react';
import type { WorkflowFormField, WorkflowFormFieldType } from '@zenith/shared';
import { FORM_FIELD_TYPES } from '../form-types';
import { findField, updateField, removeField, insertField, insertAfterKey, isDescendant, isContainerType, type DropTarget } from '../form-tree';
import FieldPalette from './FieldPalette';
import FormCanvas from './FormCanvas';
import FieldConfigPanel from './FieldConfigPanel';
import './FormDesigner.css';

interface FormDesignerProps {
  fields: WorkflowFormField[];
  onChange: (fields: WorkflowFormField[]) => void;
  /** 是否显示内置的撤销/重做工具栏（默认 true）。外部接管工具栏时传 false 并使用 onHistoryChange */
  showToolbar?: boolean;
  /** 撤销/重做状态变化回调，供外部工具栏渲染按钮 */
  onHistoryChange?: (controls: FormHistoryControls) => void;
}

export interface FormHistoryControls {
  undo: () => void;
  redo: () => void;
  canUndo: boolean;
  canRedo: boolean;
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
      field.dateFormat = 'yyyy-MM-dd';
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
    case 'switch':
      field.defaultValue = false;
      break;
    case 'checkbox':
    case 'radio':
      field.options = ['选项1', '选项2', '选项3'];
      break;
    case 'slider':
      field.min = 0;
      field.max = 100;
      field.step = 1;
      break;
    case 'dictSelect':
      field.dictCode = '';
      field.multiple = false;
      break;
    case 'userSelect':
    case 'deptSelect':
      field.multiple = false;
      break;
    case 'autoComplete':
      field.options = ['建议1', '建议2', '建议3'];
      break;
    case 'pinCode':
      field.maxCount = 6;
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

interface HistoryState {
  stack: WorkflowFormField[][];
  pointer: number;
  lastTag: string | null;
}

const MAX_HISTORY = 100;

export default function FormDesigner({ fields, onChange, showToolbar = true, onHistoryChange }: Readonly<FormDesignerProps>) {
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  // 撤销/重做历史栈（快照为不可变字段数组，所有变更走 commit 统一入栈）
  const historyRef = useRef<HistoryState>({ stack: [fields], pointer: 0, lastTag: null });
  const [, bumpHistory] = useState(0);

  const selectedField = findField(fields, selectedKey ?? '');

  // 统一提交变更：写入历史栈并通知父级。tag 相同的连续变更会被合并为一步（如连续编辑同一字段属性）
  const commit = useCallback((next: WorkflowFormField[], tag?: string) => {
    const h = historyRef.current;
    const coalesce = tag != null && tag === h.lastTag && h.pointer === h.stack.length - 1;
    if (coalesce) {
      h.stack[h.pointer] = next;
    } else {
      h.stack = h.stack.slice(0, h.pointer + 1);
      h.stack.push(next);
      if (h.stack.length > MAX_HISTORY) h.stack.shift();
      h.pointer = h.stack.length - 1;
    }
    h.lastTag = tag ?? null;
    bumpHistory(v => v + 1);
    onChange(next);
  }, [onChange]);

  const undo = useCallback(() => {
    const h = historyRef.current;
    if (h.pointer <= 0) return;
    h.pointer -= 1;
    h.lastTag = null;
    bumpHistory(v => v + 1);
    onChange(h.stack[h.pointer]);
  }, [onChange]);

  const redo = useCallback(() => {
    const h = historyRef.current;
    if (h.pointer >= h.stack.length - 1) return;
    h.pointer += 1;
    h.lastTag = null;
    bumpHistory(v => v + 1);
    onChange(h.stack[h.pointer]);
  }, [onChange]);

  // 键盘快捷键：Ctrl/Cmd+Z 撤销，Ctrl/Cmd+Shift+Z 或 Ctrl+Y 重做（编辑输入框时不拦截）
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      const k = e.key.toLowerCase();
      if (k !== 'z' && k !== 'y') return;
      const ae = document.activeElement as HTMLElement | null;
      const tag = ae?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || ae?.isContentEditable) return;
      if (k === 'y' || (k === 'z' && e.shiftKey)) { e.preventDefault(); redo(); }
      else if (k === 'z') { e.preventDefault(); undo(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [undo, redo]);

  const hist = historyRef.current;
  const canUndo = hist.pointer > 0;
  const canRedo = hist.pointer < hist.stack.length - 1;

  // 向外部上报撤销/重做状态（供外部工具栏渲染按钮）
  useEffect(() => {
    onHistoryChange?.({ undo, redo, canUndo, canRedo });
  }, [onHistoryChange, undo, redo, canUndo, canRedo]);

  // 点击左侧面板添加字段（追加到顶层末尾）
  const handleAddField = useCallback((type: WorkflowFormFieldType) => {
    const newField = createField(type);
    commit([...fields, newField]);
    setSelectedKey(newField.key);
  }, [fields, commit]);

  // 从面板拖放到画布指定位置（支持顶层 / 分栏列 / 分组）
  const handleDropNew = useCallback((type: WorkflowFormFieldType, target: DropTarget) => {
    // 容器类控件（分栏/分组/明细）只能放在顶层，避免无限嵌套
    if (isContainerType(type) && target.container !== 'root') return;
    const newField = createField(type);
    commit(insertField(fields, target, newField));
    setSelectedKey(newField.key);
  }, [fields, commit]);

  // 移动已有字段到目标位置（跨容器拖拽 / 排序）
  const handleMoveField = useCallback((moveKey: string, target: DropTarget) => {
    if (target.beforeKey === moveKey) return; // 拖到自身之前 = 无操作
    const moved = findField(fields, moveKey);
    if (!moved) return;
    if (isContainerType(moved.type) && target.container !== 'root') return; // 容器只能在顶层
    if (target.container === 'col' && (target.rowKey === moveKey || isDescendant(fields, moveKey, target.rowKey))) return;
    if (target.container === 'group' && (target.groupKey === moveKey || isDescendant(fields, moveKey, target.groupKey))) return;
    const [next, rm] = removeField(fields, moveKey);
    if (!rm) return;
    commit(insertField(next, target, rm));
    setSelectedKey(moveKey);
  }, [fields, commit]);

  // 删除字段（任意层级）
  const handleRemove = useCallback((key: string) => {
    commit(removeField(fields, key)[0]);
    if (selectedKey === key) setSelectedKey(null);
  }, [fields, commit, selectedKey]);

  // 复制字段（插入到原字段之后，任意层级）
  const handleCopy = useCallback((key: string) => {
    const target = findField(fields, key);
    if (!target) return;
    const cloned = cloneFieldWithNewKeys(target);
    commit(insertAfterKey(fields, key, cloned));
    setSelectedKey(cloned.key);
  }, [fields, commit]);

  // 修改字段属性（任意层级；连续编辑同一字段合并为一步撤销）
  const handleFieldChange = useCallback((updates: Partial<WorkflowFormField>) => {
    if (!selectedKey) return;
    commit(updateField(fields, selectedKey, updates), `edit:${selectedKey}`);
  }, [fields, commit, selectedKey]);

  return (
    <div className="fd-form-designer-shell">
      {/* 顶部工具栏：撤销 / 重做（由外部工具栏接管时隐藏） */}
      {showToolbar && (
        <div className="fd-form-designer__toolbar">
          <Tooltip content="撤销 (Ctrl+Z)">
            <Button
              size="small"
              theme="borderless"
              type="tertiary"
              icon={<Undo2 size={15} />}
              disabled={!canUndo}
              onClick={undo}
              aria-label="撤销"
            />
          </Tooltip>
          <Tooltip content="重做 (Ctrl+Shift+Z)">
            <Button
              size="small"
              theme="borderless"
              type="tertiary"
              icon={<Redo2 size={15} />}
              disabled={!canRedo}
              onClick={redo}
              aria-label="重做"
            />
          </Tooltip>
          <span className="fd-form-designer__toolbar-hint">点击或拖拽左侧控件添加字段 · Ctrl+Z 撤销 / Ctrl+Shift+Z 重做</span>
        </div>
      )}

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
            onMoveField={handleMoveField}
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
    </div>
  );
}
