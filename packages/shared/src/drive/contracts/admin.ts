import * as z from 'zod';
import { dateRangeQuery, entityStatusSchema, idParam, paginated, paginationQuery, queryBool, queryEnum } from '../../core/api-schemas';
import { defineContract, op } from '../../core/contract';
import { asyncTaskSchema } from '../../tasks/contracts';
import { DRIVE_ACTIVITY_ACTIONS, DRIVE_NODE_TYPES, DRIVE_QUOTA_REQUEST_STATUSES, DRIVE_ROLES, DRIVE_SPACE_TYPES } from '../constants';
import {
  adminUpdateDriveSpaceSchema, createDepartmentDriveSpaceSchema, createDriveLegalHoldSchema, createDriveOpenAppGrantSchema, decideDriveQuotaRequestSchema,
  driveAdminTaskScopeSchema, handoffDriveSpaceSchema, releaseDriveLegalHoldSchema,
} from '../validation';
import { driveActivitySchema } from './nodes';
import { driveShareAccessLogSchema, driveShareLinkListQuery, driveShareLinkSchema } from './share-links';
import { driveQuotaRequestSchema, driveSpaceListQuery, driveSpaceSchema } from './spaces';

// ─── 实体 ────────────────────────────────────────────────────────────────────

export const driveOpenAppGrantSchema = z.object({
  id: z.int(),
  clientId: z.string(),
  appName: z.string().nullable(),
  spaceId: z.int(),
  spaceName: z.string(),
  role: z.enum(DRIVE_ROLES),
  status: entityStatusSchema,
  remark: z.string().nullable(),
  createdAt: z.string(),
}).meta({ id: 'DriveOpenAppGrant' });

export type DriveOpenAppGrant = z.infer<typeof driveOpenAppGrantSchema>;

export const driveLegalHoldSchema = z.object({
  id: z.int(),
  nodeId: z.int(),
  nodeName: z.string(),
  nodeType: z.enum(DRIVE_NODE_TYPES),
  spaceId: z.int(),
  spaceName: z.string(),
  reason: z.string(),
  active: z.boolean(),
  createdBy: z.int().nullable(),
  createdByName: z.string().nullable(),
  createdAt: z.string(),
  releasedBy: z.int().nullable(),
  releasedByName: z.string().nullable(),
  releasedAt: z.string().nullable(),
  releaseNote: z.string().nullable(),
}).meta({ id: 'DriveLegalHold' });

export type DriveLegalHold = z.infer<typeof driveLegalHoldSchema>;

export const driveAdminStatsSchema = z.object({
  spaceCount: z.int(),
  spaceCountByType: z.object({ personal: z.int(), department: z.int(), team: z.int() }),
  fileCount: z.int(),
  folderCount: z.int(),
  totalBytes: z.int(),
  recycleBytes: z.int(),
  versionBytes: z.int(),
  activeShareLinks: z.int(),
  todayUploads: z.int(),
  todayDownloads: z.int(),
  topSpaces: z.array(z.object({ id: z.int(), name: z.string(), type: z.enum(DRIVE_SPACE_TYPES), usedBytes: z.int(), quotaBytes: z.int() })),
  typeDistribution: z.array(z.object({ category: z.string(), count: z.int(), bytes: z.int() })),
  dailyTrend: z.array(z.object({ date: z.string(), uploads: z.int(), downloads: z.int() })),
}).meta({ id: 'DriveAdminStats' });

export type DriveAdminStats = z.infer<typeof driveAdminStatsSchema>;

// ─── 入参 ────────────────────────────────────────────────────────────────────

export const driveAdminSpaceListQuery = driveSpaceListQuery.extend({
  departmentId: z.coerce.number().int().positive().optional(),
  ownerId: z.coerce.number().int().positive().optional(),
  orphaned: queryBool('只显示待接管空间'),
});

export const driveAdminShareLinkListQuery = driveShareLinkListQuery.extend({
  createdBy: z.coerce.number().int().positive().optional(),
});

export const driveAdminActivityListQuery = paginationQuery.extend({
  keyword: z.string().optional(),
  spaceId: z.coerce.number().int().positive().optional(),
  actorId: z.coerce.number().int().positive().optional(),
  action: queryEnum(DRIVE_ACTIVITY_ACTIONS),
  ...dateRangeQuery('时间'),
});

export const driveAdminShareLogListQuery = paginationQuery.extend({
  shareId: z.coerce.number().int().positive().optional(),
  spaceId: z.coerce.number().int().positive().optional(),
  action: z.string().max(16).optional(),
  ok: queryBool('只看通过 / 只看被拒绝'),
  ...dateRangeQuery('时间'),
});

export const driveLegalHoldListQuery = paginationQuery.extend({
  spaceId: z.coerce.number().int().positive().optional(),
  nodeId: z.coerce.number().int().positive().optional(),
  active: queryBool('只显示生效中的保留'),
});

export const driveQuotaRequestListQuery = paginationQuery.extend({
  status: queryEnum(DRIVE_QUOTA_REQUEST_STATUSES),
  spaceId: z.coerce.number().int().positive().optional(),
});

export const driveOpenAppGrantListQuery = z.object({
  spaceId: z.coerce.number().int().positive().optional(),
  clientId: z.string().max(64).optional(),
});

// ─── 契约 ────────────────────────────────────────────────────────────────────

export const driveAdminContract = defineContract('/api/drive/admin', {
  stats: op.get('/stats', { response: driveAdminStatsSchema, summary: '网盘统计概览' }),
  spaces: op.get('/spaces', { query: driveAdminSpaceListQuery, response: paginated(driveSpaceSchema), summary: '全部空间（租户 + 数据权限收窄；附近 30 天增速与预计用满天数）' }),
  createDepartmentSpace: op.post('/spaces/department', { body: createDepartmentDriveSpaceSchema, response: driveSpaceSchema, summary: '创建部门空间' }),
  recalcUsage: op.post('/spaces/recalc', { body: driveAdminTaskScopeSchema, response: asyncTaskSchema, summary: '重算容量（任务中心；不传 spaceId 为全部）' }),
  updateSpace: op.put('/spaces/{id}', { params: idParam, body: adminUpdateDriveSpaceSchema, response: driveSpaceSchema, summary: '治理空间（配额 / 状态 / 所有者 / 外链开关）' }),
  handoff: op.post('/spaces/{id}/handoff', { params: idParam, body: handoffDriveSpaceSchema, response: driveSpaceSchema, summary: '个人或孤儿空间交接' }),
  removeSpace: op.delete('/spaces/{id}', { params: idParam, summary: '删除空空间' }),
  reindex: op.post('/reindex', { body: driveAdminTaskScopeSchema, response: asyncTaskSchema, summary: '补建缩略图 / 全文索引（任务中心）' }),
  shareLinks: op.get('/share-links', { query: driveAdminShareLinkListQuery, response: paginated(driveShareLinkSchema), summary: '全部外链（治理）' }),
  revokeShareLink: op.post('/share-links/{id}/revoke', { params: idParam, summary: '管理员撤销外链' }),
  shareAccessLogs: op.get('/share-access-logs', { query: driveAdminShareLogListQuery, response: paginated(driveShareAccessLogSchema), summary: '全部外链访问日志（治理；导出走导出中心 drive.share_access_logs）' }),
  activities: op.get('/activities', { query: driveAdminActivityListQuery, response: paginated(driveActivitySchema), summary: '全局文件动态审计' }),
  legalHolds: op.get('/legal-holds', { query: driveLegalHoldListQuery, response: paginated(driveLegalHoldSchema), summary: '法律保留记录' }),
  createLegalHold: op.post('/legal-holds', { body: createDriveLegalHoldSchema, response: driveLegalHoldSchema, summary: '对文件或文件夹（含子树）设置法律保留：不可删除 / 彻底删除 / 删版本 / 跨空间移动' }),
  releaseLegalHold: op.post('/legal-holds/{id}/release', { params: idParam, body: releaseDriveLegalHoldSchema, response: driveLegalHoldSchema, summary: '解除法律保留' }),
  quotaRequests: op.get('/quota-requests', { query: driveQuotaRequestListQuery, response: paginated(driveQuotaRequestSchema), summary: '扩容申请（治理）' }),
  decideQuotaRequest: op.post('/quota-requests/{id}/decide', { params: idParam, body: decideDriveQuotaRequestSchema, response: driveQuotaRequestSchema, summary: '审批扩容申请：通过即写入空间显式配额' }),
  openGrants: op.get('/open-grants', { query: driveOpenAppGrantListQuery, response: z.array(driveOpenAppGrantSchema), summary: '开放应用的空间授权（开放 API / Webhook 可见范围）' }),
  createOpenGrant: op.post('/open-grants', { body: createDriveOpenAppGrantSchema, response: driveOpenAppGrantSchema, summary: '授权开放应用访问某空间（同一应用 + 空间幂等覆盖）' }),
  removeOpenGrant: op.delete('/open-grants/{id}', { params: idParam, summary: '撤销开放应用的空间授权' }),
}, { tags: ['企业网盘-管理'] });
