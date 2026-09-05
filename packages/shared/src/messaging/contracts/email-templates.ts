import * as z from 'zod';
import { entityStatusSchema, idParam, paginated, paginationQuery } from '../../core/api-schemas';
import { defineContract, op } from '../../core/contract';
import { createEmailTemplateSchema, updateEmailTemplateSchema } from '../validation';

// ─── 实体 ────────────────────────────────────────────────────────────────────

export const emailTemplateSchema = z.object({
  id: z.int(),
  name: z.string(),
  code: z.string().meta({ example: 'welcome' }),
  subject: z.string(),
  content: z.string(),
  variables: z.string().nullable().meta({ description: '模板变量说明（逗号分隔）' }),
  status: entityStatusSchema,
  remark: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
}).meta({ id: 'EmailTemplate' });

export type EmailTemplate = z.infer<typeof emailTemplateSchema>;

// ─── 契约 ────────────────────────────────────────────────────────────────────

export const emailTemplateListQuery = paginationQuery.extend({
  keyword: z.string().optional().meta({ description: '按名称 / 编码模糊匹配' }),
  status: entityStatusSchema.optional(),
});

export const emailTemplateContract = defineContract('/api/email-templates', {
  list: op.get('/', { query: emailTemplateListQuery, response: paginated(emailTemplateSchema), summary: '邮件模板列表' }),
  detail: op.get('/{id}', { params: idParam, response: emailTemplateSchema, summary: '获取邮件模板详情' }),
  create: op.post('/', { body: createEmailTemplateSchema, response: emailTemplateSchema, summary: '创建邮件模板' }),
  update: op.put('/{id}', { params: idParam, body: updateEmailTemplateSchema, response: emailTemplateSchema, summary: '更新邮件模板' }),
  remove: op.delete('/{id}', { params: idParam, summary: '删除邮件模板' }),
}, { tags: ['EmailTemplates'] });
