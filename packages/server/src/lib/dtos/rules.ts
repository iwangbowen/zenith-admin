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
  })
  .openapi('RuleEvaluateResult');
