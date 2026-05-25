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
import { SideSheet, Tabs, TabPane, Input, TextArea, Typography, Form, Select, InputNumber, Switch } from '@douyinfe/semi-ui';
import type { FlowNode, FlowNodeType, AssigneeType, ApproveMethod, ApprovalType, RejectStrategy, EmptyAssigneeStrategy, OperationPermission, FieldPermission, TimeoutConfig, SameInitiatorStrategy, DeduplicateStrategy } from '../types';
import { ADDABLE_NODE_TYPES, DEFAULT_APPROVER_OPERATIONS, DELAY_UNIT_OPTIONS, TRIGGER_TYPE_OPTIONS } from '../constants';
import ApproverSettingsTab from './tabs/ApproverSettingsTab';
import FormPermissionTab from './tabs/FormPermissionTab';
import OperationPermissionTab from './tabs/OperationPermissionTab';
import AdvancedSettingsTab from './tabs/AdvancedSettingsTab';

interface UserOption { id: number; nickname: string; }
interface RoleOption { id: number; name: string; }
interface UserGroupOption { id: number; name: string; }
interface FormField { key: string; label: string; }

function stringifyHeadersOrBody(v: unknown): string {
  if (typeof v === 'string') return v;
  if (v == null) return '';
  try { return JSON.stringify(v, null, 2); } catch { return ''; }
}

function formatFieldKeys(fieldKeys: unknown): string {
  if (Array.isArray(fieldKeys)) {
    return fieldKeys.join(',');
  }
  if (typeof fieldKeys === 'string') {
    return fieldKeys;
  }
  return '';
}

interface NodeConfigDrawerProps {
  visible: boolean;
  node: FlowNode | null;
  users: UserOption[];
  roles: RoleOption[];
  userGroups?: UserGroupOption[];
  formFields: FormField[];
  allNodes?: Array<{ id: string; key?: string; name: string; type: FlowNodeType }>;
  /** 可选为“驳回到指定节点”的候选节点（当前节点之前同一执行路径上的审批/办理节点） */
  rejectableAncestorNodes?: Array<{ id: string; key?: string; name: string; type: FlowNodeType }>;
  onSave: (nodeId: string, updates: { name?: string; key?: string; props?: Record<string, unknown> }) => void;
  onCancel: () => void;
}

export default function NodeConfigDrawer({
  visible,
  node,
  users,
  roles,
  userGroups = [],
  formFields,
  allNodes = [],
  rejectableAncestorNodes = [],
  onSave,
  onCancel,
}: Readonly<NodeConfigDrawerProps>) {

  // 节点名称
  const [name, setName] = useState('');
  // 节点业务标识（key）— 可选，留空时运行时使用自动生成的 id
  const [nodeKey, setNodeKey] = useState('');
  const [nodeKeyError, setNodeKeyError] = useState<string>('');
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
      setNodeKey(node.key ?? '');
      setNodeKeyError('');
      setProps({ ...getDefaultProps(node.type), ...node.props });
    }
  }, [visible, node]);

  const handlePropsChange = (updates: Record<string, unknown>) => {
    setProps(prev => ({ ...prev, ...updates }));
  };

  const handleSave = () => {
    if (!node) return;
    const trimmedKey = nodeKey.trim();
    if (trimmedKey) {
      if (!/^[a-zA-Z]\w*$/.test(trimmedKey)) {
        setNodeKeyError('只能包含字母、数字、下划线，且需以字母开头');
        return;
      }
      if (trimmedKey === 'start' || trimmedKey === 'end') {
        setNodeKeyError('start / end 为保留标识');
        return;
      }
      const dup = allNodes.some((n) => n.id !== node.id && ((n.key && n.key === trimmedKey) || n.id === trimmedKey));
      if (dup) {
        setNodeKeyError('该标识已被其他节点使用');
        return;
      }
    }
    setNodeKeyError('');
    onSave(node.id, { name, key: trimmedKey, props });
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

      {/* 节点标识（可选、用于代码订阅事件过滤） */}
      <div style={{ marginBottom: 16 }}>
        <Typography.Text strong size="small" style={{ display: 'block', marginBottom: 6 }}>
          节点标识 (key)
          <Typography.Text type="tertiary" size="small" style={{ marginLeft: 8, fontWeight: 'normal' }}>
            程序内事件订阅可据此过滤，留空则使用自动生成 id
          </Typography.Text>
        </Typography.Text>
        <Input
          value={nodeKey}
          onChange={(v) => { setNodeKey(v); if (nodeKeyError) setNodeKeyError(''); }}
          placeholder={node?.id ?? '如：finance_approve'}
          validateStatus={nodeKeyError ? 'error' : 'default'}
        />
        {nodeKeyError && (
          <Typography.Text type="danger" size="small" style={{ display: 'block', marginTop: 4 }}>
            {nodeKeyError}
          </Typography.Text>
        )}
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
                  excludeFromStats={(props.excludeFromStats as boolean) ?? false}
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
                  userGroups={userGroups}
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
                {/* 审批人节点特有：外部审批 */}
                {node?.type === 'approver' && (() => {
                  const ext = (props.externalApproval as Record<string, unknown> | undefined) ?? {};
                  const updateExt = (patch: Record<string, unknown>) => {
                    handlePropsChange({ externalApproval: { ...ext, ...patch } });
                  };
                  const enabled = !!ext.enabled;
                  return (
                    <div style={{ borderTop: '1px solid var(--semi-color-border)', margin: '16px 0', padding: '12px 0 0' }}>
                      <Typography.Title heading={6} style={{ marginBottom: 8 }}>外部审批</Typography.Title>
                      <Typography.Text type="tertiary" size="small" style={{ display: 'block', marginBottom: 8 }}>
                        开启后将通过 HTTP 回调把任务分派给外部系统，由外部系统调用回调接口完成审批。
                      </Typography.Text>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                        <Switch checked={enabled} onChange={(v) => updateExt({ enabled: v })} size="small" />
                        <Typography.Text>启用外部审批</Typography.Text>
                      </div>
                      {enabled && (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                          <Form.Slot label="回调 URL">
                            <Input
                              value={typeof ext.url === 'string' ? ext.url : ''}
                              onChange={(v) => updateExt({ url: v })}
                              placeholder="https://example.com/approve"
                            />
                          </Form.Slot>
                          <Form.Slot label="签名密钥 secret">
                            <Input
                              mode="password"
                              value={typeof ext.secret === 'string' ? ext.secret : ''}
                              onChange={(v) => updateExt({ secret: v })}
                              placeholder="用于 HMAC-SHA256 签名"
                            />
                          </Form.Slot>
                          <Form.Slot label="签名方式">
                            <Select
                              value={(ext.signMode as string) ?? 'hmacSha256'}
                              onChange={(v) => updateExt({ signMode: v })}
                              style={{ width: '100%' }}
                              optionList={[
                                { value: 'hmacSha256', label: 'HMAC-SHA256' },
                                { value: 'none', label: '不签名' },
                              ]}
                            />
                          </Form.Slot>
                          <Form.Slot label="超时时间（毫秒）">
                            <InputNumber
                              min={1000} max={120000} step={1000}
                              value={(ext.timeoutMs as number) ?? 10000}
                              onChange={(v) => updateExt({ timeoutMs: v })}
                              style={{ width: '100%' }}
                            />
                          </Form.Slot>
                          <Form.Slot label="分派失败兜底策略">
                            <Select
                              value={(ext.fallbackStrategy as string) ?? 'manual'}
                              onChange={(v) => updateExt({ fallbackStrategy: v })}
                              style={{ width: '100%' }}
                              optionList={[
                                { value: 'manual', label: '保留任务，由系统审批人处理' },
                                { value: 'autoApprove', label: '自动通过' },
                                { value: 'autoReject', label: '自动拒绝' },
                              ]}
                            />
                          </Form.Slot>
                        </div>
                      )}
                    </div>
                  );
                })()}
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
                    value={typeof props.initiatorDesc === 'string' ? props.initiatorDesc : ''}
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
                rejectToNodeKey={props.rejectToNodeKey as string | undefined}
                availableRejectNodes={rejectableAncestorNodes}
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
                placeholder="请选择延迟类型"
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
                  placeholder="请输入时长"
                  style={{ width: 120 }}
                />
                <Select
                  value={(props.delayUnit as string) ?? 'hour'}
                  onChange={(v) => handlePropsChange({ delayUnit: v })}
                  placeholder="选择单位"
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
                placeholder="请选择触发类型"
                style={{ width: '100%' }}
                optionList={TRIGGER_TYPE_OPTIONS}
              />
            </Form.Slot>
            {(((props.triggerType as string) ?? 'webhook') === 'webhook' || (props.triggerType as string) === 'callback') && (
              <>
                <Form.Slot label="请求方式">
                  <Select
                    value={(props.httpMethod as string) ?? 'POST'}
                    onChange={(v) => handlePropsChange({ httpMethod: v })}
                    placeholder="请选择请求方式"
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
                    value={typeof props.webhookUrl === 'string' ? props.webhookUrl : ''}
                    onChange={(v) => handlePropsChange({ webhookUrl: v })}
                    placeholder="https://example.com/webhook"
                  />
                </Form.Slot>
                <Form.Slot label="自定义请求头（JSON 对象）">
                  <TextArea
                    value={stringifyHeadersOrBody(props.headers)}
                    onChange={(v: string) => handlePropsChange({ headers: v })}
                    placeholder={'{\n  "Authorization": "Bearer ..."\n}'}
                    autosize={{ minRows: 2, maxRows: 6 }}
                  />
                </Form.Slot>
                <Form.Slot label="请求体模板（支持 {{form.字段key}} 占位）">
                  <TextArea
                    value={(props.bodyTemplate as string) ?? ''}
                    onChange={(v: string) => handlePropsChange({ bodyTemplate: v })}
                    placeholder={'{\n  "title": "{{form.title}}"\n}'}
                    autosize={{ minRows: 3, maxRows: 10 }}
                  />
                </Form.Slot>
              </>
            )}
            {((props.triggerType as string) === 'updateData' || (props.triggerType as string) === 'deleteData') && (
              <>
                <Form.Slot label="操作字段 key（多个用英文逗号分隔）">
                  <Input
                    value={formatFieldKeys(props.fieldKeys)}
                    onChange={(v) => handlePropsChange({ fieldKeys: v.split(',').map((s) => s.trim()).filter(Boolean) })}
                    placeholder="title,amount"
                  />
                </Form.Slot>
                {(props.triggerType as string) === 'updateData' && (
                  <Form.Slot label="字段新值（JSON 对象，值支持 {{form.field}} 占位）">
                    <TextArea
                      value={stringifyHeadersOrBody(props.fieldValues)}
                      onChange={(v: string) => handlePropsChange({ fieldValues: v })}
                      placeholder={'{\n  "status": "approved"\n}'}
                      autosize={{ minRows: 2, maxRows: 6 }}
                    />
                  </Form.Slot>
                )}
              </>
            )}
            <Form.Slot label="失败策略">
              <Select
                value={(props.onFailure as string) ?? 'continue'}
                onChange={(v) => handlePropsChange({ onFailure: v })}
                style={{ width: '100%' }}
                optionList={[
                  { value: 'continue', label: '继续后续节点' },
                  { value: 'retry', label: '自动重试' },
                  { value: 'block', label: '中止流程' },
                ]}
              />
            </Form.Slot>
            {(props.onFailure as string) === 'retry' && (
              <Form.Slot label="最大重试次数">
                <InputNumber
                  min={1} max={10} step={1}
                  value={(props.maxRetries as number) ?? 3}
                  onChange={(v) => handlePropsChange({ maxRetries: v })}
                  style={{ width: '100%' }}
                />
              </Form.Slot>
            )}
            <Form.Slot label="超时时间（毫秒）">
              <InputNumber
                min={1000} max={120000} step={1000}
                value={(props.timeoutMs as number) ?? 10000}
                onChange={(v) => handlePropsChange({ timeoutMs: v })}
                style={{ width: '100%' }}
              />
            </Form.Slot>
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
        excludeFromStats: false,
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
        headers: '',
        bodyTemplate: '',
        onFailure: 'continue',
        maxRetries: 3,
        timeoutMs: 10000,
      };
    case 'subProcess':
      return {
        isAsync: false,
      };
    default:
      return {};
  }
}
