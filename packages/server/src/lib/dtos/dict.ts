/**
 * 字典相关 DTO
 */
import { z } from '@hono/zod-openapi';
import { auditFields } from './_audit';

export const DictDTO = z
  .object({
    id: z.number().int(),
    name: z.string().openapi({ example: '用户状态' }),
    code: z.string().openapi({ example: 'user_status' }),
    description: z.string().nullable().optional(),
    status: z.enum(['enabled', 'disabled']),
    ...auditFields,
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .openapi('Dict');

export const DictItemDTO = z
  .object({
    id: z.number().int(),
    dictId: z.number().int(),
    parentId: z.number().int().nullable().optional(),
    label: z.string().openapi({ example: '启用' }),
    value: z.string().openapi({ example: 'enabled' }),
    color: z.string().nullable().optional(),
    sort: z.number().int(),
    status: z.enum(['enabled', 'disabled']),
    remark: z.string().nullable().optional(),
    metadata: z.any().optional(),
    ...auditFields,
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .openapi('DictItem');
