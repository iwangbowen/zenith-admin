/**
 * 钉钉/飞书风格流程设计器 — 数据模型
 *
 * 流程节点采用嵌套树结构（链表 + 分支），
 * 保存到后端时转换为扁平 nodes + edges 格式。
 */

// ─── 节点类型 ────────────────────────────────────────────────────────

export type FlowNodeType =
  | 'initiator'
  | 'approver'
  | 'handler'
  | 'cc'
  | 'delay'
  | 'trigger'
  | 'subProcess'
  | 'conditionBranch'
  | 'parallelBranch'
  | 'inclusiveBranch'
  | 'routeBranch';

// ─── 审批人/办理人/抄送人策略 ────────────────────────────────────────

/** 审批人指定策略 */
export type AssigneeType =
  | 'user'              // 指定成员
  | 'role'              // 指定角色
  | 'department'        // 部门负责人
  | 'initiator'         // 发起人自己
  | 'manager'           // 直属主管（支持多层级）
  | 'formUser'          // 表单内联系人字段
  | 'initiatorSelect';  // 发起人自选

/** 多人审批方式 */
export type ApproveMethod =
  | 'or'          // 或签（一人通过即可）
  | 'and'         // 会签（所有人通过）
  | 'sequential'  // 依次审批
  | 'auto';       // 自动通过（无需人工审批）

/** 空审批人处理策略 */
export type EmptyAssigneeStrategy =
  | 'autoApprove'     // 自动通过
  | 'assignToAdmin'   // 转交管理员
  | 'reject'          // 自动拒绝
  | 'assignTo';       // 转交指定人

/** 拒绝策略 */
export type RejectStrategy =
  | 'terminate'     // 终止流程
  | 'returnPrev'    // 退回上一步
  | 'returnStart';  // 退回发起人

/** 操作权限 */
export type OperationPermission =
  | 'approve'    // 通过
  | 'reject'     // 拒绝
  | 'transfer'   // 转办
  | 'addSign'    // 加签
  | 'return'     // 退回
  | 'comment';   // 评论

/** 表单字段权限 */
export type FieldPermission = 'read' | 'edit' | 'hidden';

/** 超时处理配置 */
export interface TimeoutConfig {
  enabled: boolean;
  duration: number;       // 单位：小时
  action: 'remind' | 'autoApprove' | 'autoReject';
  remindCount?: number;   // 提醒次数（action='remind' 时）
}

// ─── 节点 Props 类型 ─────────────────────────────────────────────────

/** 审批人节点 Props */
export interface ApproverNodeProps {
  assigneeType: AssigneeType;
  assigneeIds?: number[];         // user 策略
  assigneeNames?: string[];
  roleIds?: number[];             // role 策略
  roleNames?: string[];
  managerLevel?: number;          // manager 策略层级
  formUserField?: string;         // formUser 策略
  approveMethod: ApproveMethod;
  rejectStrategy: RejectStrategy;
  emptyStrategy: EmptyAssigneeStrategy;
  emptyAssignTo?: number;         // assignTo 策略
  emptyAssignToName?: string;
  operations: OperationPermission[];
  fieldPermissions: Record<string, FieldPermission>;
  timeout?: TimeoutConfig;
}

/** 办理人节点 Props */
export interface HandlerNodeProps {
  assigneeType: AssigneeType;
  assigneeIds?: number[];
  assigneeNames?: string[];
  roleIds?: number[];
  roleNames?: string[];
  managerLevel?: number;
  formUserField?: string;
  emptyStrategy: EmptyAssigneeStrategy;
  emptyAssignTo?: number;
  emptyAssignToName?: string;
  fieldPermissions: Record<string, FieldPermission>;
}

/** 抄送人节点 Props */
export interface CcNodeProps {
  assigneeType: AssigneeType;
  assigneeIds?: number[];
  assigneeNames?: string[];
  roleIds?: number[];
  roleNames?: string[];
  managerLevel?: number;
  formUserField?: string;
  fieldPermissions: Record<string, FieldPermission>;
}

/** 延迟器节点 Props */
export interface DelayNodeProps {
  delayType: 'fixed' | 'toDate';
  delayValue?: number;
  delayUnit?: 'minute' | 'hour' | 'day';
  targetDate?: string;
}

/** 触发器节点 Props */
export interface TriggerNodeProps {
  triggerType: 'webhook' | 'callback' | 'updateData' | 'deleteData';
  webhookUrl?: string;
  httpMethod?: 'GET' | 'POST' | 'PUT';
  headers?: Record<string, string>;
  body?: string;
}

/** 子流程节点 Props */
export interface SubProcessNodeProps {
  subProcessId?: number;
  subProcessName?: string;
  isAsync: boolean;
}

/** 发起人节点 Props */
export interface InitiatorNodeProps {
  initiatorDesc?: string;
  fieldPermissions: Record<string, FieldPermission>;
}

// ─── 条件 ────────────────────────────────────────────────────────────

export type ConditionOperator = 'eq' | 'neq' | 'gt' | 'gte' | 'lt' | 'lte' | 'in' | 'contains';

export interface ConditionRule {
  field: string;
  operator: ConditionOperator;
  value: string | number | boolean;
}

export interface ConditionGroup {
  type: 'and' | 'or';
  rules: ConditionRule[];
}

// ─── 分支 ────────────────────────────────────────────────────────────

export interface FlowBranch {
  id: string;
  name: string;
  priority?: number;
  conditions?: ConditionGroup[];
  isDefault?: boolean;
  children?: FlowNode;
}

// ─── 节点 ────────────────────────────────────────────────────────────

export interface FlowNode {
  id: string;
  type: FlowNodeType;
  name: string;
  props: Record<string, unknown>;
  children?: FlowNode;        // 下一个节点（链表）
  branches?: FlowBranch[];    // 分支节点专用
}

// ─── 流程定义顶层 ────────────────────────────────────────────────────

export interface FlowProcess {
  initiator: FlowNode;  // 根节点（发起人）
}

// ─── 用于渲染的辅助类型 ─────────────────────────────────────────────

export type BranchNodeType = 'conditionBranch' | 'parallelBranch' | 'inclusiveBranch' | 'routeBranch';

export function isBranchNode(type: FlowNodeType): type is BranchNodeType {
  return ['conditionBranch', 'parallelBranch', 'inclusiveBranch', 'routeBranch'].includes(type);
}
