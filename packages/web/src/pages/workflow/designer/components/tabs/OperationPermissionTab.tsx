/**
 * 操作权限配置 Tab
 * 飞书风格分组布局：操作权限 + 手写签名 + 审批意见
 */
import { Checkbox } from '@douyinfe/semi-ui';
import type { OperationPermission } from '../../types';

/** 操作权限分组定义 */
const OPERATION_GROUPS = [
  {
    title: '操作权限',
    items: [
      { value: 'transfer' as OperationPermission, label: '允许转交', desc: '审批人可将任务转给其他人处理' },
      { value: 'addSign' as OperationPermission, label: '允许加 / 减签', desc: '审批人可临时增加或移除审批人' },
      { value: 'return' as OperationPermission, label: '允许回退', desc: '审批人可将审批退回到指定审批节点' },
    ],
  },
  {
    title: '手写签名',
    items: [
      { value: 'signature' as OperationPermission, label: '审批同意时需手写签名', desc: '' },
    ],
  },
  {
    title: '审批意见',
    items: [
      { value: 'opinionRequired' as OperationPermission, label: '提交审批需审批人填写审批意见', desc: '' },
    ],
  },
];

interface OperationPermissionTabProps {
  operations: OperationPermission[];
  onChange: (operations: OperationPermission[]) => void;
}

export default function OperationPermissionTab({
  operations,
  onChange,
}: Readonly<OperationPermissionTabProps>) {

  const toggle = (value: OperationPermission, checked: boolean) => {
    if (checked) onChange([...operations, value]);
    else onChange(operations.filter(v => v !== value));
  };

  return (
    <div className="fd-drawer-tab-content">
      {OPERATION_GROUPS.map(group => (
        <div key={group.title} className="fd-operation-group">
          <div className="fd-operation-group__title">{group.title}</div>
          <div style={{ borderTop: '1px solid var(--semi-color-border)', paddingTop: 12 }}>
            <div className="fd-operation-group__items">
              {group.items.map(item => (
                <div key={item.value}>
                  <Checkbox
                    checked={operations.includes(item.value)}
                    onChange={(e) => toggle(item.value, !!e.target.checked)}
                  >
                    {item.label}
                  </Checkbox>
                  {item.desc && (
                    <div className="fd-operation-group__item-desc">{item.desc}</div>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
