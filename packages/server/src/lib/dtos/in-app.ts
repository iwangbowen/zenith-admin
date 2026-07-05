/**
 * 站内信模板 / 站内信收件记录 DTO
 */
import { z } from '@hono/zod-openapi';
import { auditFields } from './_audit';

export const InAppTemplateDTO = z
  .object({
    id: z.number().int(),
    name: z.string(),
    code: z.string(),
    title: z.string(),
    content: z.string(),
    type: z.enum(['info', 'success', 'warning', 'error']),
    variables: z.string().nullable(),
    status: z.enum(['enabled', 'disabled']),
    remark: z.string().nullable(),
    ...auditFields,
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .openapi('InAppTemplate');

export const InAppMessageDTO = z
  .object({
    id: z.number().int(),
    templateId: z.number().int().nullable(),
    templateName: z.string().nullable(),
    userId: z.number().int(),
    username: z.string().nullable(),
    title: z.string(),
    content: z.string(),
    type: z.enum(['info', 'success', 'warning', 'error']),
    isRead: z.boolean(),
    readAt: z.string().nullable(),
    source: z.enum(['manual', 'test', 'system', 'api']),
    senderId: z.number().int().nullable(),
    senderName: z.string().nullable(),
    link: z.string().nullable().optional(),
    createdAt: z.string(),
  })
  .openapi('InAppMessage');

export const InAppSendResultDTO = z
  .object({
    sentCount: z.number().int(),
  })
  .openapi('InAppSendResult');

export const UnreadCountDTO = z
  .object({
    count: z.number().int(),
  })
  .openapi('UnreadCount');
