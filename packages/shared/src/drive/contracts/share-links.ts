import * as z from 'zod';
import { dateRangeQuery, idParam, paginated, paginationQuery, queryEnum } from '../../core/api-schemas';
import { defineContract, op } from '../../core/contract';
import { DRIVE_NODE_TYPES, DRIVE_SHARE_CAPABILITIES, DRIVE_SHARE_KINDS, DRIVE_SHARE_LINK_STATES } from '../constants';
import { driveCollectPolicySchema, updateDriveShareLinkSchema } from '../validation';

// ─── 实体 ────────────────────────────────────────────────────────────────────

export const driveShareLinkSchema = z.object({
  id: z.int(),
  nodeId: z.int(),
  nodeName: z.string(),
  nodeType: z.enum(DRIVE_NODE_TYPES),
  spaceId: z.int(),
  kind: z.enum(DRIVE_SHARE_KINDS),
  token: z.string(),
  url: z.string().meta({ description: '前端公开页相对地址 /public/drive/{token}' }),
  shortUrl: z.string().nullable().meta({ description: '已生成的短链完整地址；未生成为 null' }),
  hasPassword: z.boolean(),
  capabilities: z.array(z.enum(DRIVE_SHARE_CAPABILITIES)).meta({ description: '能力位：preview / download / upload' }),
  enabled: z.boolean(),
  expireAt: z.string().nullable(),
  maxAccessCount: z.int().nullable(),
  accessCount: z.int(),
  maxDownloadCount: z.int().nullable(),
  downloadCount: z.int(),
  uploadCount: z.int(),
  allowedIps: z.array(z.string()),
  watermark: z.boolean(),
  collectPolicy: driveCollectPolicySchema.nullable(),
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
  /** 治理列表附带：节点 / 空间名快照（节点已彻底删除时为 null） */
  nodeName: z.string().nullable().optional(),
  spaceId: z.int().nullable().optional(),
  spaceName: z.string().nullable().optional(),
}).meta({ id: 'DriveShareAccessLog' });

export type DriveShareAccessLog = z.infer<typeof driveShareAccessLogSchema>;

export const driveCollectSubmissionSchema = z.object({
  id: z.int(),
  shareId: z.int(),
  nodeId: z.int().nullable().meta({ description: '收集到的文件节点；文件已彻底删除时为 null' }),
  fileName: z.string(),
  size: z.int(),
  submitterName: z.string().nullable(),
  submitterNote: z.string().nullable(),
  clientIp: z.string().nullable(),
  createdAt: z.string(),
}).meta({ id: 'DriveCollectSubmission' });

export type DriveCollectSubmission = z.infer<typeof driveCollectSubmissionSchema>;

export const driveShareShortLinkSchema = z.object({
  shortUrl: z.string(),
}).meta({ id: 'DriveShareShortLink' });

// ─── 契约 ────────────────────────────────────────────────────────────────────

export const driveShareLinkListQuery = paginationQuery.extend({
  keyword: z.string().optional(),
  spaceId: z.coerce.number().int().positive().optional(),
  kind: queryEnum(DRIVE_SHARE_KINDS),
  state: queryEnum(DRIVE_SHARE_LINK_STATES),
  ...dateRangeQuery('创建时间'),
});

export const driveShareLinkContract = defineContract('/api/drive/share-links', {
  list: op.get('/', { query: driveShareLinkListQuery, response: paginated(driveShareLinkSchema), summary: '我创建的外链' }),
  update: op.put('/{id}', { params: idParam, body: updateDriveShareLinkSchema, response: driveShareLinkSchema, summary: '修改外链（创建者或节点 manager）' }),
  revoke: op.post('/{id}/revoke', { params: idParam, summary: '撤销外链（保留记录）' }),
  remove: op.delete('/{id}', { params: idParam, summary: '删除外链记录' }),
  accessLogs: op.get('/{id}/access-logs', { params: idParam, query: paginationQuery, response: paginated(driveShareAccessLogSchema), summary: '外链访问日志' }),
  submissions: op.get('/{id}/submissions', { params: idParam, query: paginationQuery, response: paginated(driveCollectSubmissionSchema), summary: '文件收集的提交记录' }),
  shortLink: op.post('/{id}/short-link', { params: idParam, response: driveShareShortLinkSchema, summary: '为外链生成（或复用）短链' }),
}, { tags: ['企业网盘-外链'] });
