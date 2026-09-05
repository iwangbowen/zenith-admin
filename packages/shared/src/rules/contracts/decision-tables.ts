import * as z from 'zod';
import { auditFieldsSchema, batchIdsBody, idParam, paginated, paginationQuery } from '../../core/api-schemas';
import { defineContract, op } from '../../core/contract';
import {
  RULE_DECISION_STATUSES,
  RULE_EVALUATE_REASONS,
  RULE_HIT_POLICIES,
  RULE_REVIEW_STATUSES,
  RULE_VERSION_CHANGE_KINDS,
  RULE_VERSION_CHANGE_OPS,
} from '../constants';
import {
  createDecisionTableSchema,
  createRuleTestCaseSchema,
  evaluateDecisionTableSchema,
  evaluateRuleByKeySchema,
  grayActionSchema,
  publishDecisionTableSchema,
  reviewDecisionTableSchema,
  ruleDecisionInputSchema,
  ruleDecisionOutputSchema,
  ruleDecisionRowSchema,
  ruleDecisionTableSettingsSchema,
  shadowRunDecisionTableSchema,
  simulateDecisionTableSchema,
  toggleDecisionTableSchema,
  updateDecisionTableSchema,
  updateRuleTestCaseSchema,
} from '../validation';
import { ruleUsageItemSchema, ruleVersionParam } from './common';

// ─── 实体 ────────────────────────────────────────────────────────────────────

/** 决策表行为设置（发布时随快照固化） */
export type RuleDecisionTableSettings = z.infer<typeof ruleDecisionTableSettingsSchema>;

/** 输入列：expr 为取值表达式（复用安全表达式引擎，从 scope 取值，如 form.amount） */
export type RuleDecisionInput = z.infer<typeof ruleDecisionInputSchema>;

/** 输出列：default 为无命中时回填默认值；isExpr 标记该列输出为表达式（'= form.x * 0.8'） */
export type RuleDecisionOutput = z.infer<typeof ruleDecisionOutputSchema>;

/** 规则行：when 与 inputs 一一对应，'-' 或空为通配；then 为各 output 字面量 */
export type RuleDecisionRow = z.infer<typeof ruleDecisionRowSchema>;

/** 灰度配置：新版本按灰度主体哈希分桶生效，其余流量走上一版本快照 */
export const ruleGrayConfigSchema = z.object({
  grayPercent: z.int().meta({ description: '灰度流量百分比（1-99）' }),
  grayDimension: z.string().nullable().optional().meta({ description: '灰度主体表达式（如 form.userId），缺省对整包输入哈希' }),
  grayVersion: z.int().meta({ description: '灰度中的新版本号（灰度外流量走 grayVersion - 1）' }),
}).meta({ id: 'RuleGrayConfig' });

export type RuleGrayConfig = z.infer<typeof ruleGrayConfigSchema>;

export const ruleDecisionTableSchema = z.object({
  id: z.int(),
  key: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  categoryId: z.int().nullable(),
  status: z.enum(RULE_DECISION_STATUSES),
  hitPolicy: z.enum(RULE_HIT_POLICIES),
  inputs: z.array(ruleDecisionInputSchema),
  outputs: z.array(ruleDecisionOutputSchema),
  rules: z.array(ruleDecisionRowSchema),
  settings: ruleDecisionTableSettingsSchema,
  version: z.int(),
  publishedAt: z.string().nullable(),
  gray: ruleGrayConfigSchema.nullable().meta({ description: '灰度发布中的配置，null=非灰度' }),
  dirty: z.boolean().optional().meta({ description: '当前编辑态与最新发布快照不一致（有未发布修改）' }),
  reviewStatus: z.enum(RULE_REVIEW_STATUSES).nullable().meta({ description: '发布审批（四眼）：pending=待审批' }),
  reviewRequestedBy: z.int().nullable(),
  reviewRequestedAt: z.string().nullable(),
  reviewComment: z.string().nullable().meta({ description: '最近一次审批驳回意见' }),
  ...auditFieldsSchema,
  createdAt: z.string(),
  updatedAt: z.string(),
}).meta({ id: 'DecisionTable' });

export type RuleDecisionTable = z.infer<typeof ruleDecisionTableSchema>;

export const ruleDecisionTableVersionSchema = z.object({
  id: z.int(),
  tableId: z.int(),
  version: z.int(),
  name: z.string(),
  hitPolicy: z.enum(RULE_HIT_POLICIES),
  inputs: z.array(ruleDecisionInputSchema),
  outputs: z.array(ruleDecisionOutputSchema),
  rules: z.array(ruleDecisionRowSchema),
  settings: ruleDecisionTableSettingsSchema,
  publishedAt: z.string(),
  publishedBy: z.int().nullable(),
}).meta({ id: 'DecisionTableVersion' });

export type RuleDecisionTableVersion = z.infer<typeof ruleDecisionTableVersionSchema>;

export const ruleEvaluateResultSchema = z.object({
  matched: z.boolean(),
  outputs: z.record(z.string(), z.unknown()),
  matchedRowIds: z.array(z.string()),
  hitPolicy: z.enum(RULE_HIT_POLICIES),
  collected: z.array(z.record(z.string(), z.unknown())).optional(),
  reason: z.enum(RULE_EVALUATE_REASONS).optional().meta({ description: 'matched 为 false 时的原因' }),
  usedFallback: z.boolean().optional().meta({ description: '未命中但启用了回退默认值：outputs 为各输出列默认值' }),
}).meta({ id: 'RuleEvaluateResult' });

export type RuleEvaluateResult = z.infer<typeof ruleEvaluateResultSchema>;

export const ruleVersionChangeSchema = z.object({
  kind: z.enum(RULE_VERSION_CHANGE_KINDS),
  op: z.enum(RULE_VERSION_CHANGE_OPS),
  ref: z.string(),
  detail: z.string(),
}).meta({ id: 'RuleVersionChange' });

export type RuleVersionChange = z.infer<typeof ruleVersionChangeSchema>;

export const ruleVersionDiffSchema = z.object({
  from: z.int(),
  to: z.int(),
  changes: z.array(ruleVersionChangeSchema),
}).meta({ id: 'RuleVersionDiff' });

export type RuleVersionDiff = z.infer<typeof ruleVersionDiffSchema>;

export const ruleTestCaseSchema = z.object({
  id: z.int(),
  tableId: z.int(),
  name: z.string(),
  input: z.record(z.string(), z.unknown()),
  expected: z.record(z.string(), z.unknown()),
  createdAt: z.string(),
  updatedAt: z.string(),
}).meta({ id: 'RuleTestCase' });

export type RuleTestCase = z.infer<typeof ruleTestCaseSchema>;

export const ruleCaseResultSchema = z.object({
  id: z.int(),
  name: z.string(),
  pass: z.boolean(),
  expected: z.record(z.string(), z.unknown()),
  actual: z.record(z.string(), z.unknown()),
}).meta({ id: 'RuleCaseResult' });

export type RuleCaseResult = z.infer<typeof ruleCaseResultSchema>;

export const ruleTestRunResultSchema = z.object({
  total: z.int(),
  passed: z.int(),
  failed: z.int(),
  coverage: z.int().meta({ description: '规则行覆盖率（百分比）' }),
  uncoveredRowIds: z.array(z.string()),
  cases: z.array(ruleCaseResultSchema),
}).meta({ id: 'RuleTestRunResult' });

export type RuleTestRunResult = z.infer<typeof ruleTestRunResultSchema>;

const ruleRowHitSchema = z.object({ rowId: z.string(), count: z.int() });

export const ruleTableStatsSchema = z.object({
  days: z.int(),
  total: z.int(),
  matched: z.int(),
  unmatched: z.int(),
  byDay: z.array(z.object({ date: z.string(), total: z.int(), matched: z.int() })),
  rowHits: z.array(ruleRowHitSchema),
  bySource: z.array(z.object({ source: z.string(), count: z.int() })),
}).meta({ id: 'RuleTableStats' });

export type RuleTableStats = z.infer<typeof ruleTableStatsSchema>;

export const ruleShadowDiffSampleSchema = z.object({
  executionId: z.int(),
  input: z.record(z.string(), z.unknown()),
  before: z.record(z.string(), z.unknown()),
  after: z.record(z.string(), z.unknown()),
  beforeMatched: z.boolean(),
  afterMatched: z.boolean(),
}).meta({ id: 'RuleShadowDiffSample' });

export type RuleShadowDiffSample = z.infer<typeof ruleShadowDiffSampleSchema>;

/** 影子对比：以最近执行记录的输入重放当前编辑态，评估「若现在发布」的行为差异 */
export const ruleShadowRunResultSchema = z.object({
  total: z.int(),
  same: z.int(),
  changed: z.int(),
  samples: z.array(ruleShadowDiffSampleSchema),
}).meta({ id: 'RuleShadowRunResult' });

export type RuleShadowRunResult = z.infer<typeof ruleShadowRunResultSchema>;

export const ruleSimulateRowResultSchema = z.object({
  index: z.int(),
  matched: z.boolean(),
  outputs: z.record(z.string(), z.unknown()),
  matchedRowIds: z.array(z.string()),
  error: z.string().optional(),
}).meta({ id: 'RuleSimulateRowResult' });

export type RuleSimulateRowResult = z.infer<typeof ruleSimulateRowResultSchema>;

export const ruleSimulateResultSchema = z.object({
  total: z.int(),
  matched: z.int(),
  unmatched: z.int(),
  errors: z.int(),
  rowHits: z.array(ruleRowHitSchema),
  results: z.array(ruleSimulateRowResultSchema),
}).meta({ id: 'RuleSimulateResult' });

export type RuleSimulateResult = z.infer<typeof ruleSimulateResultSchema>;

// ─── 入参 ────────────────────────────────────────────────────────────────────

export const decisionTableListQuery = paginationQuery.extend({
  keyword: z.string().optional().meta({ description: '按名称模糊匹配' }),
  status: z.enum(RULE_DECISION_STATUSES).optional(),
});

export const decisionTableDiffQuery = z.object({
  from: z.coerce.number().int().meta({ description: '对比基线版本号' }),
  to: z.coerce.number().int().default(0).meta({ description: '目标版本号，0=当前编辑态' }),
});

export const decisionTableStatsQuery = z.object({
  days: z.coerce.number().int().min(1).max(365).default(30),
});

export const ruleTestCaseParam = idParam.extend({
  caseId: z.coerce.number().int().positive().meta({ description: '用例 ID', example: 1 }),
});

// ─── 契约 ────────────────────────────────────────────────────────────────────

export const decisionTableContract = defineContract('/api/rules/decision-tables', {
  list: op.get('/', { query: decisionTableListQuery, response: paginated(ruleDecisionTableSchema), summary: '决策表分页列表' }),
  detail: op.get('/{id}', { params: idParam, response: ruleDecisionTableSchema, summary: '决策表详情' }),
  versions: op.get('/{id}/versions', { params: idParam, response: z.array(ruleDecisionTableVersionSchema), summary: '决策表版本列表' }),
  diff: op.get('/{id}/diff', { params: idParam, query: decisionTableDiffQuery, response: ruleVersionDiffSchema, summary: '版本对比（0=当前编辑态）' }),
  rollback: op.post('/{id}/rollback/{version}', { params: ruleVersionParam, response: ruleDecisionTableSchema, summary: '回滚到历史版本' }),
  usages: op.get('/{id}/usages', { params: idParam, response: z.array(ruleUsageItemSchema), summary: '决策表引用分析（where-used）' }),
  stats: op.get('/{id}/stats', { params: idParam, query: decisionTableStatsQuery, response: ruleTableStatsSchema, summary: '命中分析（近 N 天执行流水聚合）' }),
  shadowRun: op.post('/{id}/shadow-run', { params: idParam, body: shadowRunDecisionTableSchema, response: ruleShadowRunResultSchema, summary: '影子对比（重放最近执行输入到编辑态）' }),
  submitReview: op.post('/{id}/submit-review', { params: idParam, response: ruleDecisionTableSchema, summary: '申请发布（审批模式，先过发布门禁）' }),
  review: op.post('/{id}/review', { params: idParam, body: reviewDecisionTableSchema, response: ruleDecisionTableSchema, summary: '审批发布（四眼：批准执行发布 / 驳回记录意见）' }),
  cases: op.get('/{id}/cases', { params: idParam, response: z.array(ruleTestCaseSchema), summary: '测试用例列表' }),
  createCase: op.post('/{id}/cases', { params: idParam, body: createRuleTestCaseSchema, response: ruleTestCaseSchema, summary: '新增测试用例' }),
  runCases: op.post('/{id}/cases/run', { params: idParam, response: ruleTestRunResultSchema, summary: '批量运行用例（覆盖率）' }),
  updateCase: op.put('/{id}/cases/{caseId}', { params: ruleTestCaseParam, body: updateRuleTestCaseSchema, response: ruleTestCaseSchema, summary: '更新测试用例' }),
  removeCase: op.delete('/{id}/cases/{caseId}', { params: ruleTestCaseParam, summary: '删除测试用例' }),
  create: op.post('/', { body: createDecisionTableSchema, response: ruleDecisionTableSchema, summary: '创建决策表' }),
  update: op.put('/{id}', { params: idParam, body: updateDecisionTableSchema, response: ruleDecisionTableSchema, summary: '更新决策表' }),
  publish: op.post('/{id}/publish', { params: idParam, body: publishDecisionTableSchema, response: ruleDecisionTableSchema, summary: '发布决策表（可选灰度：新版本按主体分桶生效，其余流量走上一版本）' }),
  grayAction: op.post('/{id}/gray', { params: idParam, body: grayActionSchema, response: ruleDecisionTableSchema, summary: '灰度操作：complete=转正全量；cancel=放弃（旧版本前滚为新版本）' }),
  simulate: op.post('/{id}/simulate', { params: idParam, body: simulateDecisionTableSchema, response: ruleSimulateResultSchema, summary: '批量仿真（逐行以编辑态求值，汇总命中率与规则行分布）' }),
  toggle: op.post('/{id}/toggle', { params: idParam, body: toggleDecisionTableSchema, response: ruleDecisionTableSchema, summary: '启用/停用决策表' }),
  test: op.post('/{id}/test', { params: idParam, body: evaluateDecisionTableSchema, response: ruleEvaluateResultSchema, summary: '测试求值（编辑态）' }),
  evaluate: op.post('/evaluate', { body: evaluateRuleByKeySchema, response: ruleEvaluateResultSchema, summary: '按 key 求值（对外通用，支持 zat_ API Token 调用）' }),
  removeBatch: op.delete('/batch', { body: batchIdsBody, summary: '批量删除决策表' }),
  remove: op.delete('/{id}', { params: idParam, summary: '删除决策表' }),
}, { tags: ['DecisionTables'] });
