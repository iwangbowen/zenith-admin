/**
 * 表单字段权限配置 Tab
 * 对每个表单字段设置只读/编辑/隐藏权限
 */
import { Radio, Typography, Table } from '@douyinfe/semi-ui';
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

  const handleChange = (fieldKey: string, permission: FieldPermission) => {
    onChange({
      ...fieldPermissions,
      [fieldKey]: permission,
    });
  };

  const handleBatchSet = (permission: FieldPermission) => {
    const updated: Record<string, FieldPermission> = {};
    for (const f of formFields) {
      updated[f.key] = permission;
    }
    onChange(updated);
  };

  const columns = [
    {
      title: '字段名称',
      dataIndex: 'label',
      width: 160,
    },
    {
      title: '权限',
      dataIndex: 'key',
      render: (_text: string, record: FormField) => {
        const current = fieldPermissions[record.key] ?? 'read';
        return (
          <Radio.Group
            value={current}
            onChange={(e) => handleChange(record.key, e.target.value as FieldPermission)}
            type="button"
            size="small"
          >
            <Radio value="read">只读</Radio>
            <Radio value="edit">可编辑</Radio>
            <Radio value="hidden">隐藏</Radio>
          </Radio.Group>
        );
      },
    },
  ];

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
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <Typography.Title heading={6} style={{ margin: 0 }}>表单权限</Typography.Title>
        <div style={{ display: 'flex', gap: 8 }}>
          <button type="button" className="fd-batch-btn" onClick={() => handleBatchSet('read')}>全部只读</button>
          <button type="button" className="fd-batch-btn" onClick={() => handleBatchSet('edit')}>全部可编辑</button>
          <button type="button" className="fd-batch-btn" onClick={() => handleBatchSet('hidden')}>全部隐藏</button>
        </div>
      </div>
      <Table
        columns={columns}
        dataSource={formFields}
        rowKey="key"
        pagination={false}
        size="small"
        bordered
      />
    </div>
  );
}
