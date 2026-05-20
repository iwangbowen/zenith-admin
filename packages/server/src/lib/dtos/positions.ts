/**
 * 岗位相关 DTO
 */
import { z } from '@hono/zod-openapi';
import { auditFields } from './_audit';

export const PositionDTO = z
  .object({
    id: z.number().int(),
    name: z.string().openapi({ example: '前端工程师' }),
    code: z.string().openapi({ example: 'frontend_dev' }),
    sort: z.number().int().openapi({ example: 1 }),
    status: z.enum(['enabled', 'disabled']),
    remark: z.string().nullable().optional(),
    ...auditFields,
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .openapi('Position');
