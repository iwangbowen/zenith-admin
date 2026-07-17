import { pgTable, serial, varchar, timestamp, pgEnum, integer, boolean, text, jsonb } from 'drizzle-orm/pg-core';
import { AI_PROVIDER_TYPES } from '@zenith/shared';
import { auditColumns, tenants, users } from './core';

export const aiProviderEnum = pgEnum('ai_provider', AI_PROVIDER_TYPES);

export const aiMessageRoleEnum = pgEnum('ai_message_role', ['system', 'user', 'assistant']);

export const aiFeedbackStatusEnum = pgEnum('ai_feedback_status', ['pending', 'resolved', 'ignored']);

export const aiProviderConfigs = pgTable('ai_provider_configs', {
  id: serial('id').primaryKey(),
  name: varchar('name', { length: 100 }).notNull(),
  provider: aiProviderEnum('provider').notNull().default('openai_compatible'),
  baseUrl: varchar('base_url', { length: 500 }).notNull(),
  apiKey: varchar('api_key', { length: 1000 }).notNull(),
  model: varchar('model', { length: 100 }).notNull(),
  systemPrompt: text('system_prompt'),
  maxTokens: integer('max_tokens').notNull().default(4096),
  temperature: varchar('temperature', { length: 10 }).notNull().default('0.7'),
  /** 输入单价（分 / 百万 token），null = 未配置不计成本 */
  priceInputPerM: integer('price_input_per_m'),
  /** 输出单价（分 / 百万 token），null = 未配置不计成本 */
  priceOutputPerM: integer('price_output_per_m'),
  isDefault: boolean('is_default').notNull().default(false),
  isEnabled: boolean('is_enabled').notNull().default(true),
  ...auditColumns(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().$onUpdate(() => new Date()).notNull(),
});

export type AiProviderConfigRow = typeof aiProviderConfigs.$inferSelect;

export type NewAiProviderConfig = typeof aiProviderConfigs.$inferInsert;

export const aiConversations = pgTable('ai_conversations', {
  id: serial('id').primaryKey(),
  userId: integer('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  tenantId: integer('tenant_id').references(() => tenants.id, { onDelete: 'cascade' }),
  title: varchar('title', { length: 200 }).notNull().default('新对话'),
  providerSnapshot: jsonb('provider_snapshot').$type<{ provider: string; model: string; configId?: number }>(),
  isArchived: boolean('is_archived').notNull().default(false),
  isPinned: boolean('is_pinned').notNull().default(false),
  systemPromptOverride: text('system_prompt_override'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().$onUpdate(() => new Date()).notNull(),
});

export type AiConversationRow = typeof aiConversations.$inferSelect;

export type NewAiConversation = typeof aiConversations.$inferInsert;

export const aiMessages = pgTable('ai_messages', {
  id: serial('id').primaryKey(),
  conversationId: integer('conversation_id').notNull().references(() => aiConversations.id, { onDelete: 'cascade' }),
  role: aiMessageRoleEnum('role').notNull(),
  content: text('content').notNull(),
  /** 推理模型的思维链内容（reasoning_content，user 消息为 null） */
  reasoning: text('reasoning'),
  /** 该条 assistant 消息生成时所用的模型（user 消息为 null） */
  model: varchar('model', { length: 100 }),
  tokensInput: integer('tokens_input').notNull().default(0),
  tokensOutput: integer('tokens_output').notNull().default(0),
  /** 首字延迟（毫秒，assistant 消息） */
  ttftMs: integer('ttft_ms'),
  /** 本次生成总耗时（毫秒，assistant 消息） */
  durationMs: integer('duration_ms'),
  /** 用户反馈：1 = 👍 点赞，-1 = 👎 点踩，null = 未反馈 */
  feedback: integer('feedback'),
  /** 点踩原因（如 不准确/不相关/有害/其他） */
  feedbackReason: varchar('feedback_reason', { length: 200 }),
  /** 反馈处理状态：pending 待处理 / resolved 已处理 / ignored 已忽略 */
  feedbackStatus: aiFeedbackStatusEnum('feedback_status'),
  /** 管理员处理备注 */
  feedbackRemark: varchar('feedback_remark', { length: 500 }),
  /** 反馈处理时间 */
  feedbackHandledAt: timestamp('feedback_handled_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export type AiMessageRow = typeof aiMessages.$inferSelect;

export type NewAiMessage = typeof aiMessages.$inferInsert;

export const userAiConfigs = pgTable('user_ai_configs', {
  id: serial('id').primaryKey(),
  userId: integer('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  name: varchar('name', { length: 100 }),
  provider: aiProviderEnum('provider').notNull().default('openai_compatible'),
  baseUrl: varchar('base_url', { length: 500 }),
  apiKey: varchar('api_key', { length: 1000 }),
  model: varchar('model', { length: 100 }),
  temperature: varchar('temperature', { length: 10 }),
  maxTokens: integer('max_tokens'),
  systemPrompt: text('system_prompt'),
  isEnabled: boolean('is_enabled').notNull().default(true),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().$onUpdate(() => new Date()).notNull(),
});

export type UserAiConfigRow = typeof userAiConfigs.$inferSelect;

export type NewUserAiConfig = typeof userAiConfigs.$inferInsert;

export const aiPromptScopeEnum = pgEnum('ai_prompt_scope', ['system', 'user']);

export const aiPromptTemplates = pgTable('ai_prompt_templates', {
  id: serial('id').primaryKey(),
  name: varchar('name', { length: 100 }).notNull(),
  content: text('content').notNull(),
  description: varchar('description', { length: 300 }),
  category: varchar('category', { length: 50 }),
  scope: aiPromptScopeEnum('scope').notNull().default('system'),
  userId: integer('user_id').references(() => users.id, { onDelete: 'cascade' }),
  isBuiltin: boolean('is_builtin').notNull().default(false),
  sort: integer('sort').notNull().default(0),
  /** 被应用为对话角色的累计次数 */
  usageCount: integer('usage_count').notNull().default(0),
  isEnabled: boolean('is_enabled').notNull().default(true),
  ...auditColumns(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().$onUpdate(() => new Date()).notNull(),
});

export type AiPromptTemplateRow = typeof aiPromptTemplates.$inferSelect;

export type NewAiPromptTemplate = typeof aiPromptTemplates.$inferInsert;
