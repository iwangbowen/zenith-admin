import * as z from 'zod';
import { idParam, paginated, paginationQuery } from '../../core/api-schemas';
import { defineContract, op } from '../../core/contract';
import { AI_PROMPT_SCOPES } from '../constants';
import { createAiPromptTemplateSchema, updateAiPromptTemplateSchema } from '../validation';

// ─── 实体 ────────────────────────────────────────────────────────────────────

export const aiPromptTemplateSchema = z.object({
  id: z.int(),
  name: z.string(),
  content: z.string().meta({ description: '提示词内容' }),
  description: z.string().nullable(),
  category: z.string().nullable(),
  scope: z.enum(AI_PROMPT_SCOPES).meta({ description: '范围：system=系统级, user=用户私有' }),
  userId: z.int().nullable().meta({ description: '归属用户 ID（用户私有模板）' }),
  isBuiltin: z.boolean().meta({ description: '是否内置预设（不可删除）' }),
  sort: z.int(),
  usageCount: z.int().meta({ description: '被应用为对话角色的累计次数' }),
  isEnabled: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string(),
}).meta({ id: 'AiPromptTemplate' });

export type AiPromptTemplate = z.infer<typeof aiPromptTemplateSchema>;

/** 提示词模板历史版本快照（内容变更时自动留档） */
export const aiPromptTemplateVersionSchema = z.object({
  id: z.int(),
  templateId: z.int(),
  version: z.int(),
  name: z.string().meta({ description: '当时的模板名称' }),
  content: z.string().meta({ description: '当时的模板内容' }),
  createdBy: z.int().nullable().meta({ description: '操作人 ID' }),
  creatorName: z.string().nullable().meta({ description: '操作人名称' }),
  createdAt: z.string().meta({ description: '留档时间' }),
}).meta({ id: 'AiPromptTemplateVersion' });

export type AiPromptTemplateVersion = z.infer<typeof aiPromptTemplateVersionSchema>;

// ─── 路径 / 查询参数 ─────────────────────────────────────────────────────────

export const aiPromptTemplateListQuery = paginationQuery.extend({
  scope: z.enum(AI_PROMPT_SCOPES).optional().meta({ description: '范围筛选：system / user' }),
  keyword: z.string().max(100).optional().meta({ description: '搜索关键词（名称或描述）' }),
});

/** `{id}` 模板 + `{versionId}` 历史版本 */
export const aiPromptTemplateVersionParams = idParam.extend({
  versionId: z.coerce.number().int().positive().meta({ description: '历史版本 ID', example: 1 }),
});

// ─── 契约 ────────────────────────────────────────────────────────────────────

export const aiPromptTemplateContract = defineContract('/api/ai/prompt-templates', {
  list: op.get('/', { query: aiPromptTemplateListQuery, response: paginated(aiPromptTemplateSchema), summary: '获取提示词模板列表' }),
  all: op.get('/available', { response: z.array(aiPromptTemplateSchema), summary: '获取可用提示词模板（聊天选择器用，仅需登录）' }),
  use: op.post('/{id}/use', { params: idParam, summary: '记录模板被应用为对话角色一次（使用统计）' }),
  detail: op.get('/{id}', { params: idParam, response: aiPromptTemplateSchema, summary: '获取提示词模板详情' }),
  versions: op.get('/{id}/versions', { params: idParam, response: z.array(aiPromptTemplateVersionSchema), summary: '获取提示词模板历史版本列表' }),
  restoreVersion: op.post('/{id}/versions/{versionId}/restore', { params: aiPromptTemplateVersionParams, response: aiPromptTemplateSchema, summary: '恢复到指定历史版本（当前内容自动留档）' }),
  create: op.post('/', { body: createAiPromptTemplateSchema, response: aiPromptTemplateSchema, summary: '创建提示词模板' }),
  update: op.put('/{id}', { params: idParam, body: updateAiPromptTemplateSchema, response: aiPromptTemplateSchema, summary: '更新提示词模板' }),
  remove: op.delete('/{id}', { params: idParam, summary: '删除提示词模板' }),
}, { tags: ['AI'] });
