/**
 * 邮件模板 / 邮件发送记录 DTO
 */
import { z } from '@hono/zod-openapi';
import { auditFields } from './_audit';

export const EmailTemplateDTO = z
  .object({
    id: z.number().int(),
    name: z.string(),
    code: z.string(),
    subject: z.string(),
    content: z.string(),
    variables: z.string().nullable(),
    status: z.enum(['enabled', 'disabled']),
    remark: z.string().nullable(),
    ...auditFields,
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .openapi('EmailTemplate');

export const EmailSendLogDTO = z
  .object({
    id: z.number().int(),
    templateId: z.number().int().nullable(),
    templateName: z.string().nullable(),
    toEmail: z.string(),
    subject: z.string(),
    content: z.string(),
    status: z.enum(['pending', 'success', 'failed']),
    errorMsg: z.string().nullable(),
    source: z.enum(['manual', 'test', 'system', 'api']),
    userId: z.number().int().nullable(),
    username: z.string().nullable(),
    ip: z.string().nullable(),
    sentAt: z.string().nullable(),
    createdAt: z.string(),
  })
  .openapi('EmailSendLog');

export const EmailSendResultDTO = z
  .object({
    logId: z.number().int(),
    status: z.enum(['pending', 'success', 'failed']),
    errorMsg: z.string().nullable(),
  })
  .openapi('EmailSendResult');
