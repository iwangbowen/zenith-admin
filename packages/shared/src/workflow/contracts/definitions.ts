import * as z from 'zod';
import { auditFieldsSchema, batchIdsBody, idParam, paginated, paginationQuery } from '../../core/api-schemas';
import { defineContract, op } from '../../core/contract';
import {
  WORKFLOW_DEFINITION_STATUSES,
  WORKFLOW_FORM_TYPES,
  WORKFLOW_SIMULATION_HEALTH_LEVELS,
  WORKFLOW_SIMULATION_NODE_STATE_STATUSES,
  WORKFLOW_SIMULATION_RESULT_STATUSES,
  WORKFLOW_SIMULATION_TIMELINE_STATUSES,
} from '../constants';
import {
  createWorkflowDefinitionSchema,
  importWorkflowDefinitionSchema,
  previewWorkflowSchema,
  simulateWorkflowSchema,
  updateWorkflowDefinitionSchema,
  workflowFormFieldSchema,
  workflowFormSettingsSchema,
  workflowHealthCheckSchema,
} from '../validation';
import { workflowCustomFormSchema, workflowFlowDataSchema, workflowFormSchemaShape } from './flow-data';

// ─── 实体 ────────────────────────────────────────────────────────────────────

export const workflowDefinitionSchema = z.object({
  id: z.int(),
  name: z.string().meta({ example: '请假审批' }),
  description: z.string().nullable(),
  categoryId: z.int().nullable(),
  initiatorScopeType: z.enum(['all', 'users', 'departments', 'roles']).meta({ description: '发起人范围：all=全员, users=指定用户, departments=指定部门, roles=指定角色' }),
  initiatorScopeIds: z.array(z.int()).nullable().meta({ description: '发起人范围 ID 列表（initiatorScopeType !== all 时生效）' }),
  categoryName: z.string().nullable().optional(),
  categoryColor: z.string().nullable().optional(),
  categoryIcon: z.string().nullable().optional(),
  flowData: workflowFlowDataSchema.nullable(),
  formId: z.int().nullable().meta({ description: '绑定的表单 ID（实时引用最新表单）' }),
  formName: z.string().nullable().optional(),
  formFields: z.array(workflowFormFieldSchema).nullable().meta({ description: '由 formId 解析得到的表单字段（派生字段）' }),
  formSettings: workflowFormSettingsSchema.nullable().optional(),
  formType: z.enum(WORKFLOW_FORM_TYPES).meta({ description: 'designer=表单库，custom=自定义业务页面，external=业务系统主导' }),
  customForm: workflowCustomFormSchema.nullable(),
  status: z.enum(WORKFLOW_DEFINITION_STATUSES),
  version: z.int(),
  tenantId: z.int().nullable(),
  ...auditFieldsSchema,
  createdByName: z.string().nullable().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
}).meta({ id: 'WorkflowDefinition' });

export type WorkflowDefinition = z.infer<typeof workflowDefinitionSchema>;

export const workflowDefinitionVersionSchema = z.object({
  id: z.int(),
  definitionId: z.int(),
  version: z.int(),
  name: z.string(),
  description: z.string().nullable(),
  flowData: workflowFlowDataSchema.nullable(),
  formId: z.int().nullable(),
  formName: z.string().nullable().optional(),
  formFields: z.array(workflowFormFieldSchema).nullable(),
  formType: z.enum(WORKFLOW_FORM_TYPES),
  customForm: workflowCustomFormSchema.nullable(),
  publishedAt: z.string(),
  publishedBy: z.int().nullable(),
  publishedByName: z.string().nullable().optional(),
  tenantId: z.int().nullable(),
}).meta({ id: 'WorkflowDefinitionVersion' });

export type WorkflowDefinitionVersion = z.infer<typeof workflowDefinitionVersionSchema>;

/** 流程定义导出 JSON（自包含：流程图 + 表单结构） */
export const workflowDefinitionExportSchema = z.object({
  name: z.string(),
  description: z.string().nullable(),
  categoryName: z.string().nullable(),
  flowData: workflowFlowDataSchema.nullable(),
  formType: z.enum(WORKFLOW_FORM_TYPES),
  customForm: workflowCustomFormSchema.nullable(),
  form: z.object({
    name: z.string(),
    description: z.string().nullable(),
    schema: workflowFormSchemaShape.nullable(),
  }).nullable(),
  exportedAt: z.string(),
  schemaVersion: z.int().meta({ description: '流程 flowData 的引擎 schema 版本' }),
}).meta({ id: 'WorkflowDefinitionExport' });

export type WorkflowDefinitionExport = z.infer<typeof workflowDefinitionExportSchema>;

// ─── 版本对比 ────────────────────────────────────────────────────────────────

export const workflowVersionDiffSideSchema = z.object({
  version: z.int(),
  name: z.string(),
  label: z.string(),
  flowData: workflowFlowDataSchema.nullable(),
  publishedAt: z.string().nullable(),
}).meta({ id: 'WorkflowVersionDiffSide' });

export type WorkflowVersionDiffSide = z.infer<typeof workflowVersionDiffSideSchema>;

export const workflowVersionFieldChangeSchema = z.object({
  field: z.string(),
  before: z.string(),
  after: z.string(),
}).meta({ id: 'WorkflowVersionFieldChange' });

export type WorkflowVersionFieldChange = z.infer<typeof workflowVersionFieldChangeSchema>;

export const workflowVersionNodeChangeSchema = z.object({
  kind: z.enum(['added', 'removed', 'modified']),
  nodeKey: z.string(),
  nodeName: z.string(),
  nodeType: z.string(),
  fields: z.array(workflowVersionFieldChangeSchema).meta({ description: 'modified 时的字段级变更' }),
}).meta({ id: 'WorkflowVersionNodeChange' });

export type WorkflowVersionNodeChange = z.infer<typeof workflowVersionNodeChangeSchema>;

export const workflowVersionEdgeChangeSchema = z.object({
  kind: z.enum(['added', 'removed', 'modified']),
  from: z.string(),
  to: z.string(),
  before: z.string().nullable().meta({ description: '条件摘要变化（modified 时 before/after 均有值）' }),
  after: z.string().nullable(),
}).meta({ id: 'WorkflowVersionEdgeChange' });

export type WorkflowVersionEdgeChange = z.infer<typeof workflowVersionEdgeChangeSchema>;

export const workflowVersionDiffSummarySchema = z.object({
  nodesAdded: z.int(),
  nodesRemoved: z.int(),
  nodesModified: z.int(),
  edgesAdded: z.int(),
  edgesRemoved: z.int(),
  edgesModified: z.int(),
}).meta({ id: 'WorkflowVersionDiffSummary' });

export type WorkflowVersionDiffSummary = z.infer<typeof workflowVersionDiffSummarySchema>;

export const workflowVersionDiffSchema = z.object({
  left: workflowVersionDiffSideSchema,
  right: workflowVersionDiffSideSchema,
  summary: workflowVersionDiffSummarySchema,
  nodeChanges: z.array(workflowVersionNodeChangeSchema),
  edgeChanges: z.array(workflowVersionEdgeChangeSchema),
}).meta({ id: 'WorkflowVersionDiff' });

export type WorkflowVersionDiff = z.infer<typeof workflowVersionDiffSchema>;

// ─── 审批链路预览 ────────────────────────────────────────────────────────────

const approverRefSchema = z.object({ id: z.int(), name: z.string() });

/** 提交前审批链路预览节点 */
export const workflowApproverPreviewNodeSchema = z.object({
  nodeKey: z.string(),
  nodeName: z.string(),
  nodeType: z.string(),
  approvers: z.array(approverRefSchema).meta({ description: '解析出的处理人（已转换为真实姓名）' }),
  selectableApprovers: z.array(approverRefSchema).optional().meta({ description: '发起人 / 审批人自选节点的可选候选人' }),
  selectionRequired: z.boolean().optional(),
  approveMethod: z.string().nullable().optional().meta({ description: '多人审批方式（and/or/sequential/ratio）' }),
  branchLabel: z.string().nullable().optional().meta({ description: '所在分支标签（条件 / 并行分支时）' }),
  empty: z.boolean().optional().meta({ description: '审批人为空（需按节点空处理策略兜底）' }),
}).meta({ id: 'WorkflowApproverPreviewNode' });

export type WorkflowApproverPreviewNode = z.infer<typeof workflowApproverPreviewNodeSchema>;

// ─── 流程仿真 ────────────────────────────────────────────────────────────────

export const workflowSimulationTimelineItemSchema = z.object({
  step: z.int(),
  nodeKey: z.string(),
  nodeName: z.string(),
  nodeType: z.string(),
  status: z.enum(WORKFLOW_SIMULATION_TIMELINE_STATUSES),
  assignees: z.array(approverRefSchema).optional(),
  decision: z.enum(['approve', 'reject', 'skip', 'wait', 'auto']).optional(),
  reason: z.string().optional(),
  detail: z.string().optional(),
  nextNodeKeys: z.array(z.string()).optional(),
  estimatedMinutes: z.int().optional().meta({ description: '该步骤预估耗时（分钟），自动 / 瞬时节点为 0' }),
}).meta({ id: 'WorkflowSimulationTimelineItem' });

export type WorkflowSimulationTimelineItem = z.infer<typeof workflowSimulationTimelineItemSchema>;

export const workflowSimulationEdgeResultSchema = z.object({
  edgeId: z.string(),
  source: z.string(),
  target: z.string(),
  sourceKey: z.string().optional(),
  targetKey: z.string().optional(),
  label: z.string().nullable().optional(),
  taken: z.boolean(),
  reason: z.string().optional(),
  conditionMatched: z.boolean().nullable().optional(),
  conditionSummary: z.string().nullable().optional(),
  actualValue: z.string().nullable().optional(),
}).meta({ id: 'WorkflowSimulationEdgeResult' });

export type WorkflowSimulationEdgeResult = z.infer<typeof workflowSimulationEdgeResultSchema>;

export const workflowSimulationNodeStateSchema = z.object({
  status: z.enum(WORKFLOW_SIMULATION_NODE_STATE_STATUSES),
  message: z.string().optional(),
}).meta({ id: 'WorkflowSimulationNodeState' });

export type WorkflowSimulationNodeState = z.infer<typeof workflowSimulationNodeStateSchema>;

export const workflowSimulationHealthIssueSchema = z.object({
  level: z.enum(WORKFLOW_SIMULATION_HEALTH_LEVELS),
  scope: z.enum(['flow', 'node', 'edge']),
  nodeKey: z.string().optional(),
  edgeId: z.string().optional(),
  message: z.string(),
  suggestion: z.string().optional(),
}).meta({ id: 'WorkflowSimulationHealthIssue' });

export type WorkflowSimulationHealthIssue = z.infer<typeof workflowSimulationHealthIssueSchema>;

/** 仿真阻塞点（人工审批 / 延时 / 外部回调 / 子流程 / 死锁） */
export const workflowSimulationBlockingPointSchema = z.object({
  nodeKey: z.string(),
  nodeName: z.string(),
  kind: z.enum(['humanTask', 'delay', 'external', 'subProcess', 'blocked']),
  reason: z.string(),
  estimatedMinutes: z.int(),
}).meta({ id: 'WorkflowSimulationBlockingPoint' });

export type WorkflowSimulationBlockingPoint = z.infer<typeof workflowSimulationBlockingPointSchema>;

export const workflowSimulationResultSchema = z.object({
  valid: z.boolean(),
  warnings: z.array(z.string()),
  result: z.enum(WORKFLOW_SIMULATION_RESULT_STATUSES),
  timeline: z.array(workflowSimulationTimelineItemSchema),
  edgeResults: z.array(workflowSimulationEdgeResultSchema),
  nodeStates: z.record(z.string(), workflowSimulationNodeStateSchema),
  healthIssues: z.array(workflowSimulationHealthIssueSchema),
  pathSignature: z.array(z.string()),
  estimatedDurationMinutes: z.int().meta({ description: '路径预估总耗时（分钟，各步骤累加）' }),
  blockingPoints: z.array(workflowSimulationBlockingPointSchema),
}).meta({ id: 'WorkflowSimulationResult' });

export type WorkflowSimulationResult = z.infer<typeof workflowSimulationResultSchema>;

// ─── 发布前健康体检 ──────────────────────────────────────────────────────────

export const workflowDefinitionHealthIssueSchema = z.object({
  severity: z.enum(['info', 'warning', 'critical']),
  message: z.string(),
  suggestion: z.string().nullable(),
  nodeKey: z.string().nullable(),
  nodeName: z.string().nullable(),
}).meta({ id: 'WorkflowDefinitionHealthIssue' });

export type WorkflowDefinitionHealthIssue = z.infer<typeof workflowDefinitionHealthIssueSchema>;

export const workflowDefinitionHealthCheckItemSchema = z.object({
  key: z.enum(['structure', 'approver', 'branch', 'timeout', 'expression']),
  title: z.string(),
  status: z.enum(['pass', 'warn', 'fail']),
  score: z.int().meta({ description: '该维度得分 0-100' }),
  weight: z.number().meta({ description: '该维度在总分中的权重 0-1' }),
  summary: z.string(),
  issues: z.array(workflowDefinitionHealthIssueSchema),
}).meta({ id: 'WorkflowDefinitionHealthCheckItem' });

export type WorkflowDefinitionHealthCheckItem = z.infer<typeof workflowDefinitionHealthCheckItemSchema>;

/** 单个网关的分支覆盖分析 */
export const workflowDefinitionBranchCoverageItemSchema = z.object({
  nodeKey: z.string(),
  nodeName: z.string(),
  nodeType: z.string(),
  branchCount: z.int(),
  hasDefault: z.boolean(),
  issues: z.array(workflowDefinitionHealthIssueSchema),
}).meta({ id: 'WorkflowDefinitionBranchCoverageItem' });

export type WorkflowDefinitionBranchCoverageItem = z.infer<typeof workflowDefinitionBranchCoverageItemSchema>;

export const workflowDefinitionHealthReportSchema = z.object({
  score: z.int().meta({ description: '总分 0-100（各维度加权）' }),
  grade: z.enum(['A', 'B', 'C', 'D']),
  valid: z.boolean().meta({ description: '结构是否硬性合法（来自 validateFlowData）' }),
  checks: z.array(workflowDefinitionHealthCheckItemSchema),
  branchCoverage: z.array(workflowDefinitionBranchCoverageItemSchema),
  generatedAt: z.string(),
}).meta({ id: 'WorkflowDefinitionHealthReport' });

export type WorkflowDefinitionHealthReport = z.infer<typeof workflowDefinitionHealthReportSchema>;

// ─── 契约 ────────────────────────────────────────────────────────────────────

export const workflowDefinitionListQuery = paginationQuery.extend({
  keyword: z.string().optional().meta({ description: '按名称模糊匹配' }),
  status: z.string().optional(),
  categoryId: z.coerce.number().int().optional(),
});

export const workflowDefinitionVersionParam = z.object({
  id: z.coerce.number().int().positive().meta({ description: '流程定义 ID', example: 1 }),
  versionId: z.coerce.number().int().positive().meta({ description: '历史版本记录 ID', example: 1 }),
});

export const workflowVersionDiffQuery = z.object({
  left: z.coerce.number().int().nonnegative().default(0).meta({ description: '左侧版本记录 ID；0 = 当前草稿' }),
  right: z.coerce.number().int().nonnegative().default(0).meta({ description: '右侧版本记录 ID；0 = 当前草稿' }),
});

export const workflowDefinitionContract = defineContract('/api/workflows/definitions', {
  list: op.get('/', { query: workflowDefinitionListQuery, response: paginated(workflowDefinitionSchema), summary: '流程定义列表' }),
  published: op.get('/published', { response: z.array(workflowDefinitionSchema), summary: '已发布列表' }),
  import: op.post('/import', { body: importWorkflowDefinitionSchema, response: workflowDefinitionSchema, summary: '导入流程定义' }),
  detail: op.get('/{id}', { params: idParam, response: workflowDefinitionSchema, summary: '流程定义详情' }),
  create: op.post('/', { body: createWorkflowDefinitionSchema, response: workflowDefinitionSchema, summary: '创建流程定义' }),
  update: op.put('/{id}', { params: idParam, body: updateWorkflowDefinitionSchema, response: workflowDefinitionSchema, summary: '更新流程定义' }),
  publish: op.post('/{id}/publish', { params: idParam, response: workflowDefinitionSchema, summary: '发布流程' }),
  disable: op.post('/{id}/disable', { params: idParam, response: workflowDefinitionSchema, summary: '禁用流程' }),
  enable: op.post('/{id}/enable', { params: idParam, response: workflowDefinitionSchema, summary: '启用流程' }),
  remove: op.delete('/{id}', { params: idParam, summary: '删除流程' }),
  batchDisable: op.post('/batch-disable', { body: batchIdsBody, summary: '批量禁用流程' }),
  batchEnable: op.post('/batch-enable', { body: batchIdsBody, summary: '批量启用流程' }),
  batchDelete: op.post('/batch-delete', { body: batchIdsBody, summary: '批量删除流程' }),
  versions: op.get('/{id}/versions', { params: idParam, query: paginationQuery, response: paginated(workflowDefinitionVersionSchema), summary: '历史版本列表' }),
  restoreVersion: op.post('/{id}/versions/{versionId}/restore', { params: workflowDefinitionVersionParam, response: workflowDefinitionSchema, summary: '恢复历史版本' }),
  duplicate: op.post('/{id}/duplicate', { params: idParam, response: workflowDefinitionSchema, summary: '复制流程' }),
  export: op.get('/{id}/export', { params: idParam, response: workflowDefinitionExportSchema, summary: '导出流程定义' }),
  diff: op.get('/{id}/diff', { params: idParam, query: workflowVersionDiffQuery, response: workflowVersionDiffSchema, summary: '版本对比' }),
  preview: op.post('/{id}/preview', { params: idParam, body: previewWorkflowSchema, response: z.array(workflowApproverPreviewNodeSchema), summary: '提交前审批链路预览' }),
  simulate: op.post('/simulate', { body: simulateWorkflowSchema, response: workflowSimulationResultSchema, summary: '流程仿真' }),
  healthCheck: op.post('/health-check', { body: workflowHealthCheckSchema, response: workflowDefinitionHealthReportSchema, summary: '发布前健康体检（评分+分支覆盖）' }),
}, { tags: ['WorkflowDefinitions'] });
