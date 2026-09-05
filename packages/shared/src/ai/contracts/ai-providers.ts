import * as z from 'zod';
import { idParam } from '../../core/api-schemas';
import { defineContract, op } from '../../core/contract';
import {
  aiModelCapabilitiesSchema,
  aiModelFallbackRefSchema,
  aiModelSettingsSchema,
  createAiProviderConfigSchema,
  fetchAiModelsSchema,
  testAiConnectionSchema,
  updateAiProviderConfigSchema,
} from '../validation';

// ─── 实体 ────────────────────────────────────────────────────────────────────

/** 系统级 AI 服务商配置（API Key 脱敏） */
export const aiProviderConfigSchema = z.object({
  id: z.int(),
  name: z.string().meta({ description: '配置名称' }),
  providerId: z.string().meta({ description: "Mastra 模型目录 provider ID（'openai' / 'anthropic' / ...）或 'custom'（OpenAI 兼容自定义端点）" }),
  baseUrl: z.string().nullable().meta({ description: 'API 地址：custom 必填；目录服务商留空走官方端点，填写则覆盖' }),
  apiKey: z.string().meta({ description: 'API Key（脱敏）' }),
  headers: z.record(z.string(), z.string()).nullable().meta({ description: '自定义请求头（组织 ID 等）' }),
  models: z.array(z.string()).meta({ description: '启用的模型列表（裸模型 ID，聊天时可切换）' }),
  defaultModel: z.string().meta({ description: '默认模型（必须包含在 models 中）' }),
  modelSettings: aiModelSettingsSchema.nullable().meta({ description: '模型调用默认设置（Mastra ModelSettings 子集）' }),
  providerOptions: z.record(z.string(), z.record(z.string(), z.unknown())).nullable().meta({ description: '服务商特定选项（如 openai.reasoningEffort，按 provider 分组透传）' }),
  fallbacks: z.array(aiModelFallbackRefSchema).nullable().meta({ description: '多级降级链：主模型失败（5xx/限流/超时）后按序切换' }),
  capabilities: aiModelCapabilitiesSchema.nullable().meta({ description: '模型能力标签（custom 服务商手工标注；目录服务商可由 Mastra 能力数据补充）' }),
  priceInputPerM: z.int().nullable().meta({ description: '输入单价（分 / 百万 token），null = 未配置不计成本' }),
  priceOutputPerM: z.int().nullable().meta({ description: '输出单价（分 / 百万 token），null = 未配置不计成本' }),
  isDefault: z.boolean(),
  isEnabled: z.boolean(),
  maxConcurrent: z.int().nullable().meta({ description: '并发流上限（null/0 = 不限）' }),
  createdAt: z.string(),
  updatedAt: z.string(),
}).meta({ id: 'AiProviderConfig' });

export type AiProviderConfig = z.infer<typeof aiProviderConfigSchema>;

/** 服务商目录条目（来自 Mastra PROVIDER_REGISTRY） */
export const aiProviderCatalogEntrySchema = z.object({
  id: z.string().meta({ description: 'Mastra provider ID' }),
  name: z.string().meta({ description: '显示名' }),
  docUrl: z.string().nullable().meta({ description: '官方文档链接' }),
  common: z.boolean().meta({ description: '是否常用服务商（AI_COMMON_PROVIDERS 内）' }),
  modelCount: z.int().meta({ description: '目录内可用模型数量（模型清单经 /catalog/{providerId}/models 获取）' }),
}).meta({ id: 'AiProviderCatalogEntry' });

export type AiProviderCatalogEntry = z.infer<typeof aiProviderCatalogEntrySchema>;

export const testAiConnectionResultSchema = z.object({
  success: z.boolean(),
  message: z.string(),
}).meta({ id: 'TestAiConnectionResult' });

export type TestAiConnectionResult = z.infer<typeof testAiConnectionResultSchema>;

// ─── 入参 ────────────────────────────────────────────────────────────────────

export const aiCatalogProviderParam = z.object({
  providerId: z.string().meta({ description: 'Mastra provider ID', example: 'openai' }),
});

// ─── 契约 ────────────────────────────────────────────────────────────────────

export const aiProviderContract = defineContract('/api/ai/providers', {
  list: op.get('/', { response: z.array(aiProviderConfigSchema), summary: '获取 AI 服务商配置列表' }),
  catalog: op.get('/catalog', { response: z.array(aiProviderCatalogEntrySchema), summary: '服务商目录（Mastra 模型目录,常用项排前,custom 恒在首位）' }),
  catalogModels: op.get('/catalog/{providerId}/models', { params: aiCatalogProviderParam, response: z.array(z.string()), summary: '目录内某服务商的模型清单' }),
  detail: op.get('/{id}', { params: idParam, response: aiProviderConfigSchema, summary: '获取 AI 服务商配置详情' }),
  create: op.post('/', { body: createAiProviderConfigSchema, response: aiProviderConfigSchema, summary: '创建 AI 服务商配置' }),
  update: op.put('/{id}', { params: idParam, body: updateAiProviderConfigSchema, response: aiProviderConfigSchema, summary: '更新 AI 服务商配置' }),
  remove: op.delete('/{id}', { params: idParam, summary: '删除 AI 服务商配置' }),
  setDefault: op.post('/{id}/set-default', { params: idParam, response: aiProviderConfigSchema, summary: '设为默认 AI 服务商' }),
  testConnection: op.post('/test-connection', { body: testAiConnectionSchema, response: testAiConnectionResultSchema, summary: '测试 AI 服务商连接' }),
  fetchModels: op.post('/fetch-models', { body: fetchAiModelsSchema, response: z.array(z.string()), summary: '从供应商 API 自动发现可用模型列表' }),
}, { tags: ['AI'] });
