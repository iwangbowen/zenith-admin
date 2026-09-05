import * as z from 'zod';
import { idParam } from '../../core/api-schemas';
import { defineContract, op } from '../../core/contract';
import { aiModelSettingsSchema, createAiAgentSchema, updateAiAgentSchema } from '../validation';

// ─── 实体 ────────────────────────────────────────────────────────────────────

/** 自定义智能体(Mastra AgentConfig 形状;创建即用) */
export const aiAgentSchema = z.object({
  id: z.int(),
  userId: z.int().meta({ description: '创建者用户 ID' }),
  name: z.string(),
  description: z.string().nullable(),
  avatar: z.string().meta({ description: '头像 emoji' }),
  instructions: z.string().meta({ description: 'Agent 指令(Mastra instructions)' }),
  configId: z.int().nullable().meta({ description: '指定服务商配置（null = 系统默认）' }),
  model: z.string().nullable().meta({ description: '指定模型（null = 配置默认）' }),
  modelSettings: aiModelSettingsSchema.nullable().meta({ description: '模型调用设置(Mastra ModelSettings 子集)' }),
  maxSteps: z.int().nullable().meta({ description: '工具循环最大步数(null = 系统默认)' }),
  knowledgeBaseId: z.int().nullable().meta({ description: '绑定知识库' }),
  tools: z.array(z.string()).meta({ description: '启用的工具名集合' }),
  openingMessage: z.string().nullable().meta({ description: '开场白' }),
  suggestedQuestions: z.array(z.string()).meta({ description: '建议问题' }),
  usageCount: z.int(),
  isEnabled: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string(),
}).meta({ id: 'AiAgent' });

export type AiAgent = z.infer<typeof aiAgentSchema>;

/** 编程式内置智能体(代码定义、注册进 Mastra;列表只读展示,可直接对话) */
export const aiBuiltinAgentSchema = z.object({
  agentId: z.string().meta({ description: 'Mastra agent ID(如 biz-ops-assistant)' }),
  name: z.string(),
  description: z.string().nullable(),
  avatar: z.string().meta({ description: '头像 emoji' }),
  openingMessage: z.string().nullable(),
  suggestedQuestions: z.array(z.string()),
}).meta({ id: 'AiBuiltinAgent' });

export type AiBuiltinAgent = z.infer<typeof aiBuiltinAgentSchema>;

// ─── 契约 ────────────────────────────────────────────────────────────────────

export const aiAgentContract = defineContract('/api/ai/agents', {
  list: op.get('/', { response: z.array(aiAgentSchema), summary: '获取我的智能体列表' }),
  builtin: op.get('/builtin', { response: z.array(aiBuiltinAgentSchema), summary: '内置智能体列表(编程式定义,只读)' }),
  detail: op.get('/{id}', { params: idParam, response: aiAgentSchema, summary: '获取智能体详情（仅创建者）' }),
  create: op.post('/', { body: createAiAgentSchema, response: aiAgentSchema, summary: '创建智能体（创建即用）' }),
  update: op.put('/{id}', { params: idParam, body: updateAiAgentSchema, response: aiAgentSchema, summary: '更新智能体（仅创建者）' }),
  remove: op.delete('/{id}', { params: idParam, summary: '删除智能体（仅创建者）' }),
}, { tags: ['AI'] });
