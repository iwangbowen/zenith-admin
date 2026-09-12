import { createLabelOptions, createLabelOptionsFromMap } from '../core/enum-options';
import type {
  NodeListenerEvent,
  WorkflowActionUploadMode,
  WorkflowApproveMethod,
  WorkflowApproverDedupMode,
  WorkflowAutomationTrigger,
  WorkflowCompensationActionType,
  WorkflowConnectorBreakerState,
  WorkflowConnectorType,
  WorkflowEngineActionKey,
  WorkflowEngineComponentStatus,
  WorkflowEngineQueueKey,
  WorkflowEventDeliveryStatus,
  WorkflowEventType,
  WorkflowFormStatus,
  WorkflowJobType,
  WorkflowNodeType,
  WorkflowTriggerExecutionStatus,
  WorkflowTriggerType,
} from './types';

export const WORKFLOW_DEFINITION_STATUSES = ['draft', 'published', 'disabled'] as const;

export const WORKFLOW_DEFINITION_STATUS_LABELS: Record<(typeof WORKFLOW_DEFINITION_STATUSES)[number], string> = {
  draft: '草稿',
  published: '已发布',
  disabled: '已禁用',
};

export const WORKFLOW_DEFINITION_STATUS_OPTIONS: Array<{ value: (typeof WORKFLOW_DEFINITION_STATUSES)[number]; label: string }> =
  createLabelOptions(WORKFLOW_DEFINITION_STATUSES, WORKFLOW_DEFINITION_STATUS_LABELS);

export const WORKFLOW_INSTANCE_STATUSES = ['draft', 'running', 'suspended', 'returned', 'approved', 'rejected', 'withdrawn', 'cancelled'] as const;

export const WORKFLOW_INSTANCE_STATUS_FILTERS = WORKFLOW_INSTANCE_STATUSES;

/** 活跃（非终态）实例状态：业务键（bizType+bizId）唯一约束仅作用于这些状态，终态后允许同一业务记录重新发起 */
export const WORKFLOW_ACTIVE_INSTANCE_STATUSES = ['draft', 'running', 'suspended', 'returned'] as const;

export const WORKFLOW_TASK_STATUSES = ['pending', 'approved', 'rejected', 'skipped', 'waiting'] as const;

/** 外部审批派发状态（task.status='waiting' 且启用 externalApproval 时） */
export const WORKFLOW_TASK_EXTERNAL_DISPATCH_STATUSES = ['pending', 'dispatched', 'failed', 'fallback'] as const;

/** 全局任务监控可筛选的任务节点类型 */
export const WORKFLOW_TASK_MONITOR_NODE_TYPES = ['approve', 'handler', 'ccNode', 'delay', 'trigger', 'subProcess'] as const;

export const WORKFLOW_INSTANCE_PRIORITIES = ['low', 'normal', 'high', 'urgent'] as const;

export const WORKFLOW_NODE_TYPES = ['start', 'approve', 'end', 'exclusiveGateway', 'parallelGateway', 'ccNode'] as const;

export const WORKFLOW_NODE_TYPE_LABELS: Record<WorkflowNodeType, string> = {
  start: '开始',
  approve: '审批',
  handler: '办理',
  end: '结束',
  exclusiveGateway: '条件网关',
  parallelGateway: '并行网关',
  inclusiveGateway: '包容网关',
  routeGateway: '路由网关',
  ccNode: '抄送',
  delay: '延时',
  trigger: '触发器',
  subProcess: '子流程',
  catchNode: '捕获',
};

export const WORKFLOW_NODE_TYPE_OPTIONS: Array<{ value: WorkflowNodeType; label: string }> =
  createLabelOptionsFromMap(WORKFLOW_NODE_TYPE_LABELS);

export const WORKFLOW_CONDITION_OPERATORS = ['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'in', 'contains'] as const;

/** 流程级自动化规则触发时机 */
export const WORKFLOW_AUTOMATION_TRIGGERS = ['approved', 'rejected', 'withdrawn', 'created'] as const;

export const WORKFLOW_AUTOMATION_TRIGGER_LABELS: Record<WorkflowAutomationTrigger, string> = {
  approved: '流程通过',
  rejected: '流程驳回',
  withdrawn: '流程撤回',
  created: '流程发起时',
};

export const WORKFLOW_AUTOMATION_TRIGGER_OPTIONS: Array<{ value: WorkflowAutomationTrigger; label: string }> =
  createLabelOptions(WORKFLOW_AUTOMATION_TRIGGERS, WORKFLOW_AUTOMATION_TRIGGER_LABELS);

export const WORKFLOW_AUTOMATION_RUN_STATUSES = ['success', 'failed', 'skipped'] as const;

/** 流程事件总线事件类型（事件订阅 / 投递记录 / 引擎事件监听共用） */
export const WORKFLOW_EVENT_TYPES = [
  'instance.created', 'instance.approved', 'instance.rejected', 'instance.withdrawn', 'instance.returned',
  'node.entered', 'node.left',
  'task.created', 'task.assigned', 'task.approved', 'task.rejected', 'task.skipped', 'task.transferred', 'task.addSigned', 'task.reduceSigned', 'task.urged',
] as const;

export const WORKFLOW_EVENT_TYPE_LABELS: Record<WorkflowEventType, string> = {
  'instance.created': '实例创建',
  'instance.approved': '实例通过',
  'instance.rejected': '实例驳回',
  'instance.withdrawn': '实例撤回',
  'instance.returned': '实例退回',
  'node.entered': '节点进入',
  'node.left': '节点离开',
  'task.created': '任务创建',
  'task.assigned': '任务分配',
  'task.approved': '任务通过',
  'task.rejected': '任务驳回',
  'task.skipped': '任务跳过',
  'task.transferred': '任务转交',
  'task.addSigned': '任务加签',
  'task.reduceSigned': '任务减签',
  'task.urged': '任务催办',
};

export const WORKFLOW_EVENT_TYPE_OPTIONS: Array<{ value: WorkflowEventType; label: string }> =
  createLabelOptions(WORKFLOW_EVENT_TYPES, WORKFLOW_EVENT_TYPE_LABELS);

export const WORKFLOW_EVENT_SIGN_MODES = ['hmacSha256', 'none'] as const;

export const WORKFLOW_EVENT_DELIVERY_STATUSES = ['pending', 'success', 'failed', 'retrying'] as const;

export const WORKFLOW_EVENT_DELIVERY_STATUS_LABELS: Record<WorkflowEventDeliveryStatus, string> = {
  pending: '待发送',
  success: '成功',
  failed: '失败',
  retrying: '重试中',
};

export const WORKFLOW_EVENT_DELIVERY_STATUS_OPTIONS: Array<{ value: WorkflowEventDeliveryStatus; label: string }> =
  createLabelOptions(WORKFLOW_EVENT_DELIVERY_STATUSES, WORKFLOW_EVENT_DELIVERY_STATUS_LABELS);

export const WORKFLOW_TRIGGER_TYPES = ['webhook', 'callback', 'updateData', 'deleteData'] as const;

export const WORKFLOW_TRIGGER_TYPE_LABELS: Record<WorkflowTriggerType, string> = {
  webhook: 'Webhook',
  callback: '回调',
  updateData: '更新数据',
  deleteData: '删除数据',
};

export const WORKFLOW_TRIGGER_TYPE_OPTIONS: Array<{ value: WorkflowTriggerType; label: string }> =
  createLabelOptions(WORKFLOW_TRIGGER_TYPES, WORKFLOW_TRIGGER_TYPE_LABELS);

export const WORKFLOW_TRIGGER_EXECUTION_STATUSES = ['pending', 'running', 'success', 'failed', 'retrying'] as const;

export const WORKFLOW_TRIGGER_EXECUTION_STATUS_LABELS: Record<WorkflowTriggerExecutionStatus, string> = {
  pending: '待执行',
  running: '执行中',
  success: '成功',
  failed: '失败',
  retrying: '重试中',
};

export const WORKFLOW_TRIGGER_EXECUTION_STATUS_OPTIONS: Array<{ value: WorkflowTriggerExecutionStatus; label: string }> =
  createLabelOptions(WORKFLOW_TRIGGER_EXECUTION_STATUSES, WORKFLOW_TRIGGER_EXECUTION_STATUS_LABELS);

/** 统一作业账本（workflow_jobs）作业类型 */
export const WORKFLOW_JOB_TYPES = [
  'delay_wake', 'task_timeout', 'trigger_dispatch', 'external_dispatch',
  'subprocess_spawn', 'subprocess_join', 'event_dispatch', 'webhook_delivery',
  'compensation_action',
] as const;

export const WORKFLOW_JOB_TYPE_LABELS: Record<WorkflowJobType, string> = {
  delay_wake: '延时唤醒',
  task_timeout: '任务超时',
  trigger_dispatch: '触发器派发',
  external_dispatch: '外部派发',
  subprocess_spawn: '子流程发起',
  subprocess_join: '子流程汇聚',
  event_dispatch: '事件派发',
  webhook_delivery: 'Webhook 投递',
  compensation_action: '补偿动作',
};

export const WORKFLOW_JOB_TYPE_OPTIONS: Array<{ value: WorkflowJobType; label: string }> =
  createLabelOptions(WORKFLOW_JOB_TYPES, WORKFLOW_JOB_TYPE_LABELS);

export const WORKFLOW_JOB_STATUSES = ['pending', 'running', 'paused', 'succeeded', 'failed', 'dead', 'canceled'] as const;
export const WORKFLOW_ADVANCING_JOB_TYPES = ['delay_wake', 'task_timeout', 'external_dispatch', 'subprocess_spawn', 'subprocess_join'] as const;
export const WORKFLOW_TIMER_JOB_TYPES = ['task_timeout', 'delay_wake'] as const;
export const WORKFLOW_SUSPENDABLE_JOB_TYPES = [
  'delay_wake', 'task_timeout', 'trigger_dispatch', 'external_dispatch', 'subprocess_spawn', 'subprocess_join',
] as const;

export const WORKFLOW_JOB_EXECUTION_STATUSES = ['running', 'succeeded', 'failed'] as const;

/** 引擎运维恢复动作（全部为幂等的恢复扫描） */
export const WORKFLOW_ENGINE_ACTION_KEYS = [
  'replay-outbox', 'recover-delays', 'recover-subprocess', 'process-timeouts', 'recover-triggers', 'recover-webhooks',
] as const;

export const WORKFLOW_ENGINE_ACTION_KEY_LABELS: Record<WorkflowEngineActionKey, string> = {
  'replay-outbox': '重放事件派发',
  'recover-delays': '恢复延时任务',
  'recover-subprocess': '恢复子流程',
  'process-timeouts': '处理超时任务',
  'recover-triggers': '恢复触发器重派',
  'recover-webhooks': '恢复 Webhook 投递',
};

export const WORKFLOW_ENGINE_ACTION_KEY_OPTIONS: Array<{ value: WorkflowEngineActionKey; label: string }> =
  createLabelOptions(WORKFLOW_ENGINE_ACTION_KEYS, WORKFLOW_ENGINE_ACTION_KEY_LABELS);

export const WORKFLOW_ENGINE_COMPONENT_STATUSES = ['healthy', 'warning', 'critical'] as const;

export const WORKFLOW_ENGINE_COMPONENT_STATUS_LABELS: Record<WorkflowEngineComponentStatus, string> = {
  healthy: '正常',
  warning: '关注',
  critical: '严重',
};

export const WORKFLOW_ENGINE_COMPONENT_STATUS_OPTIONS: Array<{ value: WorkflowEngineComponentStatus; label: string }> =
  createLabelOptions(WORKFLOW_ENGINE_COMPONENT_STATUSES, WORKFLOW_ENGINE_COMPONENT_STATUS_LABELS);

export const WORKFLOW_ENGINE_COMPONENT_KEYS = [
  'dagExecutor', 'taskMaterializer', 'delayScheduler', 'timeoutProcessor', 'triggerDispatcher',
  'externalApprover', 'subProcessRecovery', 'eventBus', 'outbox', 'scheduler',
] as const;

export const WORKFLOW_ENGINE_QUEUE_KEYS = [
  'humanTasks', 'delayWakeups', 'timeouts', 'triggerDispatch', 'externalApprovals', 'subProcessJoin', 'eventOutbox',
] as const;

export const WORKFLOW_ENGINE_QUEUE_KEY_LABELS: Record<WorkflowEngineQueueKey, string> = {
  humanTasks: '人工任务',
  delayWakeups: '延时唤醒',
  timeouts: '超时处理',
  triggerDispatch: '触发器调度',
  externalApprovals: '外部审批',
  subProcessJoin: '子流程汇聚',
  eventOutbox: '事件派发',
};

export const WORKFLOW_ENGINE_QUEUE_KEY_OPTIONS: Array<{ value: WorkflowEngineQueueKey; label: string }> =
  createLabelOptions(WORKFLOW_ENGINE_QUEUE_KEYS, WORKFLOW_ENGINE_QUEUE_KEY_LABELS);

export const WORKFLOW_RUNTIME_ISSUE_SEVERITIES = ['info', 'warning', 'critical'] as const;

/** 健康巡检问题类型 */
export const WORKFLOW_HEALTH_ISSUE_TYPES = [
  'external_dispatch_failed', 'external_dispatch_pending', 'trigger_waiting_no_execution', 'trigger_execution_failed',
  'subprocess_waiting', 'delay_overdue', 'delay_missing_wake_job', 'task_timeout_overdue', 'token_task_mismatch',
  'workflow_event_outbox_failed', 'workflow_event_outbox_pending', 'waiting_task_stuck', 'instance_stalled',
] as const;

export const WORKFLOW_HEALTH_ISSUE_TYPE_LABELS: Record<(typeof WORKFLOW_HEALTH_ISSUE_TYPES)[number], string> = {
  external_dispatch_failed: '外部审批失败',
  external_dispatch_pending: '外部审批未派发',
  trigger_waiting_no_execution: '触发器无执行记录',
  trigger_execution_failed: '触发器执行失败',
  subprocess_waiting: '子流程等待',
  delay_overdue: '延迟未唤醒',
  delay_missing_wake_job: '延迟缺唤醒作业',
  task_timeout_overdue: '任务超时',
  token_task_mismatch: 'Token 与任务不一致',
  workflow_event_outbox_failed: '事件派发失败',
  workflow_event_outbox_pending: '事件派发待处理',
  waiting_task_stuck: '任务等待过久',
  instance_stalled: '实例疑似卡死',
};

export const WORKFLOW_HEALTH_ISSUE_TYPE_OPTIONS: Array<{ value: (typeof WORKFLOW_HEALTH_ISSUE_TYPES)[number]; label: string }> =
  createLabelOptions(WORKFLOW_HEALTH_ISSUE_TYPES, WORKFLOW_HEALTH_ISSUE_TYPE_LABELS);

/** 连接器类型（含尚未开放创建的 mq / database，历史数据可能存在） */
export const WORKFLOW_CONNECTOR_TYPES = ['http', 'webhook', 'email', 'sms', 'wecom', 'dingtalk', 'feishu', 'mq', 'database'] as const;

export const WORKFLOW_CONNECTOR_TYPE_LABELS: Record<WorkflowConnectorType, string> = {
  http: 'HTTP',
  webhook: 'Webhook',
  email: '邮件',
  sms: '短信',
  wecom: '企业微信',
  dingtalk: '钉钉',
  feishu: '飞书',
  mq: '消息队列',
  database: '数据库',
};

export const WORKFLOW_CONNECTOR_TYPE_OPTIONS: Array<{ value: WorkflowConnectorType; label: string }> =
  createLabelOptions(WORKFLOW_CONNECTOR_TYPES, WORKFLOW_CONNECTOR_TYPE_LABELS);

export const WORKFLOW_CONNECTOR_BREAKER_STATES = ['closed', 'open', 'halfOpen'] as const;

export const WORKFLOW_CONNECTOR_BREAKER_STATE_LABELS: Record<WorkflowConnectorBreakerState, string> = {
  closed: '正常',
  open: '熔断',
  halfOpen: '半开',
};

export const WORKFLOW_CONNECTOR_BREAKER_STATE_OPTIONS: Array<{ value: WorkflowConnectorBreakerState; label: string }> =
  createLabelOptions(WORKFLOW_CONNECTOR_BREAKER_STATES, WORKFLOW_CONNECTOR_BREAKER_STATE_LABELS);

export const WORKFLOW_CONNECTOR_INVOCATION_SOURCES = ['test', 'trigger', 'external', 'webhook', 'manual'] as const;

export const WORKFLOW_CONNECTOR_INVOCATION_SOURCE_LABELS: Record<(typeof WORKFLOW_CONNECTOR_INVOCATION_SOURCES)[number], string> = {
  test: '测试',
  trigger: '触发器',
  external: '外部审批',
  webhook: '事件订阅',
  manual: '手动',
};

export const WORKFLOW_CONNECTOR_INVOCATION_SOURCE_OPTIONS: Array<{
  value: (typeof WORKFLOW_CONNECTOR_INVOCATION_SOURCES)[number];
  label: string;
}> = createLabelOptions(WORKFLOW_CONNECTOR_INVOCATION_SOURCES, WORKFLOW_CONNECTOR_INVOCATION_SOURCE_LABELS);

/** 待办 SLA 紧急度：none=未配置超时, safe=充裕, warning=临近, overdue=已超时 */
export const WORKFLOW_SLA_LEVELS = ['none', 'safe', 'warning', 'overdue'] as const;

export const WORKFLOW_INSTANCE_PRINT_SOURCES = ['auto', 'archive', 'live'] as const;

export const WORKFLOW_TASK_CONSULT_STATUSES = ['pending', 'replied', 'revoked'] as const;

export const WORKFLOW_DELEGATION_SCOPES = ['mine', 'all'] as const;

export const WORKFLOW_COMPENSATION_STATUSES = ['pending', 'resolved', 'terminated'] as const;

export const WORKFLOW_COMPENSATION_ACTION_STATUSES = ['none', 'pending', 'running', 'succeeded', 'failed'] as const;

export const WORKFLOW_SIMULATION_RESULT_STATUSES = ['finished', 'rejected', 'waiting', 'blocked', 'invalid', 'stepLimit'] as const;

export const WORKFLOW_SIMULATION_TIMELINE_STATUSES = ['entered', 'waiting', 'approved', 'rejected', 'autoApproved', 'skipped', 'blocked'] as const;

export const WORKFLOW_SIMULATION_NODE_STATE_STATUSES = ['pending', 'active', 'done', 'skipped', 'error'] as const;

export const WORKFLOW_SIMULATION_HEALTH_LEVELS = ['error', 'warning', 'info'] as const;

export const WORKFLOW_ENGINE_EXPLANATION_STATES = ['running', 'blocked', 'completed', 'rejected', 'canceled', 'withdrawn', 'draft'] as const;

/**
 * 流程定义 flowData 的 schema 版本（引擎 schema 版本，区别于用户发布版本号 `version`）。
 * 作为单一真源用于：导出 JSON 标记、导入/发布时的运行时兼容迁移（normalizeFlowData）。
 * 未来引擎 schema 变更（重命名字段 / 合并枚举 / 补默认值等）时 +1，并在 normalizeFlowData 追加 upcast。
 */
export const WORKFLOW_SCHEMA_VERSION = 2;

/** 流程级「自动去重」三模式选项（同一审批人在流程中重复出现时） */
export const WORKFLOW_APPROVER_DEDUP_OPTIONS: ReadonlyArray<{ value: WorkflowApproverDedupMode; label: string }> = [
  { value: 'none',        label: '不自动通过' },
  { value: 'all',         label: '仅审批一次，后续重复的审批节点均自动通过' },
  { value: 'consecutive', label: '仅针对连续审批的节点自动通过' },
];

/**
 * 解析流程级「自动去重」模式。
 * 缺省时默认 'all'（审批一次后续重复节点自动通过）。
 */
export function resolveApproverDedupMode(
  settings: { approverDedupMode?: WorkflowApproverDedupMode } | null | undefined,
): WorkflowApproverDedupMode {
  return settings?.approverDedupMode ?? 'all';
}

/** 流程表单类型：designer=表单库可视化设计器，custom=用户自定义业务页面，external=业务系统主导（businessKey 关联） */
export const WORKFLOW_FORM_TYPES = ['designer', 'custom', 'external'] as const;

/**
 * 「退回」目标的特殊值：退回发起人（实例转 returned，发起人修改后重新提交）。
 * 前端退回对话框与后端 returnTask 共用；非节点 key，不会与流程节点冲突。
 */
export const WORKFLOW_RETURN_TO_INITIATOR_KEY = '__initiator__';

export type WorkflowFormType = typeof WORKFLOW_FORM_TYPES[number];

export const WORKFLOW_FORM_TYPE_LABELS: Record<WorkflowFormType, string> = {
  designer: '表单库设计器',
  custom: '自定义业务表单',
  external: '业务系统主导',
};

export const WORKFLOW_FORM_STATUS_LABELS: Record<WorkflowFormStatus, string> = {
  enabled: '启用',
  disabled: '停用',
};

export const WORKFLOW_FORM_STATUS_OPTIONS: Array<{ value: WorkflowFormStatus; label: string }> =
  createLabelOptionsFromMap(WORKFLOW_FORM_STATUS_LABELS);

export const WORKFLOW_ACTION_UPLOAD_MODE_LABELS: Record<WorkflowActionUploadMode, string> = {
  hidden: '不显示',
  optional: '选填',
  required: '必填',
};

export const WORKFLOW_ACTION_UPLOAD_MODE_OPTIONS: Array<{ value: WorkflowActionUploadMode; label: string }> =
  createLabelOptionsFromMap(WORKFLOW_ACTION_UPLOAD_MODE_LABELS);

export const NODE_LISTENER_EVENT_LABELS: Record<NodeListenerEvent, string> = {
  onCreate: '任务创建（onCreate）',
  onApprove: '任务通过（onApprove）',
  onReject: '任务驳回（onReject）',
};

export const NODE_LISTENER_EVENT_OPTIONS: Array<{ value: NodeListenerEvent; label: string }> =
  createLabelOptionsFromMap(NODE_LISTENER_EVENT_LABELS);

export const WORKFLOW_COMPENSATION_ACTION_TYPE_LABELS: Record<WorkflowCompensationActionType, string> = {
  none: '无',
  http: 'HTTP 直连',
  connector: '流程连接器',
  sms: '短信',
  email: '邮件',
  updateData: '回填/回滚表单字段',
};

export const WORKFLOW_COMPENSATION_ACTION_TYPE_OPTIONS: Array<{ value: WorkflowCompensationActionType; label: string }> =
  createLabelOptionsFromMap(WORKFLOW_COMPENSATION_ACTION_TYPE_LABELS);

export const WORKFLOW_APPROVE_METHOD_LABELS: Record<WorkflowApproveMethod, string>
  & Record<string, string> = {
  or: '或签',
  and: '会签',
  sequential: '顺序会签',
  ratio: '比例会签',
  random: '随机一人',
  auto: '自动通过',
};

export const WORKFLOW_APPROVE_METHOD_OPTIONS: Array<{
  value: WorkflowApproveMethod;
  label: string;
}> = createLabelOptionsFromMap<WorkflowApproveMethod>(WORKFLOW_APPROVE_METHOD_LABELS);

/** 流程实例状态标签（web 各视图 / server 分析导出统一复用；Tag 颜色见 web workflow-runtime.ts） */
export const WORKFLOW_INSTANCE_STATUS_LABELS = {
  draft: '草稿',
  running: '审批中',
  suspended: '已挂起',
  returned: '已退回',
  approved: '已通过',
  rejected: '已驳回',
  withdrawn: '已撤回',
  cancelled: '已取消',
} as const;

/** 审批任务状态标签 */
export const WORKFLOW_TASK_STATUS_LABELS = {
  pending: '待审批',
  approved: '已通过',
  rejected: '已驳回',
  skipped: '已跳过',
  waiting: '等待中',
} as const;

/** 实例优先级标签（审批单打印 / 导出等纯文本场景；web 标签色见 WorkflowPriorityTag） */
export const WORKFLOW_INSTANCE_PRIORITY_LABELS: Record<typeof WORKFLOW_INSTANCE_PRIORITIES[number], string> = {
  low: '低',
  normal: '普通',
  high: '高',
  urgent: '加急',
};
