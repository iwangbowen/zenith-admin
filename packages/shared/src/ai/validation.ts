import * as z from 'zod';
import { httpUrl, partialForUpdate } from '../core/validation';
import {
  AI_EVAL_SCORER_IDS,
  AI_FEEDBACK_STATUSES,
  AI_HTTP_TOOL_METHODS,
  AI_HTTP_TOOL_PARAM_LOCATIONS,
  AI_HTTP_TOOL_PARAM_TYPES,
  AI_PROMPT_SCOPES,
  AI_REASONING_LEVELS,
} from './constants';

// ─── AI 对话模块 ──────────────────────────────────────────────────────────────

/** Mastra 模型目录 provider ID 或 'custom'（小写字母开头,允许数字/连字符/下划线） */
export const aiProviderIdSchema = z
  .string()
  .min(1, '请选择服务商')
  .max(50)
  .regex(/^[a-z][a-z0-9_-]*$/, 'provider ID 仅限小写字母/数字/连字符/下划线');

/** 模型能力标签（vision=图片理解 / tools=函数调用 / contextWindow=上下文长度） */
export const aiModelCapabilitiesSchema = z.object({
  vision: z.boolean().optional(),
  tools: z.boolean().optional(),
  contextWindow: z.number().int().min(0).max(100000000).optional(),
}).meta({ id: 'AiModelCapabilities' });

export type AiModelCapabilities = z.infer<typeof aiModelCapabilitiesSchema>;

/**
 * 模型调用设置（Mastra ModelSettings 子集,调用时透传）。
 * 分层覆盖:降级链条目 > 调用时 > 配置默认。
 */
export const aiModelSettingsSchema = z.object({
  temperature: z.number().min(0).max(2).optional(),
  maxOutputTokens: z.number().int().min(1).max(10000000).optional(),
  topP: z.number().min(0).max(1).optional(),
  frequencyPenalty: z.number().min(-2).max(2).optional(),
  presencePenalty: z.number().min(-2).max(2).optional(),
  /** 推理力度（仅支持 reasoning 的模型生效） */
  reasoning: z.enum(AI_REASONING_LEVELS).optional(),
}).meta({ id: 'AiModelSettings' });

export type AiModelSettings = z.infer<typeof aiModelSettingsSchema>;

/** 降级链条目:引用另一个服务商配置下的某个模型（Mastra ModelWithRetries 的持久化形态） */
export const aiModelFallbackRefSchema = z.object({
  configId: z.number().int().positive().meta({ description: '目标服务商配置 ID' }),
  model: z.string().min(1).max(100).meta({ description: '目标模型 ID（裸模型名,不含 provider 前缀）' }),
  maxRetries: z.number().int().min(0).max(5).optional().meta({ description: '该级重试次数,默认 1' }),
}).meta({ id: 'AiModelFallbackRef' });

export type AiModelFallbackRef = z.infer<typeof aiModelFallbackRefSchema>;

export const createAiProviderConfigSchema = z.object({
  name: z.string().min(1, '名称不能为空').max(100),
  providerId: aiProviderIdSchema,
  /** custom 必填;目录服务商留空走官方端点（业务校验在 service 层） */
  baseUrl: httpUrl('请输入有效的 http(s) URL').max(500).nullable().optional(),
  apiKey: z.string().min(1, 'API Key 不能为空').max(1000),
  headers: z.record(z.string().max(100), z.string().max(500)).nullable().optional(),
  models: z.array(z.string().min(1).max(100)).min(1, '至少启用一个模型').max(100),
  defaultModel: z.string().min(1, '默认模型不能为空').max(100),
  modelSettings: aiModelSettingsSchema.nullable().optional(),
  providerOptions: z.record(z.string().max(50), z.record(z.string().max(100), z.unknown())).nullable().optional(),
  fallbacks: z.array(aiModelFallbackRefSchema).max(5).nullable().optional(),
  capabilities: aiModelCapabilitiesSchema.nullable().optional(),
  priceInputPerM: z.number().int().min(0).max(100000000).nullable().optional(),
  priceOutputPerM: z.number().int().min(0).max(100000000).nullable().optional(),
  /** 并发流上限（null/0 = 不限） */
  maxConcurrent: z.number().int().min(0).max(1000).nullable().optional(),
  isDefault: z.boolean().default(false),
  isEnabled: z.boolean().default(true),
});

export const updateAiProviderConfigSchema = partialForUpdate(createAiProviderConfigSchema);

export type CreateAiProviderConfigInput = z.infer<typeof createAiProviderConfigSchema>;

export type UpdateAiProviderConfigInput = z.infer<typeof updateAiProviderConfigSchema>;

export const testAiConnectionSchema = z.object({
  /** 已有配置的 id；提供时若 apiKey 为空则从 DB 取真实密钥 */
  id: z.number().int().positive().optional(),
  providerId: aiProviderIdSchema,
  baseUrl: httpUrl('请输入有效的 http(s) URL').max(500).nullable().optional(),
  apiKey: z.string().max(1000).optional(),
  model: z.string().min(1, '模型名称不能为空').max(100),
});

export type TestAiConnectionInput = z.infer<typeof testAiConnectionSchema>;

export const fetchAiModelsSchema = z.object({
  /** 已有配置的 id；提供时若 apiKey 为空则从 DB 取真实密钥 */
  id: z.number().int().positive().optional(),
  providerId: aiProviderIdSchema,
  baseUrl: httpUrl('请输入有效的 http(s) URL').max(500).nullable().optional(),
  apiKey: z.string().max(1000).optional(),
});

export type FetchAiModelsInput = z.infer<typeof fetchAiModelsSchema>;

export const createAiConversationSchema = z.object({
  title: z.string().max(200).optional(),
  /** 以智能体开启对话 */
  agentId: z.number().int().positive().optional(),
});

export type CreateAiConversationInput = z.infer<typeof createAiConversationSchema>;

export const renameAiConversationSchema = z.object({
  title: z.string().min(1).max(200),
});

export type RenameAiConversationInput = z.infer<typeof renameAiConversationSchema>;

/** 设置 / 清除对话挂载的知识库（kbId 传 null 清除） */
export const setAiConversationKnowledgeBaseSchema = z.object({
  kbId: z.number().int().positive().nullable(),
});

export type SetAiConversationKnowledgeBaseInput = z.infer<typeof setAiConversationKnowledgeBaseSchema>;

/** 流式对话请求体：regenerate 模式不追加新的 user 消息，否则 message 必填 */
export const sendAiChatMessageSchema = z.object({
  message: z.string().min(1).max(8192).optional(),
  /** 重新生成模式：不追加/保存新的 user 消息，基于激活路径重新回答（生成 assistant 兄弟分支） */
  regenerate: z.boolean().optional(),
  /** 编辑重发：新 user 消息挂到该父节点形成兄弟分支（null = 作为根消息） */
  parentMsgId: z.number().int().positive().nullable().optional(),
  configSource: z.enum(['system', 'user']).optional(),
  configId: z.number().int().positive().optional(),
  /** 多模型配置下选择的具体模型 */
  model: z.string().max(100).optional(),
  /** 推理力度(会话级覆盖,优先级高于智能体/服务商配置;AI SDK 统一档位) */
  reasoning: z.enum(AI_REASONING_LEVELS).optional(),
  /** vision 图片（data URL，base64），仅当轮上下文生效 */
  images: z.array(z.string().regex(/^data:image\//, '仅支持 data:image 格式')).optional(),
}).refine((d) => d.regenerate || !!d.message?.trim(), { message: '消息不能为空' });

export type SendAiChatMessageInput = z.infer<typeof sendAiChatMessageSchema>;

/** 多模型对比单栏流式请求体（不落库、不带历史） */
export const arenaChatSchema = z.object({
  message: z.string().min(1).max(8192),
  configId: z.number().int().positive(),
  model: z.string().max(100).optional(),
});

export type ArenaChatInput = z.infer<typeof arenaChatSchema>;

export const saveUserAiConfigSchema = z.object({
  name: z.string().max(100).nullable().optional(),
  providerId: aiProviderIdSchema.optional(),
  baseUrl: httpUrl('请输入有效的 http(s) URL').max(500).nullable().optional(),
  apiKey: z.string().max(1000).nullable().optional(),
  headers: z.record(z.string().max(100), z.string().max(500)).nullable().optional(),
  models: z.array(z.string().min(1).max(100)).max(100).optional(),
  defaultModel: z.string().max(100).nullable().optional(),
  modelSettings: aiModelSettingsSchema.nullable().optional(),
  providerOptions: z.record(z.string().max(50), z.record(z.string().max(100), z.unknown())).nullable().optional(),
  capabilities: aiModelCapabilitiesSchema.nullable().optional(),
  systemPrompt: z.string().max(5000).nullable().optional(),
  isEnabled: z.boolean().optional(),
});

export type SaveUserAiConfigInput = z.infer<typeof saveUserAiConfigSchema>;

// ─── AI 提示词模板 Schema ──────────────────────────────────────────────────────
export const aiPromptScopeEnum = z.enum(AI_PROMPT_SCOPES);

export const createAiPromptTemplateSchema = z.object({
  name: z.string().min(1, '名称不能为空').max(100),
  content: z.string().min(1, '提示词内容不能为空').max(5000),
  description: z.string().max(300).nullable().optional(),
  category: z.string().max(50).nullable().optional(),
  scope: aiPromptScopeEnum.default('system'),
  sort: z.number().int().min(0).default(0),
  isEnabled: z.boolean().default(true),
});

export const updateAiPromptTemplateSchema = partialForUpdate(createAiPromptTemplateSchema);

export type CreateAiPromptTemplateInput = z.infer<typeof createAiPromptTemplateSchema>;

export type UpdateAiPromptTemplateInput = z.infer<typeof updateAiPromptTemplateSchema>;

export const setConversationSystemPromptSchema = z.object({
  systemPrompt: z.string().max(5000).nullable(),
});

export type SetConversationSystemPromptInput = z.infer<typeof setConversationSystemPromptSchema>;

export const aiFeedbackReasonEnum = z.enum(['inaccurate', 'irrelevant', 'harmful', 'other']);

export const aiFeedbackStatusEnum = z.enum(AI_FEEDBACK_STATUSES);

export const submitAiFeedbackSchema = z.object({
  feedback: z.union([z.literal(1), z.literal(-1), z.null()]),
  reason: z.string().max(200).nullable().optional(),
});

export const updateAiFeedbackStatusSchema = z.object({
  status: aiFeedbackStatusEnum,
  remark: z.string().max(500).nullable().optional(),
});

export type SubmitAiFeedbackInput = z.infer<typeof submitAiFeedbackSchema>;

export type UpdateAiFeedbackStatusInput = z.infer<typeof updateAiFeedbackStatusSchema>;

export const shareAiConversationSchema = z.object({
  /** 有效天数：0 = 永久 */
  expiresDays: z.number().int().min(0).max(365).default(0),
});

export type ShareAiConversationInput = z.infer<typeof shareAiConversationSchema>;

export const createAiKnowledgeBaseSchema = z.object({
  name: z.string().min(1, '名称不能为空').max(100),
  description: z.string().max(300).nullable().optional(),
});

export const updateAiKnowledgeBaseSchema = partialForUpdate(createAiKnowledgeBaseSchema);

export type CreateAiKnowledgeBaseInput = z.infer<typeof createAiKnowledgeBaseSchema>;

export type UpdateAiKnowledgeBaseInput = z.infer<typeof updateAiKnowledgeBaseSchema>;

export const addAiKbDocumentSchema = z.object({
  name: z.string().min(1, '文档名称不能为空').max(200),
  /** 文档纯文本内容（txt/md 粘贴或前端读取上传文件） */
  content: z.string().min(1, '内容不能为空').max(500000),
});

export type AddAiKbDocumentInput = z.infer<typeof addAiKbDocumentSchema>;

/** 从 URL 抓取网页正文入库 */
export const importAiKbUrlSchema = z.object({
  url: httpUrl('请输入合法的 http(s) URL').max(500),
  /** 文档名称（留空取页面 title / URL） */
  name: z.string().max(200).optional(),
});

export type ImportAiKbUrlInput = z.infer<typeof importAiKbUrlSchema>;

// ─── P3：自定义智能体 ─────────────────────────────────────────────────────────

export const createAiAgentSchema = z.object({
  name: z.string().min(1, '名称不能为空').max(100),
  description: z.string().max(300).nullable().optional(),
  avatar: z.string().max(20).optional(),
  instructions: z.string().min(1, '指令不能为空').max(8192),
  configId: z.number().int().positive().nullable().optional(),
  model: z.string().max(100).nullable().optional(),
  modelSettings: aiModelSettingsSchema.nullable().optional(),
  maxSteps: z.number().int().min(1).max(20).nullable().optional(),
  knowledgeBaseId: z.number().int().positive().nullable().optional(),
  tools: z.array(z.string().max(60)).max(20).optional(),
  openingMessage: z.string().max(2000).nullable().optional(),
  suggestedQuestions: z.array(z.string().min(1).max(200)).max(6).optional(),
  isEnabled: z.boolean().optional(),
});

export const updateAiAgentSchema = partialForUpdate(createAiAgentSchema);

export type CreateAiAgentInput = z.infer<typeof createAiAgentSchema>;

export type UpdateAiAgentInput = z.infer<typeof updateAiAgentSchema>;

// ─── P3：HTTP API 工具 ────────────────────────────────────────────────────────

/** HTTP 工具参数定义（写入校验与实体字段同构） */
export const aiHttpToolParamSchema = z.object({
  name: z.string().regex(/^[a-zA-Z][a-zA-Z0-9_]{0,39}$/, '参数名仅限字母/数字/下划线，字母开头'),
  type: z.enum(AI_HTTP_TOOL_PARAM_TYPES),
  description: z.string().min(1, '参数说明不能为空').max(200),
  required: z.boolean(),
  location: z.enum(AI_HTTP_TOOL_PARAM_LOCATIONS),
}).meta({ id: 'AiHttpToolParam' });

export type AiHttpToolParam = z.infer<typeof aiHttpToolParamSchema>;

export const createAiHttpToolSchema = z.object({
  name: z.string().regex(/^[a-z][a-z0-9_]{1,59}$/, '工具名仅限小写字母/数字/下划线，字母开头'),
  description: z.string().min(1, '工具描述不能为空').max(500),
  method: z.enum(AI_HTTP_TOOL_METHODS),
  urlTemplate: httpUrl('请输入合法的 http(s) URL').max(500),
  headers: z.record(z.string(), z.string().max(500)).nullable().optional(),
  params: z.array(aiHttpToolParamSchema).max(20).optional(),
  isEnabled: z.boolean().optional(),
});

export const updateAiHttpToolSchema = partialForUpdate(createAiHttpToolSchema);

export type CreateAiHttpToolInput = z.infer<typeof createAiHttpToolSchema>;

export type UpdateAiHttpToolInput = z.infer<typeof updateAiHttpToolSchema>;

// ─── P3：评测(Mastra Datasets + Experiments) ─────────────────────────────────

export const aiEvalItemSchema = z.object({
  input: z.string().min(1, '问题不能为空').max(4000),
  groundTruth: z.string().max(4000).nullable().optional(),
});

export const createAiEvalDatasetSchema = z.object({
  name: z.string().min(1, '名称不能为空').max(100),
  description: z.string().max(300).nullable().optional(),
  items: z.array(aiEvalItemSchema).max(100).optional(),
});

export const updateAiEvalDatasetSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  description: z.string().max(300).nullable().optional(),
});

export const addAiEvalItemsSchema = z.object({
  items: z.array(aiEvalItemSchema).min(1, '至少一条评测问题').max(100),
});

export const runAiExperimentSchema = z.object({
  /** 实验名(缺省自动生成) */
  name: z.string().max(100).optional(),
  /** 目标 Mastra agent ID(agent-{id} / zenith-chat / 内置智能体) */
  targetId: z.string().min(1, '请选择评测目标').max(100),
  /** 打分器(缺省 ground-truth;目录见 AI_EVAL_SCORERS) */
  scorers: z.array(z.enum(AI_EVAL_SCORER_IDS)).max(5).optional(),
});

export type CreateAiEvalDatasetInput = z.infer<typeof createAiEvalDatasetSchema>;

export type UpdateAiEvalDatasetInput = z.infer<typeof updateAiEvalDatasetSchema>;

export type AddAiEvalItemsInput = z.infer<typeof addAiEvalItemsSchema>;

export type RunAiExperimentInput = z.infer<typeof runAiExperimentSchema>;

// ─── P3：对话体验 ─────────────────────────────────────────────────────────────

export const updateAiConversationTagsSchema = z.object({
  tags: z.array(z.string().min(1).max(20)).max(10),
});

export const setAiActiveLeafSchema = z.object({
  leafMsgId: z.number().int().positive(),
});

export const arenaVoteSchema = z.object({
  question: z.string().min(1).max(8192),
  modelA: z.string().min(1).max(100),
  modelB: z.string().min(1).max(100),
  winner: z.enum(['a', 'b', 'tie']),
});

export type ArenaVoteInput = z.infer<typeof arenaVoteSchema>;

// ─── 用户级 AI 设置 ───────────────────────────────────────────────────────────

/** 用户级 AI 设置写入 schema(深度可选;域内字段逐个合并,未知键拒绝) */
export const saveAiUserSettingsSchema = z.strictObject({
  instructions: z.strictObject({
    enabled: z.boolean().optional(),
    aboutMe: z.string().max(2000).nullable().optional(),
    replyStyle: z.string().max(2000).nullable().optional(),
  }).optional(),
  memory: z.strictObject({
    enabled: z.boolean().optional(),
  }).optional(),
});

export type SaveAiUserSettingsInput = z.infer<typeof saveAiUserSettingsSchema>;

/** 用户级 AI 设置的稀疏存储形态（DB 只存与默认值的差异），与写入 schema 同构 */
export type AiUserSettingsPatch = SaveAiUserSettingsInput;

/** AI 记忆画像(working memory)编辑 schema */
export const updateAiMemoryProfileSchema = z.object({
  content: z.string().max(8000),
});

export type UpdateAiMemoryProfileInput = z.infer<typeof updateAiMemoryProfileSchema>;
