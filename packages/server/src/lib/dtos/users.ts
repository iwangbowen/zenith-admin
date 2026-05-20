/**
 * 用户相关 DTO
 */
import { z } from '@hono/zod-openapi';
import { PositionDTO } from './positions';
import { RoleDTO } from './roles';
import { auditFields } from './_audit';

export const UserDTO = z
  .object({
    id: z.number().int().openapi({ example: 1 }),
    username: z.string().openapi({ example: 'admin' }),
    nickname: z.string().openapi({ example: '系统管理员' }),
    email: z.string().openapi({ example: 'admin@example.com' }),
    phone: z.string().nullable().optional(),
    avatar: z.string().nullable().optional(),
    departmentId: z.number().int().nullable().optional(),
    departmentName: z.string().nullable().optional(),
    tenantId: z.number().int().nullable().optional(),
    tenantName: z.string().nullable().optional(),
    positionIds: z.array(z.number().int()).optional(),
    positions: z.array(PositionDTO).optional(),
    roles: z.array(RoleDTO).optional(),
    status: z.enum(['enabled', 'disabled']).openapi({ example: 'enabled' }),
    passwordUpdatedAt: z.string().optional(),
    requirePasswordChange: z.boolean().optional(),
    ...auditFields,
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .openapi('User');

export const ImportResultDTO = z
  .object({
    total: z.number().int().openapi({ example: 100 }),
    success: z.number().int().openapi({ example: 95 }),
    failed: z.number().int().openapi({ example: 5 }),
    errors: z
      .array(
        z.object({
          row: z.number().int(),
          message: z.string(),
        }),
      )
      .optional(),
  })
  .openapi('UserImportResult');
