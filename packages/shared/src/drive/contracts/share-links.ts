import * as z from 'zod';
import { dateRangeBound, idParam, paginated, paginationQuery } from '../../core/api-schemas';
import { defineContract, op } from '../../core/contract';
import { DRIVE_NODE_TYPES, DRIVE_SHARE_LINK_STATES, DRIVE_SHARE_PERMISSIONS } from '../constants';
import { updateDriveShareLinkSchema } from '../validation';

// ─── 实体 ────────────────────────────────────────────────────────────────────

export const driveShareLinkSchema = z.object({
  id: z.int(),
  nodeId: z.int(),
  nodeName: z.string(),
  nodeType: z.enum(DRIVE_NODE_TYPES),
  spaceId: z.int(),
  token: z.string(),
  url: z.string().meta({ description: '前端公开页相对地址 /public/drive/{token}' }),
  hasPassword: z.boolean(),
  permission: z.enum(DRIVE_SHARE_PERMISSIONS),
  enabled: z.boolean(),
  expireAt: z.string().nullable(),
  maxAccessCount: z.int().nullable(),
  accessCount: z.int(),
  downloadCount: z.int(),
  revokedAt: z.string().nullable(),
  remark: z.string().nullable(),
  state: z.enum(DRIVE_SHARE_LINK_STATES).meta({ description: '派生状态：有效 / 过期 / 次数用尽 / 停用 / 已撤销' }),
  createdBy: z.int().nullable(),
  createdByName: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
}).meta({ id: 'DriveShareLink' });

export type DriveShareLink = z.infer<typeof driveShareLinkSchema>;

export const driveShareAccessLogSchema = z.object({
  id: z.int(),
  shareId: z.int(),
  nodeId: z.int(),
  action: z.string(),
  clientIp: z.string().nullable(),
  ok: z.boolean(),
  createdAt: z.string(),
}).meta({ id: 'DriveShareAccessLog' });

export type DriveShareAccessLog = z.infer<typeof driveShareAccessLogSchema>;

// ─── 契约 ────────────────────────────────────────────────────────────────────

export const driveShareLinkListQuery = paginationQuery.extend({
  keyword: z.string().optional(),
  spaceId: z.coerce.number().int().positive().optional(),
  state: z.enum(DRIVE_SHARE_LINK_STATES).optional(),
  startTime: dateRangeBound('创建时间起'),
  endTime: dateRangeBound('创建时间止'),
});

export const driveShareLinkContract = defineContract('/api/drive/share-links', {
  list: op.get('/', { query: driveShareLinkListQuery, response: paginated(driveShareLinkSchema), summary: '我创建的外链' }),
  update: op.put('/{id}', { params: idParam, body: updateDriveShareLinkSchema, response: driveShareLinkSchema, summary: '修改外链（创建者或节点 manager）' }),
  revoke: op.post('/{id}/revoke', { params: idParam, summary: '撤销外链（保留记录）' }),
  remove: op.delete('/{id}', { params: idParam, summary: '删除外链记录' }),
  accessLogs: op.get('/{id}/access-logs', { params: idParam, query: paginationQuery, response: paginated(driveShareAccessLogSchema), summary: '外链访问日志' }),
}, { tags: ['企业网盘-外链'] });
