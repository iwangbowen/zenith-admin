import { signatureSnapshotSchema } from '../../core/signatures';
import { workflowSignaturePolicySchema } from '../validation';
import * as z from 'zod';
import { auditFieldsSchema, idParam, idQuery, keywordQuery, paginated, paginationQuery, queryEnum } from '../../core/api-schemas';
import { defineContract, op } from '../../core/contract';
import { WORKFLOW_INSTANCE_PRIORITIES, WORKFLOW_INSTANCE_PRIORITY_OPTIONS, WORKFLOW_INSTANCE_STATUSES, WORKFLOW_INSTANCE_STATUS_OPTIONS, WORKFLOW_SLA_LEVELS, WORKFLOW_TASK_CONSULT_STATUSES, WORKFLOW_TASK_STATUSES, WORKFLOW_INSTANCE_STATUS_FILTERS, WORKFLOW_INSTANCE_PRINT_SOURCES } from '../constants';
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
import { workflowDefinitionOptionSchema } from './definitions';

// ─── 任务 ────────────────────────────────────────────────────────────────────

export const workflowSignatureEvidenceSchema = signatureSnapshotSchema.omit({ dataUrl: true }).meta({ id: 'WorkflowSignatureEvidence' });
export type WorkflowSignatureEvidence = z.infer<typeof workflowSignatureEvidenceSchema>;

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
  signature: z.string().nullable().optional().meta({ description: '服务端确认的当次签名 PNG data URL' }),
  signatureEvidence: workflowSignatureEvidenceSchema.nullable().optional(),
  attachments: z.array(workflowTaskAttachmentRefSchema).optional(),
  signaturePolicy: workflowSignaturePolicySchema.optional().meta({ description: '所属节点的签署策略' }),
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

/** 审批单归档件（终态时按流程设置自动生成的 PDF 存证） */
export const workflowInstanceArchiveSchema = z.object({
  fileId: z.string(),
  sha256: z.string(),
  templateId: z.int().nullable().meta({ description: '归档时使用的打印模板；null = 自动版式' }),
  archivedAt: z.string(),
}).meta({ id: 'WorkflowInstanceArchive' });

export type WorkflowInstanceArchive = z.infer<typeof workflowInstanceArchiveSchema>;

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
  archive: workflowInstanceArchiveSchema.nullable().optional().meta({ description: '审批单归档件（详情场景填充；未归档为 null）' }),
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
  pendingSignaturePolicy: workflowSignaturePolicySchema.optional(),
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

/**
 * 发起工作台概览：当前用户各项待处理计数。每项按其对应列表的权限门控——
 * 缺该权限时返回 null（前端不渲染该卡片），口径与对应列表 / 角标接口同源。
 */
const workbenchCount = (description: string) => z.int().nullable().meta({ description });
export const workflowWorkbenchSummarySchema = z.object({
  pending: workbenchCount('待我审批（同 pending-mine/count 口径；需 workflow:task:handle）'),
  pendingOverdue: workbenchCount('待我审批中已超时的任务数（需 workflow:task:handle）'),
  consultsPending: workbenchCount('待我协办（需 workflow:task:handle）'),
  ccUnread: workbenchCount('抄送未读（需 workflow:instance:list）'),
  myReturned: workbenchCount('我发起且被退回待修改的申请（需 workflow:instance:create）'),
  myDrafts: workbenchCount('我的草稿（需 workflow:instance:create）'),
  myRunning: workbenchCount('我发起且审批中的申请（需 workflow:instance:list）'),
}).meta({ id: 'WorkflowWorkbenchSummary' });

export type WorkflowWorkbenchSummary = z.infer<typeof workflowWorkbenchSummarySchema>;

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
  status: queryEnum(WORKFLOW_INSTANCE_STATUS_FILTERS, { description: '实例状态', options: WORKFLOW_INSTANCE_STATUS_OPTIONS }),
  priority: queryEnum(WORKFLOW_INSTANCE_PRIORITIES, { description: '优先级', options: WORKFLOW_INSTANCE_PRIORITY_OPTIONS }),
  definitionId: idQuery(),
});

export const workflowPendingMineQuery = paginationQuery.extend({
  keyword: keywordQuery(),
  definitionId: idQuery(),
});

export const workflowKeywordPageQuery = paginationQuery.extend({
  keyword: keywordQuery(),
});

export const workflowInstanceMonitorQuery = paginationQuery.extend({
  status: queryEnum(WORKFLOW_INSTANCE_STATUS_FILTERS, { description: '实例状态', options: WORKFLOW_INSTANCE_STATUS_OPTIONS }),
  keyword: keywordQuery(),
  categoryId: idQuery(),
  definitionId: idQuery(),
  initiatorKeyword: z.string().optional(),
  priority: queryEnum(WORKFLOW_INSTANCE_PRIORITIES, { description: '优先级', options: WORKFLOW_INSTANCE_PRIORITY_OPTIONS }),
});

export const workflowRelationOptionsQuery = z.object({
  definitionId: idQuery(),
  keyword: keywordQuery(),
  limit: z.coerce.number().int().min(1).max(50).optional(),
});

export const workflowAnalyticsQuery = z.object({
  definitionId: idQuery(),
});

export const workflowOverdueQuery = paginationQuery.extend({
  definitionId: idQuery(),
});

export const workflowCcTaskParam = z.object({
  ccTaskId: z.coerce.number().int().positive().meta({ description: '抄送任务 ID', example: 1 }),
});

/** 审批单打印：可临时指定模板（设计器预览 / 更正版式），缺省用流程绑定模板，再缺省按表单快照自动生成 */
export const workflowInstancePrintQuery = z.object({
  templateId: idQuery('临时指定的打印模板 ID（需为 workflow_instance 实体模板）'),
  source: queryEnum(WORKFLOW_INSTANCE_PRINT_SOURCES, 'auto（默认）= 有归档件则返回归档件否则实时渲染；archive = 只要归档件；live = 强制按当前模板重新渲染'),
});

/** 批量导出审批单 PDF（导出中心 workflow.approval-sheets 的查询载荷） */
export const workflowBatchPrintQuerySchema = z.object({
  instanceIds: z.array(z.int().positive()).min(1, '请选择要导出的审批单').max(200, '单次最多导出 200 份审批单'),
});

export type WorkflowBatchPrintQueryInput = z.infer<typeof workflowBatchPrintQuerySchema>;

/** 审批单验真页（公开，凭打印件上的二维码令牌） */
export const workflowPrintVerifyParam = z.object({
  token: z.string().min(1).max(512).meta({ description: '打印件二维码中的签名令牌' }),
});

/**
 * 流程实例：查询 / 生命周期 / 抄送催办 / 评论 / 实例级批量操作。
 * 与 workflowTaskContract、workflowInstanceOpsContract 共用工作流资源根，操作名全局唯一。
 */
export const workflowInstanceContract = defineContract('/api/workflows', {
  selectableUsers: op.get('/selectable-users', { access: { permission: ['workflow:instance:create', 'workflow:task:handle', 'workflow:instance:list'] }, response: z.array(workflowSelectableUserSchema), summary: '工作流协作选人清单' }),
  list: op.get('/instances', { access: { permission: 'workflow:instance:list' }, query: workflowMyInstanceListQuery, response: paginated(workflowInstanceSchema), summary: '我的申请列表' }),
  pendingMine: op.get('/instances/pending-mine', { access: { permission: 'workflow:task:handle' }, query: workflowPendingMineQuery, response: paginated(workflowPendingInstanceItemSchema), summary: '待我审批列表' }),
  pendingMineCount: op.get('/instances/pending-mine/count', { access: { permission: 'workflow:task:handle' }, response: workflowCountSchema, summary: '待我审批总数' }),
  pendingDefinitionOptions: op.get('/instances/pending-mine/definitions', { access: { permission: 'workflow:task:handle' }, response: z.array(workflowDefinitionOptionSchema), summary: '待我审批的流程筛选选项' }),
  monitor: op.get('/instances/all', { access: { permission: 'workflow:instance:monitor' }, query: workflowInstanceMonitorQuery, response: workflowInstanceMonitorPageSchema, summary: '全局流程实例列表' }),
  ccMine: op.get('/instances/cc-mine', { access: { permission: 'workflow:instance:list' }, query: workflowKeywordPageQuery, response: paginated(workflowInstanceSchema), summary: '抄送我的列表' }),
  handledMine: op.get('/instances/handled-mine', { access: { permission: 'workflow:task:handle' }, query: workflowKeywordPageQuery, response: paginated(workflowInstanceSchema), summary: '我已办列表' }),
  ccUnreadCount: op.get('/instances/cc-mine/unread-count', { access: { permission: 'workflow:instance:list' }, response: workflowCountSchema, summary: '抄送未读数' }),
  workbenchSummary: op.get('/instances/workbench-summary', { access: { permission: ['workflow:task:handle', 'workflow:instance:list', 'workflow:instance:create'] }, response: workflowWorkbenchSummarySchema, summary: '发起工作台概览：待我审批 / 协办 / 抄送未读 / 退回 / 草稿 / 审批中计数' }),
  relationOptions: op.get('/instances/relation-options', { access: { permission: 'workflow:instance:list' }, query: workflowRelationOptionsQuery, response: z.array(workflowRelationOptionSchema), summary: '关联审批单候选' }),
  analytics: op.get('/instances/analytics', { access: { permission: 'workflow:instance:monitor' }, query: workflowAnalyticsQuery, response: workflowAnalyticsSchema, summary: '流程数据分析' }),
  overdue: op.get('/instances/overdue', { access: { permission: 'workflow:instance:monitor' }, query: workflowOverdueQuery, response: paginated(workflowOverdueTaskSchema), summary: '超时待办预警列表' }),
  batchWithdraw: op.post('/instances/batch-withdraw', { access: { permission: 'workflow:instance:create' }, audit: { description: '批量撤回流程', module: '工作流管理' }, body: batchWithdrawWorkflowInstanceSchema, response: workflowInstanceBatchActionResponseSchema, summary: '批量撤回' }),
  batchUrge: op.post('/instances/batch-urge', { access: { permission: 'workflow:instance:list' }, audit: { description: '批量催办流程', module: '工作流管理' }, body: batchUrgeWorkflowInstanceSchema, response: workflowInstanceBatchActionResponseSchema, summary: '批量催办' }),
  ccRead: op.post('/instances/cc/{ccTaskId}/read', { access: { permission: 'workflow:instance:list' }, params: workflowCcTaskParam, summary: '标记抄送已读' }),
  detail: op.get('/instances/{id}', { access: { permission: ['workflow:instance:list', 'workflow:task:handle', 'workflow:instance:monitor'] }, params: idParam, response: workflowInstanceSchema, summary: '实例详情' }),
  print: op.get('/instances/{id}/print', { access: { permission: ['workflow:instance:list', 'workflow:task:handle', 'workflow:instance:monitor', 'workflow:instance:print'] }, audit: { description: '打印审批单', module: '工作流', recordBody: false, recordResponseBody: false }, params: idParam, query: workflowInstancePrintQuery, kind: 'file', summary: '审批单 PDF（预览 / 打印 / 下载同一份文件；有归档件时默认返回归档件）' }),
  printVerify: op.get('/print-verify/{token}', { params: workflowPrintVerifyParam, kind: 'file', public: true, summary: '审批单验真页（公开 HTML，凭打印件二维码令牌）' }),
  comments: op.get('/instances/{id}/comments', { access: { permission: 'workflow:instance:list' }, params: idParam, response: z.array(workflowCommentSchema), summary: '流程评论列表' }),
  addComment: op.post('/instances/{id}/comments', { access: { permission: 'workflow:instance:list' }, audit: { description: '发表流程评论', module: '工作流管理' }, params: idParam, body: createWorkflowCommentSchema, response: workflowCommentSchema, summary: '发表流程评论' }),
  create: op.post('/instances', { access: { permission: 'workflow:instance:create' }, audit: { description: '发起流程申请', module: '工作流管理', recordBody: false, recordResponseBody: false }, body: createWorkflowInstanceWithDraftSchema, response: workflowInstanceSchema, summary: '发起流程' }),
  updateDraft: op.put('/instances/{id}/draft', { access: { permission: 'workflow:instance:create' }, audit: { description: '编辑流程草稿', module: '工作流管理', recordBody: false, recordResponseBody: false }, params: idParam, body: updateWorkflowInstanceSchema, response: workflowInstanceSchema, summary: '编辑草稿' }),
  submitDraft: op.post('/instances/{id}/submit', { access: { permission: 'workflow:instance:create' }, audit: { description: '提交流程草稿', module: '工作流管理', recordBody: false, recordResponseBody: false }, params: idParam, body: submitWorkflowDraftSchema, response: workflowInstanceSchema, summary: '提交草稿' }),
  resubmit: op.post('/instances/{id}/resubmit', { access: { permission: 'workflow:instance:create' }, audit: { description: '重新提交流程', module: '工作流管理', recordResponseBody: false }, params: idParam, response: workflowInstanceSchema, summary: '重新提交（克隆为草稿）' }),
  withdraw: op.post('/instances/{id}/withdraw', { access: { permission: 'workflow:instance:create' }, audit: { description: '撤回流程申请', module: '工作流管理', recordResponseBody: false }, params: idParam, response: workflowInstanceSchema, summary: '撤回申请' }),
  forward: op.post('/instances/{id}/forward', { access: { permission: 'workflow:instance:list' }, audit: { description: '转发抄送', module: '工作流管理' }, params: idParam, body: forwardInstanceSchema, summary: '主动抄送 / 转发' }),
  cancel: op.post('/instances/{id}/cancel', { access: { permission: 'workflow:instance:cancel' }, audit: { description: '取消流程', module: '工作流管理', recordResponseBody: false }, params: idParam, response: workflowInstanceSchema, summary: '取消流程（管理员强制终止）' }),
  remove: op.delete('/instances/{id}', { access: { permission: 'workflow:instance:delete' }, audit: { description: '删除流程实例', module: '工作流管理' }, params: idParam, summary: '删除流程实例' }),
  urges: op.get('/instances/{id}/urges', { access: { permission: 'workflow:instance:list' }, params: idParam, response: z.array(workflowTaskUrgeSchema), summary: '查询实例催办历史' }),
  urge: op.post('/instances/{id}/urge', { access: { permission: 'workflow:instance:create' }, audit: { description: '实例批量催办', module: '工作流管理' }, params: idParam, body: urgeWorkflowTaskSchema, response: z.array(workflowTaskUrgeSchema), summary: '实例批量催办' }),
  addCc: op.post('/instances/{id}/cc/add', { access: { permission: 'workflow:instance:create' }, audit: { description: '动态补加抄送', module: '工作流管理', recordResponseBody: false }, params: idParam, body: addInstanceCcSchema, response: z.array(workflowTaskSchema), summary: '运行中动态补加抄送' }),
}, { tags: ['WorkflowInstances'] });
