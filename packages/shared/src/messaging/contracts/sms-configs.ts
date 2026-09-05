import * as z from 'zod';
import { entityStatusSchema, idParam, paginated, paginationQuery } from '../../core/api-schemas';
import { defineContract, op } from '../../core/contract';
import { SMS_PROVIDERS } from '../constants';
import { createSmsConfigSchema, updateSmsConfigSchema } from '../validation';

// ─── 实体 ────────────────────────────────────────────────────────────────────

/** 短信服务商配置：列表脱敏 accessKeyId 且不含 accessKeySecret；详情回传原文 accessKeyId 与空 accessKeySecret（留空即不更新） */
export const smsConfigSchema = z.object({
  id: z.int(),
  name: z.string(),
  provider: z.enum(SMS_PROVIDERS),
  accessKeyId: z.string(),
  accessKeySecret: z.string().optional().meta({ description: '仅详情返回，恒为空串；编辑留空表示保持原值' }),
  region: z.string().nullable(),
  signName: z.string(),
  isDefault: z.boolean(),
  status: entityStatusSchema,
  remark: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
}).meta({ id: 'SmsConfig' });

export type SmsConfig = z.infer<typeof smsConfigSchema>;

// ─── 契约 ────────────────────────────────────────────────────────────────────

export const smsConfigListQuery = paginationQuery.extend({
  keyword: z.string().optional().meta({ description: '按名称 / 签名模糊匹配' }),
  provider: z.enum(SMS_PROVIDERS).optional(),
  status: entityStatusSchema.optional(),
});

export const smsConfigContract = defineContract('/api/sms-configs', {
  list: op.get('/', { query: smsConfigListQuery, response: paginated(smsConfigSchema), summary: '短信配置列表' }),
  detail: op.get('/{id}', { params: idParam, response: smsConfigSchema, summary: '获取短信配置详情' }),
  create: op.post('/', { body: createSmsConfigSchema, response: smsConfigSchema, summary: '创建短信配置' }),
  update: op.put('/{id}', { params: idParam, body: updateSmsConfigSchema, response: smsConfigSchema, summary: '更新短信配置' }),
  setDefault: op.post('/{id}/default', { params: idParam, response: smsConfigSchema, summary: '设为默认短信配置' }),
  remove: op.delete('/{id}', { params: idParam, summary: '删除短信配置' }),
}, { tags: ['SmsConfigs'] });
