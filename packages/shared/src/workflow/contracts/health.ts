import * as z from 'zod';
import { defineContract, op } from '../../core/contract';
import { WORKFLOW_HEALTH_ISSUE_TYPES } from '../constants';

// ─── 实体 ────────────────────────────────────────────────────────────────────

export const workflowHealthIssueSchema = z.object({
  id: z.string(),
  type: z.enum(WORKFLOW_HEALTH_ISSUE_TYPES),
  severity: z.enum(['warning', 'critical']),
  title: z.string(),
  description: z.string(),
  instanceId: z.int().nullable(),
  instanceTitle: z.string().nullable().optional(),
  taskId: z.int().nullable().optional(),
  nodeKey: z.string().nullable().optional(),
  nodeName: z.string().nullable().optional(),
  status: z.string().nullable().optional(),
  ageMinutes: z.int(),
  createdAt: z.string(),
}).meta({ id: 'WorkflowHealthIssue' });

export type WorkflowHealthIssue = z.infer<typeof workflowHealthIssueSchema>;

export const workflowHealthSummarySchema = z.object({
  healthy: z.boolean(),
  checkedAt: z.string(),
  thresholdMinutes: z.int(),
  stats: z.object({
    total: z.int(),
    critical: z.int(),
    warning: z.int(),
    externalFailed: z.int(),
    triggerStuck: z.int(),
    subProcessStuck: z.int(),
    outboxFailed: z.int(),
  }),
  issues: z.array(workflowHealthIssueSchema),
}).meta({ id: 'WorkflowHealthSummary' });

export type WorkflowHealthSummary = z.infer<typeof workflowHealthSummarySchema>;

// ─── 契约 ────────────────────────────────────────────────────────────────────

export const workflowHealthQuery = z.object({
  thresholdMinutes: z.coerce.number().int().min(1).max(24 * 60).optional().meta({ description: '卡滞判定阈值（分钟），默认 30' }),
});

export const workflowHealthContract = defineContract('/api/workflows/health', {
  summary: op.get('/', { query: workflowHealthQuery, response: workflowHealthSummarySchema, summary: '工作流健康巡检' }),
}, { tags: ['WorkflowHealth'] });
