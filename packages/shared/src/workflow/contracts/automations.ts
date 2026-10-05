import * as z from 'zod';
import { auditFieldsSchema, batchIdsBody, entityStatusSchema, idParam, paginated, paginationQuery, entityStatusQuery, queryEnum, idQuery } from '../../core/api-schemas';
import { defineContract, op } from '../../core/contract';
import { WORKFLOW_AUTOMATION_TRIGGERS, WORKFLOW_AUTOMATION_RUN_STATUSES, WORKFLOW_AUTOMATION_TRIGGER_OPTIONS } from '../constants';
import { createWorkflowAutomationSchema, updateWorkflowAutomationSchema, workflowAutomationActionSchema } from '../validation';

// ─── 实体 ────────────────────────────────────────────────────────────────────

/** 流程级自动化规则 */
export const workflowAutomationSchema = z.object({
  id: z.int(),
  definitionId: z.int(),
  definitionName: z.string().nullable().optional(),
  name: z.string(),
  trigger: z.enum(WORKFLOW_AUTOMATION_TRIGGERS),
  actions: z.array(workflowAutomationActionSchema),
  status: entityStatusSchema,
  sort: z.int(),
  tenantId: z.int().nullable(),
  ...auditFieldsSchema,
  createdAt: z.string(),
  updatedAt: z.string(),
}).meta({ id: 'WorkflowAutomation' });

export type WorkflowAutomation = z.infer<typeof workflowAutomationSchema>;

/** 自动化动作执行记录（每个动作执行一次记一行） */
export const workflowAutomationRunSchema = z.object({
  id: z.int(),
  ruleId: z.int().nullable(),
  ruleName: z.string(),
  instanceId: z.int().nullable(),
  instanceTitle: z.string().nullable(),
  targetInstanceId: z.int().nullable(),
  targetTitle: z.string().nullable(),
  trigger: z.enum(WORKFLOW_AUTOMATION_TRIGGERS),
  actionIndex: z.int(),
  actionType: z.string(),
  status: z.enum(WORKFLOW_AUTOMATION_RUN_STATUSES),
  eventId: z.string(),
  attempts: z.int(),
  maxAttempts: z.int(),
  nextRetryAt: z.string().nullable(),
  canRetry: z.boolean(),
  externalOutcomeUncertain: z.boolean(),
  error: z.string().nullable(),
  durationMs: z.int().nullable(),
  tenantId: z.int().nullable(),
  createdAt: z.string(),
}).meta({ id: 'WorkflowAutomationRun' });

export type WorkflowAutomationRun = z.infer<typeof workflowAutomationRunSchema>;

// ─── 契约 ────────────────────────────────────────────────────────────────────

export const workflowAutomationListQuery = paginationQuery.extend({
  definitionId: idQuery(),
  trigger: queryEnum(WORKFLOW_AUTOMATION_TRIGGERS, { options: WORKFLOW_AUTOMATION_TRIGGER_OPTIONS }),
  status: entityStatusQuery,
});

export const workflowAutomationRunListQuery = paginationQuery.extend({
  ruleId: idQuery(),
  instanceId: idQuery(),
  status: queryEnum(WORKFLOW_AUTOMATION_RUN_STATUSES),
});

export const workflowAutomationContract = defineContract('/api/workflows/automations', {
  list: op.get('/', { access: { permission: 'workflow:definition:list' }, query: workflowAutomationListQuery, response: paginated(workflowAutomationSchema), summary: '流程自动化规则分页列表' }),
  runs: op.get('/runs', { access: { permission: 'workflow:definition:list' }, query: workflowAutomationRunListQuery, response: paginated(workflowAutomationRunSchema), summary: '自动化动作执行记录' }),
  retryRun: op.post('/runs/{id}/retry', { access: { permission: 'workflow:definition:edit' }, audit: '重试自动化动作', params: idParam, response: workflowAutomationRunSchema, summary: '独立重试失败动作（使用冻结配置和输入）' }),
  detail: op.get('/{id}', { access: { permission: 'workflow:definition:list' }, params: idParam, response: workflowAutomationSchema, summary: '获取自动化规则' }),
  create: op.post('/', { access: { permission: 'workflow:definition:edit' }, audit: '创建流程自动化规则', body: createWorkflowAutomationSchema, response: workflowAutomationSchema, summary: '创建自动化规则' }),
  update: op.put('/{id}', { access: { permission: 'workflow:definition:edit' }, audit: '更新流程自动化规则', params: idParam, body: updateWorkflowAutomationSchema, response: workflowAutomationSchema, summary: '更新自动化规则' }),
  remove: op.delete('/{id}', { access: { permission: 'workflow:definition:edit' }, audit: '删除流程自动化规则', params: idParam, summary: '删除自动化规则' }),
  batchDelete: op.post('/batch-delete', { access: { permission: 'workflow:definition:edit' }, audit: '批量删除流程自动化规则', body: batchIdsBody, summary: '批量删除自动化规则' }),
}, { auditModule: '工作流管理', tags: ['WorkflowAutomations'] });
