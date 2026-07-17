import { z } from '@hono/zod-openapi';

const CapabilitiesDTO = z
  .object({
    vision: z.boolean().optional(),
    tools: z.boolean().optional(),
    contextWindow: z.number().optional(),
  })
  .nullable()
  .openapi({ description: '模型能力标签' });

export const AiProviderConfigDTO = z
  .object({
    id: z.number().openapi({ description: 'ID' }),
    name: z.string().openapi({ description: '配置名称' }),
    provider: z.string().openapi({ description: 'AI 供应商类型' }),
    baseUrl: z.string().openapi({ description: 'API 地址' }),
    apiKey: z.string().openapi({ description: 'API Key（脱敏）' }),
    model: z.string().openapi({ description: '默认模型' }),
    models: z.array(z.string()).nullable().openapi({ description: '附加可选模型列表' }),
    capabilities: CapabilitiesDTO,
    systemPrompt: z.string().nullable().openapi({ description: '系统提示词' }),
    maxTokens: z.number().openapi({ description: '最大输出 token' }),
    temperature: z.string().openapi({ description: '温度参数' }),
    priceInputPerM: z.number().nullable().openapi({ description: '输入单价（分/百万token）' }),
    priceOutputPerM: z.number().nullable().openapi({ description: '输出单价（分/百万token）' }),
    isDefault: z.boolean().openapi({ description: '是否默认' }),
    isEnabled: z.boolean().openapi({ description: '是否启用' }),
    createdAt: z.string().openapi({ description: '创建时间' }),
    updatedAt: z.string().openapi({ description: '更新时间' }),
  })
  .openapi('AiProviderConfig');

export const AiChatModelDTO = z
  .object({
    id: z.number().openapi({ description: '配置 ID' }),
    name: z.string().openapi({ description: '配置名称' }),
    model: z.string().openapi({ description: '模型名称' }),
    provider: z.string().openapi({ description: 'AI 供应商类型' }),
    isDefault: z.boolean().openapi({ description: '是否默认' }),
    capabilities: CapabilitiesDTO,
  })
  .openapi('AiChatModel');

export const AiUserPreferenceDTO = z
  .object({
    aboutMe: z.string().nullable().openapi({ description: '关于我（背景信息）' }),
    replyStyle: z.string().nullable().openapi({ description: '回答风格要求' }),
    isEnabled: z.boolean().openapi({ description: '是否启用个人指令' }),
  })
  .openapi('AiUserPreference');

export const AiConversationShareDTO = z
  .object({
    token: z.string().openapi({ description: '分享 token' }),
    url: z.string().openapi({ description: '分享页相对路径' }),
    expiresAt: z.string().nullable().openapi({ description: '过期时间，null=永久' }),
    createdAt: z.string().openapi({ description: '创建时间' }),
  })
  .openapi('AiConversationShare');

export const AiSharedConversationDTO = z
  .object({
    title: z.string().openapi({ description: '对话标题' }),
    sharedAt: z.string().openapi({ description: '分享时间' }),
    messages: z.array(
      z.object({
        id: z.number(),
        role: z.enum(['system', 'user', 'assistant']),
        content: z.string(),
        reasoning: z.string().nullable(),
        model: z.string().nullable(),
        createdAt: z.string(),
      }),
    ).openapi({ description: '只读消息列表' }),
  })
  .openapi('AiSharedConversation');

export const AiKnowledgeBaseDTO = z
  .object({
    id: z.number().openapi({ description: 'ID' }),
    name: z.string().openapi({ description: '名称' }),
    description: z.string().nullable().openapi({ description: '描述' }),
    userId: z.number().openapi({ description: '归属用户' }),
    embeddingModel: z.string().nullable().openapi({ description: '向量化模型（空=关键词检索）' }),
    documentCount: z.number().openapi({ description: '文档数' }),
    chunkCount: z.number().openapi({ description: '分块数' }),
    createdAt: z.string().openapi({ description: '创建时间' }),
    updatedAt: z.string().openapi({ description: '更新时间' }),
  })
  .openapi('AiKnowledgeBase');

export const AiKbDocumentDTO = z
  .object({
    id: z.number().openapi({ description: 'ID' }),
    kbId: z.number().openapi({ description: '知识库 ID' }),
    name: z.string().openapi({ description: '文档名称' }),
    status: z.enum(['ready', 'processing', 'failed']).openapi({ description: '处理状态' }),
    chunkCount: z.number().openapi({ description: '分块数' }),
    charCount: z.number().openapi({ description: '字符数' }),
    error: z.string().nullable().openapi({ description: '失败原因' }),
    createdAt: z.string().openapi({ description: '创建时间' }),
  })
  .openapi('AiKbDocument');

export const AiConversationDTO = z
  .object({
    id: z.number().openapi({ description: 'ID' }),
    userId: z.number().openapi({ description: '用户 ID' }),
    tenantId: z.number().nullable().openapi({ description: '租户 ID' }),
    title: z.string().openapi({ description: '对话标题' }),
    providerSnapshot: z
      .object({
        provider: z.string(),
        model: z.string(),
        configId: z.number().optional(),
      })
      .nullable()
      .openapi({ description: '供应商快照' }),
    isArchived: z.boolean().openapi({ description: '是否归档' }),
    isPinned: z.boolean().openapi({ description: '是否置顶' }),
    systemPromptOverride: z.string().nullable().openapi({ description: '对话级提示词（角色模板）' }),
    knowledgeBaseId: z.number().nullable().openapi({ description: '挂载的知识库 ID' }),
    createdAt: z.string().openapi({ description: '创建时间' }),
    updatedAt: z.string().openapi({ description: '更新时间' }),
  })
  .openapi('AiConversation');

export const AiMessageDTO = z
  .object({
    id: z.number().openapi({ description: 'ID' }),
    conversationId: z.number().openapi({ description: '对话 ID' }),
    role: z.enum(['system', 'user', 'assistant']).openapi({ description: '消息角色' }),
    content: z.string().openapi({ description: '消息内容' }),
    reasoning: z.string().nullable().openapi({ description: '推理模型思维链内容' }),
    model: z.string().nullable().openapi({ description: '生成所用模型' }),
    tokensInput: z.number().openapi({ description: '输入 token 数' }),
    tokensOutput: z.number().openapi({ description: '输出 token 数' }),
    ttftMs: z.number().nullable().openapi({ description: '首字延迟（毫秒）' }),
    durationMs: z.number().nullable().openapi({ description: '生成总耗时（毫秒）' }),
    feedback: z.number().nullable().openapi({ description: '用户反馈：1=点赞, -1=点踩, null=未反馈' }),
    feedbackReason: z.string().nullable().openapi({ description: '点踩原因' }),
    feedbackStatus: z.enum(['pending', 'resolved', 'ignored']).nullable().openapi({ description: '反馈处理状态' }),
    feedbackRemark: z.string().nullable().openapi({ description: '处理备注' }),
    feedbackHandledAt: z.string().nullable().openapi({ description: '处理时间' }),
    createdAt: z.string().openapi({ description: '创建时间' }),
  })
  .openapi('AiMessage');

export const AiFeedbackItemDTO = AiMessageDTO.extend({
  userId: z.number().nullable().openapi({ description: '反馈用户 ID' }),
  username: z.string().nullable().openapi({ description: '反馈用户名' }),
  nickname: z.string().nullable().openapi({ description: '反馈用户昵称' }),
  conversationTitle: z.string().nullable().openapi({ description: '所属对话标题' }),
  question: z.string().nullable().openapi({ description: '该回复之前最近一条用户提问' }),
}).openapi('AiFeedbackItem');

export const AiFeedbackContextDTO = z
  .object({
    conversationId: z.number().openapi({ description: '对话 ID' }),
    conversationTitle: z.string().nullable().openapi({ description: '对话标题' }),
    targetMsgId: z.number().openapi({ description: '目标消息 ID' }),
    messages: z.array(AiMessageDTO).openapi({ description: '目标消息前后的上下文消息' }),
  })
  .openapi('AiFeedbackContext');

export const UserAiConfigDTO = z
  .object({
    id: z.number().openapi({ description: 'ID' }),
    userId: z.number().openapi({ description: '用户 ID' }),
    name: z.string().nullable().openapi({ description: '配置名称' }),
    provider: z.string().openapi({ description: 'AI 供应商类型' }),
    baseUrl: z.string().nullable().openapi({ description: 'API 地址' }),
    apiKey: z.string().nullable().openapi({ description: 'API Key（脱敏）' }),
    model: z.string().nullable().openapi({ description: '模型名称' }),
    temperature: z.string().nullable().openapi({ description: '温度' }),
    maxTokens: z.number().nullable().openapi({ description: '最大 Token 数' }),
    systemPrompt: z.string().nullable().openapi({ description: '系统提示词' }),
    isEnabled: z.boolean().openapi({ description: '是否启用' }),
    createdAt: z.string().openapi({ description: '创建时间' }),
    updatedAt: z.string().openapi({ description: '更新时间' }),
  })
  .openapi('UserAiConfig');

export const AiPromptTemplateDTO = z
  .object({
    id: z.number().openapi({ description: 'ID' }),
    name: z.string().openapi({ description: '模板名称' }),
    content: z.string().openapi({ description: '提示词内容' }),
    description: z.string().nullable().openapi({ description: '描述' }),
    category: z.string().nullable().openapi({ description: '分类' }),
    scope: z.enum(['system', 'user']).openapi({ description: '范围：system=系统级, user=用户私有' }),
    userId: z.number().nullable().openapi({ description: '归属用户 ID（用户私有模板）' }),
    isBuiltin: z.boolean().openapi({ description: '是否内置预设（不可删除）' }),
    sort: z.number().openapi({ description: '排序' }),
    usageCount: z.number().openapi({ description: '被应用为对话角色的累计次数' }),
    isEnabled: z.boolean().openapi({ description: '是否启用' }),
    createdAt: z.string().openapi({ description: '创建时间' }),
    updatedAt: z.string().openapi({ description: '更新时间' }),
  })
  .openapi('AiPromptTemplate');

export const AiUsageStatsDTO = z
  .object({
    overview: z.object({
      totalConversations: z.number().openapi({ description: '对话总数' }),
      totalMessages: z.number().openapi({ description: 'AI 回复消息数' }),
      tokensInput: z.number().openapi({ description: '输入 token 总数' }),
      tokensOutput: z.number().openapi({ description: '输出 token 总数' }),
      totalTokens: z.number().openapi({ description: 'token 总数' }),
      activeUsers: z.number().openapi({ description: '活跃用户数' }),
      totalCostFen: z.number().openapi({ description: '预估成本（分），未配置单价的模型不计入' }),
      avgTtftMs: z.number().nullable().openapi({ description: '平均首字延迟（毫秒）' }),
      successRate: z.number().nullable().openapi({ description: '请求成功率（0-100，无数据为 null）' }),
    }),
    byModel: z.array(
      z.object({
        model: z.string(),
        provider: z.string().nullable(),
        messages: z.number(),
        tokensInput: z.number(),
        tokensOutput: z.number(),
        totalTokens: z.number(),
        avgTtftMs: z.number().nullable(),
        costFen: z.number().nullable(),
      }),
    ).openapi({ description: '按模型聚合' }),
    byUser: z.array(
      z.object({
        userId: z.number(),
        username: z.string(),
        nickname: z.string(),
        conversations: z.number(),
        messages: z.number(),
        totalTokens: z.number(),
      }),
    ).openapi({ description: '按用户聚合（Top 10）' }),
    trend: z.array(
      z.object({
        date: z.string(),
        messages: z.number(),
        totalTokens: z.number(),
      }),
    ).openapi({ description: '按日趋势' }),
  })
  .openapi('AiUsageStats');
