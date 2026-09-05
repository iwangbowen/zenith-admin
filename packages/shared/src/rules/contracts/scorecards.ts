import * as z from 'zod';
import { idParam, paginated, paginationQuery } from '../../core/api-schemas';
import { defineContract, op } from '../../core/contract';
import { RULE_DECISION_STATUSES } from '../constants';
import {
  createRuleScorecardSchema,
  evaluateRuleScorecardByKeySchema,
  evaluateRuleScorecardSchema,
  ruleScorecardBandSchema,
  ruleScorecardGradeSchema,
  ruleScorecardVariableSchema,
  toggleDecisionTableSchema,
  updateRuleScorecardSchema,
} from '../validation';
import { ruleAssetVersionSchema, ruleVersionParam } from './common';

// ─── 实体 ────────────────────────────────────────────────────────────────────

export type RuleScorecardBand = z.infer<typeof ruleScorecardBandSchema>;

export type RuleScorecardVariable = z.infer<typeof ruleScorecardVariableSchema>;

/** 等级映射：按 minScore 从高到低取首个 totalScore >= minScore 的档位 */
export type RuleScorecardGrade = z.infer<typeof ruleScorecardGradeSchema>;

export const ruleScorecardSchema = z.object({
  id: z.int(),
  key: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  status: z.enum(RULE_DECISION_STATUSES),
  baseScore: z.number().meta({ description: '基础分：所有变量得分之外的起始分' }),
  variables: z.array(ruleScorecardVariableSchema),
  grades: z.array(ruleScorecardGradeSchema),
  version: z.int(),
  publishedAt: z.string().nullable(),
  dirty: z.boolean().optional().meta({ description: '编辑态与最新发布快照不一致（有未发布修改）' }),
  createdAt: z.string(),
  updatedAt: z.string(),
}).meta({ id: 'RuleScorecard' });

export type RuleScorecard = z.infer<typeof ruleScorecardSchema>;

export const ruleScorecardVariableTraceSchema = z.object({
  key: z.string(),
  label: z.string(),
  raw: z.unknown(),
  matchedBand: z.string().nullable().meta({ description: '命中的分段说明；未命中为 null（走 missingScore）' }),
  score: z.number(),
  weight: z.number(),
  weighted: z.number(),
  missed: z.boolean(),
}).meta({ id: 'RuleScorecardVariableTrace' });

export type RuleScorecardVariableTrace = z.infer<typeof ruleScorecardVariableTraceSchema>;

export const ruleScorecardEvaluateResultSchema = z.object({
  totalScore: z.number(),
  baseScore: z.number(),
  grade: z.string().nullable(),
  decision: z.string().nullable(),
  variables: z.array(ruleScorecardVariableTraceSchema),
}).meta({ id: 'RuleScorecardEvaluateResult' });

export type RuleScorecardEvaluateResult = z.infer<typeof ruleScorecardEvaluateResultSchema>;

// ─── 入参 ────────────────────────────────────────────────────────────────────

export const ruleScorecardListQuery = paginationQuery.extend({
  keyword: z.string().optional().meta({ description: '按名称模糊匹配' }),
  status: z.enum(RULE_DECISION_STATUSES).optional(),
});

// ─── 契约 ────────────────────────────────────────────────────────────────────

export const ruleScorecardContract = defineContract('/api/rules/scorecards', {
  list: op.get('/', { query: ruleScorecardListQuery, response: paginated(ruleScorecardSchema), summary: '评分卡分页列表' }),
  evaluateByKey: op.post('/evaluate-by-key', { body: evaluateRuleScorecardByKeySchema, response: ruleScorecardEvaluateResultSchema, summary: '运行时求值（按 key 取发布快照）' }),
  create: op.post('/', { body: createRuleScorecardSchema, response: ruleScorecardSchema, summary: '创建评分卡' }),
  versions: op.get('/{id}/versions', { params: idParam, response: z.array(ruleAssetVersionSchema), summary: '评分卡版本历史' }),
  rollback: op.post('/{id}/rollback/{version}', { params: ruleVersionParam, response: ruleScorecardSchema, summary: '回滚到历史版本（覆盖编辑态，置为草稿）' }),
  detail: op.get('/{id}', { params: idParam, response: ruleScorecardSchema, summary: '评分卡详情' }),
  update: op.put('/{id}', { params: idParam, body: updateRuleScorecardSchema, response: ruleScorecardSchema, summary: '更新评分卡' }),
  remove: op.delete('/{id}', { params: idParam, summary: '删除评分卡' }),
  publish: op.post('/{id}/publish', { params: idParam, response: ruleScorecardSchema, summary: '发布评分卡（固化快照，版本 +1）' }),
  toggle: op.post('/{id}/toggle', { params: idParam, body: toggleDecisionTableSchema, response: ruleScorecardSchema, summary: '启用/停用评分卡' }),
  evaluate: op.post('/{id}/evaluate', { params: idParam, body: evaluateRuleScorecardSchema, response: ruleScorecardEvaluateResultSchema, summary: '测试求值（按编辑态草稿）' }),
}, { tags: ['RuleScorecards'] });
