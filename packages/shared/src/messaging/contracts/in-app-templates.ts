import * as z from 'zod';
import { entityStatusSchema, idParam, paginated, paginationQuery } from '../../core/api-schemas';
import { defineContract, op } from '../../core/contract';
import { IN_APP_MESSAGE_TYPES } from '../constants';
import { createInAppTemplateSchema, updateInAppTemplateSchema } from '../validation';

// ─── 实体 ────────────────────────────────────────────────────────────────────

export const inAppTemplateSchema = z.object({
  id: z.int(),
  name: z.string(),
  code: z.string().meta({ example: 'task_assigned' }),
  title: z.string(),
  content: z.string(),
  type: z.enum(IN_APP_MESSAGE_TYPES),
  variables: z.string().nullable().meta({ description: '模板变量说明（逗号分隔）' }),
  status: entityStatusSchema,
  remark: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
}).meta({ id: 'InAppTemplate' });

export type InAppTemplate = z.infer<typeof inAppTemplateSchema>;

// ─── 契约 ────────────────────────────────────────────────────────────────────

export const inAppTemplateListQuery = paginationQuery.extend({
  keyword: z.string().optional().meta({ description: '按名称 / 编码模糊匹配' }),
  type: z.enum(IN_APP_MESSAGE_TYPES).optional(),
  status: entityStatusSchema.optional(),
});

export const inAppTemplateContract = defineContract('/api/in-app-templates', {
  list: op.get('/', { query: inAppTemplateListQuery, response: paginated(inAppTemplateSchema), summary: '站内信模板列表' }),
  detail: op.get('/{id}', { params: idParam, response: inAppTemplateSchema, summary: '获取站内信模板详情' }),
  create: op.post('/', { body: createInAppTemplateSchema, response: inAppTemplateSchema, summary: '创建站内信模板' }),
  update: op.put('/{id}', { params: idParam, body: updateInAppTemplateSchema, response: inAppTemplateSchema, summary: '更新站内信模板' }),
  remove: op.delete('/{id}', { params: idParam, summary: '删除站内信模板' }),
}, { tags: ['InAppTemplates'] });
