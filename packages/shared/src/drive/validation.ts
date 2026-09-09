import * as z from 'zod';
import { dateTimeStringSchema, partialForUpdate } from '../core/validation';
import { UPLOAD_CHUNK_MAX_BYTES, UPLOAD_CHUNK_MIN_BYTES } from '../platform/constants';
import {
  DRIVE_ROLES,
  DRIVE_HANDOFF_MODES,
  DRIVE_REQUESTABLE_ROLES,
  DRIVE_SHARE_CAPABILITIES,
  DRIVE_SHARE_KINDS,
  DRIVE_SUBJECT_TYPES,
  DRIVE_UPLOAD_CONFLICT_POLICIES,
} from './constants';
import { entityStatusSchema } from '../core/api-schemas';

/** 节点 / 文件夹名称：不含路径分隔符与控制字符，两端不留空白 */
export const driveNodeNameSchema = z.string()
  .trim()
  .min(1, '名称不能为空')
  .max(255, '名称不能超过 255 个字符')
  .refine((v) => !/[\\/:*?"<>|]/.test(v), '名称不能包含 \\ / : * ? " < > | 等字符')
  .refine((v) => ![...v].some((ch) => ch.charCodeAt(0) < 0x20), '名称不能包含控制字符')
  .refine((v) => v !== '.' && v !== '..', '名称不合法');

const subjectSchema = z.object({
  subjectType: z.enum(DRIVE_SUBJECT_TYPES),
  subjectId: z.number().int().positive(),
  role: z.enum(DRIVE_ROLES),
});

// ─── 空间 ─────────────────────────────────────────────────────────────────────

export const createDriveSpaceSchema = z.object({
  name: z.string().trim().min(1, '空间名称不能为空').max(100),
  description: z.string().max(300).optional(),
  icon: z.string().max(50).optional(),
  /** 隐式成员默认角色；null = 仅显式成员可访问 */
  defaultMemberRole: z.enum(DRIVE_ROLES).nullable().default(null),
  /** 显式配额（GB）；null = 跟随系统默认；0 = 不限 */
  quotaGb: z.number().min(0).max(1_000_000).nullable().default(null),
  maxVersions: z.number().int().min(1).max(200).nullable().default(null),
  allowExternalShare: z.boolean().default(true),
  status: entityStatusSchema.default('enabled'),
  sort: z.number().int().default(0),
  /** 创建协作空间时同时写入的成员 */
  members: z.array(subjectSchema).default([]),
});

export const updateDriveSpaceSchema = partialForUpdate(createDriveSpaceSchema.omit({ members: true }));

export type CreateDriveSpaceInput = z.infer<typeof createDriveSpaceSchema>;
export type UpdateDriveSpaceInput = z.infer<typeof updateDriveSpaceSchema>;

/** 管理端创建部门空间 */
export const createDepartmentDriveSpaceSchema = z.object({
  departmentId: z.number().int().positive(),
  name: z.string().trim().min(1).max(100).optional(),
  defaultMemberRole: z.enum(DRIVE_ROLES).nullable().default('editor'),
  quotaGb: z.number().min(0).max(1_000_000).nullable().default(null),
});

export type CreateDepartmentDriveSpaceInput = z.infer<typeof createDepartmentDriveSpaceSchema>;

/** 全量保存空间成员（replace 模式） */
export const saveDriveSpaceMembersSchema = z.object({
  members: z.array(subjectSchema),
});

export type SaveDriveSpaceMembersInput = z.infer<typeof saveDriveSpaceMembersSchema>;

export const transferDriveSpaceSchema = z.object({
  ownerId: z.number().int().positive(),
});

export type TransferDriveSpaceInput = z.infer<typeof transferDriveSpaceSchema>;

export const handoffDriveSpaceSchema = z.object({
  recipientId: z.int().positive(),
  mode: z.enum(DRIVE_HANDOFF_MODES),
  name: z.string().trim().min(1).max(100).optional(),
});
export type HandoffDriveSpaceInput = z.infer<typeof handoffDriveSpaceSchema>;

// ─── 节点 ─────────────────────────────────────────────────────────────────────

export const createDriveFolderSchema = z.object({
  spaceId: z.number().int().positive(),
  parentId: z.number().int().positive().nullable().default(null),
  name: driveNodeNameSchema,
});

export type CreateDriveFolderInput = z.infer<typeof createDriveFolderSchema>;

export const driveRelativePathSchema = z.string().max(8192)
  .transform((path) => path.split('/'))
  .pipe(z.array(driveNodeNameSchema).min(1).max(32))
  .transform((segments) => segments.join('/'));

export const ensureDriveDirectoriesSchema = createDriveFolderSchema.omit({ name: true }).extend({
  paths: z.array(driveRelativePathSchema).min(1).max(1000),
});

export type EnsureDriveDirectoriesInput = z.infer<typeof ensureDriveDirectoriesSchema>;

export const renameDriveNodeSchema = z.object({
  name: driveNodeNameSchema,
});

export type RenameDriveNodeInput = z.infer<typeof renameDriveNodeSchema>;

/** 移动 / 复制：targetParentId 为 null 时表示目标空间根级，此时必须传 targetSpaceId */
export const moveDriveNodesSchema = z.object({
  ids: z.array(z.number().int().positive()).min(1, '请选择要操作的项目').max(500),
  targetSpaceId: z.number().int().positive(),
  targetParentId: z.number().int().positive().nullable().default(null),
});

export type MoveDriveNodesInput = z.infer<typeof moveDriveNodesSchema>;

export const copyDriveNodesSchema = moveDriveNodesSchema;

export type CopyDriveNodesInput = z.infer<typeof copyDriveNodesSchema>;

export const driveNodeIdsSchema = z.object({
  ids: z.array(z.number().int().positive()).min(1, '请选择要操作的项目').max(1000),
});

export type DriveNodeIdsInput = z.infer<typeof driveNodeIdsSchema>;

// ─── 授权 ─────────────────────────────────────────────────────────────────────

export const saveDriveNodePermissionsSchema = z.object({
  permissions: z.array(subjectSchema.extend({
    expireAt: dateTimeStringSchema.nullable().optional(),
  })),
});

export type SaveDriveNodePermissionsInput = z.infer<typeof saveDriveNodePermissionsSchema>;

export const setDriveNodeInheritSchema = z.object({
  inherit: z.boolean(),
});

export type SetDriveNodeInheritInput = z.infer<typeof setDriveNodeInheritSchema>;

// ─── 上传 ─────────────────────────────────────────────────────────────────────

const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/i, 'SHA-256 格式不正确');

export const driveUploadPrecheckSchema = z.object({
  spaceId: z.number().int().positive(),
  parentId: z.number().int().positive().nullable().default(null),
  fileName: driveNodeNameSchema,
  fileSize: z.number().int().min(0),
  contentHash: sha256Schema.optional(),
  conflictPolicy: z.enum(DRIVE_UPLOAD_CONFLICT_POLICIES).default('rename'),
});

export type DriveUploadPrecheckInput = z.infer<typeof driveUploadPrecheckSchema>;

export const driveUploadInitSchema = z.object({
  spaceId: z.number().int().positive(),
  parentId: z.number().int().positive().nullable().default(null),
  /** 非空 = 作为该文件节点的新版本上传（忽略 parentId / conflictPolicy） */
  nodeId: z.number().int().positive().optional(),
  fileName: driveNodeNameSchema,
  fileSize: z.number().int().min(0),
  mimeType: z.string().max(128).optional(),
  chunkSize: z.number().int().min(UPLOAD_CHUNK_MIN_BYTES).max(UPLOAD_CHUNK_MAX_BYTES),
  contentHash: sha256Schema.optional(),
  conflictPolicy: z.enum(DRIVE_UPLOAD_CONFLICT_POLICIES).default('rename'),
});

export type DriveUploadInitInput = z.infer<typeof driveUploadInitSchema>;

export const driveUploadCompleteSchema = z.object({
  uploadId: z.string().min(8).max(64),
});

export type DriveUploadCompleteInput = z.infer<typeof driveUploadCompleteSchema>;

/** 简单上传（multipart）附带的字段 */
export const driveSimpleUploadFieldsSchema = z.object({
  spaceId: z.coerce.number().int().positive(),
  parentId: z.coerce.number().int().positive().nullable().optional(),
  conflictPolicy: z.enum(DRIVE_UPLOAD_CONFLICT_POLICIES).optional(),
  /** 上传为指定节点的新版本（与 parentId 互斥） */
  nodeId: z.coerce.number().int().positive().optional(),
});

export type DriveSimpleUploadFields = z.infer<typeof driveSimpleUploadFieldsSchema>;

// ─── 外链 ─────────────────────────────────────────────────────────────────────

const shareCapabilitiesSchema = z.array(z.enum(DRIVE_SHARE_CAPABILITIES)).min(1, '至少选择一项能力').max(3)
  .transform((caps) => [...new Set(caps)]);

const extensionSchema = z.string().trim().min(1).max(32).regex(/^\.?[A-Za-z0-9]+$/, '扩展名只能包含字母与数字')
  .transform((v) => v.replace(/^\./, '').toLowerCase());

const IPV4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;
const IPV6 = /^[0-9a-fA-F:]+(?:%[0-9a-zA-Z]+)?$/;

/** 单个 IPv4 / IPv6 地址或 CIDR 段（1.2.3.0/24、2001:db8::/32） */
export function isIpOrCidr(value: string): boolean {
  const [ip, prefix, ...rest] = value.split('/');
  if (rest.length > 0 || !ip) return false;
  const v4 = IPV4.exec(ip);
  if (v4) {
    if (v4.slice(1).some((part) => Number(part) > 255)) return false;
    return prefix === undefined || (/^\d{1,2}$/.test(prefix) && Number(prefix) <= 32);
  }
  if (ip.includes(':') && IPV6.test(ip) && ip.split('::').length <= 2) {
    return prefix === undefined || (/^\d{1,3}$/.test(prefix) && Number(prefix) <= 128);
  }
  return false;
}

export const ipOrCidrSchema = z.string().trim().max(64).refine(isIpOrCidr, '请输入合法的 IP 地址或 CIDR 段');

/** 文件收集策略（kind=collect 时有效） */
export const driveCollectPolicySchema = z.object({
  /** 单文件大小上限（MB）；null = 跟随系统设置 */
  maxFileSizeMb: z.number().int().min(1).max(10_240).nullable().default(null),
  /** 允许的扩展名（空 = 不限，但仍受系统黑名单约束） */
  allowedExtensions: z.array(extensionSchema).max(50).default([]),
  /** 是否要求提交人填写姓名 */
  requireSubmitter: z.boolean().default(true),
  /** 累计可收集的文件数；null = 不限 */
  maxUploads: z.number().int().positive().nullable().default(null),
});

export type DriveCollectPolicy = z.infer<typeof driveCollectPolicySchema>;

export const createDriveShareLinkSchema = z.object({
  /** share = 分享；collect = 文件收集（目标须为文件夹，能力位须含 upload） */
  kind: z.enum(DRIVE_SHARE_KINDS).default('share'),
  /** 能力位：preview / download / upload；download 隐含 preview */
  capabilities: shareCapabilitiesSchema.default(['preview']),
  /** 访问密码；空 / 省略 = 无密码 */
  password: z.string().min(4, '密码至少 4 位').max(32).optional(),
  expireAt: dateTimeStringSchema.nullable().default(null),
  maxAccessCount: z.number().int().positive().nullable().default(null),
  maxDownloadCount: z.number().int().positive().nullable().default(null),
  remark: z.string().max(256).optional(),
  /** 允许访问的 IP / CIDR 白名单；空 = 不限制 */
  allowedIps: z.array(ipOrCidrSchema).max(50).default([]),
  /** 预览页叠加访问者水印（分享人 · 时间 · 访问 IP） */
  watermark: z.boolean().default(false),
  /** 文件收集策略；kind=collect 时缺省取默认策略 */
  collectPolicy: driveCollectPolicySchema.nullable().default(null),
});

export type CreateDriveShareLinkInput = z.infer<typeof createDriveShareLinkSchema>;

export const updateDriveShareLinkSchema = partialForUpdate(createDriveShareLinkSchema.omit({ kind: true })).extend({
  enabled: z.boolean().optional(),
  /** true = 清除密码 */
  clearPassword: z.boolean().optional(),
});

export type UpdateDriveShareLinkInput = z.infer<typeof updateDriveShareLinkSchema>;

export const drivePublicAccessSchema = z.object({
  password: z.string().max(32).optional(),
});

export type DrivePublicAccessInput = z.infer<typeof drivePublicAccessSchema>;

/** 登录用户把外链内容转存到自己可写的目录 */
export const saveFromDriveShareSchema = z.object({
  /** 要转存的节点；省略 = 外链根节点 */
  nodeIds: z.array(z.number().int().positive()).max(200).optional(),
  targetSpaceId: z.number().int().positive(),
  targetParentId: z.number().int().positive().nullable().default(null),
});

export type SaveFromDriveShareInput = z.infer<typeof saveFromDriveShareSchema>;

/** 文件收集：匿名上传附带的提交人信息（multipart 字段） */
export const drivePublicUploadFieldsSchema = z.object({
  submitterName: z.string().trim().max(50).optional(),
  submitterNote: z.string().trim().max(200).optional(),
});

export type DrivePublicUploadFields = z.infer<typeof drivePublicUploadFieldsSchema>;

// ─── 访问申请 ─────────────────────────────────────────────────────────────────

export const createDriveAccessRequestSchema = z.object({
  nodeId: z.number().int().positive(),
  role: z.enum(DRIVE_REQUESTABLE_ROLES).default('viewer'),
  reason: z.string().trim().max(500).optional(),
});

export type CreateDriveAccessRequestInput = z.infer<typeof createDriveAccessRequestSchema>;

export const decideDriveAccessRequestSchema = z.object({
  approve: z.boolean(),
  /** 通过时实际授予的角色；缺省按申请的角色 */
  role: z.enum(DRIVE_REQUESTABLE_ROLES).optional(),
  /** 通过时的授权到期时间；null / 缺省 = 长期 */
  expireAt: dateTimeStringSchema.nullable().optional(),
  note: z.string().trim().max(200).optional(),
});

export type DecideDriveAccessRequestInput = z.infer<typeof decideDriveAccessRequestSchema>;

// ─── 治理：法律保留 / 归档 / 配额申请 ────────────────────────────────────────

export const createDriveLegalHoldSchema = z.object({
  nodeId: z.number().int().positive(),
  reason: z.string().trim().min(1, '请填写保留原因').max(500),
});
export type CreateDriveLegalHoldInput = z.infer<typeof createDriveLegalHoldSchema>;

export const releaseDriveLegalHoldSchema = z.object({
  note: z.string().trim().max(200).optional(),
});
export type ReleaseDriveLegalHoldInput = z.infer<typeof releaseDriveLegalHoldSchema>;

export const createDriveQuotaRequestSchema = z.object({
  /** 期望的空间配额（GB） */
  requestedGb: z.number().int().min(1).max(1_000_000),
  reason: z.string().trim().max(500).optional(),
});
export type CreateDriveQuotaRequestInput = z.infer<typeof createDriveQuotaRequestSchema>;

export const decideDriveQuotaRequestSchema = z.object({
  approve: z.boolean(),
  /** 通过时实际批准的配额（GB）；缺省按申请值 */
  quotaGb: z.number().int().min(1).max(1_000_000).optional(),
  note: z.string().trim().max(200).optional(),
});
export type DecideDriveQuotaRequestInput = z.infer<typeof decideDriveQuotaRequestSchema>;

export const createDriveOpenAppGrantSchema = z.object({
  clientId: z.string().trim().min(1).max(64),
  spaceId: z.number().int().positive(),
  /** 应用在该空间的最高角色（manager 不开放给应用） */
  role: z.enum(['viewer', 'downloader', 'editor']).default('downloader'),
  remark: z.string().trim().max(200).optional(),
});
export type CreateDriveOpenAppGrantInput = z.infer<typeof createDriveOpenAppGrantSchema>;

// ─── 互通：发送到聊天 ─────────────────────────────────────────────────────────

export const sendDriveNodeToChatSchema = z.object({
  conversationIds: z.array(z.number().int().positive()).min(1, '请选择会话').max(20),
  note: z.string().trim().max(500).optional(),
});
export type SendDriveNodeToChatInput = z.infer<typeof sendDriveNodeToChatSchema>;

// ─── 版本 / 锁 / 标签 / 评论 ──────────────────────────────────────────────────

export const driveVersionCommentSchema = z.object({
  comment: z.string().max(500).optional(),
});

export const lockDriveNodeSchema = z.object({
  minutes: z.number().int().min(1).max(24 * 60).optional(),
});

export type LockDriveNodeInput = z.infer<typeof lockDriveNodeSchema>;

export const createDriveTagSchema = z.object({
  spaceId: z.number().int().positive(),
  name: z.string().trim().min(1, '标签名称不能为空').max(50),
  color: z.string().max(20).optional(),
});

export const updateDriveTagSchema = partialForUpdate(createDriveTagSchema.omit({ spaceId: true }));

export type CreateDriveTagInput = z.infer<typeof createDriveTagSchema>;
export type UpdateDriveTagInput = z.infer<typeof updateDriveTagSchema>;

export const setDriveNodeTagsSchema = z.object({
  tagIds: z.array(z.number().int().positive()).max(50),
});

export type SetDriveNodeTagsInput = z.infer<typeof setDriveNodeTagsSchema>;

export const createDriveNodeCommentSchema = z.object({
  content: z.string().trim().min(1, '评论内容不能为空').max(2000),
  mentionUserIds: z.array(z.int().positive()).max(20).default([]),
  parentId: z.number().int().positive().nullable().default(null),
});

export type CreateDriveNodeCommentInput = z.infer<typeof createDriveNodeCommentSchema>;

export const updateDriveNodeCommentSchema = partialForUpdate(createDriveNodeCommentSchema.omit({ parentId: true }));
export type UpdateDriveNodeCommentInput = z.infer<typeof updateDriveNodeCommentSchema>;

export const driveMetadataSchema = z.record(
  z.string().trim().min(1).max(64).refine((key) => !['__proto__', 'constructor', 'prototype'].includes(key), '属性名称不可用'),
  z.union([z.string().max(512), z.number().finite(), z.boolean(), z.null()]),
).refine((value) => Object.keys(value).length <= 30, '自定义属性最多 30 项');

const createDriveNodeProfileSchema = z.object({
  description: z.string().max(2000).nullable(),
  metadata: driveMetadataSchema,
});
export const updateDriveNodeProfileSchema = partialForUpdate(createDriveNodeProfileSchema);
export type UpdateDriveNodeProfileInput = z.infer<typeof updateDriveNodeProfileSchema>;

export const mergeDriveTagsSchema = z.object({ targetId: z.int().positive() });

// ─── 管理 / 设置 ──────────────────────────────────────────────────────────────

export const adminUpdateDriveSpaceSchema = z.object({
  name: z.string().trim().min(1).max(100).optional(),
  description: z.string().max(300).nullable().optional(),
  quotaGb: z.number().min(0).max(1_000_000).nullable().optional(),
  maxVersions: z.number().int().min(1).max(200).nullable().optional(),
  allowExternalShare: z.boolean().optional(),
  defaultMemberRole: z.enum(DRIVE_ROLES).nullable().optional(),
  status: entityStatusSchema.optional(),
  ownerId: z.number().int().positive().optional(),
});

export type AdminUpdateDriveSpaceInput = z.infer<typeof adminUpdateDriveSpaceSchema>;

/** 治理任务（容量重算 / 索引补建）作用范围；缺省为全部空间 */
export const driveAdminTaskScopeSchema = z.object({
  spaceId: z.number().int().positive().optional(),
});

export type DriveAdminTaskScopeInput = z.infer<typeof driveAdminTaskScopeSchema>;
