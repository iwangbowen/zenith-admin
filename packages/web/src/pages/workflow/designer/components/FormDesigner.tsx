/**
 * 表单设计器主组件
 * 三栏布局：左侧控件面板 | 中间画布预览 | 右侧属性配置
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Button, Tooltip, Modal, Toast, Typography, Tabs, TabPane, Input } from '@douyinfe/semi-ui';
import { Undo2, Redo2, ArrowUp, ArrowDown, ClipboardPaste, CopyPlus, Asterisk, Trash2, Copy as CopyIcon, BookmarkPlus, Columns } from 'lucide-react';
import type { WorkflowFormField, WorkflowFormFieldType, WorkflowFormSettings } from '@zenith/shared';
import { FORM_FIELD_TYPES, COLUMN_SPAN_OPTIONS } from '../form-types';
import { findField, updateField, removeField, insertField, insertAfterKey, isDescendant, isContainerType, findFieldDependents, pruneFieldReferences, pruneCascadeMappings, renameFieldKey, moveFieldSibling, cloneFieldWithNewKeys, generateFieldKey, canNestContainer, containerHeightOf, type DropTarget } from '../form-tree';
import { saveFieldTemplate } from '../form-field-templates';
import FieldPalette from './FieldPalette';
import FormCanvas from './FormCanvas';
import FormOutline from './FormOutline';
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

const generateKey = generateFieldKey;

function getDefaultLabel(type: WorkflowFormFieldType): string {
  const info = FORM_FIELD_TYPES.find(t => t.type === type);
  return info?.label ?? '字段';
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
    case 'cascader':
      field.cascaderOptions = [
        { value: '分类1', children: [{ value: '子项1-1' }, { value: '子项1-2' }] },
        { value: '分类2', children: [{ value: '子项2-1' }] },
      ];
      break;
    case 'nps':
      field.npsMinLabel = '完全不推荐';
      field.npsMaxLabel = '强烈推荐';
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

/** 不适用「必填」的类型（布局/展示/系统生成） */
const REQUIRED_EXCLUDE = new Set<WorkflowFormFieldType>(['row', 'group', 'tabs', 'steps', 'divider', 'description', 'formula', 'serialNumber']);
const canToggleRequired = (t: WorkflowFormFieldType): boolean => !REQUIRED_EXCLUDE.has(t);

export default function FormDesigner({ fields, onChange, settings, onSettingsChange, showToolbar = true, onHistoryChange, onRenameKey }: Readonly<FormDesignerProps>) {
  const [selectedKeys, setSelectedKeys] = useState<string[]>([]);
  // 主选中（配置面板/键盘导航目标）：最后一次选中的字段
  const selectedKey = selectedKeys.length > 0 ? selectedKeys[selectedKeys.length - 1] : null;
  const selectOnly = useCallback((key: string | null) => setSelectedKeys(key ? [key] : []), []);
  // 内部剪贴板：跨容器复制/粘贴字段配置（含子字段，粘贴时重新生成 key）
  const clipboardRef = useRef<WorkflowFormField | null>(null);
  const [hasClipboard, setHasClipboard] = useState(false);
  // 画布右键菜单
  const [menu, setMenu] = useState<{ x: number; y: number; key: string } | null>(null);
  const canvasRef = useRef<HTMLDivElement>(null);
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

  const selectField = useCallback((key: string) => selectOnly(key), [selectOnly]);
  const commitFields = useCallback((next: WorkflowFormField[]) => commit(next), [commit]);

  // 向外部上报撤销/重做状态与设置提交/字段定位能力（供外部工具栏与体检面板）
  useEffect(() => {
    onHistoryChange?.({ undo, redo, canUndo, canRedo, commitFields, commitSettings, selectField });
  }, [onHistoryChange, undo, redo, canUndo, canRedo, commitFields, commitSettings, selectField]);

  // 点击左侧面板添加字段（追加到顶层末尾）
  const handleAddField = useCallback((type: WorkflowFormFieldType) => {
    const newField = createField(type);
    commit([...fields, newField]);
    selectOnly(newField.key);
  }, [fields, commit, selectOnly]);

  // 从面板拖放到画布指定位置（支持顶层 / 分栏列 / 分组 / 面板；容器按嵌套规则放行）
  const handleDropNew = useCallback((type: WorkflowFormFieldType, target: DropTarget) => {
    if (!canNestContainer(fields, target, { type, height: 1 })) {
      Toast.warning('该位置不支持放入此容器（嵌套规则/深度限制）');
      return;
    }
    const newField = createField(type);
    commit(insertField(fields, target, newField));
    selectOnly(newField.key);
  }, [fields, commit, selectOnly]);

  // 移动已有字段到目标位置（跨容器拖拽 / 排序）
  const handleMoveField = useCallback((moveKey: string, target: DropTarget) => {
    if (target.beforeKey === moveKey) return; // 拖到自身之前 = 无操作
    const moved = findField(fields, moveKey);
    if (!moved) return;
    if (target.container === 'col' && (target.rowKey === moveKey || isDescendant(fields, moveKey, target.rowKey))) return;
    if (target.container === 'group' && (target.groupKey === moveKey || isDescendant(fields, moveKey, target.groupKey))) return;
    if (target.container === 'pane' && (target.paneKey === moveKey || isDescendant(fields, moveKey, target.paneKey))) return;
    if (!canNestContainer(fields, target, { type: moved.type, height: containerHeightOf(moved) })) {
      Toast.warning('该位置不支持放入此容器（嵌套规则/深度限制）');
      return;
    }
    const [next, rm] = removeField(fields, moveKey);
    if (!rm) return;
    commit(insertField(next, target, rm));
    selectOnly(moveKey);
  }, [fields, commit, selectOnly]);

  // 删除字段（任意层级）。删除前扫描依赖，提示并清理孤儿引用
  const handleRemove = useCallback((key: string) => {
    const target = findField(fields, key);
    const doRemove = () => {
      const [next] = removeField(fields, key);
      commit(pruneFieldReferences(next, key));
      setSelectedKeys((prev) => prev.filter((k) => k !== key));
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
  }, [fields, commit]);

  // 复制字段（插入到原字段之后，任意层级）
  const handleCopy = useCallback((key: string) => {
    const target = findField(fields, key);
    if (!target) return;
    const cloned = cloneFieldWithNewKeys(target);
    commit(insertAfterKey(fields, key, cloned));
    selectOnly(cloned.key);
  }, [fields, commit, selectOnly]);

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
    selectOnly(newKey);
  }, [fields, commit, selectedKey, onRenameKey, selectOnly]);

  // ─── 画布定位 / 剪贴板 / 右键菜单 ──────────────────────────────────

  // 平滑滚动到画布中的字段卡片（大纲点击 / 键盘切换选中时定位）
  const scrollToField = useCallback((key: string) => {
    requestAnimationFrame(() => {
      canvasRef.current
        ?.querySelector(`[data-field-key="${CSS.escape(key)}"]`)
        ?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    });
  }, []);

  const copyToClipboard = useCallback((key: string) => {
    const target = findField(fields, key);
    if (!target) return;
    clipboardRef.current = structuredClone(target);
    setHasClipboard(true);
    Toast.success(`已复制「${target.label || target.key}」，Ctrl+V 粘贴`);
  }, [fields]);

  // 粘贴：普通字段插到目标字段之后；容器类字段仅允许顶层（目标在顶层则插其后，否则追加末尾）
  const pasteFromClipboard = useCallback((afterKey?: string | null) => {
    const clip = clipboardRef.current;
    if (!clip) return;
    const cloned = cloneFieldWithNewKeys(clip, false);
    let next: WorkflowFormField[];
    if (afterKey && findField(fields, afterKey)) {
      const targetAtRoot = fields.some((f) => f.key === afterKey);
      next = isContainerType(cloned.type) && !targetAtRoot
        ? [...fields, cloned]
        : insertAfterKey(fields, afterKey, cloned);
    } else {
      next = [...fields, cloned];
    }
    commit(next);
    selectOnly(cloned.key);
    scrollToField(cloned.key);
  }, [fields, commit, scrollToField, selectOnly]);

  // 同级上移 / 下移
  const handleMoveSibling = useCallback((key: string, dir: -1 | 1) => {
    const next = moveFieldSibling(fields, key, dir);
    if (next !== fields) commit(next);
  }, [fields, commit]);

  const toggleRequired = useCallback((key: string) => {
    const f = findField(fields, key);
    if (!f || !canToggleRequired(f.type)) return;
    commit(updateField(fields, key, { required: !f.required || undefined }));
  }, [fields, commit]);

  const openMenu = useCallback((key: string, x: number, y: number) => {
    setSelectedKeys((prev) => (prev.includes(key) ? prev : [key]));
    // 贴边裁剪，避免菜单溢出视口
    setMenu({ key, x: Math.min(x, window.innerWidth - 190), y: Math.min(y, window.innerHeight - 320) });
  }, []);

  // 「存为我的模板」弹窗（保存字段配置到 localStorage，供控件面板复用）
  const [tplDraft, setTplDraft] = useState<{ key: string; name: string } | null>(null);

  const saveAsTemplate = useCallback(() => {
    if (!tplDraft) return;
    const target = findField(fields, tplDraft.key);
    const name = tplDraft.name.trim();
    if (!target || !name) {
      Toast.warning('请填写模板名称');
      return;
    }
    saveFieldTemplate(name, target);
    Toast.success(`已保存模板「${name}」，可在控件面板「我的模板」中使用`);
    setTplDraft(null);
  }, [tplDraft, fields]);

  // 从「我的模板」插入字段（克隆并重置 key，追加到末尾）
  const handleAddTemplateField = useCallback((field: WorkflowFormField) => {
    const cloned = cloneFieldWithNewKeys(field, false);
    commit([...fields, cloned]);
    selectOnly(cloned.key);
    scrollToField(cloned.key);
  }, [fields, commit, scrollToField, selectOnly]);

  // 点击任意处 / 失焦关闭右键菜单
  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    window.addEventListener('mousedown', close);
    window.addEventListener('blur', close);
    return () => {
      window.removeEventListener('mousedown', close);
      window.removeEventListener('blur', close);
    };
  }, [menu]);

  const menuField = menu ? findField(fields, menu.key) : null;

  // ─── 多选（F04）：Ctrl 点选切换 / Shift 范围选 / 批量操作 ───────────────

  const handleCanvasSelect = useCallback((key: string | null, opts?: { ctrl?: boolean; shift?: boolean }) => {
    if (!key) {
      setSelectedKeys([]);
      return;
    }
    if (opts?.shift && selectedKeys.length > 0) {
      const order = flatFields.map((f) => f.key);
      const a = order.indexOf(selectedKeys[0]);
      const b = order.indexOf(key);
      if (a >= 0 && b >= 0) {
        const [s, e] = a <= b ? [a, b] : [b, a];
        setSelectedKeys(order.slice(s, e + 1));
        return;
      }
    }
    if (opts?.ctrl) {
      setSelectedKeys((prev) => (prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]));
      return;
    }
    setSelectedKeys([key]);
  }, [selectedKeys, flatFields]);

  // 批量应用属性（跳过布局/展示类）
  const batchApply = useCallback((patch: Partial<WorkflowFormField>) => {
    let next = fields;
    for (const k of selectedKeys) {
      const f = findField(next, k);
      if (f && canToggleRequired(f.type)) next = updateField(next, k, patch);
    }
    commit(next);
  }, [fields, selectedKeys, commit]);

  // 批量删除：聚合扫描选区外的依赖字段，一次确认
  const batchRemove = useCallback(() => {
    const delSet = new Set(selectedKeys);
    const outsideDeps = new Map<string, string>();
    for (const k of selectedKeys) {
      for (const d of findFieldDependents(fields, k)) {
        if (!delSet.has(d.field.key)) outsideDeps.set(d.field.key, d.field.label || d.field.key);
      }
    }
    const doRemove = () => {
      let next = fields;
      for (const k of selectedKeys) {
        const [after, rm] = removeField(next, k);
        if (rm) next = pruneFieldReferences(after, k);
      }
      commit(next);
      setSelectedKeys([]);
    };
    Modal.confirm({
      title: `删除选中的 ${selectedKeys.length} 个字段？`,
      content: outsideDeps.size > 0
        ? `以下字段依赖被删字段，相关引用将被自动清理：${Array.from(outsideDeps.values()).join('、')}`
        : '删除后可通过撤销恢复。',
      okText: '删除',
      okButtonProps: { type: 'danger' },
      cancelText: '取消',
      onOk: doRemove,
    });
  }, [fields, selectedKeys, commit]);

  // 合并为分栏：顶层 2-4 个非容器字段 → 生成均分分栏并替换原位置
  const mergeToRow = useCallback(() => {
    const allTop = selectedKeys.every((k) => fields.some((f) => f.key === k));
    const nonContainer = selectedKeys.every((k) => {
      const f = findField(fields, k);
      return f != null && !isContainerType(f.type);
    });
    if (!allTop || !nonContainer || selectedKeys.length < 2 || selectedKeys.length > 4) {
      Toast.warning('仅支持选中顶层的 2-4 个非容器字段合并为分栏');
      return;
    }
    const picked = new Set(selectedKeys);
    const ordered = fields.filter((f) => picked.has(f.key));
    const span = ordered.length === 2 ? 12 : ordered.length === 3 ? 8 : 6;
    const rowField: WorkflowFormField = {
      key: generateFieldKey('row'),
      label: '分栏',
      type: 'row',
      columns: ordered.map((f) => ({ span, fields: [f] })),
    };
    const firstIdx = fields.findIndex((f) => f.key === ordered[0].key);
    const rest = fields.filter((f) => !picked.has(f.key));
    const insertAt = fields.slice(0, firstIdx).filter((f) => !picked.has(f.key)).length;
    commit([...rest.slice(0, insertAt), rowField, ...rest.slice(insertAt)]);
    selectOnly(rowField.key);
  }, [fields, selectedKeys, commit, selectOnly]);

  // 画布内联属性更新（列宽拖拽等），tag 合并连续变更为一步撤销
  const handleCanvasUpdateField = useCallback((key: string, updates: Partial<WorkflowFormField>, tag?: string) => {
    commit(updateField(fields, key, updates), tag);
  }, [fields, commit]);

  // 键盘操作：Delete 删除（多选批量）、Ctrl/Cmd+C/V 复制粘贴、↑/↓ 切换选中、Esc 取消选中（输入框聚焦时不拦截）
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const ae = document.activeElement as HTMLElement | null;
      const tag = ae?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || ae?.isContentEditable) return;
      if (e.ctrlKey || e.metaKey) {
        const k = e.key.toLowerCase();
        if (k === 'c' && selectedKey) {
          if (window.getSelection()?.toString()) return; // 正在复制文本选区，不拦截
          e.preventDefault();
          copyToClipboard(selectedKey);
        } else if (k === 'v' && clipboardRef.current) {
          e.preventDefault();
          pasteFromClipboard(selectedKey);
        }
        return;
      }
      if (e.key === 'Escape') {
        setMenu(null);
        selectOnly(null);
        return;
      }
      if (!selectedKey) return;
      if (e.key === 'Delete') {
        e.preventDefault();
        if (selectedKeys.length > 1) batchRemove();
        else handleRemove(selectedKey);
        return;
      }
      if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
        e.preventDefault();
        const keys = flatFields.map((f) => f.key);
        const idx = keys.indexOf(selectedKey);
        if (idx < 0) return;
        const nextKey = keys[e.key === 'ArrowUp' ? Math.max(0, idx - 1) : Math.min(keys.length - 1, idx + 1)];
        if (nextKey !== selectedKey) {
          selectOnly(nextKey);
          scrollToField(nextKey);
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selectedKey, selectedKeys, flatFields, copyToClipboard, pasteFromClipboard, handleRemove, batchRemove, scrollToField, selectOnly]);

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
        {/* 左侧：控件面板 / 大纲树 */}
        <div className="fd-form-designer__palette">
          <Tabs type="line" size="small" className="fd-form-designer__palette-tabs" lazyRender>
            <TabPane tab="控件" itemKey="palette">
              <FieldPalette onAddField={handleAddField} onAddTemplateField={handleAddTemplateField} />
            </TabPane>
            <TabPane tab="大纲" itemKey="outline">
              <FormOutline
                fields={fields}
                selectedKey={selectedKey}
                onSelect={(key) => { selectOnly(key); scrollToField(key); }}
              />
            </TabPane>
          </Tabs>
        </div>

        {/* 中间：画布 */}
        <div className="fd-form-designer__canvas" ref={canvasRef}>
          <FormCanvas
            fields={fields}
            selectedKeys={selectedKeys}
            onSelect={handleCanvasSelect}
            onMoveField={handleMoveField}
            onRemove={handleRemove}
            onCopy={handleCopy}
            onDropNew={handleDropNew}
            onContextMenu={openMenu}
            onUpdateField={handleCanvasUpdateField}
          />
        </div>

        {/* 右侧：属性配置 / 多选批量操作 */}
        <div className="fd-form-designer__config">
          {selectedKeys.length > 1 ? (
            <div className="fd-form-batch">
              <Typography.Text strong>已选中 {selectedKeys.length} 个字段</Typography.Text>
              <Typography.Text type="tertiary" size="small" style={{ display: 'block', margin: '4px 0 12px' }}>
                Ctrl+点击 增减选择，Shift+点击 范围选择
              </Typography.Text>
              <div className="fd-form-batch__section">
                <Typography.Text strong size="small">字段宽度</Typography.Text>
                <div className="fd-form-batch__row">
                  {COLUMN_SPAN_OPTIONS.map((opt) => (
                    <Button key={opt.value} size="small" type="tertiary" onClick={() => batchApply({ columnSpan: opt.value === 24 ? undefined : opt.value })}>
                      {opt.label}
                    </Button>
                  ))}
                </div>
              </div>
              <div className="fd-form-batch__section">
                <Typography.Text strong size="small">批量设置</Typography.Text>
                <div className="fd-form-batch__row">
                  <Button size="small" type="tertiary" onClick={() => batchApply({ required: true })}>设为必填</Button>
                  <Button size="small" type="tertiary" onClick={() => batchApply({ required: undefined })}>取消必填</Button>
                  <Button size="small" type="tertiary" onClick={() => batchApply({ readOnly: true })}>设为只读</Button>
                  <Button size="small" type="tertiary" onClick={() => batchApply({ readOnly: undefined })}>取消只读</Button>
                </div>
              </div>
              <div className="fd-form-batch__section">
                <Typography.Text strong size="small">结构操作</Typography.Text>
                <div className="fd-form-batch__row">
                  <Button size="small" type="primary" theme="light" icon={<Columns size={13} />} onClick={mergeToRow}>合并为分栏</Button>
                  <Button size="small" type="danger" theme="light" icon={<Trash2 size={13} />} onClick={batchRemove}>批量删除</Button>
                </div>
              </div>
              <Button size="small" type="tertiary" theme="borderless" onClick={() => setSelectedKeys([])}>取消多选（Esc）</Button>
            </div>
          ) : selectedField ? (
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

      {/* 画布右键菜单 */}
      {menu && menuField && (
        <div
          className="fd-form-menu"
          style={{ left: menu.x, top: menu.y }}
          role="menu"
          onMouseDown={(e) => e.stopPropagation()}
          onContextMenu={(e) => e.preventDefault()}
        >
          <button type="button" className="fd-form-menu__item" onClick={() => { handleMoveSibling(menu.key, -1); setMenu(null); }}>
            <ArrowUp size={13} /> 上移
          </button>
          <button type="button" className="fd-form-menu__item" onClick={() => { handleMoveSibling(menu.key, 1); setMenu(null); }}>
            <ArrowDown size={13} /> 下移
          </button>
          <div className="fd-form-menu__divider" />
          <button type="button" className="fd-form-menu__item" onClick={() => { copyToClipboard(menu.key); setMenu(null); }}>
            <CopyIcon size={13} /> 复制 <span className="fd-form-menu__hint">Ctrl+C</span>
          </button>
          <button
            type="button"
            className="fd-form-menu__item"
            disabled={!hasClipboard}
            onClick={() => { pasteFromClipboard(menu.key); setMenu(null); }}
          >
            <ClipboardPaste size={13} /> 粘贴到其后 <span className="fd-form-menu__hint">Ctrl+V</span>
          </button>
          <button type="button" className="fd-form-menu__item" onClick={() => { handleCopy(menu.key); setMenu(null); }}>
            <CopyPlus size={13} /> 创建副本
          </button>
          <button
            type="button"
            className="fd-form-menu__item"
            onClick={() => { setTplDraft({ key: menu.key, name: menuField.label || '' }); setMenu(null); }}
          >
            <BookmarkPlus size={13} /> 存为我的模板
          </button>
          {canToggleRequired(menuField.type) && (
            <>
              <div className="fd-form-menu__divider" />
              <button type="button" className="fd-form-menu__item" onClick={() => { toggleRequired(menu.key); setMenu(null); }}>
                <Asterisk size={13} /> {menuField.required ? '取消必填' : '设为必填'}
              </button>
            </>
          )}
          <div className="fd-form-menu__divider" />
          <button
            type="button"
            className="fd-form-menu__item fd-form-menu__item--danger"
            onClick={() => { handleRemove(menu.key); setMenu(null); }}
          >
            <Trash2 size={13} /> 删除 <span className="fd-form-menu__hint">Del</span>
          </button>
        </div>
      )}

      {/* 存为我的模板 */}
      <Modal
        title="存为我的模板"
        visible={tplDraft != null}
        onCancel={() => setTplDraft(null)}
        onOk={saveAsTemplate}
        okText="保存"
        cancelText="取消"
        width={400}
        closeOnEsc
      >
        <Typography.Text type="tertiary" size="small" style={{ display: 'block', marginBottom: 8 }}>
          将当前字段（含校验、联动等全部配置）保存到本地模板库，插入时自动重新生成字段标识。
        </Typography.Text>
        <Input
          value={tplDraft?.name ?? ''}
          onChange={(v) => setTplDraft((prev) => (prev ? { ...prev, name: v } : prev))}
          placeholder="模板名称"
          onEnterPress={saveAsTemplate}
        />
      </Modal>
    </div>
  );
}
