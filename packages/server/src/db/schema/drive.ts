import { pgTable, varchar, timestamp, pgEnum, integer, bigint, boolean, primaryKey, unique, index, uniqueIndex, text, jsonb, smallint, uuid as pgUuid, customType, type AnyPgColumn } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { statusEnum, timestampColumns } from './common';
import { auditColumns, departments, tenants, users } from './core';
import { managedFiles } from './files';

// ─── 枚举（与 @zenith/shared/drive constants 三端同步）─────────────────────────

/** 空间类型：personal=个人空间（每人一个）；department=部门空间（按部门绑定）；team=协作空间 */
export const driveSpaceTypeEnum = pgEnum('drive_space_type', ['personal', 'department', 'team']);

/** 授权主体类型 */
export const driveSubjectTypeEnum = pgEnum('drive_subject_type', ['user', 'department', 'role', 'user_group']);

/** 网盘角色：viewer 仅预览 < downloader 可下载 < editor 可写 < manager 可管理权限 */
export const driveRoleEnum = pgEnum('drive_role', ['viewer', 'downloader', 'editor', 'manager']);

export const driveNodeTypeEnum = pgEnum('drive_node_type', ['folder', 'file']);

/** 外链能力位：preview 在线预览；download 下载 / 转存；upload 向目标文件夹上传（文件收集） */
export const driveShareCapabilityEnum = pgEnum('drive_share_capability', ['preview', 'download', 'upload']);

/** 外链种类：share 分享出去；collect 文件收集（匿名向文件夹上传） */
export const driveShareKindEnum = pgEnum('drive_share_kind', ['share', 'collect']);

/** 渲染产物种类：thumbnail 缩略图；text 正文抽取；pdf 预览用 PDF；preview 预览页图 */
export const driveRenditionKindEnum = pgEnum('drive_rendition_kind', ['thumbnail', 'text', 'pdf', 'preview']);

export const driveRenditionStatusEnum = pgEnum('drive_rendition_status', ['pending', 'ready', 'failed', 'skipped']);

/** 同名冲突策略：rename 自动加后缀；version 作为新版本覆盖；fail 直接报错 */
export const driveUploadConflictPolicyEnum = pgEnum('drive_upload_conflict_policy', ['rename', 'version', 'fail']);

export const driveActivityActionEnum = pgEnum('drive_activity_action', [
  'upload', 'new_version', 'create_folder', 'rename', 'move', 'copy', 'delete', 'restore', 'purge',
  'download', 'preview', 'share_create', 'share_update', 'share_revoke', 'share_access', 'save_from_share', 'collect_upload',
  'permission_change', 'inherit_change', 'version_restore', 'version_delete', 'lock', 'unlock', 'comment', 'tag',
]);

// ─── 空间 ─────────────────────────────────────────────────────────────────────

export const driveSpaces = pgTable('drive_spaces', {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  type: driveSpaceTypeEnum().notNull(),
  name: varchar({ length: 100 }).notNull(),
  description: varchar({ length: 300 }),
  /** lucide 图标名 */
  icon: varchar({ length: 50 }),
  /** personal 空间的所有者；team 空间的创建人（转让后变更） */
  ownerId: integer().references(() => users.id, { onDelete: 'set null' }),
  /** department 空间绑定的部门 */
  departmentId: integer().references(() => departments.id, { onDelete: 'set null' }),
  /** department / team 空间隐式成员的默认角色；null = 不授予隐式成员 */
  defaultMemberRole: driveRoleEnum(),
  /** 配额（字节）；null = 取系统配置默认值；0 = 不限 */
  quotaBytes: bigint({ mode: 'number' }),
  /** 已用逻辑字节（含历史版本与回收站） */
  usedBytes: bigint({ mode: 'number' }).notNull().default(0),
  /** 每文件保留版本数上限；null = 取系统配置默认值 */
  maxVersions: integer(),
  allowExternalShare: boolean().notNull().default(true),
  status: statusEnum().notNull().default('enabled'),
  sort: integer().notNull().default(0),
  tenantId: integer().references(() => tenants.id, { onDelete: 'cascade' }),
  ...auditColumns(),
  ...timestampColumns(),
}, (t) => [
  uniqueIndex('drive_spaces_personal_owner_uq').on(t.ownerId).where(sql`${t.type} = 'personal'`),
  uniqueIndex('drive_spaces_department_uq').on(t.departmentId).where(sql`${t.type} = 'department'`),
  index('drive_spaces_tenant_idx').on(t.tenantId),
]);

export type DriveSpaceRow = typeof driveSpaces.$inferSelect;
export type NewDriveSpace = typeof driveSpaces.$inferInsert;

/** 空间成员（纯关联表；team 空间显式成员，department 空间用于补充授权） */
export const driveSpaceMembers = pgTable('drive_space_members', {
  spaceId: integer().notNull().references(() => driveSpaces.id, { onDelete: 'cascade' }),
  subjectType: driveSubjectTypeEnum().notNull(),
  subjectId: integer().notNull(),
  role: driveRoleEnum().notNull().default('viewer'),
  createdAt: timestamp().defaultNow().notNull(),
}, (t) => [
  primaryKey({ columns: [t.spaceId, t.subjectType, t.subjectId] }),
  index('drive_space_members_subject_idx').on(t.subjectType, t.subjectId),
]);

export type DriveSpaceMemberRow = typeof driveSpaceMembers.$inferSelect;

// ─── 节点（文件夹 / 文件统一树）───────────────────────────────────────────────

export const driveNodes = pgTable('drive_nodes', {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  spaceId: integer().notNull().references(() => driveSpaces.id, { onDelete: 'cascade' }),
  /** 父节点；null = 空间根级 */
  parentId: integer().references((): AnyPgColumn => driveNodes.id, { onDelete: 'cascade' }),
  /** 祖先链（根 → 父，不含自身）；子树查询 `@>`、可见性 `&&` 均走 GIN */
  ancestorIds: integer().array().notNull().default([]),
  depth: smallint().notNull().default(0),
  type: driveNodeTypeEnum().notNull(),
  name: varchar({ length: 255 }).notNull(),
  extension: varchar({ length: 32 }),
  mimeType: varchar({ length: 128 }),
  /** 当前版本的托管文件；folder 为 null */
  fileId: pgUuid().references(() => managedFiles.id, { onDelete: 'restrict' }),
  size: bigint({ mode: 'number' }).notNull().default(0),
  contentHash: varchar({ length: 64 }),
  currentVersion: integer().notNull().default(1),
  /** false = 断开继承：上级授权与空间普通角色不再透传（空间 manager 除外） */
  inheritPermissions: boolean().notNull().default(true),
  /**
   * ACL 生效链（物化）：从最近一个断开继承的祖先（含）到父节点的祖先 id；自身断开继承时为空数组。
   * 有效角色 = max(自身授权, 链上授权[, aclOpen ? 空间角色 : ∅])，可见性谓词由此一条 SQL 精确成立。
   */
  aclChainIds: integer().array().notNull().default([]),
  /** true = 从根到自身链上没有任何断点，空间角色透传到本节点 */
  aclOpen: boolean().notNull().default(true),
  /** 签出锁 */
  lockedBy: integer().references(() => users.id, { onDelete: 'set null' }),
  lockedAt: timestamp(),
  lockExpiresAt: timestamp(),
  /** 软删除；非 null 表示在回收站 */
  deletedAt: timestamp(),
  deletedBy: integer().references(() => users.id, { onDelete: 'set null' }),
  /** 同一次删除的子树根节点 id；回收站只展示 deletedRootId = id 的根项 */
  deletedRootId: integer(),
  tenantId: integer().references(() => tenants.id, { onDelete: 'cascade' }),
  ...auditColumns(),
  ...timestampColumns(),
}, (t) => [
  index('drive_nodes_space_parent_idx').on(t.spaceId, t.parentId, t.deletedAt),
  index('drive_nodes_ancestors_gin_idx').using('gin', t.ancestorIds),
  index('drive_nodes_acl_chain_gin_idx').using('gin', t.aclChainIds),
  index('drive_nodes_file_idx').on(t.fileId),
  index('drive_nodes_deleted_root_idx').on(t.deletedRootId),
  index('drive_nodes_content_hash_idx').on(t.contentHash),
  // pg_trgm：节点名模糊检索（扩展在 0001_extensions.sql 已启用）
  index('drive_nodes_name_trgm_idx').using('gin', t.name.op('gin_trgm_ops')),
  // 同层同名唯一（大小写不敏感、仅未删除节点；根级用 0 占位）
  uniqueIndex('drive_nodes_sibling_name_uq')
    .on(t.spaceId, sql`coalesce(${t.parentId}, 0)`, sql`lower(${t.name})`)
    .where(sql`${t.deletedAt} is null`),
]);

export type DriveNodeRow = typeof driveNodes.$inferSelect;
export type NewDriveNode = typeof driveNodes.$inferInsert;

/** 节点授权（含 expireAt 临时授权；子树继承） */
export const driveNodePermissions = pgTable('drive_node_permissions', {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  nodeId: integer().notNull().references(() => driveNodes.id, { onDelete: 'cascade' }),
  subjectType: driveSubjectTypeEnum().notNull(),
  subjectId: integer().notNull(),
  role: driveRoleEnum().notNull(),
  /** 到期自动失效；null = 长期 */
  expireAt: timestamp(),
  tenantId: integer().references(() => tenants.id, { onDelete: 'cascade' }),
  ...auditColumns(),
  ...timestampColumns(),
}, (t) => [
  unique('drive_node_permissions_node_subject_unique').on(t.nodeId, t.subjectType, t.subjectId),
  index('drive_node_permissions_subject_idx').on(t.subjectType, t.subjectId),
]);

export type DriveNodePermissionRow = typeof driveNodePermissions.$inferSelect;

/** 文件版本（追加型，作者即上传人） */
export const driveFileVersions = pgTable('drive_file_versions', {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  nodeId: integer().notNull().references(() => driveNodes.id, { onDelete: 'cascade' }),
  version: integer().notNull(),
  fileId: pgUuid().notNull().references(() => managedFiles.id, { onDelete: 'restrict' }),
  size: bigint({ mode: 'number' }).notNull().default(0),
  contentHash: varchar({ length: 64 }),
  comment: varchar({ length: 500 }),
  authorId: integer().references(() => users.id, { onDelete: 'set null' }),
  createdAt: timestamp().defaultNow().notNull(),
}, (t) => [
  unique('drive_file_versions_node_version_unique').on(t.nodeId, t.version),
  index('drive_file_versions_file_idx').on(t.fileId),
]);

export type DriveFileVersionRow = typeof driveFileVersions.$inferSelect;

// ─── 外链 ─────────────────────────────────────────────────────────────────────

export const driveShareLinks = pgTable('drive_share_links', {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  nodeId: integer().notNull().references(() => driveNodes.id, { onDelete: 'cascade' }),
  /** share = 分享；collect = 文件收集（目标必须是文件夹，能力位含 upload） */
  kind: driveShareKindEnum().notNull().default('share'),
  /** 明文 token 的 SHA-256（hex）；明文只在 tokenEncrypted 中加密留存 */
  token: varchar({ length: 64 }).notNull().unique(),
  tokenEncrypted: varchar({ length: 256 }),
  passwordHash: varchar({ length: 100 }),
  /** 能力位集合（preview / download / upload） */
  capabilities: driveShareCapabilityEnum().array().notNull().default(['preview']),
  enabled: boolean().notNull().default(true),
  expireAt: timestamp(),
  maxAccessCount: integer(),
  accessCount: integer().notNull().default(0),
  /** 下载次数上限；null = 不限 */
  maxDownloadCount: integer(),
  downloadCount: integer().notNull().default(0),
  /** 文件收集：累计收到的文件数 */
  uploadCount: integer().notNull().default(0),
  /** 访问会话版本；+1 即让所有已签发会话失效 */
  sessionVersion: integer().notNull().default(1),
  revokedAt: timestamp(),
  remark: varchar({ length: 256 }),
  tenantId: integer().references(() => tenants.id, { onDelete: 'cascade' }),
  ...auditColumns(),
  ...timestampColumns(),
}, (t) => [
  index('drive_share_links_node_idx').on(t.nodeId),
  index('drive_share_links_tenant_idx').on(t.tenantId),
]);

export type DriveShareLinkRow = typeof driveShareLinks.$inferSelect;

/**
 * 外链访问留痕（含被拒绝的尝试）。
 * 按 created_at 月度 RANGE 分区（分区 DDL 在 0005_drive_partitions.sql，Drizzle 仍以普通表描述列 / 索引 / 外键）；
 * 没有代理主键：分区键必须进主键，`id` 只作展示序号。保留策略按分区整表 DROP。
 */
export const driveShareAccessLogs = pgTable('drive_share_access_logs', {
  id: integer().generatedAlwaysAsIdentity(),
  shareId: integer().notNull().references(() => driveShareLinks.id, { onDelete: 'cascade' }),
  /** 冗余节点 id，便于按文件检索 */
  nodeId: integer().notNull(),
  /** access=校验/进入；list=浏览子目录；preview=预览；download=下载；save=转存；upload=收集上传 */
  action: varchar({ length: 16 }).notNull(),
  clientIp: varchar({ length: 64 }),
  /** 是否通过校验（false=密码错误 / 已过期 / 超次数） */
  ok: boolean().notNull().default(true),
  createdAt: timestamp().defaultNow().notNull(),
}, (t) => [
  index('drive_share_access_logs_share_idx').on(t.shareId, t.createdAt),
  index('drive_share_access_logs_created_brin_idx').using('brin', t.createdAt),
]);

// ─── 动态 / 个人状态 ──────────────────────────────────────────────────────────

/**
 * 文件动态（追加型；外链匿名访问 actorId 为 null）。
 * 按 created_at 月度 RANGE 分区（同 drive_share_access_logs 约定）；`id` 为无主键的序号列，
 * 列表按 (created_at, id) 倒序。预览类高频事件在写入侧按 (actor, node, 10 分钟) 去重。
 */
export const driveActivities = pgTable('drive_activities', {
  id: integer().generatedAlwaysAsIdentity(),
  spaceId: integer().notNull(),
  /** 节点彻底删除后置 null，nodeName 保留快照 */
  nodeId: integer().references(() => driveNodes.id, { onDelete: 'set null' }),
  nodeName: varchar({ length: 255 }).notNull(),
  nodeType: driveNodeTypeEnum().notNull(),
  action: driveActivityActionEnum().notNull(),
  actorId: integer().references(() => users.id, { onDelete: 'set null' }),
  shareId: integer(),
  detail: jsonb().$type<Record<string, unknown>>(),
  clientIp: varchar({ length: 64 }),
  tenantId: integer().references(() => tenants.id, { onDelete: 'cascade' }),
  createdAt: timestamp().defaultNow().notNull(),
}, (t) => [
  index('drive_activities_node_idx').on(t.nodeId, t.createdAt),
  index('drive_activities_space_idx').on(t.spaceId, t.createdAt),
  index('drive_activities_actor_idx').on(t.actorId, t.createdAt),
  index('drive_activities_created_brin_idx').using('brin', t.createdAt),
]);

export type DriveActivityRow = typeof driveActivities.$inferSelect;

/** 收藏（纯关联表） */
export const driveNodeStars = pgTable('drive_node_stars', {
  userId: integer().notNull().references(() => users.id, { onDelete: 'cascade' }),
  nodeId: integer().notNull().references(() => driveNodes.id, { onDelete: 'cascade' }),
  createdAt: timestamp().defaultNow().notNull(),
}, (t) => [
  primaryKey({ columns: [t.userId, t.nodeId] }),
  index('drive_node_stars_node_idx').on(t.nodeId),
]);

/** 最近访问（纯关联表，按 userId+nodeId 覆盖） */
export const driveRecentAccess = pgTable('drive_recent_access', {
  userId: integer().notNull().references(() => users.id, { onDelete: 'cascade' }),
  nodeId: integer().notNull().references(() => driveNodes.id, { onDelete: 'cascade' }),
  action: driveActivityActionEnum().notNull(),
  lastAccessAt: timestamp().defaultNow().notNull(),
}, (t) => [
  primaryKey({ columns: [t.userId, t.nodeId] }),
  index('drive_recent_access_user_time_idx').on(t.userId, t.lastAccessAt),
]);

/** 分片上传会话与目标目录的绑定（随 upload_sessions 保留策略清理） */
export const driveUploadBindings = pgTable('drive_upload_bindings', {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  uploadId: varchar({ length: 64 }).notNull().unique('drive_upload_bindings_upload_id_unique'),
  spaceId: integer().notNull().references(() => driveSpaces.id, { onDelete: 'cascade' }),
  parentId: integer().references(() => driveNodes.id, { onDelete: 'cascade' }),
  /** 非空 = 上传为该文件节点的新版本 */
  nodeId: integer().references(() => driveNodes.id, { onDelete: 'cascade' }),
  fileName: varchar({ length: 255 }).notNull(),
  fileSize: bigint({ mode: 'number' }).notNull(),
  conflictPolicy: driveUploadConflictPolicyEnum().notNull().default('rename'),
  expectedHash: varchar({ length: 64 }),
  tenantId: integer().references(() => tenants.id, { onDelete: 'cascade' }),
  createdBy: integer().references(() => users.id, { onDelete: 'cascade' }),
  createdAt: timestamp().defaultNow().notNull(),
});

// ─── 标签 / 评论 / 全文索引（P2）─────────────────────────────────────────────

export const driveTags = pgTable('drive_tags', {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  spaceId: integer().notNull().references(() => driveSpaces.id, { onDelete: 'cascade' }),
  name: varchar({ length: 50 }).notNull(),
  color: varchar({ length: 20 }),
  tenantId: integer().references(() => tenants.id, { onDelete: 'cascade' }),
  ...auditColumns(),
  ...timestampColumns(),
}, (t) => [unique('drive_tags_space_name_unique').on(t.spaceId, t.name)]);

export type DriveTagRow = typeof driveTags.$inferSelect;

export const driveNodeTags = pgTable('drive_node_tags', {
  nodeId: integer().notNull().references(() => driveNodes.id, { onDelete: 'cascade' }),
  tagId: integer().notNull().references(() => driveTags.id, { onDelete: 'cascade' }),
}, (t) => [
  primaryKey({ columns: [t.nodeId, t.tagId] }),
  index('drive_node_tags_tag_idx').on(t.tagId),
]);

/** 文件评论（作者即当前用户） */
export const driveNodeComments = pgTable('drive_node_comments', {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  nodeId: integer().notNull().references(() => driveNodes.id, { onDelete: 'cascade' }),
  parentId: integer().references((): AnyPgColumn => driveNodeComments.id, { onDelete: 'cascade' }),
  content: varchar({ length: 2000 }).notNull(),
  authorId: integer().references(() => users.id, { onDelete: 'set null' }),
  tenantId: integer().references(() => tenants.id, { onDelete: 'cascade' }),
  ...timestampColumns(),
}, (t) => [index('drive_node_comments_node_idx').on(t.nodeId)]);

export type DriveNodeCommentRow = typeof driveNodeComments.$inferSelect;

/** PostgreSQL tsvector 列（drizzle 无内置类型） */
const tsvector = customType<{ data: string }>({
  dataType() {
    return 'tsvector';
  },
});

/** 文本类文件抽取的正文（全文检索；每节点一行，随当前版本覆盖；searchVector 由 service 经 to_tsvector 写入） */
export const driveNodeTexts = pgTable('drive_node_texts', {
  nodeId: integer().primaryKey().references(() => driveNodes.id, { onDelete: 'cascade' }),
  version: integer().notNull(),
  content: text().notNull().default(''),
  searchVector: tsvector(),
  updatedAt: timestamp().defaultNow().$onUpdate(() => new Date()).notNull(),
}, (t) => [
  index('drive_node_texts_search_idx').using('gin', t.searchVector),
  // CJK 关键词走子串匹配：pg_trgm 让 ILIKE 命中索引而非全表扫
  index('drive_node_texts_content_trgm_idx').using('gin', t.content.op('gin_trgm_ops')),
]);

/**
 * 渲染产物（缩略图 / 正文抽取 / PDF / 预览页图）：每节点每种类一行，随当前版本覆盖。
 * 生产者是系统队列 worker `drive-renditions`（去重键 node:version:kind），正文本体存 drive_node_texts。
 */
export const driveNodeRenditions = pgTable('drive_node_renditions', {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  nodeId: integer().notNull().references(() => driveNodes.id, { onDelete: 'cascade' }),
  /** 产物对应的文件版本号 */
  version: integer().notNull(),
  kind: driveRenditionKindEnum().notNull(),
  status: driveRenditionStatusEnum().notNull().default('pending'),
  /** 二进制产物（缩略图 / PDF / 页图）对应的托管文件；text 类为 null */
  fileId: pgUuid().references(() => managedFiles.id, { onDelete: 'set null' }),
  /** 产物元信息（宽高 / 页数 / 字符数等） */
  meta: jsonb().$type<Record<string, unknown>>(),
  error: varchar({ length: 500 }),
  ...timestampColumns(),
}, (t) => [
  unique('drive_node_renditions_node_kind_unique').on(t.nodeId, t.kind),
  index('drive_node_renditions_file_idx').on(t.fileId),
  index('drive_node_renditions_status_idx').on(t.status, t.kind),
]);

export type DriveNodeRenditionRow = typeof driveNodeRenditions.$inferSelect;
