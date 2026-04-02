/**
 * 左侧控件面板 — 点击添加字段到表单
 */
import { Typography } from '@douyinfe/semi-ui';
import { FORM_FIELD_TYPE_GROUPS, type FormFieldTypeInfo } from '../form-types';

interface FieldPaletteProps {
  onAddField: (type: FormFieldTypeInfo['type']) => void;
}

export default function FieldPalette({ onAddField }: Readonly<FieldPaletteProps>) {
  return (
    <div className="fd-form-palette">
      {FORM_FIELD_TYPE_GROUPS.map(group => (
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
    </div>
  );
}
