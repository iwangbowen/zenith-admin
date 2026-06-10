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
    tokensInput: z.number().openapi({ description: '输入 token 数' }),
    tokensOutput: z.number().openapi({ description: '输出 token 数' }),
    feedback: z.number().nullable().openapi({ description: '用户反馈：1=点赞, -1=点踩, null=未反馈' }),
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
