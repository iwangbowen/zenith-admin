import * as z from 'zod';
import { entityStatusSchema, idParam, paginated, paginationQuery } from '../../core/api-schemas';
import { defineContract, op } from '../../core/contract';
import { SMS_PROVIDERS } from '../constants';
import { createSmsTemplateSchema, updateSmsTemplateSchema } from '../validation';

// ─── 实体 ────────────────────────────────────────────────────────────────────

export const smsTemplateSchema = z.object({
  id: z.int(),
  name: z.string(),
  code: z.string().meta({ example: 'login_code' }),
  templateCode: z.string().meta({ description: '服务商侧模板 ID' }),
  signName: z.string().nullable(),
  content: z.string(),
  variables: z.string().nullable().meta({ description: '模板变量说明（逗号分隔）' }),
  provider: z.enum(SMS_PROVIDERS),
  status: entityStatusSchema,
  remark: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
}).meta({ id: 'SmsTemplate' });

export type SmsTemplate = z.infer<typeof smsTemplateSchema>;

// ─── 契约 ────────────────────────────────────────────────────────────────────

export const smsTemplateListQuery = paginationQuery.extend({
  keyword: z.string().optional().meta({ description: '按名称 / 编码模糊匹配' }),
  provider: z.enum(SMS_PROVIDERS).optional(),
  status: entityStatusSchema.optional(),
});

export const smsTemplateContract = defineContract('/api/sms-templates', {
  list: op.get('/', { query: smsTemplateListQuery, response: paginated(smsTemplateSchema), summary: '短信模板列表' }),
  detail: op.get('/{id}', { params: idParam, response: smsTemplateSchema, summary: '获取短信模板详情' }),
  create: op.post('/', { body: createSmsTemplateSchema, response: smsTemplateSchema, summary: '创建短信模板' }),
  update: op.put('/{id}', { params: idParam, body: updateSmsTemplateSchema, response: smsTemplateSchema, summary: '更新短信模板' }),
  remove: op.delete('/{id}', { params: idParam, summary: '删除短信模板' }),
}, { tags: ['SmsTemplates'] });
