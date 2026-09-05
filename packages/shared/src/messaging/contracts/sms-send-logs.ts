import * as z from 'zod';
import { idParam, paginated, paginationQuery } from '../../core/api-schemas';
import { defineContract, op } from '../../core/contract';
import { SEND_SOURCES, SEND_STATUSES, SMS_PROVIDERS } from '../constants';
import { sendSmsSchema } from '../validation';

// ─── 实体 ────────────────────────────────────────────────────────────────────

export const smsSendLogSchema = z.object({
  id: z.int(),
  configId: z.int().nullable(),
  configName: z.string().nullable(),
  templateId: z.int().nullable(),
  templateName: z.string().nullable(),
  provider: z.enum(SMS_PROVIDERS),
  phone: z.string(),
  content: z.string(),
  status: z.enum(SEND_STATUSES),
  errorMsg: z.string().nullable(),
  bizId: z.string().nullable().meta({ description: '服务商回执 ID' }),
  deliveryStatus: z.string().nullable(),
  deliveredAt: z.string().nullable(),
  source: z.enum(SEND_SOURCES),
  userId: z.int().nullable(),
  username: z.string().nullable().meta({ description: '操作人用户名' }),
  ip: z.string().nullable(),
  sentAt: z.string().nullable(),
  createdAt: z.string(),
}).meta({ id: 'SmsSendLog' });

export type SmsSendLog = z.infer<typeof smsSendLogSchema>;

export const smsSendResultSchema = z.object({
  logId: z.int(),
  status: z.enum(SEND_STATUSES),
  bizId: z.string().nullable(),
  errorMsg: z.string().nullable(),
}).meta({ id: 'SmsSendResult' });

export type SmsSendResult = z.infer<typeof smsSendResultSchema>;

// ─── 契约 ────────────────────────────────────────────────────────────────────

export const smsSendLogListQuery = paginationQuery.extend({
  keyword: z.string().optional().meta({ description: '按内容模糊匹配' }),
  phone: z.string().optional(),
  provider: z.enum(SMS_PROVIDERS).optional(),
  status: z.enum(SEND_STATUSES).optional(),
  source: z.enum(SEND_SOURCES).optional(),
});

export const smsSendLogContract = defineContract('/api/sms-send-logs', {
  list: op.get('/', { query: smsSendLogListQuery, response: paginated(smsSendLogSchema), summary: '短信发送记录列表' }),
  testSend: op.post('/test-send', { body: sendSmsSchema, response: smsSendResultSchema, summary: '测试发送短信' }),
  remove: op.delete('/{id}', { params: idParam, summary: '删除短信发送记录' }),
}, { tags: ['SmsSendLogs'] });
