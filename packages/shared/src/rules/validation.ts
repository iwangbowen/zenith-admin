import * as z from 'zod';
import { partialForUpdate } from '../core/validation';
import {
  RULE_COLLECT_AGGREGATES,
  RULE_FIELD_TYPES,
  RULE_GRAY_ACTIONS,
  RULE_HIT_POLICIES,
  RULE_LIST_MATCH_MODES,
  RULE_LIST_TYPES,
  RULE_SCORECARD_BAND_OPS,
  RULE_SCORECARD_VARIABLE_TYPES,
} from './constants';

// ─── 规则中心：决策表 ────────────────────────────────────────────────────────────
const ruleFieldTypeSchema = z.enum(RULE_FIELD_TYPES);

const ruleHitPolicySchema = z.enum(RULE_HIT_POLICIES);

/** 规则行 then / 输出列默认值允许的字面量 */
export const ruleLiteralSchema = z.union([z.string(), z.number(), z.boolean(), z.null()]);

export const ruleDecisionTableSettingsSchema = z.object({
  collectAggregate: z.enum(RULE_COLLECT_AGGREGATES).optional(),
  fallbackToDefaults: z.boolean().optional(),
});

export const ruleDecisionInputSchema = z.object({
  key: z.string().min(1).max(64),
  label: z.string().min(1).max(64),
  expr: z.string().min(1).max(500),
  type: ruleFieldTypeSchema,
  dictCode: z.string().max(64).nullable().optional(),
});

export const ruleDecisionOutputSchema = z.object({
  key: z.string().min(1).max(64),
  label: z.string().min(1).max(64),
  type: ruleFieldTypeSchema,
  default: ruleLiteralSchema.optional(),
  isExpr: z.boolean().optional(),
});

export const ruleDecisionRowSchema = z.object({
  id: z.string().min(1).max(64),
  when: z.array(z.string()).default([]),
  then: z.record(z.string(), ruleLiteralSchema).default({}),
  priority: z.number().int().optional(),
  label: z.string().max(64).optional(),
});

export const createDecisionTableSchema = z.object({
  key: z.string().min(1).max(64).regex(/^[a-zA-Z][a-zA-Z0-9_-]*$/, 'key 仅限字母开头的字母数字下划线'),
  name: z.string().min(1).max(64),
  description: z.string().max(500).nullable().optional(),
  categoryId: z.number().int().nullable().optional(),
  hitPolicy: ruleHitPolicySchema.default('first'),
  inputs: z.array(ruleDecisionInputSchema).default([]),
  outputs: z.array(ruleDecisionOutputSchema).default([]),
  rules: z.array(ruleDecisionRowSchema).default([]),
  settings: ruleDecisionTableSettingsSchema.optional(),
});

export const updateDecisionTableSchema = partialForUpdate(createDecisionTableSchema).omit({ key: true }).extend({
  /** 编辑乐观锁：携带打开编辑时的 updatedAt，服务端不一致时返回 409 */
  expectedUpdatedAt: z.string().optional(),
});

export const toggleDecisionTableSchema = z.object({
  enabled: z.boolean(),
});

/** 测试求值（编辑态） */
export const evaluateDecisionTableSchema = z.object({
  input: z.record(z.string(), z.unknown()).default({}),
});

/** 按 key 求值（运行时 / 对外通用） */
export const evaluateRuleByKeySchema = z.object({
  key: z.string().min(1),
  input: z.record(z.string(), z.unknown()).default({}),
});

/** 发布决策表：可选灰度参数（不传 = 全量发布） */
export const publishDecisionTableSchema = z.object({
  grayPercent: z.number().int().min(1).max(99).nullable().optional(),
  grayDimension: z.string().max(200).nullable().optional(),
});

/** 灰度操作：complete=转正（新版本全量）；cancel=取消灰度（全量回旧版本） */
export const grayActionSchema = z.object({
  action: z.enum(RULE_GRAY_ACTIONS),
});

/** 批量仿真：逐行以草稿态求值 */
export const simulateDecisionTableSchema = z.object({
  rows: z.array(z.record(z.string(), z.unknown())).min(1).max(200),
});

/** 影子对比：重放最近 N 条执行输入 */
export const shadowRunDecisionTableSchema = z.object({
  limit: z.number().int().min(1).max(500).default(100),
});

export type CreateDecisionTableInput = z.input<typeof createDecisionTableSchema>;

export type UpdateDecisionTableInput = z.input<typeof updateDecisionTableSchema>;

export type EvaluateRuleByKeyInput = z.input<typeof evaluateRuleByKeySchema>;

export type PublishDecisionTableInput = z.input<typeof publishDecisionTableSchema>;

export const createRuleTestCaseSchema = z.object({
  name: z.string().min(1).max(64),
  input: z.record(z.string(), z.unknown()).default({}),
  expected: z.record(z.string(), z.unknown()).default({}),
});

export const updateRuleTestCaseSchema = partialForUpdate(createRuleTestCaseSchema);

export type CreateRuleTestCaseInput = z.input<typeof createRuleTestCaseSchema>;

export type UpdateRuleTestCaseInput = z.input<typeof updateRuleTestCaseSchema>;

// ─── 规则中心：决策流 Schema ─────────────────────────────────────────────────────
export const ruleFlowStepSchema = z.object({
  id: z.string().min(1).max(64),
  tableKey: z.string().min(1).max(64),
  label: z.string().max(64).optional(),
  condition: z.string().max(500).optional(),
  outputNamespace: z.string().max(32).regex(/^[a-zA-Z_$][\w$]*$/, '命名空间需为合法标识符').optional().or(z.literal('')),
});

export const createDecisionFlowSchema = z.object({
  key: z.string().min(1).max(64).regex(/^[a-zA-Z][a-zA-Z0-9_-]*$/, 'key 仅限字母开头的字母数字下划线'),
  name: z.string().min(1).max(64),
  description: z.string().max(500).nullable().optional(),
  steps: z.array(ruleFlowStepSchema).default([]),
});

export const updateDecisionFlowSchema = partialForUpdate(createDecisionFlowSchema).omit({ key: true }).extend({
  expectedUpdatedAt: z.string().optional(),
});

export type CreateDecisionFlowInput = z.input<typeof createDecisionFlowSchema>;

export type UpdateDecisionFlowInput = z.input<typeof updateDecisionFlowSchema>;

// ─── 规则中心：名单库 Schema ─────────────────────────────────────────────────────
export const createRuleListSchema = z.object({
  key: z.string().min(1).max(64).regex(/^[a-zA-Z][a-zA-Z0-9_-]*$/, 'key 仅限字母开头的字母数字下划线'),
  name: z.string().min(1).max(64),
  type: z.enum(RULE_LIST_TYPES).default('black'),
  description: z.string().max(500).nullable().optional(),
});

export const updateRuleListSchema = partialForUpdate(createRuleListSchema).omit({ key: true }).extend({
  status: z.enum(['enabled', 'disabled']).optional(),
});

export const createRuleListItemSchema = z.object({
  value: z.string().min(1).max(128),
  label: z.string().max(64).nullable().optional(),
  matchMode: z.enum(RULE_LIST_MATCH_MODES).default('exact'),
  expiresAt: z.string().nullable().optional(),
  remark: z.string().max(255).nullable().optional(),
});

export const batchRuleListItemsSchema = z.object({
  values: z.array(z.string().min(1).max(128)).min(1).max(500),
  expiresAt: z.string().nullable().optional(),
});

export const checkRuleListSchema = z.object({
  key: z.string().min(1).max(64),
  value: z.string().min(1).max(128),
});

export type CreateRuleListInput = z.input<typeof createRuleListSchema>;

export type UpdateRuleListInput = z.input<typeof updateRuleListSchema>;

export type CreateRuleListItemInput = z.input<typeof createRuleListItemSchema>;

export type BatchRuleListItemsInput = z.input<typeof batchRuleListItemsSchema>;

// ─── 规则中心：发布审批 Schema ───────────────────────────────────────────────────
export const reviewDecisionTableSchema = z.object({
  approve: z.boolean(),
  comment: z.string().max(255).optional(),
});

export type ReviewDecisionTableInput = z.input<typeof reviewDecisionTableSchema>;

// ─── 规则中心：评分卡 Schema ─────────────────────────────────────────────────────
export const ruleScorecardBandSchema = z.object({
  id: z.string().min(1).max(64),
  op: z.enum(RULE_SCORECARD_BAND_OPS),
  min: z.number().nullable().optional(),
  max: z.number().nullable().optional(),
  value: z.string().max(64).optional(),
  values: z.array(z.string().min(1).max(64)).max(50).optional(),
  score: z.number(),
  label: z.string().max(64).optional(),
});

export const ruleScorecardVariableSchema = z.object({
  key: z.string().min(1).max(64).regex(/^[a-zA-Z_][a-zA-Z0-9_]*$/, '变量 key 需为合法标识符'),
  label: z.string().min(1).max(64),
  expr: z.string().min(1).max(500),
  type: z.enum(RULE_SCORECARD_VARIABLE_TYPES),
  weight: z.number().min(0).max(100).optional(),
  missingScore: z.number().optional(),
  bands: z.array(ruleScorecardBandSchema).max(50).default([]),
});

export const ruleScorecardGradeSchema = z.object({
  grade: z.string().min(1).max(32),
  minScore: z.number(),
  decision: z.string().max(64).nullable().optional(),
});

export const createRuleScorecardSchema = z.object({
  key: z.string().min(1).max(64).regex(/^[a-zA-Z][a-zA-Z0-9_-]*$/, 'key 仅限字母开头的字母数字下划线'),
  name: z.string().min(1).max(64),
  description: z.string().max(500).nullable().optional(),
  baseScore: z.number().default(0),
  variables: z.array(ruleScorecardVariableSchema).max(50).default([]),
  grades: z.array(ruleScorecardGradeSchema).max(20).default([]),
});

export const updateRuleScorecardSchema = partialForUpdate(createRuleScorecardSchema).omit({ key: true }).extend({
  /** 编辑乐观锁：携带打开编辑时的 updatedAt，服务端不一致时返回 409 */
  expectedUpdatedAt: z.string().optional(),
});

export const evaluateRuleScorecardSchema = z.object({
  input: z.record(z.string(), z.unknown()).default({}),
});

/** 运行时求值（按 key 取发布快照） */
export const evaluateRuleScorecardByKeySchema = z.object({
  key: z.string().min(1).max(64),
  input: z.record(z.string(), z.unknown()).default({}),
});

export type CreateRuleScorecardInput = z.input<typeof createRuleScorecardSchema>;

export type UpdateRuleScorecardInput = z.input<typeof updateRuleScorecardSchema>;
