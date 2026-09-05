import * as z from 'zod';
import { idParam, paginated, paginationQuery } from '../../core/api-schemas';
import { defineContract, op } from '../../core/contract';
import { SEND_SOURCES, SEND_STATUSES } from '../constants';
import { sendEmailSchema } from '../validation';

// ─── 实体 ────────────────────────────────────────────────────────────────────

export const emailSendLogSchema = z.object({
  id: z.int(),
  templateId: z.int().nullable(),
  templateName: z.string().nullable(),
  toEmail: z.string(),
  subject: z.string(),
  content: z.string(),
  status: z.enum(SEND_STATUSES),
  errorMsg: z.string().nullable(),
  source: z.enum(SEND_SOURCES),
  userId: z.int().nullable(),
  username: z.string().nullable().meta({ description: '操作人用户名' }),
  ip: z.string().nullable(),
  sentAt: z.string().nullable(),
  createdAt: z.string(),
}).meta({ id: 'EmailSendLog' });

export type EmailSendLog = z.infer<typeof emailSendLogSchema>;

export const emailSendResultSchema = z.object({
  logId: z.int(),
  status: z.enum(SEND_STATUSES),
  errorMsg: z.string().nullable(),
}).meta({ id: 'EmailSendResult' });

export type EmailSendResult = z.infer<typeof emailSendResultSchema>;

// ─── 契约 ────────────────────────────────────────────────────────────────────

export const emailSendLogListQuery = paginationQuery.extend({
  keyword: z.string().optional().meta({ description: '按主题模糊匹配' }),
  toEmail: z.string().optional(),
  status: z.enum(SEND_STATUSES).optional(),
  source: z.enum(SEND_SOURCES).optional(),
});

export const emailSendLogContract = defineContract('/api/email-send-logs', {
  list: op.get('/', { query: emailSendLogListQuery, response: paginated(emailSendLogSchema), summary: '邮件发送记录列表' }),
  testSend: op.post('/test-send', { body: sendEmailSchema, response: emailSendResultSchema, summary: '测试发送邮件' }),
  remove: op.delete('/{id}', { params: idParam, summary: '删除邮件发送记录' }),
}, { tags: ['EmailSendLogs'] });
