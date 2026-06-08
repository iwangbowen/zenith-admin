/**
 * 部门相关 DTO
 */
import { z } from '@hono/zod-openapi';
import { auditFields } from './_audit';

export const DepartmentUserPreviewDTO = z.object({
  id: z.number().int(),
  nickname: z.string(),
  avatar: z.string().nullable().optional(),
});

export const DepartmentDTO: z.ZodType = z
  .object({
    id: z.number().int(),
    parentId: z.number().int().openapi({ example: 0 }),
    name: z.string().openapi({ example: '技术部' }),
    code: z.string(),
    category: z.string().openapi({ example: 'department' }),
    leaderId: z.number().int().nullable().optional(),
    leaderName: z.string().nullable().optional(),
    phone: z.string().optional(),
    email: z.string().optional(),
    sort: z.number().int(),
    status: z.enum(['enabled', 'disabled']),
    userCount: z.number().int().optional().openapi({ example: 5 }),
    userPreview: z.array(DepartmentUserPreviewDTO).optional(),
    ...auditFields,
    createdAt: z.string(),
    updatedAt: z.string(),
    get children() {
      return z.array(DepartmentDTO).optional();
    },
  })
  .openapi('Department');
