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
  | 'user'                       // 指定成员
  | 'role'                       // 指定角色
  | 'department'                 // 部门负责人
  | 'post'                       // 指定岗位
  | 'deptMember'                 // 指定部门成员
  | 'initiator'                  // 发起人自己
  | 'startUserDeptResponsible'   // 发起人部门分管领导
  | 'manager'                    // 直属主管（支持多层级）
  | 'formUser'                   // 表单内联系人字段
  | 'initiatorSelect'            // 发起人自选
  | 'initiatorSelectScope'       // 发起人自选指定范围
  | 'approverSelect'             // 上一节点审批人自选
  | 'multiLevelManager'          // 连续多级上级
  | 'multiLevelDeptHead'         // 连续多级部门负责人
  | 'nodeApprover'               // 节点审批人（关联前序节点）
  | 'userGroup'                  // 用户组
  | 'formDepartment'             // 表单内部门
  | 'expression';                // 流程表达式

/** 审批类型（节点级总开关） */
export type ApprovalType =
  | 'manual'       // 人工审批（默认）
  | 'autoApprove'  // 自动通过
  | 'autoReject';  // 自动拒绝

/** 多人审批方式 */
export type ApproveMethod =
  | 'or'          // 或签（一人通过即可）
  | 'and'         // 会签（所有人通过）
  | 'sequential'  // 依次审批
  | 'ratio'       // 比例会签
  | 'random'      // 随机挑选一人审批
  | 'auto';       // 自动通过（无需人工审批）

/** 空审批人处理策略 */
export type EmptyAssigneeStrategy =
  | 'autoApprove'     // 自动通过
  | 'assignToAdmin'   // 转交管理员
  | 'reject'          // 自动拒绝
  | 'assignTo';       // 转交指定人

/** 拒绝策略 */
export type RejectStrategy =
  | 'terminate'      // 终止流程
  | 'returnPrev'     // 退回上一步审批节点
  | 'returnStart'    // 退回发起人（流程从头开始）
  | 'returnToNode';  // 退回到指定节点

/** 操作权限 */
export type OperationPermission =
  | 'approve'           // 通过
  | 'reject'            // 拒绝
  | 'comment'           // 评论
  | 'signature'         // 手写签名
  | 'opinionRequired';  // 审批意见必填

/** 表单字段权限 */
export type FieldPermission = 'read' | 'edit' | 'hidden';

/** 审批操作按钮 key */
export type ActionButtonKey =
  | 'approve'
  | 'reject'
  | 'transfer'
  | 'delegate'
  | 'addSign'
  | 'return';

/** 单个操作按钮的配置 */
export interface ActionButtonConfig {
  enabled: boolean;
  displayName?: string;
  opinionName?: string;
  jumpToNodeKey?: string;
  uploadRequired?: boolean;
}

export type ActionButtonsConfig = Partial<Record<ActionButtonKey, ActionButtonConfig>>;

/** 超时处理配置 */
export interface TimeoutConfig {
  enabled: boolean;
  duration: number;
  /** 时间单位（默认 hours，向后兼容） */
  unit?: 'minutes' | 'hours' | 'days';
  action: 'remind' | 'autoApprove' | 'autoReject';
  remindCount?: number;   // 提醒次数（action='remind' 时）
  /** 提醒耗尽仍未处理时的升级动作（仅 action='remind' 时生效） */
  escalateAction?: 'none' | 'autoApprove' | 'autoReject' | 'transferToManager';
  /** escalateAction='transferToManager' 时的上级层级（1=直属上级，默认 1） */
  escalateManagerLevel?: number;
}

// ─── 节点 Props 类型 ─────────────────────────────────────────────────

/** 审批人与发起人为同一人时的处理策略 */
export type SameInitiatorStrategy =
  | 'selfApprove'       // 由发起人自己审批
  | 'autoSkip'          // 自动跳过
  | 'toDirectManager'   // 转交给直接上级审批
  | 'toDeptHead';       // 转交给部门负责人审批

/** 审批人去重策略（多节点中同一审批人） */
export type DeduplicateStrategy =
  | 'autoSkip'          // 自动跳过（默认，后续节点自动同意）
  | 'repeatApprove';    // 仍需审批

/** 审批人节点 Props */
export interface ApproverNodeProps {
  approvalType?: ApprovalType;            // 审批类型（默认 manual）
  excludeFromStats?: boolean;             // 不计入审批效率统计
  assigneeType: AssigneeType;
  assigneeIds?: number[];                 // user 策略
  assigneeNames?: string[];
  roleIds?: number[];                     // role 策略
  roleNames?: string[];
  managerLevel?: number;                  // manager 策略层级
  formUserField?: string;                 // formUser 策略
  multiLevelEndType?: 'topLevel' | 'level' | 'role';  // 连续多级的审批终点类型
  multiLevelEndLevel?: number;            // 连续多级终点层级
  multiLevelEndRoleId?: number;           // 连续多级终点角色
  nodeApproverNodeId?: string;            // 节点审批人：关联的前序节点ID
  userGroupIds?: number[];                // 用户组ID
  userGroupNames?: string[];              // 用户组名称
  postIds?: number[];                     // 岗位ID（post 策略）
  postNames?: string[];
  deptMemberDeptIds?: number[];           // 指定部门成员的部门 IDs（deptMember 策略）
  deptMemberDeptNames?: string[];
  deptMemberIncludeChildren?: boolean;    // deptMember: 是否包含子部门
  selectScopeType?: 'user' | 'role' | 'department' | 'userGroup'; // approverSelect / initiatorSelectScope 的范围类型
  selectScopeIds?: number[];              // 对应的范围 IDs
  assigneeExpression?: string;            // 流程表达式（expression 策略）
  formDeptField?: string;                 // 表单内部门字段
  formDeptHeadLevel?: number;             // 表单内部门负责人层级
  approveMethod: ApproveMethod;
  approveRatio?: number;                  // 比例会签阈值（1-100，仅 approveMethod='ratio' 时生效）
  rejectStrategy: RejectStrategy;
  rejectToNodeKey?: string;               // 当 rejectStrategy='returnToNode' 时，目标节点 id
  emptyStrategy: EmptyAssigneeStrategy;
  /** @deprecated 兼容旧数据，使用 emptyAssignToIds */
  emptyAssignTo?: number;
  /** @deprecated 兼容旧数据，使用 emptyAssignToNames */
  emptyAssignToName?: string;
  emptyAssignToIds?: number[];            // assignTo 策略（多人时全部生成会签任务）
  emptyAssignToNames?: string[];
  sameInitiatorStrategy?: SameInitiatorStrategy;  // 审批人=发起人时
  deduplicateStrategy?: DeduplicateStrategy;      // 审批人去重
  /** 退回模式：reexecute 重新执行后续路径（默认）/ backToOrigin 被退回节点通过后跳回本节点 */
  returnMode?: 'reexecute' | 'backToOrigin';
  /** 审批人为空异常处理：toAdmin 转管理员 / notify 通知并自动通过 / terminate 终止 */
  catchAction?: 'toAdmin' | 'notify' | 'terminate';
  catchNotifyUserIds?: number[];
  operations: OperationPermission[];
  actionButtons?: ActionButtonsConfig;
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
  /** @deprecated 兼容旧数据，使用 emptyAssignToIds */
  emptyAssignTo?: number;
  /** @deprecated 兼容旧数据，使用 emptyAssignToNames */
  emptyAssignToName?: string;
  emptyAssignToIds?: number[];
  emptyAssignToNames?: string[];
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
  onlyOnApprove?: boolean;  // 仅同意时抄送
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
  /** 入参映射（父→子）：key=子字段，value 支持 {{form.x}} / {{item}} */
  subProcessFieldMapping?: Record<string, string>;
  /** 出参映射（子→父）：key=父字段，value=子字段 */
  subProcessOutputMapping?: Record<string, string>;
  /** 是否等待子流程结束（默认 true） */
  subProcessWaitChild?: boolean;
  /** 调用模式：single 单实例 / multi 多实例 */
  subProcessMode?: 'single' | 'multi';
  /** 多实例循环数据源字段 key */
  subProcessMultiSource?: string;
  /** 多实例执行方式 */
  subProcessMultiExecution?: 'parallel' | 'serial';
  /** 多实例：当前循环项写入子实例的字段 key */
  subProcessMultiItemKey?: string;
  /** 多实例：子实例驳回策略 */
  subProcessOnChildReject?: 'abort' | 'continue';
  /** 子实例发起人来源 */
  subProcessInitiator?: 'parentInitiator' | 'formField' | 'specifiedUser';
  subProcessInitiatorField?: string;
  subProcessInitiatorUserId?: number;
  /** 子流程被驳回时忽略并继续 */
  subProcessIgnoreReject?: boolean;
  isAsync: boolean;
}

/** 发起人节点 Props */
export interface InitiatorNodeProps {
  initiatorDesc?: string;
  fieldPermissions: Record<string, FieldPermission>;
}

// ─── 条件 ────────────────────────────────────────────────────────────

export type ConditionOperator =
  | 'eq' | 'neq' | 'gt' | 'gte' | 'lt' | 'lte'
  | 'in' | 'notIn' | 'contains'
  | 'isEmpty' | 'isNotEmpty'
  | 'between' | 'withinDays' | 'beforeDays';

export interface ConditionRule {
  field: string;
  operator: ConditionOperator;
  value: string | number | boolean;
  /** 条件来源：'form'(默认)=表单字段；'starter'=发起人维度（field 取 'user'|'dept'|'role'|'post'） */
  source?: 'form' | 'starter';
  /** 聚合函数（仅 form 来源；field 指向明细/数组字段） */
  aggregate?: 'sum' | 'count' | 'avg';
  /** 聚合列字段 key（count 时可省略） */
  aggregateField?: string;
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
  /** 路由分支专用：与父节点 props.routeFieldKey 字段做相等匹配的值 */
  caseValue?: string;
  isDefault?: boolean;
  children?: FlowNode;
}

// ─── 节点 ────────────────────────────────────────────────────────────

export interface FlowNode {
  id: string;
  /** 用户可编辑的稳定业务标识；运行时事件 nodeKey 优先使用此字段，未设置则回退到 id */
  key?: string;
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

// ─── 运行态（实例详情流程图）渲染辅助类型 ───────────────────────────

/** 单个节点上的某一处理人运行态 */
export interface NodeRuntimeApprover {
  name: string;
  avatar?: string | null;
  status: 'approved' | 'rejected' | 'pending' | 'waiting' | 'skipped';
  actionAt?: string | null;
  comment?: string | null;
}

/** 节点级运行态（由实例 tasks 聚合而来），用于流程图按 nodeKey 叠加状态 */
export interface NodeRuntimeInfo {
  status: 'approved' | 'rejected' | 'pending' | 'waiting' | 'skipped';
  approvers: NodeRuntimeApprover[];
}

// ─── 用于渲染的辅助类型 ─────────────────────────────────────────────

export type BranchNodeType = 'conditionBranch' | 'parallelBranch' | 'inclusiveBranch' | 'routeBranch';

export function isBranchNode(type: FlowNodeType): type is BranchNodeType {
  return ['conditionBranch', 'parallelBranch', 'inclusiveBranch', 'routeBranch'].includes(type);
}
