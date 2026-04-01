/**
 * 节点配置抽屉面板 — 右侧滑出，根据节点类型渲染不同的 Tab 页
 *
 * 替代原有 NodeConfigModal，提供更丰富的分区配置能力：
 * - 审批人：审批人设置 / 表单权限 / 操作权限 / 高级设置
 * - 办理人：办理人设置 / 表单权限
 * - 抄送人：抄送人设置 / 表单权限
 * - 发起人：发起人设置 / 表单权限
 * - 延迟器/触发器/子流程：基础配置
 */
import { useEffect, useState } from 'react';
import { SideSheet, Tabs, TabPane, Input, Typography, Form, Select, InputNumber, Switch } from '@douyinfe/semi-ui';
import type { FlowNode, FlowNodeType, AssigneeType, ApproveMethod, ApprovalType, RejectStrategy, EmptyAssigneeStrategy, OperationPermission, FieldPermission, TimeoutConfig, SameInitiatorStrategy, DeduplicateStrategy } from '../types';
import { ADDABLE_NODE_TYPES, DEFAULT_APPROVER_OPERATIONS, DELAY_UNIT_OPTIONS, TRIGGER_TYPE_OPTIONS } from '../constants';
import ApproverSettingsTab from './tabs/ApproverSettingsTab';
import FormPermissionTab from './tabs/FormPermissionTab';
import OperationPermissionTab from './tabs/OperationPermissionTab';
import AdvancedSettingsTab from './tabs/AdvancedSettingsTab';

interface UserOption { id: number; nickname: string; }
interface RoleOption { id: number; name: string; }
interface FormField { key: string; label: string; }

interface NodeConfigDrawerProps {
  visible: boolean;
  node: FlowNode | null;
  users: UserOption[];
  roles: RoleOption[];
  formFields: FormField[];
  allNodes?: Array<{ id: string; name: string; type: FlowNodeType }>;
  onSave: (nodeId: string, updates: { name?: string; props?: Record<string, unknown> }) => void;
  onCancel: () => void;
}

export default function NodeConfigDrawer({
  visible,
  node,
  users,
  roles,
  formFields,
  allNodes = [],
  onSave,
  onCancel,
}: Readonly<NodeConfigDrawerProps>) {

  // 节点名称
  const [name, setName] = useState('');
  // 节点属性（临时编辑态）
  const [props, setProps] = useState<Record<string, unknown>>({});

  const nodeInfo = node ? ADDABLE_NODE_TYPES.find(n => n.type === node.type) : null;
  const title = node?.type === 'initiator'
    ? '设置发起人'
    : `编辑${nodeInfo?.label ?? '节点'}`;

  // 初始化编辑态
  useEffect(() => {
    if (visible && node) {
      setName(node.name);
      setProps({ ...getDefaultProps(node.type), ...node.props });
    }
  }, [visible, node]);

  const handlePropsChange = (updates: Record<string, unknown>) => {
    setProps(prev => ({ ...prev, ...updates }));
  };

  const handleSave = () => {
    if (!node) return;
    onSave(node.id, { name, props });
  };

  // 判断哪些 Tab 可用
  const isApprover = node?.type === 'approver';
  const isHandler = node?.type === 'handler';
  const isCc = node?.type === 'cc';
  const isInitiator = node?.type === 'initiator';
  const isDelay = node?.type === 'delay';
  const isTrigger = node?.type === 'trigger';
  const isSubProcess = node?.type === 'subProcess';
  const hasAssigneeSettings = isApprover || isHandler || isCc;
  const hasFormPermission = isApprover || isHandler || isCc || isInitiator;
  const hasOperationPermission = isApprover;
  const hasAdvancedSettings = isApprover;

  return (
    <SideSheet
      title={title}
      visible={visible}
      onCancel={onCancel}
      placement="right"
      width={480}
      className="fd-config-drawer"
      footer={
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, padding: '12px 0' }}>
          <button type="button" className="fd-drawer-btn fd-drawer-btn--cancel" onClick={onCancel}>取消</button>
          <button type="button" className="fd-drawer-btn fd-drawer-btn--save" onClick={handleSave}>保存</button>
        </div>
      }
    >
      {/* 节点名称（所有节点通用） */}
      <div style={{ marginBottom: 16 }}>
        <Typography.Text strong size="small" style={{ display: 'block', marginBottom: 6 }}>节点名称</Typography.Text>
        <Input
          value={name}
          onChange={setName}
          placeholder="请输入节点名称"
        />
      </div>

      {/* 有多个 Tab 的节点类型 */}
      {(hasAssigneeSettings || hasFormPermission) && (
        <Tabs type="line" size="small">
          {/* 审批人/办理人/抄送人设置 Tab */}
          {hasAssigneeSettings && (() => {
            const tabLabelMap: Record<string, string> = { approver: '审批人', handler: '办理人', cc: '抄送人' };
            const tabLabel = tabLabelMap[node?.type ?? ''] ?? '设置';
            return (
              <TabPane tab={tabLabel} itemKey="assignee">
                <ApproverSettingsTab
                  nodeType={node?.type ?? 'approver'}
                  approvalType={(props.approvalType as ApprovalType) ?? 'manual'}
                  assigneeType={(props.assigneeType as AssigneeType) ?? 'user'}
                  assigneeIds={(props.assigneeIds as number[]) ?? []}
                  roleIds={(props.roleIds as number[]) ?? []}
                  managerLevel={(props.managerLevel as number) ?? 1}
                  formUserField={(props.formUserField as string) ?? ''}
                  approveMethod={(props.approveMethod as ApproveMethod) ?? 'or'}
                  multiLevelEndType={(props.multiLevelEndType as 'topLevel' | 'level' | 'role') ?? 'topLevel'}
                  multiLevelEndLevel={(props.multiLevelEndLevel as number) ?? 1}
                  multiLevelEndRoleId={(props.multiLevelEndRoleId as number) ?? undefined}
                  nodeApproverNodeId={(props.nodeApproverNodeId as string) ?? undefined}
                  userGroupIds={(props.userGroupIds as number[]) ?? []}
                  formDeptField={(props.formDeptField as string) ?? undefined}
                  formDeptHeadLevel={(props.formDeptHeadLevel as number) ?? 1}
                  users={users}
                  roles={roles}
                  formFields={formFields}
                  allNodes={allNodes}
                  onChange={handlePropsChange}
                />
                {/* 抄送人节点特有：仅同意时抄送 */}
                {isCc && (
                  <div style={{ borderTop: '1px solid var(--semi-color-border)', margin: '16px 0', padding: '12px 0 0' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <Switch
                        checked={(props.onlyOnApprove as boolean) ?? false}
                        onChange={(v) => handlePropsChange({ onlyOnApprove: v })}
                        size="small"
                      />
                      <Typography.Text>仅同意时抄送</Typography.Text>
                    </div>
                    <Typography.Text type="tertiary" size="small" style={{ display: 'block', marginTop: 4 }}>
                      开启后，仅当审批通过时才会发送抄送通知
                    </Typography.Text>
                  </div>
                )}
              </TabPane>
            );
          })()}

          {/* 发起人设置 Tab */}
          {isInitiator && (
            <TabPane tab="发起人" itemKey="initiator">
              <div className="fd-drawer-tab-content">
                <Typography.Title heading={6} style={{ marginBottom: 16 }}>发起人设置</Typography.Title>
                <Form.Slot label="发起人范围说明">
                  <Input
                    value={(props.initiatorDesc as string) ?? ''}
                    onChange={(v) => handlePropsChange({ initiatorDesc: v })}
                    placeholder="如：所有人 / 指定部门"
                  />
                </Form.Slot>
              </div>
            </TabPane>
          )}

          {/* 表单权限 Tab */}
          {hasFormPermission && (
            <TabPane tab="表单权限" itemKey="formPermission">
              <FormPermissionTab
                formFields={formFields}
                fieldPermissions={(props.fieldPermissions as Record<string, FieldPermission>) ?? {}}
                onChange={(permissions) => handlePropsChange({ fieldPermissions: permissions })}
              />
            </TabPane>
          )}

          {/* 操作权限 Tab（仅审批人） */}
          {hasOperationPermission && (
            <TabPane tab="操作权限" itemKey="operations">
              <OperationPermissionTab
                operations={(props.operations as OperationPermission[]) ?? DEFAULT_APPROVER_OPERATIONS}
                onChange={(ops) => handlePropsChange({ operations: ops })}
              />
            </TabPane>
          )}

          {/* 高级设置 Tab（仅审批人） */}
          {hasAdvancedSettings && (
            <TabPane tab="高级设置" itemKey="advanced">
              <AdvancedSettingsTab
                rejectStrategy={(props.rejectStrategy as RejectStrategy) ?? 'terminate'}
                emptyStrategy={(props.emptyStrategy as EmptyAssigneeStrategy) ?? 'autoApprove'}
                emptyAssignTo={props.emptyAssignTo as number | undefined}
                sameInitiatorStrategy={(props.sameInitiatorStrategy as SameInitiatorStrategy) ?? 'selfApprove'}
                deduplicateStrategy={(props.deduplicateStrategy as DeduplicateStrategy) ?? 'autoSkip'}
                timeout={props.timeout as TimeoutConfig | undefined}
                users={users}
                onChange={handlePropsChange}
              />
            </TabPane>
          )}
        </Tabs>
      )}

      {/* 延迟器配置 */}
      {isDelay && (
        <div className="fd-drawer-tab-content">
          <Typography.Title heading={6} style={{ marginBottom: 16 }}>延迟配置</Typography.Title>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <Form.Slot label="延迟类型">
              <Select
                value={(props.delayType as string) ?? 'fixed'}
                onChange={(v) => handlePropsChange({ delayType: v })}
                style={{ width: '100%' }}
                optionList={[
                  { value: 'fixed', label: '固定时长' },
                  { value: 'toDate', label: '到指定日期' },
                ]}
              />
            </Form.Slot>
            {(props.delayType ?? 'fixed') === 'fixed' ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <InputNumber
                  value={(props.delayValue as number) ?? 1}
                  onChange={(v) => handlePropsChange({ delayValue: v })}
                  min={1}
                  style={{ width: 120 }}
                />
                <Select
                  value={(props.delayUnit as string) ?? 'hour'}
                  onChange={(v) => handlePropsChange({ delayUnit: v })}
                  style={{ width: 100 }}
                  optionList={DELAY_UNIT_OPTIONS}
                />
              </div>
            ) : (
              <Form.Slot label="目标日期字段">
                <Select
                  value={(props.targetDate as string) ?? ''}
                  onChange={(v) => handlePropsChange({ targetDate: v })}
                  style={{ width: '100%' }}
                  placeholder="请选择日期字段"
                  optionList={formFields
                    .filter(f => f.key.includes('date') || f.key.includes('time'))
                    .map(f => ({ value: f.key, label: f.label }))}
                  emptyContent="暂无日期字段"
                />
              </Form.Slot>
            )}
          </div>
        </div>
      )}

      {/* 触发器配置 */}
      {isTrigger && (
        <div className="fd-drawer-tab-content">
          <Typography.Title heading={6} style={{ marginBottom: 16 }}>触发器配置</Typography.Title>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <Form.Slot label="触发类型">
              <Select
                value={(props.triggerType as string) ?? 'webhook'}
                onChange={(v) => handlePropsChange({ triggerType: v })}
                style={{ width: '100%' }}
                optionList={TRIGGER_TYPE_OPTIONS}
              />
            </Form.Slot>
            {((props.triggerType as string) ?? 'webhook') === 'webhook' && (
              <>
                <Form.Slot label="请求方式">
                  <Select
                    value={(props.httpMethod as string) ?? 'POST'}
                    onChange={(v) => handlePropsChange({ httpMethod: v })}
                    style={{ width: '100%' }}
                    optionList={[
                      { value: 'GET', label: 'GET' },
                      { value: 'POST', label: 'POST' },
                      { value: 'PUT', label: 'PUT' },
                    ]}
                  />
                </Form.Slot>
                <Form.Slot label="请求地址">
                  <Input
                    value={(props.webhookUrl as string) ?? ''}
                    onChange={(v) => handlePropsChange({ webhookUrl: v })}
                    placeholder="https://example.com/webhook"
                  />
                </Form.Slot>
              </>
            )}
          </div>
        </div>
      )}

      {/* 子流程配置 */}
      {isSubProcess && (
        <div className="fd-drawer-tab-content">
          <Typography.Title heading={6} style={{ marginBottom: 16 }}>子流程配置</Typography.Title>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <Form.Slot label="子流程 ID">
              <InputNumber
                value={(props.subProcessId as number) ?? undefined}
                onChange={(v) => handlePropsChange({ subProcessId: v })}
                placeholder="请输入子流程定义 ID"
                style={{ width: '100%' }}
              />
            </Form.Slot>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <Typography.Text>异步执行</Typography.Text>
              <Switch
                checked={(props.isAsync as boolean) ?? false}
                onChange={(v) => handlePropsChange({ isAsync: v })}
              />
            </div>
            <Typography.Text type="tertiary" size="small">
              {(props.isAsync as boolean) ? '主流程不等待子流程完成，直接继续' : '主流程等待子流程完成后继续'}
            </Typography.Text>
          </div>
        </div>
      )}
    </SideSheet>
  );
}

// ─── 默认属性 ────────────────────────────────────────────────────────

function getDefaultProps(type: FlowNodeType): Record<string, unknown> {
  switch (type) {
    case 'approver':
      return {
        approvalType: 'manual',
        assigneeType: 'user',
        assigneeIds: [],
        assigneeNames: [],
        approveMethod: 'or',
        rejectStrategy: 'terminate',
        emptyStrategy: 'autoApprove',
        sameInitiatorStrategy: 'selfApprove',
        deduplicateStrategy: 'autoSkip',
        operations: DEFAULT_APPROVER_OPERATIONS,
        fieldPermissions: {},
      };
    case 'handler':
      return {
        assigneeType: 'user',
        assigneeIds: [],
        assigneeNames: [],
        emptyStrategy: 'autoApprove',
        fieldPermissions: {},
      };
    case 'cc':
      return {
        assigneeType: 'user',
        assigneeIds: [],
        assigneeNames: [],
        onlyOnApprove: false,
        fieldPermissions: {},
      };
    case 'initiator':
      return {
        initiatorDesc: '',
        fieldPermissions: {},
      };
    case 'delay':
      return {
        delayType: 'fixed',
        delayValue: 1,
        delayUnit: 'hour',
      };
    case 'trigger':
      return {
        triggerType: 'webhook',
        httpMethod: 'POST',
        webhookUrl: '',
      };
    case 'subProcess':
      return {
        isAsync: false,
      };
    default:
      return {};
  }
}
