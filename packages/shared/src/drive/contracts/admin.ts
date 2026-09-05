import * as z from 'zod';
import { dateRangeBound, idParam, paginated, paginationQuery } from '../../core/api-schemas';
import { defineContract, op } from '../../core/contract';
import { asyncTaskSchema } from '../../tasks/contracts';
import { DRIVE_ACTIVITY_ACTIONS, DRIVE_SPACE_TYPES } from '../constants';
import { adminUpdateDriveSpaceSchema, createDepartmentDriveSpaceSchema, driveAdminTaskScopeSchema, driveSettingsSchema } from '../validation';
import { driveActivitySchema } from './nodes';
import { driveShareLinkListQuery, driveShareLinkSchema } from './share-links';
import { driveSpaceListQuery, driveSpaceSchema } from './spaces';

// ─── 实体 ────────────────────────────────────────────────────────────────────

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

/** 网盘全局设置（存 system_configs，drive_ 前缀）；保存为整体替换，入参见 driveSettingsSchema */
export const driveSettingsResultSchema = z.object({
  personalQuotaGb: z.number(),
  departmentQuotaGb: z.number(),
  teamQuotaGb: z.number(),
  departmentSpaceAutoCreate: z.boolean(),
  recycleRetentionDays: z.int(),
  maxVersions: z.int(),
  quotaWarningPercent: z.int(),
  externalShareEnabled: z.boolean(),
  externalShareMaxDays: z.int(),
  externalShareRequirePassword: z.boolean(),
  blockedExtensions: z.string(),
  thumbnailEnabled: z.boolean(),
  textIndexEnabled: z.boolean(),
}).meta({ id: 'DriveSettings' });

export type DriveSettings = z.infer<typeof driveSettingsResultSchema>;

// ─── 入参 ────────────────────────────────────────────────────────────────────

export const driveAdminSpaceListQuery = driveSpaceListQuery.extend({
  departmentId: z.coerce.number().int().positive().optional(),
  ownerId: z.coerce.number().int().positive().optional(),
});

export const driveAdminShareLinkListQuery = driveShareLinkListQuery.extend({
  createdBy: z.coerce.number().int().positive().optional(),
});

export const driveAdminActivityListQuery = paginationQuery.extend({
  keyword: z.string().optional(),
  spaceId: z.coerce.number().int().positive().optional(),
  actorId: z.coerce.number().int().positive().optional(),
  action: z.enum(DRIVE_ACTIVITY_ACTIONS).optional(),
  startTime: dateRangeBound('时间起'),
  endTime: dateRangeBound('时间止'),
});

// ─── 契约 ────────────────────────────────────────────────────────────────────

export const driveAdminContract = defineContract('/api/drive/admin', {
  stats: op.get('/stats', { response: driveAdminStatsSchema, summary: '网盘统计概览' }),
  settings: op.get('/settings', { response: driveSettingsResultSchema, summary: '网盘设置' }),
  saveSettings: op.put('/settings', { body: driveSettingsSchema, response: driveSettingsResultSchema, summary: '保存网盘设置（整体替换）' }),
  spaces: op.get('/spaces', { query: driveAdminSpaceListQuery, response: paginated(driveSpaceSchema), summary: '全部空间（租户 + 数据权限收窄）' }),
  createDepartmentSpace: op.post('/spaces/department', { body: createDepartmentDriveSpaceSchema, response: driveSpaceSchema, summary: '创建部门空间' }),
  recalcUsage: op.post('/spaces/recalc', { body: driveAdminTaskScopeSchema, response: asyncTaskSchema, summary: '重算容量（任务中心；不传 spaceId 为全部）' }),
  updateSpace: op.put('/spaces/{id}', { params: idParam, body: adminUpdateDriveSpaceSchema, response: driveSpaceSchema, summary: '治理空间（配额 / 状态 / 所有者 / 外链开关）' }),
  removeSpace: op.delete('/spaces/{id}', { params: idParam, summary: '删除空空间' }),
  reindex: op.post('/reindex', { body: driveAdminTaskScopeSchema, response: asyncTaskSchema, summary: '补建缩略图 / 全文索引（任务中心）' }),
  shareLinks: op.get('/share-links', { query: driveAdminShareLinkListQuery, response: paginated(driveShareLinkSchema), summary: '全部外链（治理）' }),
  revokeShareLink: op.post('/share-links/{id}/revoke', { params: idParam, summary: '管理员撤销外链' }),
  activities: op.get('/activities', { query: driveAdminActivityListQuery, response: paginated(driveActivitySchema), summary: '全局文件动态审计' }),
}, { tags: ['企业网盘-管理'] });
