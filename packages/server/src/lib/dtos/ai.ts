import { z } from '@hono/zod-openapi';

export const AiProviderConfigDTO = z
  .object({
    id: z.number().openapi({ description: 'ID' }),
    name: z.string().openapi({ description: '配置名称' }),
    provider: z.string().openapi({ description: 'AI 供应商类型' }),
    baseUrl: z.string().openapi({ description: 'API 地址' }),
    apiKey: z.string().openapi({ description: 'API Key（脱敏）' }),
    model: z.string().openapi({ description: '默认模型' }),
    systemPrompt: z.string().nullable().openapi({ description: '系统提示词' }),
    maxTokens: z.number().openapi({ description: '最大输出 token' }),
    temperature: z.string().openapi({ description: '温度参数' }),
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
  })
  .openapi('AiChatModel');

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
    model: z.string().nullable().openapi({ description: '生成所用模型' }),
    tokensInput: z.number().openapi({ description: '输入 token 数' }),
    tokensOutput: z.number().openapi({ description: '输出 token 数' }),
    feedback: z.number().nullable().openapi({ description: '用户反馈：1=点赞, -1=点踩, null=未反馈' }),
    feedbackReason: z.string().nullable().openapi({ description: '点踩原因' }),
    feedbackStatus: z.enum(['pending', 'resolved', 'ignored']).nullable().openapi({ description: '反馈处理状态' }),
    feedbackRemark: z.string().nullable().openapi({ description: '处理备注' }),
    feedbackHandledAt: z.string().nullable().openapi({ description: '处理时间' }),
    createdAt: z.string().openapi({ description: '创建时间' }),
  })
  .openapi('AiMessage');

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
    isEnabled: z.boolean().openapi({ description: '是否启用' }),
    createdAt: z.string().openapi({ description: '创建时间' }),
    updatedAt: z.string().openapi({ description: '更新时间' }),
  })
  .openapi('AiPromptTemplate');

export const AiUsageStatsDTO = z
  .object({
    overview: z.object({
      totalConversations: z.number().openapi({ description: '对话总数' }),
      totalMessages: z.number().openapi({ description: '消息总数' }),
      tokensInput: z.number().openapi({ description: '输入 token 总数' }),
      tokensOutput: z.number().openapi({ description: '输出 token 总数' }),
      totalTokens: z.number().openapi({ description: 'token 总数' }),
      activeUsers: z.number().openapi({ description: '活跃用户数' }),
    }),
    byModel: z.array(
      z.object({
        model: z.string(),
        messages: z.number(),
        tokensInput: z.number(),
        tokensOutput: z.number(),
        totalTokens: z.number(),
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
