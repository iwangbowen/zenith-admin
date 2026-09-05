import type {
  WORKFLOW_AUTOMATION_TRIGGERS,
  WORKFLOW_COMPENSATION_ACTION_STATUSES,
  WORKFLOW_CONNECTOR_BREAKER_STATES,
  WORKFLOW_CONNECTOR_INVOCATION_SOURCES,
  WORKFLOW_CONNECTOR_TYPES,
  WORKFLOW_DEFINITION_STATUSES,
  WORKFLOW_ENGINE_ACTION_KEYS,
  WORKFLOW_ENGINE_COMPONENT_KEYS,
  WORKFLOW_ENGINE_COMPONENT_STATUSES,
  WORKFLOW_ENGINE_EXPLANATION_STATES,
  WORKFLOW_ENGINE_QUEUE_KEYS,
  WORKFLOW_EVENT_DELIVERY_STATUSES,
  WORKFLOW_EVENT_SIGN_MODES,
  WORKFLOW_EVENT_TYPES,
  WORKFLOW_HEALTH_ISSUE_TYPES,
  WORKFLOW_INSTANCE_PRIORITIES,
  WORKFLOW_INSTANCE_STATUSES,
  WORKFLOW_JOB_EXECUTION_STATUSES,
  WORKFLOW_JOB_STATUSES,
  WORKFLOW_JOB_TYPES,
  WORKFLOW_RUNTIME_ISSUE_SEVERITIES,
  WORKFLOW_SIMULATION_HEALTH_LEVELS,
  WORKFLOW_SIMULATION_NODE_STATE_STATUSES,
  WORKFLOW_SIMULATION_RESULT_STATUSES,
  WORKFLOW_SIMULATION_TIMELINE_STATUSES,
  WORKFLOW_SLA_LEVELS,
  WORKFLOW_TASK_CONSULT_STATUSES,
  WORKFLOW_TASK_EXTERNAL_DISPATCH_STATUSES,
  WORKFLOW_TASK_STATUSES,
  WORKFLOW_TRIGGER_EXECUTION_STATUSES,
  WORKFLOW_TRIGGER_TYPES,
  WorkflowFormType,
} from './constants';
import type { WorkflowInstance, WorkflowTask } from './contracts/instances';

/**
 * 工作流引擎运行时类型：流程图 / 节点配置 / 表单结构 / 事件总线等由引擎与设计器共同持有的结构，
 * 以及无法由 schema 推导的联合类型别名。API 实体形状一律定义在 `./contracts`。
 */

// ─── 工作流引擎 ───────────────────────────────────────────────────────────────
export type WorkflowDefinitionStatus = (typeof WORKFLOW_DEFINITION_STATUSES)[number];

export type WorkflowInstanceStatus = (typeof WORKFLOW_INSTANCE_STATUSES)[number];

export type WorkflowTaskStatus = (typeof WORKFLOW_TASK_STATUSES)[number];

export type WorkflowTaskExternalDispatchStatus = (typeof WORKFLOW_TASK_EXTERNAL_DISPATCH_STATUSES)[number];

export type WorkflowInstancePriority = (typeof WORKFLOW_INSTANCE_PRIORITIES)[number];

export type WorkflowNodeType =
  | 'start'
  | 'approve'
  | 'handler'
  | 'end'
  | 'exclusiveGateway'
  | 'parallelGateway'
  | 'inclusiveGateway'
  | 'routeGateway'
  | 'ccNode'
  | 'delay'
  | 'trigger'
  | 'subProcess'
  | 'catchNode';

export type WorkflowConditionOperator = 'eq' | 'neq' | 'gt' | 'gte' | 'lt' | 'lte' | 'in' | 'notIn' | 'contains' | 'isEmpty' | 'isNotEmpty' | 'between' | 'withinDays' | 'beforeDays';

/** 子流程调用模式 */
export type WorkflowSubProcessMode = 'single' | 'multi';

/** 子流程多实例执行方式 */
export type WorkflowSubProcessExecution = 'parallel' | 'serial';

/** 子流程多实例下，某个子实例驳回时的处理策略 */
export type WorkflowSubProcessChildRejectPolicy = 'abort' | 'continue';

/** 子流程子实例发起人来源 */
export type WorkflowSubProcessInitiator = 'parentInitiator' | 'formField' | 'specifiedUser';

// 连线条件表达式（排他网关出边使用）
export interface WorkflowEdgeCondition {
  field: string;         // source='form' 时为表单字段 key；source='starter' 时为 'user'|'dept'|'role'|'post'
  operator: WorkflowConditionOperator;
  value: string | number | boolean;
  /** 条件来源：'form'(默认)=按表单字段；'starter'=按发起人维度（本人/部门/角色/岗位） */
  source?: 'form' | 'starter';
  /** 明细子表聚合：对 field（数组型明细字段）按 aggregateField 列做聚合后再比较 */
  aggregate?: 'sum' | 'count' | 'avg';
  /** 聚合列 key（aggregate 设置时生效；count 可不填） */
  aggregateField?: string;
}

/**
 * 发起人运行时上下文快照，供条件分支「发起人维度」求值。
 * deptIds 含发起人所在部门及其全部上级部门（实现「选父部门即覆盖子部门」语义）。
 */
export interface WorkflowStarterContext {
  userId: number;
  deptIds: number[];
  roleIds: number[];
  postIds: number[];
}

export interface WorkflowConditionGroup {
  type: 'and' | 'or';
  rules: WorkflowEdgeCondition[];
}

/** 审批人来源类型 */
export type WorkflowAssigneeType =
  | 'user'                       // 指定成员
  | 'role'                       // 指定角色
  | 'department'                 // 部门负责人
  | 'userGroup'                  // 用户组
  | 'post'                       // 指定岗位
  | 'deptMember'                 // 指定部门成员（可选包含子部门）
  | 'initiator'                  // 发起人本人
  | 'initiatorLeader'            // 发起人上级（兼容旧字段）
  | 'initiatorDept'              // 发起人部门主管（兼容旧字段）
  | 'startUserDeptResponsible'   // 发起人部门分管领导
  | 'manager'                    // 直属主管（支持多层级 managerLevel）
  | 'multiLevelManager'          // 连续多级上级
  | 'multiLevelDeptHead'         // 连续多级部门负责人
  | 'formUser'                   // 表单内联系人字段
  | 'formDepartment'             // 表单内部门字段
  | 'nodeApprover'               // 节点审批人（关联前序节点）
  | 'initiatorSelect'            // 发起人自选（在发起时已经填到 userIds 中）
  | 'initiatorSelectScope'       // 发起人自选指定范围
  | 'approverSelect'             // 上一节点审批人自选
  | 'decision'                   // 审批人矩阵：决策表输出来源类型+id
  | 'expression';
                // 流程表达式

/** 审批方式 */
/**
 * 审批方式（**设计态**意图，存于 flowData 节点配置）。
 * 其中 `random`/`auto` 不是落库的多人审批方式，而是更高层的派发意图：
 * - `auto`：节点自动通过（引擎在创建任务前即生成 approved 任务并续接，等价 approvalType='autoApprove'）
 * - `random`：在候选审批人中随机指派一人（落库时退化为单人 → 运行态方式为 or）
 * 运行态/落库的方式仅 {@link WorkflowResolvedApproveMethod} 四种，二者由
 * `resolveRuntimeApproveMethod()` 在任务展开时显式转换，避免「设计态 6 值 / 运行态 4 值」隐性错配。
 */
export type WorkflowApproveMethod =
  | 'and'         // 会签：所有人通过
  | 'or'          // 或签：任一人通过
  | 'sequential'  // 顺序会签：按顺序逐一通过
  | 'ratio'       // 比例会签：达到指定百分比通过即可
  | 'random'      // 随机挑选一人审批（系统在候选人中随机指派一人）
  | 'auto';
       // 自动通过

/**
 * 运行态/落库的多人审批方式（workflow_tasks.approve_method 列与 DB pg enum 一致，4 值）。
 * 设计态的 `random`/`auto` 经 `resolveRuntimeApproveMethod()` 解析后只会落到这 4 个值之一。
 */
export type WorkflowResolvedApproveMethod = Exclude<WorkflowApproveMethod, 'random' | 'auto'>;

export type WorkflowApprovalType = 'manual' | 'autoApprove' | 'autoReject';

export type WorkflowEmptyAssigneeStrategy = 'autoApprove' | 'assignToAdmin' | 'reject' | 'assignTo';

export type WorkflowSameInitiatorStrategy = 'selfApprove' | 'autoSkip' | 'toDirectManager' | 'toDeptHead';

export type WorkflowDeduplicateStrategy = 'autoSkip' | 'repeatApprove';

/** 流程级「自动去重」模式：同一审批人在流程中重复出现时的处理方式 */
export type WorkflowApproverDedupMode =
  | 'none'         // 不自动通过
  | 'all'          // 仅审批一次，后续重复的审批节点均自动通过
  | 'consecutive';
 // 仅针对连续审批的节点自动通过
/**
 * 审批要求开关（节点行为约束，非操作按钮）。
 * 按钮启停/展示名/意见与附件要求的唯一事实源是 actionButtons（WorkflowActionButtonKey → WorkflowActionButtonConfig）。
 */
export type WorkflowOperationPermission =
  | 'signature'
  | 'opinionRequired';

export type WorkflowFieldPermission = 'read' | 'edit' | 'hidden';

/** 审批操作按钮 key（运行时支持的任务动作） */
export type WorkflowActionButtonKey =
  | 'approve'    // 通过
  | 'reject'     // 拒绝
  | 'transfer'   // 转办
  | 'delegate'   // 委派
  | 'addSign'    // 加签
  | 'reduceSign' // 减签
  | 'return';
    // 退回

/**
 * 附件配置（执行此动作时的附件上传策略）：
 * - hidden：不显示附件上传区（默认）
 * - optional：显示附件上传区，选填
 * - required：显示附件上传区，必填
 */
export type WorkflowActionUploadMode = 'hidden' | 'optional' | 'required';

/** 单个操作按钮的配置 */
export interface WorkflowActionButtonConfig {
  /** 是否启用此按钮 */
  enabled: boolean;
  /** 按钮显示名称（覆盖默认文案） */
  displayName?: string;
  /** 审批意见输入框的标签文案 */
  opinionName?: string;
  /** 跳转配置：拒绝/退回时跳转到目标节点 key（仅 reject / return 生效） */
  jumpToNodeKey?: string;
  /** 附件配置：执行此动作时的附件上传策略（不显示/选填/必填），默认 hidden */
  uploadMode?: WorkflowActionUploadMode;
}

export interface WorkflowTimeoutConfig {
  enabled: boolean;
  duration: number;
  /** 时间单位（默认 hours，向后兼容） */
  unit?: 'minutes' | 'hours' | 'days';
  action: 'remind' | 'autoApprove' | 'autoReject';
  remindCount?: number;
  /**
   * 当 action='remind' 且提醒次数耗尽仍未处理时的升级动作。
   * 'none'(默认)=保持挂起；'autoApprove'/'autoReject'=自动同意/拒绝；
   * 'transferToManager'=转交给当前处理人的上级（按 escalateManagerLevel 取上级层级）。
   */
  escalateAction?: 'none' | 'autoApprove' | 'autoReject' | 'transferToManager';
  /** escalateAction='transferToManager' 时的上级层级（1=直属上级，默认 1） */
  escalateManagerLevel?: number;
  /**
   * transferToManager 找不到上级、部门负责人、管理员时的最终兜底策略。
   * 默认 none = 保持挂起但停止重复扫描；也可配置为自动同意/拒绝。
   */
  escalateFallbackAction?: 'none' | 'autoApprove' | 'autoReject';
}

/** 审批节点被驳回时的处理策略 */
export type WorkflowRejectStrategy =
  | 'terminate'      // 终止流程
  | 'returnPrev'     // 退回上一审批节点
  | 'returnStart'    // 退回发起人（从头开始）
  | 'returnToNode';
  // 退回到指定节点（由 rejectToNodeKey 指定）

// 流程节点配置（存在 flowData JSON 中）
export interface WorkflowNodeConfig {
  key: string;       // 节点唯一标识
  type: WorkflowNodeType;
  label: string;     // 显示名称
  assigneeId?: number | null;   // 审批人 ID（approve 节点单人）
  assigneeName?: string | null;
  assigneeIds?: number[] | null;  // 抄送节点 / 多人配置：多个接收人 ID
  assigneeNames?: string[] | null;
  isDefault?: boolean;            // 排他网关：是否默认出口
  /** 审批人来源类型（人工节点） */
  assigneeType?: WorkflowAssigneeType;
  approvalType?: WorkflowApprovalType;
  excludeFromStats?: boolean;
  /** 当 assigneeType = 'user' 时指定的成员 IDs */
  userIds?: number[] | null;
  /** 当 assigneeType = 'role' 时指定的角色 IDs */
  roleIds?: number[] | null;
  /** 当 assigneeType = 'department' 时指定的部门 IDs */
  deptIds?: number[] | null;
  /** 当 assigneeType = 'userGroup' 时指定的用户组 IDs */
  userGroupIds?: number[] | null;
  /** 当 assigneeType = 'post' 时指定的岗位 IDs */
  postIds?: number[] | null;
  postNames?: string[] | null;
  /** 当 assigneeType = 'deptMember' 时指定的部门 IDs（成员为这些部门下的所有用户） */
  deptMemberDeptIds?: number[] | null;
  deptMemberDeptNames?: string[] | null;
  /** deptMember：是否包含子部门成员（默认 false） */
  deptMemberIncludeChildren?: boolean;
  /** 自选范围类型（approverSelect / initiatorSelectScope 时生效） */
  selectScopeType?: 'user' | 'role' | 'department' | 'userGroup';
  /** 自选范围 IDs（与 selectScopeType 对应） */
  selectScopeIds?: number[] | null;
  /** 流程表达式（assigneeType = 'expression' 时生效，返回用户 ID 数组或单值） */
  assigneeExpression?: string;
  /** 审批方式（人工节点，多人时生效） */
  approveMethod?: WorkflowApproveMethod;
  /** 比例会签阈值（百分比 1-100，仅 approveMethod='ratio' 时生效） */
  approveRatio?: number;
  emptyStrategy?: WorkflowEmptyAssigneeStrategy;
  /** 空审批人策略=assignTo 时的转交人 ID 列表（多人时会签） */
  emptyAssignToIds?: number[] | null;
  emptyAssignToNames?: string[] | null;
  sameInitiatorStrategy?: WorkflowSameInitiatorStrategy;
  deduplicateStrategy?: WorkflowDeduplicateStrategy;
  operations?: WorkflowOperationPermission[];
  /** 操作按钮配置：每个 key 对应一个按钮的显示/启用/上传/跳转设置 */
  actionButtons?: Partial<Record<WorkflowActionButtonKey, WorkflowActionButtonConfig>>;
  fieldPermissions?: Record<string, WorkflowFieldPermission>;
  timeout?: WorkflowTimeoutConfig;
  /** manager / multiLevelManager 的层级（1 = 直属上级） */
  managerLevel?: number;
  /** 多级模式的终点类型 */
  multiLevelEndType?: 'topLevel' | 'level' | 'role';
  multiLevelEndLevel?: number;
  multiLevelEndRoleId?: number;
  /** formUser 策略：表单中联系人字段的 key */
  formUserField?: string;
  /** formDepartment 策略：表单中部门字段的 key */
  formDeptField?: string;
  formDeptHeadLevel?: number;
  /** nodeApprover 策略：关联前序节点 ID */
  nodeApproverNodeId?: string;
  /** 审批被驳回时的处理策略（仅 approve / handler 节点有意义；缺省视为 terminate） */
  rejectStrategy?: WorkflowRejectStrategy;
  /** 当 rejectStrategy = 'returnToNode' 时，目标节点的 key */
  rejectToNodeKey?: string;
  /** 触发器节点配置（type === 'trigger' 时生效） */
  triggerConfig?: WorkflowTriggerNodeConfig;
  /** 外部审批配置（type === 'approve' 时生效） */
  externalApproval?: WorkflowExternalApprovalConfig;
  onlyOnApprove?: boolean;
  subProcessId?: number;
  subProcessName?: string;
  /** 子流程：父实例字段映射到子实例 formData（key=子字段 key，value 支持 {{form.x}} / {{item}} 模板） */
  subProcessFieldMapping?: Record<string, string>;
  /** 子流程：子实例结束后回填父实例 formData（key=父字段 key，value=子字段 key；多实例时聚合为数组） */
  subProcessOutputMapping?: Record<string, string>;
  /** 子流程：是否等待子实例结束才推进父流程（默认 true） */
  subProcessWaitChild?: boolean;
  /** 子流程：调用模式 —— single 单实例（默认） / multi 多实例（遍历集合字段，逐项发起子流程） */
  subProcessMode?: WorkflowSubProcessMode;
  /** 子流程（multi）：循环数据源 —— 父表单中数组型字段 key（multiSelect/checkbox/tags/userSelect/deptSelect 等） */
  subProcessMultiSource?: string;
  /** 子流程（multi）：多实例执行方式 —— parallel 并行（默认） / serial 串行 */
  subProcessMultiExecution?: WorkflowSubProcessExecution;
  /** 子流程（multi）：将当前循环项的值写入子实例 formData 的字段 key（亦可在映射中用 {{item}} 引用） */
  subProcessMultiItemKey?: string;
  /** 子流程（multi）：某个子实例被驳回时 —— abort 中止整个节点（默认） / continue 忽略并继续其余实例 */
  subProcessOnChildReject?: WorkflowSubProcessChildRejectPolicy;
  /** 子流程：子实例发起人 —— parentInitiator 父流程发起人（默认） / formField 取表单字段 / specifiedUser 指定成员 */
  subProcessInitiator?: WorkflowSubProcessInitiator;
  /** 子流程：subProcessInitiator='formField' 时，存放用户 ID 的父表单字段 key */
  subProcessInitiatorField?: string;
  /** 子流程：subProcessInitiator='specifiedUser' 时，指定的用户 ID */
  subProcessInitiatorUserId?: number;
  /** 子流程：子实例被驳回时是否忽略并按通过继续父流程（默认 false，遵循 rejectStrategy） */
  subProcessIgnoreReject?: boolean;
  isAsync?: boolean;
  /** 延迟节点：延迟类型 */
  delayType?: 'fixed' | 'toDate';
  /** 延迟节点（fixed）：时长数值 */
  delayValue?: number;
  /** 延迟节点（fixed）：时长单位 */
  delayUnit?: 'minute' | 'hour' | 'day';
  /** 延迟节点（toDate）：表单中目标日期字段的 key */
  targetDate?: string;
  /** 节点级事件监听器（独立于定义级订阅，按节点配置在设计器中维护） */
  nodeListeners?: NodeListenerConfig[];
  /** 退回模式（approve/handler）：reexecute 重新执行后续路径（默认）/ backToOrigin 被退回节点通过后直接跳回发起退回的节点 */
  returnMode?: 'reexecute' | 'backToOrigin';
  /** 异常捕获节点（type='catchNode'）的动作 */
  catchAction?: 'toAdmin' | 'notify' | 'terminate';
  /** catchAction='notify' 时额外通知的用户 ID（默认通知发起人+管理员） */
  catchNotifyUserIds?: number[] | null;
  /** routeGateway：决策资产 key（配合 decisionRefKind），运行时进入网关前求值并把输出并入 formData，供出边条件选支 */
  decisionRuleKey?: string | null;
  /** routeGateway：决策资产类型（table=决策表 / scorecard=评分卡 / flow=决策流），缺省 table */
  decisionRefKind?: 'table' | 'scorecard' | 'flow' | null;
  /** 统一失败策略（外部副作用节点 trigger/subProcess/externalApproval 等；设置后优先于 legacy onFailure/catch 语义） */
  failurePolicy?: WorkflowNodeFailurePolicy;
}

/** 节点监听器触发事件 */
export type NodeListenerEvent = 'onCreate' | 'onApprove' | 'onReject';

/** 节点级事件监听器（webhook） */
export interface NodeListenerConfig {
  type: 'webhook';
  url: string;
  method?: 'GET' | 'POST';
  headers?: Record<string, string>;
  events: NodeListenerEvent[];
}

/** 触发器节点配置 */
export interface WorkflowTriggerNodeConfig {
  triggerType: WorkflowTriggerType;
  /** 经连接器调用：引用流程连接器 id（设置后由连接器提供基础地址/鉴权/超时/重试/熔断，webhookUrl 退化为相对路径） */
  connectorId?: number;
  /** webhook / callback：目标 URL（设置 connectorId 时作为相对 connector baseUrl 的路径，可空） */
  webhookUrl?: string;
  httpMethod?: 'GET' | 'POST' | 'PUT';
  headers?: Record<string, string>;
  /** 请求体模板（支持 {{form.field}} 占位） */
  bodyTemplate?: string;
  /** updateData / deleteData：操作的表单字段 key 列表 */
  fieldKeys?: string[];
  /** updateData：字段 key → 新值（支持 {{form.field}} 占位） */
  fieldValues?: Record<string, string>;
  /** 失败策略 */
  onFailure?: 'continue' | 'retry' | 'block';
  maxRetries?: number;
  timeoutMs?: number;
  /** callback 类型回调验签模式（默认 hmacSha256；历史流程显式 none 时才不验签） */
  callbackSignMode?: 'none' | 'hmacSha256';
  /** callback 类型 HMAC 密钥（callbackSignMode='hmacSha256' 时必填） */
  callbackSecret?: string;
}

/** 外部审批配置 */
export interface WorkflowExternalApprovalConfig {
  enabled: boolean;
  /** 经连接器调用：引用 http 连接器 id（设置后 url 退化为相对连接器基础地址的路径） */
  connectorId?: number;
  url: string;
  secret: string;
  signMode?: WorkflowEventSignMode;
  timeoutMs?: number;
  /** 调用外部 URL 失败时的兜底策略 */
  fallbackStrategy?: 'manual' | 'autoApprove' | 'autoReject';
}

/**
 * 副作用节点失败时的统一处理动作（Saga / 补偿）。
 * - continue：忽略失败，继续流程
 * - retry：按 maxRetries 重试（复用作业引擎指数退避）
 * - compensate：执行反向 / 补偿动作（撤单、解锁库存等）并生成补偿工单
 * - fallback：跳转备用节点 或 执行备选动作（如通知失败改发短信）
 * - notify：通知管理员并挂起为「待人工修复」补偿工单
 * - terminate：终止流程实例
 */
export type WorkflowNodeFailureAction =
  | 'continue'
  | 'retry'
  | 'compensate'
  | 'fallback'
  | 'notify'
  | 'terminate';

/** 补偿 / 反向 / 兜底动作类型 */
export type WorkflowCompensationActionType =
  | 'none'
  | 'http'
  | 'connector'
  | 'sms'
  | 'email'
  | 'updateData';

/**
 * 补偿 / 反向动作配置（可复用于 compensate 反向动作与 fallback 备选动作）。
 * 占位符统一支持：{{form.字段}} / {{instanceId}} / {{nodeKey}} / {{error}}。
 */
export interface WorkflowCompensationAction {
  type: WorkflowCompensationActionType;
  /** connector：引用流程连接器 id（设置后 url 退化为相对连接器基础地址的路径） */
  connectorId?: number;
  /** http / connector：目标 URL */
  url?: string;
  httpMethod?: 'GET' | 'POST' | 'PUT' | 'DELETE';
  headers?: Record<string, string>;
  /** 请求体模板（支持占位符） */
  bodyTemplate?: string;
  /** sms / email：模板 id */
  templateId?: number;
  /** sms / email：收件人（手机号 / 邮箱，支持占位符）；留空回退发起人 */
  recipients?: string[];
  /** updateData：要回填 / 回滚的父实例表单字段 key 列表 */
  fieldKeys?: string[];
  /** updateData：字段 key → 新值（支持占位符） */
  fieldValues?: Record<string, string>;
  /** 幂等键模板（默认 compensate:{{instanceId}}:{{nodeKey}}） */
  idempotencyKeyTemplate?: string;
  /** 反向动作自身失败时的最大重试次数（默认 3） */
  maxRetries?: number;
  timeoutMs?: number;
}

/** 节点级统一失败策略（附加在任意外部副作用节点，设置后优先于 legacy 语义） */
export interface WorkflowNodeFailurePolicy {
  action: WorkflowNodeFailureAction;
  /** action='retry' 时最大重试次数 */
  maxRetries?: number;
  /** action='fallback' 时跳转的备用节点 key（与 fallbackAction 二选一） */
  fallbackNodeKey?: string;
  /** action='fallback' 时执行的备选动作（与 fallbackNodeKey 二选一） */
  fallbackAction?: WorkflowCompensationAction;
  /** action='compensate' 时执行的反向动作 */
  compensation?: WorkflowCompensationAction;
  /** action='notify' 时额外通知的用户 ID */
  notifyUserIds?: number[] | null;
  /** 补偿 / 兜底动作完成后是否继续推进流程（默认按 action 语义：compensate/notify 挂起、fallback 继续） */
  continueAfter?: boolean;
  /**
   * Saga 反序回滚：本节点失败时，是否触发对该实例此前所有已成功副作用的反序补偿（默认 false）。
   * 开启后引擎按副作用成功顺序倒序逐个执行各节点配置的 compensation。
   */
  sagaRollback?: boolean;
}

// React Flow 数据结构（flowData JSON）
export interface WorkflowEdge {
  id: string;
  source: string;
  target: string;
  type?: string;
  label?: string;
  condition?: WorkflowEdgeCondition | null;  // 排他网关出边的条件
  conditions?: WorkflowConditionGroup[] | null;
  isDefault?: boolean;
  /** 异常边：当 source 节点执行异常时走向 target（通常指向 catchNode） */
  isException?: boolean;
}

/** 业务编号 / 流水号生成规则 */
/** 业务编号日期段格式（均为标准 dayjs 模板串，可直接用于格式化） */
export type WorkflowSerialDateFormat =
  | 'none'
  | 'YYYYMMDD'
  | 'YYYY-MM-DD'
  | 'YYYY/MM/DD'
  | 'YYYYMM'
  | 'YYYY-MM'
  | 'YYYY'
  | 'YY'
  | 'YYYYMMDDHHmmss';

/** 业务编号序号重置周期 */
export type WorkflowSerialResetPeriod = 'never' | 'daily' | 'monthly' | 'yearly';

/** 业务编号配置模式：structured=分项配置（默认）；template=自定义模板 */
export type WorkflowSerialNoMode = 'structured' | 'template';

export interface WorkflowSerialNoConfig {
  enabled: boolean;
  /** 配置模式，缺省视为 structured */
  mode?: WorkflowSerialNoMode;
  /** 固定前缀，如 'BX-'（structured 模式） */
  prefix?: string;
  /** 固定后缀（structured 模式） */
  suffix?: string;
  /** 日期段与序号段之间的分隔符（structured 模式），默认空 */
  separator?: string;
  /** 日期段格式（structured 模式，拼接在前缀后） */
  dateFormat?: WorkflowSerialDateFormat;
  /** 序号位数（左补零），默认 4 */
  seqLength?: number;
  /** 序号起始值，默认 1 */
  seqStart?: number;
  /** 序号递增步长，默认 1 */
  seqStep?: number;
  /** 自定义模板串（template 模式），含占位符，如 'BX-{YYYYMMDD}-{SEQ:4}' */
  template?: string;
  /** 序号重置周期 */
  resetPeriod?: WorkflowSerialResetPeriod;
}

export interface WorkflowAdvancedSettings {
  allowWithdraw: boolean;
  allowResubmit: boolean;
  notifyInitiator: boolean;
  /** 流程级「自动去重」模式（同一审批人在流程中重复出现时的处理方式） */
  approverDedupMode?: WorkflowApproverDedupMode;
  /** 是否允许在实例下自由评论（默认 true） */
  allowComment?: boolean;
  /** 待办/列表摘要字段（≤3 个表单字段 key，钉钉式卡片摘要） */
  summaryFields?: string[];
  /** 业务编号生成规则 */
  serialNo?: WorkflowSerialNoConfig;
  /** 待办/结果的多渠道通知（站内信始终开启；email/sms 可选） */
  notifyChannels?: WorkflowNotifyChannels;
}

/** 多渠道通知配置 */
export interface WorkflowNotifyChannels {
  /** 邮件通知（向处理人/发起人发送自由内容邮件） */
  email?: boolean;
  /** 短信通知（需指定短信模板 ID） */
  sms?: boolean;
  /** 短信模板 ID（sms=true 时生效） */
  smsTemplateId?: number;
}

export interface WorkflowFlowData {
  nodes: Array<{
    id: string;
    type?: string;
    position: { x: number; y: number };
    data: WorkflowNodeConfig;
  }>;
  edges: WorkflowEdge[];
  /** 钉钉/飞书风格流程树结构（新版设计器使用） */
  process?: Record<string, unknown>;
  settings?: WorkflowAdvancedSettings;
}

// 表单字段类型
export type WorkflowFormFieldType =
  | 'text'          // 单行文本
  | 'textarea'      // 多行文本
  | 'number'        // 数字
  | 'date'          // 日期
  | 'dateRange'     // 日期区间
  | 'time'          // 时间
  | 'select'        // 单选下拉
  | 'multiSelect'   // 多选下拉
  | 'autoComplete'  // 自动完成（带建议的输入）
  | 'radio'         // 单选框组
  | 'checkbox'      // 复选框组
  | 'switch'        // 开关
  | 'slider'        // 滑块
  | 'tags'          // 标签录入
  | 'colorPicker'   // 颜色选择器
  | 'amount'        // 金额
  | 'phone'         // 手机号
  | 'email'         // 邮箱
  | 'idCard'        // 身份证
  | 'url'           // 网址
  | 'password'      // 密码
  | 'pinCode'       // PIN 码 / 验证码
  | 'rate'          // 评分
  | 'formula'       // 公式计算
  | 'attachment'    // 附件
  | 'image'         // 图片
  | 'region'        // 省市区联动
  | 'signature'     // 手写签名
  | 'richtext'      // 富文本
  | 'userSelect'    // 用户选择器（系统集成）
  | 'deptSelect'    // 部门选择器（系统集成）
  | 'dictSelect'    // 数据字典选择器（系统集成）
  | 'cascader'      // 级联选择（树形选项，自定义层级）
  | 'nps'           // NPS 净推荐值量表（0-10 打分）
  | 'matrix'        // 矩阵量表（多行同一组选项打分/选择）
  | 'location'      // 定位（经纬度 + 地址文本）
  | 'detail'        // 明细/表格
  | 'description'   // 说明文字
  | 'serialNumber'  // 流水号
  | 'relation'      // 关联审批单（引用其他流程实例）
  | 'row'           // 栅格行
  | 'divider'       // 分割线
  | 'group'         // 分组标题
  | 'tabs'          // 标签页容器（多面板切换）
  | 'steps';
        // 分步容器（向导式分页）

// 字段显隐条件
export interface WorkflowFieldVisibilityCondition {
  field: string;
  operator: 'eq' | 'neq' | 'in' | 'contains' | 'gt' | 'lt' | 'gte' | 'lte' | 'isEmpty' | 'notEmpty';
  value: unknown;
}

/** 规则组条目：单条条件，或嵌套子组（支持「A 且 (B 或 C)」结构） */
export type WorkflowFieldVisibilityRule = WorkflowFieldVisibilityCondition | WorkflowFieldVisibilityRuleGroup;

/** 字段级高级联动：多条件 and/or 组合显隐（rules 可含嵌套子组） */
export interface WorkflowFieldVisibilityRuleGroup {
  logic: 'and' | 'or';
  rules: WorkflowFieldVisibilityRule[];
}

export interface WorkflowFormFieldColumn {
  span: number;          // 1-24 grid span
  fields: WorkflowFormField[];
}

/** 增强选项项（select/multiSelect/radio/checkbox）：支持独立 value/label、颜色、禁用 */
export interface WorkflowFormFieldOptionItem {
  value: string;
  label?: string;        // 显示文案，缺省取 value
  color?: string;        // 选项标签颜色（十六进制，如 #1677ff）
  disabled?: boolean;    // 是否禁用该选项
  imageUrl?: string;     // 选项配图 URL（radio 渲染为图片卡片单选）
}

/** 跨字段比较校验规则：当前字段值与目标字段值比较，不满足时报错 */
export interface WorkflowFormFieldCompareRule {
  operator: 'gt' | 'gte' | 'lt' | 'lte' | 'eq' | 'neq';
  field: string;         // 目标字段 key
  message?: string;      // 校验失败提示
}

/** tabs/steps 容器的单个面板（标签页 / 步骤） */
export interface WorkflowFormFieldPane {
  title: string;
  fields: WorkflowFormField[];
}

/** 级联选择（cascader）树形选项节点 */
export interface WorkflowFormCascaderNode {
  value: string;
  label?: string;        // 显示文案，缺省取 value
  children?: WorkflowFormCascaderNode[];
}

// 表单字段配置
export interface WorkflowFormField {
  key: string;
  label: string;
  type: WorkflowFormFieldType;
  required?: boolean;
  placeholder?: string;
  helpText?: string;               // 帮助提示（label 下方/旁边的说明）
  options?: string[];              // select/multiSelect 的选项（值列表，作为规范数据源）
  optionItems?: WorkflowFormFieldOptionItem[];  // 增强选项（value/label/颜色/禁用）；与 options 并存，options 始终镜像其 value
  allowOther?: boolean;            // select/radio：允许填写「其他」自定义值
  defaultValue?: unknown;
  visibilityCondition?: WorkflowFieldVisibilityCondition;
  visibilityRules?: WorkflowFieldVisibilityRuleGroup;   // 高级联动：多条件 and/or 显隐
  requiredRules?: WorkflowFieldVisibilityRuleGroup;     // 条件必填：满足规则时必填
  readOnlyRules?: WorkflowFieldVisibilityRuleGroup;     // 条件只读：满足规则时只读
  children?: WorkflowFormField[];  // 明细子字段
  precision?: number;              // 数字/金额精度
  step?: number;                   // 数字步长
  unit?: string;                   // 数字/金额单位（如 "元" "天" "件"）
  currency?: string;               // 金额币种
  amountInWords?: boolean;         // 金额字段：联动显示人民币中文大写
  dateFormat?: string;             // 日期格式
  maxCount?: number;               // 附件/图片限制数
  description?: string;            // 说明文字内容
  serialPrefix?: string;           // 流水号前缀
  rateMax?: number;                // 评分上限（默认 5）
  formula?: string;                // 公式表达式，如 "{amount} * {days}"
  defaultFormula?: string;         // 默认值公式：表单初始渲染时按各字段默认值求值一次（如 "{price}*{qty}"、CONCAT）
  validationFormula?: string;      // 自定义校验公式：求值结果为真通过（如 "{end} > {start}"）
  validationMessage?: string;      // 校验公式失败时的提示文案
  detailSummary?: boolean;         // 明细子列：是否在底部显示合计
  detailColumnWidth?: number;      // 明细子列：列宽（px，缺省自动均分）
  // 校验规则
  minLength?: number;              // 文本最小长度
  maxLength?: number;              // 文本最大长度
  min?: number;                    // 数字/金额最小值
  max?: number;                    // 数字/金额最大值
  pattern?: string;                // 正则表达式
  patternMessage?: string;         // 正则不匹配时的提示
  unique?: boolean;                // 唯一性校验：明细列内行级查重（标量字段则标记，供提交时校验）
  compareRules?: WorkflowFormFieldCompareRule[];  // 跨字段比较校验（number/amount/date）
  dateLimit?: 'none' | 'noPast' | 'noFuture' | 'custom';  // 日期可选范围模式（date/dateRange）
  minDate?: string;                // dateLimit='custom' 时最早可选日期（YYYY-MM-DD）
  maxDate?: string;                // dateLimit='custom' 时最晚可选日期（YYYY-MM-DD）
  accept?: string;                 // 附件/图片允许的文件类型（如 '.pdf,.docx,image/*'）
  maxSize?: number;                // 附件/图片单文件大小上限（MB）
  // 字段联动
  daysFromKey?: string;            // 数字字段：从指定 dateRange 字段自动计算天数
  optionsFrom?: {                  // select/multiSelect：依据父字段值动态生成选项
    sourceKey: string;             // 父字段 key
    mapping: Record<string, string[]>; // 父值 -> 子选项数组
  };
  autoFill?: {                     // select：选中某选项时自动填充其它字段
    targets: string[];             // 受控目标字段 key 列表
    byOption: Record<string, Record<string, string>>; // 选项值 -> { 目标key: 填充值 }（静态映射模式）
    dataSourceFieldMap?: Record<string, string>;      // 目标key -> 数据源记录字段名（远程数据源模式，选中后按记录回填）
  };
  dataSourceId?: number;           // select：选项来自登记的远程数据源（设置后忽略静态 options）
  // Layout fields
  columns?: WorkflowFormFieldColumn[];  // for 'row' type
  panes?: WorkflowFormFieldPane[];      // for 'tabs' / 'steps' type（标签页 / 分步面板）
  title?: string;                       // for 'group' type header
  collapsible?: boolean;                // group：是否可折叠
  defaultCollapsed?: boolean;           // group：默认折叠
  // 响应式列宽（飞书风格自动并排）：24=整行, 12=半列, 8=三分之一, 6=四分之一
  columnSpan?: number;
  // 字段状态
  readOnly?: boolean;                   // 只读（展示但不可编辑）
  hidden?: boolean;                     // 默认隐藏
  // 类型特定
  timeFormat?: string;                  // time 字段时间格式（默认 HH:mm）
  regionLevel?: 'province' | 'city' | 'district';  // region 字段选择层级深度
  // 系统集成选择器（userSelect/deptSelect/dictSelect）
  dictCode?: string;                    // dictSelect：绑定的数据字典 code
  multiple?: boolean;                   // userSelect/deptSelect/dictSelect：是否允许多选
  // relation 关联审批单
  relationDefinitionId?: number;        // 关联的目标流程定义 id（为空则可关联任意流程）
  relationDisplayField?: string;        // 关联记录展示用的表单字段 key（默认显示标题）
  // slider 滑块
  sliderMarks?: boolean;                // 是否显示刻度标记
  // cascader 级联选择
  cascaderOptions?: WorkflowFormCascaderNode[];  // 树形选项
  cascaderChangeOnSelect?: boolean;              // 允许选中任意层级（默认仅叶子可选）
  // nps 量表
  npsMinLabel?: string;                 // 左端说明（如「完全不推荐」）
  npsMaxLabel?: string;                 // 右端说明（如「强烈推荐」）
  // matrix 矩阵量表
  matrixRows?: string[];                // 行（题目）列表
  matrixColumns?: string[];             // 列（选项）列表，各行共用
  // colorPicker 颜色选择器
  alpha?: boolean;                      // 是否支持透明度（rgba）
  // 字段级标签设置（覆盖表单级 settings）
  labelPosition?: 'top' | 'left' | 'inset';   // 字段级标签位置
  labelAlign?: 'left' | 'right';               // 字段级标签对齐
  labelWidth?: number;                          // 字段级标签宽度
}

// ─── 表单库 ─────────────────────────────────────────────────────────────────

/** 表单级设置 */
export interface WorkflowFormSettings {
  description?: string;                 // 表单顶部说明
  submitButtonText?: string;            // 提交按钮文案
  labelPosition?: 'top' | 'left' | 'inset';  // 标签位置
  labelAlign?: 'left' | 'right';        // 标签对齐方式
  labelWidth?: number;                  // 左侧标签宽度（labelPosition='left'/'inset' 时）
}

/** 表单 schema：字段 + 表单级设置 */
export interface WorkflowFormSchema {
  fields: WorkflowFormField[];
  settings?: WorkflowFormSettings;
}

export type WorkflowFormStatus = 'enabled' | 'disabled';

// ── 流程连接器 ──
export type WorkflowConnectorType = (typeof WORKFLOW_CONNECTOR_TYPES)[number];

export type WorkflowConnectorBreakerState = (typeof WORKFLOW_CONNECTOR_BREAKER_STATES)[number];

export type WorkflowConnectorInvocationSource = (typeof WORKFLOW_CONNECTOR_INVOCATION_SOURCES)[number];

/** HTTP 连接器调用配置（存于 connector.config） */
export interface WorkflowConnectorHttpConfig {
  baseUrl: string;
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
  headers?: Record<string, string>;
  query?: Record<string, string>;
  contentType?: 'json' | 'form';
  authType?: 'none' | 'bearer' | 'basic' | 'apiKey';
  /** apiKey 模式：放入请求头的键名（默认 X-API-Key） */
  apiKeyHeader?: string;
}

/** 连接器凭据明文（落库前整体 AES 加密，绝不回传） */
export interface WorkflowConnectorCredentials {
  token?: string;
  username?: string;
  password?: string;
  apiKey?: string;
}

/** 自定义业务表单暴露给流程的变量声明（驱动条件分支 / 按字段指定审批人） */
export interface WorkflowCustomFormVariable {
  /** 前端渲染用唯一标识（不持久化） */
  id?: string;
  /** 变量 key（业务页提交时写入 formData 的字段名） */
  key: string;
  /** 显示名称 */
  label: string;
  /** 变量类型 */
  type: 'string' | 'number' | 'boolean' | 'date' | 'user' | 'dept';
}

/** 自定义业务表单 / 业务系统主导流程配置（formType='custom' 或 'external' 时有效） */
export interface WorkflowCustomFormConfig {
  /** 创建/填写页组件路径（相对 packages/web/src/pages，如 'biz/leave/LeaveForm'；external 可为空） */
  createComponent: string;
  /** 查看页组件路径，缺省时复用 createComponent 以只读模式渲染 */
  viewComponent?: string | null;
  /** 多页签图标（lucide 图标名，预留给整页打开时使用） */
  icon?: string | null;
  /** 暴露给流程的变量声明 */
  variables?: WorkflowCustomFormVariable[];
}

/** 实例发起时冻结的表单快照 */
export interface WorkflowInstanceFormSnapshot {
  formType?: WorkflowFormType;
  formId?: number | null;
  formName?: string | null;
  fields: WorkflowFormField[];
  settings?: WorkflowFormSettings | null;
  customForm?: WorkflowCustomFormConfig | null;
}

/** 实例发起时冻结的流程定义快照（详情渲染优先使用，避免定义后续修改影响历史实例） */
export interface WorkflowDefinitionSnapshot {
  id: number;
  name: string;
  description: string | null;
  categoryId: number | null;
  categoryName?: string | null;
  categoryColor?: string | null;
  categoryIcon?: string | null;
  flowData: WorkflowFlowData | null;
  formId: number | null;
  formName?: string | null;
  formFields?: WorkflowFormField[] | null;
  formSettings?: WorkflowFormSettings | null;
  formType: WorkflowFormType;
  customForm: WorkflowCustomFormConfig | null;
  status?: WorkflowDefinitionStatus;
  version?: number;
  tenantId?: number | null;
}

export type WorkflowAutomationTrigger = (typeof WORKFLOW_AUTOMATION_TRIGGERS)[number];

export interface WorkflowAutomationActionStartWorkflow {
  type: 'startWorkflow';
  definitionId: number;
  titleTemplate?: string;
  formMapping?: Record<string, string>;
}

export interface WorkflowAutomationActionSendMessage {
  type: 'sendMessage';
  title: string;
  content: string;
  messageType?: 'info' | 'success' | 'warning' | 'error';
  recipients?: 'initiator' | { userIds: number[] };
  buttons?: Array<{ text: string; url: string }>;
}

export interface WorkflowAutomationActionWebhook {
  type: 'webhook';
  url: string;
  method?: 'GET' | 'POST' | 'PUT';
  headers?: Record<string, string>;
  bodyTemplate?: string;
}

export interface WorkflowAutomationActionUpdateField {
  type: 'updateField';
  fields: Record<string, string>;
}

export type WorkflowAutomationAction =
  | WorkflowAutomationActionStartWorkflow
  | WorkflowAutomationActionSendMessage
  | WorkflowAutomationActionWebhook
  | WorkflowAutomationActionUpdateField;

/** 流程仿真中对指定节点预设的处理动作 */
export interface WorkflowSimulationDecision {
  nodeKey: string;
  action: 'approve' | 'reject' | 'skip' | 'wait';
  assigneeId?: number;
  reason?: string;
  formPatch?: Record<string, unknown>;
}

/** 流程仿真选项 */
export interface WorkflowSimulationOptions {
  maxSteps?: number;
  mockDelay?: boolean;
  mockTrigger?: boolean;
  expandSubProcess?: boolean;
}

export type WorkflowSimulationResultStatus = (typeof WORKFLOW_SIMULATION_RESULT_STATUSES)[number];

export type WorkflowSimulationTimelineStatus = (typeof WORKFLOW_SIMULATION_TIMELINE_STATUSES)[number];

export type WorkflowSimulationNodeStateStatus = (typeof WORKFLOW_SIMULATION_NODE_STATE_STATUSES)[number];

export type WorkflowSimulationHealthLevel = (typeof WORKFLOW_SIMULATION_HEALTH_LEVELS)[number];

// ─── 流程事件总线 ─────────────────────────────────────────────────────────────
export type WorkflowEventType = (typeof WORKFLOW_EVENT_TYPES)[number];

export interface WorkflowEventActor {
  userId: number;
  name?: string | null;
}

export interface WorkflowEventBase {
  /** 唯一事件 ID（uuid），用于外部系统幂等 */
  eventId: string;
  type: WorkflowEventType;
  /** ISO 时间戳（YYYY-MM-DD HH:mm:ss） */
  occurredAt: string;
  instanceId: number;
  definitionId: number;
  tenantId: number | null;
  actor?: WorkflowEventActor;
}

export interface WorkflowInstanceEventPayload extends WorkflowEventBase {
  type: 'instance.created' | 'instance.approved' | 'instance.rejected' | 'instance.withdrawn' | 'instance.returned';
  instance: WorkflowInstance;
}

export interface WorkflowNodeEventPayload extends WorkflowEventBase {
  type: 'node.entered' | 'node.left';
  nodeKey: string;
  nodeName: string;
  nodeType: WorkflowNodeType | null;
}

export interface WorkflowTaskEventPayload extends WorkflowEventBase {
  type: 'task.created' | 'task.assigned' | 'task.approved' | 'task.rejected' | 'task.skipped' | 'task.transferred' | 'task.addSigned' | 'task.reduceSigned' | 'task.urged';
  task: WorkflowTask;
  comment?: string | null;
}

export type WorkflowEvent =
  | WorkflowInstanceEventPayload
  | WorkflowNodeEventPayload
  | WorkflowTaskEventPayload;

export type WorkflowEventSignMode = (typeof WORKFLOW_EVENT_SIGN_MODES)[number];

export type WorkflowEventDeliveryStatus = (typeof WORKFLOW_EVENT_DELIVERY_STATUSES)[number];


// ─── 触发器节点执行 ──────────────────────────────────────────────────────────
export type WorkflowTriggerExecutionStatus = (typeof WORKFLOW_TRIGGER_EXECUTION_STATUSES)[number];

export type WorkflowTriggerType = (typeof WORKFLOW_TRIGGER_TYPES)[number];

// ─── 统一作业账本（workflow_jobs）────────────────────────────────────────────
export type WorkflowJobType = (typeof WORKFLOW_JOB_TYPES)[number];

export type WorkflowJobStatus = (typeof WORKFLOW_JOB_STATUSES)[number];

export type WorkflowJobExecutionStatus = (typeof WORKFLOW_JOB_EXECUTION_STATUSES)[number];

/** 待办 SLA 紧急度：none=未配置超时, safe=充裕, warning=临近, overdue=已超时 */
export type WorkflowSlaLevel = (typeof WORKFLOW_SLA_LEVELS)[number];

/** 审批协办状态 */
export type WorkflowTaskConsultStatus = (typeof WORKFLOW_TASK_CONSULT_STATUSES)[number];

// ─── 发布前健康评分 ──────────────────────────────────────────────────────────
export type WorkflowDefinitionHealthSeverity = 'info' | 'warning' | 'critical';

// ─── 运行轨迹 / 引擎解释（实例可观测性）─────────────────────────────────────
export type WorkflowEngineExplanationState = (typeof WORKFLOW_ENGINE_EXPLANATION_STATES)[number];

export type WorkflowRuntimeIssueSeverity = (typeof WORKFLOW_RUNTIME_ISSUE_SEVERITIES)[number];

export type WorkflowEngineComponentStatus = (typeof WORKFLOW_ENGINE_COMPONENT_STATUSES)[number];

export type WorkflowEngineComponentKey = (typeof WORKFLOW_ENGINE_COMPONENT_KEYS)[number];

export type WorkflowEngineQueueKey = (typeof WORKFLOW_ENGINE_QUEUE_KEYS)[number];

/** 引擎运维动作（复用现有恢复函数；全部为幂等的恢复扫描） */
export type WorkflowEngineActionKey = (typeof WORKFLOW_ENGINE_ACTION_KEYS)[number];

/** 引擎运维动作的筛选条件（jobType 每个动作固定，此处为附加维度） */
export interface WorkflowEngineActionFilter {
  /** 仅处理指定实例的作业 */
  instanceId?: number;
  /** 仅处理入库超过 N 分钟的作业（避开刚失败还在退避窗内的） */
  olderThanMinutes?: number;
  /** 单次处理上限（条数） */
  limit?: number;
}

export type WorkflowHealthIssueType = (typeof WORKFLOW_HEALTH_ISSUE_TYPES)[number];

// ─── 工作流：补偿/人工修复工单 ──────────────────────────────────────────────────
/** 补偿工单的自动反向/兜底动作执行状态 */
export type WorkflowCompensationActionStatus = (typeof WORKFLOW_COMPENSATION_ACTION_STATUSES)[number];
