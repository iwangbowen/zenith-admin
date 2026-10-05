import * as z from 'zod';
import { entityStatusSchema, idParam, paginated, paginationQuery, entityStatusQuery, idQuery } from '../../core/api-schemas';
import { defineContract, op } from '../../core/contract';
import { createWorkflowScheduleSchema, updateWorkflowScheduleSchema } from '../validation';
import { workflowJobSchema, workflowJobExecutionSchema } from './engine';
import { WORKFLOW_SCHEDULE_RUN_TRIGGERS } from '../constants';

// ─── 实体 ────────────────────────────────────────────────────────────────────

/** 流程定时发起规则 */
export const workflowScheduleSchema = z.object({
  id: z.int(),
  definitionId: z.int(),
  definitionName: z.string().nullable().optional(),
  name: z.string(),
  cronExpression: z.string().meta({ example: '0 9 * * 1' }),
  timezone: z.string().nullable().meta({ description: 'IANA 时区（如 Asia/Shanghai）；null = 系统业务时区' }),
  initiatorId: z.int(),
  initiatorName: z.string().nullable().optional(),
  titleTemplate: z.string().nullable(),
  formData: z.record(z.string(), z.unknown()).nullable(),
  status: entityStatusSchema,
  lastRunAt: z.string().nullable(),
  lastRunStatus: z.string().nullable(),
  lastRunMessage: z.string().nullable(),
  nextRunAt: z.string().nullable(),
  tenantId: z.int().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
}).meta({ id: 'WorkflowSchedule' });

export type WorkflowSchedule = z.infer<typeof workflowScheduleSchema>;

/** One planned occurrence lives in workflow_jobs; each attempt lives in workflow_job_executions. */
export const workflowScheduleRunSchema = workflowJobSchema.extend({
  scheduleId: z.int(),
  scheduledAt: z.string(),
  trigger: z.enum(WORKFLOW_SCHEDULE_RUN_TRIGGERS),
}).meta({ id: 'WorkflowScheduleRun' });
export type WorkflowScheduleRun = z.infer<typeof workflowScheduleRunSchema>;

export const workflowScheduleRunDetailSchema = workflowScheduleRunSchema.extend({
  executions: z.array(workflowJobExecutionSchema),
}).meta({ id: 'WorkflowScheduleRunDetail' });
export type WorkflowScheduleRunDetail = z.infer<typeof workflowScheduleRunDetailSchema>;

const scheduleRunParam = idParam.extend({ jobId: idParam.shape.id });

// ─── 契约 ────────────────────────────────────────────────────────────────────

export const workflowScheduleListQuery = paginationQuery.extend({
  definitionId: idQuery(),
  status: entityStatusQuery,
});

export const workflowScheduleContract = defineContract('/api/workflows/schedules', {
  list: op.get('/', { access: { permission: 'workflow:schedule:list' }, query: workflowScheduleListQuery, response: paginated(workflowScheduleSchema), summary: '定时发起规则列表' }),
  create: op.post('/', { access: { permission: 'workflow:schedule:create' }, audit: '新建定时发起', body: createWorkflowScheduleSchema, response: workflowScheduleSchema, summary: '新建定时发起' }),
  update: op.put('/{id}', { access: { permission: 'workflow:schedule:edit' }, audit: '更新定时发起', params: idParam, body: updateWorkflowScheduleSchema, response: workflowScheduleSchema, summary: '更新定时发起' }),
  remove: op.delete('/{id}', { access: { permission: 'workflow:schedule:delete' }, audit: '删除定时发起', params: idParam, summary: '删除定时发起' }),
  run: op.post('/{id}/run', { access: { permission: 'workflow:schedule:edit' }, audit: '手动触发定时发起', params: idParam, response: workflowScheduleSchema, summary: '立即执行一次' }),
  runs: op.get('/{id}/runs', { access: { permission: 'workflow:schedule:list' }, params: idParam, query: paginationQuery, response: paginated(workflowScheduleRunSchema), summary: '定时发起周期与执行状态' }),
  runDetail: op.get('/{id}/runs/{jobId}', { access: { permission: 'workflow:schedule:list' }, params: scheduleRunParam, response: workflowScheduleRunDetailSchema, summary: '定时周期执行尝试与实例' }),
  retryRun: op.post('/{id}/runs/{jobId}/retry', { access: { permission: 'workflow:schedule:edit' }, audit: '补发原定时周期', params: scheduleRunParam, response: workflowScheduleRunDetailSchema, summary: '按原周期重试或补发' }),
}, { auditModule: '工作流管理', tags: ['WorkflowSchedules'] });
