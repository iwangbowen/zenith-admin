import { pgTable, serial, varchar, timestamp, pgEnum, integer, boolean, text, jsonb, real, uniqueIndex } from 'drizzle-orm/pg-core';
import { AI_PROVIDER_TYPES } from '@zenith/shared';
import { auditColumns, tenants, users } from './core';

export const aiProviderEnum = pgEnum('ai_provider', AI_PROVIDER_TYPES);

export const aiMessageRoleEnum = pgEnum('ai_message_role', ['system', 'user', 'assistant']);

export const aiFeedbackStatusEnum = pgEnum('ai_feedback_status', ['pending', 'resolved', 'ignored']);

/** 模型能力标签（vision=图片理解 / tools=函数调用 / contextWindow=上下文长度） */
export interface AiModelCapabilities {
  vision?: boolean;
  tools?: boolean;
  contextWindow?: number;
}

export const aiProviderConfigs = pgTable('ai_provider_configs', {
  id: serial('id').primaryKey(),
  name: varchar('name', { length: 100 }).notNull(),
  provider: aiProviderEnum('provider').notNull().default('openai_compatible'),
  baseUrl: varchar('base_url', { length: 500 }).notNull(),
  apiKey: varchar('api_key', { length: 1000 }).notNull(),
  model: varchar('model', { length: 100 }).notNull(),
  /** 附加可选模型列表（同一服务商多模型，聊天时可切换） */
  models: text('models').array(),
  /** 模型能力标签 */
  capabilities: jsonb('capabilities').$type<AiModelCapabilities>(),
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
  /** 挂载的知识库 ID（软引用，删除知识库时置空） */
  knowledgeBaseId: integer('knowledge_base_id'),
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

/** 用户级 AI 个性化指令（Custom Instructions） */
export const aiUserPreferences = pgTable('ai_user_preferences', {
  id: serial('id').primaryKey(),
  userId: integer('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  /** 关于我：背景、身份、偏好等 */
  aboutMe: text('about_me'),
  /** 回答风格要求 */
  replyStyle: text('reply_style'),
  isEnabled: boolean('is_enabled').notNull().default(true),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().$onUpdate(() => new Date()).notNull(),
}, (t) => [uniqueIndex('ai_user_preferences_user_id_uq').on(t.userId)]);

export type AiUserPreferenceRow = typeof aiUserPreferences.$inferSelect;

/** 对话分享链接 */
export const aiSharedConversations = pgTable('ai_shared_conversations', {
  id: serial('id').primaryKey(),
  token: varchar('token', { length: 64 }).notNull(),
  conversationId: integer('conversation_id').notNull().references(() => aiConversations.id, { onDelete: 'cascade' }),
  userId: integer('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  /** 过期时间，null = 永久有效 */
  expiresAt: timestamp('expires_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (t) => [uniqueIndex('ai_shared_conversations_token_uq').on(t.token)]);

export type AiSharedConversationRow = typeof aiSharedConversations.$inferSelect;

/** 多模型对比（Arena）投票记录 */
export const aiArenaVotes = pgTable('ai_arena_votes', {
  id: serial('id').primaryKey(),
  userId: integer('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  question: text('question').notNull(),
  modelA: varchar('model_a', { length: 100 }).notNull(),
  modelB: varchar('model_b', { length: 100 }).notNull(),
  /** a / b / tie */
  winner: varchar('winner', { length: 10 }).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

/** 知识库 */
export const aiKnowledgeBases = pgTable('ai_knowledge_bases', {
  id: serial('id').primaryKey(),
  name: varchar('name', { length: 100 }).notNull(),
  description: varchar('description', { length: 300 }),
  userId: integer('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  /** 向量化所用 embedding 模型快照（空 = 未向量化，走关键词检索） */
  embeddingModel: varchar('embedding_model', { length: 100 }),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().$onUpdate(() => new Date()).notNull(),
});

export type AiKnowledgeBaseRow = typeof aiKnowledgeBases.$inferSelect;

/** 知识库文档 */
export const aiKbDocuments = pgTable('ai_kb_documents', {
  id: serial('id').primaryKey(),
  kbId: integer('kb_id').notNull().references(() => aiKnowledgeBases.id, { onDelete: 'cascade' }),
  name: varchar('name', { length: 200 }).notNull(),
  /** ready / processing / failed */
  status: varchar('status', { length: 20 }).notNull().default('ready'),
  chunkCount: integer('chunk_count').notNull().default(0),
  charCount: integer('char_count').notNull().default(0),
  error: varchar('error', { length: 500 }),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export type AiKbDocumentRow = typeof aiKbDocuments.$inferSelect;

/** 知识库分块（embedding 为空时该分块走关键词检索） */
export const aiKbChunks = pgTable('ai_kb_chunks', {
  id: serial('id').primaryKey(),
  kbId: integer('kb_id').notNull().references(() => aiKnowledgeBases.id, { onDelete: 'cascade' }),
  docId: integer('doc_id').notNull().references(() => aiKbDocuments.id, { onDelete: 'cascade' }),
  content: text('content').notNull(),
  embedding: real('embedding').array(),
  tokenCount: integer('token_count').notNull().default(0),
});

export type AiKbChunkRow = typeof aiKbChunks.$inferSelect;
