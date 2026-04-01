/**
 * 操作权限配置 Tab
 * 审批人可执行的操作：通过、拒绝、转办、加签、退回、评论
 */
import { Checkbox, Typography } from '@douyinfe/semi-ui';
import type { OperationPermission } from '../../types';
import { OPERATION_PERMISSION_OPTIONS } from '../../constants';

interface OperationPermissionTabProps {
  operations: OperationPermission[];
  onChange: (operations: OperationPermission[]) => void;
}

export default function OperationPermissionTab({
  operations,
  onChange,
}: Readonly<OperationPermissionTabProps>) {

  const handleAdd = (value: OperationPermission) => {
    onChange([...operations, value]);
  };

  const handleRemove = (value: OperationPermission) => {
    // 不允许完全取消“通过”
    if (value === 'approve' && operations.length === 1) return;
    onChange(operations.filter(v => v !== value));
  };

  return (
    <div className="fd-drawer-tab-content">
      <Typography.Title heading={6} style={{ marginBottom: 16 }}>操作权限</Typography.Title>
      <Typography.Text type="tertiary" size="small" style={{ display: 'block', marginBottom: 16 }}>
        设置审批人在处理任务时可执行的操作
      </Typography.Text>

      <div className="fd-operation-list">
        {OPERATION_PERMISSION_OPTIONS.map(opt => {
          const checked = operations.includes(opt.value);
          const disabled = opt.value === 'approve'; // 通过操作不能取消
          return (
            <div key={opt.value} className="fd-operation-item">
              <Checkbox
                checked={checked}
                disabled={disabled}
                onChange={(e) => {
                  if (e.target.checked) handleAdd(opt.value);
                  else handleRemove(opt.value);
                }}
              >
                {opt.label}
              </Checkbox>
              {disabled && (
                <span style={{ fontSize: 12, color: 'var(--semi-color-text-2)', marginLeft: 8 }}>(必选)</span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
