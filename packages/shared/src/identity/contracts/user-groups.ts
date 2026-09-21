import * as z from 'zod';
import { auditFieldsSchema, batchIdsBody, entityStatusQuery, entityStatusSchema, idParam, keywordQuery, paginated, paginationQuery } from '../../core/api-schemas';
import { defineContract, op } from '../../core/contract';
import { sensitive } from '../../core/sensitive';
import { USER_GROUP_MEMBER_MODES } from '../constants';
import {
  createUserGroupSchema,
  scopeUserIdsSchema,
  updateUserGroupSchema,
  userGroupMemberRuleSchema,
  userGroupRoleIdsSchema,
  userGroupRulePreviewSchema,
} from '../validation';
import { memberPreviewOp } from './scope-members';
import { userPreviewSchema } from './user-preview';

// ─── 实体 ────────────────────────────────────────────────────────────────────

/**
 * 动态组成员规则。条件组之间 AND，组内多值 OR；隐含条件：仅启用用户、同租户。
 * exclude 优先级最高；include 是规则外的强制例外。
 */
export type UserGroupMemberRule = z.infer<typeof userGroupMemberRuleSchema>;

export const userGroupRoleSchema = z.object({
  id: z.int(),
  name: z.string(),
  code: z.string(),
  status: entityStatusSchema,
}).meta({ id: 'UserGroupRole' });

export type UserGroupRole = z.infer<typeof userGroupRoleSchema>;

export const userGroupSchema = z.object({
  id: z.int(),
  name: z.string().meta({ example: '研发部审批组' }),
  code: z.string().meta({ example: 'rd_approver' }),
  description: z.string().nullable().optional(),
  ownerId: z.int().nullable().optional(),
  ownerName: z.string().nullable().optional(),
  memberMode: z.enum(USER_GROUP_MEMBER_MODES).meta({ description: '成员模式：static 手工维护 / dynamic 规则自动物化' }),
  memberRule: userGroupMemberRuleSchema.nullable().optional(),
  ruleSyncedAt: z.string().nullable().optional().meta({ description: '动态组最近成员同步时间' }),
  memberCount: z.int().meta({ example: 5 }),
  memberPreview: z.array(userPreviewSchema).optional().meta({ description: '成员摘要（列表返回）' }),
  roleCount: z.int().optional().meta({ description: '绑定的角色数量' }),
  rolePreview: z.array(userGroupRoleSchema).optional().meta({ description: '绑定角色摘要（列表返回）' }),
  status: entityStatusSchema,
  ...auditFieldsSchema,
  createdAt: z.string(),
  updatedAt: z.string(),
}).meta({ id: 'UserGroup' });

export type UserGroup = z.infer<typeof userGroupSchema>;

/** 用户组成员（分配成员抽屉的预选来源） */
export const userGroupMemberSchema = z.object({
  id: z.int(),
  username: z.string(),
  nickname: z.string(),
  email: sensitive(z.string().nullable(), 'email'),
  departmentName: z.string().nullable(),
  joinedAt: z.string(),
}).meta({ id: 'UserGroupMember' });

export type UserGroupMember = z.infer<typeof userGroupMemberSchema>;

const rulePreviewUserSchema = z.object({ id: z.int(), username: z.string(), nickname: z.string() });

export const userGroupRulePreviewResultSchema = z.object({
  total: z.int().meta({ description: '规则命中的目标成员总数' }),
  joiningCount: z.int(),
  leavingCount: z.int(),
  joining: z.array(rulePreviewUserSchema).meta({ description: '将加入的用户（最多 50 条明细）' }),
  leaving: z.array(rulePreviewUserSchema).meta({ description: '将移除的用户（最多 50 条明细）' }),
}).meta({ id: 'UserGroupRulePreview' });

export type UserGroupRulePreview = z.infer<typeof userGroupRulePreviewResultSchema>;

// ─── 契约 ────────────────────────────────────────────────────────────────────

export const userGroupListQuery = paginationQuery.extend({
  keyword: keywordQuery('名称 / 编码'),
  status: entityStatusQuery,
});

export const userGroupContract = defineContract('/api/user-groups', {
  all: op.get('/all', { access: { permission: 'system:user-groups:list' }, response: z.array(userGroupSchema), summary: '全量用户组（供下拉框）' }),
  list: op.get('/', { access: { permission: 'system:user-groups:list' }, query: userGroupListQuery, response: paginated(userGroupSchema), summary: '用户组列表' }),
  rulePreview: op.post('/rule-preview', { access: { permission: ['system:user-groups:create', 'system:user-groups:update'] }, body: userGroupRulePreviewSchema, response: userGroupRulePreviewResultSchema, summary: '动态组规则预览（dry-run，不落库）' }),
  members: op.get('/{id}/members', { access: { permission: 'system:user-groups:list' }, params: idParam, response: z.array(userGroupMemberSchema), summary: '获取用户组成员' }),
  memberPreview: memberPreviewOp('用户组成员分页预览', 'system:user-groups:list'),
  setMembers: op.put('/{id}/members', { access: { permission: 'system:user-groups:assign' }, audit: '设置用户组成员', params: idParam, body: scopeUserIdsSchema, summary: '设置用户组成员（全量覆盖）' }),
  addMembers: op.post('/{id}/members', { access: { permission: 'system:user-groups:assign' }, audit: '添加用户组成员', params: idParam, body: scopeUserIdsSchema, summary: '添加用户组成员' }),
  removeMembers: op.delete('/{id}/members', { access: { permission: 'system:user-groups:assign' }, audit: '移除用户组成员', params: idParam, body: scopeUserIdsSchema, summary: '移除用户组成员' }),
  roles: op.get('/{id}/roles', { access: { permission: 'system:user-groups:list' }, params: idParam, response: z.array(userGroupRoleSchema), summary: '获取用户组绑定的角色' }),
  setRoles: op.put('/{id}/roles', { access: { permission: 'system:user-groups:assign' }, audit: '分配用户组角色', params: idParam, body: userGroupRoleIdsSchema, summary: '设置用户组角色（全量覆盖，组内成员自动继承）' }),
  sync: op.post('/{id}/sync', { access: { permission: 'system:user-groups:assign' }, audit: '手动同步动态组成员', params: idParam, summary: '手动同步动态组成员' }),
  detail: op.get('/{id}', { access: { permission: 'system:user-groups:list' }, params: idParam, response: userGroupSchema, summary: '获取用户组详情' }),
  create: op.post('/', { access: { permission: 'system:user-groups:create' }, audit: '创建用户组', body: createUserGroupSchema, response: userGroupSchema, summary: '新增用户组' }),
  update: op.put('/{id}', { access: { permission: 'system:user-groups:update' }, audit: '更新用户组', params: idParam, body: updateUserGroupSchema, response: userGroupSchema, summary: '更新用户组' }),
  removeBatch: op.delete('/batch', { access: { permission: 'system:user-groups:delete' }, audit: '批量删除用户组', body: batchIdsBody, summary: '批量删除用户组' }),
  remove: op.delete('/{id}', { access: { permission: 'system:user-groups:delete' }, audit: '删除用户组', params: idParam, summary: '删除用户组' }),
}, { auditModule: '用户组管理', tags: ['UserGroups'] });
