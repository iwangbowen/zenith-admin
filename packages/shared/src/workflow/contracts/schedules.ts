import * as z from 'zod';
import { idParam, paginated, paginationQuery } from '../../core/api-schemas';
import { defineContract, op } from '../../core/contract';
import { createWorkflowScheduleSchema, updateWorkflowScheduleSchema } from '../validation';

// ─── 实体 ────────────────────────────────────────────────────────────────────

/** 流程定时发起规则 */
export const workflowScheduleSchema = z.object({
  id: z.int(),
  definitionId: z.int(),
  definitionName: z.string().nullable().optional(),
  name: z.string(),
  cronExpression: z.string().meta({ example: '0 9 * * 1' }),
  timezone: z.string().nullable().meta({ description: 'IANA 时区（如 Asia/Shanghai）；null = 默认 Asia/Shanghai' }),
  initiatorId: z.int(),
  initiatorName: z.string().nullable().optional(),
  titleTemplate: z.string().nullable(),
  formData: z.record(z.string(), z.unknown()).nullable(),
  status: z.enum(['enabled', 'disabled']),
  lastRunAt: z.string().nullable(),
  lastRunStatus: z.string().nullable(),
  lastRunMessage: z.string().nullable(),
  nextRunAt: z.string().nullable(),
  tenantId: z.int().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
}).meta({ id: 'WorkflowSchedule' });

export type WorkflowSchedule = z.infer<typeof workflowScheduleSchema>;

// ─── 契约 ────────────────────────────────────────────────────────────────────

export const workflowScheduleListQuery = paginationQuery.extend({
  definitionId: z.coerce.number().int().optional(),
  status: z.string().optional(),
});

export const workflowScheduleContract = defineContract('/api/workflows/schedules', {
  list: op.get('/', { query: workflowScheduleListQuery, response: paginated(workflowScheduleSchema), summary: '定时发起规则列表' }),
  create: op.post('/', { body: createWorkflowScheduleSchema, response: workflowScheduleSchema, summary: '新建定时发起' }),
  update: op.put('/{id}', { params: idParam, body: updateWorkflowScheduleSchema, response: workflowScheduleSchema, summary: '更新定时发起' }),
  remove: op.delete('/{id}', { params: idParam, summary: '删除定时发起' }),
  run: op.post('/{id}/run', { params: idParam, response: workflowScheduleSchema, summary: '立即执行一次' }),
}, { tags: ['WorkflowSchedules'] });
