/**
 * 规则中心 DTO（决策表）
 */
import { z } from '@hono/zod-openapi';
import { auditFields } from './_audit';

const RuleInputDTO = z.object({
  key: z.string(), label: z.string(), expr: z.string(),
  type: z.enum(['string', 'number', 'boolean', 'date']),
  dictCode: z.string().nullable().optional(),
});
const RuleOutputDTO = z.object({
  key: z.string(), label: z.string(),
  type: z.enum(['string', 'number', 'boolean', 'date']),
  default: z.union([z.string(), z.number(), z.boolean(), z.null()]).optional(),
  isExpr: z.boolean().optional(),
});
const RuleRowDTO = z.object({
  id: z.string(),
  when: z.array(z.string()),
  then: z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()])),
  priority: z.number().int().optional(),
  label: z.string().optional(),
});
const hitPolicy = z.enum(['first', 'unique', 'priority', 'collect', 'any']);
const RuleSettingsDTO = z.object({
  collectAggregate: z.enum(['list', 'sum', 'min', 'max', 'count', 'distinct']).optional(),
  fallbackToDefaults: z.boolean().optional(),
});

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
    settings: RuleSettingsDTO.optional(),
    version: z.number().int(),
    publishedAt: z.string().nullable(),
    dirty: z.boolean().optional(),
    reviewStatus: z.enum(['pending']).nullable().optional(),
    reviewRequestedBy: z.number().int().nullable().optional(),
    reviewRequestedAt: z.string().nullable().optional(),
    reviewComment: z.string().nullable().optional(),
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
    settings: RuleSettingsDTO.optional(),
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
    usedFallback: z.boolean().optional(),
  })
  .openapi('RuleEvaluateResult');

export const RuleUsageDTO = z
  .object({
    type: z.enum(['workflow', 'coupon']),
    id: z.number().int().nullable(),
    name: z.string(),
    status: z.string().nullable().optional(),
  })
  .openapi('RuleUsage');

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

// ─── 决策流 ─────────────────────────────────────────────────────────────────────
const RuleFlowStepDTO = z.object({
  id: z.string(),
  tableKey: z.string(),
  label: z.string().optional(),
  condition: z.string().optional(),
  outputNamespace: z.string().optional(),
});

export const DecisionFlowDTO = z
  .object({
    id: z.number().int(),
    key: z.string(),
    name: z.string(),
    description: z.string().nullable(),
    status: z.enum(['draft', 'published', 'disabled']),
    steps: z.array(RuleFlowStepDTO),
    publishedSteps: z.array(RuleFlowStepDTO).nullable(),
    version: z.number().int(),
    publishedAt: z.string().nullable(),
    dirty: z.boolean().optional(),
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .openapi('DecisionFlow');

export const RuleFlowEvaluateResultDTO = z
  .object({
    outputs: z.record(z.string(), z.unknown()),
    steps: z.array(z.object({
      stepId: z.string(),
      tableKey: z.string(),
      label: z.string().optional(),
      skipped: z.boolean(),
      skipReason: z.enum(['condition', 'unavailable', 'error']).optional(),
      matched: z.boolean(),
      outputs: z.record(z.string(), z.unknown()),
      matchedRowIds: z.array(z.string()),
      reason: z.enum(['no_match', 'unique_conflict', 'any_conflict']).optional(),
      error: z.string().optional(),
    })),
  })
  .openapi('RuleFlowEvaluateResult');

// ─── 名单库 ─────────────────────────────────────────────────────────────────────
export const RuleListDTO = z
  .object({
    id: z.number().int(),
    key: z.string(),
    name: z.string(),
    type: z.enum(['black', 'white', 'grey']),
    description: z.string().nullable(),
    status: z.enum(['enabled', 'disabled']),
    itemCount: z.number().int().optional(),
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .openapi('RuleList');

export const RuleListItemDTO = z
  .object({
    id: z.number().int(),
    listId: z.number().int(),
    value: z.string(),
    label: z.string().nullable(),
    expiresAt: z.string().nullable(),
    remark: z.string().nullable(),
    createdAt: z.string(),
  })
  .openapi('RuleListItem');

export const RuleListCheckResultDTO = z
  .object({
    hit: z.boolean(),
    listType: z.enum(['black', 'white', 'grey']).optional(),
    item: z.object({ value: z.string(), label: z.string().nullable().optional(), expiresAt: z.string().nullable().optional() }).optional(),
  })
  .openapi('RuleListCheckResult');

// ─── 命中分析 / 影子对比 ─────────────────────────────────────────────────────────
export const RuleTableStatsDTO = z
  .object({
    days: z.number().int(),
    total: z.number().int(),
    matched: z.number().int(),
    unmatched: z.number().int(),
    byDay: z.array(z.object({ date: z.string(), total: z.number().int(), matched: z.number().int() })),
    rowHits: z.array(z.object({ rowId: z.string(), count: z.number().int() })),
    bySource: z.array(z.object({ source: z.string(), count: z.number().int() })),
  })
  .openapi('RuleTableStats');

export const RuleShadowRunResultDTO = z
  .object({
    total: z.number().int(),
    same: z.number().int(),
    changed: z.number().int(),
    samples: z.array(z.object({
      executionId: z.number().int(),
      input: z.record(z.string(), z.unknown()),
      before: z.record(z.string(), z.unknown()),
      after: z.record(z.string(), z.unknown()),
      beforeMatched: z.boolean(),
      afterMatched: z.boolean(),
    })),
  })
  .openapi('RuleShadowRunResult');
