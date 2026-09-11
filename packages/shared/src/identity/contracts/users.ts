import * as z from 'zod';
import { auditFieldsSchema, batchIdsBody, dateRangeBound, entityStatusQuery, entityStatusSchema, idParam, paginated, paginationQuery } from '../../core/api-schemas';
import { defineContract, op } from '../../core/contract';
import { sensitive } from '../../core/sensitive';
import { DATA_SCOPES } from '../constants';
import {
  assignUserMenusSchema,
  assignUserRolesSchema,
  batchResetUsersPasswordSchema,
  batchUpdateUserStatusSchema,
  createUserSchema,
  resetUserPasswordSchema,
  updateUserDataPermissionSchema,
  updateUserSchema,
} from '../validation';
import { positionSchema } from './positions';
import { roleSchema } from './roles';

// ─── 实体 ────────────────────────────────────────────────────────────────────

export const userSchema = z.object({
  id: z.int().meta({ example: 1 }),
  username: z.string().meta({ example: 'admin' }),
  nickname: z.string().meta({ example: '系统管理员' }),
  email: sensitive(z.string().nullable().meta({ example: 'admin@example.com' }), 'email'),
  phone: sensitive(z.string().nullable(), 'phone').optional(),
  gender: z.string().nullable().optional(),
  avatar: z.string().nullable().optional(),
  departmentId: z.int().nullable().optional(),
  departmentName: z.string().nullable().optional(),
  tenantId: z.int().nullable().optional(),
  tenantName: z.string().nullable().optional(),
  viewingTenantId: z.int().nullable().optional().meta({ description: '平台超管当前查看的租户；null / 缺省表示平台视角' }),
  positionIds: z.array(z.int()).optional(),
  positions: z.array(positionSchema).optional(),
  roles: z.array(roleSchema),
  status: entityStatusSchema.meta({ example: 'enabled' }),
  passwordUpdatedAt: z.string(),
  requirePasswordChange: z.boolean().optional(),
  isLocked: z.boolean().optional().meta({ description: '账号是否被锁定（登录失败次数过多，列表返回）' }),
  isOnline: z.boolean().optional().meta({ description: '用户是否在线（列表返回）' }),
  lastLoginAt: z.string().nullable().optional(),
  lastLoginIp: z.string().nullable().optional(),
  lastLoginLocation: z.string().nullable().optional(),
  ...auditFieldsSchema,
  createdAt: z.string(),
  updatedAt: z.string(),
}).meta({ id: 'User' });

export type User = z.infer<typeof userSchema>;

/** 告警接收用户下拉项：只暴露投递所需的最小信息，不返回邮箱原文 */
export const alertRecipientUserSchema = z.object({
  id: z.int(),
  username: z.string(),
  nickname: z.string(),
  departmentName: z.string().nullable(),
  hasEmail: z.boolean(),
}).meta({ id: 'AlertRecipientUser' });

export type AlertRecipientUser = z.infer<typeof alertRecipientUserSchema>;

export const userMenuPermissionsSchema = z.object({
  directMenuIds: z.array(z.int()).meta({ description: '用户直接授权菜单 ID 列表' }),
  roleMenuIds: z.array(z.int()).meta({ description: '角色继承菜单 ID 列表' }),
}).meta({ id: 'UserMenuPermissions' });

export type UserMenuPermissions = z.infer<typeof userMenuPermissionsSchema>;

const permissionGroupSchema = z.object({ id: z.int(), name: z.string() });

export const userDataPermissionSchema = z.object({
  userDataScope: z.enum(DATA_SCOPES).nullable().meta({ description: '用户直接数据权限（null 表示未设置）' }),
  deptScopeIds: z.array(z.int()).meta({ description: '用户直接指定的部门 ID 列表' }),
  roleDataScope: z.string().nullable().meta({ description: '角色最宽松数据权限' }),
  roleDeptScopeIds: z.array(z.int()).meta({ description: '角色指定的部门 ID 列表' }),
  groupDataScope: z.string().nullable().meta({ description: '用户组继承的最宽松数据权限' }),
  groupDeptScopeIds: z.array(z.int()).meta({ description: '用户组继承的指定部门 ID 列表' }),
  groups: z.array(permissionGroupSchema).meta({ description: '带角色绑定的所属用户组' }),
}).meta({ id: 'UserDataPermission' });

export type UserDataPermission = z.infer<typeof userDataPermissionSchema>;

export const userEffectivePermissionsSchema = z.object({
  directMenuIds: z.array(z.int()),
  roleMenuIds: z.array(z.int()),
  groupMenuIds: z.array(z.int()).meta({ description: '用户组继承的菜单 ID 列表' }),
  effectiveMenuIds: z.array(z.int()),
  userDataScope: z.enum(DATA_SCOPES).nullable(),
  roleDataScope: z.string().nullable(),
  groupDataScope: z.string().nullable(),
  effectiveDataScope: z.string(),
  userDeptScopeIds: z.array(z.int()),
  roleDeptScopeIds: z.array(z.int()),
  groupDeptScopeIds: z.array(z.int()),
  effectiveDeptScopeIds: z.array(z.int()),
  groups: z.array(permissionGroupSchema).meta({ description: '带角色绑定的所属用户组' }),
}).meta({ id: 'UserEffectivePermissions' });

export type UserEffectivePermissions = z.infer<typeof userEffectivePermissionsSchema>;

// ─── 契约 ────────────────────────────────────────────────────────────────────

export const userListQuery = paginationQuery.extend({
  keyword: z.string().optional().meta({ description: '按用户名 / 昵称 / 邮箱模糊匹配' }),
  phone: z.string().optional(),
  departmentId: z.coerce.number().optional(),
  status: entityStatusQuery,
  startTime: dateRangeBound('创建时间起'),
  endTime: dateRangeBound('创建时间止'),
});

export const userContract = defineContract('/api/users', {
  alertRecipients: op.get('/alert-recipients', { response: z.array(alertRecipientUserSchema), summary: '告警接收用户下拉项' }),
  all: op.get('/all', { response: z.array(userSchema), summary: '全量用户（供下拉框）' }),
  list: op.get('/', { query: userListQuery, response: paginated(userSchema), summary: '用户列表' }),
  create: op.post('/', { body: createUserSchema, response: userSchema, summary: '创建用户' }),
  removeBatch: op.delete('/batch', { body: batchIdsBody, summary: '批量删除用户' }),
  batchStatus: op.put('/batch-status', { body: batchUpdateUserStatusSchema, summary: '批量修改用户状态' }),
  batchResetPassword: op.put('/batch-password', { body: batchResetUsersPasswordSchema, summary: '批量重置用户密码' }),
  resetPassword: op.put('/{id}/password', { params: idParam, body: resetUserPasswordSchema, summary: '修改用户密码' }),
  unlock: op.post('/{id}/unlock', { params: idParam, summary: '解锁账号' }),
  detail: op.get('/{id}', { params: idParam, response: userSchema, summary: '获取用户详情' }),
  update: op.put('/{id}', { params: idParam, body: updateUserSchema, response: userSchema, summary: '更新用户' }),
  remove: op.delete('/{id}', { params: idParam, summary: '删除用户' }),
  menus: op.get('/{id}/menus', { params: idParam, response: userMenuPermissionsSchema, summary: '获取用户菜单权限' }),
  assignMenus: op.put('/{id}/menus', { params: idParam, body: assignUserMenusSchema, summary: '分配用户菜单权限' }),
  assignRoles: op.put('/{id}/roles', { params: idParam, body: assignUserRolesSchema, summary: '分配用户角色' }),
  dataPermission: op.get('/{id}/data-permission', { params: idParam, response: userDataPermissionSchema, summary: '获取用户数据权限' }),
  updateDataPermission: op.put('/{id}/data-permission', { params: idParam, body: updateUserDataPermissionSchema, summary: '设置用户数据权限' }),
  effectivePermissions: op.get('/{id}/effective-permissions', { params: idParam, response: userEffectivePermissionsSchema, summary: '获取用户最终有效权限' }),
}, { tags: ['Users'] });
