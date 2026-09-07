import * as z from 'zod';
import { queryBool } from '../../core/api-schemas';
import { defineContract, fileField, multipart, op } from '../../core/contract';
import { DRIVE_NODE_TYPES, DRIVE_SHARE_CAPABILITIES, DRIVE_SHARE_KINDS } from '../constants';
import { driveCollectPolicySchema, drivePublicAccessSchema, saveFromDriveShareSchema } from '../validation';

// ─── 实体 ────────────────────────────────────────────────────────────────────

export const drivePublicNodeSchema = z.object({
  id: z.int(),
  parentId: z.int().nullable(),
  type: z.enum(DRIVE_NODE_TYPES),
  name: z.string(),
  extension: z.string().nullable(),
  mimeType: z.string().nullable(),
  size: z.int(),
  url: z.string().nullable().meta({ description: '公开内容地址（需附带 session）；folder 为 null' }),
  updatedAt: z.string(),
}).meta({ id: 'DrivePublicNode' });

export type DrivePublicNode = z.infer<typeof drivePublicNodeSchema>;

export const drivePublicShareMetaSchema = z.object({
  token: z.string(),
  kind: z.enum(DRIVE_SHARE_KINDS),
  capabilities: z.array(z.enum(DRIVE_SHARE_CAPABILITIES)).meta({ description: '能力位：preview / download / upload' }),
  requirePassword: z.boolean(),
  node: drivePublicNodeSchema.nullable().meta({ description: '已通过密码校验（或无需密码）时返回根节点，否则为 null' }),
  expireAt: z.string().nullable(),
  sharerName: z.string().nullable(),
  /** 文件收集策略（已按系统设置折算单文件上限）；非收集链接为 null */
  collectPolicy: driveCollectPolicySchema.extend({ maxFileSizeMb: z.int() }).nullable(),
  uploadCount: z.int(),
  /** 剩余可收集文件数；null = 不限 */
  uploadsRemaining: z.int().nullable(),
  /** 预览水印文本；未开启为 null */
  watermarkText: z.string().nullable(),
}).meta({ id: 'DrivePublicShareMeta' });

export type DrivePublicShareMeta = z.infer<typeof drivePublicShareMetaSchema>;

export const drivePublicUploadResultSchema = z.object({
  id: z.int(),
  name: z.string(),
  size: z.int(),
  submittedAt: z.string(),
}).meta({ id: 'DrivePublicUploadResult' });

export type DrivePublicUploadResult = z.infer<typeof drivePublicUploadResultSchema>;

export const drivePublicShareSessionSchema = z.object({
  session: z.string().meta({ description: '访问会话令牌，后续请求经 header 或查询串 session 携带' }),
  expiresAt: z.string(),
  meta: drivePublicShareMetaSchema,
}).meta({ id: 'DrivePublicShareSession' });

export type DrivePublicShareSession = z.infer<typeof drivePublicShareSessionSchema>;

// ─── 入参 ────────────────────────────────────────────────────────────────────

export const driveShareTokenParam = z.object({
  token: z.string().min(16).max(64).meta({ description: '外链 token', example: '9f3c…' }),
});

export const driveShareTokenNodeParams = driveShareTokenParam.extend({
  nodeId: z.coerce.number().int().positive().meta({ description: '外链子树内的节点 ID', example: 1 }),
});

const publicSessionQuery = {
  session: z.string().optional().meta({ description: '访问会话（<a download> 无法带自定义头时经查询串传递）' }),
};

export const drivePublicChildrenQuery = z.object({
  parentId: z.coerce.number().int().positive().optional().meta({ description: '子目录 ID；缺省为外链根节点' }),
  ...publicSessionQuery,
});

export const drivePublicContentQuery = z.object({
  download: queryBool('以附件方式下载'),
  ...publicSessionQuery,
});

const drivePublicUploadBody = multipart(z.object({
  file: fileField('要提交的文件（单请求，大小受收集策略约束）'),
  submitterName: z.string().optional(),
  submitterNote: z.string().optional(),
}));

// ─── 契约 ────────────────────────────────────────────────────────────────────

/** 外链匿名访问：受路径绑定限流 drive_public_share 与 Redis 访问会话约束；仅转存需要登录 */
export const drivePublicShareContract = defineContract('/api/drive/public', {
  access: op.post('/shares/{token}/access', { params: driveShareTokenParam, body: drivePublicAccessSchema, response: drivePublicShareSessionSchema, public: true, summary: '校验密码并签发访问会话' }),
  meta: op.get('/shares/{token}', { params: driveShareTokenParam, response: drivePublicShareMetaSchema, public: true, summary: '外链元信息（无会话只返回是否需密码）' }),
  children: op.get('/shares/{token}/nodes', { params: driveShareTokenParam, query: drivePublicChildrenQuery, response: z.array(drivePublicNodeSchema), public: true, summary: '浏览外链子目录（需会话）' }),
  content: op.get('/shares/{token}/nodes/{nodeId}/content', { params: driveShareTokenNodeParams, query: drivePublicContentQuery, kind: 'file', public: true, summary: '外链文件内容（需会话；?download=true 需 download 能力）' }),
  upload: op.post('/shares/{token}/upload', { params: driveShareTokenParam, body: drivePublicUploadBody, response: drivePublicUploadResultSchema, public: true, summary: '文件收集：向目标文件夹提交文件（需会话与 upload 能力）' }),
  save: op.post('/shares/{token}/save', { params: driveShareTokenParam, body: saveFromDriveShareSchema, summary: '转存到我的网盘（登录用户，需 download 能力）' }),
}, { tags: ['企业网盘-公开外链'] });
