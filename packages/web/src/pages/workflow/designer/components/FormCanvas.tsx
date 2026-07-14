/**
 * 表单画布 — 字段列表 + 嵌套拖拽
 * 支持：从控件面板拖入 / 字段排序 / 跨容器移动（顶层 ↔ 分栏列 ↔ 分组）/ 选中 / 复制 / 删除。
 */
import { useCallback, useState } from 'react';
import { Popconfirm, Tag, Typography } from '@douyinfe/semi-ui';
import { GripVertical, Trash2, Asterisk, Copy } from 'lucide-react';
import type { WorkflowFormField, WorkflowFormFieldType } from '@zenith/shared';
import { FORM_FIELD_TYPES } from '../form-types';
import type { DropTarget } from '../form-tree';

interface FormCanvasProps {
  fields: WorkflowFormField[];
  selectedKey: string | null;
  onSelect: (key: string | null) => void;
  onMoveField: (moveKey: string, target: DropTarget) => void;
  onRemove: (key: string) => void;
  onCopy: (key: string) => void;
  onDropNew: (type: WorkflowFormFieldType, target: DropTarget) => void;
  /** 字段右键菜单（客户端坐标），由设计器渲染菜单 */
  onContextMenu?: (key: string, x: number, y: number) => void;
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
  selectedKey,
  onSelect,
  onMoveField,
  onRemove,
  onCopy,
  onDropNew,
  onContextMenu,
}: Readonly<FormCanvasProps>) {
  // 当前高亮的拖放区标识（如 'root:before:<key>' / 'col:<rowKey>:<i>' / 'group:<key>'）
  const [hint, setHint] = useState<string | null>(null);

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
  }, []);

  const startDrag = useCallback((e: React.DragEvent, key: string) => {
    e.stopPropagation();
    e.dataTransfer.setData('moveKey', key);
    e.dataTransfer.effectAllowed = 'move';
  }, []);

  const endDrag = useCallback(() => setHint(null), []);

  // ─── 叶子字段 chip（用于分栏列 / 分组内） ───────────────────────────
  const renderChip = (field: WorkflowFormField, target: (beforeKey: string) => DropTarget) => {
    const info = getFieldInfo(field.type);
    const Icon = info?.icon;
    const id = `chip:${field.key}`;
    return (
      <div
        key={field.key}
        role="button"
        tabIndex={0}
        data-field-key={field.key}
        className={[
          'fd-form-canvas__chip',
          selectedKey === field.key && 'fd-form-canvas__chip--selected',
          hint === id && 'fd-form-canvas__chip--drop',
        ].filter(Boolean).join(' ')}
        draggable
        onClick={(e) => { e.stopPropagation(); onSelect(field.key); }}
        onKeyDown={(e) => { if (e.key === 'Enter') { e.stopPropagation(); onSelect(field.key); } }}
        onContextMenu={(e) => contextMenu(e, field.key)}
        onDragStart={(e) => startDrag(e, field.key)}
        onDragEnd={endDrag}
        onDragOver={(e) => overZone(e, id)}
        onDrop={(e) => dispatchDrop(e, target(field.key))}
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

  // ─── 分栏列容器（可拖入） ───────────────────────────────────────────
  const renderRowColumns = (field: WorkflowFormField) => (
    <div className="fd-form-canvas__row-preview">
      {(field.columns ?? []).map((col, colIndex) => {
        const zoneId = `col:${field.key}:${colIndex}`;
        return (
          <div
            key={`${field.key}-col-${colIndex}`}
            className={['fd-form-canvas__row-col', hint === zoneId && 'fd-form-canvas__drop-active'].filter(Boolean).join(' ')}
            style={{ flex: col.span }}
            onDragOver={(e) => overZone(e, zoneId)}
            onDrop={(e) => dispatchDrop(e, { container: 'col', rowKey: field.key, colIndex })}
          >
            <span className="fd-form-canvas__row-col-label">{col.span}/24</span>
            {col.fields.length > 0
              ? col.fields.map(f => renderChip(f, (beforeKey) => ({ container: 'col', rowKey: field.key, colIndex, beforeKey })))
              : <div className="fd-form-canvas__row-col-empty">拖入字段</div>}
          </div>
        );
      })}
    </div>
  );

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
            ? field.children.map(f => renderChip(f, (beforeKey) => ({ container: 'group', groupKey: field.key, beforeKey })))
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

  // ─── 明细子字段预览（可点选配置） ────────────────────────────────────
  const renderDetail = (field: WorkflowFormField) => (
    <div className="fd-form-canvas__item-meta" style={{ flexWrap: 'wrap' }}>
      {(field.children ?? []).map(child => (
        <span key={child.key} data-field-key={child.key}>
          <Tag
            color={selectedKey === child.key ? 'light-blue' : 'blue'}
            size="small"
            style={{ cursor: 'pointer' }}
            onClick={(e) => { e.stopPropagation(); onSelect(child.key); }}
          >
            {child.label}
          </Tag>
        </span>
      ))}
    </div>
  );

  // ─── 顶层字段卡片 ───────────────────────────────────────────────────
  const renderTopItem = (field: WorkflowFormField) => {
    const info = getFieldInfo(field.type);
    const Icon = info?.icon;
    const isSelected = selectedKey === field.key;
    const beforeId = `root:before:${field.key}`;
    const isLayoutRow = field.type === 'row';
    const isLayoutGroup = field.type === 'group';
    const isPanes = field.type === 'tabs' || field.type === 'steps';
    const isDivider = field.type === 'divider';
    const isDetail = field.type === 'detail';

    return (
      <div
        key={field.key}
        role="button"
        tabIndex={0}
        data-type={field.type}
        data-field-key={field.key}
        className={[
          'fd-form-canvas__item',
          isSelected && 'fd-form-canvas__item--selected',
          hint === beforeId && 'fd-form-canvas__item--drop-target',
        ].filter(Boolean).join(' ')}
        draggable
        onClick={(e) => { e.stopPropagation(); onSelect(field.key); }}
        onKeyDown={(e) => { if (e.key === 'Enter') onSelect(field.key); }}
        onContextMenu={(e) => contextMenu(e, field.key)}
        onDragStart={(e) => startDrag(e, field.key)}
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
          {isDivider && <div className="fd-form-canvas__divider-preview"><hr /></div>}
          {isDetail && renderDetail(field)}

          {!isLayoutRow && !isLayoutGroup && !isPanes && !isDivider && !isDetail && (
            <div className="fd-form-canvas__item-meta">
              <Tag size="small" color="blue">{info?.label ?? field.type}</Tag>
              {field.placeholder && (
                <Typography.Text type="quaternary" size="small" ellipsis style={{ maxWidth: 160 }}>
                  {field.placeholder}
                </Typography.Text>
              )}
            </div>
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
    <section aria-label="表单画布" className="fd-form-canvas">
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
