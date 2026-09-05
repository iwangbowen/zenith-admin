import * as z from 'zod';
import { dateRangeBound, paginated, paginationQuery, queryBool } from '../../core/api-schemas';
import { defineContract, op } from '../../core/contract';
import { RULE_EXECUTION_SOURCES, RULE_HIT_POLICIES, RULE_REF_KINDS } from '../constants';

// ─── 实体 ────────────────────────────────────────────────────────────────────

/** 规则执行记录（决策表 / 决策流 / 评分卡 / 名单通用留痕） */
export const ruleExecutionSchema = z.object({
  id: z.int(),
  refKind: z.enum(RULE_REF_KINDS),
  refId: z.int().nullable().meta({ description: '资产行 ID；快照缺失时可为 null' }),
  ruleKey: z.string(),
  version: z.int().nullable().meta({ description: '求值所用的发布版本；名单 / 无版本场景为 null' }),
  caller: z.string().nullable().meta({ description: '调用方标识（如 workflow.gateway / member.coupon / admin.evaluate）' }),
  callerName: z.string().nullable().meta({ description: '调用方展示名：内置调用方为中文名，open.{clientId} 解析为 open.{应用名}' }),
  bizRef: z.string().nullable().meta({ description: '关联上下文（如 workflow:42#gateway_1 / payment:order:ORD1）' }),
  source: z.enum(RULE_EXECUTION_SOURCES),
  matched: z.boolean(),
  hitPolicy: z.enum(RULE_HIT_POLICIES).nullable().meta({ description: '命中策略；仅决策表类记录有值' }),
  input: z.record(z.string(), z.unknown()),
  outputs: z.record(z.string(), z.unknown()),
  matchedRowIds: z.array(z.string()),
  createdAt: z.string(),
}).meta({ id: 'RuleExecution' });

export type RuleExecution = z.infer<typeof ruleExecutionSchema>;

// ─── 入参 ────────────────────────────────────────────────────────────────────

export const ruleExecutionListQuery = paginationQuery.extend({
  refKind: z.enum(RULE_REF_KINDS).optional(),
  refId: z.coerce.number().int().optional(),
  caller: z.string().optional(),
  bizRef: z.string().max(128).optional().meta({ description: '关联上下文前缀匹配（如 workflow:42）' }),
  ruleKey: z.string().optional(),
  source: z.enum(RULE_EXECUTION_SOURCES).optional(),
  matched: queryBool('仅命中 / 仅未命中'),
  dateStart: dateRangeBound('执行时间起'),
  dateEnd: dateRangeBound('执行时间止'),
});

// ─── 契约 ────────────────────────────────────────────────────────────────────

export const ruleExecutionContract = defineContract('/api/rules/executions', {
  list: op.get('/', { query: ruleExecutionListQuery, response: paginated(ruleExecutionSchema), summary: '规则执行记录（全资产 trace/审计，分页）' }),
}, { tags: ['RuleExecutions'] });
