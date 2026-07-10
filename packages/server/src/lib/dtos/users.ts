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
    email: z.string().nullable().openapi({ example: 'admin@example.com' }),
    phone: z.string().nullable().optional(),
    gender: z.string().nullable().optional(),
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
    lastLoginAt: z.string().nullable().optional(),
    requirePasswordChange: z.boolean().optional(),
    isLocked: z.boolean().optional().openapi({ description: '账号是否被锁定（登录失败次数过多）' }),
    isOnline: z.boolean().optional().openapi({ description: '用户是否在线' }),
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

const dataScopeValues = ['all', 'custom', 'dept_only', 'dept', 'self'] as const;

export const UserMenuPermissionsDTO = z
  .object({
    directMenuIds: z.array(z.number().int()).openapi({ description: '用户直接授权菜单 ID 列表' }),
    roleMenuIds: z.array(z.number().int()).openapi({ description: '角色继承菜单 ID 列表' }),
  })
  .openapi('UserMenuPermissions');

export const UserDataPermissionDTO = z
  .object({
    userDataScope: z.enum(dataScopeValues).nullable().openapi({ description: '用户直接数据权限（null 表示未设置）' }),
    deptScopeIds: z.array(z.number().int()).openapi({ description: '用户直接指定的部门 ID 列表' }),
    roleDataScope: z.string().nullable().openapi({ description: '角色最宽松数据权限' }),
    roleDeptScopeIds: z.array(z.number().int()).openapi({ description: '角色指定的部门 ID 列表' }),
    groupDataScope: z.string().nullable().openapi({ description: '用户组继承的最宽松数据权限' }),
    groupDeptScopeIds: z.array(z.number().int()).openapi({ description: '用户组继承的指定部门 ID 列表' }),
    groups: z.array(z.object({ id: z.number().int(), name: z.string() })).openapi({ description: '带角色绑定的所属用户组' }),
  })
  .openapi('UserDataPermission');

export const UserEffectivePermissionsDTO = z
  .object({
    directMenuIds: z.array(z.number().int()),
    roleMenuIds: z.array(z.number().int()),
    groupMenuIds: z.array(z.number().int()).openapi({ description: '用户组继承的菜单 ID 列表' }),
    effectiveMenuIds: z.array(z.number().int()),
    userDataScope: z.enum(dataScopeValues).nullable(),
    roleDataScope: z.string().nullable(),
    groupDataScope: z.string().nullable(),
    effectiveDataScope: z.string(),
    userDeptScopeIds: z.array(z.number().int()),
    roleDeptScopeIds: z.array(z.number().int()),
    groupDeptScopeIds: z.array(z.number().int()),
    effectiveDeptScopeIds: z.array(z.number().int()),
    groups: z.array(z.object({ id: z.number().int(), name: z.string() })).openapi({ description: '带角色绑定的所属用户组' }),
  })
  .openapi('UserEffectivePermissions');
