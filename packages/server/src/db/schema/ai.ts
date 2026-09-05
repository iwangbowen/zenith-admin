import { pgTable, varchar, timestamp, pgEnum, integer, boolean, text, jsonb, uniqueIndex, index } from 'drizzle-orm/pg-core';
import type { AiModelSettings, AiModelFallbackRef, AiUserSettingsPatch } from '@zenith/shared/ai';
import { auditColumns, tenants, users } from './core';

export const aiMessageRoleEnum = pgEnum('ai_message_role', ['system', 'user', 'assistant']);

export const aiFeedbackStatusEnum = pgEnum('ai_feedback_status', ['pending', 'resolved', 'ignored']);

/** 模型能力标签（vision=图片理解 / tools=函数调用 / contextWindow=上下文长度） */
export interface AiModelCapabilities {
  vision?: boolean;
  tools?: boolean;
  contextWindow?: number;
}

export const aiProviderConfigs = pgTable('ai_provider_configs', {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  name: varchar({ length: 100 }).notNull(),
  /** Mastra 模型目录 provider ID（'openai' / 'anthropic' / ...）或 'custom'（OpenAI 兼容自定义端点） */
  providerId: varchar({ length: 50 }).notNull(),
  /** API 地址：custom 必填；目录服务商留空走官方端点，填写则覆盖 */
  baseUrl: varchar({ length: 500 }),
  apiKey: varchar({ length: 1000 }).notNull(),
  /** 自定义请求头（组织 ID 等，随请求透传） */
  headers: jsonb().$type<Record<string, string>>(),
  /** 启用的模型列表（裸模型 ID，聊天时可切换） */
  models: text().array().notNull(),
  /** 默认模型（必须包含在 models 中） */
  defaultModel: varchar({ length: 100 }).notNull(),
  /** 模型调用默认设置（temperature / maxOutputTokens / reasoning 等，Mastra ModelSettings 子集） */
  modelSettings: jsonb().$type<AiModelSettings>(),
  /** 服务商特定选项（按 provider 分组透传，如 { openai: { reasoningEffort: 'low' } }） */
  providerOptions: jsonb().$type<Record<string, Record<string, unknown>>>(),
  /** 多级降级链：主模型失败（5xx/限流/超时）后按序切换（Mastra ModelWithRetries 持久化形态） */
  fallbacks: jsonb().$type<AiModelFallbackRef[]>(),
  /** 模型能力标签 */
  capabilities: jsonb().$type<AiModelCapabilities>(),
  /** 输入单价（分 / 百万 token），null = 未配置不计成本 */
  priceInputPerM: integer(),
  /** 输出单价（分 / 百万 token），null = 未配置不计成本 */
  priceOutputPerM: integer(),
  isDefault: boolean().notNull().default(false),
  isEnabled: boolean().notNull().default(true),
  /** 并发流上限（null / 0 = 不限制），超限排队等待 */
  maxConcurrent: integer(),
  ...auditColumns(),
  createdAt: timestamp().defaultNow().notNull(),
  updatedAt: timestamp().defaultNow().$onUpdate(() => new Date()).notNull(),
});

export type AiProviderConfigRow = typeof aiProviderConfigs.$inferSelect;

export type NewAiProviderConfig = typeof aiProviderConfigs.$inferInsert;

export const aiConversations = pgTable('ai_conversations', {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  userId: integer().notNull().references(() => users.id, { onDelete: 'cascade' }),
  tenantId: integer().references(() => tenants.id, { onDelete: 'cascade' }),
  title: varchar({ length: 200 }).notNull().default('新对话'),
  providerSnapshot: jsonb().$type<{ providerId: string; model: string; configId?: number }>(),
  isArchived: boolean().notNull().default(false),
  isPinned: boolean().notNull().default(false),
  systemPromptOverride: text(),
  /** 挂载的知识库 ID（软引用，删除知识库时置空） */
  knowledgeBaseId: integer(),
  /** 关联的智能体 ID（软引用，删除智能体后对话保留） */
  agentId: integer(),
  /** 用户自定义标签 */
  tags: text().array(),
  /** 分支树当前激活叶子消息 ID（null = 线性对话取最新） */
  activeLeafMsgId: integer(),
  createdAt: timestamp().defaultNow().notNull(),
  updatedAt: timestamp().defaultNow().$onUpdate(() => new Date()).notNull(),
}, (t) => [index('ai_conversations_user_idx').on(t.userId), index('ai_conversations_tenant_idx').on(t.tenantId)]);

export type AiConversationRow = typeof aiConversations.$inferSelect;

export type NewAiConversation = typeof aiConversations.$inferInsert;

/** 调用链 trace 步骤（检索 / 工具执行 / LLM 轮次） */
export interface AiTraceStep {
  type: 'retrieval' | 'tool_call' | 'llm_round' | 'failover';
  label: string;
  durationMs: number;
  meta?: Record<string, unknown>;
}

export const aiMessages = pgTable('ai_messages', {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  conversationId: integer().notNull().references(() => aiConversations.id, { onDelete: 'cascade' }),
  /** 分支树父消息 ID（null = 根消息；同 parent 的多条同角色消息互为兄弟分支） */
  parentId: integer(),
  role: aiMessageRoleEnum().notNull(),
  content: text().notNull(),
  /** 推理模型的思维链内容（reasoning_content，user 消息为 null） */
  reasoning: text(),
  /** 该条 assistant 消息生成时所用的模型（user 消息为 null） */
  model: varchar({ length: 100 }),
  tokensInput: integer().notNull().default(0),
  tokensOutput: integer().notNull().default(0),
  /** 首字延迟（毫秒，assistant 消息） */
  ttftMs: integer(),
  /** 本次生成总耗时（毫秒，assistant 消息） */
  durationMs: integer(),
  /** 用户反馈：1 = 👍 点赞，-1 = 👎 点踩，null = 未反馈 */
  feedback: integer(),
  /** 点踩原因（如 不准确/不相关/有害/其他） */
  feedbackReason: varchar({ length: 200 }),
  /** 反馈处理状态：pending 待处理 / resolved 已处理 / ignored 已忽略 */
  feedbackStatus: aiFeedbackStatusEnum(),
  /** 管理员处理备注 */
  feedbackRemark: varchar({ length: 500 }),
  /** 反馈处理时间 */
  feedbackHandledAt: timestamp(),
  /** 生成调用链 trace（assistant 消息：检索/工具/LLM 轮次耗时明细） */
  trace: jsonb().$type<AiTraceStep[]>(),
  /** 工具调用过程（assistant 消息:名称/参数/结果,刷新后仍可展示） */
  toolCalls: jsonb().$type<{ name: string; arguments: string; result: string }[]>(),
  /** 知识库检索引用（assistant 消息,刷新后仍可展示） */
  kbReferences: jsonb().$type<{ docName: string; content: string; score: number }[]>(),
  /** 用户消息附带的图片（managed file id 数组，内容经文件中心 `fileContract.content` 访问） */
  images: jsonb().$type<string[]>(),
  createdAt: timestamp().defaultNow().notNull(),
}, (t) => [
  index('ai_messages_conversation_idx').on(t.conversationId, t.createdAt),
  index('ai_messages_created_at_idx').on(t.createdAt),
]);

export type AiMessageRow = typeof aiMessages.$inferSelect;

export type NewAiMessage = typeof aiMessages.$inferInsert;

export const userAiConfigs = pgTable('user_ai_configs', {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  userId: integer().notNull().references(() => users.id, { onDelete: 'cascade' }),
  name: varchar({ length: 100 }),
  /** Mastra 模型目录 provider ID 或 'custom'(与全局 ai_provider_configs 同构的用户子集) */
  providerId: varchar({ length: 50 }).notNull().default('custom'),
  baseUrl: varchar({ length: 500 }),
  apiKey: varchar({ length: 1000 }),
  /** 自定义请求头（组织 ID 等，随请求透传） */
  headers: jsonb().$type<Record<string, string>>(),
  /** 启用的模型列表（聊天时可切换） */
  models: text().array().notNull().default([]),
  /** 默认模型（须包含在 models 中） */
  defaultModel: varchar({ length: 100 }),
  /** 模型调用默认设置（temperature / maxOutputTokens / reasoning 等） */
  modelSettings: jsonb().$type<AiModelSettings>(),
  /** 服务商特定选项（按 provider 分组透传） */
  providerOptions: jsonb().$type<Record<string, Record<string, unknown>>>(),
  /** 模型能力标签（vision / tools） */
  capabilities: jsonb().$type<AiModelCapabilities>(),
  systemPrompt: text(),
  isEnabled: boolean().notNull().default(true),
  createdAt: timestamp().defaultNow().notNull(),
  updatedAt: timestamp().defaultNow().$onUpdate(() => new Date()).notNull(),
}, (t) => [index('user_ai_configs_user_idx').on(t.userId)]);

export type UserAiConfigRow = typeof userAiConfigs.$inferSelect;

export type NewUserAiConfig = typeof userAiConfigs.$inferInsert;

export const aiPromptScopeEnum = pgEnum('ai_prompt_scope', ['system', 'user']);

export const aiPromptTemplates = pgTable('ai_prompt_templates', {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  name: varchar({ length: 100 }).notNull(),
  content: text().notNull(),
  description: varchar({ length: 300 }),
  category: varchar({ length: 50 }),
  scope: aiPromptScopeEnum().notNull().default('system'),
  userId: integer().references(() => users.id, { onDelete: 'cascade' }),
  isBuiltin: boolean().notNull().default(false),
  sort: integer().notNull().default(0),
  /** 被应用为对话角色的累计次数 */
  usageCount: integer().notNull().default(0),
  isEnabled: boolean().notNull().default(true),
  ...auditColumns(),
  createdAt: timestamp().defaultNow().notNull(),
  updatedAt: timestamp().defaultNow().$onUpdate(() => new Date()).notNull(),
}, (t) => [index('ai_prompt_templates_user_idx').on(t.userId)]);

export type AiPromptTemplateRow = typeof aiPromptTemplates.$inferSelect;

export type NewAiPromptTemplate = typeof aiPromptTemplates.$inferInsert;

/** 用户级 AI 设置(单份文档:个人指令 / AI 记忆开关等,分域稀疏存储,读取时与默认值深合并) */
export const aiUserSettings = pgTable('ai_user_settings', {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  userId: integer().notNull().references(() => users.id, { onDelete: 'cascade' }),
  settings: jsonb().$type<AiUserSettingsPatch>().notNull().default({}),
  createdAt: timestamp().defaultNow().notNull(),
  updatedAt: timestamp().defaultNow().$onUpdate(() => new Date()).notNull(),
}, (t) => [uniqueIndex('ai_user_settings_user_id_uq').on(t.userId)]);

export type AiUserSettingsRow = typeof aiUserSettings.$inferSelect;

/** 对话分享链接 */
export const aiSharedConversations = pgTable('ai_shared_conversations', {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  token: varchar({ length: 64 }).notNull(),
  conversationId: integer().notNull().references(() => aiConversations.id, { onDelete: 'cascade' }),
  userId: integer().notNull().references(() => users.id, { onDelete: 'cascade' }),
  /** 过期时间，null = 永久有效 */
  expiresAt: timestamp(),
  createdAt: timestamp().defaultNow().notNull(),
}, (t) => [index('ai_shared_conversations_conversation_idx').on(t.conversationId), index('ai_shared_conversations_user_idx').on(t.userId), uniqueIndex('ai_shared_conversations_token_uq').on(t.token)]);

export type AiSharedConversationRow = typeof aiSharedConversations.$inferSelect;

/** 多模型对比（Arena）投票记录 */
export const aiArenaVotes = pgTable('ai_arena_votes', {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  userId: integer().notNull().references(() => users.id, { onDelete: 'cascade' }),
  question: text().notNull(),
  modelA: varchar({ length: 100 }).notNull(),
  modelB: varchar({ length: 100 }).notNull(),
  /** a / b / tie */
  winner: varchar({ length: 10 }).notNull(),
  createdAt: timestamp().defaultNow().notNull(),
}, (t) => [index('ai_arena_votes_user_idx').on(t.userId)]);

/** 知识库 */
export const aiKnowledgeBases = pgTable('ai_knowledge_bases', {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  name: varchar({ length: 100 }).notNull(),
  description: varchar({ length: 300 }),
  userId: integer().notNull().references(() => users.id, { onDelete: 'cascade' }),
  /** 向量化所用 embedding 模型快照（空 = 未向量化，走关键词检索） */
  embeddingModel: varchar({ length: 100 }),
  createdAt: timestamp().defaultNow().notNull(),
  updatedAt: timestamp().defaultNow().$onUpdate(() => new Date()).notNull(),
}, (t) => [index('ai_knowledge_bases_user_idx').on(t.userId)]);

export type AiKnowledgeBaseRow = typeof aiKnowledgeBases.$inferSelect;

/** 知识库文档 */
export const aiKbDocuments = pgTable('ai_kb_documents', {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  kbId: integer().notNull().references(() => aiKnowledgeBases.id, { onDelete: 'cascade' }),
  name: varchar({ length: 200 }).notNull(),
  /** 网页抓取来源 URL（手工文本 / 文件导入为 null） */
  sourceUrl: varchar({ length: 500 }),
  /** ready / processing / failed */
  status: varchar({ length: 20 }).notNull().default('ready'),
  chunkCount: integer().notNull().default(0),
  charCount: integer().notNull().default(0),
  error: varchar({ length: 500 }),
  createdAt: timestamp().defaultNow().notNull(),
});

export type AiKbDocumentRow = typeof aiKbDocuments.$inferSelect;

/** 知识库分块（embedding 为空时该分块走关键词检索） */
export const aiKbChunks = pgTable('ai_kb_chunks', {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  kbId: integer().notNull().references(() => aiKnowledgeBases.id, { onDelete: 'cascade' }),
  docId: integer().notNull().references(() => aiKbDocuments.id, { onDelete: 'cascade' }),
  /** 分块文本(关键词兜底检索 + UI 展示);向量归 Mastra PgVector(mastra schema,索引 kb_{kbId}) */
  content: text().notNull(),
  tokenCount: integer().notNull().default(0),
});

export type AiKbChunkRow = typeof aiKbChunks.$inferSelect;

// ─── P3：自定义智能体 ─────────────────────────────────────────────────────────

/** 自定义智能体(Mastra AgentConfig 形状:instructions + model + tools + memory 组合;创建即用) */
export const aiAgents = pgTable('ai_agents', {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  userId: integer().notNull().references(() => users.id, { onDelete: 'cascade' }),
  name: varchar({ length: 100 }).notNull(),
  description: varchar({ length: 300 }),
  /** 头像 emoji */
  avatar: varchar({ length: 20 }).notNull().default('🤖'),
  /** Agent 指令(Mastra instructions) */
  instructions: text().notNull(),
  /** 指定服务商配置（null = 系统默认配置），软引用 */
  configId: integer(),
  /** 指定模型（null = 配置默认模型） */
  model: varchar({ length: 100 }),
  /** 模型调用设置(temperature / maxOutputTokens 等,Mastra ModelSettings 子集) */
  modelSettings: jsonb().$type<AiModelSettings>(),
  /** 工具循环最大步数(null = 系统默认) */
  maxSteps: integer(),
  /** 绑定知识库（软引用，删除知识库时置空） */
  knowledgeBaseId: integer(),
  /** 启用的工具名集合（内置 + HTTP 工具） */
  tools: text().array(),
  /** 开场白 */
  openingMessage: text(),
  /** 建议问题 */
  suggestedQuestions: text().array(),
  usageCount: integer().notNull().default(0),
  isEnabled: boolean().notNull().default(true),
  createdAt: timestamp().defaultNow().notNull(),
  updatedAt: timestamp().defaultNow().$onUpdate(() => new Date()).notNull(),
}, (t) => [index('ai_agents_user_idx').on(t.userId)]);

export type AiAgentRow = typeof aiAgents.$inferSelect;

export type NewAiAgent = typeof aiAgents.$inferInsert;

// ─── P3：HTTP API 工具 ────────────────────────────────────────────────────────

/** HTTP 工具参数定义 */
export interface AiHttpToolParam {
  name: string;
  type: 'string' | 'number' | 'boolean';
  description: string;
  required: boolean;
  /** query = URL 查询参数 / body = JSON body 字段 / path = URL 路径占位符 {name} */
  location: 'query' | 'body' | 'path';
}

/** 管理员配置的 HTTP API 工具（动态注入 function calling 工具集） */
export const aiHttpTools = pgTable('ai_http_tools', {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  /** 工具函数名（a-z0-9_，全局唯一，与内置工具共用命名空间） */
  name: varchar({ length: 60 }).notNull(),
  description: varchar({ length: 500 }).notNull(),
  method: varchar({ length: 10 }).notNull().default('GET'),
  /** 支持 {param} 路径占位符 */
  urlTemplate: varchar({ length: 500 }).notNull(),
  headers: jsonb().$type<Record<string, string>>(),
  params: jsonb().$type<AiHttpToolParam[]>(),
  isEnabled: boolean().notNull().default(true),
  ...auditColumns(),
  createdAt: timestamp().defaultNow().notNull(),
  updatedAt: timestamp().defaultNow().$onUpdate(() => new Date()).notNull(),
}, (t) => [uniqueIndex('ai_http_tools_name_uq').on(t.name)]);

export type AiHttpToolRow = typeof aiHttpTools.$inferSelect;

// ─── P3：提示词模板版本 ───────────────────────────────────────────────────────

/** 提示词模板历史版本快照（内容变更时自动留档） */
export const aiPromptTemplateVersions = pgTable('ai_prompt_template_versions', {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  templateId: integer().notNull().references(() => aiPromptTemplates.id, { onDelete: 'cascade' }),
  version: integer().notNull(),
  name: varchar({ length: 100 }).notNull(),
  content: text().notNull(),
  createdBy: integer().references(() => users.id, { onDelete: 'set null' }),
  createdAt: timestamp().defaultNow().notNull(),
});

export type AiPromptTemplateVersionRow = typeof aiPromptTemplateVersions.$inferSelect;

// ─── P3:评测(Mastra Datasets + Experiments,mastra schema 承载,业务表已移除) ──
