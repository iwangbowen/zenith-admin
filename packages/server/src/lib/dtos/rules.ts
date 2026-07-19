/**
 * 规则中心 DTO（决策表）
 */
import { z } from '@hono/zod-openapi';
import { auditFields } from './_audit';

const RuleInputDTO = z.object({
  key: z.string(), label: z.string(), expr: z.string(),
  type: z.enum(['string', 'number', 'boolean']),
});
const RuleOutputDTO = z.object({
  key: z.string(), label: z.string(),
  type: z.enum(['string', 'number', 'boolean']),
  default: z.union([z.string(), z.number(), z.boolean(), z.null()]).optional(),
});
const RuleRowDTO = z.object({
  id: z.string(),
  when: z.array(z.string()),
  then: z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()])),
  priority: z.number().int().optional(),
  label: z.string().optional(),
});
const hitPolicy = z.enum(['first', 'unique', 'priority', 'collect', 'any']);

export const DecisionTableDTO = z
  .object({
    id: z.number().int(),
    key: z.string(),
    name: z.string(),
    description: z.string().nullable(),
    categoryId: z.number().int().nullable(),
    status: z.enum(['draft', 'published', 'disabled']),
    hitPolicy,
    inputs: z.array(RuleInputDTO),
    outputs: z.array(RuleOutputDTO),
    rules: z.array(RuleRowDTO),
    version: z.number().int(),
    publishedAt: z.string().nullable(),
    dirty: z.boolean().optional(),
    ...auditFields,
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .openapi('DecisionTable');

export const DecisionTableVersionDTO = z
  .object({
    id: z.number().int(),
    tableId: z.number().int(),
    version: z.number().int(),
    name: z.string(),
    hitPolicy,
    inputs: z.array(RuleInputDTO),
    outputs: z.array(RuleOutputDTO),
    rules: z.array(RuleRowDTO),
    publishedAt: z.string(),
    publishedBy: z.number().int().nullable(),
  })
  .openapi('DecisionTableVersion');

export const RuleEvaluateResultDTO = z
  .object({
    matched: z.boolean(),
    outputs: z.record(z.string(), z.unknown()),
    matchedRowIds: z.array(z.string()),
    hitPolicy,
    collected: z.array(z.record(z.string(), z.unknown())).optional(),
    reason: z.enum(['no_match', 'unique_conflict', 'any_conflict']).optional(),
  })
  .openapi('RuleEvaluateResult');

export const RuleVersionDiffDTO = z
  .object({
    from: z.number().int(),
    to: z.number().int(),
    changes: z.array(z.object({
      kind: z.enum(['input', 'output', 'rule', 'meta']),
      op: z.enum(['added', 'removed', 'changed']),
      ref: z.string(),
      detail: z.string(),
    })),
  })
  .openapi('RuleVersionDiff');

export const RuleTestCaseDTO = z
  .object({
    id: z.number().int(), tableId: z.number().int(), name: z.string(),
    input: z.record(z.string(), z.unknown()), expected: z.record(z.string(), z.unknown()),
    createdAt: z.string(), updatedAt: z.string(),
  })
  .openapi('RuleTestCase');

export const RuleTestRunResultDTO = z
  .object({
    total: z.number().int(), passed: z.number().int(), failed: z.number().int(),
    coverage: z.number().int(), uncoveredRowIds: z.array(z.string()),
    cases: z.array(z.object({ id: z.number().int(), name: z.string(), pass: z.boolean(), expected: z.record(z.string(), z.unknown()), actual: z.record(z.string(), z.unknown()) })),
  })
  .openapi('RuleTestRunResult');

export const RuleExecutionDTO = z
  .object({
    id: z.number().int(), ruleKey: z.string(), tableId: z.number().int().nullable(), instanceId: z.number().int().nullable(),
    nodeKey: z.string().nullable(), source: z.enum(['runtime', 'manual', 'test']), matched: z.boolean(), hitPolicy,
    input: z.record(z.string(), z.unknown()), outputs: z.record(z.string(), z.unknown()), matchedRowIds: z.array(z.string()), createdAt: z.string(),
  })
  .openapi('RuleExecution');
