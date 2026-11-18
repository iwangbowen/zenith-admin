import * as z from 'zod';
import { defineContract, op } from '../../core/contract';
import { WORKFLOW_HEALTH_ISSUE_TYPES } from '../constants';
import { idQuery, keywordQuery, queryEnum } from '../../core/api-schemas';

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
  fingerprint: z.string().optional(),
  ruleVersion: z.string().optional(),
  jobId: z.int().nullable().optional(),
  activationId: z.string().nullable().optional(),
  evidence: z.record(z.string(), z.unknown()).optional(),
}).meta({ id: 'WorkflowHealthIssue' });

export type WorkflowHealthIssue = z.infer<typeof workflowHealthIssueSchema>;

export const workflowHealthSummarySchema = z.object({
  healthy: z.boolean(),
  checkedAt: z.string(),
  thresholdMinutes: z.int(),
  ruleVersion: z.string(),
  scope: z.enum(['business', 'platform']),
  coverage: z.object({ instances: z.int(), tasks: z.int(), rules: z.int(), complete: z.boolean() }),
  total: z.int(),
  page: z.int(),
  pageSize: z.int(),
  truncated: z.boolean(),
  affectedInstances: z.int(),
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
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(100),
  definitionId: idQuery(),
  instanceId: idQuery(),
  keyword: keywordQuery('实例标题 / 单号'),
  severity: queryEnum(['critical', 'warning'] as const),
  type: queryEnum(WORKFLOW_HEALTH_ISSUE_TYPES),
  thresholdMinutes: z.coerce.number().int().min(1).max(24 * 60).optional().meta({ description: '卡滞判定阈值（分钟），默认 30' }),
});

export const workflowHealthContract = defineContract('/api/workflows/health', {
  summary: op.get('/', { access: { permission: 'workflow:health:view' }, query: workflowHealthQuery, response: workflowHealthSummarySchema, summary: '工作流健康巡检' }),
}, { tags: ['WorkflowHealth'] });
