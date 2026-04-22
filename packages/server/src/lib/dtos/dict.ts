/**
 * 字典相关 DTO
 */
import { z } from '@hono/zod-openapi';

export const DictDTO = z
  .object({
    id: z.number().int(),
    name: z.string().openapi({ example: '用户状态' }),
    code: z.string().openapi({ example: 'user_status' }),
    description: z.string().nullable().optional(),
    status: z.enum(['active', 'disabled']),
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .openapi('Dict');

export const DictItemDTO = z
  .object({
    id: z.number().int(),
    dictId: z.number().int(),
    label: z.string().openapi({ example: '启用' }),
    value: z.string().openapi({ example: 'active' }),
    color: z.string().nullable().optional(),
    sort: z.number().int(),
    status: z.enum(['active', 'disabled']),
    remark: z.string().nullable().optional(),
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .openapi('DictItem');
