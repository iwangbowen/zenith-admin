/**
 * IAM 相关 DTO：用户、角色、菜单、部门、租户、岗位、会话、API Token
 */
import { z } from '@hono/zod-openapi';

export const RoleDTO = z
  .object({
    id: z.number().int().openapi({ example: 1 }),
    name: z.string().openapi({ example: '超级管理员' }),
    code: z.string().openapi({ example: 'super_admin' }),
    description: z.string().nullable().optional(),
    dataScope: z.enum(['all', 'dept', 'self']).optional().openapi({ example: 'all' }),
    tenantId: z.number().int().nullable().optional(),
    status: z.enum(['active', 'disabled']).openapi({ example: 'active' }),
    createdAt: z.string().openapi({ example: '2026-01-01 00:00:00' }),
    updatedAt: z.string().openapi({ example: '2026-01-01 00:00:00' }),
    menuIds: z.array(z.number().int()).optional(),
  })
  .openapi('Role');

export const PositionDTO = z
  .object({
    id: z.number().int(),
    name: z.string().openapi({ example: '前端工程师' }),
    code: z.string().openapi({ example: 'frontend_dev' }),
    sort: z.number().int().openapi({ example: 1 }),
    status: z.enum(['active', 'disabled']),
    remark: z.string().nullable().optional(),
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .openapi('Position');

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
    status: z.enum(['active', 'disabled']).openapi({ example: 'active' }),
    passwordUpdatedAt: z.string().optional(),
    requirePasswordChange: z.boolean().optional(),
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .openapi('User');

export const MenuDTO: z.ZodType = z
  .object({
    id: z.number().int(),
    parentId: z.number().int().openapi({ example: 0 }),
    title: z.string().openapi({ example: '系统管理' }),
    name: z.string().optional(),
    path: z.string().optional(),
    component: z.string().optional(),
    icon: z.string().optional(),
    type: z.enum(['directory', 'menu', 'button']).openapi({ example: 'menu' }),
    permission: z.string().optional(),
    sort: z.number().int().openapi({ example: 1 }),
    status: z.enum(['active', 'disabled']),
    visible: z.boolean().openapi({ example: true }),
    createdAt: z.string(),
    updatedAt: z.string(),
    get children() {
      return z.array(MenuDTO).optional();
    },
  })
  .openapi('Menu');

export const DepartmentDTO: z.ZodType = z
  .object({
    id: z.number().int(),
    parentId: z.number().int().openapi({ example: 0 }),
    name: z.string().openapi({ example: '技术部' }),
    code: z.string(),
    leader: z.string().optional(),
    phone: z.string().optional(),
    email: z.string().optional(),
    sort: z.number().int(),
    status: z.enum(['active', 'disabled']),
    createdAt: z.string(),
    updatedAt: z.string(),
    get children() {
      return z.array(DepartmentDTO).optional();
    },
  })
  .openapi('Department');

export const TenantDTO = z
  .object({
    id: z.number().int(),
    name: z.string().openapi({ example: '示例租户' }),
    code: z.string().openapi({ example: 'demo' }),
    logo: z.string().nullable().optional(),
    contactName: z.string().nullable().optional(),
    contactPhone: z.string().nullable().optional(),
    status: z.enum(['active', 'disabled']),
    expireAt: z.string().nullable().optional(),
    maxUsers: z.number().int().nullable().optional(),
    remark: z.string().nullable().optional(),
    createdAt: z.string().optional(),
    updatedAt: z.string().optional(),
  })
  .openapi('Tenant');

export const SessionDTO = z
  .object({
    tokenId: z.string().openapi({ example: 'abcdef123456' }),
    ip: z.string().openapi({ example: '127.0.0.1' }),
    browser: z.string().openapi({ example: 'Chrome 120.0' }),
    os: z.string().openapi({ example: 'macOS 14.0' }),
    loginAt: z.string(),
    lastActiveAt: z.string(),
    isCurrent: z.boolean(),
  })
  .openapi('UserSession');

export const ApiTokenListItemDTO = z
  .object({
    id: z.number().int(),
    name: z.string(),
    tokenPrefix: z.string(),
    lastUsedAt: z.string().nullable(),
    expiresAt: z.string().nullable(),
    createdAt: z.string(),
  })
  .openapi('ApiTokenListItem');

export const ApiTokenCreatedDTO = z
  .object({
    id: z.number().int(),
    name: z.string(),
    token: z.string(),
    createdAt: z.string(),
  })
  .openapi('ApiTokenCreated');

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
