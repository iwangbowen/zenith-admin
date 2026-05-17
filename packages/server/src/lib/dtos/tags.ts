/**
 * 标签相关 DTO
 */
import { z } from '@hono/zod-openapi';

export const TagDTO = z
  .object({
    id: z.number().int(),
    name: z.string().openapi({ example: '重要' }),
    color: z.string().nullable().openapi({ example: '#2563eb' }),
    groupName: z.string().nullable().openapi({ example: '用户标签' }),
    description: z.string().nullable(),
    status: z.enum(['enabled', 'disabled']),
    sortOrder: z.number().int(),
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .openapi('Tag');
