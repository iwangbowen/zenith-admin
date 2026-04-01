/**
 * 钉钉/飞书风格流程设计器 — 节点类型注册表 & 常量
 */
import {
  UserCheck,
  ClipboardCheck,
  Send,
  GitBranch,
  GitMerge,
  Diamond,
  Clock,
  Workflow,
  Zap,
  type LucideIcon,
} from 'lucide-react';
import type {
  FlowNodeType,
  BranchNodeType,
  AssigneeType,
  ApproveMethod,
  ApprovalType,
  EmptyAssigneeStrategy,
  RejectStrategy,
  OperationPermission,
  FieldPermission,
  SameInitiatorStrategy,
  DeduplicateStrategy,
} from './types';

// ─── 节点类型注册信息 ────────────────────────────────────────────────

export interface NodeTypeInfo {
  type: FlowNodeType;
  label: string;
  icon: LucideIcon;
  color: string;          // 主题色（标题栏背景）
  description?: string;
}

/** 可通过 "+" 按钮添加的节点类型 */
export const ADDABLE_NODE_TYPES: NodeTypeInfo[] = [
  { type: 'approver',        label: '审批人', icon: UserCheck,      color: '#ff943e', description: '需要审批通过才能继续' },
  { type: 'handler',         label: '办理人', icon: ClipboardCheck, color: '#3296fa', description: '任务执行人，处理完成后继续' },
  { type: 'cc',              label: '抄送',   icon: Send,           color: '#40a9ff', description: '通知相关人员，不阻塞流程' },
  { type: 'conditionBranch', label: '条件分支', icon: GitBranch,    color: '#ff943e', description: '根据条件分支走不同路径' },
  { type: 'parallelBranch',  label: '并行分支', icon: GitMerge,     color: '#718dff', description: '所有分支同时执行' },
  { type: 'inclusiveBranch', label: '包容分支', icon: Diamond,      color: '#13c2c2', description: '满足条件的分支均执行' },
  { type: 'delay',           label: '延迟器',   icon: Clock,        color: '#999',    description: '等待指定时间后继续' },
  { type: 'routeBranch',     label: '路由分支', icon: Workflow,      color: '#f5222d', description: '动态路由分支' },
  { type: 'trigger',         label: '触发器',   icon: Zap,          color: '#722ed1', description: '等待外部事件触发' },
  { type: 'subProcess',      label: '子流程',   icon: Workflow,      color: '#8c6e36', description: '调用其他流程定义' },
];

/** 节点类型分组（用于"+"按钮弹出面板） */
export interface NodeTypeGroup {
  label: string;
  types: NodeTypeInfo[];
}

export const NODE_TYPE_GROUPS: NodeTypeGroup[] = [
  {
    label: '审批节点',
    types: [
      { type: 'approver', label: '审批人', icon: UserCheck, color: '#ff943e', description: '需要审批通过才能继续' },
      { type: 'handler', label: '办理人', icon: ClipboardCheck, color: '#3296fa', description: '处理完成后继续' },
      { type: 'cc', label: '抄送', icon: Send, color: '#40a9ff', description: '通知相关人，不阻塞流程' },
    ],
  },
  {
    label: '分支节点',
    types: [
      { type: 'conditionBranch', label: '条件分支', icon: GitBranch, color: '#ff943e', description: '根据条件走不同路径' },
      { type: 'parallelBranch', label: '并行分支', icon: GitMerge, color: '#718dff', description: '所有分支同时执行' },
      { type: 'inclusiveBranch', label: '包容分支', icon: Diamond, color: '#13c2c2', description: '满足条件的均执行' },
      { type: 'routeBranch', label: '路由分支', icon: Workflow, color: '#f5222d', description: '动态路由分支' },
    ],
  },
  {
    label: '其它节点',
    types: [
      { type: 'delay', label: '延迟器', icon: Clock, color: '#999', description: '等待指定时间后继续' },
      { type: 'trigger', label: '触发器', icon: Zap, color: '#722ed1', description: '等待外部事件触发' },
      { type: 'subProcess', label: '子流程', icon: Workflow, color: '#8c6e36', description: '调用其他流程定义' },
    ],
  },
];

/** 节点类型 → 颜色映射（含发起人） */
export const NODE_COLOR_MAP: Record<FlowNodeType, string> = {
  initiator:       '#ff943e',
  approver:        '#ff943e',
  handler:         '#3296fa',
  cc:              '#40a9ff',
  conditionBranch: '#ff943e',
  parallelBranch:  '#718dff',
  inclusiveBranch: '#13c2c2',
  routeBranch:     '#f5222d',
  delay:           '#999',
  trigger:         '#722ed1',
  subProcess:      '#8c6e36',
};

/** 分支节点默认子分支数量 */
export const DEFAULT_BRANCH_COUNT: Record<BranchNodeType, number> = {
  conditionBranch: 2,
  parallelBranch:  2,
  inclusiveBranch: 2,
  routeBranch:     2,
};

/** 分支节点的"添加分支"按钮文字 */
export const BRANCH_ADD_LABEL: Record<BranchNodeType, string> = {
  conditionBranch: '添加条件',
  parallelBranch:  '添加分支',
  inclusiveBranch: '添加分支',
  routeBranch:     '添加分支',
};

/** 条件分支—条件运算符标签 */
export const OPERATOR_LABELS: Record<string, string> = {
  eq: '等于',
  neq: '不等于',
  gt: '大于',
  gte: '大于等于',
  lt: '小于',
  lte: '小于等于',
  in: '包含在',
  contains: '包含',
};

// ─── 审批人策略选项 ──────────────────────────────────────────────────

export const ASSIGNEE_TYPE_OPTIONS: Array<{ value: AssigneeType; label: string; description: string }> = [
  { value: 'user',                label: '指定成员',        description: '选择一个或多个具体人员' },
  { value: 'role',                label: '指定角色',        description: '角色对应的所有成员' },
  { value: 'department',          label: '部门负责人',    description: '发起人所在部门的负责人' },
  { value: 'initiator',           label: '发起人自己',    description: '流程发起人自行处理' },
  { value: 'manager',             label: '直属主管',        description: '发起人的直属上级（支持多层级）' },
  { value: 'formUser',            label: '表单联系人',    description: '表单中联系人字段对应的人员' },
  { value: 'initiatorSelect',     label: '发起人自选',    description: '发起时由发起人选择审批人' },
  { value: 'multiLevelManager',   label: '连续多级上级',  description: '从直属上级开始逐级向上审批' },
  { value: 'multiLevelDeptHead',  label: '连续多级部门负责人', description: '从直属部门负责人逐级向上' },
  { value: 'nodeApprover',        label: '节点审批人',    description: '关联前序节点的实际审批人' },
  { value: 'userGroup',           label: '用户组',          description: '指定用户组的成员' },
  { value: 'formDepartment',      label: '表单内部门',    description: '关联表单中部门字段的负责人' },
];

export const APPROVE_METHOD_OPTIONS: Array<{ value: ApproveMethod; label: string; description: string }> = [
  { value: 'or',         label: '或签',     description: '一人通过即可' },
  { value: 'and',        label: '会签',     description: '需所有人通过' },
  { value: 'sequential', label: '依次审批', description: '按顺序逐一审批' },
  { value: 'auto',       label: '自动通过', description: '无需人工审批，自动流转' },
];

export const EMPTY_ASSIGNEE_OPTIONS: Array<{ value: EmptyAssigneeStrategy; label: string }> = [
  { value: 'autoApprove',   label: '自动通过' },
  { value: 'assignToAdmin', label: '转交管理员' },
  { value: 'reject',        label: '自动拒绝' },
  { value: 'assignTo',      label: '转交指定人员' },
];

export const REJECT_STRATEGY_OPTIONS: Array<{ value: RejectStrategy; label: string }> = [
  { value: 'terminate',   label: '终止流程' },
  { value: 'returnPrev',  label: '退回上一步' },
  { value: 'returnStart', label: '退回发起人' },
];

export const OPERATION_PERMISSION_OPTIONS: Array<{ value: OperationPermission; label: string }> = [
  { value: 'approve',          label: '通过' },
  { value: 'reject',           label: '拒绝' },
  { value: 'transfer',         label: '转办' },
  { value: 'addSign',          label: '加签' },
  { value: 'return',           label: '退回' },
  { value: 'comment',          label: '评论' },
  { value: 'signature',        label: '手写签名' },
  { value: 'opinionRequired',  label: '审批意见必填' },
];

export const FIELD_PERMISSION_OPTIONS: Array<{ value: FieldPermission; label: string }> = [
  { value: 'read',   label: '只读' },
  { value: 'edit',   label: '可编辑' },
  { value: 'hidden', label: '隐藏' },
];

/** 默认审批人操作权限 */
export const DEFAULT_APPROVER_OPERATIONS: OperationPermission[] = ['approve', 'reject', 'transfer', 'comment'];

/** 延迟时间单位选项 */
export const DELAY_UNIT_OPTIONS = [
  { value: 'minute', label: '分钟' },
  { value: 'hour',   label: '小时' },
  { value: 'day',    label: '天' },
];

/** 触发器类型选项 */
export const TRIGGER_TYPE_OPTIONS = [
  { value: 'webhook',    label: 'HTTP 请求' },
  { value: 'callback',   label: 'HTTP 回调' },
  { value: 'updateData', label: '更新数据' },
  { value: 'deleteData', label: '删除数据' },
];

// ─── 审批类型选项 ──────────────────────────────────────────────

export const APPROVAL_TYPE_OPTIONS: Array<{ value: ApprovalType; label: string; description: string }> = [
  { value: 'manual',      label: '人工审批',  description: '由审批人手动处理' },
  { value: 'autoApprove', label: '自动通过',  description: '无需人工审批，自动同意' },
  { value: 'autoReject',  label: '自动拒绝',  description: '无需人工审批，自动拒绝' },
];

// ─── 审批人与发起人同一人策略 ──────────────────────────────

export const SAME_INITIATOR_OPTIONS: Array<{ value: SameInitiatorStrategy; label: string }> = [
  { value: 'selfApprove',     label: '由发起人自己审批' },
  { value: 'autoSkip',        label: '自动跳过' },
  { value: 'toDirectManager', label: '转交给直接上级审批' },
  { value: 'toDeptHead',      label: '转交给部门负责人审批' },
];

// ─── 审批人去重策略 ──────────────────────────────────────────

export const DEDUPLICATE_OPTIONS: Array<{ value: DeduplicateStrategy; label: string }> = [
  { value: 'autoSkip',       label: '自动跳过（后续节点自动同意）' },
  { value: 'repeatApprove',  label: '仍需审批' },
];
