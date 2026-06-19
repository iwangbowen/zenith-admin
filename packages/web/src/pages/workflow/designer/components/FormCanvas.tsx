/**
 * 表单画布 — 展示已添加的字段列表，支持拖拽排序、选中、删除
 */
import { useCallback, useRef, useState } from 'react';
import { Tag, Typography } from '@douyinfe/semi-ui';
import { GripVertical, Trash2, Asterisk, Copy } from 'lucide-react';
import type { WorkflowFormField, WorkflowFormFieldColumn, WorkflowFormFieldType } from '@zenith/shared';
import { FORM_FIELD_TYPES } from '../form-types';

const getColumnKey = (parentKey: string, column: WorkflowFormFieldColumn) =>
  `${parentKey}-col-${column.span}-${column.fields.map(field => field.key).join('-') || 'empty'}`;

interface FormCanvasProps {
  fields: WorkflowFormField[];
  selectedKey: string | null;
  onSelect: (key: string | null) => void;
  onReorder: (fields: WorkflowFormField[]) => void;
  onRemove: (key: string) => void;
  onCopy: (key: string) => void;
  onDropNew: (type: WorkflowFormFieldType, index: number) => void;
}

export default function FormCanvas({
  fields,
  selectedKey,
  onSelect,
  onReorder,
  onRemove,
  onCopy,
  onDropNew,
}: Readonly<FormCanvasProps>) {

  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [dropIndex, setDropIndex] = useState<number | null>(null);
  const dragCounter = useRef(0);

  const getFieldInfo = (type: WorkflowFormFieldType) =>
    FORM_FIELD_TYPES.find(t => t.type === type);

  const handleFieldButtonClick = useCallback((e: React.MouseEvent<HTMLElement>) => {
    e.stopPropagation();
    const fieldKey = e.currentTarget.dataset.fieldKey;
    if (fieldKey) {
      onSelect(fieldKey);
    }
  }, [onSelect]);

  // ─── 内部排序拖拽 ─────────────────────────────────────────

  const handleDragStart = useCallback((e: React.DragEvent, index: number) => {
    e.dataTransfer.setData('dragIndex', String(index));
    e.dataTransfer.effectAllowed = 'move';
    setDragIndex(index);
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent, index: number) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = e.dataTransfer.types.includes('fieldtype') ? 'copy' : 'move';
    setDropIndex(index);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent, targetIndex: number) => {
    e.preventDefault();

    // 从面板拖入新字段
    const newFieldType = e.dataTransfer.getData('fieldType') as WorkflowFormFieldType;
    if (newFieldType) {
      onDropNew(newFieldType, targetIndex);
      setDragIndex(null);
      setDropIndex(null);
      return;
    }

    // 内部排序
    const sourceIndex = Number.parseInt(e.dataTransfer.getData('dragIndex'), 10);
    if (Number.isNaN(sourceIndex) || sourceIndex === targetIndex) {
      setDragIndex(null);
      setDropIndex(null);
      return;
    }

    const updated = [...fields];
    const [moved] = updated.splice(sourceIndex, 1);
    updated.splice(targetIndex, 0, moved);
    onReorder(updated);
    setDragIndex(null);
    setDropIndex(null);
  }, [fields, onReorder, onDropNew]);

  const handleDragEnd = useCallback(() => {
    setDragIndex(null);
    setDropIndex(null);
  }, []);

  // ─── 画布级拖放（空白区域接受从面板拖入） ──────────────────

  const handleCanvasDragEnter = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    dragCounter.current++;
  }, []);

  const handleCanvasDragLeave = useCallback(() => {
    dragCounter.current--;
    if (dragCounter.current === 0) setDropIndex(null);
  }, []);

  const handleCanvasDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    if (e.dataTransfer.types.includes('fieldtype')) {
      e.dataTransfer.dropEffect = 'copy';
    }
  }, []);

  const handleCanvasDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    dragCounter.current = 0;
    const newFieldType = e.dataTransfer.getData('fieldType') as WorkflowFormFieldType;
    if (newFieldType) {
      onDropNew(newFieldType, fields.length);
    }
    setDropIndex(null);
  }, [fields.length, onDropNew]);

  // ─── 渲染 ─────────────────────────────────────────────────

  if (fields.length === 0) {
    return (
      <section
        aria-label="表单画布"
        className="fd-form-canvas fd-form-canvas--empty"
        onDragEnter={handleCanvasDragEnter}
        onDragLeave={handleCanvasDragLeave}
        onDragOver={handleCanvasDragOver}
        onDrop={handleCanvasDrop}
      >
        <div className="fd-form-canvas__placeholder">
          <Typography.Text type="tertiary">从左侧点击或拖拽控件到此处</Typography.Text>
        </div>
      </section>
    );
  }

  return (
    <section
      aria-label="表单画布"
      className="fd-form-canvas"
      onDragEnter={handleCanvasDragEnter}
      onDragLeave={handleCanvasDragLeave}
      onDragOver={handleCanvasDragOver}
      onDrop={handleCanvasDrop}
    >
      <div className="fd-form-canvas__title">
        <Typography.Title heading={5} style={{ margin: 0 }}>表单预览</Typography.Title>
        <Typography.Text type="tertiary" size="small">{fields.length} 个字段</Typography.Text>
      </div>

      <div className="fd-form-canvas__list">
        {fields.map((field, index) => {
          const info = getFieldInfo(field.type);
          const Icon = info?.icon;
          const isSelected = selectedKey === field.key;
          const isDragging = dragIndex === index;
          const isDropTarget = dropIndex === index;

          return (
            <button
              key={field.key}
              type="button"
              className={[
                'fd-form-canvas__item',
                isSelected && 'fd-form-canvas__item--selected',
                isDragging && 'fd-form-canvas__item--dragging',
                isDropTarget && 'fd-form-canvas__item--drop-target',
              ].filter(Boolean).join(' ')}
              draggable
              data-type={field.type}
              data-field-key={field.key}
              onClick={handleFieldButtonClick}
              onDragStart={(e) => handleDragStart(e, index)}
              onDragOver={(e) => handleDragOver(e, index)}
              onDrop={(e) => handleDrop(e, index)}
              onDragEnd={handleDragEnd}
            >
              <div className="fd-form-canvas__item-grip">
                <GripVertical size={14} />
              </div>

              <div className="fd-form-canvas__item-icon">
                {Icon && <Icon size={14} />}
              </div>

              <div className="fd-form-canvas__item-body">
                <div className="fd-form-canvas__item-label">
                  {field.required && <Asterisk size={10} style={{ color: 'var(--semi-color-danger)' }} />}
                  {field.label}
                </div>

                {(field.type as string) === 'row' && (
                  <div className="fd-form-canvas__row-preview">
                    {field.columns?.map((col) => {
                      return (
                        <div key={getColumnKey(field.key, col)} className="fd-form-canvas__row-col" style={{ flex: col.span }}>
                          <span className="fd-form-canvas__row-col-label">{col.span}/{24}</span>
                        {col.fields?.length > 0 ? (
                          col.fields.map((f: WorkflowFormField) => (
                            <button
                              type="button"
                              key={f.key}
                              data-field-key={f.key}
                              className={`fd-form-canvas__row-col-field ${selectedKey === f.key ? 'fd-form-canvas__row-col-field--selected' : ''}`}
                              onClick={handleFieldButtonClick}
                            >
                              {f.label}
                            </button>
                          ))
                        ) : (
                          <div className="fd-form-canvas__row-col-empty">拖入字段</div>
                        )}
                      </div>
                    );
                    })}
                  </div>
                )}

                {(field.type as string) === 'divider' && (
                  <div className="fd-form-canvas__divider-preview">
                    <hr />
                  </div>
                )}

                {(field.type as string) === 'group' && (
                  <div className="fd-form-canvas__group-preview">
                    <div className="fd-form-canvas__group-title">{field.title || '分组标题'}</div>
                    <div className="fd-form-canvas__group-body">
                      {(field.children && field.children.length > 0) ? (
                        field.children.map((f) => (
                          <button
                            type="button"
                            key={f.key}
                            data-field-key={f.key}
                            className={`fd-form-canvas__group-child ${selectedKey === f.key ? 'fd-form-canvas__group-child--selected' : ''}`}
                            onClick={handleFieldButtonClick}
                          >
                            {f.label}
                          </button>
                        ))
                      ) : (
                        <div className="fd-form-canvas__group-empty">拖入字段</div>
                      )}
                    </div>
                  </div>
                )}

                {(field.type as string) !== 'row' && (field.type as string) !== 'divider' && (field.type as string) !== 'group' && (
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
                <button
                  type="button"
                  className="fd-form-canvas__item-action"
                  title="复制字段"
                  onClick={(e) => {
                    e.stopPropagation();
                    onCopy(field.key);
                  }}
                >
                  <Copy size={14} />
                </button>
                <button
                  type="button"
                  className="fd-form-canvas__item-action fd-form-canvas__item-delete"
                  title="删除字段"
                  onClick={(e) => {
                    e.stopPropagation();
                    onRemove(field.key);
                  }}
                >
                  <Trash2 size={14} />
                </button>
              </div>
              </button>
          );
        })}
      </div>
    </section>
  );
}
