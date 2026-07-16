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
  /** 禁用「编辑」列（业务系统主导流程：数据归属业务系统，审批时不支持改写变量） */
  editDisabled?: boolean;
  /** 禁用「编辑」时的说明文案 */
  editDisabledHint?: string;
}

export default function FormPermissionTab({
  formFields,
  fieldPermissions,
  onChange,
  editDisabled = false,
  editDisabledHint,
}: Readonly<FormPermissionTabProps>) {

  // 编辑列被禁用时，历史配置中的 edit 降级显示为 read（保存时也按 read 处理）
  const getPermission = (key: string): FieldPermission => {
    const perm = fieldPermissions[key] ?? 'read';
    return editDisabled && perm === 'edit' ? 'read' : perm;
  };

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

      {editDisabled && (
        <Typography.Text type="tertiary" size="small" style={{ display: 'block', marginBottom: 10 }}>
          {editDisabledHint ?? '业务系统主导流程的数据由业务系统维护，审批时不支持编辑变量，仅可配置可读/隐藏。'}
        </Typography.Text>
      )}

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
                disabled={editDisabled}
                onChange={(e) => toggleEdit(field.key, !!e.target.checked)}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}
