import { pgTable, serial, varchar, timestamp, pgEnum, integer, boolean, unique, text, index, jsonb } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { auditColumns, tenants, users } from './core';
import { workflowCategories, workflowDefinitionStatusEnum } from './workflow';

// ─── 规则中心：决策表 ────────────────────────────────────────────────────────────
// 命中策略：first=首行命中即返回；unique=必须唯一命中；priority=按优先级取最高；
// collect=收集全部命中；any=允许多命中但输出需一致
export const ruleHitPolicyEnum = pgEnum('rule_hit_policy', ['first', 'unique', 'priority', 'collect', 'any']);

// 决策表定义：独立规则中心实体，工作流网关/会员等级/优惠券等可调用求值
export const ruleDecisionTables = pgTable('rule_decision_tables', {
  id: serial('id').primaryKey(),
  key: varchar('key', { length: 64 }).notNull(),
  name: varchar('name', { length: 64 }).notNull(),
  description: text('description'),
  categoryId: integer('category_id').references(() => workflowCategories.id, { onDelete: 'set null' }),
  status: workflowDefinitionStatusEnum('status').default('draft').notNull(),
  hitPolicy: ruleHitPolicyEnum('hit_policy').default('first').notNull(),
  inputs: jsonb('inputs').notNull().default(sql`'[]'::jsonb`),   // RuleDecisionInput[]
  outputs: jsonb('outputs').notNull().default(sql`'[]'::jsonb`), // RuleDecisionOutput[]
  rules: jsonb('rules').notNull().default(sql`'[]'::jsonb`),     // RuleDecisionRow[]
  version: integer('version').default(1).notNull(),
  publishedAt: timestamp('published_at', { withTimezone: true }),
  tenantId: integer('tenant_id').references(() => tenants.id, { onDelete: 'cascade' }),
  ...auditColumns(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().$onUpdate(() => new Date()).notNull(),
}, (t) => [unique('rule_decision_tables_key_uniq').on(t.tenantId, t.key)]);

export type RuleDecisionTableRow = typeof ruleDecisionTables.$inferSelect;

export type NewRuleDecisionTable = typeof ruleDecisionTables.$inferInsert;

// 决策表版本快照（发布时写入一行，调用方按版本绑定，防运行中漂移）
export const ruleDecisionTableVersions = pgTable('rule_decision_table_versions', {
  id: serial('id').primaryKey(),
  tableId: integer('table_id').notNull().references(() => ruleDecisionTables.id, { onDelete: 'cascade' }),
  version: integer('version').notNull(),
  name: varchar('name', { length: 64 }).notNull(),
  description: text('description'),
  hitPolicy: ruleHitPolicyEnum('hit_policy').default('first').notNull(),
  inputs: jsonb('inputs').notNull().default(sql`'[]'::jsonb`),
  outputs: jsonb('outputs').notNull().default(sql`'[]'::jsonb`),
  rules: jsonb('rules').notNull().default(sql`'[]'::jsonb`),
  publishedAt: timestamp('published_at', { withTimezone: true }).defaultNow().notNull(),
  publishedBy: integer('published_by').references(() => users.id, { onDelete: 'set null' }),
  tenantId: integer('tenant_id').references(() => tenants.id, { onDelete: 'cascade' }),
}, (t) => [unique('rule_decision_table_versions_uniq').on(t.tableId, t.version)]);

export type RuleDecisionTableVersionRow = typeof ruleDecisionTableVersions.$inferSelect;

export type NewRuleDecisionTableVersion = typeof ruleDecisionTableVersions.$inferInsert;

// 决策表测试用例（输入快照→期望输出），用于回归测试矩阵与发布门禁
export const ruleTestCases = pgTable('rule_test_cases', {
  id: serial('id').primaryKey(),
  tableId: integer('table_id').notNull().references(() => ruleDecisionTables.id, { onDelete: 'cascade' }),
  name: varchar('name', { length: 64 }).notNull(),
  input: jsonb('input').notNull().default(sql`'{}'::jsonb`),
  expected: jsonb('expected').notNull().default(sql`'{}'::jsonb`),
  tenantId: integer('tenant_id').references(() => tenants.id, { onDelete: 'cascade' }),
  ...auditColumns(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().$onUpdate(() => new Date()).notNull(),
}, (t) => [unique('rule_test_cases_name_uniq').on(t.tableId, t.name)]);

export type RuleTestCaseRow = typeof ruleTestCases.$inferSelect;

export type NewRuleTestCase = typeof ruleTestCases.$inferInsert;

// 决策表执行记录（运行时/测试/手动求值，append-only），用于实例 trace 与规则审计
export const ruleDecisionExecutions = pgTable('rule_decision_executions', {
  id: serial('id').primaryKey(),
  ruleKey: varchar('rule_key', { length: 64 }).notNull(),
  tableId: integer('table_id'),
  instanceId: integer('instance_id'),
  nodeKey: varchar('node_key', { length: 64 }),
  source: varchar('source', { length: 16 }).notNull().default('runtime'),
  matched: boolean('matched').notNull().default(false),
  hitPolicy: ruleHitPolicyEnum('hit_policy').default('first').notNull(),
  input: jsonb('input').notNull().default(sql`'{}'::jsonb`),
  outputs: jsonb('outputs').notNull().default(sql`'{}'::jsonb`),
  matchedRowIds: jsonb('matched_row_ids').notNull().default(sql`'[]'::jsonb`),
  createdBy: integer('created_by').references(() => users.id, { onDelete: 'set null' }),
  tenantId: integer('tenant_id').references(() => tenants.id, { onDelete: 'cascade' }),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (t) => [index('rule_exec_instance_idx').on(t.instanceId), index('rule_exec_table_idx').on(t.tableId)]);

export type RuleDecisionExecutionRow = typeof ruleDecisionExecutions.$inferSelect;

export type NewRuleDecisionExecution = typeof ruleDecisionExecutions.$inferInsert;
