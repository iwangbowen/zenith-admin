import * as z from 'zod';
import { dateRangeBound, idParam, paginated, paginationQuery, queryBool } from '../../core/api-schemas';
import { defineContract, fileField, multipart, op } from '../../core/contract';
import { fileAccessUrlSchema, uploadChunkResultSchema, uploadSessionInitSchema, uploadSessionStatusSchema } from '../../platform/contracts';
import {
  DRIVE_ACTIVITY_ACTIONS,
  DRIVE_NODE_TYPES,
  DRIVE_ROLES,
  DRIVE_SPACE_TYPES,
  DRIVE_SUBJECT_TYPES,
  DRIVE_UPLOAD_CONFLICT_POLICIES,
} from '../constants';
import {
  copyDriveNodesSchema,
  createDriveFolderSchema,
  createDriveNodeCommentSchema,
  createDriveShareLinkSchema,
  driveNodeIdsSchema,
  driveUploadCompleteSchema,
  driveUploadInitSchema,
  driveUploadPrecheckSchema,
  lockDriveNodeSchema,
  moveDriveNodesSchema,
  renameDriveNodeSchema,
  saveDriveNodePermissionsSchema,
  setDriveNodeInheritSchema,
  setDriveNodeTagsSchema,
} from '../validation';
import { driveShareLinkSchema } from './share-links';
import { driveSpaceSchema } from './spaces';
import { driveTagSchema } from './tags';

const driveRoleSchema = z.enum(DRIVE_ROLES);

// ─── 节点 ────────────────────────────────────────────────────────────────────

export const driveBreadcrumbSchema = z.object({
  id: z.int(),
  name: z.string(),
}).meta({ id: 'DriveBreadcrumb' });

export type DriveBreadcrumb = z.infer<typeof driveBreadcrumbSchema>;

export const driveNodeSchema = z.object({
  id: z.int(),
  spaceId: z.int(),
  parentId: z.int().nullable(),
  ancestorIds: z.array(z.int()),
  depth: z.int(),
  type: z.enum(DRIVE_NODE_TYPES),
  name: z.string().meta({ example: '需求说明.md' }),
  extension: z.string().nullable(),
  mimeType: z.string().nullable(),
  fileId: z.string().nullable().meta({ description: '当前版本对应的托管文件 ID；folder 为 null' }),
  size: z.int(),
  contentHash: z.string().nullable(),
  currentVersion: z.int(),
  inheritPermissions: z.boolean(),
  lockedBy: z.int().nullable(),
  lockedByName: z.string().nullable(),
  lockedAt: z.string().nullable(),
  lockExpiresAt: z.string().nullable(),
  thumbnailUrl: z.string().nullable().meta({ description: '缩略图鉴权地址；无缩略图为 null' }),
  url: z.string().nullable().meta({ description: '文件内容鉴权地址（节点 content 接口）；folder 为 null' }),
  deletedAt: z.string().nullable(),
  deletedBy: z.int().nullable(),
  deletedByName: z.string().nullable(),
  isStarred: z.boolean().optional(),
  myRole: driveRoleSchema.nullable().optional().meta({ description: '当前用户对该节点的有效角色' }),
  tags: z.array(driveTagSchema).optional(),
  createdBy: z.int().nullable(),
  createdByName: z.string().nullable(),
  updatedBy: z.int().nullable(),
  updatedByName: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
}).meta({ id: 'DriveNode' });

export type DriveNode = z.infer<typeof driveNodeSchema>;

export const driveNodeListResultSchema = paginated(driveNodeSchema).extend({
  space: driveSpaceSchema.pick({ id: true, name: true, type: true, quotaBytes: true, usedBytes: true, allowExternalShare: true }),
  parent: driveNodeSchema.nullable().meta({ description: '当前目录；根级为 null' }),
  breadcrumbs: z.array(driveBreadcrumbSchema),
  myRole: driveRoleSchema.nullable().meta({ description: '当前用户在当前目录的有效角色' }),
}).meta({ id: 'DriveNodeListResult' });

export type DriveNodeListResult = z.infer<typeof driveNodeListResultSchema>;

export const driveNodeDetailSchema = driveNodeSchema.extend({
  spaceName: z.string(),
  spaceType: z.enum(DRIVE_SPACE_TYPES),
  breadcrumbs: z.array(driveBreadcrumbSchema),
  versionCount: z.int(),
  shareLinkCount: z.int(),
  childCount: z.int().meta({ description: '文件夹：直接子项数；文件：0' }),
}).meta({ id: 'DriveNodeDetail' });

export type DriveNodeDetail = z.infer<typeof driveNodeDetailSchema>;

export const driveRecycleItemSchema = driveNodeSchema.extend({ spaceName: z.string() }).meta({ id: 'DriveRecycleItem' });

export type DriveRecycleItem = z.infer<typeof driveRecycleItemSchema>;

export const driveStarredItemSchema = driveNodeSchema.extend({ spaceName: z.string() }).meta({ id: 'DriveStarredItem' });

export type DriveStarredItem = z.infer<typeof driveStarredItemSchema>;

export const driveRecentItemSchema = driveNodeSchema.extend({
  spaceName: z.string(),
  lastAccessAt: z.string(),
  lastAction: z.enum(DRIVE_ACTIVITY_ACTIONS),
}).meta({ id: 'DriveRecentItem' });

export type DriveRecentItem = z.infer<typeof driveRecentItemSchema>;

export const driveSharedItemSchema = driveNodeSchema.extend({
  spaceName: z.string(),
  grantedVia: z.enum(DRIVE_SUBJECT_TYPES).meta({ description: '授权来源：直接授权给我 / 我所在部门 / 角色 / 用户组' }),
  grantedRole: driveRoleSchema,
}).meta({ id: 'DriveSharedItem' });

export type DriveSharedItem = z.infer<typeof driveSharedItemSchema>;

export const driveSearchItemSchema = driveNodeSchema.extend({
  spaceName: z.string(),
  snippet: z.string().nullable().meta({ description: '全文命中片段（仅正文命中时）' }),
}).meta({ id: 'DriveSearchItem' });

export type DriveSearchItem = z.infer<typeof driveSearchItemSchema>;

/** 复制：小于阈值同步完成；否则返回任务 */
export const driveCopyResultSchema = z.object({
  mode: z.enum(['sync', 'task']),
  taskId: z.int().nullable(),
  copied: z.int(),
}).meta({ id: 'DriveCopyResult' });

export type DriveCopyResult = z.infer<typeof driveCopyResultSchema>;

/** 批量打包：小于阈值同步返回 zip；否则返回任务 */
export const driveBatchDownloadResultSchema = z.object({
  mode: z.enum(['sync', 'task']),
  taskId: z.int().nullable(),
}).meta({ id: 'DriveBatchDownloadResult' });

export type DriveBatchDownloadResult = z.infer<typeof driveBatchDownloadResultSchema>;

// ─── 授权 ────────────────────────────────────────────────────────────────────

export const driveNodePermissionSchema = z.object({
  id: z.int(),
  nodeId: z.int(),
  subjectType: z.enum(DRIVE_SUBJECT_TYPES),
  subjectId: z.int(),
  subjectName: z.string().nullable(),
  role: driveRoleSchema,
  expireAt: z.string().nullable(),
  createdBy: z.int().nullable(),
  createdByName: z.string().nullable(),
  createdAt: z.string(),
  inheritedFrom: driveBreadcrumbSchema.nullable().meta({ description: '继承来源节点（直接授权为 null）' }),
}).meta({ id: 'DriveNodePermission' });

export type DriveNodePermission = z.infer<typeof driveNodePermissionSchema>;

export const driveNodePermissionsResultSchema = z.object({
  nodeId: z.int(),
  inheritPermissions: z.boolean(),
  spaceRole: driveRoleSchema.nullable().meta({ description: '空间层给当前用户的角色' }),
  effectiveRole: driveRoleSchema.nullable().meta({ description: '当前用户的有效角色' }),
  direct: z.array(driveNodePermissionSchema),
  inherited: z.array(driveNodePermissionSchema),
}).meta({ id: 'DriveNodePermissionsResult' });

export type DriveNodePermissionsResult = z.infer<typeof driveNodePermissionsResultSchema>;

// ─── 版本 / 上传 ─────────────────────────────────────────────────────────────

export const driveFileVersionSchema = z.object({
  id: z.int(),
  nodeId: z.int(),
  version: z.int(),
  fileId: z.string(),
  size: z.int(),
  contentHash: z.string().nullable(),
  comment: z.string().nullable(),
  authorId: z.int().nullable(),
  authorName: z.string().nullable(),
  isCurrent: z.boolean(),
  url: z.string().meta({ description: '该版本内容的鉴权地址' }),
  createdAt: z.string(),
}).meta({ id: 'DriveFileVersion' });

export type DriveFileVersion = z.infer<typeof driveFileVersionSchema>;

export const driveUploadPrecheckResultSchema = z.object({
  conflict: z.boolean().meta({ description: '同目录是否存在同名未删除节点' }),
  existingNodeId: z.int().nullable(),
  quotaOk: z.boolean(),
  quotaRemaining: z.int().nullable().meta({ description: '剩余配额（字节）；不限为 null' }),
  instant: z.boolean().meta({ description: '是否可秒传（内容哈希已存在）' }),
  node: driveNodeSchema.nullable().meta({ description: '已按秒传直接创建的节点（instant 且 conflictPolicy 可解决时）' }),
}).meta({ id: 'DriveUploadPrecheck' });

export type DriveUploadPrecheck = z.infer<typeof driveUploadPrecheckResultSchema>;

// ─── 动态 / 评论 ─────────────────────────────────────────────────────────────

export const driveActivitySchema = z.object({
  id: z.int(),
  spaceId: z.int(),
  spaceName: z.string().nullable().optional(),
  nodeId: z.int().nullable(),
  nodeName: z.string(),
  nodeType: z.enum(DRIVE_NODE_TYPES),
  action: z.enum(DRIVE_ACTIVITY_ACTIONS),
  actorId: z.int().nullable(),
  actorName: z.string().nullable(),
  shareId: z.int().nullable(),
  detail: z.record(z.string(), z.unknown()).nullable(),
  clientIp: z.string().nullable(),
  createdAt: z.string(),
}).meta({ id: 'DriveActivity' });

export type DriveActivity = z.infer<typeof driveActivitySchema>;

export const driveNodeCommentSchema = z.object({
  id: z.int(),
  nodeId: z.int(),
  parentId: z.int().nullable(),
  content: z.string(),
  authorId: z.int().nullable(),
  authorName: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
}).meta({ id: 'DriveNodeComment' });

export type DriveNodeComment = z.infer<typeof driveNodeCommentSchema>;

// ─── 入参 ────────────────────────────────────────────────────────────────────

const optionalSpaceId = z.coerce.number().int().positive().optional();

export const driveNodeListQuery = paginationQuery.extend({
  spaceId: optionalSpaceId.meta({ description: '空间 ID；与 parentId 二选一（parentId 缺省 = 空间根级）' }),
  parentId: z.coerce.number().int().positive().optional().meta({ description: '目录节点 ID' }),
  keyword: z.string().optional(),
  type: z.enum(DRIVE_NODE_TYPES).optional(),
  sortBy: z.enum(['name', 'size', 'updatedAt', 'createdAt']).optional(),
  order: z.enum(['asc', 'desc']).optional(),
});

/** 个人视图（与我共享 / 收藏 / 最近）分页参数 */
export const driveNodeViewQuery = paginationQuery.extend({
  keyword: z.string().optional(),
  type: z.enum(DRIVE_NODE_TYPES).optional(),
});

export const driveRecycleQuery = driveNodeViewQuery.extend({
  spaceId: optionalSpaceId,
});

export const driveNodeSearchQuery = paginationQuery.extend({
  keyword: z.string().min(1).meta({ description: '检索关键词', example: '需求' }),
  spaceId: optionalSpaceId,
  type: z.enum(DRIVE_NODE_TYPES).optional(),
  extension: z.string().max(32).optional(),
  fullText: queryBool('是否同时检索文本正文'),
  startTime: dateRangeBound('更新时间起'),
  endTime: dateRangeBound('更新时间止'),
});

export const driveEmptyRecycleQuery = z.object({
  spaceId: optionalSpaceId.meta({ description: '只清空该空间的回收站；缺省为全部' }),
});

export const driveNodeContentQuery = z.object({
  download: queryBool('以附件方式下载'),
  version: z.coerce.number().int().positive().optional().meta({ description: '读取指定历史版本' }),
});

export const driveNodeAccessUrlQuery = z.object({
  purpose: z.enum(['preview', 'download']).default('download'),
});

export const driveNodeVersionParams = idParam.extend({
  version: z.coerce.number().int().positive().meta({ description: '版本号', example: 2 }),
});

export const driveNodeCommentParams = idParam.extend({
  commentId: z.coerce.number().int().positive().meta({ description: '评论 ID', example: 1 }),
});

export const driveUploadIdParam = z.object({
  uploadId: z.string().min(8).meta({ description: '分片上传会话 ID', example: 'c2a8…' }),
});

/** 简单上传（≤ 5MB 单请求）的表单字段 */
const driveUploadBody = multipart(z.object({
  file: fileField(),
  spaceId: z.string(),
  parentId: z.string().optional(),
  conflictPolicy: z.enum(DRIVE_UPLOAD_CONFLICT_POLICIES).optional(),
}));

const driveUploadChunkBody = multipart(z.object({
  uploadId: z.string(),
  index: z.string().meta({ description: '分片序号（从 0 计）' }),
  chunk: fileField('分片内容'),
}));

const driveUploadVersionBody = multipart(z.object({
  file: fileField(),
  comment: z.string().optional(),
}));

// ─── 契约 ────────────────────────────────────────────────────────────────────

/**
 * `/api/drive/nodes`：静态路径（列表 / 个人视图 / 回收站 / 批量 / 上传）与单节点 `/{id}/...`
 * 共用一个契约；服务端按静态路径先于动态路径的顺序分两个路由器挂载。
 */
export const driveNodeContract = defineContract('/api/drive/nodes', {
  list: op.get('/', { query: driveNodeListQuery, response: driveNodeListResultSchema, summary: '目录内容（parentId 缺省 = 空间根级）' }),
  search: op.get('/search', { query: driveNodeSearchQuery, response: paginated(driveSearchItemSchema), summary: '搜索（名称，可选正文全文）' }),
  sharedWithMe: op.get('/shared-with-me', { query: driveNodeViewQuery, response: paginated(driveSharedItemSchema), summary: '与我共享' }),
  starred: op.get('/starred', { query: driveNodeViewQuery, response: paginated(driveStarredItemSchema), summary: '我的收藏' }),
  recent: op.get('/recent', { query: driveNodeViewQuery, response: paginated(driveRecentItemSchema), summary: '最近访问' }),
  recycle: op.get('/recycle', { query: driveRecycleQuery, response: paginated(driveRecycleItemSchema), summary: '回收站' }),
  restore: op.post('/recycle/restore', { body: driveNodeIdsSchema, summary: '从回收站还原' }),
  purge: op.post('/recycle/purge', { body: driveNodeIdsSchema, summary: '彻底删除' }),
  emptyRecycle: op.delete('/recycle', { query: driveEmptyRecycleQuery, summary: '清空回收站（可按空间）' }),
  createFolder: op.post('/folder', { body: createDriveFolderSchema, response: driveNodeSchema, summary: '新建文件夹' }),
  move: op.post('/move', { body: moveDriveNodesSchema, summary: '移动到目标目录（同空间）' }),
  copy: op.post('/copy', { body: copyDriveNodesSchema, response: driveCopyResultSchema, summary: '复制到目标目录（大目录树转任务中心）' }),
  removeBatch: op.delete('/batch', { body: driveNodeIdsSchema, summary: '删除到回收站' }),
  batchDownload: op.post('/batch-download', {
    body: driveNodeIdsSchema,
    response: driveBatchDownloadResultSchema,
    kind: 'file',
    summary: '打包下载（小批量同步 zip，大批量返回任务）',
    description: '文件数 / 总大小低于阈值时直接返回 zip 流；超过阈值转任务中心并以 JSON 信封返回 DriveBatchDownloadResult',
  }),
  precheck: op.post('/precheck', { body: driveUploadPrecheckSchema, response: driveUploadPrecheckResultSchema, summary: '上传预检（冲突 / 配额 / 秒传）' }),
  upload: op.post('/upload', { body: driveUploadBody, response: driveNodeSchema, summary: '简单上传（≤ 5MB 单请求）' }),
  uploadInit: op.post('/upload/init', { body: driveUploadInitSchema, response: uploadSessionInitSchema, summary: '初始化分片上传' }),
  uploadChunk: op.post('/upload/chunk', { body: driveUploadChunkBody, response: uploadChunkResultSchema, summary: '上传单个分片' }),
  uploadComplete: op.post('/upload/complete', { body: driveUploadCompleteSchema, response: driveNodeSchema, summary: '完成分片上传并落地为节点' }),
  uploadStatus: op.get('/upload/{uploadId}/status', { params: driveUploadIdParam, response: uploadSessionStatusSchema, summary: '分片上传进度' }),
  uploadAbort: op.delete('/upload/{uploadId}', { params: driveUploadIdParam, summary: '中止分片上传' }),
  detail: op.get('/{id}', { params: idParam, response: driveNodeDetailSchema, summary: '节点详情' }),
  rename: op.put('/{id}/rename', { params: idParam, body: renameDriveNodeSchema, response: driveNodeSchema, summary: '重命名' }),
  content: op.get('/{id}/content', { params: idParam, query: driveNodeContentQuery, kind: 'file', summary: '文件内容（预览需 viewer；?download=1 需 downloader）' }),
  thumbnail: op.get('/{id}/thumbnail', { params: idParam, kind: 'file', summary: '缩略图' }),
  accessUrl: op.get('/{id}/access-url', { params: idParam, query: driveNodeAccessUrlQuery, response: fileAccessUrlSchema, summary: '解析访问直链（presigned / public；proxy 回落到鉴权地址）' }),
  versions: op.get('/{id}/versions', { params: idParam, response: z.array(driveFileVersionSchema), summary: '版本列表' }),
  uploadVersion: op.post('/{id}/versions', { params: idParam, body: driveUploadVersionBody, response: driveNodeSchema, summary: '上传新版本（≤ 5MB 单请求；大文件用分片 init 传 nodeId）' }),
  versionContent: op.get('/{id}/versions/{version}/content', { params: driveNodeVersionParams, kind: 'file', summary: '历史版本内容' }),
  restoreVersion: op.post('/{id}/versions/{version}/restore', { params: driveNodeVersionParams, response: driveNodeSchema, summary: '回滚到历史版本（生成新版本）' }),
  removeVersion: op.delete('/{id}/versions/{version}', { params: driveNodeVersionParams, summary: '删除历史版本' }),
  permissions: op.get('/{id}/permissions', { params: idParam, response: driveNodePermissionsResultSchema, summary: '节点授权（直接 + 继承）' }),
  savePermissions: op.put('/{id}/permissions', { params: idParam, body: saveDriveNodePermissionsSchema, response: driveNodePermissionsResultSchema, summary: '全量保存节点直接授权（需 manager）' }),
  setInherit: op.put('/{id}/inherit', { params: idParam, body: setDriveNodeInheritSchema, response: driveNodePermissionsResultSchema, summary: '断开 / 恢复继承（需 manager）' }),
  activities: op.get('/{id}/activities', { params: idParam, query: paginationQuery, response: paginated(driveActivitySchema), summary: '节点动态' }),
  comments: op.get('/{id}/comments', { params: idParam, response: z.array(driveNodeCommentSchema), summary: '评论列表' }),
  createComment: op.post('/{id}/comments', { params: idParam, body: createDriveNodeCommentSchema, response: driveNodeCommentSchema, summary: '发表评论' }),
  removeComment: op.delete('/{id}/comments/{commentId}', { params: driveNodeCommentParams, summary: '删除评论（作者或 manager）' }),
  star: op.post('/{id}/star', { params: idParam, summary: '收藏' }),
  unstar: op.delete('/{id}/star', { params: idParam, summary: '取消收藏' }),
  setTags: op.put('/{id}/tags', { params: idParam, body: setDriveNodeTagsSchema, response: driveNodeSchema, summary: '设置节点标签' }),
  lock: op.post('/{id}/lock', { params: idParam, body: lockDriveNodeSchema, response: driveNodeSchema, summary: '签出锁定' }),
  unlock: op.delete('/{id}/lock', { params: idParam, response: driveNodeSchema, summary: '解除锁定' }),
  shareLinks: op.get('/{id}/share-links', { params: idParam, response: z.array(driveShareLinkSchema), summary: '节点外链（manager 见全部，其他人见自己创建的）' }),
  createShareLink: op.post('/{id}/share-links', { params: idParam, body: createDriveShareLinkSchema, response: driveShareLinkSchema, summary: '创建外链（需 editor + drive:link:create）' }),
}, { tags: ['企业网盘-文件'] });
