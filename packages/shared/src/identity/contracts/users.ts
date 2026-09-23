import * as z from 'zod';
import { auditFieldsSchema, batchIdsBody, dateRangeQuery, entityStatusQuery, entityStatusSchema, idParam, keywordQuery, paginated, paginationQuery, idQuery } from '../../core/api-schemas';
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
import { impersonationStateSchema } from './impersonation';

// ─── 实体 ────────────────────────────────────────────────────────────────────

export const userSchema = z.object({
  id: z.int().meta({ example: 1 }),
  username: z.string().meta({ example: 'admin' }),
  nickname: z.string().meta({ example: '系统管理员' }),
  email: sensitive(z.string().nullable().meta({ example: 'admin@example.com' }), 'email'),
  phone: sensitive(z.string().nullable(), 'phone').optional(),
  gender: z.string().nullable().optional(),
  birthDate: z.string().nullable().optional(),
  avatar: z.string().nullable().optional(),
  departmentId: z.int().nullable().optional(),
  departmentName: z.string().nullable().optional(),
  tenantId: z.int().nullable().optional(),
  tenantName: z.string().nullable().optional(),
  viewingTenantId: z.int().nullable().optional().meta({ description: '平台超管当前查看的租户；null / 缺省表示平台视角' }),
  impersonation: impersonationStateSchema.nullable().optional().meta({ description: '当前会话为模拟登录时的模拟状态（仅 /auth/me 返回）；null / 缺省表示本人登录' }),
  positionIds: z.array(z.int()).optional(),
  positions: z.array(positionSchema).optional(),
  roles: z.array(roleSchema),
  status: entityStatusSchema.meta({ example: 'enabled' }),
  passwordUpdatedAt: z.string(),
  requirePasswordChange: z.boolean().optional(),
  loginChallengeRequired: z.boolean().optional().meta({ description: '登录是否要求验证码（近期失败过多：同一来源超阈值或失败来源 IP 过多；列表返回，管理员可清除）' }),
  isOnline: z.boolean().optional().meta({ description: '用户是否在线（列表返回）' }),
  lastLoginAt: z.string().nullable().optional(),
  lastActiveAt: z.string().nullable().optional().meta({ description: '用户最新会话活跃时间（列表返回；离线为 null）' }),
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

const inheritedRoleSchema = z.object({
  id: z.int(),
  name: z.string(),
  code: z.string(),
  groupNames: z.array(z.string()).meta({ description: '继承来源用户组名称' }),
}).meta({ id: 'InheritedRole' });

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
  inheritedRoles: z.array(inheritedRoleSchema).meta({ description: '通过用户组继承的角色及来源' }),
  menuSources: z.record(z.string(), z.array(z.string())).meta({ description: '菜单 ID 到具体权限来源的映射' }),
}).meta({ id: 'UserEffectivePermissions' });

export type UserEffectivePermissions = z.infer<typeof userEffectivePermissionsSchema>;

// ─── 契约 ────────────────────────────────────────────────────────────────────

export const userListQuery = paginationQuery.extend({
  keyword: keywordQuery('用户名 / 昵称 / 邮箱'),
  phone: keywordQuery('手机号'),
  departmentId: idQuery(),
  status: entityStatusQuery,
  ...dateRangeQuery('创建时间'),
});

export const userContract = defineContract('/api/users', {
  alertRecipients: op.get('/alert-recipients', { access: { permission: ['alert:rule:create', 'alert:rule:update'] }, response: z.array(alertRecipientUserSchema), summary: '告警接收用户下拉项' }),
  all: op.get('/all', { access: { permission: 'system:user:list' }, response: z.array(userSchema), summary: '全量用户（供下拉框）' }),
  list: op.get('/', { access: { permission: 'system:user:list' }, query: userListQuery, response: paginated(userSchema), summary: '用户列表' }),
  create: op.post('/', { access: { permission: 'system:user:create' }, audit: '创建用户', body: createUserSchema, response: userSchema, summary: '创建用户' }),
  removeBatch: op.delete('/batch', { access: { permission: 'system:user:delete' }, audit: '批量删除用户', body: batchIdsBody, summary: '批量删除用户' }),
  batchStatus: op.put('/batch-status', { access: { permission: 'system:user:update' }, audit: '批量修改用户状态', body: batchUpdateUserStatusSchema, summary: '批量修改用户状态' }),
  batchResetPassword: op.put('/batch-password', { access: { permission: 'system:user:update' }, audit: '批量重置用户密码', body: batchResetUsersPasswordSchema, summary: '批量重置用户密码' }),
  resetPassword: op.put('/{id}/password', { access: { permission: 'system:user:update' }, audit: '修改用户密码', params: idParam, body: resetUserPasswordSchema, summary: '修改用户密码' }),
  unlock: op.post('/{id}/unlock', { access: { permission: 'system:user:update' }, audit: '清除账号登录验证码要求', params: idParam, summary: '清除登录验证码要求' }),
  detail: op.get('/{id}', { access: { permission: 'system:user:list' }, params: idParam, response: userSchema, summary: '获取用户详情' }),
  update: op.put('/{id}', { access: { permission: 'system:user:update' }, audit: '更新用户', params: idParam, body: updateUserSchema, response: userSchema, summary: '更新用户' }),
  remove: op.delete('/{id}', { access: { permission: 'system:user:delete' }, audit: '删除用户', params: idParam, summary: '删除用户' }),
  menus: op.get('/{id}/menus', { access: { permission: 'system:user:assign' }, params: idParam, response: userMenuPermissionsSchema, summary: '获取用户菜单权限' }),
  assignMenus: op.put('/{id}/menus', { access: { permission: 'system:user:assign' }, audit: '分配用户菜单权限', params: idParam, body: assignUserMenusSchema, summary: '分配用户菜单权限' }),
  assignRoles: op.put('/{id}/roles', { access: { permission: 'system:user:assign' }, audit: '分配用户角色', params: idParam, body: assignUserRolesSchema, summary: '分配用户角色' }),
  dataPermission: op.get('/{id}/data-permission', { access: { permission: 'system:user:assign' }, params: idParam, response: userDataPermissionSchema, summary: '获取用户数据权限' }),
  updateDataPermission: op.put('/{id}/data-permission', { access: { permission: 'system:user:assign' }, audit: '设置用户数据权限', params: idParam, body: updateUserDataPermissionSchema, summary: '设置用户数据权限' }),
  effectivePermissions: op.get('/{id}/effective-permissions', { access: { permission: 'system:user:assign' }, params: idParam, response: userEffectivePermissionsSchema, summary: '获取用户最终有效权限' }),
}, { auditModule: '用户管理', tags: ['Users'] });
