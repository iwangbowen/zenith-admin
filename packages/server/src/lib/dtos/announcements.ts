/**
 * 公告相关 DTO
 */
import { z } from '@hono/zod-openapi';
import { auditFields } from './_audit';

const AnnouncementRecipientDTO = z.object({
  recipientType: z.enum(['user', 'role', 'dept']),
  recipientId: z.number().int(),
  recipientLabel: z.string().optional(),
});

const AnnouncementAttachmentDTO = z.object({
  id: z.number().int(),
  fileId: z.string().uuid(),
  file: z.object({
    id: z.string().uuid(),
    originalName: z.string(),
    size: z.number().int(),
    mimeType: z.string().nullable(),
    extension: z.string().nullable(),
    url: z.string(),
  }),
  sortOrder: z.number().int(),
  createdAt: z.string(),
});

export const AnnouncementDTO = z
  .object({
    id: z.number().int(),
    title: z.string().openapi({ example: '系统维护公告' }),
    content: z.string(),
    type: z.string().openapi({ example: 'notice' }),
    publishStatus: z.string().openapi({ example: 'published' }),
    priority: z.string().openapi({ example: 'medium' }),
    targetType: z.enum(['all', 'specific']),
    publishTime: z.string().nullable(),
    createById: z.number().int().nullable(),
    createByName: z.string().nullable(),
    ...auditFields,
    createdAt: z.string(),
    updatedAt: z.string(),
    recipients: z.array(AnnouncementRecipientDTO).optional(),
    attachments: z.array(AnnouncementAttachmentDTO).optional(),
    readCount: z.number().int().optional(),
  })
  .openapi('Announcement');

export const AnnouncementReadStatsDTO = z
  .object({
    readCount: z.number().int(),
    totalCount: z.number().int(),
    list: z.array(
      z.object({
        id: z.number().int(),
        username: z.string(),
        nickname: z.string(),
        avatar: z.string().nullable(),
        readAt: z.string().optional(),
      }),
    ),
    total: z.number().int(),
    page: z.number().int(),
    pageSize: z.number().int(),
  })
  .openapi('AnnouncementReadStats');

export const AnnouncementUnreadCountDTO = z
  .object({ count: z.number().int() })
  .openapi('AnnouncementUnreadCount');
