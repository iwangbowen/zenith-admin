/**
 * 审批人/办理人/抄送人设置 Tab
 * 支持多种指定策略：指定成员、角色、主管、发起人自己、表单联系人、发起人自选
 */
import { Form, Select, InputNumber, Typography } from '@douyinfe/semi-ui';
import type { AssigneeType, ApproveMethod, FlowNodeType } from '../../types';
import {
  ASSIGNEE_TYPE_OPTIONS,
  APPROVE_METHOD_OPTIONS,
} from '../../constants';

interface UserOption { id: number; nickname: string; }
interface RoleOption { id: number; name: string; }

interface ApproverSettingsTabProps {
  nodeType: FlowNodeType;
  assigneeType: AssigneeType;
  assigneeIds: number[];
  roleIds: number[];
  managerLevel: number;
  formUserField: string;
  approveMethod: ApproveMethod;
  users: UserOption[];
  roles: RoleOption[];
  formFields: Array<{ key: string; label: string }>;
  onChange: (updates: Record<string, unknown>) => void;
}

export default function ApproverSettingsTab({
  nodeType,
  assigneeType,
  assigneeIds,
  roleIds,
  managerLevel,
  formUserField,
  approveMethod,
  users,
  roles,
  formFields,
  onChange,
}: Readonly<ApproverSettingsTabProps>) {
  const isApprover = nodeType === 'approver';
  const labelMap = { approver: '审批人', handler: '办理人', cc: '抄送人' } as const;
  const label = labelMap[nodeType as keyof typeof labelMap] ?? '设置';

  return (
    <div className="fd-drawer-tab-content">
      <Typography.Title heading={6} style={{ marginBottom: 16 }}>{label}设置</Typography.Title>

      {/* 指定策略 */}
      <Form.Slot label="指定方式">
        <Select
          value={assigneeType}
          onChange={(v) => onChange({ assigneeType: v })}
          style={{ width: '100%' }}
          optionList={ASSIGNEE_TYPE_OPTIONS.map(o => ({
            value: o.value,
            label: `${o.label} - ${o.description}`,
          }))}
        />
      </Form.Slot>

      {/* 指定成员 */}
      {assigneeType === 'user' && (
        <Form.Slot label="选择成员">
          <Select
            value={assigneeIds}
            onChange={(v) => {
              const ids = v as number[];
              const names = ids.map(id => users.find(u => u.id === id)?.nickname ?? '');
              onChange({ assigneeIds: ids, assigneeNames: names });
            }}
            multiple
            filter
            style={{ width: '100%' }}
            placeholder="请选择成员"
            optionList={users.map(u => ({ value: u.id, label: u.nickname }))}
          />
        </Form.Slot>
      )}

      {/* 指定角色 */}
      {assigneeType === 'role' && (
        <Form.Slot label="选择角色">
          <Select
            value={roleIds}
            onChange={(v) => {
              const ids = v as number[];
              const names = ids.map(id => roles.find(r => r.id === id)?.name ?? '');
              onChange({ roleIds: ids, roleNames: names });
            }}
            multiple
            filter
            style={{ width: '100%' }}
            placeholder="请选择角色"
            optionList={roles.map(r => ({ value: r.id, label: r.name }))}
          />
        </Form.Slot>
      )}

      {/* 直属主管层级 */}
      {assigneeType === 'manager' && (
        <Form.Slot label="主管层级">
          <InputNumber
            value={managerLevel}
            onChange={(v) => onChange({ managerLevel: v })}
            min={1}
            max={10}
            style={{ width: 200 }}
            suffix="级主管"
          />
          <div style={{ fontSize: 12, color: 'var(--semi-color-text-2)', marginTop: 4 }}>
            1 = 直属主管，2 = 直属主管的主管，以此类推
          </div>
        </Form.Slot>
      )}

      {/* 表单联系人 */}
      {assigneeType === 'formUser' && (
        <Form.Slot label="表单字段">
          <Select
            value={formUserField}
            onChange={(v) => onChange({ formUserField: v })}
            style={{ width: '100%' }}
            placeholder="请选择联系人字段"
            optionList={formFields.map(f => ({ value: f.key, label: f.label }))}
            emptyContent="暂无联系人字段"
          />
        </Form.Slot>
      )}

      {/* 审批方式（仅审批人节点） */}
      {isApprover && (
        <>
          <div style={{ borderTop: '1px solid var(--semi-color-border)', margin: '16px 0' }} />
          <Typography.Title heading={6} style={{ marginBottom: 12 }}>审批方式</Typography.Title>
          <div className="fd-approve-method-grid">
            {APPROVE_METHOD_OPTIONS.map(opt => (
              <button
                key={opt.value}
                type="button"
                className={`fd-approve-method-card ${approveMethod === opt.value ? 'fd-approve-method-card--active' : ''}`}
                onClick={() => onChange({ approveMethod: opt.value })}
              >
                <div className="fd-approve-method-card__label">{opt.label}</div>
                <div className="fd-approve-method-card__desc">{opt.description}</div>
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
