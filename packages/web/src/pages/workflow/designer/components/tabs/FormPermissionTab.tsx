/**
 * 表单字段权限配置 Tab
 * 飞书风格：Checkbox 两列（可读 / 编辑）
 */
import { Checkbox, Typography } from '@douyinfe/semi-ui';
import type { FieldPermission } from '../../types';

interface FormField {
  key: string;
  label: string;
}

interface FormPermissionTabProps {
  formFields: FormField[];
  fieldPermissions: Record<string, FieldPermission>;
  onChange: (permissions: Record<string, FieldPermission>) => void;
}

export default function FormPermissionTab({
  formFields,
  fieldPermissions,
  onChange,
}: Readonly<FormPermissionTabProps>) {

  const getPermission = (key: string): FieldPermission => fieldPermissions[key] ?? 'read';

  const toggleRead = (key: string, checked: boolean) => {
    onChange({
      ...fieldPermissions,
      [key]: checked ? 'read' : 'hidden',
    });
  };

  const toggleEdit = (key: string, checked: boolean) => {
    onChange({
      ...fieldPermissions,
      [key]: checked ? 'edit' : 'read',
    });
  };

  if (formFields.length === 0) {
    return (
      <div className="fd-drawer-tab-content">
        <Typography.Title heading={6} style={{ marginBottom: 16 }}>表单权限</Typography.Title>
        <div style={{ textAlign: 'center', padding: '40px 0', color: 'var(--semi-color-text-2)' }}>
          当前流程未配置表单字段
        </div>
      </div>
    );
  }

  return (
    <div className="fd-drawer-tab-content">
      <Typography.Title heading={6} style={{ marginBottom: 12 }}>表单权限</Typography.Title>

      {/* 表头 */}
      <div className="fd-form-perm-header">
        <div className="fd-form-perm-header__field">表单字段</div>
        <div className="fd-form-perm-header__check">可读</div>
        <div className="fd-form-perm-header__check">编辑</div>
      </div>

      {/* 字段行 */}
      {formFields.map(field => {
        const perm = getPermission(field.key);
        return (
          <div key={field.key} className="fd-form-perm-row">
            <div className="fd-form-perm-row__field">{field.label}</div>
            <div className="fd-form-perm-row__check">
              <Checkbox
                checked={perm === 'read' || perm === 'edit'}
                onChange={(e) => toggleRead(field.key, !!e.target.checked)}
              />
            </div>
            <div className="fd-form-perm-row__check">
              <Checkbox
                checked={perm === 'edit'}
                onChange={(e) => toggleEdit(field.key, !!e.target.checked)}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}
