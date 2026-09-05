import * as z from 'zod';
import { auditFieldsSchema, idParam, paginated, paginationQuery } from '../../core/api-schemas';
import { defineContract, op } from '../../core/contract';
import {
  WORKFLOW_INSTANCE_PRIORITIES,
  WORKFLOW_INSTANCE_STATUSES,
  WORKFLOW_SLA_LEVELS,
  WORKFLOW_TASK_CONSULT_STATUSES,
  WORKFLOW_TASK_STATUSES,
} from '../constants';
import {
  addInstanceCcSchema,
  batchUrgeWorkflowInstanceSchema,
  batchWithdrawWorkflowInstanceSchema,
  createWorkflowCommentSchema,
  createWorkflowInstanceWithDraftSchema,
  forwardInstanceSchema,
  submitWorkflowDraftSchema,
  updateWorkflowInstanceSchema,
  urgeWorkflowTaskSchema,
  workflowActionButtonConfigSchema,
  workflowActionButtonKeySchema,
} from '../validation';
import { workflowDefinitionSnapshotSchema, workflowInstanceFormSnapshotSchema } from './flow-data';

// ─── 任务 ────────────────────────────────────────────────────────────────────

/** 审批动作附件 */
export const workflowTaskAttachmentRefSchema = z.object({
  name: z.string(),
  url: z.string(),
  size: z.number().optional(),
}).meta({ id: 'WorkflowTaskAttachmentRef' });

export type WorkflowTaskAttachmentRef = z.infer<typeof workflowTaskAttachmentRefSchema>;

/** 任务转办明细（转办 / 委派 / 管理员改派 / 离职交接 / 超时升级留痕） */
export const workflowTaskTransferSchema = z.object({
  id: z.int(),
  fromUserId: z.int().nullable(),
  fromUserName: z.string().nullable().optional(),
  toUserId: z.int(),
  toUserName: z.string().nullable().optional(),
  action: z.enum(['transfer', 'delegate', 'reassign', 'handover', 'timeout']),
  reason: z.string().nullable().optional(),
  operatorName: z.string().nullable().optional(),
  createdAt: z.string(),
}).meta({ id: 'WorkflowTaskTransfer' });

export type WorkflowTaskTransfer = z.infer<typeof workflowTaskTransferSchema>;

export const workflowTaskSchema = z.object({
  id: z.int(),
  instanceId: z.int(),
  nodeKey: z.string(),
  nodeName: z.string(),
  nodeType: z.string().nullable(),
  assigneeId: z.int().nullable(),
  assigneeName: z.string().nullable().optional(),
  assigneeAvatar: z.string().nullable().optional(),
  status: z.enum(WORKFLOW_TASK_STATUSES),
  comment: z.string().nullable(),
  signature: z.string().nullable().optional().meta({ description: '手写签名（data URL / 图片地址）' }),
  attachments: z.array(workflowTaskAttachmentRefSchema).optional(),
  signatureRequired: z.boolean().optional().meta({ description: '所属节点是否要求手写签名（由节点 operations 派生）' }),
  actionAt: z.string().nullable(),
  originalAssigneeId: z.int().nullable().optional().meta({ description: '任务原始处理人（创建时快照，转办 / 委派不会修改）' }),
  transfers: z.array(workflowTaskTransferSchema).nullable().optional().meta({ description: '转办明细（详情场景填充）' }),
  delegatedFromId: z.int().nullable().optional().meta({ description: '委派来源（仅委派期间设置；回执任务为 null）' }),
  delegationMode: z.enum(['full', 'suggest']).nullable().optional().meta({ description: '委派模式快照：full=直接代批；suggest=建议制回执' }),
  signType: z.enum(['before', 'after', 'parallel', 'excluded']).nullable().optional().meta({ description: '加签类型；excluded=运行时被排除留痕行' }),
  approveMethod: z.enum(['and', 'or', 'sequential', 'ratio']).nullable().optional().meta({ description: '多人节点的审批方式（单人任务为 null）' }),
  approveRatio: z.int().nullable().optional().meta({ description: '比例会签通过阈值百分比（仅 ratio 节点）' }),
  externalCallbackId: z.string().nullable().optional().meta({ description: '外部审批回调 ID（waiting + externalApproval 启用时生效）' }),
  actionButtons: z.partialRecord(workflowActionButtonKeySchema, workflowActionButtonConfigSchema).nullable().optional().meta({ description: '当前节点配置中的操作按钮设置（仅审批节点）' }),
  createdAt: z.string(),
}).meta({ id: 'WorkflowTask' });

export type WorkflowTask = z.infer<typeof workflowTaskSchema>;

export const workflowTaskUrgeSchema = z.object({
  id: z.int(),
  taskId: z.int(),
  instanceId: z.int(),
  urgerId: z.int().nullable(),
  urgerName: z.string().nullable(),
  message: z.string().nullable(),
  createdAt: z.string(),
}).meta({ id: 'WorkflowTaskUrge' });

export type WorkflowTaskUrge = z.infer<typeof workflowTaskUrgeSchema>;

/** 流程评论 / 沟通时间线条目 */
export const workflowCommentSchema = z.object({
  id: z.int(),
  instanceId: z.int(),
  taskId: z.int().nullable().optional(),
  parentId: z.int().nullable().optional().meta({ description: '回复引用的父评论 ID（一层引用）' }),
  parentSummary: z.object({ userName: z.string().nullable(), content: z.string() }).nullable().optional().meta({ description: '父评论摘要（作者 + 内容截断）' }),
  userId: z.int(),
  userName: z.string().nullable().optional(),
  userAvatar: z.string().nullable().optional(),
  content: z.string(),
  mentions: z.array(z.int()).meta({ description: '@ 提及的用户 ID' }),
  mentionNames: z.array(z.string()).nullable().optional(),
  attachments: z.array(z.object({ name: z.string(), url: z.string(), size: z.int().optional() })),
  createdAt: z.string(),
}).meta({ id: 'WorkflowComment' });

export type WorkflowComment = z.infer<typeof workflowCommentSchema>;

/** 审批协办 / 邀请处理意见 */
export const workflowTaskConsultSchema = z.object({
  id: z.int(),
  taskId: z.int(),
  instanceId: z.int(),
  nodeName: z.string().nullable().optional(),
  inviterId: z.int(),
  inviterName: z.string().nullable().optional(),
  consulteeId: z.int(),
  consulteeName: z.string().nullable().optional(),
  consulteeAvatar: z.string().nullable().optional(),
  question: z.string().nullable(),
  opinion: z.string().nullable(),
  status: z.enum(WORKFLOW_TASK_CONSULT_STATUSES),
  repliedAt: z.string().nullable().optional(),
  createdAt: z.string(),
}).meta({ id: 'WorkflowTaskConsult' });

export type WorkflowTaskConsult = z.infer<typeof workflowTaskConsultSchema>;

// ─── 实例 ────────────────────────────────────────────────────────────────────

/** 子流程子实例摘要（父实例详情展示与跳转） */
export const workflowChildInstanceSummarySchema = z.object({
  id: z.int(),
  title: z.string(),
  status: z.enum(WORKFLOW_INSTANCE_STATUSES),
  parentTaskNodeKey: z.string().nullable().optional().meta({ description: '触发该子实例的父任务节点 key' }),
  createdAt: z.string(),
}).meta({ id: 'WorkflowChildInstanceSummary' });

export type WorkflowChildInstanceSummary = z.infer<typeof workflowChildInstanceSummarySchema>;

/** 预测剩余路径节点（服务端沿快照 flowData 前向求值得出） */
export const workflowPredictedPathNodeSchema = z.object({
  key: z.string(),
  name: z.string(),
  type: z.enum(['approve', 'handler', 'cc']),
  branchLabel: z.string().nullable().optional().meta({ description: '进入该节点经过的条件分支标签' }),
}).meta({ id: 'WorkflowPredictedPathNode' });

export type WorkflowPredictedPathNode = z.infer<typeof workflowPredictedPathNodeSchema>;

/** 待办 / 实例列表摘要项（由 summaryFields 配置 + 表单快照解析得到） */
export const workflowInstanceSummaryItemSchema = z.object({
  key: z.string(),
  label: z.string(),
  value: z.string(),
}).meta({ id: 'WorkflowInstanceSummaryItem' });

export type WorkflowInstanceSummaryItem = z.infer<typeof workflowInstanceSummaryItemSchema>;

export const workflowInstanceSchema = z.object({
  id: z.int(),
  definitionId: z.int(),
  definitionName: z.string().nullable().optional(),
  categoryId: z.int().nullable().optional(),
  categoryName: z.string().nullable().optional(),
  title: z.string().meta({ example: '张三的请假申请' }),
  serialNo: z.string().nullable().optional().meta({ description: '业务编号 / 流水号（按流程定义编号规则在发起时生成）' }),
  priority: z.enum(WORKFLOW_INSTANCE_PRIORITIES).optional(),
  allowWithdraw: z.boolean().optional().meta({ description: '是否允许发起人撤回（来自流程定义高级设置）' }),
  allowResubmit: z.boolean().optional().meta({ description: '是否允许驳回后重新提交' }),
  allowComment: z.boolean().optional().meta({ description: '是否允许流程中评论' }),
  formData: z.record(z.string(), z.unknown()).nullable(),
  formSnapshot: workflowInstanceFormSnapshotSchema.nullable().optional().meta({ description: '发起时的表单结构快照' }),
  definitionSnapshot: workflowDefinitionSnapshotSchema.nullable().optional().meta({ description: '发起时的流程定义快照（详情场景返回）' }),
  status: z.enum(WORKFLOW_INSTANCE_STATUSES),
  currentNodeKey: z.string().nullable(),
  currentNodeKeys: z.array(z.string()).optional().meta({ description: '当前所有活动节点 key（并行分支可能有多个）' }),
  currentNodeName: z.string().nullable().optional(),
  currentNodeNames: z.array(z.string()).optional(),
  initiatorId: z.int(),
  initiatorName: z.string().nullable().optional(),
  initiatorAvatar: z.string().nullable().optional(),
  tenantId: z.int().nullable(),
  parentInstanceId: z.int().nullable().optional().meta({ description: '子流程：父实例 ID' }),
  parentTaskId: z.int().nullable().optional().meta({ description: '子流程：父实例中触发本子流程的任务 ID' }),
  parentTaskItemKey: z.string().nullable().optional(),
  parentTaskItemIndex: z.int().nullable().optional(),
  bizType: z.string().nullable().optional().meta({ description: '业务实体接入：业务类型（如 biz_leave）' }),
  bizId: z.string().nullable().optional().meta({ description: '业务实体接入：业务记录主键' }),
  suspendedAt: z.string().nullable().optional(),
  suspendReason: z.string().nullable().optional(),
  childInstances: z.array(workflowChildInstanceSummarySchema).nullable().optional(),
  tasks: z.array(workflowTaskSchema).nullable().optional(),
  comments: z.array(workflowCommentSchema).optional().meta({ description: '沟通评论（详情场景填充）' }),
  consults: z.array(workflowTaskConsultSchema).optional().meta({ description: '协办意见（详情场景填充）' }),
  myTaskStatus: z.enum(WORKFLOW_TASK_STATUSES).nullable().optional().meta({ description: '已办视图：我在该实例处理过的任务状态' }),
  myActionAt: z.string().nullable().optional(),
  ccTaskId: z.int().nullable().optional().meta({ description: '抄送视图：抄送给我的任务 ID' }),
  ccReadAt: z.string().nullable().optional(),
  ccDeliveredAt: z.string().nullable().optional(),
  predictedPath: z.array(workflowPredictedPathNodeSchema).nullable().optional().meta({ description: '运行中实例的预测剩余路径（详情场景填充）' }),
  ...auditFieldsSchema,
  createdAt: z.string(),
  updatedAt: z.string(),
}).meta({ id: 'WorkflowInstance' });

export type WorkflowInstance = z.infer<typeof workflowInstanceSchema>;

/** 待办列表项：实例 + 待我处理任务的 SLA / 摘要 */
export const workflowInstanceListItemSchema = workflowInstanceSchema.omit({
  formData: true,
  formSnapshot: true,
  definitionSnapshot: true,
  tasks: true,
  comments: true,
  consults: true,
}).extend({
  pendingTaskId: z.int().optional(),
  pendingTaskNodeType: z.string().nullable().optional(),
  pendingSignatureRequired: z.boolean().optional(),
  requiresIndividual: z.boolean().optional(),
  pendingDelegatedFromName: z.string().nullable().optional().meta({ description: '待办任务来自委托时的委托人姓名' }),
  pendingDelegationMode: z.enum(['full', 'suggest']).nullable().optional(),
  slaLevel: z.enum(WORKFLOW_SLA_LEVELS).optional(),
  slaDeadline: z.string().nullable().optional(),
  slaOverdueSec: z.int().nullable().optional(),
  summary: z.array(workflowInstanceSummaryItemSchema).optional().meta({ description: '列表摘要（流程「更多设置 → 列表摘要字段」配置，≤3 项）' }),
}).meta({ id: 'WorkflowInstanceListItem' });

export type WorkflowInstanceListItem = z.infer<typeof workflowInstanceListItemSchema>;

/** 待我审批列表项：pendingTaskId 必然存在 */
export const workflowPendingInstanceItemSchema = workflowInstanceListItemSchema.extend({ pendingTaskId: z.int() }).meta({ id: 'WorkflowPendingInstanceItem' });

export type WorkflowPendingInstanceItem = z.infer<typeof workflowPendingInstanceItemSchema>;

/** 全局流程实例列表（监控）：分页 + 口径内状态分布 */
export const workflowInstanceMonitorPageSchema = z.object({
  stats: z.record(z.string(), z.int()),
  list: z.array(workflowInstanceListItemSchema),
  total: z.int(),
  page: z.int(),
  pageSize: z.int(),
}).meta({ id: 'WorkflowInstanceMonitorPage' });

export type WorkflowInstanceMonitorPage = z.infer<typeof workflowInstanceMonitorPageSchema>;

/** 关联审批单可选项（relation 字段检索结果） */
export const workflowRelationOptionSchema = z.object({
  instanceId: z.int(),
  title: z.string(),
  serialNo: z.string().nullable(),
  definitionName: z.string().nullable(),
  status: z.enum(WORKFLOW_INSTANCE_STATUSES),
  createdAt: z.string(),
}).meta({ id: 'WorkflowRelationOption' });

export type WorkflowRelationOption = z.infer<typeof workflowRelationOptionSchema>;

/** 工作流协作选人（转办 / 委派 / 加签 / 协办 / 转发 / 抄送共用）的最小字段 */
export const workflowSelectableUserSchema = z.object({
  id: z.int(),
  username: z.string(),
  nickname: z.string(),
  avatar: z.string().nullable(),
  departmentName: z.string().nullable(),
}).meta({ id: 'WorkflowSelectableUser' });

export type WorkflowSelectableUser = z.infer<typeof workflowSelectableUserSchema>;

export const workflowCountSchema = z.object({ count: z.int() }).meta({ id: 'WorkflowCount' });

// ─── 数据分析 ────────────────────────────────────────────────────────────────

export const workflowAnalyticsStatusCountSchema = z.object({
  status: z.enum(WORKFLOW_INSTANCE_STATUSES),
  count: z.int(),
}).meta({ id: 'WorkflowAnalyticsStatusCount' });

export type WorkflowAnalyticsStatusCount = z.infer<typeof workflowAnalyticsStatusCountSchema>;

export const workflowAnalyticsDefinitionStatSchema = z.object({
  definitionId: z.int(),
  definitionName: z.string(),
  total: z.int(),
  running: z.int(),
  approved: z.int(),
  rejected: z.int(),
  avgDurationSec: z.number().nullable().meta({ description: '已完结实例的平均耗时（秒）' }),
}).meta({ id: 'WorkflowAnalyticsDefinitionStat' });

export type WorkflowAnalyticsDefinitionStat = z.infer<typeof workflowAnalyticsDefinitionStatSchema>;

export const workflowAnalyticsNodeBottleneckSchema = z.object({
  definitionId: z.int(),
  definitionName: z.string(),
  nodeKey: z.string(),
  nodeName: z.string(),
  avgHandleSec: z.number().nullable().meta({ description: '该节点已完成任务的平均处理时长（秒）' }),
  pendingCount: z.int(),
  doneCount: z.int(),
}).meta({ id: 'WorkflowAnalyticsNodeBottleneck' });

export type WorkflowAnalyticsNodeBottleneck = z.infer<typeof workflowAnalyticsNodeBottleneckSchema>;

export const workflowAnalyticsApproverWorkloadSchema = z.object({
  userId: z.int(),
  userName: z.string(),
  pendingCount: z.int(),
  handledCount: z.int().meta({ description: '已处理任务数（已通过 + 已驳回）' }),
  oldestPendingSec: z.number().nullable().meta({ description: '最早待办的等待时长（秒）' }),
}).meta({ id: 'WorkflowAnalyticsApproverWorkload' });

export type WorkflowAnalyticsApproverWorkload = z.infer<typeof workflowAnalyticsApproverWorkloadSchema>;

export const workflowAnalyticsTrendPointSchema = z.object({
  date: z.string(),
  created: z.int(),
  completed: z.int(),
  pending: z.int().optional().meta({ description: '当日积压（运行中实例估算）' }),
}).meta({ id: 'WorkflowAnalyticsTrendPoint' });

export type WorkflowAnalyticsTrendPoint = z.infer<typeof workflowAnalyticsTrendPointSchema>;

export const workflowAnalyticsSchema = z.object({
  statusCounts: z.array(workflowAnalyticsStatusCountSchema),
  total: z.int(),
  avgDurationSec: z.number().nullable().meta({ description: '全部已完结实例平均耗时（秒）' }),
  pendingTaskCount: z.int(),
  overdueTaskCount: z.int().meta({ description: '已超时仍挂起的任务数' }),
  dueSoonTaskCount: z.int().meta({ description: '即将超时（24h 内到期）的挂起任务数' }),
  recentCreated: z.int().meta({ description: '近 7 天发起数' }),
  rejectionRate: z.number().nullable().meta({ description: '驳回率 0-1，无已决实例时为 null' }),
  timeoutRate: z.number().nullable().meta({ description: '超时率 0-1，无待办时为 null' }),
  definitionStats: z.array(workflowAnalyticsDefinitionStatSchema),
  nodeBottlenecks: z.array(workflowAnalyticsNodeBottleneckSchema),
  approverWorkloads: z.array(workflowAnalyticsApproverWorkloadSchema),
  automation: z.object({
    jobsTotal: z.int(),
    jobsFailed: z.int(),
    jobsDead: z.int(),
    jobFailRate: z.number().nullable(),
    webhookTotal: z.int(),
    webhookSuccessRate: z.number().nullable(),
    subprocessTotal: z.int(),
    subprocessFailRate: z.number().nullable(),
  }),
  trend: z.array(workflowAnalyticsTrendPointSchema),
}).meta({ id: 'WorkflowAnalytics' });

export type WorkflowAnalytics = z.infer<typeof workflowAnalyticsSchema>;

/** 超时待办预警条目 */
export const workflowOverdueTaskSchema = z.object({
  taskId: z.int(),
  instanceId: z.int(),
  instanceTitle: z.string(),
  serialNo: z.string().nullable().optional(),
  definitionName: z.string(),
  nodeName: z.string(),
  assigneeId: z.int().nullable(),
  assigneeName: z.string().nullable(),
  timeoutAt: z.string(),
  overdueSec: z.number().meta({ description: '已超时秒数（正数=已超时；负数=距到期剩余）' }),
}).meta({ id: 'WorkflowOverdueTask' });

export type WorkflowOverdueTask = z.infer<typeof workflowOverdueTaskSchema>;

// ─── 批量结果 ────────────────────────────────────────────────────────────────

export const workflowInstanceBatchActionResultSchema = z.object({
  instanceId: z.int(),
  success: z.boolean(),
  message: z.string().optional(),
}).meta({ id: 'WorkflowInstanceBatchActionResult' });

export type WorkflowInstanceBatchActionResult = z.infer<typeof workflowInstanceBatchActionResultSchema>;

export const workflowInstanceBatchActionResponseSchema = z.object({
  succeeded: z.int(),
  failed: z.int(),
  results: z.array(workflowInstanceBatchActionResultSchema),
}).meta({ id: 'WorkflowInstanceBatchActionResponse' });

export type WorkflowInstanceBatchActionResponse = z.infer<typeof workflowInstanceBatchActionResponseSchema>;

// ─── 契约 ────────────────────────────────────────────────────────────────────

export const workflowMyInstanceListQuery = paginationQuery.extend({
  status: z.string().optional(),
  priority: z.string().optional(),
  definitionId: z.coerce.number().int().optional(),
});

export const workflowPendingMineQuery = paginationQuery.extend({
  keyword: z.string().optional(),
  definitionId: z.coerce.number().int().optional(),
});

export const workflowKeywordPageQuery = paginationQuery.extend({
  keyword: z.string().optional(),
});

export const workflowInstanceMonitorQuery = paginationQuery.extend({
  status: z.string().optional(),
  keyword: z.string().optional(),
  categoryId: z.coerce.number().int().optional(),
  definitionId: z.coerce.number().int().optional(),
  initiatorKeyword: z.string().optional(),
  priority: z.string().optional(),
});

export const workflowRelationOptionsQuery = z.object({
  definitionId: z.coerce.number().int().optional(),
  keyword: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(50).optional(),
});

export const workflowAnalyticsQuery = z.object({
  definitionId: z.coerce.number().int().optional(),
});

export const workflowOverdueQuery = paginationQuery.extend({
  definitionId: z.coerce.number().int().optional(),
});

export const workflowCcTaskParam = z.object({
  ccTaskId: z.coerce.number().int().positive().meta({ description: '抄送任务 ID', example: 1 }),
});

/**
 * 流程实例：查询 / 生命周期 / 抄送催办 / 评论 / 实例级批量操作。
 * 与 workflowTaskContract、workflowInstanceOpsContract 共用工作流资源根，操作名全局唯一。
 */
export const workflowInstanceContract = defineContract('/api/workflows', {
  selectableUsers: op.get('/selectable-users', { response: z.array(workflowSelectableUserSchema), summary: '工作流协作选人清单' }),
  list: op.get('/instances', { query: workflowMyInstanceListQuery, response: paginated(workflowInstanceSchema), summary: '我的申请列表' }),
  pendingMine: op.get('/instances/pending-mine', { query: workflowPendingMineQuery, response: paginated(workflowPendingInstanceItemSchema), summary: '待我审批列表' }),
  pendingMineCount: op.get('/instances/pending-mine/count', { response: workflowCountSchema, summary: '待我审批总数' }),
  monitor: op.get('/instances/all', { query: workflowInstanceMonitorQuery, response: workflowInstanceMonitorPageSchema, summary: '全局流程实例列表' }),
  ccMine: op.get('/instances/cc-mine', { query: workflowKeywordPageQuery, response: paginated(workflowInstanceSchema), summary: '抄送我的列表' }),
  handledMine: op.get('/instances/handled-mine', { query: workflowKeywordPageQuery, response: paginated(workflowInstanceSchema), summary: '我已办列表' }),
  ccUnreadCount: op.get('/instances/cc-mine/unread-count', { response: workflowCountSchema, summary: '抄送未读数' }),
  relationOptions: op.get('/instances/relation-options', { query: workflowRelationOptionsQuery, response: z.array(workflowRelationOptionSchema), summary: '关联审批单候选' }),
  analytics: op.get('/instances/analytics', { query: workflowAnalyticsQuery, response: workflowAnalyticsSchema, summary: '流程数据分析' }),
  overdue: op.get('/instances/overdue', { query: workflowOverdueQuery, response: paginated(workflowOverdueTaskSchema), summary: '超时待办预警列表' }),
  batchWithdraw: op.post('/instances/batch-withdraw', { body: batchWithdrawWorkflowInstanceSchema, response: workflowInstanceBatchActionResponseSchema, summary: '批量撤回' }),
  batchUrge: op.post('/instances/batch-urge', { body: batchUrgeWorkflowInstanceSchema, response: workflowInstanceBatchActionResponseSchema, summary: '批量催办' }),
  ccRead: op.post('/instances/cc/{ccTaskId}/read', { params: workflowCcTaskParam, summary: '标记抄送已读' }),
  detail: op.get('/instances/{id}', { params: idParam, response: workflowInstanceSchema, summary: '实例详情' }),
  comments: op.get('/instances/{id}/comments', { params: idParam, response: z.array(workflowCommentSchema), summary: '流程评论列表' }),
  addComment: op.post('/instances/{id}/comments', { params: idParam, body: createWorkflowCommentSchema, response: workflowCommentSchema, summary: '发表流程评论' }),
  create: op.post('/instances', { body: createWorkflowInstanceWithDraftSchema, response: workflowInstanceSchema, summary: '发起流程' }),
  updateDraft: op.put('/instances/{id}/draft', { params: idParam, body: updateWorkflowInstanceSchema, response: workflowInstanceSchema, summary: '编辑草稿' }),
  submitDraft: op.post('/instances/{id}/submit', { params: idParam, body: submitWorkflowDraftSchema, response: workflowInstanceSchema, summary: '提交草稿' }),
  resubmit: op.post('/instances/{id}/resubmit', { params: idParam, response: workflowInstanceSchema, summary: '重新提交（克隆为草稿）' }),
  withdraw: op.post('/instances/{id}/withdraw', { params: idParam, response: workflowInstanceSchema, summary: '撤回申请' }),
  forward: op.post('/instances/{id}/forward', { params: idParam, body: forwardInstanceSchema, summary: '主动抄送 / 转发' }),
  cancel: op.post('/instances/{id}/cancel', { params: idParam, response: workflowInstanceSchema, summary: '取消流程（管理员强制终止）' }),
  remove: op.delete('/instances/{id}', { params: idParam, summary: '删除流程实例' }),
  urges: op.get('/instances/{id}/urges', { params: idParam, response: z.array(workflowTaskUrgeSchema), summary: '查询实例催办历史' }),
  urge: op.post('/instances/{id}/urge', { params: idParam, body: urgeWorkflowTaskSchema, response: z.array(workflowTaskUrgeSchema), summary: '实例批量催办' }),
  addCc: op.post('/instances/{id}/cc/add', { params: idParam, body: addInstanceCcSchema, response: z.array(workflowTaskSchema), summary: '运行中动态补加抄送' }),
}, { tags: ['WorkflowInstances'] });
