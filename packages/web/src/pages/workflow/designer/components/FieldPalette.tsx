/**
 * 左侧控件面板 — 点击添加字段到表单
 */
import { useMemo, useState } from 'react';
import { Input, Typography } from '@douyinfe/semi-ui';
import { Search } from 'lucide-react';
import { FORM_FIELD_TYPE_GROUPS, type FormFieldTypeInfo } from '../form-types';

interface FieldPaletteProps {
  onAddField: (type: FormFieldTypeInfo['type']) => void;
}

export default function FieldPalette({ onAddField }: Readonly<FieldPaletteProps>) {
  const [keyword, setKeyword] = useState('');
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
