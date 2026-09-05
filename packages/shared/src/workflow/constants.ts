import { createLabelOptionsFromMap } from '../core/enum-options';
import type { WorkflowApproveMethod, WorkflowApproverDedupMode } from './types';

export const WORKFLOW_DEFINITION_STATUSES = ['draft', 'published', 'disabled'] as const;

export const WORKFLOW_INSTANCE_STATUSES = ['draft', 'running', 'suspended', 'returned', 'approved', 'rejected', 'withdrawn', 'cancelled'] as const;

/** 活跃（非终态）实例状态：业务键（bizType+bizId）唯一约束仅作用于这些状态，终态后允许同一业务记录重新发起 */
export const WORKFLOW_ACTIVE_INSTANCE_STATUSES = ['draft', 'running', 'suspended', 'returned'] as const;

export const WORKFLOW_TASK_STATUSES = ['pending', 'approved', 'rejected', 'skipped', 'waiting'] as const;

/** 外部审批派发状态（task.status='waiting' 且启用 externalApproval 时） */
export const WORKFLOW_TASK_EXTERNAL_DISPATCH_STATUSES = ['pending', 'dispatched', 'failed', 'fallback'] as const;

/** 全局任务监控可筛选的任务节点类型 */
export const WORKFLOW_TASK_MONITOR_NODE_TYPES = ['approve', 'handler', 'ccNode', 'delay', 'trigger', 'subProcess'] as const;

export const WORKFLOW_INSTANCE_PRIORITIES = ['low', 'normal', 'high', 'urgent'] as const;

export const WORKFLOW_NODE_TYPES = ['start', 'approve', 'end', 'exclusiveGateway', 'parallelGateway', 'ccNode'] as const;

export const WORKFLOW_CONDITION_OPERATORS = ['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'in', 'contains'] as const;

/** 流程级自动化规则触发时机 */
export const WORKFLOW_AUTOMATION_TRIGGERS = ['approved', 'rejected', 'withdrawn', 'created'] as const;

/** 流程事件总线事件类型（事件订阅 / 投递记录 / 引擎事件监听共用） */
export const WORKFLOW_EVENT_TYPES = [
  'instance.created', 'instance.approved', 'instance.rejected', 'instance.withdrawn', 'instance.returned',
  'node.entered', 'node.left',
  'task.created', 'task.assigned', 'task.approved', 'task.rejected', 'task.skipped', 'task.transferred', 'task.addSigned', 'task.reduceSigned', 'task.urged',
] as const;

export const WORKFLOW_EVENT_SIGN_MODES = ['hmacSha256', 'none'] as const;

export const WORKFLOW_EVENT_DELIVERY_STATUSES = ['pending', 'success', 'failed', 'retrying'] as const;

export const WORKFLOW_TRIGGER_TYPES = ['webhook', 'callback', 'updateData', 'deleteData'] as const;

export const WORKFLOW_TRIGGER_EXECUTION_STATUSES = ['pending', 'running', 'success', 'failed', 'retrying'] as const;

/** 统一作业账本（workflow_jobs）作业类型 */
export const WORKFLOW_JOB_TYPES = [
  'delay_wake', 'task_timeout', 'trigger_dispatch', 'external_dispatch',
  'subprocess_spawn', 'subprocess_join', 'event_dispatch', 'webhook_delivery',
  'compensation_action',
] as const;

export const WORKFLOW_JOB_STATUSES = ['pending', 'running', 'succeeded', 'failed', 'dead', 'canceled'] as const;

export const WORKFLOW_JOB_EXECUTION_STATUSES = ['running', 'succeeded', 'failed'] as const;

/** 引擎运维恢复动作（全部为幂等的恢复扫描） */
export const WORKFLOW_ENGINE_ACTION_KEYS = [
  'replay-outbox', 'recover-delays', 'recover-subprocess', 'process-timeouts', 'recover-triggers', 'recover-webhooks',
] as const;

export const WORKFLOW_ENGINE_COMPONENT_STATUSES = ['healthy', 'warning', 'critical'] as const;

export const WORKFLOW_ENGINE_COMPONENT_KEYS = [
  'dagExecutor', 'taskMaterializer', 'delayScheduler', 'timeoutProcessor', 'triggerDispatcher',
  'externalApprover', 'subProcessRecovery', 'eventBus', 'outbox', 'scheduler',
] as const;

export const WORKFLOW_ENGINE_QUEUE_KEYS = [
  'humanTasks', 'delayWakeups', 'timeouts', 'triggerDispatch', 'externalApprovals', 'subProcessJoin', 'eventOutbox',
] as const;

export const WORKFLOW_RUNTIME_ISSUE_SEVERITIES = ['info', 'warning', 'critical'] as const;

/** 健康巡检问题类型 */
export const WORKFLOW_HEALTH_ISSUE_TYPES = [
  'external_dispatch_failed', 'external_dispatch_pending', 'trigger_waiting_no_execution', 'trigger_execution_failed',
  'subprocess_waiting', 'delay_overdue', 'delay_missing_wake_job', 'task_timeout_overdue', 'token_task_mismatch',
  'workflow_event_outbox_failed', 'workflow_event_outbox_pending', 'waiting_task_stuck', 'instance_stalled',
] as const;

/** 连接器类型（含尚未开放创建的 mq / database，历史数据可能存在） */
export const WORKFLOW_CONNECTOR_TYPES = ['http', 'webhook', 'email', 'sms', 'wecom', 'dingtalk', 'feishu', 'mq', 'database'] as const;

export const WORKFLOW_CONNECTOR_BREAKER_STATES = ['closed', 'open', 'halfOpen'] as const;

export const WORKFLOW_CONNECTOR_INVOCATION_SOURCES = ['test', 'trigger', 'external', 'webhook', 'manual'] as const;

/** 待办 SLA 紧急度：none=未配置超时, safe=充裕, warning=临近, overdue=已超时 */
export const WORKFLOW_SLA_LEVELS = ['none', 'safe', 'warning', 'overdue'] as const;

export const WORKFLOW_TASK_CONSULT_STATUSES = ['pending', 'replied', 'revoked'] as const;

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
