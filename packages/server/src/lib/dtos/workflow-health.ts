import { z } from '@hono/zod-openapi';

const HealthIssueDTO = z.object({
  severity: z.enum(['info', 'warning', 'critical']),
  message: z.string(),
  suggestion: z.string().nullable(),
  nodeKey: z.string().nullable(),
  nodeName: z.string().nullable(),
}).openapi('WorkflowDefinitionHealthIssue');

const HealthCheckItemDTO = z.object({
  key: z.enum(['structure', 'approver', 'branch', 'timeout']),
  title: z.string(),
  status: z.enum(['pass', 'warn', 'fail']),
  score: z.number().int(),
  weight: z.number(),
  summary: z.string(),
  issues: z.array(HealthIssueDTO),
}).openapi('WorkflowDefinitionHealthCheckItem');

const BranchCoverageItemDTO = z.object({
  nodeKey: z.string(),
  nodeName: z.string(),
  nodeType: z.string(),
  branchCount: z.number().int(),
  hasDefault: z.boolean(),
  issues: z.array(HealthIssueDTO),
}).openapi('WorkflowDefinitionBranchCoverageItem');

export const WorkflowDefinitionHealthReportDTO = z.object({
  score: z.number().int(),
  grade: z.enum(['A', 'B', 'C', 'D']),
  valid: z.boolean(),
  checks: z.array(HealthCheckItemDTO),
  branchCoverage: z.array(BranchCoverageItemDTO),
  generatedAt: z.string(),
}).openapi('WorkflowDefinitionHealthReport');
