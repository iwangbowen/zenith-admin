import * as z from 'zod';
import { idParam, paginated, paginationQuery } from '../../core/api-schemas';
import { defineContract, op } from '../../core/contract';
import {
  WORKFLOW_COMPENSATION_ACTION_STATUSES,
  WORKFLOW_ENGINE_EXPLANATION_STATES,
  WORKFLOW_JOB_EXECUTION_STATUSES,
  WORKFLOW_JOB_TYPES,
  WORKFLOW_RUNTIME_ISSUE_SEVERITIES,
} from '../constants';
import {
  addWorkflowCompensationNoteSchema,
  batchSkipStuckTokensSchema,
  jumpWorkflowInstanceSchema,
  resolveWorkflowCompensationSchema,
  suspendWorkflowInstanceSchema,
  workflowTokenOpSchema,
} from '../validation';
import { workflowInstanceSchema, workflowTaskSchema } from './instances';
import { workflowTriggerExecutionSchema } from './trigger-executions';

// ─── 运行时诊断 ──────────────────────────────────────────────────────────────

export const workflowRuntimeIssueSchema = z.object({
  severity: z.enum(WORKFLOW_RUNTIME_ISSUE_SEVERITIES),
  title: z.string(),
  description: z.string(),
  source: z.enum(['instance', 'task', 'trigger', 'outbox', 'token']),
  taskId: z.int().nullable().optional(),
  nodeKey: z.string().nullable().optional(),
}).meta({ id: 'WorkflowRuntimeIssue' });

export type WorkflowRuntimeIssue = z.infer<typeof workflowRuntimeIssueSchema>;

export const workflowRuntimeOutboxEventSchema = z.object({
  id: z.int(),
  eventId: z.string(),
  eventType: z.string(),
  taskId: z.int().nullable(),
  status: z.string(),
  attempts: z.int(),
  errorMessage: z.string().nullable(),
  nextRetryAt: z.string().nullable(),
  processedAt: z.string().nullable(),
  createdAt: z.string(),
}).meta({ id: 'WorkflowRuntimeOutboxEvent' });

export type WorkflowRuntimeOutboxEvent = z.infer<typeof workflowRuntimeOutboxEventSchema>;

/** 显式执行 Token（活动路径 / 网关汇聚的权威单元，用于运行态可观测 / 重放） */
export const workflowExecutionTokenSchema = z.object({
  id: z.int(),
  nodeKey: z.string(),
  nodeName: z.string().nullable(),
  status: z.enum(['active', 'consumed', 'dead']),
  parkedAtJoin: z.boolean().meta({ description: '是否 parked 在网关 join 节点（等待兄弟分支）' }),
  branchPath: z.array(z.object({ id: z.string(), index: z.int(), total: z.int() })).meta({ description: '分支栈：每帧 { fork 组 id, 组内序号, 组内分支数 }，空数组=主路径' }),
  depth: z.int(),
  parentTokenId: z.int().nullable().meta({ description: 'fork 处被消费的前驱 token（血缘）' }),
  scopeKey: z.string().nullable().meta({ description: '子流程 / 多实例项作用域，主流程为 null' }),
  createdAt: z.string(),
  consumedAt: z.string().nullable(),
}).meta({ id: 'WorkflowExecutionToken' });

export type WorkflowExecutionToken = z.infer<typeof workflowExecutionTokenSchema>;

/** 实例执行 Token 视图 */
export const workflowExecutionTokenViewSchema = z.object({
  instanceId: z.int(),
  activeCount: z.int().meta({ description: '活动 frontier token 数（不含 parked join）' }),
  parkedCount: z.int(),
  consumedCount: z.int(),
  deadCount: z.int(),
  tokens: z.array(workflowExecutionTokenSchema),
  generatedAt: z.string(),
}).meta({ id: 'WorkflowExecutionTokenView' });

export type WorkflowExecutionTokenView = z.infer<typeof workflowExecutionTokenViewSchema>;

export const workflowRuntimeDiagnosticsSchema = z.object({
  instance: workflowInstanceSchema,
  tasks: z.array(workflowTaskSchema),
  activeTasks: z.array(workflowTaskSchema),
  triggerExecutions: z.array(workflowTriggerExecutionSchema),
  outboxEvents: z.array(workflowRuntimeOutboxEventSchema),
  issues: z.array(workflowRuntimeIssueSchema),
  tokens: z.array(workflowExecutionTokenSchema).meta({ description: '显式执行 Token 列表（活动路径 + 血缘，按 id 升序）' }),
  snapshot: z.object({
    formData: z.record(z.string(), z.unknown()).nullable(),
    formSnapshot: z.unknown(),
    definitionSnapshot: z.unknown(),
  }),
  generatedAt: z.string(),
}).meta({ id: 'WorkflowRuntimeDiagnostics' });

export type WorkflowRuntimeDiagnostics = z.infer<typeof workflowRuntimeDiagnosticsSchema>;

// ─── 运行轨迹 / 引擎解释 ─────────────────────────────────────────────────────

/** 引擎解释：当前实例「为什么停在这里 / 在等谁 / 等什么」的单条阻塞项 */
export const workflowEngineExplanationBlockerSchema = z.object({
  kind: z.enum(['task', 'job']),
  severity: z.enum(WORKFLOW_RUNTIME_ISSUE_SEVERITIES),
  title: z.string(),
  detail: z.string(),
  taskId: z.int().nullable(),
  jobId: z.int().nullable(),
  jobType: z.enum(WORKFLOW_JOB_TYPES).nullable(),
  nodeName: z.string().nullable(),
  waitingMinutes: z.int().nullable().meta({ description: '任务已等待分钟数（task 类阻塞）' }),
  nextRetryAt: z.string().nullable().meta({ description: '下次重试 / 计划执行时间（job 类阻塞）' }),
}).meta({ id: 'WorkflowEngineExplanationBlocker' });

export type WorkflowEngineExplanationBlocker = z.infer<typeof workflowEngineExplanationBlockerSchema>;

export const workflowEngineExplanationSchema = z.object({
  state: z.enum(WORKFLOW_ENGINE_EXPLANATION_STATES),
  headline: z.string().meta({ description: '一句话总结' }),
  blockers: z.array(workflowEngineExplanationBlockerSchema),
  lastError: z.string().nullable(),
  nextWakeAt: z.string().nullable(),
  pendingJobCount: z.int(),
  failedJobCount: z.int(),
}).meta({ id: 'WorkflowEngineExplanation' });

export type WorkflowEngineExplanation = z.infer<typeof workflowEngineExplanationSchema>;

export const workflowEngineTraceExecutionSchema = z.object({
  attempt: z.int(),
  status: z.enum(WORKFLOW_JOB_EXECUTION_STATUSES),
  requestUrl: z.string().nullable(),
  requestMethod: z.string().nullable(),
  responseStatus: z.int().nullable(),
  durationMs: z.int().nullable(),
  errorMessage: z.string().nullable(),
  finishedAt: z.string().nullable(),
}).meta({ id: 'WorkflowEngineTraceExecution' });

export type WorkflowEngineTraceExecution = z.infer<typeof workflowEngineTraceExecutionSchema>;

/** 运行轨迹：合并任务流转 + 异步作业的时间线条目 */
export const workflowEngineTraceEntrySchema = z.object({
  key: z.string(),
  kind: z.enum(['task', 'job', 'token']),
  at: z.string().meta({ description: '主时间戳（YYYY-MM-DD HH:mm:ss）' }),
  traceId: z.string().nullable(),
  title: z.string(),
  status: z.string(),
  nodeName: z.string().nullable(),
  assigneeName: z.string().nullable(),
  comment: z.string().nullable(),
  jobId: z.int().nullable(),
  jobType: z.enum(WORKFLOW_JOB_TYPES).nullable(),
  attempts: z.int().nullable(),
  maxAttempts: z.int().nullable(),
  runAt: z.string().nullable(),
  nextRetryAt: z.string().nullable(),
  lastError: z.string().nullable(),
  executions: z.array(workflowEngineTraceExecutionSchema),
}).meta({ id: 'WorkflowEngineTraceEntry' });

export type WorkflowEngineTraceEntry = z.infer<typeof workflowEngineTraceEntrySchema>;

export const workflowInstanceTraceSchema = z.object({
  instanceId: z.int(),
  title: z.string(),
  explanation: workflowEngineExplanationSchema,
  trace: z.array(workflowEngineTraceEntrySchema),
  generatedAt: z.string(),
}).meta({ id: 'WorkflowInstanceTrace' });

export type WorkflowInstanceTrace = z.infer<typeof workflowInstanceTraceSchema>;

/** 实例诊断包：诊断 + 轨迹 + 执行 Token，供运营离线分析 / 工单留档 */
export const workflowDiagnosticBundleSchema = z.object({
  instanceId: z.int(),
  generatedAt: z.string(),
  diagnostics: workflowRuntimeDiagnosticsSchema,
  trace: workflowInstanceTraceSchema,
  tokens: workflowExecutionTokenViewSchema,
}).meta({ id: 'WorkflowDiagnosticBundle' });

export type WorkflowDiagnosticBundle = z.infer<typeof workflowDiagnosticBundleSchema>;

/** 批量恢复结果汇总（批量推进卡死实例等运营恢复动作） */
export const workflowRecoveryBatchResultSchema = z.object({
  total: z.int().meta({ description: '命中的候选数量' }),
  success: z.int(),
  failed: z.int().meta({ description: '失败数量（按候选逐个隔离，失败不影响其它）' }),
}).meta({ id: 'WorkflowRecoveryBatchResult' });

export type WorkflowRecoveryBatchResult = z.infer<typeof workflowRecoveryBatchResultSchema>;

// ─── 实例迁移 ────────────────────────────────────────────────────────────────

export const workflowMigrationNodeSchema = z.object({
  nodeKey: z.string(),
  label: z.string(),
  inNew: z.boolean(),
  activeTasks: z.int(),
  activeTokens: z.int(),
}).meta({ id: 'WorkflowMigrationNode' });

export type WorkflowMigrationNode = z.infer<typeof workflowMigrationNodeSchema>;

export const workflowMigrationPreflightSchema = z.object({
  instanceId: z.int(),
  fromVersion: z.int(),
  toVersion: z.int(),
  migratable: z.boolean(),
  blocked: z.array(z.string()).meta({ description: '新版本中缺失的活动节点 key' }),
  nodes: z.array(workflowMigrationNodeSchema),
}).meta({ id: 'WorkflowMigrationPreflight' });

export type WorkflowMigrationPreflight = z.infer<typeof workflowMigrationPreflightSchema>;

export const workflowInstanceMigrationSchema = z.object({
  id: z.int(),
  instanceId: z.int(),
  fromVersion: z.int(),
  toVersion: z.int(),
  status: z.string(),
  note: z.string().nullable(),
  createdAt: z.string(),
}).meta({ id: 'WorkflowInstanceMigration' });

export type WorkflowInstanceMigration = z.infer<typeof workflowInstanceMigrationSchema>;

// ─── 补偿 / 人工修复工单 ─────────────────────────────────────────────────────

export const workflowCompensationSchema = z.object({
  id: z.int(),
  instanceId: z.int(),
  nodeKey: z.string(),
  nodeName: z.string().nullable(),
  errorMessage: z.string().nullable(),
  action: z.string(),
  status: z.enum(['pending', 'resolved', 'terminated']),
  compensationActionStatus: z.enum(WORKFLOW_COMPENSATION_ACTION_STATUSES).meta({ description: '自动反向 / 兜底动作执行状态' }),
  failedNodeKey: z.string().nullable().meta({ description: '失败节点 key（用于恢复续跑重注 token）' }),
  resolution: z.string().nullable(),
  resolvedBy: z.int().nullable(),
  resolvedAt: z.string().nullable(),
  createdAt: z.string(),
}).meta({ id: 'WorkflowCompensation' });

export type WorkflowCompensation = z.infer<typeof workflowCompensationSchema>;

export const workflowCompensationLogSchema = z.object({
  id: z.int(),
  compensationId: z.int(),
  action: z.enum(['note', 'attachment', 'auto', 'retry', 'resume', 'resolve', 'terminate']),
  note: z.string().nullable(),
  attachments: z.array(z.object({ id: z.int(), name: z.string(), url: z.string() })).nullable(),
  operatorId: z.int().nullable(),
  operatorName: z.string().nullable(),
  createdAt: z.string(),
}).meta({ id: 'WorkflowCompensationLog' });

export type WorkflowCompensationLog = z.infer<typeof workflowCompensationLogSchema>;

export const workflowCompensationDetailSchema = workflowCompensationSchema.extend({
  logs: z.array(workflowCompensationLogSchema),
}).meta({ id: 'WorkflowCompensationDetail' });

export type WorkflowCompensationDetail = z.infer<typeof workflowCompensationDetailSchema>;

// ─── 契约 ────────────────────────────────────────────────────────────────────

export const workflowCompensationListQuery = paginationQuery.extend({
  status: z.string().optional(),
  instanceId: z.coerce.number().int().optional(),
});

export const workflowMigrateBatchParam = z.object({
  definitionId: z.coerce.number().int().meta({ description: '流程定义 ID', example: 1 }),
});

/** 实例运维：诊断 / 轨迹 / Token / 管理员强制操作 / 迁移 / 补偿工单（与实例契约共用工作流资源根） */
export const workflowInstanceOpsContract = defineContract('/api/workflows', {
  diagnostics: op.get('/instances/{id}/diagnostics', { params: idParam, response: workflowRuntimeDiagnosticsSchema, summary: '实例运行时技术诊断' }),
  trace: op.get('/instances/{id}/trace', { params: idParam, response: workflowInstanceTraceSchema, summary: '实例运行轨迹与引擎解释' }),
  tokens: op.get('/instances/{id}/tokens', { params: idParam, response: workflowExecutionTokenViewSchema, summary: '实例显式执行 Token（执行树/活动路径）' }),
  diagnosticBundle: op.get('/instances/{id}/diagnostic-bundle', { params: idParam, response: workflowDiagnosticBundleSchema, summary: '导出实例诊断包' }),
  batchSkipStuck: op.post('/instances/batch-skip-stuck', { body: batchSkipStuckTokensSchema, response: workflowRecoveryBatchResultSchema, summary: '批量推进卡在指定节点的实例' }),
  skipToken: op.post('/instances/tokens/{id}/skip', { params: idParam, body: workflowTokenOpSchema, response: workflowInstanceSchema, summary: '跳过卡死的执行 Token' }),
  replayToken: op.post('/instances/tokens/{id}/replay', { params: idParam, body: workflowTokenOpSchema, response: workflowInstanceSchema, summary: '从执行 Token 节点重放流程' }),
  jump: op.post('/instances/{id}/jump', { params: idParam, body: jumpWorkflowInstanceSchema, response: workflowInstanceSchema, summary: '管理员强制跳转节点' }),
  suspend: op.post('/instances/{id}/suspend', { params: idParam, body: suspendWorkflowInstanceSchema, response: workflowInstanceSchema, summary: '挂起流程实例' }),
  resume: op.post('/instances/{id}/resume', { params: idParam, response: workflowInstanceSchema, summary: '恢复挂起的流程实例' }),
  migratePreflight: op.get('/{id}/migrate/preflight', { params: idParam, response: workflowMigrationPreflightSchema, summary: '实例迁移预检' }),
  migrate: op.post('/{id}/migrate', { params: idParam, summary: '迁移实例到最新版本' }),
  migrations: op.get('/{id}/migrations', { params: idParam, response: z.array(workflowInstanceMigrationSchema), summary: '实例迁移记录' }),
  migrateBatch: op.post('/migrate/batch/{definitionId}', { params: workflowMigrateBatchParam, summary: '批量迁移定义下运行实例' }),
  compensations: op.get('/compensation/list', { query: workflowCompensationListQuery, response: paginated(workflowCompensationSchema), summary: '补偿/修复工单列表' }),
  resolveCompensation: op.post('/compensation/{id}/resolve', { params: idParam, body: resolveWorkflowCompensationSchema, response: workflowCompensationSchema, summary: '处理补偿工单' }),
  addCompensationNote: op.post('/compensation/{id}/note', { params: idParam, body: addWorkflowCompensationNoteSchema, response: workflowCompensationDetailSchema, summary: '补偿工单：添加处理备注/附件' }),
  retryCompensation: op.post('/compensation/{id}/retry', { params: idParam, response: workflowCompensationDetailSchema, summary: '补偿工单：重试自动反向动作' }),
  resumeCompensation: op.post('/compensation/{id}/resume', { params: idParam, response: workflowCompensationDetailSchema, summary: '补偿工单：恢复后继续推进' }),
  compensationDetail: op.get('/compensation/{id}', { params: idParam, response: workflowCompensationDetailSchema, summary: '补偿工单详情（含处理历史）' }),
}, { tags: ['WorkflowInstances'] });
