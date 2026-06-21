/**
 * 租户相关 DTO
 */
import { z } from '@hono/zod-openapi';
import { auditFields } from './_audit';

export const TenantDTO = z
  .object({
    id: z.number().int(),
    name: z.string().openapi({ example: '示例租户' }),
    code: z.string().openapi({ example: 'demo' }),
    logo: z.string().nullable().optional(),
    contactName: z.string().nullable().optional(),
    contactPhone: z.string().nullable().optional(),
    status: z.enum(['enabled', 'disabled']),
    expireAt: z.string().nullable().optional(),
    maxUsers: z.number().int().nullable().optional(),
    packageId: z.number().int().nullable().optional(),
    packageName: z.string().nullable().optional(),
    userCount: z.number().int().optional().openapi({ description: '租户当前用户数（列表返回）' }),
    remark: z.string().nullable().optional(),
    ...auditFields,
    createdAt: z.string().optional(),
    updatedAt: z.string().optional(),
  })
  .openapi('Tenant');

export const TenantStatsDTO = z
  .object({
    id: z.number().int(),
    name: z.string(),
    code: z.string(),
    status: z.enum(['enabled', 'disabled']),
    userCount: z.number().int(),
    maxUsers: z.number().int().nullable(),
    departmentCount: z.number().int(),
    roleCount: z.number().int(),
    positionCount: z.number().int(),
    packageId: z.number().int().nullable(),
    packageName: z.string().nullable(),
    packageMenuCount: z.number().int(),
    expireAt: z.string().nullable(),
    daysToExpire: z.number().int().nullable().openapi({ description: '距到期天数；null=永不过期，负数=已过期' }),
  })
  .openapi('TenantStats');

export const TenantPackageDTO = z
  .object({
    id: z.number().int(),
    name: z.string().openapi({ example: '标准版' }),
    status: z.enum(['enabled', 'disabled']),
    remark: z.string().nullable().optional(),
    menuIds: z.array(z.number().int()).optional().openapi({ description: '关联的菜单 ID（详情返回）' }),
    menuCount: z.number().int().optional().openapi({ description: '已关联菜单数量（列表返回）' }),
    ...auditFields,
    createdAt: z.string().optional(),
    updatedAt: z.string().optional(),
  })
  .openapi('TenantPackage');
