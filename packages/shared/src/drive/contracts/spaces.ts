import * as z from 'zod';
import { auditFieldsSchema, entityStatusQuery, entityStatusSchema, idParam, paginated, paginationQuery, queryBool, queryEnum } from '../../core/api-schemas';
import { defineContract, op } from '../../core/contract';
import { DRIVE_QUOTA_REQUEST_STATUSES, DRIVE_ROLES, DRIVE_SPACE_TYPES, DRIVE_SUBJECT_TYPES } from '../constants';
import {
  createDriveQuotaRequestSchema,
  createDriveSpaceSchema,
  saveDriveSpaceMembersSchema,
  transferDriveSpaceSchema,
  updateDriveSpaceSchema,
} from '../validation';

// ─── 实体 ────────────────────────────────────────────────────────────────────

export const driveSpaceSchema = z.object({
  id: z.int(),
  type: z.enum(DRIVE_SPACE_TYPES),
  name: z.string().meta({ example: '产品研发协作区' }),
  description: z.string().nullable(),
  icon: z.string().nullable(),
  ownerId: z.int().nullable(),
  ownerName: z.string().nullable(),
  departmentId: z.int().nullable(),
  departmentName: z.string().nullable(),
  defaultMemberRole: z.enum(DRIVE_ROLES).nullable().meta({ description: '隐式成员默认角色；null = 仅显式成员可访问' }),
  quotaBytes: z.int().meta({ description: '生效配额（字节）；0 = 不限' }),
  customQuotaBytes: z.int().nullable().meta({ description: '空间行上显式设置的配额；null = 跟随系统默认' }),
  usedBytes: z.int(),
  maxVersions: z.int().nullable(),
  allowExternalShare: z.boolean(),
  status: entityStatusSchema,
  /** 归档时间；非空即只读（不可上传 / 修改 / 分享），可由管理者恢复 */
  archivedAt: z.string().nullable(),
  sort: z.int(),
  tenantId: z.int().nullable(),
  myRole: z.enum(DRIVE_ROLES).nullable().optional().meta({ description: '当前用户在该空间的有效角色（列表 / 详情附带）' }),
  memberCount: z.int().optional(),
  nodeCount: z.int().optional(),
  /** 近 30 天平均每日新增字节（治理列表附带）；无数据为 null */
  dailyGrowthBytes: z.int().nullable().optional(),
  /** 按近 30 天增速预计多少天后用满配额；不限配额或零增长为 null */
  daysUntilFull: z.int().nullable().optional(),
  ...auditFieldsSchema,
  createdAt: z.string(),
  updatedAt: z.string(),
}).meta({ id: 'DriveSpace' });

export type DriveSpace = z.infer<typeof driveSpaceSchema>;

export const driveSpaceMemberSchema = z.object({
  spaceId: z.int(),
  subjectType: z.enum(DRIVE_SUBJECT_TYPES),
  subjectId: z.int(),
  subjectName: z.string().nullable(),
  role: z.enum(DRIVE_ROLES),
  createdAt: z.string(),
}).meta({ id: 'DriveSpaceMember' });

export type DriveSpaceMember = z.infer<typeof driveSpaceMemberSchema>;

export const driveQuotaRequestSchema = z.object({
  id: z.int(),
  spaceId: z.int(),
  spaceName: z.string(),
  spaceType: z.enum(DRIVE_SPACE_TYPES),
  currentQuotaBytes: z.int().meta({ description: '申请时的生效配额；0 = 不限' }),
  usedBytes: z.int(),
  requestedGb: z.int(),
  reason: z.string().nullable(),
  status: z.enum(DRIVE_QUOTA_REQUEST_STATUSES),
  requesterId: z.int(),
  requesterName: z.string().nullable(),
  approvedGb: z.int().nullable(),
  decidedBy: z.int().nullable(),
  decidedByName: z.string().nullable(),
  decidedAt: z.string().nullable(),
  decisionNote: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
}).meta({ id: 'DriveQuotaRequest' });

export type DriveQuotaRequest = z.infer<typeof driveQuotaRequestSchema>;

// ─── 契约 ────────────────────────────────────────────────────────────────────

export const driveSpaceListQuery = paginationQuery.extend({
  keyword: z.string().optional(),
  type: queryEnum(DRIVE_SPACE_TYPES),
  status: entityStatusQuery,
  archived: queryBool('true 只看已归档；缺省 / false 只看未归档'),
});

export const driveSpaceContract = defineContract('/api/drive/spaces', {
  my: op.get('/my', { response: z.array(driveSpaceSchema), summary: '我可访问的空间（个人 / 部门 / 协作）' }),
  list: op.get('/', { query: driveSpaceListQuery, response: paginated(driveSpaceSchema), summary: '共享空间分页（当前用户可访问的部门 / 协作空间）' }),
  detail: op.get('/{id}', { params: idParam, response: driveSpaceSchema, summary: '空间详情（含 myRole 与用量）' }),
  create: op.post('/', { body: createDriveSpaceSchema, response: driveSpaceSchema, summary: '创建协作空间' }),
  update: op.put('/{id}', { params: idParam, body: updateDriveSpaceSchema, response: driveSpaceSchema, summary: '更新空间（需空间 manager）' }),
  remove: op.delete('/{id}', { params: idParam, summary: '删除空空间（需空间 manager）' }),
  members: op.get('/{id}/members', { params: idParam, response: z.array(driveSpaceMemberSchema), summary: '空间成员' }),
  saveMembers: op.put('/{id}/members', { params: idParam, body: saveDriveSpaceMembersSchema, summary: '全量保存空间成员（需空间 manager）' }),
  transfer: op.post('/{id}/transfer', { params: idParam, body: transferDriveSpaceSchema, response: driveSpaceSchema, summary: '转让协作空间' }),
  archive: op.post('/{id}/archive', { params: idParam, response: driveSpaceSchema, summary: '归档空间：只读，不可上传 / 修改 / 分享（需空间 manager）' }),
  unarchive: op.post('/{id}/unarchive', { params: idParam, response: driveSpaceSchema, summary: '恢复归档（需空间 manager）' }),
  requestQuota: op.post('/{id}/quota-requests', { params: idParam, body: createDriveQuotaRequestSchema, response: driveQuotaRequestSchema, summary: '申请扩容（需空间 manager；由网盘管理员审批）' }),
  quotaRequests: op.get('/{id}/quota-requests', { params: idParam, response: z.array(driveQuotaRequestSchema), summary: '该空间的扩容申请记录' }),
}, { tags: ['企业网盘-空间'] });
