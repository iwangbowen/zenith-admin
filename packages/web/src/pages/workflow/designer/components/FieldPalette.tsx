/**
 * 左侧控件面板 — 点击添加字段到表单
 */
import { useEffect, useMemo, useState } from 'react';
import { Input, Typography, Popconfirm } from '@douyinfe/semi-ui';
import { Search, BookmarkPlus, X } from 'lucide-react';
import type { WorkflowFormField } from '@zenith/shared';
import { FORM_FIELD_TYPE_GROUPS, type FormFieldTypeInfo } from '../form-types';
import { loadFieldTemplates, removeFieldTemplate, FIELD_TEMPLATES_CHANGED_EVENT, type FieldTemplateEntry } from '../form-field-templates';

interface FieldPaletteProps {
  onAddField: (type: FormFieldTypeInfo['type']) => void;
  /** 插入「我的模板」字段（由设计器克隆并重置 key） */
  onAddTemplateField?: (field: WorkflowFormField) => void;
}

export default function FieldPalette({ onAddField, onAddTemplateField }: Readonly<FieldPaletteProps>) {
  const [keyword, setKeyword] = useState('');
  const [myTemplates, setMyTemplates] = useState<FieldTemplateEntry[]>(() => loadFieldTemplates());

  // 「存为我的模板」后同步刷新
  useEffect(() => {
    const refresh = () => setMyTemplates(loadFieldTemplates());
    window.addEventListener(FIELD_TEMPLATES_CHANGED_EVENT, refresh);
    return () => window.removeEventListener(FIELD_TEMPLATES_CHANGED_EVENT, refresh);
  }, []);

  const normalizedKeyword = keyword.trim().toLowerCase();
  const groups = useMemo(() => {
    if (!normalizedKeyword) return FORM_FIELD_TYPE_GROUPS;
    return FORM_FIELD_TYPE_GROUPS
      .map((group) => ({
        ...group,
        types: group.types.filter((info) =>
          info.label.toLowerCase().includes(normalizedKeyword)
          || info.type.toLowerCase().includes(normalizedKeyword)
          || (info.description ?? '').toLowerCase().includes(normalizedKeyword),
        ),
      }))
      .filter((group) => group.types.length > 0);
  }, [normalizedKeyword]);

  const visibleTemplates = useMemo(() => {
    if (!normalizedKeyword) return myTemplates;
    return myTemplates.filter((t) => t.name.toLowerCase().includes(normalizedKeyword));
  }, [myTemplates, normalizedKeyword]);

  return (
    <div className="fd-form-palette">
      <Input
        prefix={<Search size={14} />}
        placeholder="搜索控件"
        value={keyword}
        onChange={setKeyword}
        showClear
        className="fd-form-palette__search"
      />
      {onAddTemplateField && visibleTemplates.length > 0 && (
        <div className="fd-form-palette__group">
          <Typography.Text type="tertiary" size="small" style={{ display: 'block', marginBottom: 8, fontWeight: 600 }}>
            我的模板
          </Typography.Text>
          <div className="fd-form-palette__grid">
            {visibleTemplates.map((tpl) => (
              <div key={tpl.id} className="fd-form-palette__tpl">
                <button
                  type="button"
                  className="fd-form-palette__item"
                  title={`插入「${tpl.name}」（${tpl.field.label} · ${tpl.field.type}）`}
                  onClick={() => onAddTemplateField(tpl.field)}
                >
                  <BookmarkPlus size={16} />
                  <span>{tpl.name}</span>
                </button>
                <Popconfirm title={`删除模板「${tpl.name}」？`} okText="删除" cancelText="取消" onConfirm={() => removeFieldTemplate(tpl.id)}>
                  <button type="button" className="fd-form-palette__tpl-del" title="删除模板">
                    <X size={11} />
                  </button>
                </Popconfirm>
              </div>
            ))}
          </div>
        </div>
      )}
      {groups.map(group => (
        <div key={group.label} className="fd-form-palette__group">
          <Typography.Text type="tertiary" size="small" style={{ display: 'block', marginBottom: 8, fontWeight: 600 }}>
            {group.label}
          </Typography.Text>
          <div className="fd-form-palette__grid">
            {group.types.map(info => (
              <button
                key={info.type}
                type="button"
                className="fd-form-palette__item"
                title={info.description}
                onClick={() => onAddField(info.type)}
                draggable
                onDragStart={(e) => {
                  e.dataTransfer.setData('fieldType', info.type);
                  e.dataTransfer.effectAllowed = 'copy';
                }}
              >
                <info.icon size={16} />
                <span>{info.label}</span>
              </button>
            ))}
          </div>
        </div>
      ))}
      {groups.length === 0 && (
        <Typography.Text type="tertiary" size="small">未找到匹配控件</Typography.Text>
      )}
    </div>
  );
}
