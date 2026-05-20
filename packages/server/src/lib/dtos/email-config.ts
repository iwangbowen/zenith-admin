/**
 * 邮件配置相关 DTO
 */
import { z } from '@hono/zod-openapi';
import { auditFields } from './_audit';

export const EmailConfigDTO = z
  .object({
    id: z.number().int(),
    smtpHost: z.string().nullable().optional(),
    smtpPort: z.number().nullable().optional(),
    smtpUser: z.string().nullable().optional(),
    fromName: z.string().nullable().optional(),
    fromEmail: z.string().nullable().optional(),
    encryption: z.string().nullable().optional(),
    ...auditFields,
    updatedAt: z.union([z.string(), z.date()]).nullable().optional(),
    createdAt: z.union([z.string(), z.date()]).nullable().optional(),
  })
  .openapi('EmailConfig');
