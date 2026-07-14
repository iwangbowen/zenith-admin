/**
 * 表单设计器主组件
 * 三栏布局：左侧控件面板 | 中间画布预览 | 右侧属性配置
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Button, Tooltip, Modal, Toast, Typography } from '@douyinfe/semi-ui';
import { Undo2, Redo2 } from 'lucide-react';
import type { WorkflowFormField, WorkflowFormFieldType, WorkflowFormSettings } from '@zenith/shared';
import { FORM_FIELD_TYPES } from '../form-types';
import { findField, updateField, removeField, insertField, insertAfterKey, isDescendant, isContainerType, findFieldDependents, pruneFieldReferences, pruneCascadeMappings, renameFieldKey, type DropTarget } from '../form-tree';
import FieldPalette from './FieldPalette';
import FormCanvas from './FormCanvas';
import FieldConfigPanel from './FieldConfigPanel';
import './FormDesigner.css';

interface FormDesignerProps {
  fields: WorkflowFormField[];
  onChange: (fields: WorkflowFormField[]) => void;
  /** 表单级设置（纳入撤销/重做历史） */
  settings?: WorkflowFormSettings;
  /** 表单级设置变化回调（撤销/重做时同步还原） */
  onSettingsChange?: (settings: WorkflowFormSettings) => void;
  /** 是否显示内置的撤销/重做工具栏（默认 true）。外部接管工具栏时传 false 并使用 onHistoryChange */
  showToolbar?: boolean;
  /** 撤销/重做状态变化回调，供外部工具栏渲染按钮 */
  onHistoryChange?: (controls: FormHistoryControls) => void;
  /** 字段 key 重命名上报（oldKey → newKey），供外部跟踪并级联到流程侧引用 */
  onRenameKey?: (oldKey: string, newKey: string) => void;
}

export interface FormHistoryControls {
  undo: () => void;
  redo: () => void;
  canUndo: boolean;
  canRedo: boolean;
  /** 提交字段整体变更（JSON 导入/模板/批量设置，纳入历史栈） */
  commitFields: (fields: WorkflowFormField[]) => void;
  /** 提交表单级设置变更（纳入历史栈） */
  commitSettings: (settings: WorkflowFormSettings) => void;
  /** 选中指定字段（用于体检面板定位） */
  selectField: (key: string) => void;
}

let fieldCounter = 0;

function generateKey(type: WorkflowFormFieldType): string {
  fieldCounter++;
  const random = globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2, 10);
  return `${type}_${Date.now()}_${fieldCounter}_${random.replace(/-/g, '').slice(0, 8)}`;
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
    f.panes?.forEach(pane => pane.fields.forEach(reassign));
  };
  reassign(copy);
  copy.label = field.label ? `${field.label} 副本` : copy.label;
  return copy;
}

function collectFields(fields: WorkflowFormField[]): WorkflowFormField[] {
  const out: WorkflowFormField[] = [];
  for (const field of fields) {
    out.push(field);
    field.columns?.forEach((column) => out.push(...collectFields(column.fields)));
    field.panes?.forEach((pane) => out.push(...collectFields(pane.fields)));
    if (field.children) out.push(...collectFields(field.children));
  }
  return out;
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
        key: field.key,
        label: '分栏',
        type: 'row',
        columns: [
          { span: 12, fields: [] },
          { span: 12, fields: [] },
        ],
      };
    case 'divider':
      return {
        key: field.key,
        label: '分割线',
        type: 'divider',
      };
    case 'group':
      return {
        key: field.key,
        label: '分组',
        type: 'group',
        title: '分组标题',
        children: [],
      };
    case 'tabs':
      return {
        key: field.key,
        label: '标签页',
        type: 'tabs',
        panes: [
          { title: '标签1', fields: [] },
          { title: '标签2', fields: [] },
        ],
      };
    case 'steps':
      return {
        key: field.key,
        label: '分步',
        type: 'steps',
        panes: [
          { title: '步骤1', fields: [] },
          { title: '步骤2', fields: [] },
        ],
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
        key: field.key,
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
    case 'relation':
      field.multiple = false;
      if (type === 'relation') field.placeholder = '请选择关联审批单';
      break;
    case 'autoComplete':
      field.options = ['建议1', '建议2', '建议3'];
      break;
    case 'pinCode':
      field.maxCount = 6;
      break;
    case 'colorPicker':
      field.defaultValue = '#1677ff';
      break;
    case 'formula':
      field.formula = '';
      field.precision = 2;
      break;
    case 'detail':
      field.children = [
        { key: generateKey('text'), label: '列1', type: 'text' },
        { key: generateKey('number'), label: '列2', type: 'number' },
      ];
      break;
  }

  return field;
}

interface DesignerSnapshot {
  fields: WorkflowFormField[];
  settings: WorkflowFormSettings;
}

interface HistoryState {
  stack: DesignerSnapshot[];
  pointer: number;
  lastTag: string | null;
}

const MAX_HISTORY = 100;

export default function FormDesigner({ fields, onChange, settings, onSettingsChange, showToolbar = true, onHistoryChange, onRenameKey }: Readonly<FormDesignerProps>) {
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  // 表单级设置以 ref 跟踪最新值，供字段 commit 写入同一历史快照
  const settingsRef = useRef<WorkflowFormSettings>(settings ?? {});
  settingsRef.current = settings ?? {};
  // 撤销/重做历史栈（快照含字段与表单级设置，所有变更走 commit 统一入栈）
  const historyRef = useRef<HistoryState>({ stack: [{ fields, settings: settings ?? {} }], pointer: 0, lastTag: null });
  const [, bumpHistory] = useState(0);

  const selectedField = findField(fields, selectedKey ?? '');
  const flatFields = useMemo(() => collectFields(fields), [fields]);
  const duplicateLabelCount = selectedField
    ? flatFields.filter((field) => field.key !== selectedField.key && field.label === selectedField.label).length
    : 0;

  // 还原快照：同时还原字段与表单级设置
  const restore = useCallback((snap: DesignerSnapshot) => {
    onChange(snap.fields);
    onSettingsChange?.(snap.settings);
  }, [onChange, onSettingsChange]);

  // 统一提交字段变更：写入历史栈（连带当前设置）并通知父级。tag 相同的连续变更合并为一步
  const commit = useCallback((next: WorkflowFormField[], tag?: string) => {
    const h = historyRef.current;
    const snap: DesignerSnapshot = { fields: next, settings: settingsRef.current };
    const coalesce = tag != null && tag === h.lastTag && h.pointer === h.stack.length - 1;
    if (coalesce) {
      h.stack[h.pointer] = snap;
    } else {
      h.stack = h.stack.slice(0, h.pointer + 1);
      h.stack.push(snap);
      if (h.stack.length > MAX_HISTORY) h.stack.shift();
      h.pointer = h.stack.length - 1;
    }
    h.lastTag = tag ?? null;
    bumpHistory(v => v + 1);
    onChange(next);
  }, [onChange]);

  // 提交表单级设置变更（纳入历史栈）
  const commitSettings = useCallback((nextSettings: WorkflowFormSettings) => {
    const h = historyRef.current;
    settingsRef.current = nextSettings;
    h.stack = h.stack.slice(0, h.pointer + 1);
    h.stack.push({ fields, settings: nextSettings });
    if (h.stack.length > MAX_HISTORY) h.stack.shift();
    h.pointer = h.stack.length - 1;
    h.lastTag = null;
    bumpHistory(v => v + 1);
    onSettingsChange?.(nextSettings);
  }, [fields, onSettingsChange]);

  const undo = useCallback(() => {
    const h = historyRef.current;
    if (h.pointer <= 0) return;
    h.pointer -= 1;
    h.lastTag = null;
    bumpHistory(v => v + 1);
    restore(h.stack[h.pointer]);
  }, [restore]);

  const redo = useCallback(() => {
    const h = historyRef.current;
    if (h.pointer >= h.stack.length - 1) return;
    h.pointer += 1;
    h.lastTag = null;
    bumpHistory(v => v + 1);
    restore(h.stack[h.pointer]);
  }, [restore]);

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

  const selectField = useCallback((key: string) => setSelectedKey(key), []);
  const commitFields = useCallback((next: WorkflowFormField[]) => commit(next), [commit]);

  // 向外部上报撤销/重做状态与设置提交/字段定位能力（供外部工具栏与体检面板）
  useEffect(() => {
    onHistoryChange?.({ undo, redo, canUndo, canRedo, commitFields, commitSettings, selectField });
  }, [onHistoryChange, undo, redo, canUndo, canRedo, commitFields, commitSettings, selectField]);

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

  // 删除字段（任意层级）。删除前扫描依赖，提示并清理孤儿引用
  const handleRemove = useCallback((key: string) => {
    const target = findField(fields, key);
    const doRemove = () => {
      const [next] = removeField(fields, key);
      commit(pruneFieldReferences(next, key));
      if (selectedKey === key) setSelectedKey(null);
    };
    const deps = findFieldDependents(fields, key);
    if (deps.length === 0) { doRemove(); return; }
    Modal.confirm({
      title: `删除字段「${target?.label ?? key}」`,
      content: (
        <div>
          <Typography.Paragraph type="warning" style={{ marginBottom: 8 }}>
            以下 {deps.length} 个字段依赖它，删除后相关引用将被自动清理：
          </Typography.Paragraph>
          <ul style={{ margin: 0, paddingLeft: 18 }}>
            {deps.map((d) => (
              <li key={d.field.key}>
                <Typography.Text strong>{d.field.label || d.field.key}</Typography.Text>
                <Typography.Text type="tertiary" size="small">（{d.reasons.join('、')}）</Typography.Text>
              </li>
            ))}
          </ul>
        </div>
      ),
      okText: '仍然删除并清理引用',
      okButtonProps: { type: 'danger' },
      cancelText: '取消',
      onOk: doRemove,
    });
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
    let next = updateField(fields, selectedKey, updates);
    // 父字段选项变化时，裁剪依赖它的子字段级联 mapping 中的孤儿父选项键
    if (updates.options !== undefined) {
      const edited = findField(next, selectedKey);
      if (edited && (edited.type === 'select' || edited.type === 'multiSelect')) {
        const pruned = pruneCascadeMappings(next, selectedKey, edited.options ?? []);
        next = pruned.fields;
        if (pruned.affected.length > 0) {
          Toast.info(`已同步裁剪级联子字段：${pruned.affected.join('、')}`);
        }
      }
      // 选项变化时裁剪本字段联动赋值映射中的孤儿选项键
      if (edited?.autoFill) {
        const opts = new Set(edited.options ?? []);
        const byOption = Object.fromEntries(Object.entries(edited.autoFill.byOption).filter(([o]) => opts.has(o)));
        next = updateField(next, selectedKey, { autoFill: { ...edited.autoFill, byOption } });
      }
    }
    commit(next, `edit:${selectedKey}`);
  }, [fields, commit, selectedKey]);

  // 重命名字段 key：级联更新所有引用并保持选中
  const handleRenameKey = useCallback((newKey: string) => {
    if (!selectedKey || newKey === selectedKey) return;
    commit(renameFieldKey(fields, selectedKey, newKey));
    onRenameKey?.(selectedKey, newKey);
    setSelectedKey(newKey);
  }, [fields, commit, selectedKey, onRenameKey]);

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
            <>
              {duplicateLabelCount > 0 && (
                <div className="fd-form-designer__field-warning">
                  当前表单已有 {duplicateLabelCount} 个同名字段，建议调整名称以便审批条件和报表识别。
                </div>
              )}
              <FieldConfigPanel
                field={selectedField}
                allFields={fields}
                onChange={handleFieldChange}
                onRenameKey={handleRenameKey}
              />
            </>
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
