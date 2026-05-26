/**
 * 审批人/办理人/抄送人设置 Tab
 * 支持多种指定策略：指定成员、角色、主管、发起人自己、表单联系人、发起人自选、
 * 连续多级上级、连续多级部门负责人、节点审批人、用户组、表单内部门
 */
import { Form, Select, InputNumber, Typography, RadioGroup, Radio, Tooltip, Checkbox, TextArea } from '@douyinfe/semi-ui';
import type { AssigneeType, ApproveMethod, ApprovalType, FlowNodeType } from '../../types';
import {
  ASSIGNEE_TYPE_OPTIONS,
  APPROVE_METHOD_OPTIONS,
  APPROVAL_TYPE_OPTIONS,
} from '../../constants';
import { CircleHelp } from 'lucide-react';

interface UserOption { id: number; nickname: string; }
interface RoleOption { id: number; name: string; }
interface UserGroupOption { id: number; name: string; }
interface PositionOption { id: number; name: string; }
interface DepartmentOption { id: number; name: string; parentId?: number | null; }

type SelectScopeType = 'user' | 'role' | 'department' | 'userGroup';

interface ApproverSettingsTabProps {
  nodeType: FlowNodeType;
  approvalType?: ApprovalType;
  excludeFromStats?: boolean;
  assigneeType: AssigneeType;
  assigneeIds: number[];
  roleIds: number[];
  managerLevel: number;
  formUserField: string;
  approveMethod: ApproveMethod;
  multiLevelEndType?: 'topLevel' | 'level' | 'role';
  multiLevelEndLevel?: number;
  multiLevelEndRoleId?: number;
  nodeApproverNodeId?: string;
  userGroupIds?: number[];
  formDeptField?: string;
  formDeptHeadLevel?: number;
  postIds?: number[];
  deptMemberDeptIds?: number[];
  deptMemberIncludeChildren?: boolean;
  selectScopeType?: SelectScopeType;
  selectScopeIds?: number[];
  assigneeExpression?: string;
  users: UserOption[];
  roles: RoleOption[];
  userGroups?: UserGroupOption[];
  positions?: PositionOption[];
  departments?: DepartmentOption[];
  formFields: Array<{ key: string; label: string; type?: string }>;
  allNodes?: Array<{ id: string; key?: string; name: string; type: FlowNodeType }>;
  onChange: (updates: Record<string, unknown>) => void;
}

export default function ApproverSettingsTab({
  nodeType,
  approvalType = 'manual',
  excludeFromStats = false,
  assigneeType,
  assigneeIds,
  roleIds,
  managerLevel,
  formUserField,
  approveMethod,
  multiLevelEndType = 'topLevel',
  multiLevelEndLevel = 1,
  multiLevelEndRoleId,
  nodeApproverNodeId,
  userGroupIds = [],
  formDeptField,
  formDeptHeadLevel = 1,
  postIds = [],
  deptMemberDeptIds = [],
  deptMemberIncludeChildren = false,
  selectScopeType = 'user',
  selectScopeIds = [],
  assigneeExpression = '',
  users,
  roles,
  userGroups = [],
  positions = [],
  departments = [],
  formFields,
  allNodes = [],
  onChange,
}: Readonly<ApproverSettingsTabProps>) {
  const isApprover = nodeType === 'approver';
  const labelMap = { approver: '审批人', handler: '办理人', cc: '抄送人' } as const;
  const label = labelMap[nodeType as keyof typeof labelMap] ?? '设置';
  const isAutoMode = approvalType !== 'manual';

  // 前序审批/办理节点列表（用于"节点审批人"类型）
  const approverNodes = allNodes.filter(n => n.type === 'approver' || n.type === 'handler');

  // 自选范围的可选项（共用：initiatorSelectScope / approverSelect）
  let selectScopeOptions: Array<{ value: number; label: string }> = [];
  if (selectScopeType === 'user') selectScopeOptions = users.map(u => ({ value: u.id, label: u.nickname }));
  else if (selectScopeType === 'role') selectScopeOptions = roles.map(r => ({ value: r.id, label: r.name }));
  else if (selectScopeType === 'department') selectScopeOptions = departments.map(d => ({ value: d.id, label: d.name }));
  else selectScopeOptions = userGroups.map(g => ({ value: g.id, label: g.name }));
  // 部门类型字段（用于"表单内部门"类型）
  const deptFields = formFields.filter(f => f.type === 'department');

  return (
    <div className="fd-drawer-tab-content">
      {/* 审批类型（仅审批人节点） */}
      {isApprover && (
        <>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <Typography.Title heading={6} style={{ margin: 0 }}>审批类型</Typography.Title>
            <Checkbox
              checked={excludeFromStats}
              onChange={(e) => onChange({ excludeFromStats: !!e.target.checked })}
              style={{ fontSize: 12 }}
            >
              不计入审批效率统计
            </Checkbox>
          </div>
          <RadioGroup
            type="button"
            value={approvalType}
            onChange={(e) => onChange({ approvalType: e.target.value })}
            style={{ marginBottom: 16, width: '100%' }}
          >
            {APPROVAL_TYPE_OPTIONS.map(opt => (
              <Radio key={opt.value} value={opt.value}>{opt.label}</Radio>
            ))}
          </RadioGroup>
          {isAutoMode && (
            <Typography.Text type="tertiary" size="small" style={{ display: 'block', marginBottom: 16 }}>
              {approvalType === 'autoApprove'
                ? '流程到达此节点时将自动通过，无需人工审批'
                : '流程到达此节点时将自动拒绝'}
            </Typography.Text>
          )}
          <div style={{ borderBottom: '1px solid var(--semi-color-border)', marginBottom: 16 }} />
        </>
      )}

      {/* 人工审批时显示审批人配置 */}
      {!isAutoMode && (
        <>
          <Typography.Title heading={6} style={{ marginBottom: 16 }}>{label}设置</Typography.Title>

          {/* 指定策略 — Radio 网格布局 */}
          <Typography.Text style={{ display: 'block', marginBottom: 8, fontWeight: 500 }}>{label}</Typography.Text>
          <div className="fd-assignee-type-grid">
            {ASSIGNEE_TYPE_OPTIONS.map(o => (
              <label
                key={o.value}
                className={`fd-assignee-type-item ${assigneeType === o.value ? 'fd-assignee-type-item--active' : ''}`}
              >
                <Radio
                  value={o.value}
                  checked={assigneeType === o.value}
                  onChange={() => onChange({ assigneeType: o.value })}
                  style={{ display: 'none' }}
                />
                <span>{o.label}</span>
                <Tooltip content={o.description}>
                  <CircleHelp size={12} style={{ color: 'var(--semi-color-text-2)', flexShrink: 0 }} />
                </Tooltip>
              </label>
            ))}
          </div>

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
                placeholder="请输入层级"
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

          {/* 连续多级上级 */}
          {assigneeType === 'multiLevelManager' && (
            <>
              <Form.Slot label="审批终点">
                <Select
                  value={multiLevelEndType}
                  onChange={(v) => onChange({ multiLevelEndType: v })}
                  style={{ width: '100%' }}
                  optionList={[
                    { value: 'topLevel', label: '最高层级（直到没有上级）' },
                    { value: 'level', label: '指定层级' },
                    { value: 'role', label: '指定角色' },
                  ]}
                  placeholder="请选择审批终点"
                />
              </Form.Slot>
              {multiLevelEndType === 'level' && (
                <Form.Slot label="终止层级">
                  <InputNumber
                    value={multiLevelEndLevel}
                    onChange={(v) => onChange({ multiLevelEndLevel: v })}
                    min={1}
                    max={20}
                    style={{ width: 200 }}
                    suffix="级"
                    placeholder="请输入层级"
                  />
                </Form.Slot>
              )}
              {multiLevelEndType === 'role' && (
                <Form.Slot label="终止角色">
                  <Select
                    value={multiLevelEndRoleId}
                    onChange={(v) => onChange({ multiLevelEndRoleId: v })}
                    style={{ width: '100%' }}
                    placeholder="审批到该角色后停止"
                    optionList={roles.map(r => ({ value: r.id, label: r.name }))}
                  />
                </Form.Slot>
              )}
              <Typography.Text type="tertiary" size="small" style={{ display: 'block', marginTop: 4 }}>
                从发起人的直属上级开始，逐级向上审批，直至审批终点
              </Typography.Text>
            </>
          )}

          {/* 连续多级部门负责人 */}
          {assigneeType === 'multiLevelDeptHead' && (
            <>
              <Form.Slot label="审批终点">
                <Select
                  value={multiLevelEndType}
                  onChange={(v) => onChange({ multiLevelEndType: v })}
                  style={{ width: '100%' }}
                  optionList={[
                    { value: 'topLevel', label: '最高层级（直到没有上级部门）' },
                    { value: 'level', label: '指定层级' },
                  ]}
                  placeholder="请选择审批终点"
                />
              </Form.Slot>
              {multiLevelEndType === 'level' && (
                <Form.Slot label="终止层级">
                  <InputNumber
                    value={multiLevelEndLevel}
                    onChange={(v) => onChange({ multiLevelEndLevel: v })}
                    min={1}
                    max={20}
                    style={{ width: 200 }}
                    suffix="级"
                    placeholder="请输入层级"
                  />
                </Form.Slot>
              )}
              <Typography.Text type="tertiary" size="small" style={{ display: 'block', marginTop: 4 }}>
                从发起人的直属部门负责人开始，逐级向上审批
              </Typography.Text>
            </>
          )}

          {/* 节点审批人 */}
          {assigneeType === 'nodeApprover' && (
            <Form.Slot label="关联节点">
              <Select
                value={nodeApproverNodeId}
                onChange={(v) => onChange({ nodeApproverNodeId: v })}
                style={{ width: '100%' }}
                placeholder="请选择前序审批节点"
                optionList={approverNodes.map(n => ({ value: n.key || n.id, label: n.key ? `${n.name}（${n.key}）` : n.name }))}
                emptyContent="暂无前序审批节点"
              />
              <Typography.Text type="tertiary" size="small" style={{ display: 'block', marginTop: 4 }}>
                由关联节点的实际审批人再次审批（不可用于首个节点）
              </Typography.Text>
            </Form.Slot>
          )}

          {/* 用户组 */}
          {assigneeType === 'userGroup' && (
            <Form.Slot label="选择用户组">
              <Select
                value={userGroupIds}
                onChange={(v) => onChange({ userGroupIds: v })}
                multiple
                filter
                style={{ width: '100%' }}
                placeholder="请选择用户组"
                optionList={userGroups.map(g => ({ value: g.id, label: g.name }))}
                emptyContent={userGroups.length === 0 ? '请先在系统中配置用户组' : '无匹配项'}
              />
            </Form.Slot>
          )}

          {/* 表单内部门 */}
          {assigneeType === 'formDepartment' && (
            <>
              <Form.Slot label="部门字段">
                <Select
                  value={formDeptField}
                  onChange={(v) => onChange({ formDeptField: v })}
                  style={{ width: '100%' }}
                  placeholder="请选择部门字段"
                  optionList={deptFields.map(f => ({ value: f.key, label: f.label }))}
                  emptyContent="暂无部门类型字段"
                />
              </Form.Slot>
              <Form.Slot label="负责人层级">
                <InputNumber
                  value={formDeptHeadLevel}
                  onChange={(v) => onChange({ formDeptHeadLevel: v })}
                  min={1}
                  max={10}
                  style={{ width: 200 }}
                  suffix="级"
                  placeholder="请输入层级"
                />
              </Form.Slot>
            </>
          )}

          {/* 指定岗位 */}
          {assigneeType === 'post' && (
            <Form.Slot label="选择岗位">
              <Select
                value={postIds}
                onChange={(v) => {
                  const ids = v as number[];
                  const names = ids.map(id => positions.find(p => p.id === id)?.name ?? '');
                  onChange({ postIds: ids, postNames: names });
                }}
                multiple
                filter
                style={{ width: '100%' }}
                placeholder="请选择岗位"
                optionList={positions.map(p => ({ value: p.id, label: p.name }))}
                emptyContent={positions.length === 0 ? '请先在"岗位管理"中配置岗位' : '无匹配项'}
              />
              <Typography.Text type="tertiary" size="small" style={{ display: 'block', marginTop: 4 }}>
                所选岗位下的所有成员都会作为审批人候选
              </Typography.Text>
            </Form.Slot>
          )}

          {/* 部门成员 */}
          {assigneeType === 'deptMember' && (
            <>
              <Form.Slot label="选择部门">
                <Select
                  value={deptMemberDeptIds}
                  onChange={(v) => {
                    const ids = v as number[];
                    const names = ids.map(id => departments.find(d => d.id === id)?.name ?? '');
                    onChange({ deptMemberDeptIds: ids, deptMemberDeptNames: names });
                  }}
                  multiple
                  filter
                  style={{ width: '100%' }}
                  placeholder="请选择部门"
                  optionList={departments.map(d => ({ value: d.id, label: d.name }))}
                />
              </Form.Slot>
              <div style={{ marginTop: 8 }}>
                <Checkbox
                  checked={deptMemberIncludeChildren}
                  onChange={(e) => onChange({ deptMemberIncludeChildren: !!e.target.checked })}
                >
                  包含子部门成员
                </Checkbox>
              </div>
            </>
          )}

          {/* 发起人部门分管领导 */}
          {assigneeType === 'startUserDeptResponsible' && (
            <Typography.Text type="tertiary" size="small" style={{ display: 'block', marginTop: 4 }}>
              取发起人所在部门的「分管领导」（需先在部门管理中配置分管领导）
            </Typography.Text>
          )}

          {/* 发起人自选(指定范围) */}
          {assigneeType === 'initiatorSelectScope' && (
            <>
              <Form.Slot label="可选范围类型">
                <RadioGroup
                  type="button"
                  value={selectScopeType}
                  onChange={(e) => onChange({ selectScopeType: e.target.value, selectScopeIds: [] })}
                  style={{ width: '100%' }}
                >
                  <Radio value="user">成员</Radio>
                  <Radio value="role">角色</Radio>
                  <Radio value="department">部门</Radio>
                  <Radio value="userGroup">用户组</Radio>
                </RadioGroup>
              </Form.Slot>
              <Form.Slot label="可选范围">
                <Select
                  value={selectScopeIds}
                  onChange={(v) => onChange({ selectScopeIds: v })}
                  multiple
                  filter
                  style={{ width: '100%' }}
                  placeholder="请选择可供发起人挑选的范围"
                  optionList={selectScopeOptions}
                />
              </Form.Slot>
              <Typography.Text type="tertiary" size="small" style={{ display: 'block', marginTop: 4 }}>
                发起人在发起申请时，需在上述范围内挑选具体审批人
              </Typography.Text>
            </>
          )}

          {/* 审批人自选（上一节点选下一节点审批人） */}
          {assigneeType === 'approverSelect' && (
            <>
              <Form.Slot label="可选范围类型">
                <RadioGroup
                  type="button"
                  value={selectScopeType}
                  onChange={(e) => onChange({ selectScopeType: e.target.value, selectScopeIds: [] })}
                  style={{ width: '100%' }}
                >
                  <Radio value="user">成员</Radio>
                  <Radio value="role">角色</Radio>
                  <Radio value="department">部门</Radio>
                  <Radio value="userGroup">用户组</Radio>
                </RadioGroup>
              </Form.Slot>
              <Form.Slot label="可选范围（留空=无范围限制）">
                <Select
                  value={selectScopeIds}
                  onChange={(v) => onChange({ selectScopeIds: v })}
                  multiple
                  filter
                  style={{ width: '100%' }}
                  placeholder="可选范围，留空则上一审批人可任选"
                  optionList={selectScopeOptions}
                />
              </Form.Slot>
              <Typography.Text type="tertiary" size="small" style={{ display: 'block', marginTop: 4 }}>
                上一节点审批人在审批通过时，需为本节点选择具体审批人
              </Typography.Text>
            </>
          )}

          {/* 流程表达式 */}
          {assigneeType === 'expression' && (
            <Form.Slot label="表达式">
              <TextArea
                value={assigneeExpression}
                onChange={(v) => onChange({ assigneeExpression: v })}
                rows={4}
                placeholder={'返回用户 ID 数组或单个用户 ID，可引用 {{form.fieldKey}} / {{starter.id}} 等变量'}
              />
              <Typography.Text type="tertiary" size="small" style={{ display: 'block', marginTop: 4 }}>
                运行时由后端解析；表达式应返回数字（单一用户 ID）或数字数组（多用户 ID）
              </Typography.Text>
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
        </>
      )}
    </div>
  );
}
