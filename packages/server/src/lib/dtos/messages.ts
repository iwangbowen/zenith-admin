/**
 * 消息模板相关 DTO
 */
import { z } from '@hono/zod-openapi';

export const MessageTemplateDTO = z
  .object({
    id: z.number().int(),
    name: z.string(),
    code: z.string(),
    channel: z.enum(['email', 'sms', 'in_app']),
    subject: z.string().nullable().optional(),
    content: z.string(),
    variables: z.string().nullable().optional(),
    status: z.enum(['active', 'disabled']),
    remark: z.string().nullable().optional(),
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .openapi('MessageTemplate');

export const MessageTemplatePreviewDTO = z
  .object({ subject: z.string().nullable(), content: z.string() })
  .openapi('MessageTemplatePreview');
