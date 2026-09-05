import * as z from 'zod';
import { idParam } from '../../core/api-schemas';
import { defineContract, op } from '../../core/contract';
import { aiModelCapabilitiesSchema, aiModelSettingsSchema, saveUserAiConfigSchema } from '../validation';

// ─── 实体 ────────────────────────────────────────────────────────────────────

/** 用户个人 AI 配置（与全局服务商配置同构的用户子集；API Key 脱敏） */
export const userAiConfigSchema = z.object({
  id: z.int(),
  userId: z.int(),
  name: z.string().nullable().meta({ description: '配置名称' }),
  providerId: z.string().meta({ description: "Mastra provider ID 或 'custom'" }),
  baseUrl: z.string().nullable().meta({ description: 'API 地址' }),
  apiKey: z.string().nullable().meta({ description: 'API Key（脱敏）' }),
  headers: z.record(z.string(), z.string()).nullable().meta({ description: '自定义请求头（组织 ID 等，随请求透传）' }),
  models: z.array(z.string()).meta({ description: '启用的模型列表（聊天时可切换）' }),
  defaultModel: z.string().nullable().meta({ description: '默认模型（须包含在 models 中）' }),
  modelSettings: aiModelSettingsSchema.nullable(),
  providerOptions: z.record(z.string(), z.record(z.string(), z.unknown())).nullable().meta({ description: '服务商特定选项（按 provider 分组透传）' }),
  capabilities: aiModelCapabilitiesSchema.nullable().meta({ description: '模型能力标签（vision / tools）' }),
  systemPrompt: z.string().nullable(),
  isEnabled: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string(),
}).meta({ id: 'UserAiConfig' });

export type UserAiConfig = z.infer<typeof userAiConfigSchema>;

// ─── 契约 ────────────────────────────────────────────────────────────────────

export const userAiConfigContract = defineContract('/api/ai/user-configs', {
  list: op.get('/', { response: z.array(userAiConfigSchema), summary: '获取我的 AI 配置列表' }),
  create: op.post('/', { body: saveUserAiConfigSchema, response: userAiConfigSchema, summary: '新增我的 AI 配置' }),
  update: op.put('/{id}', { params: idParam, body: saveUserAiConfigSchema, response: userAiConfigSchema, summary: '更新指定 AI 配置' }),
  remove: op.delete('/{id}', { params: idParam, summary: '删除指定 AI 配置' }),
}, { tags: ['AI'] });
