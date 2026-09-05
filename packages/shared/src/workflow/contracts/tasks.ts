import * as z from 'zod';
import { dateRangeBound, idParam, paginated, paginationQuery } from '../../core/api-schemas';
import { defineContract, op } from '../../core/contract';
import { WORKFLOW_TASK_MONITOR_NODE_TYPES, WORKFLOW_TASK_STATUSES } from '../constants';
import {
  addSignWorkflowTaskSchema,
  approveWorkflowTaskSchema,
  batchApproveWorkflowTaskSchema,
  batchRejectWorkflowTaskSchema,
  createWorkflowConsultSchema,
  delegateWorkflowTaskSchema,
  reassignWorkflowTaskSchema,
  recallWorkflowTaskSchema,
  reduceSignWorkflowTaskSchema,
  rejectWorkflowTaskSchema,
  replyWorkflowConsultSchema,
  returnWorkflowTaskSchema,
  transferWorkflowTaskSchema,
  urgeWorkflowTaskSchema,
  workflowHandoverSchema,
} from '../validation';
import { workflowInstanceSchema, workflowTaskConsultSchema, workflowTaskSchema, workflowTaskUrgeSchema } from './instances';

// ─── 实体 ────────────────────────────────────────────────────────────────────

/**
 * 审批时「下一节点审批人自选」的候选分组：每个紧邻的下一 approverSelect 节点一组，
 * 候选人已按节点配置的范围（成员 / 角色 / 部门 / 用户组）在服务端解析收窄。
 */
export const workflowSelectableNextApproverGroupSchema = z.object({
  nodeKey: z.string(),
  label: z.string(),
  selectableApprovers: z.array(z.object({ id: z.int(), name: z.string() })),
}).meta({ id: 'WorkflowSelectableNextApproverGroup' });

export type WorkflowSelectableNextApproverGroup = z.infer<typeof workflowSelectableNextApproverGroupSchema>;

export const workflowBatchActionResultSchema = z.object({
  taskId: z.int(),
  success: z.boolean(),
  message: z.string().optional(),
}).meta({ id: 'WorkflowBatchActionResult' });

export type WorkflowBatchActionResult = z.infer<typeof workflowBatchActionResultSchema>;

export const workflowBatchActionResponseSchema = z.object({
  succeeded: z.int(),
  failed: z.int(),
  results: z.array(workflowBatchActionResultSchema),
}).meta({ id: 'WorkflowBatchActionResponse' });

export type WorkflowBatchActionResponse = z.infer<typeof workflowBatchActionResponseSchema>;

/** 全局任务监控行（运维视角的任务粒度读模型） */
export const workflowTaskMonitorItemSchema = z.object({
  id: z.int(),
  instanceId: z.int(),
  instanceTitle: z.string(),
  instanceStatus: z.string(),
  instanceCreatedAt: z.string(),
  priority: z.string().nullable(),
  serialNo: z.string().nullable(),
  definitionId: z.int().nullable(),
  definitionName: z.string().nullable(),
  nodeKey: z.string(),
  nodeName: z.string(),
  nodeType: z.string().nullable(),
  status: z.enum(WORKFLOW_TASK_STATUSES),
  assigneeId: z.int().nullable(),
  assigneeName: z.string().nullable(),
  assigneeAvatar: z.string().nullable(),
  initiatorName: z.string().nullable(),
  createdAt: z.string(),
  actionAt: z.string().nullable(),
  stayedSec: z.int().nullable().meta({ description: '停留 / 处理耗时（秒）：未终态=至今，终态=创建→处理；无 actionAt 的终态为 null' }),
  comment: z.string().nullable(),
  commentSource: z.enum(['user', 'system']).nullable().meta({ description: '处理意见来源：user=人工填写，system=引擎自动留痕' }),
}).meta({ id: 'WorkflowTaskMonitorItem' });

export type WorkflowTaskMonitorItem = z.infer<typeof workflowTaskMonitorItemSchema>;

/** 全局任务监控响应（stats 为口径内任务状态分布） */
export const workflowTaskMonitorResultSchema = z.object({
  stats: z.record(z.string(), z.int()),
  list: z.array(workflowTaskMonitorItemSchema),
  total: z.int(),
  page: z.int(),
  pageSize: z.int(),
}).meta({ id: 'WorkflowTaskMonitorResult' });

export type WorkflowTaskMonitorResult = z.infer<typeof workflowTaskMonitorResultSchema>;

/** 离职交接影响范围预览 */
export const workflowHandoverPreviewSchema = z.object({
  fromUserName: z.string(),
  pendingTaskCount: z.int(),
  waitingTaskCount: z.int(),
  delegationCount: z.int().meta({ description: '交接人名下启用中的审批代理规则数' }),
  affectedDefinitions: z.array(z.object({ id: z.int(), name: z.string(), nodeNames: z.array(z.string()) })).meta({ description: '已发布定义中将其写死为「指定成员」审批人的节点清单（仅提示）' }),
}).meta({ id: 'WorkflowHandoverPreview' });

export type WorkflowHandoverPreview = z.infer<typeof workflowHandoverPreviewSchema>;

/** 离职交接执行结果（逐条改派互不阻断） */
export const workflowHandoverResultSchema = z.object({
  taskTotal: z.int(),
  succeeded: z.int(),
  failed: z.int(),
  delegationsDisabled: z.int(),
  results: z.array(z.object({
    taskId: z.int(),
    title: z.string(),
    nodeName: z.string(),
    success: z.boolean(),
    message: z.string().optional(),
  })),
}).meta({ id: 'WorkflowHandoverResult' });

export type WorkflowHandoverResult = z.infer<typeof workflowHandoverResultSchema>;

// ─── 契约 ────────────────────────────────────────────────────────────────────

export const workflowTaskIdParam = z.object({
  taskId: z.coerce.number().meta({ description: '任务 ID', example: 1 }),
});

export const workflowTaskMonitorQuery = paginationQuery.extend({
  status: z.enum(WORKFLOW_TASK_STATUSES).optional(),
  nodeType: z.enum(WORKFLOW_TASK_MONITOR_NODE_TYPES).optional(),
  keyword: z.string().optional(),
  assigneeKeyword: z.string().optional(),
  definitionId: z.coerce.number().int().optional(),
  instanceId: z.coerce.number().int().optional(),
  startTime: dateRangeBound('任务创建时间起'),
  endTime: dateRangeBound('任务创建时间止'),
  stuckMinutes: z.coerce.number().int().positive().optional().meta({ description: '仅看停留超过 N 分钟的未终态任务' }),
});

export const workflowMyConsultsQuery = paginationQuery.extend({
  status: z.string().optional(),
});

export const workflowHandoverPreviewQuery = z.object({
  fromUserId: z.coerce.number().int().positive().meta({ description: '交接人用户 ID', example: 1 }),
});

/** 审批任务动作 / 流转 / 协办 / 批量审批 / 任务监控 / 离职交接（与实例契约共用 /api/workflows 根路径） */
export const workflowTaskContract = defineContract('/api/workflows', {
  taskMonitor: op.get('/tasks/monitor', { query: workflowTaskMonitorQuery, response: workflowTaskMonitorResultSchema, summary: '全局任务监控列表' }),
  myConsults: op.get('/instances/consults/mine', { query: workflowMyConsultsQuery, response: paginated(workflowTaskConsultSchema), summary: '我的协办列表' }),
  handoverPreview: op.get('/tasks/handover-preview', { query: workflowHandoverPreviewQuery, response: workflowHandoverPreviewSchema, summary: '离职交接影响范围预览' }),
  handover: op.post('/tasks/handover', { body: workflowHandoverSchema, response: workflowHandoverResultSchema, summary: '离职交接（批量移交待办）' }),
  batchApprove: op.post('/tasks/batch-approve', { body: batchApproveWorkflowTaskSchema, response: workflowBatchActionResponseSchema, summary: '批量审批通过' }),
  batchReject: op.post('/tasks/batch-reject', { body: batchRejectWorkflowTaskSchema, response: workflowBatchActionResponseSchema, summary: '批量审批驳回' }),
  approve: op.post('/tasks/{taskId}/approve', { params: workflowTaskIdParam, body: approveWorkflowTaskSchema, response: workflowInstanceSchema, summary: '审批通过' }),
  selectableNextApprovers: op.get('/tasks/{taskId}/selectable-next-approvers', { params: workflowTaskIdParam, response: z.array(workflowSelectableNextApproverGroupSchema), summary: '下一节点自选审批人候选' }),
  reject: op.post('/tasks/{taskId}/reject', { params: workflowTaskIdParam, body: rejectWorkflowTaskSchema, response: workflowInstanceSchema, summary: '审批驳回' }),
  transfer: op.post('/tasks/{taskId}/transfer', { params: workflowTaskIdParam, body: transferWorkflowTaskSchema, response: workflowTaskSchema, summary: '转办' }),
  reassign: op.post('/tasks/{taskId}/reassign', { params: workflowTaskIdParam, body: reassignWorkflowTaskSchema, response: workflowTaskSchema, summary: '管理员改派处理人' }),
  recall: op.post('/tasks/{taskId}/recall', { params: workflowTaskIdParam, body: recallWorkflowTaskSchema, response: workflowInstanceSchema, summary: '撤回已办' }),
  consult: op.post('/tasks/{taskId}/consult', { params: workflowTaskIdParam, body: createWorkflowConsultSchema, response: z.array(workflowTaskConsultSchema), summary: '发起协办' }),
  replyConsult: op.post('/instances/consults/{id}/reply', { params: idParam, body: replyWorkflowConsultSchema, response: workflowTaskConsultSchema, summary: '回复协办意见' }),
  delegate: op.post('/tasks/{taskId}/delegate', { params: workflowTaskIdParam, body: delegateWorkflowTaskSchema, response: workflowTaskSchema, summary: '委派' }),
  addSign: op.post('/tasks/{taskId}/add-sign', { params: workflowTaskIdParam, body: addSignWorkflowTaskSchema, summary: '加签' }),
  reduceSign: op.post('/tasks/{taskId}/reduce-sign', { params: workflowTaskIdParam, body: reduceSignWorkflowTaskSchema, summary: '减签' }),
  returnTask: op.post('/tasks/{taskId}/return', { params: workflowTaskIdParam, body: returnWorkflowTaskSchema, response: workflowInstanceSchema, summary: '退回' }),
  urgeTask: op.post('/tasks/{taskId}/urge', { params: workflowTaskIdParam, body: urgeWorkflowTaskSchema, response: workflowTaskUrgeSchema, summary: '催办' }),
  taskUrges: op.get('/tasks/{taskId}/urges', { params: workflowTaskIdParam, response: z.array(workflowTaskUrgeSchema), summary: '查询任务催办历史' }),
}, { tags: ['WorkflowInstances'] });
