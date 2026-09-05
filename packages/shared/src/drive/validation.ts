import * as z from 'zod';
import { dateTimeStringSchema, partialForUpdate } from '../core/validation';
import {
  DRIVE_ROLES,
  DRIVE_SHARE_PERMISSIONS,
  DRIVE_SUBJECT_TYPES,
  DRIVE_UPLOAD_CONFLICT_POLICIES,
} from './constants';

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
  status: z.enum(['enabled', 'disabled']).default('enabled'),
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

// ─── 节点 ─────────────────────────────────────────────────────────────────────

export const createDriveFolderSchema = z.object({
  spaceId: z.number().int().positive(),
  parentId: z.number().int().positive().nullable().default(null),
  name: driveNodeNameSchema,
});

export type CreateDriveFolderInput = z.infer<typeof createDriveFolderSchema>;

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
  chunkSize: z.number().int().min(1024 * 1024).max(64 * 1024 * 1024),
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

export const createDriveShareLinkSchema = z.object({
  permission: z.enum(DRIVE_SHARE_PERMISSIONS).default('preview'),
  /** 访问密码；空 / 省略 = 无密码 */
  password: z.string().min(4, '密码至少 4 位').max(32).optional(),
  expireAt: dateTimeStringSchema.nullable().default(null),
  maxAccessCount: z.number().int().positive().nullable().default(null),
  remark: z.string().max(256).optional(),
});

export type CreateDriveShareLinkInput = z.infer<typeof createDriveShareLinkSchema>;

export const updateDriveShareLinkSchema = partialForUpdate(createDriveShareLinkSchema).extend({
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
  parentId: z.number().int().positive().nullable().default(null),
});

export type CreateDriveNodeCommentInput = z.infer<typeof createDriveNodeCommentSchema>;

// ─── 管理 / 设置 ──────────────────────────────────────────────────────────────

export const adminUpdateDriveSpaceSchema = z.object({
  name: z.string().trim().min(1).max(100).optional(),
  description: z.string().max(300).nullable().optional(),
  quotaGb: z.number().min(0).max(1_000_000).nullable().optional(),
  maxVersions: z.number().int().min(1).max(200).nullable().optional(),
  allowExternalShare: z.boolean().optional(),
  defaultMemberRole: z.enum(DRIVE_ROLES).nullable().optional(),
  status: z.enum(['enabled', 'disabled']).optional(),
  ownerId: z.number().int().positive().optional(),
});

export type AdminUpdateDriveSpaceInput = z.infer<typeof adminUpdateDriveSpaceSchema>;

export const driveSettingsSchema = z.object({
  personalQuotaGb: z.number().min(0).max(1_000_000),
  departmentQuotaGb: z.number().min(0).max(1_000_000),
  teamQuotaGb: z.number().min(0).max(1_000_000),
  departmentSpaceAutoCreate: z.boolean(),
  recycleRetentionDays: z.number().int().min(0).max(3650),
  maxVersions: z.number().int().min(1).max(200),
  quotaWarningPercent: z.number().int().min(50).max(100),
  externalShareEnabled: z.boolean(),
  externalShareMaxDays: z.number().int().min(0).max(3650),
  externalShareRequirePassword: z.boolean(),
  blockedExtensions: z.string().max(1000),
  thumbnailEnabled: z.boolean(),
  textIndexEnabled: z.boolean(),
});

export type DriveSettingsInput = z.infer<typeof driveSettingsSchema>;

/** 治理任务（容量重算 / 索引补建）作用范围；缺省为全部空间 */
export const driveAdminTaskScopeSchema = z.object({
  spaceId: z.number().int().positive().optional(),
});

export type DriveAdminTaskScopeInput = z.infer<typeof driveAdminTaskScopeSchema>;
