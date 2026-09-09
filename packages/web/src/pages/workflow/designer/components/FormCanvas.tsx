/**
 * 表单画布 — 字段列表 + 嵌套拖拽
 * 支持：从控件面板拖入 / 字段排序 / 跨容器移动（顶层 ↔ 分栏列 ↔ 分组）/ 选中 / 复制 / 删除。
 */
import { useCallback, useMemo, useRef, useState } from 'react';
import { useThrottledCallback } from '@tanstack/react-pacer';
import { Divider, Popconfirm, Tag, Typography } from '@douyinfe/semi-ui';
import { GripVertical, Trash2, Asterisk, Copy } from 'lucide-react';
import type { WorkflowFormField, WorkflowFormFieldType } from '@zenith/shared/workflow';
import { FORM_FIELD_TYPES } from '../form-types';
import { isContainerType, flattenAllFields, type DropTarget } from '../form-tree';
import CanvasFieldPreview from './CanvasFieldPreview';

/** 顶层字段超过该数量时降级为简洁卡片模式（关闭真实控件预览，保证大表单流畅） */
const WYSIWYG_FIELD_LIMIT = 80;

interface FormCanvasProps {
  fields: WorkflowFormField[];
  /** 选中字段集合（多选），最后一项为主选中 */
  selectedKeys: string[];
  onSelect: (key: string | null, opts?: { ctrl?: boolean; shift?: boolean }) => void;
  onMoveField: (moveKey: string, target: DropTarget) => void;
  onRemove: (key: string) => void;
  onCopy: (key: string) => void;
  onDropNew: (type: WorkflowFormFieldType, target: DropTarget) => void;
  /** 字段右键菜单（客户端坐标），由设计器渲染菜单 */
  onContextMenu?: (key: string, x: number, y: number) => void;
  /** 字段属性更新（列宽拖拽结束、双击均分等画布内联编辑），每次调用即一步可撤销的变更 */
  onUpdateField?: (key: string, updates: Partial<WorkflowFormField>) => void;
}

const getFieldInfo = (type: WorkflowFormFieldType) => FORM_FIELD_TYPES.find(t => t.type === type);

const hasNestedFields = (field: WorkflowFormField) =>
  (field.children?.length ?? 0) > 0
  || (field.columns?.some((column) => column.fields.length > 0) ?? false)
  || (field.panes?.some((pane) => pane.fields.length > 0) ?? false);

const deleteTitle = (field: WorkflowFormField) =>
  hasNestedFields(field) ? `删除「${field.label}」及其内部字段？` : `删除字段「${field.label}」？`;

function readPayload(e: React.DragEvent): { type?: WorkflowFormFieldType; moveKey?: string } {
  const type = e.dataTransfer.getData('fieldType');
  if (type) return { type: type as WorkflowFormFieldType };
  const moveKey = e.dataTransfer.getData('moveKey');
  if (moveKey) return { moveKey };
  return {};
}

const hasDragData = (e: React.DragEvent) =>
  e.dataTransfer.types.includes('fieldtype') || e.dataTransfer.types.includes('movekey');

export default function FormCanvas({
  fields,
  selectedKeys,
  onSelect,
  onMoveField,
  onRemove,
  onCopy,
  onDropNew,
  onContextMenu,
  onUpdateField,
}: Readonly<FormCanvasProps>) {
  // 当前高亮的拖放区标识（如 'root:before:<key>' / 'col:<rowKey>:<i>' / 'group:<key>'）
  const [hint, setHint] = useState<string | null>(null);
  // 分栏列宽拖拽中的临时列宽：只存在于画布本地，松开鼠标才提交到字段树
  const [liveCols, setLiveCols] = useState<{ rowKey: string; spans: number[] } | null>(null);
  const rootRef = useRef<HTMLElement>(null);
  const ghostRef = useRef<HTMLDivElement | null>(null);
  // 边缘自动滚动（F05）：靠近画布容器上下边时滚动，16ms 前沿节流
  const autoScrollOnDrag = useThrottledCallback((clientY: number) => {
    const scroller = rootRef.current?.parentElement;
    if (!scroller) return;
    const rect = scroller.getBoundingClientRect();
    if (clientY < rect.top + 48) scroller.scrollBy({ top: -14 });
    else if (clientY > rect.bottom - 48) scroller.scrollBy({ top: 14 });
  }, { wait: 16, leading: true, trailing: false });

  // 大表单降级：字段总数超限时关闭真实控件预览
  const wysiwyg = useMemo(() => flattenAllFields(fields).length <= WYSIWYG_FIELD_LIMIT, [fields]);

  const isSelectedKey = useCallback((key: string) => selectedKeys.includes(key), [selectedKeys]);

  // 点击选中（携带 Ctrl/Shift 修饰，供多选）
  const clickSelect = useCallback((e: React.MouseEvent, key: string) => {
    e.stopPropagation();
    onSelect(key, { ctrl: e.ctrlKey || e.metaKey, shift: e.shiftKey });
  }, [onSelect]);

  const contextMenu = useCallback((e: React.MouseEvent, key: string) => {
    if (!onContextMenu) return;
    e.preventDefault();
    e.stopPropagation();
    onContextMenu(key, e.clientX, e.clientY);
  }, [onContextMenu]);

  const dispatchDrop = useCallback((e: React.DragEvent, target: DropTarget) => {
    e.preventDefault();
    e.stopPropagation();
    setHint(null);
    const { type, moveKey } = readPayload(e);
    if (type) onDropNew(type, target);
    else if (moveKey) onMoveField(moveKey, target);
  }, [onDropNew, onMoveField]);

  const overZone = useCallback((e: React.DragEvent, id: string) => {
    if (!hasDragData(e)) return;
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = e.dataTransfer.types.includes('fieldtype') ? 'copy' : 'move';
    setHint(prev => (prev === id ? prev : id));
    autoScrollOnDrag(e.clientY);
  }, [autoScrollOnDrag]);

  // 拖拽浮签（F05）：图标+字段名的自定义 drag image
  const startDrag = useCallback((e: React.DragEvent, key: string, label?: string) => {
    e.stopPropagation();
    e.dataTransfer.setData('moveKey', key);
    e.dataTransfer.effectAllowed = 'move';
    const ghost = document.createElement('div');
    ghost.className = 'fd-drag-ghost';
    ghost.textContent = label || key;
    document.body.appendChild(ghost);
    ghostRef.current = ghost;
    e.dataTransfer.setDragImage(ghost, 14, 16);
  }, []);

  const endDrag = useCallback(() => {
    setHint(null);
    ghostRef.current?.remove();
    ghostRef.current = null;
  }, []);

  // 分栏列宽拖拽（F06）：拖动分隔线按 24 栅格换算相邻两列 span；双击均分。
  // 拖动期间只更新画布本地的临时列宽（同一整数 span 不重复 setState），松开时一次性提交：
  // 历史栈只记一步，父级 onChange / 体检 / 差异对比只在提交时跑一次，而不是每个 mousemove 都跑。
  const startColResize = useCallback((e: React.MouseEvent, field: WorkflowFormField, colIndex: number) => {
    if (!onUpdateField) return;
    e.preventDefault();
    e.stopPropagation();
    // 换算基准是整行宽度：分隔线挂在列元素内部，取 parentElement 会拿到列宽，拖动灵敏度随列数放大
    const rowEl = (e.currentTarget as HTMLElement).closest<HTMLElement>('.fd-form-canvas__row-preview');
    const cols = field.columns ?? [];
    if (!rowEl || colIndex >= cols.length - 1) return;
    const totalPx = rowEl.getBoundingClientRect().width;
    const totalSpan = cols.reduce((s, c) => s + c.span, 0) || 24;
    const startX = e.clientX;
    const left0 = cols[colIndex].span;
    const pairSpan = left0 + cols[colIndex + 1].span;
    let left = left0;
    const spansFor = (l: number) => cols.map((c, i) => (i === colIndex ? l : i === colIndex + 1 ? pairSpan - l : c.span));
    const onMove = (me: MouseEvent) => {
      const deltaSpan = Math.round(((me.clientX - startX) / totalPx) * totalSpan);
      const next = Math.min(Math.max(4, left0 + deltaSpan), pairSpan - 4);
      if (next === left) return;
      left = next;
      setLiveCols({ rowKey: field.key, spans: spansFor(left) });
    };
    const finish = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', finish);
      window.removeEventListener('blur', finish);
      setLiveCols(null);
      if (left === left0) return;
      onUpdateField(field.key, {
        columns: cols.map((c, i) => (i === colIndex ? { ...c, span: left } : i === colIndex + 1 ? { ...c, span: pairSpan - left } : c)),
      });
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', finish);
    // 鼠标在窗口外松开时收不到 mouseup，窗口失焦即结束拖拽
    window.addEventListener('blur', finish);
  }, [onUpdateField]);

  const equalizeCols = useCallback((field: WorkflowFormField) => {
    if (!onUpdateField) return;
    const cols = field.columns ?? [];
    if (cols.length === 0) return;
    const base = Math.floor(24 / cols.length);
    const next = cols.map((c, i) => ({ ...c, span: i === 0 ? 24 - base * (cols.length - 1) : base }));
    onUpdateField(field.key, { columns: next });
  }, [onUpdateField]);

  // ─── 叶子 chip 与嵌套容器共用的可选中 / 可拖拽 / 可投放行为 ─────────
  const draggableNodeProps = (field: WorkflowFormField, id: string, target: (beforeKey: string) => DropTarget) => ({
    role: 'button' as const,
    tabIndex: 0,
    'data-field-key': field.key,
    draggable: true,
    onClick: (e: React.MouseEvent) => clickSelect(e, field.key),
    onKeyDown: (e: React.KeyboardEvent) => { if (e.key === 'Enter') { e.stopPropagation(); onSelect(field.key); } },
    onContextMenu: (e: React.MouseEvent) => contextMenu(e, field.key),
    onDragStart: (e: React.DragEvent) => startDrag(e, field.key, field.label),
    onDragEnd: endDrag,
    onDragOver: (e: React.DragEvent) => overZone(e, id),
    onDrop: (e: React.DragEvent) => dispatchDrop(e, target(field.key)),
  });

  // ─── 叶子字段 chip（用于分栏列 / 分组内） ───────────────────────────
  const renderChip = (field: WorkflowFormField, target: (beforeKey: string) => DropTarget) => {
    const info = getFieldInfo(field.type);
    const Icon = info?.icon;
    const id = `chip:${field.key}`;
    return (
      <div
        key={field.key}
        className={[
          'fd-form-canvas__chip',
          isSelectedKey(field.key) && 'fd-form-canvas__chip--selected',
          hint === id && 'fd-form-canvas__chip--drop',
        ].filter(Boolean).join(' ')}
        {...draggableNodeProps(field, id, target)}
      >
        {Icon && <Icon size={12} className="fd-form-canvas__chip-icon" />}
        <span className="fd-form-canvas__chip-label">
          {field.required && <Asterisk size={9} style={{ color: 'var(--semi-color-danger)' }} />}
          {field.label}
        </span>
        <Popconfirm title={deleteTitle(field)} okText="删除" cancelText="取消" onConfirm={() => onRemove(field.key)}>
          <button
            type="button"
            className="fd-form-canvas__chip-del"
            title="删除字段"
            onClick={(e) => { e.stopPropagation(); }}
          >
            <Trash2 size={12} />
          </button>
        </Popconfirm>
      </div>
    );
  };

  // ─── 嵌套容器（分栏列内的分组/明细、分组内的分栏/明细）───────────────
  const renderNestedContainer = (field: WorkflowFormField, target: (beforeKey: string) => DropTarget) => {
    const info = getFieldInfo(field.type);
    const Icon = info?.icon;
    const id = `chip:${field.key}`;
    return (
      <div
        key={field.key}
        className={[
          'fd-form-canvas__nested',
          isSelectedKey(field.key) && 'fd-form-canvas__nested--selected',
          hint === id && 'fd-form-canvas__chip--drop',
        ].filter(Boolean).join(' ')}
        {...draggableNodeProps(field, id, target)}
      >
        <div className="fd-form-canvas__nested-head">
          {Icon && <Icon size={12} />}
          <span>{field.label}</span>
        </div>
        {field.type === 'row' && renderRowColumns(field)}
        {field.type === 'group' && renderGroupBody(field)}
        {field.type === 'detail' && renderDetail(field)}
      </div>
    );
  };

  // 容器子项分发：可嵌套容器走容器渲染，其余走 chip
  const renderInner = (f: WorkflowFormField, target: (beforeKey: string) => DropTarget) =>
    isContainerType(f.type) && f.type !== 'tabs' && f.type !== 'steps'
      ? renderNestedContainer(f, target)
      : renderChip(f, target);

  // ─── 分栏列容器（可拖入 + 分隔线拖拽调宽） ──────────────────────────
  const renderRowColumns = (field: WorkflowFormField) => {
    const dragging = liveCols?.rowKey === field.key ? liveCols.spans : null;
    return (
      <div className="fd-form-canvas__row-preview">
        {(field.columns ?? []).map((col, colIndex) => {
          const zoneId = `col:${field.key}:${colIndex}`;
          const isLast = colIndex === (field.columns?.length ?? 0) - 1;
          const span = dragging?.[colIndex] ?? col.span;
          return (
            <div
              key={`${field.key}-col-${colIndex}`}
              className={['fd-form-canvas__row-col', hint === zoneId && 'fd-form-canvas__drop-active'].filter(Boolean).join(' ')}
              style={{ flex: span }}
              onDragOver={(e) => overZone(e, zoneId)}
              onDrop={(e) => dispatchDrop(e, { container: 'col', rowKey: field.key, colIndex })}
            >
              <span className="fd-form-canvas__row-col-label">{span}/24</span>
              {col.fields.length > 0
                ? col.fields.map(f => renderInner(f, (beforeKey) => ({ container: 'col', rowKey: field.key, colIndex, beforeKey })))
                : <div className="fd-form-canvas__row-col-empty">拖入字段</div>}
              {!isLast && onUpdateField && (
                <div
                  className="fd-form-canvas__col-resizer"
                  role="separator"
                  aria-label="拖拽调整列宽，双击均分"
                  title="拖拽调整列宽，双击均分"
                  onMouseDown={(e) => startColResize(e, field, colIndex)}
                  onDoubleClick={(e) => { e.stopPropagation(); equalizeCols(field); }}
                />
              )}
            </div>
          );
        })}
      </div>
    );
  };

  // ─── 分组容器（可拖入） ─────────────────────────────────────────────
  const renderGroupBody = (field: WorkflowFormField) => {
    const zoneId = `group:${field.key}`;
    return (
      <div className="fd-form-canvas__group-preview">
        <div className="fd-form-canvas__group-title">{field.title || '分组标题'}</div>
        <div
          className={['fd-form-canvas__group-body', hint === zoneId && 'fd-form-canvas__drop-active'].filter(Boolean).join(' ')}
          onDragOver={(e) => overZone(e, zoneId)}
          onDrop={(e) => dispatchDrop(e, { container: 'group', groupKey: field.key })}
        >
          {(field.children && field.children.length > 0)
            ? field.children.map(f => renderInner(f, (beforeKey) => ({ container: 'group', groupKey: field.key, beforeKey })))
            : <div className="fd-form-canvas__group-empty">拖入字段</div>}
        </div>
      </div>
    );
  };

  // ─── 标签页 / 分步 面板容器（可拖入） ─────────────────────────────
  const renderPanes = (field: WorkflowFormField) => {
    const isSteps = field.type === 'steps';
    return (
      <div className={`fd-form-canvas__panes ${isSteps ? 'fd-form-canvas__panes--steps' : ''}`}>
        {(field.panes ?? []).map((pane, paneIndex) => {
          const zoneId = `pane:${field.key}:${paneIndex}`;
          return (
            <div key={`${field.key}-pane-${paneIndex}`} className="fd-form-canvas__pane">
              <div className="fd-form-canvas__pane-title">
                {isSteps && <span className="fd-form-canvas__pane-step">{paneIndex + 1}</span>}
                {pane.title || (isSteps ? `步骤${paneIndex + 1}` : `标签${paneIndex + 1}`)}
              </div>
              <div
                className={['fd-form-canvas__pane-body', hint === zoneId && 'fd-form-canvas__drop-active'].filter(Boolean).join(' ')}
                onDragOver={(e) => overZone(e, zoneId)}
                onDrop={(e) => dispatchDrop(e, { container: 'pane', paneKey: field.key, paneIndex })}
              >
                {pane.fields.length > 0
                  ? pane.fields.map(f => renderChip(f, (beforeKey) => ({ container: 'pane', paneKey: field.key, paneIndex, beforeKey })))
                  : <div className="fd-form-canvas__row-col-empty">拖入字段</div>}
              </div>
            </div>
          );
        })}
      </div>
    );
  };

  // ─── 明细子字段预览（列头表格样式，可点选配置） ──────────────────────
  const renderDetail = (field: WorkflowFormField) => (
    <div className="fd-form-canvas__detail-preview">
      <div className="fd-form-canvas__detail-head">
        {(field.children ?? []).map(child => (
          <button
            key={child.key}
            type="button"
            data-field-key={child.key}
            className={[
              'fd-form-canvas__detail-col',
              isSelectedKey(child.key) && 'fd-form-canvas__detail-col--selected',
            ].filter(Boolean).join(' ')}
            style={child.detailColumnWidth ? { flex: `0 0 ${child.detailColumnWidth}px` } : undefined}
            onClick={(e) => clickSelect(e, child.key)}
          >
            {child.label}
            {child.detailSummary && <span className="fd-form-canvas__detail-flag">Σ</span>}
            {child.unique && <span className="fd-form-canvas__detail-flag">唯</span>}
          </button>
        ))}
      </div>
      <div className="fd-form-canvas__detail-row">点击列头配置子字段 · 填写时可增删行 / 粘贴 Excel</div>
    </div>
  );

  // ─── 顶层字段卡片 ───────────────────────────────────────────────────
  const renderTopItem = (field: WorkflowFormField) => {
    const info = getFieldInfo(field.type);
    const Icon = info?.icon;
    const isSelected = isSelectedKey(field.key);
    const beforeId = `root:before:${field.key}`;
    const isLayoutRow = field.type === 'row';
    const isLayoutGroup = field.type === 'group';
    const isPanes = field.type === 'tabs' || field.type === 'steps';
    const isDivider = field.type === 'divider';
    const isDetail = field.type === 'detail';
    // 响应式列宽（F01）：预览模式下按 columnSpan 真实并排
    const span = wysiwyg && !isContainerType(field.type) && field.columnSpan ? field.columnSpan : 24;
    const itemStyle = span < 24
      ? { flex: `0 0 calc(${(span / 24) * 100}% - 6px)`, maxWidth: `calc(${(span / 24) * 100}% - 6px)` }
      : { flex: '1 1 100%', maxWidth: '100%' };

    return (
      <div
        key={field.key}
        role="button"
        tabIndex={0}
        data-type={field.type}
        data-field-key={field.key}
        style={itemStyle}
        className={[
          'fd-form-canvas__item',
          isSelected && 'fd-form-canvas__item--selected',
          hint === beforeId && 'fd-form-canvas__item--drop-target',
        ].filter(Boolean).join(' ')}
        draggable
        onClick={(e) => clickSelect(e, field.key)}
        onKeyDown={(e) => { if (e.key === 'Enter') onSelect(field.key); }}
        onContextMenu={(e) => contextMenu(e, field.key)}
        onDragStart={(e) => startDrag(e, field.key, field.label)}
        onDragEnd={endDrag}
        onDragOver={(e) => overZone(e, beforeId)}
        onDrop={(e) => dispatchDrop(e, { container: 'root', beforeKey: field.key })}
      >
        <div className="fd-form-canvas__item-grip"><GripVertical size={14} /></div>
        <div className="fd-form-canvas__item-icon">{Icon && <Icon size={14} />}</div>

        <div className="fd-form-canvas__item-body">
          <div className="fd-form-canvas__item-label">
            {field.required && <Asterisk size={10} style={{ color: 'var(--semi-color-danger)' }} />}
            {field.label}
          </div>

          {isLayoutRow && renderRowColumns(field)}
          {isLayoutGroup && renderGroupBody(field)}
          {isPanes && renderPanes(field)}
          {isDivider && <div className="fd-form-canvas__divider-preview"><Divider margin={0} /></div>}
          {isDetail && renderDetail(field)}

          {!isLayoutRow && !isLayoutGroup && !isPanes && !isDivider && !isDetail && (
            wysiwyg ? (
              // 所见即所得：渲染真实控件外观（交互关闭，选中/拖拽由卡片壳接管）
              <div className="fd-form-canvas__control">
                <CanvasFieldPreview field={field} />
              </div>
            ) : (
              <div className="fd-form-canvas__item-meta">
                <Tag size="small" color="blue">{info?.label ?? field.type}</Tag>
                {field.placeholder && (
                  <Typography.Text type="quaternary" size="small" ellipsis style={{ maxWidth: 160 }}>
                    {field.placeholder}
                  </Typography.Text>
                )}
              </div>
            )
          )}
        </div>

        <div className="fd-form-canvas__item-actions">
          <button type="button" className="fd-form-canvas__item-action" title="复制字段"
            onClick={(e) => { e.stopPropagation(); onCopy(field.key); }}>
            <Copy size={14} />
          </button>
          <Popconfirm title={deleteTitle(field)} okText="删除" cancelText="取消" onConfirm={() => onRemove(field.key)}>
            <button type="button" className="fd-form-canvas__item-action fd-form-canvas__item-delete" title="删除字段"
              onClick={(e) => { e.stopPropagation(); }}>
              <Trash2 size={14} />
            </button>
          </Popconfirm>
        </div>
      </div>
    );
  };

  // 空画布
  if (fields.length === 0) {
    return (
      <section
        ref={rootRef}
        aria-label="表单画布"
        className={['fd-form-canvas', 'fd-form-canvas--empty', hint === 'root:append' && 'fd-form-canvas--drop'].filter(Boolean).join(' ')}
        onDragOver={(e) => overZone(e, 'root:append')}
        onDrop={(e) => dispatchDrop(e, { container: 'root' })}
      >
        <div className="fd-form-canvas__placeholder">
          <Typography.Text type="tertiary">从左侧点击或拖拽控件到此处</Typography.Text>
        </div>
      </section>
    );
  }

  return (
    <section ref={rootRef} aria-label="表单画布" className="fd-form-canvas">
      <div className="fd-form-canvas__title">
        <Typography.Title heading={5} style={{ margin: 0 }}>表单预览</Typography.Title>
        <Typography.Text type="tertiary" size="small">{fields.length} 个顶层字段</Typography.Text>
      </div>

      <div className="fd-form-canvas__list">
        {fields.map(renderTopItem)}
        {/* 末尾追加区 */}
        <div
          className={['fd-form-canvas__append', hint === 'root:append' && 'fd-form-canvas__append--drop'].filter(Boolean).join(' ')}
          onDragOver={(e) => overZone(e, 'root:append')}
          onDrop={(e) => dispatchDrop(e, { container: 'root' })}
        >
          拖拽控件到此处添加到末尾
        </div>
      </div>
    </section>
  );
}
