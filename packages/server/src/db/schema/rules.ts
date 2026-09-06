import { pgTable, varchar, timestamp, pgEnum, integer, boolean, unique, text, index, jsonb } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { auditColumns, tenants, users } from './core';
import { statusEnum, timestampColumns } from './common';
import { workflowCategories, workflowDefinitionStatusEnum } from './workflow';

// ─── 规则中心：决策表 ────────────────────────────────────────────────────────────
// 命中策略：first=首行命中即返回；unique=必须唯一命中；priority=按优先级取最高；
// collect=收集全部命中；any=允许多命中但输出需一致
export const ruleHitPolicyEnum = pgEnum('rule_hit_policy', ['first', 'unique', 'priority', 'collect', 'any']);

// 决策表定义：独立规则中心实体，工作流网关/会员等级/优惠券等可调用求值
export const ruleDecisionTables = pgTable('rule_decision_tables', {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  key: varchar({ length: 64 }).notNull(),
  name: varchar({ length: 64 }).notNull(),
  description: text(),
  categoryId: integer().references(() => workflowCategories.id, { onDelete: 'set null' }),
  status: workflowDefinitionStatusEnum().default('draft').notNull(),
  hitPolicy: ruleHitPolicyEnum().default('first').notNull(),
  inputs: jsonb().notNull().default(sql`'[]'::jsonb`),   // RuleDecisionInput[]
  outputs: jsonb().notNull().default(sql`'[]'::jsonb`), // RuleDecisionOutput[]
  rules: jsonb().notNull().default(sql`'[]'::jsonb`),     // RuleDecisionRow[]
  settings: jsonb().notNull().default(sql`'{}'::jsonb`), // RuleDecisionTableSettings
  version: integer().default(1).notNull(),
  publishedAt: timestamp({ withTimezone: true }),
  // 灰度发布：grayPercent 非空即灰度中——新版本(grayVersion)按主体哈希分桶生效，其余流量走上一版本
  grayPercent: integer(),
  grayDimension: varchar({ length: 200 }),
  grayVersion: integer(),
  // 发布审批（四眼）：pending=待审批；批准/驳回后清空
  reviewStatus: varchar({ length: 16 }),
  reviewRequestedBy: integer().references(() => users.id, { onDelete: 'set null' }),
  reviewRequestedAt: timestamp({ withTimezone: true }),
  reviewComment: varchar({ length: 255 }),
  tenantId: integer().references(() => tenants.id, { onDelete: 'cascade' }),
  ...auditColumns(),
  ...timestampColumns(),
}, (t) => [unique('rule_decision_tables_key_uniq').on(t.tenantId, t.key)]);

export type RuleDecisionTableRow = typeof ruleDecisionTables.$inferSelect;

export type NewRuleDecisionTable = typeof ruleDecisionTables.$inferInsert;

// 决策表版本快照（发布时写入一行，调用方按版本绑定，防运行中漂移）
export const ruleDecisionTableVersions = pgTable('rule_decision_table_versions', {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  tableId: integer().notNull().references(() => ruleDecisionTables.id, { onDelete: 'cascade' }),
  version: integer().notNull(),
  name: varchar({ length: 64 }).notNull(),
  description: text(),
  hitPolicy: ruleHitPolicyEnum().default('first').notNull(),
  inputs: jsonb().notNull().default(sql`'[]'::jsonb`),
  outputs: jsonb().notNull().default(sql`'[]'::jsonb`),
  rules: jsonb().notNull().default(sql`'[]'::jsonb`),
  settings: jsonb().notNull().default(sql`'{}'::jsonb`),
  publishedAt: timestamp({ withTimezone: true }).defaultNow().notNull(),
  publishedBy: integer().references(() => users.id, { onDelete: 'set null' }),
  tenantId: integer().references(() => tenants.id, { onDelete: 'cascade' }),
}, (t) => [index('rule_decision_table_versions_tenant_idx').on(t.tenantId), unique('rule_decision_table_versions_uniq').on(t.tableId, t.version)]);

export type RuleDecisionTableVersionRow = typeof ruleDecisionTableVersions.$inferSelect;

export type NewRuleDecisionTableVersion = typeof ruleDecisionTableVersions.$inferInsert;

// 决策表测试用例（输入快照→期望输出），用于回归测试矩阵与发布门禁
export const ruleTestCases = pgTable('rule_test_cases', {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  tableId: integer().notNull().references(() => ruleDecisionTables.id, { onDelete: 'cascade' }),
  name: varchar({ length: 64 }).notNull(),
  input: jsonb().notNull().default(sql`'{}'::jsonb`),
  expected: jsonb().notNull().default(sql`'{}'::jsonb`),
  tenantId: integer().references(() => tenants.id, { onDelete: 'cascade' }),
  ...auditColumns(),
  ...timestampColumns(),
}, (t) => [index('rule_test_cases_tenant_idx').on(t.tenantId), unique('rule_test_cases_name_uniq').on(t.tableId, t.name)]);

export type RuleTestCaseRow = typeof ruleTestCases.$inferSelect;

export type NewRuleTestCase = typeof ruleTestCases.$inferInsert;

// 规则执行记录（全资产通用，append-only）：决策表 / 决策流 / 评分卡 / 名单命中统一留痕，
// 供 trace、审计与「谁在调哪条规则」的消费方分析
export const ruleExecutions = pgTable('rule_executions', {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  refKind: varchar({ length: 16 }).notNull(), // RuleRefKind: table | flow | scorecard | list
  refId: integer(),
  ruleKey: varchar({ length: 64 }).notNull(),
  version: integer(),                             // 求值所用发布版本（名单为 null）
  caller: varchar({ length: 64 }),               // 调用方标识（如 workflow.gateway）
  bizRef: varchar({ length: 128 }),             // 关联上下文，调用方自定语义（如 workflow:42#gateway_1 / payment:order:ORD1）
  source: varchar({ length: 16 }).notNull().default('runtime'), // RuleExecutionSource
  matched: boolean().notNull().default(false),
  hitPolicy: ruleHitPolicyEnum(),              // 仅决策表类记录有值
  input: jsonb().notNull().default(sql`'{}'::jsonb`),
  outputs: jsonb().notNull().default(sql`'{}'::jsonb`),
  matchedRowIds: jsonb().notNull().default(sql`'[]'::jsonb`),
  createdBy: integer().references(() => users.id, { onDelete: 'set null' }),
  tenantId: integer().references(() => tenants.id, { onDelete: 'cascade' }),
  createdAt: timestamp().defaultNow().notNull(),
}, (t) => [
  index('rule_executions_tenant_idx').on(t.tenantId),
  index('rule_executions_ref_idx').on(t.refKind, t.refId),
  index('rule_executions_caller_idx').on(t.caller),
  index('rule_executions_biz_ref_idx').on(t.bizRef),
]);

export type RuleExecutionRow = typeof ruleExecutions.$inferSelect;

export type NewRuleExecution = typeof ruleExecutions.$inferInsert;

// 规则资产版本快照（决策流 / 评分卡通用；决策表沿用专表 rule_decision_table_versions）：
// 发布时写入一行，支持版本历史查看与回滚编辑态
export const ruleAssetVersions = pgTable('rule_asset_versions', {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  refKind: varchar({ length: 16 }).notNull(), // flow | scorecard
  refId: integer().notNull(),
  version: integer().notNull(),
  snapshot: jsonb().notNull().default(sql`'{}'::jsonb`),
  publishedBy: integer().references(() => users.id, { onDelete: 'set null' }),
  publishedAt: timestamp({ withTimezone: true }).defaultNow().notNull(),
  tenantId: integer().references(() => tenants.id, { onDelete: 'cascade' }),
}, (t) => [
  index('rule_asset_versions_tenant_idx').on(t.tenantId),
  unique('rule_asset_versions_uniq').on(t.refKind, t.refId, t.version),
]);

export type RuleAssetVersionRow = typeof ruleAssetVersions.$inferSelect;

export type NewRuleAssetVersion = typeof ruleAssetVersions.$inferInsert;

// ─── 决策流：多决策表顺序编排（DRD 简化版），步骤输出并入 scope 供后续步骤引用 ────
export const ruleDecisionFlows = pgTable('rule_decision_flows', {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  key: varchar({ length: 64 }).notNull(),
  name: varchar({ length: 64 }).notNull(),
  description: text(),
  status: workflowDefinitionStatusEnum().default('draft').notNull(),
  steps: jsonb().notNull().default(sql`'[]'::jsonb`),          // RuleFlowStep[]（编辑态）
  publishedSteps: jsonb(),                            // RuleFlowStep[]（发布快照，运行时执行）
  version: integer().default(1).notNull(),
  publishedAt: timestamp({ withTimezone: true }),
  tenantId: integer().references(() => tenants.id, { onDelete: 'cascade' }),
  ...auditColumns(),
  ...timestampColumns(),
}, (t) => [unique('rule_decision_flows_key_uniq').on(t.tenantId, t.key)]);

export type RuleDecisionFlowRow = typeof ruleDecisionFlows.$inferSelect;

export type NewRuleDecisionFlow = typeof ruleDecisionFlows.$inferInsert;

// ─── 名单库：黑/白/灰名单 + 条目（支持过期时间），供风控/资格判定使用 ─────────────
export const ruleLists = pgTable('rule_lists', {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  key: varchar({ length: 64 }).notNull(),
  name: varchar({ length: 64 }).notNull(),
  type: varchar({ length: 8 }).notNull().default('black'), // black | white | grey
  description: text(),
  status: statusEnum().notNull().default('enabled'),
  tenantId: integer().references(() => tenants.id, { onDelete: 'cascade' }),
  ...auditColumns(),
  ...timestampColumns(),
}, (t) => [unique('rule_lists_key_uniq').on(t.tenantId, t.key)]);

export type RuleListRow = typeof ruleLists.$inferSelect;

export type NewRuleList = typeof ruleLists.$inferInsert;

export const ruleListItems = pgTable('rule_list_items', {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  listId: integer().notNull().references(() => ruleLists.id, { onDelete: 'cascade' }),
  value: varchar({ length: 128 }).notNull(),
  label: varchar({ length: 64 }),
  matchMode: varchar({ length: 8 }).notNull().default('exact'), // exact | prefix | regex
  expiresAt: timestamp({ withTimezone: true }),
  remark: varchar({ length: 255 }),
  createdBy: integer().references(() => users.id, { onDelete: 'set null' }),
  createdAt: timestamp().defaultNow().notNull(),
}, (t) => [unique('rule_list_items_value_uniq').on(t.listId, t.value), index('rule_list_items_list_idx').on(t.listId)]);

export type RuleListItemRow = typeof ruleListItems.$inferSelect;

export type NewRuleListItem = typeof ruleListItems.$inferInsert;

// ─── 评分卡：变量分段打分 × 权重 + 基础分 → 总分 → 等级/决策映射 ─────────────────
// 发布采用单快照（publishedSnapshot）：运行时按快照执行，编辑态不影响线上；
// 结构较决策表简单，不建独立版本表，version 号随每次发布 +1。
export const ruleScorecards = pgTable('rule_scorecards', {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  key: varchar({ length: 64 }).notNull(),
  name: varchar({ length: 64 }).notNull(),
  description: text(),
  status: workflowDefinitionStatusEnum().default('draft').notNull(),
  baseScore: integer().default(0).notNull(),
  variables: jsonb().notNull().default(sql`'[]'::jsonb`), // RuleScorecardVariable[]
  grades: jsonb().notNull().default(sql`'[]'::jsonb`),       // RuleScorecardGrade[]
  publishedSnapshot: jsonb(),                    // { baseScore, variables, grades }
  version: integer().default(1).notNull(),
  publishedAt: timestamp({ withTimezone: true }),
  tenantId: integer().references(() => tenants.id, { onDelete: 'cascade' }),
  ...auditColumns(),
  ...timestampColumns(),
}, (t) => [unique('rule_scorecards_key_uniq').on(t.tenantId, t.key)]);

export type RuleScorecardRow = typeof ruleScorecards.$inferSelect;

export type NewRuleScorecard = typeof ruleScorecards.$inferInsert;
