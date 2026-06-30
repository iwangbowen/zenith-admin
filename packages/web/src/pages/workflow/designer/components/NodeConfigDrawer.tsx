/**
 * 节点配置抽屉面板 — 右侧滑出，根据节点类型渲染不同的 Tab 页
 *
 * 替代原有 NodeConfigModal，提供更丰富的分区配置能力：
 * - 审批人：审批人设置 / 表单权限 / 审批要求 / 高级设置
 * - 办理人：办理人设置 / 表单权限
 * - 抄送人：抄送人设置 / 表单权限
 * - 发起人：发起人设置 / 表单权限
 * - 延迟器/触发器/子流程：基础配置
 */
import { useEffect, useState } from 'react';
import { SideSheet, Tabs, TabPane, Input, TextArea, Typography, Form, Select, InputNumber, Switch, RadioGroup, Radio, Button } from '@douyinfe/semi-ui';
import { Plus, Trash2, AlertTriangle } from 'lucide-react';
import { request } from '@/utils/request';
import type { FlowNode, FlowNodeType, AssigneeType, ApproveMethod, ApprovalType, RejectStrategy, EmptyAssigneeStrategy, OperationPermission, FieldPermission, TimeoutConfig, SameInitiatorStrategy, DeduplicateStrategy, ActionButtonsConfig, NodeHealthInfo, NodeHealthIssue } from '../types';
import type { NodeListenerConfig } from '@zenith/shared';
import { ADDABLE_NODE_TYPES, DEFAULT_APPROVER_OPERATIONS, DELAY_UNIT_OPTIONS, TRIGGER_TYPE_OPTIONS } from '../constants';
import ApproverSettingsTab from './tabs/ApproverSettingsTab';
import FormPermissionTab from './tabs/FormPermissionTab';
import ApprovalRequirementsTab from './tabs/ApprovalRequirementsTab';
import ActionButtonsTab from './tabs/ActionButtonsTab';
import { normalizeActionButtons } from '../action-buttons';
import NodeListenersTab from './tabs/NodeListenersTab';

interface UserOption { id: number; nickname: string; }
interface RoleOption { id: number; name: string; }
interface UserGroupOption { id: number; name: string; }
interface PositionOption { id: number; name: string; }
interface DepartmentOption { id: number; name: string; parentId?: number | null; }
interface FormField { key: string; label: string; type?: string }
interface SubProcessOption { value: number; label: string; fields?: Array<{ key: string; label: string; type?: string }> }

function stringifyHeadersOrBody(v: unknown): string {
  if (typeof v === 'string') return v;
  if (v == null) return '';
  try { return JSON.stringify(v, null, 2); } catch { return ''; }
}

/** 将映射值（可能是对象或 JSON 字符串）规整为有序的键值对数组 */
function asMappingPairs(v: unknown): Array<[string, string]> {
  let obj: Record<string, unknown> | null = null;
  if (typeof v === 'string' && v.trim()) {
    try { obj = JSON.parse(v); } catch { obj = null; }
  } else if (v && typeof v === 'object') {
    obj = v as Record<string, unknown>;
  }
  if (!obj || typeof obj !== 'object') return [];
  return Object.entries(obj).map(([k, val]) => [k, val == null ? '' : String(val)]);
}

interface MappingOption { key: string; label: string }

/**
 * 子流程字段映射编辑器（结构化键值对）。
 * - leftOptions / rightOptions 为可选下拉项；allowCreate 允许自定义输入
 * - 通过 onChange 回传 Record<string,string>
 */
function MappingEditor({
  value,
  onChange,
  leftOptions,
  rightOptions,
  leftPlaceholder,
  rightPlaceholder,
  addText,
}: Readonly<{
  value: unknown;
  onChange: (next: Record<string, string>) => void;
  leftOptions: MappingOption[];
  rightOptions: MappingOption[];
  leftPlaceholder: string;
  rightPlaceholder: string;
  addText: string;
}>) {
  const pairs = asMappingPairs(value);
  const emit = (next: Array<[string, string]>) => {
    const obj: Record<string, string> = {};
    for (const [k, val] of next) {
      if (k && k.trim()) obj[k.trim()] = val;
    }
    onChange(obj);
  };
  const updateAt = (idx: number, side: 0 | 1, v: string) => {
    const next = pairs.map((p) => [...p] as [string, string]);
    if (!next[idx]) return;
    next[idx][side] = v;
    emit(next);
  };
  const removeAt = (idx: number) => emit(pairs.filter((_, i) => i !== idx));
  const add = () => emit([...pairs, ['', '']]);
  const toOptionList = (opts: MappingOption[]) => opts.map((o) => ({ value: o.key, label: o.label === o.key ? o.key : `${o.label} (${o.key})` }));
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {pairs.length === 0 && (
        <Typography.Text type="tertiary" size="small">暂无映射，点击下方按钮添加</Typography.Text>
      )}
      {pairs.map(([k, val], idx) => (
        <div key={idx} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <Select
            value={k || undefined}
            onChange={(v) => updateAt(idx, 0, (v as string) ?? '')}
            placeholder={leftPlaceholder}
            optionList={toOptionList(leftOptions)}
            style={{ flex: 1 }}
            filter
            allowCreate
            size="small"
          />
          <Typography.Text type="tertiary">←</Typography.Text>
          <Select
            value={val || undefined}
            onChange={(v) => updateAt(idx, 1, (v as string) ?? '')}
            placeholder={rightPlaceholder}
            optionList={toOptionList(rightOptions)}
            style={{ flex: 1 }}
            filter
            allowCreate
            size="small"
          />
          <Button theme="borderless" type="danger" size="small" icon={<Trash2 size={14} />} onClick={() => removeAt(idx)} />
        </div>
      ))}
      <Button theme="borderless" size="small" icon={<Plus size={14} />} onClick={add} style={{ alignSelf: 'flex-start' }}>{addText}</Button>
    </div>
  );
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
  /** 设计态体检：本节点问题（严重项内联到对应区域；警告/提示见「流程体检」） */
  health?: NodeHealthInfo;
  users: UserOption[];
  roles: RoleOption[];
  userGroups?: UserGroupOption[];
  positions?: PositionOption[];
  departments?: DepartmentOption[];
  formFields: FormField[];
  allNodes?: Array<{ id: string; key?: string; name: string; type: FlowNodeType }>;
  /** 可选为“驳回到指定节点”的候选节点（当前节点之前同一执行路径上的审批/办理节点） */
  rejectableAncestorNodes?: Array<{ id: string; key?: string; name: string; type: FlowNodeType }>;
  /** 子流程节点可选的已发布流程定义列表 */
  subProcessOptions?: SubProcessOption[];
  onSave: (nodeId: string, updates: { name?: string; key?: string; props?: Record<string, unknown> }) => void;
  onCancel: () => void;
  /** 只读模式：禁用全部编辑（点击节点查看配置），仅保留关闭 */
  readOnly?: boolean;
  /** 抽屉层级；嵌入到其它 SideSheet 内（如只读设计器）时需高于外层，避免被遮挡 */
  zIndex?: number;
}

/** 节点严重问题内联提示：紧凑红字 + 修复建议，替代抽屉顶部的整块 Banner */
function InlineCriticalErrors({ issues }: Readonly<{ issues: NodeHealthIssue[] }>) {
  if (issues.length === 0) return null;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 16 }}>
      {issues.map((iss, idx) => (
        <div key={idx} style={{ display: 'flex', gap: 6, alignItems: 'flex-start' }}>
          <AlertTriangle size={14} style={{ color: 'var(--semi-color-danger)', flexShrink: 0, marginTop: 2 }} />
          <div style={{ flex: 1 }}>
            <Typography.Text type="danger" size="small">{iss.message}</Typography.Text>
            {iss.suggestion && (
              <Typography.Text type="tertiary" size="small" style={{ display: 'block', marginTop: 2 }}>建议：{iss.suggestion}</Typography.Text>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

export default function NodeConfigDrawer({
  visible,
  node,
  health,
  users,
  roles,
  userGroups = [],
  positions = [],
  departments = [],
  formFields,
  allNodes = [],
  rejectableAncestorNodes = [],
  subProcessOptions = [],
  onSave,
  onCancel,
  readOnly = false,
  zIndex,
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
    ? (readOnly ? '发起人设置' : '设置发起人')
    : `${readOnly ? '查看' : '编辑'}${nodeInfo?.label ?? '节点'}`;

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
    const nextProps = node.type === 'approver'
      ? { ...props, actionButtons: normalizeActionButtons(props.actionButtons as ActionButtonsConfig | undefined) }
      : props;
    onSave(node.id, { name, key: trimmedKey, props: nextProps });
  };

  const [connectorOptions, setConnectorOptions] = useState<Array<{ value: number; label: string }>>([]);
  useEffect(() => {
    if (!visible || node?.type !== 'trigger') return;
    void request.get<{ list: Array<{ id: number; name: string; type: string }> }>('/api/workflows/connectors?status=enabled&pageSize=100')
      .then((res) => { if (res.code === 0) setConnectorOptions((res.data?.list ?? []).map((c) => ({ value: c.id, label: `${c.name}（${c.type}）` }))); });
  }, [visible, node?.type]);

  const [decisionTableOptions, setDecisionTableOptions] = useState<Array<{ value: string; label: string }>>([]);
  useEffect(() => {
    if (!visible || node?.type !== 'routeBranch') return;
    void request.get<{ list: Array<{ key: string; name: string }> }>('/api/rules/decision-tables?status=published&pageSize=100')
      .then((res) => { if (res.code === 0) setDecisionTableOptions((res.data?.list ?? []).map((t) => ({ value: t.key, label: `${t.name}（${t.key}）` }))); });
  }, [visible, node?.type]);

  // 判断哪些 Tab 可用
  const isApprover = node?.type === 'approver';
  const isHandler = node?.type === 'handler';
  const isCc = node?.type === 'cc';
  const isInitiator = node?.type === 'initiator';
  const isDelay = node?.type === 'delay';
  const isTrigger = node?.type === 'trigger';
  const isSubProcess = node?.type === 'subProcess';
  const isRouteBranch = node?.type === 'routeBranch';
  const hasAssigneeSettings = isApprover || isHandler || isCc;
  const hasFormPermission = isApprover || isHandler || isCc || isInitiator;
  const hasOperationPermission = isApprover;

  // 节点实时体检：仅展示「严重」级问题并内联到对应区域；警告/提示统一在「流程体检」查看
  const criticalIssues = (health?.issues ?? []).filter((i) => i.severity === 'critical');
  const approverCriticalIssues = criticalIssues.filter((i) => i.category === 'approver' || i.category === 'expression');
  const otherCriticalIssues = criticalIssues.filter((i) => i.category !== 'approver' && i.category !== 'expression');

  return (
    <SideSheet
      title={title}
      visible={visible}
      onCancel={onCancel}
      placement="right"
      width="min(640px, 96vw)"
      zIndex={zIndex}
      className={`fd-config-drawer${readOnly ? ' fd-config-drawer--readonly' : ''}`}
      footer={
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, padding: '12px 0' }}>
          {readOnly ? (
            <button type="button" className="fd-drawer-btn fd-drawer-btn--cancel" onClick={onCancel}>关闭</button>
          ) : (
            <>
              <button type="button" className="fd-drawer-btn fd-drawer-btn--cancel" onClick={onCancel}>取消</button>
              <button type="button" className="fd-drawer-btn fd-drawer-btn--save" onClick={handleSave}>保存</button>
            </>
          )}
        </div>
      }
    >
      {/* 节点实时体检：严重问题（非审批人/表达式类）兜底内联展示；审批人/表达式类内联到「审批人」Tab */}
      <InlineCriticalErrors issues={otherCriticalIssues} />

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
                <InlineCriticalErrors issues={approverCriticalIssues} />
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
                  approveRatio={props.approveRatio as number | undefined}
                  multiLevelEndType={(props.multiLevelEndType as 'topLevel' | 'level' | 'role') ?? 'topLevel'}
                  multiLevelEndLevel={(props.multiLevelEndLevel as number) ?? 1}
                  multiLevelEndRoleId={(props.multiLevelEndRoleId as number) ?? undefined}
                  nodeApproverNodeId={(props.nodeApproverNodeId as string) ?? undefined}
                  userGroupIds={(props.userGroupIds as number[]) ?? []}
                  formDeptField={(props.formDeptField as string) ?? undefined}
                  formDeptHeadLevel={(props.formDeptHeadLevel as number) ?? 1}
                  postIds={(props.postIds as number[]) ?? []}
                  deptMemberDeptIds={(props.deptMemberDeptIds as number[]) ?? []}
                  deptMemberIncludeChildren={(props.deptMemberIncludeChildren as boolean) ?? false}
                  selectScopeType={(props.selectScopeType as 'user' | 'role' | 'department' | 'userGroup') ?? 'user'}
                  selectScopeIds={(props.selectScopeIds as number[]) ?? []}
                  assigneeExpression={(props.assigneeExpression as string) ?? ''}
                  decisionRuleKey={(props.decisionRuleKey as string) ?? ''}
                  rejectStrategy={(props.rejectStrategy as RejectStrategy) ?? 'terminate'}
                  rejectToNodeKey={props.rejectToNodeKey as string | undefined}
                  availableRejectNodes={rejectableAncestorNodes}
                  emptyStrategy={(props.emptyStrategy as EmptyAssigneeStrategy) ?? 'autoApprove'}
                  emptyAssignTo={props.emptyAssignTo as number | undefined}
                  emptyAssignToIds={props.emptyAssignToIds as number[] | undefined}
                  sameInitiatorStrategy={(props.sameInitiatorStrategy as SameInitiatorStrategy) ?? 'selfApprove'}
                  deduplicateStrategy={(props.deduplicateStrategy as DeduplicateStrategy) ?? 'autoSkip'}
                  returnMode={(props.returnMode as 'reexecute' | 'backToOrigin') ?? 'reexecute'}
                  catchAction={props.catchAction as 'toAdmin' | 'notify' | 'terminate' | undefined}
                  catchNotifyUserIds={props.catchNotifyUserIds as number[] | undefined}
                  timeout={props.timeout as TimeoutConfig | undefined}
                  users={users}
                  roles={roles}
                  userGroups={userGroups}
                  positions={positions}
                  departments={departments}
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
                          <Form.Slot label="连接器（可选）">
                            <Select
                              placeholder="选择已配置连接器，统一鉴权/超时/重试/熔断"
                              value={typeof ext.connectorId === 'number' ? ext.connectorId : undefined}
                              onChange={(v) => updateExt({ connectorId: v as number | undefined })}
                              style={{ width: '100%' }}
                              showClear
                              optionList={connectorOptions}
                            />
                          </Form.Slot>
                          <Form.Slot label={typeof ext.connectorId === 'number' ? '回调路径（相对连接器地址，可空）' : '回调 URL'}>
                            <Input
                              value={typeof ext.url === 'string' ? ext.url : ''}
                              onChange={(v) => updateExt({ url: v })}
                              placeholder={typeof ext.connectorId === 'number' ? '/approve（留空则调用连接器基础地址）' : 'https://example.com/approve'}
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

          {/* 审批要求 Tab（仅审批人） */}
          {hasOperationPermission && (
            <TabPane tab="审批要求" itemKey="operations">
              <ApprovalRequirementsTab
                operations={(props.operations as OperationPermission[]) ?? DEFAULT_APPROVER_OPERATIONS}
                onChange={(ops) => handlePropsChange({ operations: ops })}
              />
            </TabPane>
          )}

          {/* 操作按钮设置 Tab（仅审批人） */}
          {hasOperationPermission && (
            <TabPane tab="操作按钮设置" itemKey="actionButtons">
              <ActionButtonsTab
                value={props.actionButtons as ActionButtonsConfig | undefined}
                onChange={(next) => handlePropsChange({ actionButtons: next })}
                jumpTargetNodes={rejectableAncestorNodes}
              />
            </TabPane>
          )}

          {/* 节点监听器 Tab（审批人 / 办理人） */}
          {(isApprover || isHandler) && (
            <TabPane tab="节点监听器" itemKey="listeners">
              <NodeListenersTab
                value={props.nodeListeners as NodeListenerConfig[] | undefined}
                onChange={(next) => handlePropsChange({ nodeListeners: next })}
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
                <Form.Slot label="连接器（可选，统一鉴权 / 超时 / 重试 / 熔断）">
                  <Select
                    value={typeof props.connectorId === 'number' ? props.connectorId : undefined}
                    onChange={(v) => handlePropsChange({ connectorId: v as number | undefined })}
                    placeholder="不使用连接器（直接调用请求地址）"
                    style={{ width: '100%' }}
                    showClear
                    optionList={connectorOptions}
                    emptyContent="无可用连接器，请先在「连接器」中创建"
                  />
                </Form.Slot>
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
                <Form.Slot label={typeof props.connectorId === 'number' ? '请求路径（相对连接器地址，可空）' : '请求地址'}>
                  <Input
                    value={typeof props.webhookUrl === 'string' ? props.webhookUrl : ''}
                    onChange={(v) => handlePropsChange({ webhookUrl: v })}
                    placeholder={typeof props.connectorId === 'number' ? '/api/notify（留空则调用连接器基础地址）' : 'https://example.com/webhook'}
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
            {(props.triggerType as string) === 'callback' && (
              <>
                <Form.Slot label="回调签名方式">
                  <Select
                    value={(props.callbackSignMode as string) ?? 'hmacSha256'}
                    onChange={(v) => handlePropsChange({ callbackSignMode: v })}
                    style={{ width: '100%' }}
                    optionList={[
                      { value: 'none', label: '不校验签名' },
                      { value: 'hmacSha256', label: 'HMAC-SHA256（X-Zenith-Signature）' },
                    ]}
                  />
                </Form.Slot>
                {((props.callbackSignMode as string) ?? 'hmacSha256') === 'hmacSha256' && (
                  <Form.Slot label="回调密钥（HMAC Secret）">
                    <Input
                      value={typeof props.callbackSecret === 'string' ? props.callbackSecret : ''}
                      onChange={(v) => handlePropsChange({ callbackSecret: v })}
                      placeholder="用于校验外部 POST 回调的 HMAC 密钥"
                      mode="password"
                    />
                  </Form.Slot>
                )}
                <Typography.Text type="tertiary" size="small">
                  回调地址通过 {'{{callbackUrl}}'} 占位符在 webhook 请求体/请求头中下发，外部系统 POST 回调后流程才会继续。
                </Typography.Text>
              </>
            )}
          </div>
        </div>
      )}

      {/* 子流程配置 */}
      {isSubProcess && (() => {
        const childOpt = subProcessOptions.find((o) => o.value === props.subProcessId);
        const childFields = childOpt?.fields ?? [];
        const mode = (props.subProcessMode as string) ?? 'single';
        const isMulti = mode === 'multi';
        const waitChild = (props.subProcessWaitChild as boolean | undefined) !== false;
        const initiator = (props.subProcessInitiator as string) ?? 'parentInitiator';
        const ignoreReject = props.subProcessIgnoreReject === true;
        const arrayFieldTypes = new Set(['multiSelect', 'checkbox', 'tags', 'userSelect', 'deptSelect']);
        const loopSourceFields = formFields.filter((f) => arrayFieldTypes.has(f.type ?? ''));
        const childFieldOptions: MappingOption[] = childFields.map((f) => ({ key: f.key, label: f.label }));
        const parentFieldOptions: MappingOption[] = formFields.map((f) => ({ key: f.key, label: f.label }));
        const inputRightOptions: MappingOption[] = [
          ...formFields.map((f) => ({ key: `{{form.${f.key}}}`, label: f.label })),
          ...(isMulti ? [{ key: '{{item}}', label: '当前循环项' }] : []),
        ];
        return (
        <div className="fd-drawer-tab-content">
          <Typography.Title heading={6} style={{ marginBottom: 16 }}>子流程配置</Typography.Title>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <Form.Slot label="子流程">
              <Select
                value={(props.subProcessId as number) ?? undefined}
                onChange={(v) => handlePropsChange({ subProcessId: v, subProcessName: subProcessOptions.find((o) => o.value === v)?.label })}
                placeholder={subProcessOptions.length === 0 ? '暂无已发布的流程定义' : '请选择子流程定义'}
                style={{ width: '100%' }}
                optionList={subProcessOptions.map((o) => ({ value: o.value, label: o.label }))}
                showClear
                filter
                emptyContent="暂无已发布的流程"
              />
            </Form.Slot>

            <Form.Slot label="调用模式">
              <RadioGroup
                type="button"
                value={mode}
                onChange={(e) => handlePropsChange({ subProcessMode: e.target.value })}
              >
                <Radio value="single">单实例</Radio>
                <Radio value="multi">多实例</Radio>
              </RadioGroup>
            </Form.Slot>

            {isMulti && (
              <>
                <Form.Slot label="循环数据源（数组型字段，逐项发起一个子流程）">
                  <Select
                    value={(props.subProcessMultiSource as string) ?? undefined}
                    onChange={(v) => handlePropsChange({ subProcessMultiSource: v })}
                    placeholder={loopSourceFields.length === 0 ? '表单中暂无数组型字段（多选/复选/标签/人员/部门）' : '请选择循环字段'}
                    style={{ width: '100%' }}
                    optionList={loopSourceFields.map((f) => ({ value: f.key, label: `${f.label} (${f.key})` }))}
                    showClear
                    filter
                    emptyContent="暂无可循环字段"
                  />
                </Form.Slot>
                <Form.Slot label="执行方式">
                  <RadioGroup
                    value={(props.subProcessMultiExecution as string) ?? 'parallel'}
                    onChange={(e) => handlePropsChange({ subProcessMultiExecution: e.target.value })}
                  >
                    <Radio value="parallel">并行（同时发起全部，全部完成后继续）</Radio>
                    <Radio value="serial">串行（依次发起，前一个结束再发起下一个）</Radio>
                  </RadioGroup>
                </Form.Slot>
                <Form.Slot label="某个子实例被驳回时">
                  <RadioGroup
                    value={(props.subProcessOnChildReject as string) ?? 'abort'}
                    onChange={(e) => handlePropsChange({ subProcessOnChildReject: e.target.value })}
                  >
                    <Radio value="abort">中止整个节点</Radio>
                    <Radio value="continue">忽略并继续其余实例</Radio>
                  </RadioGroup>
                </Form.Slot>
                <Form.Slot label="当前循环项写入子表单字段（可选）">
                  <Select
                    value={(props.subProcessMultiItemKey as string) ?? undefined}
                    onChange={(v) => handlePropsChange({ subProcessMultiItemKey: v })}
                    placeholder="选择子流程字段（亦可在映射中用 {{item}} 引用）"
                    style={{ width: '100%' }}
                    optionList={childFieldOptions.map((o) => ({ value: o.key, label: o.label === o.key ? o.key : `${o.label} (${o.key})` }))}
                    showClear
                    filter
                    allowCreate
                    emptyContent="子流程暂无字段"
                  />
                </Form.Slot>
              </>
            )}

            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <Typography.Text>等待子流程完成</Typography.Text>
              <Switch
                checked={waitChild}
                onChange={(v) => handlePropsChange({ subProcessWaitChild: v, isAsync: !v })}
              />
            </div>
            <Typography.Text type="tertiary" size="small">
              {waitChild
                ? '父流程在子流程结束（通过 / 驳回）后继续执行下游节点'
                : '父流程不等待子流程，立即继续下游节点（fire-and-forget）'}
            </Typography.Text>

            <Form.Slot label="子实例发起人">
              <RadioGroup
                value={initiator}
                onChange={(e) => handlePropsChange({ subProcessInitiator: e.target.value })}
              >
                <Radio value="parentInitiator">父流程发起人</Radio>
                <Radio value="formField">取表单字段</Radio>
                <Radio value="specifiedUser">指定成员</Radio>
              </RadioGroup>
            </Form.Slot>
            {initiator === 'formField' && (
              <Form.Slot label="发起人字段（存放用户 ID）">
                <Select
                  value={(props.subProcessInitiatorField as string) ?? undefined}
                  onChange={(v) => handlePropsChange({ subProcessInitiatorField: v })}
                  placeholder="请选择存放用户 ID 的表单字段"
                  style={{ width: '100%' }}
                  optionList={formFields.map((f) => ({ value: f.key, label: `${f.label} (${f.key})` }))}
                  showClear
                  filter
                />
              </Form.Slot>
            )}
            {initiator === 'specifiedUser' && (
              <Form.Slot label="指定成员">
                <Select
                  value={(props.subProcessInitiatorUserId as number) ?? undefined}
                  onChange={(v) => handlePropsChange({ subProcessInitiatorUserId: v })}
                  placeholder="请选择成员"
                  style={{ width: '100%' }}
                  optionList={users.map((u) => ({ value: u.id, label: u.nickname }))}
                  showClear
                  filter
                />
              </Form.Slot>
            )}

            <Form.Slot label="入参映射（父 → 子）">
              <MappingEditor
                value={props.subProcessFieldMapping}
                onChange={(m) => handlePropsChange({ subProcessFieldMapping: m })}
                leftOptions={childFieldOptions}
                rightOptions={inputRightOptions}
                leftPlaceholder="子流程字段"
                rightPlaceholder="父表单取值"
                addText="添加入参映射"
              />
            </Form.Slot>
            <Form.Slot label="出参映射（子 → 父）">
              <MappingEditor
                value={props.subProcessOutputMapping}
                onChange={(m) => handlePropsChange({ subProcessOutputMapping: m })}
                leftOptions={parentFieldOptions}
                rightOptions={childFieldOptions}
                leftPlaceholder="父表单字段"
                rightPlaceholder="子流程字段"
                addText="添加出参映射"
              />
            </Form.Slot>
            {isMulti && (
              <Typography.Text type="tertiary" size="small">多实例下，出参映射会按子实例完成顺序聚合为数组写回父字段。</Typography.Text>
            )}

            <Form.Slot label="子流程被驳回后">
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <Switch
                    checked={ignoreReject}
                    onChange={(v) => handlePropsChange({ subProcessIgnoreReject: v })}
                  />
                  <Typography.Text>忽略驳回，按通过继续父流程</Typography.Text>
                </div>
                {!ignoreReject && (
                  <Select
                    value={(props.rejectStrategy as string) ?? 'terminate'}
                    onChange={(v) => handlePropsChange({ rejectStrategy: v })}
                    style={{ width: '100%' }}
                    optionList={[
                      { value: 'terminate', label: '终止流程（驳回）' },
                      { value: 'returnPrev', label: '退回上一审批节点' },
                      { value: 'returnStart', label: '退回发起人（重走流程）' },
                      { value: 'returnToNode', label: '退回指定节点' },
                    ]}
                  />
                )}
                {!ignoreReject && (props.rejectStrategy as string) === 'returnToNode' && (
                  <Select
                    value={(props.rejectToNodeKey as string) ?? undefined}
                    onChange={(v) => handlePropsChange({ rejectToNodeKey: v })}
                    placeholder="请选择退回目标节点"
                    style={{ width: '100%' }}
                    optionList={rejectableAncestorNodes.map((n) => ({ value: n.key ?? n.id, label: n.name }))}
                    emptyContent="无可退回的前序节点"
                  />
                )}
              </div>
            </Form.Slot>
          </div>
        </div>
        );
      })()}
      {/* 路由分支节点配置 */}
      {isRouteBranch && (() => {
        const routableFields = formFields.filter(f => f.type === 'select' || f.type === 'radio');
        return (
          <div className="fd-drawer-tab-content">
            <Typography.Title heading={6} style={{ marginBottom: 16 }}>路由配置</Typography.Title>
            <Typography.Text type="tertiary" size="small" style={{ display: 'block', marginBottom: 12 }}>
              选择用于路由判断的表单字段（仅支持下拉/单选类型）。切换字段后，现有分支的匹配值会被清空。
            </Typography.Text>
            <Form.Slot label="路由字段">
              <Select
                value={(props.routeFieldKey as string) ?? ''}
                onChange={(v) => handlePropsChange({ routeFieldKey: v })}
                placeholder={routableFields.length === 0 ? '表单中暂无可用的下拉/单选字段' : '请选择路由字段'}
                style={{ width: '100%' }}
                optionList={routableFields.map(f => ({ value: f.key, label: f.label }))}
                emptyContent="暂无可用字段"
                disabled={routableFields.length === 0}
                showClear
              />
            </Form.Slot>
            <Form.Slot label="决策表（可选）">
              <Select
                value={(props.decisionRuleKey as string) ?? undefined}
                onChange={(v) => handlePropsChange({ decisionRuleKey: v })}
                placeholder={decisionTableOptions.length === 0 ? '规则中心暂无已发布决策表' : '选择决策表，进网关前求值并并入表单数据'}
                style={{ width: '100%' }}
                optionList={decisionTableOptions}
                filter
                emptyContent="暂无已发布决策表"
                showClear
              />
              <Typography.Text type="tertiary" size="small" style={{ display: 'block', marginTop: 6 }}>
                配置后，规则中心该决策表的输出字段将合并到表单数据，可在路由字段/出边条件中直接引用其输出键。
              </Typography.Text>
            </Form.Slot>
          </div>
        );
      })()}
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
    case 'routeBranch':
      return {
        routeFieldKey: '',
      };
    case 'trigger':
      return {
        triggerType: 'webhook',
        callbackSignMode: 'hmacSha256',
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
        subProcessWaitChild: true,
        isAsync: false,
        subProcessMode: 'single',
        subProcessMultiExecution: 'parallel',
        subProcessOnChildReject: 'abort',
        subProcessInitiator: 'parentInitiator',
        subProcessIgnoreReject: false,
      };
    default:
      return {};
  }
}
