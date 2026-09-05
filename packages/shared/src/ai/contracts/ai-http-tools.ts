import * as z from 'zod';
import { idParam } from '../../core/api-schemas';
import { defineContract, op } from '../../core/contract';
import { AI_TOOL_SOURCES } from '../constants';
import { aiHttpToolParamSchema, createAiHttpToolSchema, updateAiHttpToolSchema } from '../validation';

// ─── 实体 ────────────────────────────────────────────────────────────────────

/** 管理员配置的 HTTP API 工具（动态注入 function calling 工具集） */
export const aiHttpToolSchema = z.object({
  id: z.int(),
  name: z.string().meta({ description: '工具函数名（与内置工具共用命名空间）' }),
  description: z.string().meta({ description: '工具描述（供 LLM 理解用途）' }),
  method: z.string().meta({ description: 'HTTP 方法' }),
  urlTemplate: z.string().meta({ description: 'URL 模板（支持 {param} 占位符）' }),
  headers: z.record(z.string(), z.string()).nullable().meta({ description: '附加请求头' }),
  params: z.array(aiHttpToolParamSchema).meta({ description: '参数定义' }),
  isEnabled: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string(),
}).meta({ id: 'AiHttpTool' });

export type AiHttpTool = z.infer<typeof aiHttpToolSchema>;

/** 工具选择器条目（内置 + HTTP 工具统一视图） */
export const aiToolInfoSchema = z.object({
  name: z.string(),
  description: z.string(),
  source: z.enum(AI_TOOL_SOURCES),
}).meta({ id: 'AiToolInfo' });

export type AiToolInfo = z.infer<typeof aiToolInfoSchema>;

// ─── 契约 ────────────────────────────────────────────────────────────────────

export const aiHttpToolContract = defineContract('/api/ai/http-tools', {
  list: op.get('/', { response: z.array(aiHttpToolSchema), summary: '获取 HTTP API 工具列表（管理员）' }),
  all: op.get('/available', { response: z.array(aiToolInfoSchema), summary: '获取可用工具列表（智能体编辑器勾选用，仅需登录）' }),
  create: op.post('/', { body: createAiHttpToolSchema, response: aiHttpToolSchema, summary: '创建 HTTP API 工具' }),
  update: op.put('/{id}', { params: idParam, body: updateAiHttpToolSchema, response: aiHttpToolSchema, summary: '更新 HTTP API 工具' }),
  remove: op.delete('/{id}', { params: idParam, summary: '删除 HTTP API 工具' }),
}, { tags: ['AI'] });
