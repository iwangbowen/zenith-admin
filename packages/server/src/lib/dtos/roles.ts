/**
 * 角色相关 DTO
 */
import { z } from '@hono/zod-openapi';
import { auditFields } from './_audit';

export const RoleDTO = z
  .object({
    id: z.number().int().openapi({ example: 1 }),
    name: z.string().openapi({ example: '超级管理员' }),
    code: z.string().openapi({ example: 'super_admin' }),
    description: z.string().nullable().optional(),
    dataScope: z.enum(['all', 'dept', 'self']).optional().openapi({ example: 'all' }),
    tenantId: z.number().int().nullable().optional(),
    status: z.enum(['enabled', 'disabled']).openapi({ example: 'enabled' }),
    ...auditFields,
    createdAt: z.string().openapi({ example: '2026-01-01 00:00:00' }),
    updatedAt: z.string().openapi({ example: '2026-01-01 00:00:00' }),
    menuIds: z.array(z.number().int()).optional(),
    deptScopeIds: z.array(z.number().int()).optional().openapi({ description: '角色管理范围（部门 id 列表），空表示全员' }),
  })
  .openapi('Role');
