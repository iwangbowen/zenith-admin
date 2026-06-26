import { pgTable, serial, varchar, timestamp, pgEnum, integer, bigint, boolean, primaryKey, unique, text, uniqueIndex, index, jsonb, smallint, real, date, uuid as pgUuid, type AnyPgColumn } from 'drizzle-orm/pg-core';
import { relations, sql } from 'drizzle-orm';
import { v7 as uuidv7 } from 'uuid';
// 报表中心 jsonb 列形态（前后端共享契约；type-only 导入，编译期即擦除）
import type { ReportDatasourceConfig, ReportDatasetContent, ReportField, ReportGridItem, ReportWidget } from '@zenith/shared';

export const statusEnum = pgEnum('status', ['enabled', 'disabled']);
export const menuTypeEnum = pgEnum('menu_type', ['directory', 'menu', 'button']);
export const fileStorageProviderEnum = pgEnum('file_storage_provider', ['local', 'oss', 's3', 'cos', 'obs', 'kodo', 'bos', 'azure', 'sftp']);
export const dataScopeEnum = pgEnum('data_scope', ['all', 'custom', 'dept_only', 'dept', 'self']);
export const maskTypeEnum = pgEnum('mask_type', ['phone', 'email', 'id_card', 'name', 'bank_card', 'custom']);

/**
 * 通用审计列：`created_by` / `updated_by` 指向 `users.id`（保留 set null）。
 * 用法：在 pgTable 列定义末尾展开 `...auditColumns()`。
 * 该字段由 db/index.ts 的 Proxy 在 insert/update 时根据审计上下文自动注入，
 * 业务代码无需手填。
 */
export const auditColumns = () => ({
  createdBy: integer('created_by').references((): AnyPgColumn => users.id, { onDelete: 'set null' }),
  updatedBy: integer('updated_by').references((): AnyPgColumn => users.id, { onDelete: 'set null' }),
});

// ─── 租户表 ───────────────────────────────────────────────────────────────────
export const tenants = pgTable('tenants', {
  id: serial('id').primaryKey(),
  name: varchar('name', { length: 100 }).notNull(),
  code: varchar('code', { length: 50 }).notNull().unique(),
  logo: varchar('logo', { length: 500 }),
  contactName: varchar('contact_name', { length: 50 }),
  contactPhone: varchar('contact_phone', { length: 20 }),
  status: statusEnum('status').notNull().default('enabled'),
  expireAt: timestamp('expire_at', { withTimezone: true }),
  maxUsers: integer('max_users'),
  /** 租户套餐（菜单白名单）；为空表示不限制 */
  packageId: integer('package_id').references((): AnyPgColumn => tenantPackages.id, { onDelete: 'set null' }),
  remark: text('remark'),
  ...auditColumns(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().$onUpdate(() => new Date()).notNull(),
});

export type TenantRow = typeof tenants.$inferSelect;
export type NewTenant = typeof tenants.$inferInsert;

// ─── 租户套餐表 ───────────────────────────────────────────────────────────────
// 套餐 = 一组菜单白名单。租户绑定套餐即圈定其可用功能范围（SaaS 标配）。
export const tenantPackages = pgTable('tenant_packages', {
  id: serial('id').primaryKey(),
  name: varchar('name', { length: 100 }).notNull().unique(),
  status: statusEnum('status').notNull().default('enabled'),
  remark: text('remark'),
  ...auditColumns(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().$onUpdate(() => new Date()).notNull(),
});

export type TenantPackageRow = typeof tenantPackages.$inferSelect;
export type NewTenantPackage = typeof tenantPackages.$inferInsert;

// ─── 租户套餐-菜单关联表 ──────────────────────────────────────────────────────
export const tenantPackageMenus = pgTable('tenant_package_menus', {
  packageId: integer('package_id').notNull().references(() => tenantPackages.id, { onDelete: 'cascade' }),
  menuId: integer('menu_id').notNull().references((): AnyPgColumn => menus.id, { onDelete: 'cascade' }),
}, (t) => [primaryKey({ columns: [t.packageId, t.menuId] })]);

// ─── 部门表 ───────────────────────────────────────────────────────────────────
export const departments = pgTable('departments', {
  id: serial('id').primaryKey(),
  parentId: integer('parent_id').notNull().default(0),
  name: varchar('name', { length: 64 }).notNull(),
  code: varchar('code', { length: 64 }).notNull(),
  category: varchar('category', { length: 32 }).notNull().default('department'),
  leaderId: integer('leader_id').references((): AnyPgColumn => users.id, { onDelete: 'set null' }),
  phone: varchar('phone', { length: 32 }),
  email: varchar('email', { length: 128 }),
  sort: integer('sort').notNull().default(0),
  status: statusEnum('status').notNull().default('enabled'),
  tenantId: integer('tenant_id').references(() => tenants.id, { onDelete: 'cascade' }),
  ...auditColumns(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().$onUpdate(() => new Date()).notNull(),
}, (t) => [unique('departments_tenant_code_unique').on(t.tenantId, t.code)]);

export type DepartmentRow = typeof departments.$inferSelect;
export type NewDepartment = typeof departments.$inferInsert;

// ─── 岗位表 ───────────────────────────────────────────────────────────────────
export const positions = pgTable('positions', {
  id: serial('id').primaryKey(),
  name: varchar('name', { length: 64 }).notNull(),
  code: varchar('code', { length: 64 }).notNull(),
  sort: integer('sort').notNull().default(0),
  status: statusEnum('status').notNull().default('enabled'),
  remark: varchar('remark', { length: 256 }),
  tenantId: integer('tenant_id').references(() => tenants.id, { onDelete: 'cascade' }),
  ...auditColumns(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().$onUpdate(() => new Date()).notNull(),
}, (t) => [unique('positions_tenant_code_unique').on(t.tenantId, t.code)]);

export type PositionRow = typeof positions.$inferSelect;
export type NewPosition = typeof positions.$inferInsert;

export const users = pgTable('users', {
  id: serial('id').primaryKey(),
  username: varchar('username', { length: 32 }).notNull(),
  nickname: varchar('nickname', { length: 32 }).notNull(),
  email: varchar('email', { length: 128 }).notNull(),
  password: varchar('password', { length: 128 }).notNull(),
  avatar: varchar('avatar', { length: 256 }),
  phone: varchar('phone', { length: 20 }),
  departmentId: integer('department_id').references((): AnyPgColumn => departments.id, { onDelete: 'set null' }),
  tenantId: integer('tenant_id').references(() => tenants.id, { onDelete: 'cascade' }),
  gender: varchar('gender', { length: 20 }),
  status: statusEnum('status').notNull().default('enabled'),
  preferences: jsonb('preferences'),
  /** 用户收藏的菜单 ID 列表（有序） */
  favoriteMenus: jsonb('favorite_menus').$type<number[]>(),
  userDataScope: dataScopeEnum('user_data_scope'),
  passwordUpdatedAt: timestamp('password_updated_at').defaultNow().notNull(),
  lastLoginAt: timestamp('last_login_at'),
  ...auditColumns(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().$onUpdate(() => new Date()).notNull(),
}, (t) => [
  unique('users_tenant_username_unique').on(t.tenantId, t.username),
  unique('users_tenant_email_unique').on(t.tenantId, t.email),
]);

export type UserRow = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;

// ─── 菜单表 ───────────────────────────────────────────────────────────────────
export const menus = pgTable('menus', {
  id: serial('id').primaryKey(),
  parentId: integer('parent_id').notNull().default(0),
  title: varchar('title', { length: 64 }).notNull(),
  name: varchar('name', { length: 64 }),
  path: varchar('path', { length: 256 }),
  component: varchar('component', { length: 256 }),
  icon: varchar('icon', { length: 64 }),
  type: menuTypeEnum('type').notNull().default('menu'),
  permission: varchar('permission', { length: 128 }),
  query: varchar('query', { length: 512 }),
  isExternal: boolean('is_external').notNull().default(false),
  sort: integer('sort').notNull().default(0),
  status: statusEnum('status').notNull().default('enabled'),
  visible: boolean('visible').notNull().default(true),
  ...auditColumns(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().$onUpdate(() => new Date()).notNull(),
});

export type MenuRow = typeof menus.$inferSelect;
export type NewMenu = typeof menus.$inferInsert;

// ─── 角色表 ───────────────────────────────────────────────────────────────────
export const roles = pgTable('roles', {
  id: serial('id').primaryKey(),
  name: varchar('name', { length: 64 }).notNull(),
  code: varchar('code', { length: 64 }).notNull(),
  description: varchar('description', { length: 256 }),
  status: statusEnum('status').notNull().default('enabled'),
  dataScope: dataScopeEnum('data_scope').notNull().default('all'),
  tenantId: integer('tenant_id').references(() => tenants.id, { onDelete: 'cascade' }),
  ...auditColumns(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().$onUpdate(() => new Date()).notNull(),
}, (t) => [unique('roles_tenant_code_unique').on(t.tenantId, t.code)]);

export type RoleRow = typeof roles.$inferSelect;
export type NewRole = typeof roles.$inferInsert;

// ─── 用户-角色关联表 ──────────────────────────────────────────────────────────
export const userRoles = pgTable('user_roles', {
  userId: integer('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  roleId: integer('role_id').notNull().references(() => roles.id, { onDelete: 'cascade' }),
}, (t) => [primaryKey({ columns: [t.userId, t.roleId] })]);

// ─── 用户-岗位关联表 ──────────────────────────────────────────────────────────
export const userPositions = pgTable('user_positions', {
  userId: integer('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  positionId: integer('position_id').notNull().references(() => positions.id, { onDelete: 'cascade' }),
}, (t) => [primaryKey({ columns: [t.userId, t.positionId] })]);

// ─── 用户组表 ─────────────────────────────────────────────────────────────────
export const userGroups = pgTable('user_groups', {
  id: serial('id').primaryKey(),
  name: varchar('name', { length: 64 }).notNull(),
  code: varchar('code', { length: 64 }).notNull(),
  description: varchar('description', { length: 256 }),
  ownerId: integer('owner_id').references((): AnyPgColumn => users.id, { onDelete: 'set null' }),
  departmentId: integer('department_id').references((): AnyPgColumn => departments.id, { onDelete: 'set null' }),
  status: statusEnum('status').notNull().default('enabled'),
  tenantId: integer('tenant_id').references(() => tenants.id, { onDelete: 'cascade' }),
  ...auditColumns(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().$onUpdate(() => new Date()).notNull(),
}, (t) => [unique('user_groups_tenant_code_unique').on(t.tenantId, t.code)]);

export type UserGroupRow = typeof userGroups.$inferSelect;
export type NewUserGroup = typeof userGroups.$inferInsert;

// ─── 用户-用户组关联表 ────────────────────────────────────────────────────────
export const userGroupMembers = pgTable('user_group_members', {
  groupId: integer('group_id').notNull().references(() => userGroups.id, { onDelete: 'cascade' }),
  userId: integer('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (t) => [primaryKey({ columns: [t.groupId, t.userId] })]);

// ─── 角色-菜单关联表 ──────────────────────────────────────────────────────────
export const roleMenus = pgTable('role_menus', {
  roleId: integer('role_id').notNull().references(() => roles.id, { onDelete: 'cascade' }),
  menuId: integer('menu_id').notNull().references(() => menus.id, { onDelete: 'cascade' }),
}, (t) => [primaryKey({ columns: [t.roleId, t.menuId] })]);

// ─── 角色管理范围（部门）关联表 ───────────────────────────────────────────────
// 用于工作流"角色作为审批人"时，按提交人所在部门 ∩ 角色管理范围过滤实际成员。
// 若一个角色无任何 role_dept_scopes 记录，视为"全员"（向后兼容）。
export const roleDeptScopes = pgTable('role_dept_scopes', {
  roleId: integer('role_id').notNull().references(() => roles.id, { onDelete: 'cascade' }),
  deptId: integer('dept_id').notNull().references((): AnyPgColumn => departments.id, { onDelete: 'cascade' }),
}, (t) => [primaryKey({ columns: [t.roleId, t.deptId] })]);

// ─── 用户-菜单直接授权关联表 ──────────────────────────────────────────────────
export const userMenus = pgTable('user_menus', {
  userId: integer('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  menuId: integer('menu_id').notNull().references(() => menus.id, { onDelete: 'cascade' }),
}, (t) => [primaryKey({ columns: [t.userId, t.menuId] })]);

// ─── 用户数据权限范围（部门）关联表 ───────────────────────────────────────────
export const userDeptScopes = pgTable('user_dept_scopes', {
  userId: integer('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  deptId: integer('dept_id').notNull().references((): AnyPgColumn => departments.id, { onDelete: 'cascade' }),
}, (t) => [primaryKey({ columns: [t.userId, t.deptId] })]);

// ─── 字典表 ───────────────────────────────────────────────────────────────────
export const dicts = pgTable('dicts', {
  id: serial('id').primaryKey(),
  name: varchar('name', { length: 64 }).notNull(),
  code: varchar('code', { length: 64 }).notNull(),
  description: varchar('description', { length: 256 }),
  status: statusEnum('status').notNull().default('enabled'),
  tenantId: integer('tenant_id').references(() => tenants.id, { onDelete: 'cascade' }),
  ...auditColumns(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().$onUpdate(() => new Date()).notNull(),
}, (t) => [unique('dicts_tenant_code_unique').on(t.tenantId, t.code)]);

export type DictRow = typeof dicts.$inferSelect;
export type NewDict = typeof dicts.$inferInsert;

// ─── 字典项表 ─────────────────────────────────────────────────────────────────
export const dictItems = pgTable('dict_items', {
  id: serial('id').primaryKey(),
  dictId: integer('dict_id').notNull().references(() => dicts.id, { onDelete: 'cascade' }),
  parentId: integer('parent_id').references((): AnyPgColumn => dictItems.id, { onDelete: 'cascade' }),
  label: varchar('label', { length: 64 }).notNull(),
  value: varchar('value', { length: 64 }).notNull(),
  color: varchar('color', { length: 32 }),
  sort: integer('sort').notNull().default(0),
  status: statusEnum('status').notNull().default('enabled'),
  remark: varchar('remark', { length: 256 }),
  metadata: jsonb('metadata'),
  ...auditColumns(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().$onUpdate(() => new Date()).notNull(),
}, (table) => [
  uniqueIndex('dict_items_dict_id_value_unique').on(table.dictId, table.value),
]);

export type DictItemRow = typeof dictItems.$inferSelect;
export type NewDictItem = typeof dictItems.$inferInsert;

// ─── 文件存储配置表 ──────────────────────────────────────────────────────────
export const fileStorageConfigs = pgTable('file_storage_configs', {
  id: serial('id').primaryKey(),
  name: varchar('name', { length: 64 }).notNull(),
  provider: fileStorageProviderEnum('provider').notNull().default('local'),
  status: statusEnum('status').notNull().default('enabled'),
  isDefault: boolean('is_default').notNull().default(false),
  basePath: varchar('base_path', { length: 256 }),
  localRootPath: varchar('local_root_path', { length: 512 }),
  ossRegion: varchar('oss_region', { length: 64 }),
  ossEndpoint: varchar('oss_endpoint', { length: 128 }),
  ossBucket: varchar('oss_bucket', { length: 128 }),
  ossAccessKeyId: varchar('oss_access_key_id', { length: 128 }),
  ossAccessKeySecret: varchar('oss_access_key_secret', { length: 256 }),
  // S3 兼容存储（AWS S3 / MinIO / Cloudflare R2 等）
  s3Region: varchar('s3_region', { length: 64 }),
  s3Endpoint: varchar('s3_endpoint', { length: 256 }),
  s3Bucket: varchar('s3_bucket', { length: 128 }),
  s3AccessKeyId: varchar('s3_access_key_id', { length: 128 }),
  s3SecretAccessKey: varchar('s3_secret_access_key', { length: 256 }),
  s3ForcePathStyle: boolean('s3_force_path_style').default(false),
  // 腾讯云 COS
  cosRegion: varchar('cos_region', { length: 64 }),
  cosBucket: varchar('cos_bucket', { length: 128 }),
  cosSecretId: varchar('cos_secret_id', { length: 128 }),
  cosSecretKey: varchar('cos_secret_key', { length: 256 }),
  // 华为云 OBS
  obsEndpoint: varchar('obs_endpoint', { length: 256 }),
  obsBucket: varchar('obs_bucket', { length: 128 }),
  obsAccessKeyId: varchar('obs_access_key_id', { length: 128 }),
  obsSecretAccessKey: varchar('obs_secret_access_key', { length: 256 }),
  // 七牛云 Kodo
  kodoAccessKey: varchar('kodo_access_key', { length: 128 }),
  kodoSecretKey: varchar('kodo_secret_key', { length: 256 }),
  kodoBucket: varchar('kodo_bucket', { length: 128 }),
  kodoRegion: varchar('kodo_region', { length: 64 }),
  kodoEndpoint: varchar('kodo_endpoint', { length: 256 }),
  // 百度云 BOS
  bosEndpoint: varchar('bos_endpoint', { length: 256 }),
  bosBucket: varchar('bos_bucket', { length: 128 }),
  bosAccessKeyId: varchar('bos_access_key_id', { length: 128 }),
  bosSecretAccessKey: varchar('bos_secret_access_key', { length: 256 }),
  // Azure Blob Storage
  azureAccountName: varchar('azure_account_name', { length: 128 }),
  azureAccountKey: varchar('azure_account_key', { length: 256 }),
  azureContainerName: varchar('azure_container_name', { length: 128 }),
  azureEndpoint: varchar('azure_endpoint', { length: 256 }),
  // SFTP
  sftpHost: varchar('sftp_host', { length: 256 }),
  sftpPort: integer('sftp_port').default(22),
  sftpUsername: varchar('sftp_username', { length: 128 }),
  sftpPassword: varchar('sftp_password', { length: 256 }),
  sftpPrivateKey: text('sftp_private_key'),
  sftpRootPath: varchar('sftp_root_path', { length: 512 }),
  sftpBaseUrl: varchar('sftp_base_url', { length: 512 }),
  remark: varchar('remark', { length: 256 }),
  ...auditColumns(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().$onUpdate(() => new Date()).notNull(),
});

export type FileStorageConfigRow = typeof fileStorageConfigs.$inferSelect;
export type NewFileStorageConfig = typeof fileStorageConfigs.$inferInsert;

// ─── 文件记录表 ──────────────────────────────────────────────────────────────
export const managedFiles = pgTable('managed_files', {
  id: pgUuid('id').primaryKey().$defaultFn(() => uuidv7()),
  storageConfigId: integer('storage_config_id').notNull().references(() => fileStorageConfigs.id, { onDelete: 'restrict' }),
  storageName: varchar('storage_name', { length: 64 }).notNull(),
  provider: fileStorageProviderEnum('provider').notNull(),
  originalName: varchar('original_name', { length: 256 }).notNull(),
  objectKey: varchar('object_key', { length: 512 }).notNull(),
  bucketName: varchar('bucket_name', { length: 256 }),
  size: integer('size').notNull().default(0),
  mimeType: varchar('mime_type', { length: 128 }),
  extension: varchar('extension', { length: 32 }),
  tenantId: integer('tenant_id').references(() => tenants.id, { onDelete: 'cascade' }),
  ...auditColumns(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().$onUpdate(() => new Date()).notNull(),
});

export type ManagedFileRow = typeof managedFiles.$inferSelect;
export type NewManagedFile = typeof managedFiles.$inferInsert;

// ─── 分片上传会话表 ──────────────────────────────────────────────────────────
export const uploadSessionStatusEnum = pgEnum('upload_session_status', ['uploading', 'completed', 'aborted']);

export const uploadSessions = pgTable('upload_sessions', {
  id: serial('id').primaryKey(),
  uploadId: varchar('upload_id', { length: 64 }).notNull().unique(),
  fileName: varchar('file_name', { length: 256 }).notNull(),
  fileSize: bigint('file_size', { mode: 'number' }).notNull(),
  mimeType: varchar('mime_type', { length: 128 }),
  chunkSize: integer('chunk_size').notNull(),
  totalChunks: integer('total_chunks').notNull(),
  storageConfigId: integer('storage_config_id').notNull().references(() => fileStorageConfigs.id, { onDelete: 'cascade' }),
  provider: fileStorageProviderEnum('provider').notNull(),
  objectKey: varchar('object_key', { length: 512 }).notNull(),
  bucketName: varchar('bucket_name', { length: 256 }),
  // 云原生 multipart 的 uploadId；local/sftp 及回退暂存为 null
  multipartUploadId: varchar('multipart_upload_id', { length: 512 }),
  status: uploadSessionStatusEnum('status').notNull().default('uploading'),
  tenantId: integer('tenant_id').references(() => tenants.id, { onDelete: 'cascade' }),
  ...auditColumns(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().$onUpdate(() => new Date()).notNull(),
});

export type UploadSessionRow = typeof uploadSessions.$inferSelect;
export type NewUploadSession = typeof uploadSessions.$inferInsert;

/** 已上传分片记录；index 从 0 计，etag 供云原生 multipart 使用，唯一约束保证并发幂等 */
export const uploadChunks = pgTable('upload_chunks', {
  id: serial('id').primaryKey(),
  uploadSessionId: integer('upload_session_id').notNull().references(() => uploadSessions.id, { onDelete: 'cascade' }),
  index: integer('index').notNull(),
  size: integer('size').notNull(),
  etag: varchar('etag', { length: 256 }),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (t) => [
  unique('uniq_upload_chunk').on(t.uploadSessionId, t.index),
]);

export type UploadChunkRow = typeof uploadChunks.$inferSelect;
export type NewUploadChunk = typeof uploadChunks.$inferInsert;

// ─── 登录日志表 ─────────────────────────────────────────────────────────────────
export const loginStatusEnum = pgEnum('login_status', ['success', 'fail']);
export const loginEventTypeEnum = pgEnum('login_event_type', ['login', 'logout']);

export const loginLogs = pgTable('login_logs', {
  id: serial('id').primaryKey(),
  userId: integer('user_id'),
  username: varchar('username', { length: 64 }).notNull(),
  ip: varchar('ip', { length: 64 }),
  location: varchar('location', { length: 128 }),
  browser: varchar('browser', { length: 64 }),
  os: varchar('os', { length: 64 }),
  userAgent: varchar('user_agent', { length: 512 }),
  eventType: loginEventTypeEnum('event_type').notNull().default('login'),
  status: loginStatusEnum('status').notNull(),
  message: varchar('message', { length: 256 }),
  tenantId: integer('tenant_id').references(() => tenants.id, { onDelete: 'cascade' }),
  // 设备信息（登录时由前端上报）
  screenWidth: smallint('screen_width'),
  screenHeight: smallint('screen_height'),
  devicePixelRatio: varchar('device_pixel_ratio', { length: 8 }),
  gpu: varchar('gpu', { length: 256 }),
  cpuCores: smallint('cpu_cores'),
  memoryGb: varchar('memory_gb', { length: 8 }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// ─── 操作日志表 ─────────────────────────────────────────────────────────────────
export const operationLogs = pgTable('operation_logs', {
  id: serial('id').primaryKey(),
  userId: integer('user_id'),
  username: varchar('username', { length: 32 }),
  module: varchar('module', { length: 64 }),
  description: varchar('description', { length: 256 }).notNull(),
  method: varchar('method', { length: 16 }).notNull(),
  path: varchar('path', { length: 256 }).notNull(),
  requestId: varchar('request_id', { length: 36 }),
  requestBody: varchar('request_body', { length: 4096 }),
  beforeData: text('before_data'),
  afterData: text('after_data'),
  responseCode: integer('response_code'),
  responseBody: text('response_body'),
  durationMs: integer('duration_ms'),
  ip: varchar('ip', { length: 64 }),
  location: varchar('location', { length: 128 }),
  userAgent: varchar('user_agent', { length: 512 }),
  os: varchar('os', { length: 64 }),
  browser: varchar('browser', { length: 64 }),
  tenantId: integer('tenant_id').references(() => tenants.id, { onDelete: 'cascade' }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export type OperationLogRow = typeof operationLogs.$inferSelect;
export type NewOperationLog = typeof operationLogs.$inferInsert;

// ─── IP 访问控制拦截日志表 ───────────────────────────────────────────────────────
export const ipAccessLogs = pgTable('ip_access_logs', {
  id: serial('id').primaryKey(),
  ip: varchar('ip', { length: 64 }).notNull(),
  path: varchar('path', { length: 256 }).notNull(),
  method: varchar('method', { length: 16 }).notNull(),
  blockType: varchar('block_type', { length: 16 }).notNull(), // 'blacklist' | 'whitelist'
  userAgent: varchar('user_agent', { length: 512 }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export type IpAccessLogRow = typeof ipAccessLogs.$inferSelect;
export type NewIpAccessLog = typeof ipAccessLogs.$inferInsert;

// ════════════════════════════════════════════════════════════════════════════
// 数据分析 / 埋点 / 错误监控（对标 GA4 / PostHog / 神策 / Sentry，重构）
// ════════════════════════════════════════════════════════════════════════════

// ─── 枚举 ────────────────────────────────────────────────────────────────────
export const userBehaviorEventTypeEnum = pgEnum('user_behavior_event_type', [
  'page_view', 'page_leave', 'feature_use', 'area_click', 'custom', 'perf', 'api_request', 'identify',
]);
export const analyticsDeviceTypeEnum = pgEnum('analytics_device_type', ['desktop', 'mobile', 'tablet', 'bot', 'unknown']);

// ─── 用户行为事件表（原始事件流）──────────────────────────────────────────────
export const userEvents = pgTable('user_events', {
  id: serial('id').primaryKey(),
  tenantId: integer('tenant_id').references(() => tenants.id, { onDelete: 'cascade' }),
  // 身份
  distinctId: varchar('distinct_id', { length: 64 }),
  anonymousId: varchar('anonymous_id', { length: 64 }),
  userId: integer('user_id'),
  username: varchar('username', { length: 64 }),
  sessionId: varchar('session_id', { length: 36 }),
  // 事件
  eventType: userBehaviorEventTypeEnum('event_type').notNull(),
  eventName: varchar('event_name', { length: 128 }),
  pagePath: varchar('page_path', { length: 256 }).notNull(),
  pageTitle: varchar('page_title', { length: 128 }),
  elementKey: varchar('element_key', { length: 128 }),
  elementLabel: varchar('element_label', { length: 128 }),
  componentArea: varchar('component_area', { length: 64 }),
  clickX: real('click_x'),
  clickY: real('click_y'),
  scrollDepth: smallint('scroll_depth'),
  durationMs: integer('duration_ms'),
  // 自定义属性袋
  properties: jsonb('properties').$type<Record<string, unknown>>(),
  // 来源
  referrer: varchar('referrer', { length: 512 }),
  utmSource: varchar('utm_source', { length: 128 }),
  utmMedium: varchar('utm_medium', { length: 128 }),
  utmCampaign: varchar('utm_campaign', { length: 128 }),
  utmTerm: varchar('utm_term', { length: 128 }),
  utmContent: varchar('utm_content', { length: 128 }),
  // 环境（服务端解析 UA / IP 填充）
  browser: varchar('browser', { length: 48 }),
  browserVersion: varchar('browser_version', { length: 32 }),
  os: varchar('os', { length: 48 }),
  osVersion: varchar('os_version', { length: 32 }),
  deviceType: analyticsDeviceTypeEnum('device_type'),
  screenW: integer('screen_w'),
  screenH: integer('screen_h'),
  language: varchar('language', { length: 16 }),
  userAgent: varchar('user_agent', { length: 512 }),
  ip: varchar('ip', { length: 64 }),
  country: varchar('country', { length: 64 }),
  region: varchar('region', { length: 64 }),
  city: varchar('city', { length: 64 }),
  // 性能指标（perf 事件）
  metricName: varchar('metric_name', { length: 32 }),
  metricValue: real('metric_value'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index('user_events_created_idx').on(t.createdAt),
  index('user_events_type_idx').on(t.eventType),
  index('user_events_name_idx').on(t.eventName),
  index('user_events_page_idx').on(t.pagePath),
  index('user_events_user_idx').on(t.userId),
  index('user_events_session_idx').on(t.sessionId),
  index('user_events_tenant_idx').on(t.tenantId),
  index('user_events_distinct_idx').on(t.distinctId),
]);

export type UserEventRow = typeof userEvents.$inferSelect;
export type NewUserEvent = typeof userEvents.$inferInsert;

// ─── 会话聚合表 ──────────────────────────────────────────────────────────────
export const analyticsSessions = pgTable('analytics_sessions', {
  id: serial('id').primaryKey(),
  tenantId: integer('tenant_id').references(() => tenants.id, { onDelete: 'cascade' }),
  sessionId: varchar('session_id', { length: 36 }).notNull(),
  distinctId: varchar('distinct_id', { length: 64 }),
  userId: integer('user_id'),
  username: varchar('username', { length: 64 }),
  startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
  endedAt: timestamp('ended_at', { withTimezone: true }).notNull().defaultNow(),
  durationMs: integer('duration_ms').notNull().default(0),
  pageCount: integer('page_count').notNull().default(0),
  eventCount: integer('event_count').notNull().default(0),
  entryPage: varchar('entry_page', { length: 256 }),
  exitPage: varchar('exit_page', { length: 256 }),
  referrer: varchar('referrer', { length: 512 }),
  utmSource: varchar('utm_source', { length: 128 }),
  browser: varchar('browser', { length: 48 }),
  os: varchar('os', { length: 48 }),
  deviceType: analyticsDeviceTypeEnum('device_type'),
  country: varchar('country', { length: 64 }),
  region: varchar('region', { length: 64 }),
  isBounce: boolean('is_bounce').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (t) => [
  uniqueIndex('analytics_sessions_sid_uq').on(t.sessionId),
  index('analytics_sessions_started_idx').on(t.startedAt),
  index('analytics_sessions_user_idx').on(t.userId),
  index('analytics_sessions_tenant_idx').on(t.tenantId),
]);

export type AnalyticsSessionRow = typeof analyticsSessions.$inferSelect;
export type NewAnalyticsSession = typeof analyticsSessions.$inferInsert;

// ─── 每日预聚合表（趋势查询提速）─────────────────────────────────────────────
// tenantId 非空（0 = 平台/无租户），避免 NULL 在唯一索引中视为相异导致 upsert 失效
export const analyticsDailyRollup = pgTable('analytics_daily_rollup', {
  id: serial('id').primaryKey(),
  tenantId: integer('tenant_id').notNull().default(0),
  statDate: date('stat_date').notNull(),
  metric: varchar('metric', { length: 32 }).notNull(),
  dimType: varchar('dim_type', { length: 32 }).notNull().default('overall'),
  dimValue: varchar('dim_value', { length: 256 }).notNull().default(''),
  value: bigint('value', { mode: 'number' }).notNull().default(0),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (t) => [
  uniqueIndex('analytics_rollup_uq').on(t.tenantId, t.statDate, t.metric, t.dimType, t.dimValue),
  index('analytics_rollup_date_idx').on(t.statDate),
  index('analytics_rollup_metric_idx').on(t.metric),
]);

export type AnalyticsDailyRollupRow = typeof analyticsDailyRollup.$inferSelect;
export type NewAnalyticsDailyRollup = typeof analyticsDailyRollup.$inferInsert;

// ─── 埋点事件元数据 / 事件字典 ───────────────────────────────────────────────
export const analyticsEventStatusEnum = pgEnum('analytics_event_status', ['active', 'deprecated', 'blocked']);

export const analyticsEventMeta = pgTable('analytics_event_meta', {
  id: serial('id').primaryKey(),
  tenantId: integer('tenant_id'),
  eventName: varchar('event_name', { length: 128 }).notNull(),
  displayName: varchar('display_name', { length: 128 }),
  category: varchar('category', { length: 64 }),
  description: text('description'),
  propertySchema: jsonb('property_schema').$type<{ key: string; type: string; description?: string }[]>(),
  status: analyticsEventStatusEnum('status').notNull().default('active'),
  eventCount: bigint('event_count', { mode: 'number' }).notNull().default(0),
  firstSeenAt: timestamp('first_seen_at', { withTimezone: true }),
  lastSeenAt: timestamp('last_seen_at', { withTimezone: true }),
  ...auditColumns(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (t) => [
  uniqueIndex('analytics_event_meta_name_uq').on(t.eventName),
  index('analytics_event_meta_status_idx').on(t.status),
]);

export type AnalyticsEventMetaRow = typeof analyticsEventMeta.$inferSelect;
export type NewAnalyticsEventMeta = typeof analyticsEventMeta.$inferInsert;

// ─── 采集配置 / 采样 / 保留策略（SDK 远程配置）──────────────────────────────
export const analyticsSettings = pgTable('analytics_settings', {
  id: serial('id').primaryKey(),
  tenantId: integer('tenant_id'),
  enabled: boolean('enabled').notNull().default(true),
  sampleRate: real('sample_rate').notNull().default(1),
  trackPageviews: boolean('track_pageviews').notNull().default(true),
  trackClicks: boolean('track_clicks').notNull().default(true),
  trackPerformance: boolean('track_performance').notNull().default(true),
  trackErrors: boolean('track_errors').notNull().default(true),
  trackApi: boolean('track_api').notNull().default(true),
  maskInputs: boolean('mask_inputs').notNull().default(true),
  respectDnt: boolean('respect_dnt').notNull().default(false),
  blacklistPaths: jsonb('blacklist_paths').$type<string[]>().notNull().default([]),
  retentionDays: integer('retention_days').notNull().default(180),
  errorRetentionDays: integer('error_retention_days').notNull().default(90),
  sessionTimeoutMinutes: integer('session_timeout_minutes').notNull().default(30),
  ...auditColumns(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (t) => [
  index('analytics_settings_tenant_idx').on(t.tenantId),
]);

export type AnalyticsSettingsRow = typeof analyticsSettings.$inferSelect;
export type NewAnalyticsSettings = typeof analyticsSettings.$inferInsert;

// ─── 前端错误监控（Issue 模型：error_groups + error_events）────────────────────
export const frontendErrorTypeEnum = pgEnum('frontend_error_type', [
  'js_error', 'promise_rejection', 'resource_error', 'console_error', 'http_error', 'white_screen', 'crash',
]);
export const errorLevelEnum = pgEnum('error_level', ['fatal', 'error', 'warning', 'info']);
export const errorStatusEnum = pgEnum('error_status', ['unresolved', 'resolved', 'ignored', 'muted']);
export const errorAlertConditionEnum = pgEnum('error_alert_condition', ['new_error', 'threshold', 'spike']);

// 错误分组（Issue）：fingerprint 全局唯一（已含 tenant 因子），修复原 ON CONFLICT 缺唯一索引的 Bug
export const errorGroups = pgTable('error_groups', {
  id: serial('id').primaryKey(),
  tenantId: integer('tenant_id').references(() => tenants.id, { onDelete: 'cascade' }),
  fingerprint: varchar('fingerprint', { length: 64 }).notNull(),
  errorType: frontendErrorTypeEnum('error_type').notNull(),
  level: errorLevelEnum('level').notNull().default('error'),
  message: text('message').notNull(),
  status: errorStatusEnum('status').notNull().default('unresolved'),
  assigneeId: integer('assignee_id').references((): AnyPgColumn => users.id, { onDelete: 'set null' }),
  assigneeName: varchar('assignee_name', { length: 64 }),
  release: varchar('release', { length: 64 }),
  note: text('note'),
  count: bigint('count', { mode: 'number' }).notNull().default(0),
  affectedUsers: integer('affected_users').notNull().default(0),
  firstSeenAt: timestamp('first_seen_at', { withTimezone: true }).notNull().defaultNow(),
  lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull().defaultNow(),
  resolvedAt: timestamp('resolved_at', { withTimezone: true }),
  ...auditColumns(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (t) => [
  uniqueIndex('error_groups_fingerprint_uq').on(t.fingerprint),
  index('error_groups_status_idx').on(t.status),
  index('error_groups_type_idx').on(t.errorType),
  index('error_groups_last_seen_idx').on(t.lastSeenAt),
  index('error_groups_tenant_idx').on(t.tenantId),
  index('error_groups_assignee_idx').on(t.assigneeId),
]);

export type ErrorGroupRow = typeof errorGroups.$inferSelect;
export type NewErrorGroup = typeof errorGroups.$inferInsert;

// 单次错误事件（追加型日志，含堆栈/面包屑/上下文/解析后的 UA）
export const errorEvents = pgTable('error_events', {
  id: serial('id').primaryKey(),
  tenantId: integer('tenant_id').references(() => tenants.id, { onDelete: 'cascade' }),
  groupId: integer('group_id').notNull().references((): AnyPgColumn => errorGroups.id, { onDelete: 'cascade' }),
  fingerprint: varchar('fingerprint', { length: 64 }).notNull(),
  errorType: frontendErrorTypeEnum('error_type').notNull(),
  level: errorLevelEnum('level').notNull().default('error'),
  message: text('message').notNull(),
  stack: text('stack'),
  sourceUrl: varchar('source_url', { length: 512 }),
  lineNo: integer('line_no'),
  colNo: integer('col_no'),
  pageUrl: varchar('page_url', { length: 512 }),
  release: varchar('release', { length: 64 }),
  userAgent: varchar('user_agent', { length: 512 }),
  browser: varchar('browser', { length: 48 }),
  browserVersion: varchar('browser_version', { length: 32 }),
  os: varchar('os', { length: 48 }),
  deviceType: analyticsDeviceTypeEnum('device_type'),
  userId: integer('user_id'),
  username: varchar('username', { length: 64 }),
  sessionId: varchar('session_id', { length: 36 }),
  breadcrumbs: jsonb('breadcrumbs').$type<unknown[]>(),
  context: jsonb('context').$type<Record<string, unknown>>(),
  httpStatus: integer('http_status'),
  httpMethod: varchar('http_method', { length: 16 }),
  httpUrl: varchar('http_url', { length: 512 }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index('error_events_group_idx').on(t.groupId),
  index('error_events_created_idx').on(t.createdAt),
  index('error_events_user_idx').on(t.userId),
  index('error_events_tenant_idx').on(t.tenantId),
]);

export type ErrorEventRow = typeof errorEvents.$inferSelect;
export type NewErrorEvent = typeof errorEvents.$inferInsert;

// 错误告警规则
export const errorAlertRules = pgTable('error_alert_rules', {
  id: serial('id').primaryKey(),
  tenantId: integer('tenant_id').references(() => tenants.id, { onDelete: 'cascade' }),
  name: varchar('name', { length: 128 }).notNull(),
  errorType: frontendErrorTypeEnum('error_type'),
  level: errorLevelEnum('level'),
  condition: errorAlertConditionEnum('condition').notNull().default('threshold'),
  thresholdCount: integer('threshold_count').notNull().default(10),
  windowMinutes: integer('window_minutes').notNull().default(60),
  channels: jsonb('channels').$type<string[]>().notNull().default([]),
  webhookUrl: varchar('webhook_url', { length: 512 }),
  recipients: jsonb('recipients').$type<string[]>().notNull().default([]),
  enabled: boolean('enabled').notNull().default(true),
  lastTriggeredAt: timestamp('last_triggered_at', { withTimezone: true }),
  ...auditColumns(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (t) => [
  index('error_alert_rules_tenant_idx').on(t.tenantId),
]);

export type ErrorAlertRuleRow = typeof errorAlertRules.$inferSelect;
export type NewErrorAlertRule = typeof errorAlertRules.$inferInsert;

// Source Map（用于压缩堆栈还原）— 服务层以 replace 语义维护，无需唯一约束
export const sourceMaps = pgTable('source_maps', {
  id: serial('id').primaryKey(),
  tenantId: integer('tenant_id').references(() => tenants.id, { onDelete: 'cascade' }),
  release: varchar('release', { length: 64 }).notNull(),
  fileName: varchar('file_name', { length: 256 }).notNull(),
  content: text('content').notNull(),
  size: integer('size').notNull().default(0),
  ...auditColumns(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (t) => [
  index('source_maps_release_idx').on(t.release, t.fileName),
  index('source_maps_tenant_idx').on(t.tenantId),
]);

export type SourceMapRow = typeof sourceMaps.$inferSelect;
export type NewSourceMap = typeof sourceMaps.$inferInsert;

// ─── 关联关系 ────────────────────────────────────────────────────────────────
export const errorGroupsRelations = relations(errorGroups, ({ many, one }) => ({
  events: many(errorEvents),
  assignee: one(users, { fields: [errorGroups.assigneeId], references: [users.id] }),
}));

export const errorEventsRelations = relations(errorEvents, ({ one }) => ({
  group: one(errorGroups, { fields: [errorEvents.groupId], references: [errorGroups.id] }),
}));

// ─── 公告表 ─────────────────────────────────────────────────────────────────
export const announcements = pgTable('announcements', {
  id: serial('id').primaryKey(),
  title: varchar('title', { length: 128 }).notNull(),
  content: text('content').notNull(),
  type: varchar('type', { length: 32 }).notNull().default('notice'),
  publishStatus: varchar('publish_status', { length: 32 }).notNull().default('draft'),
  priority: varchar('priority', { length: 32 }).notNull().default('medium'),
  targetType: varchar('target_type', { length: 16 }).notNull().default('all'),
  publishTime: timestamp('publish_time', { withTimezone: true }),
  createById: integer('create_by_id'),
  createByName: varchar('create_by_name', { length: 32 }),
  tenantId: integer('tenant_id').references(() => tenants.id, { onDelete: 'cascade' }),
  ...auditColumns(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export type AnnouncementRow = typeof announcements.$inferSelect;
export type NewAnnouncement = typeof announcements.$inferInsert;

// ─── 公告已读记录表 ───────────────────────────────────────────────────────────
export const announcementReads = pgTable('announcement_reads', {
  id: serial('id').primaryKey(),
  announcementId: integer('announcement_id').notNull().references(() => announcements.id, { onDelete: 'cascade' }),
  userId: integer('user_id').notNull(),
  readAt: timestamp('read_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [unique('uniq_announcement_user').on(t.announcementId, t.userId)]);

export type AnnouncementReadRow = typeof announcementReads.$inferSelect;

// ─── 公告收件人表 ─────────────────────────────────────────────────────────────
export const announcementRecipients = pgTable('announcement_recipients', {
  id: serial('id').primaryKey(),
  announcementId: integer('announcement_id').notNull().references(() => announcements.id, { onDelete: 'cascade' }),
  recipientType: varchar('recipient_type', { length: 16 }).notNull(), // 'user' | 'role' | 'dept'
  recipientId: integer('recipient_id').notNull(),
}, (t) => [unique('uniq_announcement_recipient').on(t.announcementId, t.recipientType, t.recipientId)]);

export type AnnouncementRecipientRow = typeof announcementRecipients.$inferSelect;

// ─── 业务文件关联表（通用，多态关联）─────────────────────────────────────────
export const businessTypeEnum = pgEnum('business_type', ['announcement']);

export const businessFiles = pgTable('business_files', {
  id: serial('id').primaryKey(),
  businessType: businessTypeEnum('business_type').notNull(),
  businessId: integer('business_id').notNull(),
  fileId: pgUuid('file_id').notNull().references(() => managedFiles.id, { onDelete: 'cascade' }),
  name: varchar('name', { length: 256 }),
  category: varchar('category', { length: 64 }),
  sortOrder: smallint('sort_order').default(0),
  tenantId: integer('tenant_id').references(() => tenants.id, { onDelete: 'cascade' }),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (t) => [
  unique('uniq_business_file').on(t.businessType, t.businessId, t.fileId),
]);

export type BusinessFileRow = typeof businessFiles.$inferSelect;
export type NewBusinessFile = typeof businessFiles.$inferInsert;

// ─── 系统参数配置表 ──────────────────────────────────────────────────────────
export const configTypeEnum = pgEnum('config_type', ['string', 'number', 'boolean', 'json']);

export const systemConfigs = pgTable('system_configs', {
  id: serial('id').primaryKey(),
  configKey: varchar('config_key', { length: 128 }).notNull(),
  configValue: varchar('config_value', { length: 4096 }).notNull().default(''),
  configType: configTypeEnum('config_type').notNull().default('string'),
  description: varchar('description', { length: 256 }).notNull().default(''),
  tenantId: integer('tenant_id').references(() => tenants.id, { onDelete: 'cascade' }),
  ...auditColumns(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().$onUpdate(() => new Date()).notNull(),
}, (t) => [unique('system_configs_tenant_key_unique').on(t.tenantId, t.configKey)]);

export type SystemConfigRow = typeof systemConfigs.$inferSelect;
export type NewSystemConfig = typeof systemConfigs.$inferInsert;

// ─── 定时任务表 ──────────────────────────────────────────────────────────────
export const cronRunStatusEnum = pgEnum('cron_run_status', ['success', 'fail', 'running']);

export const cronJobs = pgTable('cron_jobs', {
  id: serial('id').primaryKey(),
  name: varchar('name', { length: 64 }).notNull().unique(),
  cronExpression: varchar('cron_expression', { length: 128 }).notNull(),
  handler: varchar('handler', { length: 128 }).notNull(),
  params: text('params'),
  status: statusEnum('status').notNull().default('disabled'),
  description: varchar('description', { length: 256 }).notNull().default(''),
  retryCount: integer('retry_count').notNull().default(0),
  /** 重试间隔，单位：秒 */
  retryInterval: integer('retry_interval').notNull().default(0),
  /** 是否启用指数退避重试（每次翻倍延迟） */
  retryBackoff: boolean('retry_backoff').notNull().default(false),
  monitorTimeout: integer('monitor_timeout'),
  lastRunAt: timestamp('last_run_at', { withTimezone: true }),
  lastRunStatus: cronRunStatusEnum('last_run_status'),
  lastRunMessage: varchar('last_run_message', { length: 1024 }),
  ...auditColumns(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().$onUpdate(() => new Date()).notNull(),
});

export type CronJobRow = typeof cronJobs.$inferSelect;
export type NewCronJob = typeof cronJobs.$inferInsert;

// ─── 定时任务执行日志表 ────────────────────────────────────────────────────────
export const cronJobLogs = pgTable('cron_job_logs', {
  id:             serial('id').primaryKey(),
  jobId:          integer('job_id').notNull().references(() => cronJobs.id, { onDelete: 'cascade' }),
  jobName:        varchar('job_name', { length: 64 }).notNull(),
  executionCount: integer('execution_count').notNull().default(1),
  startedAt:      timestamp('started_at', { withTimezone: true }).defaultNow().notNull(),
  endedAt:        timestamp('ended_at', { withTimezone: true }),
  durationMs:     integer('duration_ms'),
  status:         cronRunStatusEnum('status').notNull().default('running'),
  output:         text('output'),
});

export type CronJobLogRow = typeof cronJobLogs.$inferSelect;
export type NewCronJobLog = typeof cronJobLogs.$inferInsert;

// ─── 地区表 ──────────────────────────────────────────────────────────────────
export const regionLevelEnum = pgEnum('region_level', ['province', 'city', 'county']);

export const regions = pgTable('regions', {
  id:         serial('id').primaryKey(),
  code:       varchar('code', { length: 12 }).notNull().unique(),
  name:       varchar('name', { length: 64 }).notNull(),
  level:      regionLevelEnum('level').notNull(),
  parentCode: varchar('parent_code', { length: 12 }),
  sort:       integer('sort').notNull().default(0),
  status:     statusEnum('status').notNull().default('enabled'),
  ...auditColumns(),
  createdAt:  timestamp('created_at').defaultNow().notNull(),
  updatedAt:  timestamp('updated_at').defaultNow().notNull(),
});

export type RegionRow = typeof regions.$inferSelect;
export type NewRegion = typeof regions.$inferInsert;

// ─── 邮件配置表 ──────────────────────────────────────────────────────────────
export const emailEncryptionEnum = pgEnum('email_encryption', ['none', 'ssl', 'tls']);

export const emailConfigs = pgTable('email_configs', {
  id: serial('id').primaryKey(),
  smtpHost: varchar('smtp_host', { length: 128 }).notNull().default(''),
  smtpPort: integer('smtp_port').notNull().default(465),
  smtpUser: varchar('smtp_user', { length: 128 }).notNull().default(''),
  smtpPassword: varchar('smtp_password', { length: 256 }).notNull().default(''),
  fromName: varchar('from_name', { length: 64 }).notNull().default('Zenith Admin'),
  fromEmail: varchar('from_email', { length: 128 }).notNull().default(''),
  encryption: emailEncryptionEnum('encryption').notNull().default('ssl'),
  status: statusEnum('status').notNull().default('enabled'),
  ...auditColumns(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().$onUpdate(() => new Date()).notNull(),
});

export type EmailConfigRow = typeof emailConfigs.$inferSelect;
export type NewEmailConfig = typeof emailConfigs.$inferInsert;

// ─── OAuth 第三方账号绑定表 ────────────────────────────────────────────────────
export const oauthProviderEnum = pgEnum('oauth_provider', ['github', 'dingtalk', 'wechat_work']);

export const userOauthAccounts = pgTable('user_oauth_accounts', {
  id: serial('id').primaryKey(),
  userId: integer('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  provider: oauthProviderEnum('provider').notNull(),
  openId: varchar('open_id', { length: 128 }).notNull(),
  unionId: varchar('union_id', { length: 128 }),
  nickname: varchar('nickname', { length: 64 }),
  avatar: varchar('avatar', { length: 512 }),
  accessToken: varchar('access_token', { length: 512 }),
  refreshToken: varchar('refresh_token', { length: 512 }),
  expiresAt: timestamp('expires_at', { withTimezone: true }),
  raw: text('raw'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().$onUpdate(() => new Date()).notNull(),
}, (t) => [unique('uniq_provider_open_id').on(t.provider, t.openId)]);

export type UserOauthAccountRow = typeof userOauthAccounts.$inferSelect;
export type NewUserOauthAccount = typeof userOauthAccounts.$inferInsert;

// ─── OAuth 配置表 ──────────────────────────────────────────────────────────────
export const oauthConfigs = pgTable('oauth_configs', {
  id: serial('id').primaryKey(),
  provider: oauthProviderEnum('provider').notNull().unique(),
  clientId: varchar('client_id', { length: 256 }).notNull().default(''),
  clientSecret: varchar('client_secret', { length: 512 }).notNull().default(''),
  agentId: varchar('agent_id', { length: 128 }),
  corpId: varchar('corp_id', { length: 128 }),
  enabled: boolean('enabled').notNull().default(false),
  ...auditColumns(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().$onUpdate(() => new Date()).notNull(),
});

export type OauthConfigRow = typeof oauthConfigs.$inferSelect;
export type NewOauthConfig = typeof oauthConfigs.$inferInsert;

// ─── 数据库备份记录表 ──────────────────────────────────────────────────────────
export const backupTypeEnum = pgEnum('backup_type', ['pg_dump', 'drizzle_export']);
export const backupStatusEnum = pgEnum('backup_status', ['pending', 'running', 'success', 'failed']);

export const dbBackups = pgTable('db_backups', {
  id: serial('id').primaryKey(),
  name: varchar('name', { length: 128 }).notNull(),
  type: backupTypeEnum('type').notNull(),
  fileId: pgUuid('file_id').references(() => managedFiles.id, { onDelete: 'set null' }),
  fileSize: integer('file_size'),
  status: backupStatusEnum('status').notNull().default('pending'),
  tables: text('tables'),
  startedAt: timestamp('started_at', { withTimezone: true }),
  completedAt: timestamp('completed_at', { withTimezone: true }),
  durationMs: integer('duration_ms'),
  errorMessage: text('error_message'),
  ...auditColumns(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().$onUpdate(() => new Date()).notNull(),
});

export type DbBackupRow = typeof dbBackups.$inferSelect;
export type NewDbBackup = typeof dbBackups.$inferInsert;

// ─── 数据库管理 SQL 查询历史表 ──────────────────────────────────────────────────
export const dbAdminQueryHistory = pgTable('db_admin_query_history', {
  id: serial('id').primaryKey(),
  userId: integer('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  sqlText: text('sql_text').notNull(),
  durationMs: integer('duration_ms').notNull().default(0),
  rowCount: integer('row_count').notNull().default(0),
  success: boolean('success').notNull().default(true),
  errorMessage: text('error_message'),
  executedAt: timestamp('executed_at', { withTimezone: true }).defaultNow().notNull(),
});

export type DbAdminQueryHistoryRow = typeof dbAdminQueryHistory.$inferSelect;
export type NewDbAdminQueryHistory = typeof dbAdminQueryHistory.$inferInsert;

// ─── 数据库管理 SQL 查询收藏夹 ───────────────────────────────────────────────────
export const dbQueryFavorites = pgTable('db_query_favorites', {
  id: serial('id').primaryKey(),
  userId: integer('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  name: varchar('name', { length: 100 }).notNull(),
  sql: text('sql').notNull(),
  description: text('description'),
  tags: text('tags').array().notNull().default([]),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().$onUpdate(() => new Date()).notNull(),
});

export type DbQueryFavoriteRow = typeof dbQueryFavorites.$inferSelect;
export type NewDbQueryFavorite = typeof dbQueryFavorites.$inferInsert;

// ─── 个人 API Token 表 ─────────────────────────────────────────────────────────
export const userApiTokens = pgTable('user_api_tokens', {
  id: serial('id').primaryKey(),
  userId: integer('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  name: varchar('name', { length: 64 }).notNull(),
  token: varchar('token', { length: 128 }).notNull().unique(),
  lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
  expiresAt: timestamp('expires_at', { withTimezone: true }),
  ...auditColumns(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().$onUpdate(() => new Date()).notNull(),
});

export type UserApiTokenRow = typeof userApiTokens.$inferSelect;
export type NewUserApiToken = typeof userApiTokens.$inferInsert;

// ─── 密码重置 Token 表 ─────────────────────────────────────────────────────────
export const passwordResetTokens = pgTable('password_reset_tokens', {
  id: serial('id').primaryKey(),
  userId: integer('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  token: varchar('token', { length: 128 }).notNull().unique(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  usedAt: timestamp('used_at', { withTimezone: true }),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export type PasswordResetTokenRow = typeof passwordResetTokens.$inferSelect;
export type NewPasswordResetToken = typeof passwordResetTokens.$inferInsert;

// ─── 限流规则 ─────────────────────────────────────────────────────────────────
export const rateLimitKeyTypeEnum = pgEnum('rate_limit_key_type', ['ip', 'user', 'ip_path']);

export const rateLimitRules = pgTable('rate_limit_rules', {
  id: serial('id').primaryKey(),
  name: varchar('name', { length: 64 }).notNull().unique(),
  description: varchar('description', { length: 255 }),
  windowMs: integer('window_ms').notNull(),
  limit: integer('limit').notNull(),
  keyType: rateLimitKeyTypeEnum('key_type').default('ip').notNull(),
  enabled: boolean('enabled').default(true).notNull(),
  blockedMessage: varchar('blocked_message', { length: 255 }),
  pathPatterns: text('path_patterns').array().notNull().default([]),
  ...auditColumns(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().$onUpdate(() => new Date()).notNull(),
});

export type RateLimitRuleRow = typeof rateLimitRules.$inferSelect;
export type NewRateLimitRule = typeof rateLimitRules.$inferInsert;

// ─── 通知模块：邮件 / 短信 / 站内信 ────────────────────────────────────────────
// 通用枚举
export const smsProviderEnum = pgEnum('sms_provider', ['aliyun', 'tencent']);
export const sendStatusEnum = pgEnum('send_status', ['pending', 'success', 'failed']);
export const sendSourceEnum = pgEnum('send_source', ['manual', 'test', 'system', 'api']);
export const inAppMessageTypeEnum = pgEnum('in_app_message_type', ['info', 'success', 'warning', 'error']);

// ── 邮件模板 ────────────────────────────────────────────────────────────────
export const emailTemplates = pgTable('email_templates', {
  id: serial('id').primaryKey(),
  name: varchar('name', { length: 100 }).notNull(),
  code: varchar('code', { length: 100 }).notNull().unique(),
  subject: varchar('subject', { length: 200 }).notNull(),
  content: text('content').notNull(),
  variables: text('variables'),
  status: statusEnum('status').default('enabled').notNull(),
  remark: text('remark'),
  tenantId: integer('tenant_id').references(() => tenants.id, { onDelete: 'cascade' }),
  ...auditColumns(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().$onUpdate(() => new Date()).notNull(),
});
export type EmailTemplateRow = typeof emailTemplates.$inferSelect;
export type NewEmailTemplate = typeof emailTemplates.$inferInsert;

// ── 邮件发送记录 ────────────────────────────────────────────────────────────
export const emailSendLogs = pgTable('email_send_logs', {
  id: serial('id').primaryKey(),
  templateId: integer('template_id').references(() => emailTemplates.id, { onDelete: 'set null' }),
  toEmail: varchar('to_email', { length: 256 }).notNull(),
  subject: varchar('subject', { length: 200 }).notNull(),
  content: text('content').notNull(),
  status: sendStatusEnum('status').default('pending').notNull(),
  errorMsg: text('error_msg'),
  source: sendSourceEnum('source').default('manual').notNull(),
  userId: integer('user_id').references(() => users.id, { onDelete: 'set null' }),
  ip: varchar('ip', { length: 64 }),
  tenantId: integer('tenant_id').references(() => tenants.id, { onDelete: 'cascade' }),
  sentAt: timestamp('sent_at', { withTimezone: true }),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});
export type EmailSendLogRow = typeof emailSendLogs.$inferSelect;
export type NewEmailSendLog = typeof emailSendLogs.$inferInsert;

// ── 短信服务商配置 ──────────────────────────────────────────────────────────
export const smsConfigs = pgTable('sms_configs', {
  id: serial('id').primaryKey(),
  name: varchar('name', { length: 100 }).notNull(),
  provider: smsProviderEnum('provider').notNull(),
  accessKeyId: varchar('access_key_id', { length: 256 }).notNull().default(''),
  accessKeySecret: varchar('access_key_secret', { length: 512 }).notNull().default(''),
  region: varchar('region', { length: 64 }),
  signName: varchar('sign_name', { length: 64 }).notNull().default(''),
  isDefault: boolean('is_default').notNull().default(false),
  status: statusEnum('status').default('enabled').notNull(),
  remark: text('remark'),
  tenantId: integer('tenant_id').references(() => tenants.id, { onDelete: 'cascade' }),
  ...auditColumns(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().$onUpdate(() => new Date()).notNull(),
});
export type SmsConfigRow = typeof smsConfigs.$inferSelect;
export type NewSmsConfig = typeof smsConfigs.$inferInsert;

// ── 短信模板 ────────────────────────────────────────────────────────────────
export const smsTemplates = pgTable('sms_templates', {
  id: serial('id').primaryKey(),
  name: varchar('name', { length: 100 }).notNull(),
  code: varchar('code', { length: 100 }).notNull().unique(),
  templateCode: varchar('template_code', { length: 100 }).notNull().default(''),
  signName: varchar('sign_name', { length: 64 }),
  content: text('content').notNull(),
  variables: text('variables'),
  provider: smsProviderEnum('provider').notNull(),
  status: statusEnum('status').default('enabled').notNull(),
  remark: text('remark'),
  tenantId: integer('tenant_id').references(() => tenants.id, { onDelete: 'cascade' }),
  ...auditColumns(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().$onUpdate(() => new Date()).notNull(),
});
export type SmsTemplateRow = typeof smsTemplates.$inferSelect;
export type NewSmsTemplate = typeof smsTemplates.$inferInsert;

// ── 短信发送记录 ────────────────────────────────────────────────────────────
export const smsSendLogs = pgTable('sms_send_logs', {
  id: serial('id').primaryKey(),
  configId: integer('config_id').references(() => smsConfigs.id, { onDelete: 'set null' }),
  templateId: integer('template_id').references(() => smsTemplates.id, { onDelete: 'set null' }),
  provider: smsProviderEnum('provider').notNull(),
  phone: varchar('phone', { length: 32 }).notNull(),
  content: text('content').notNull(),
  status: sendStatusEnum('status').default('pending').notNull(),
  errorMsg: text('error_msg'),
  bizId: varchar('biz_id', { length: 128 }),
  deliveryStatus: varchar('delivery_status', { length: 32 }),
  deliveredAt: timestamp('delivered_at', { withTimezone: true }),
  source: sendSourceEnum('source').default('manual').notNull(),
  userId: integer('user_id').references(() => users.id, { onDelete: 'set null' }),
  ip: varchar('ip', { length: 64 }),
  tenantId: integer('tenant_id').references(() => tenants.id, { onDelete: 'cascade' }),
  sentAt: timestamp('sent_at', { withTimezone: true }),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});
export type SmsSendLogRow = typeof smsSendLogs.$inferSelect;
export type NewSmsSendLog = typeof smsSendLogs.$inferInsert;

// ── 站内信模板 ──────────────────────────────────────────────────────────────
export const inAppTemplates = pgTable('in_app_templates', {
  id: serial('id').primaryKey(),
  name: varchar('name', { length: 100 }).notNull(),
  code: varchar('code', { length: 100 }).notNull().unique(),
  title: varchar('title', { length: 200 }).notNull(),
  content: text('content').notNull(),
  type: inAppMessageTypeEnum('type').default('info').notNull(),
  variables: text('variables'),
  status: statusEnum('status').default('enabled').notNull(),
  remark: text('remark'),
  tenantId: integer('tenant_id').references(() => tenants.id, { onDelete: 'cascade' }),
  ...auditColumns(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().$onUpdate(() => new Date()).notNull(),
});
export type InAppTemplateRow = typeof inAppTemplates.$inferSelect;
export type NewInAppTemplate = typeof inAppTemplates.$inferInsert;

// ── 站内信收件记录 ──────────────────────────────────────────────────────────
export const inAppMessages = pgTable('in_app_messages', {
  id: serial('id').primaryKey(),
  templateId: integer('template_id').references(() => inAppTemplates.id, { onDelete: 'set null' }),
  userId: integer('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  title: varchar('title', { length: 200 }).notNull(),
  content: text('content').notNull(),
  type: inAppMessageTypeEnum('type').default('info').notNull(),
  isRead: boolean('is_read').notNull().default(false),
  readAt: timestamp('read_at', { withTimezone: true }),
  source: sendSourceEnum('source').default('system').notNull(),
  senderId: integer('sender_id').references(() => users.id, { onDelete: 'set null' }),
  tenantId: integer('tenant_id').references(() => tenants.id, { onDelete: 'cascade' }),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});
export type InAppMessageRow = typeof inAppMessages.$inferSelect;
export type NewInAppMessage = typeof inAppMessages.$inferInsert;

// ─── 标签管理 ─────────────────────────────────────────────────────────────────

export const tags = pgTable('tags', {
  id:          serial('id').primaryKey(),
  name:        varchar('name', { length: 50 }).notNull().unique(),
  color:       varchar('color', { length: 20 }),
  groupName:   varchar('group_name', { length: 50 }),
  description: text('description'),
  status:      statusEnum('status').notNull().default('enabled'),
  sortOrder:   integer('sort_order').notNull().default(0),
  ...auditColumns(),
  createdAt:   timestamp('created_at').defaultNow().notNull(),
  updatedAt:   timestamp('updated_at').defaultNow().$onUpdate(() => new Date()).notNull(),
});

export type TagRow = typeof tags.$inferSelect;
export type NewTag = typeof tags.$inferInsert;

// ─── 工作流引擎 ───────────────────────────────────────────────────────────────

export const workflowDefinitionStatusEnum = pgEnum('workflow_definition_status', ['draft', 'published', 'disabled']);
export const workflowFormTypeEnum = pgEnum('workflow_form_type', ['designer', 'custom', 'external']);
export const workflowInstanceStatusEnum = pgEnum('workflow_instance_status', ['draft', 'running', 'approved', 'rejected', 'withdrawn', 'cancelled']);
export const workflowTaskStatusEnum = pgEnum('workflow_task_status', ['pending', 'approved', 'rejected', 'skipped', 'waiting']);
export const workflowEventSignModeEnum = pgEnum('workflow_event_sign_mode', ['hmacSha256', 'none']);
export const workflowEventDeliveryStatusEnum = pgEnum('workflow_event_delivery_status', ['pending', 'success', 'failed', 'retrying']);
export const workflowTriggerExecutionStatusEnum = pgEnum('workflow_trigger_execution_status', ['pending', 'running', 'success', 'failed', 'retrying']);
export const workflowTaskExternalDispatchStatusEnum = pgEnum('workflow_task_external_dispatch_status', ['pending', 'dispatched', 'failed', 'fallback']);
export const workflowApproveMethodEnum = pgEnum('workflow_approve_method', ['and', 'or', 'sequential', 'ratio']);
export const workflowNodeTypeEnum = pgEnum('workflow_node_type', [
  'start',
  'approve',
  'handler',
  'end',
  'exclusiveGateway',
  'parallelGateway',
  'inclusiveGateway',
  'routeGateway',
  'ccNode',
  'delay',
  'trigger',
  'subProcess',
  'catchNode',
]);

// 流程分类
export const workflowCategories = pgTable('workflow_categories', {
  id: serial('id').primaryKey(),
  name: varchar('name', { length: 64 }).notNull(),
  code: varchar('code', { length: 64 }),
  icon: varchar('icon', { length: 64 }),
  color: varchar('color', { length: 16 }),
  sort: integer('sort').default(0).notNull(),
  description: text('description'),
  tenantId: integer('tenant_id').references(() => tenants.id, { onDelete: 'cascade' }),
  ...auditColumns(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().$onUpdate(() => new Date()).notNull(),
}, (t) => [unique('workflow_categories_code_uniq').on(t.tenantId, t.code)]);

export type WorkflowCategoryRow = typeof workflowCategories.$inferSelect;
export type NewWorkflowCategory = typeof workflowCategories.$inferInsert;

// 表单库（流程表单设计，独立于流程定义、可被多个流程复用）
export const workflowForms = pgTable('workflow_forms', {
  id: serial('id').primaryKey(),
  name: varchar('name', { length: 64 }).notNull(),
  code: varchar('code', { length: 64 }),
  description: text('description'),
  categoryId: integer('category_id').references(() => workflowCategories.id, { onDelete: 'set null' }),
  schema: jsonb('schema'), // { fields: WorkflowFormField[], settings: WorkflowFormSettings }
  status: statusEnum('status').notNull().default('enabled'),
  tenantId: integer('tenant_id').references(() => tenants.id, { onDelete: 'cascade' }),
  ...auditColumns(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().$onUpdate(() => new Date()).notNull(),
}, (t) => [unique('workflow_forms_code_uniq').on(t.tenantId, t.code)]);

export type WorkflowFormRow = typeof workflowForms.$inferSelect;
export type NewWorkflowForm = typeof workflowForms.$inferInsert;

// 流程定义
export const workflowDefinitions = pgTable('workflow_definitions', {
  id: serial('id').primaryKey(),
  name: varchar('name', { length: 64 }).notNull(),
  description: text('description'),
  categoryId: integer('category_id').references(() => workflowCategories.id, { onDelete: 'set null' }),
  initiatorScopeType: varchar('initiator_scope_type', { length: 16 }).notNull().default('all'),
  initiatorScopeIds: jsonb('initiator_scope_ids'),
  flowData: jsonb('flow_data'), // React Flow 节点+边 JSON
  formId: integer('form_id').references(() => workflowForms.id, { onDelete: 'set null' }), // 绑定的表单（实时引用最新表单）
  formType: workflowFormTypeEnum('form_type').default('designer').notNull(), // 表单类型：designer=表单库，custom=自定义业务页面
  customForm: jsonb('custom_form'), // 自定义业务表单配置 { createComponent, viewComponent?, icon?, variables[] }
  status: workflowDefinitionStatusEnum('status').default('draft').notNull(),
  version: integer('version').default(1).notNull(),
  tenantId: integer('tenant_id').references(() => tenants.id, { onDelete: 'cascade' }),
  ...auditColumns(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().$onUpdate(() => new Date()).notNull(),
});

export type WorkflowDefinitionRow = typeof workflowDefinitions.$inferSelect;
export type NewWorkflowDefinition = typeof workflowDefinitions.$inferInsert;

// 流程定义版本快照（发布时写入一行）
export const workflowDefinitionVersions = pgTable('workflow_definition_versions', {
  id: serial('id').primaryKey(),
  definitionId: integer('definition_id').notNull().references(() => workflowDefinitions.id, { onDelete: 'cascade' }),
  version: integer('version').notNull(),
  name: varchar('name', { length: 64 }).notNull(),
  description: text('description'),
  flowData: jsonb('flow_data'),
  formId: integer('form_id'), // 发布时绑定的表单 ID 快照
  formType: workflowFormTypeEnum('form_type').default('designer').notNull(), // 发布时的表单类型快照
  customForm: jsonb('custom_form'), // 发布时的自定义业务表单配置快照
  publishedAt: timestamp('published_at', { withTimezone: true }).defaultNow().notNull(),
  publishedBy: integer('published_by').references(() => users.id, { onDelete: 'set null' }),
  tenantId: integer('tenant_id').references(() => tenants.id, { onDelete: 'cascade' }),
}, (t) => [unique('workflow_def_versions_def_ver_uniq').on(t.definitionId, t.version)]);

export type WorkflowDefinitionVersionRow = typeof workflowDefinitionVersions.$inferSelect;
export type NewWorkflowDefinitionVersion = typeof workflowDefinitionVersions.$inferInsert;

// 流程级自动化规则：当实例终结（通过/拒绝/撤回）或发起时执行的动作
export const workflowAutomationTriggerEnum = pgEnum('workflow_automation_trigger', ['approved', 'rejected', 'withdrawn', 'created']);

export interface WorkflowAutomationActionStartWorkflow {
  type: 'startWorkflow';
  definitionId: number;
  titleTemplate?: string;
  formMapping?: Record<string, string>;
}
export interface WorkflowAutomationActionSendMessage {
  type: 'sendMessage';
  title: string;
  content: string;
  messageType?: 'info' | 'success' | 'warning' | 'error';
  recipients?: 'initiator' | { userIds: number[] };
  buttons?: Array<{ text: string; url: string }>;
}
export interface WorkflowAutomationActionWebhook {
  type: 'webhook';
  url: string;
  method?: 'GET' | 'POST' | 'PUT';
  headers?: Record<string, string>;
  /** 请求体模板，支持 {{form.x}} / {{instance.title}} 等占位 */
  bodyTemplate?: string;
}
export interface WorkflowAutomationActionUpdateField {
  type: 'updateField';
  /** 回写到实例 formData 的字段：key=字段 key，value 支持 {{form.x}} 占位或字面量 */
  fields: Record<string, string>;
}
export type WorkflowAutomationActionConfig =
  | WorkflowAutomationActionStartWorkflow
  | WorkflowAutomationActionSendMessage
  | WorkflowAutomationActionWebhook
  | WorkflowAutomationActionUpdateField;

export const workflowAutomations = pgTable('workflow_automations', {
  id: serial('id').primaryKey(),
  definitionId: integer('definition_id').notNull().references(() => workflowDefinitions.id, { onDelete: 'cascade' }),
  name: varchar('name', { length: 128 }).notNull(),
  trigger: workflowAutomationTriggerEnum('trigger').notNull(),
  actions: jsonb('actions').$type<WorkflowAutomationActionConfig[]>().notNull().default([]),
  status: statusEnum('status').notNull().default('enabled'),
  sort: integer('sort').notNull().default(0),
  tenantId: integer('tenant_id').references(() => tenants.id, { onDelete: 'cascade' }),
  ...auditColumns(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().$onUpdate(() => new Date()).notNull(),
});

export type WorkflowAutomationRow = typeof workflowAutomations.$inferSelect;
export type NewWorkflowAutomation = typeof workflowAutomations.$inferInsert;

// 流程定时发起：按 cron 周期自动发起流程实例
export const workflowSchedules = pgTable('workflow_schedules', {
  id: serial('id').primaryKey(),
  definitionId: integer('definition_id').notNull().references(() => workflowDefinitions.id, { onDelete: 'cascade' }),
  name: varchar('name', { length: 128 }).notNull(),
  /** 标准 cron 表达式（5 段，tz=Asia/Shanghai） */
  cronExpression: varchar('cron_expression', { length: 64 }).notNull(),
  /** 自动发起时使用的发起人（必须在该流程发起范围内，系统以其身份创建实例） */
  initiatorId: integer('initiator_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  /** 标题模板，支持 {{date}} {{datetime}} 占位 */
  titleTemplate: varchar('title_template', { length: 256 }),
  /** 自动发起时预填的表单数据 */
  formData: jsonb('form_data').$type<Record<string, unknown>>(),
  status: statusEnum('status').notNull().default('enabled'),
  lastRunAt: timestamp('last_run_at', { withTimezone: true }),
  lastRunStatus: varchar('last_run_status', { length: 16 }),
  lastRunMessage: varchar('last_run_message', { length: 512 }),
  /** 下次触发时间（调度器扫描 nextRunAt <= now 的启用规则执行） */
  nextRunAt: timestamp('next_run_at', { withTimezone: true }),
  tenantId: integer('tenant_id').references(() => tenants.id, { onDelete: 'cascade' }),
  ...auditColumns(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().$onUpdate(() => new Date()).notNull(),
});

export type WorkflowScheduleRow = typeof workflowSchedules.$inferSelect;
export type NewWorkflowSchedule = typeof workflowSchedules.$inferInsert;

// 列表保存视图：用户为某个列表页保存的命名筛选条件
export const workflowSavedViews = pgTable('workflow_saved_views', {
  id: serial('id').primaryKey(),
  userId: integer('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  /** 列表页标识（如 my-applications / monitor / pending / cc / handled） */
  pageKey: varchar('page_key', { length: 64 }).notNull(),
  name: varchar('name', { length: 64 }).notNull(),
  /** 保存的筛选条件（任意键值，前端各页自行约定） */
  filters: jsonb('filters').$type<Record<string, unknown>>().notNull().default({}),
  isDefault: boolean('is_default').notNull().default(false),
  sort: integer('sort').notNull().default(0),
  tenantId: integer('tenant_id').references(() => tenants.id, { onDelete: 'cascade' }),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().$onUpdate(() => new Date()).notNull(),
});

export type WorkflowSavedViewRow = typeof workflowSavedViews.$inferSelect;
export type NewWorkflowSavedView = typeof workflowSavedViews.$inferInsert;


// 表单远程数据源：登记式外部接口，供表单 select 字段拉取选项（仅登记 URL 可被代理调用，防 SSRF）
export const workflowDataSources = pgTable('workflow_data_sources', {
  id: serial('id').primaryKey(),
  name: varchar('name', { length: 64 }).notNull().unique(),
  /** 请求方法 GET / POST */
  method: varchar('method', { length: 8 }).notNull().default('GET'),
  url: varchar('url', { length: 1024 }).notNull(),
  /** 附加请求头（如鉴权 token），JSON 键值 */
  headers: jsonb('headers').$type<Record<string, string>>(),
  /** 响应中数组所在路径，点分隔（如 data.list），留空表示响应根即数组 */
  itemsPath: varchar('items_path', { length: 128 }),
  /** 每项取值字段 */
  valueField: varchar('value_field', { length: 64 }).notNull(),
  /** 每项显示字段 */
  labelField: varchar('label_field', { length: 64 }).notNull(),
  /** 远程搜索时传入关键词的参数名（留空表示不支持远程搜索） */
  keywordParam: varchar('keyword_param', { length: 64 }),
  status: statusEnum('status').notNull().default('enabled'),
  remark: varchar('remark', { length: 256 }),
  ...auditColumns(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().$onUpdate(() => new Date()).notNull(),
});

export type WorkflowDataSourceRow = typeof workflowDataSources.$inferSelect;
export type NewWorkflowDataSource = typeof workflowDataSources.$inferInsert;


// 流程实例
export const workflowInstances = pgTable('workflow_instances', {
  id: serial('id').primaryKey(),
  definitionId: integer('definition_id').notNull().references(() => workflowDefinitions.id, { onDelete: 'restrict' }),
  definitionSnapshot: jsonb('definition_snapshot').notNull(), // 发起时的定义快照
  formSnapshot: jsonb('form_snapshot'), // 发起时的表单快照（兼容旧 WorkflowFormField[]；新数据含 fields/settings/customForm）
  title: varchar('title', { length: 128 }).notNull(),
  /** 业务编号/流水号（按流程定义的编号规则在发起时生成，如 BX-20260620-0001） */
  serialNo: varchar('serial_no', { length: 64 }),
  formData: jsonb('form_data'), // 填写的表单数据
  status: workflowInstanceStatusEnum('status').default('draft').notNull(),
  /** 加急/优先级：low/normal/high/urgent（发起人设置，审批列表据此置顶） */
  priority: varchar('priority', { length: 16 }).notNull().default('normal'),
  currentNodeKey: varchar('current_node_key', { length: 64 }),
  initiatorId: integer('initiator_id').notNull().references(() => users.id, { onDelete: 'restrict' }),
  tenantId: integer('tenant_id').references(() => tenants.id, { onDelete: 'cascade' }),
  /** 子流程：父实例 ID（subProcess 节点触发产生的子实例填此字段） */
  parentInstanceId: integer('parent_instance_id'),
  /** 子流程：父实例中触发本子流程的 subProcess 任务 ID，子实例完成时用于唤醒父任务 */
  parentTaskId: integer('parent_task_id'),
  /** 子流程多实例：父任务下当前循环项的幂等 key */
  parentTaskItemKey: varchar('parent_task_item_key', { length: 128 }),
  /** 子流程多实例：父任务下当前循环项的序号（0-based） */
  parentTaskItemIndex: integer('parent_task_item_index'),
  /** 业务实体接入：业务类型（如 biz_leave），普通流程为空 */
  bizType: varchar('biz_type', { length: 64 }),
  /** 业务实体接入：业务记录主键（字符串，兼容各类业务 PK），与 bizType 组成 businessKey */
  bizId: varchar('biz_id', { length: 64 }),
  ...auditColumns(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().$onUpdate(() => new Date()).notNull(),
}, (t) => [
  uniqueIndex('workflow_instances_biz_key_uniq').on(t.bizType, t.bizId),
  uniqueIndex('workflow_instances_parent_task_item_key_idx').on(t.parentTaskId, t.parentTaskItemKey),
]);
export type WorkflowInstanceRow = typeof workflowInstances.$inferSelect;
export type NewWorkflowInstance = typeof workflowInstances.$inferInsert;

// ─── 业务接入示例：请假（业务模块自有实体，通过 businessKey 关联工作流）──────────
export const bizLeaveStatusEnum = pgEnum('biz_leave_status', ['draft', 'pending', 'approved', 'rejected', 'cancelled']);

export const bizLeaves = pgTable('biz_leaves', {
  id: serial('id').primaryKey(),
  leaveType: varchar('leave_type', { length: 32 }).notNull(),
  startDate: timestamp('start_date', { withTimezone: true }).notNull(),
  endDate: timestamp('end_date', { withTimezone: true }).notNull(),
  days: real('days').notNull().default(1),
  reason: text('reason'),
  status: bizLeaveStatusEnum('status').notNull().default('draft'),
  /** 关联的工作流实例 ID（提交审批后回填） */
  workflowInstanceId: integer('workflow_instance_id'),
  /** 冗余的工作流状态，便于列表直接展示（由订阅器回写） */
  workflowStatus: varchar('workflow_status', { length: 16 }),
  tenantId: integer('tenant_id').references(() => tenants.id, { onDelete: 'cascade' }),
  ...auditColumns(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().$onUpdate(() => new Date()).notNull(),
});

export type BizLeaveRow = typeof bizLeaves.$inferSelect;
export type NewBizLeave = typeof bizLeaves.$inferInsert;

// ─── 业务接入示例：支付接入（演示业务模块如何对接支付中心）─────────────────────
export const bizPayDemoStatusEnum = pgEnum('biz_pay_demo_status', ['pending', 'paying', 'paid', 'closed']);

export const bizPayDemos = pgTable('biz_pay_demos', {
  id: serial('id').primaryKey(),
  /** 示例事项 / 商品名称 */
  subject: varchar('subject', { length: 128 }).notNull(),
  /** 金额（分） */
  amount: integer('amount').notNull(),
  /** 发起支付时记录的支付方式（下单前为空） */
  payMethod: varchar('pay_method', { length: 32 }),
  status: bizPayDemoStatusEnum('status').notNull().default('pending'),
  /** 关联支付中心订单号（发起支付后回填，用于查单/对账/履约幂等） */
  paymentOrderNo: varchar('payment_order_no', { length: 64 }),
  /** 支付成功时间（履约时回写） */
  paidAt: timestamp('paid_at', { withTimezone: true }),
  /** 履约备注（演示：支付成功后自动发放示例权益） */
  fulfillRemark: varchar('fulfill_remark', { length: 255 }),
  tenantId: integer('tenant_id').references(() => tenants.id, { onDelete: 'cascade' }),
  ...auditColumns(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().$onUpdate(() => new Date()).notNull(),
});

export type BizPayDemoRow = typeof bizPayDemos.$inferSelect;
export type NewBizPayDemo = typeof bizPayDemos.$inferInsert;

// 审批任务
export const workflowTasks = pgTable('workflow_tasks', {
  id: serial('id').primaryKey(),
  instanceId: integer('instance_id').notNull().references(() => workflowInstances.id, { onDelete: 'cascade' }),
  nodeKey: varchar('node_key', { length: 64 }).notNull(),
  nodeName: varchar('node_name', { length: 64 }).notNull(),
  nodeType: workflowNodeTypeEnum('node_type'),
  assigneeId: integer('assignee_id').references(() => users.id, { onDelete: 'set null' }),
  status: workflowTaskStatusEnum('status').default('pending').notNull(),
  comment: text('comment'),
  /** 手写签名（data URL / 图片地址，审批通过时若节点要求签名则写入） */
  signature: text('signature'),
  /** 审批附件（[{name,url,size}]，审批通过时上传） */
  attachments: jsonb('attachments').$type<Array<{ name: string; url: string; size?: number }>>(),
  actionAt: timestamp('action_at', { withTimezone: true }),
  /** 顺序会签中的顺序（0-based），非顺序场景为 null */
  taskOrder: integer('task_order'),
  /** 多人审批方式（仅同一 nodeKey 多 task 时生效） */
  approveMethod: workflowApproveMethodEnum('approve_method'),
  /** 比例会签阈值（1–100 百分比），仅 approveMethod='ratio' 时有意义 */
  approveRatio: integer('approve_ratio'),
  /** 外部审批：回调 ID（task.status='waiting' 期间有效） */
  externalCallbackId: varchar('external_callback_id', { length: 64 }).unique(),
  /** 外部审批：调度状态 */
  externalDispatchStatus: workflowTaskExternalDispatchStatusEnum('external_dispatch_status'),
  /** 触发器：调度/执行状态，用于 outbox 重放幂等与恢复 */
  triggerDispatchStatus: workflowTriggerExecutionStatusEnum('trigger_dispatch_status'),
  /** 触发器：已调度尝试次数 */
  triggerAttempt: integer('trigger_attempt').default(0).notNull(),
  /** 触发器：本次调度开始时间，用于识别 running 卡死 */
  triggerStartedAt: timestamp('trigger_started_at', { withTimezone: true }),
  /** 触发器：下一次恢复重试时间 */
  triggerNextRetryAt: timestamp('trigger_next_retry_at', { withTimezone: true }),
  /** 触发器：最近一次调度错误 */
  triggerLastError: text('trigger_last_error'),
  /** delay 节点的唤醒时间（status='waiting' 期间有效，由调度器扫描） */
  wakeAt: timestamp('wake_at', { withTimezone: true }),
  /** 子流程（multi 多实例）：期望子实例总数（仅 subProcess 多实例 waiting 任务有值；单实例/非子流程为 null） */
  subTotal: integer('sub_total'),
  /** 子流程（multi 多实例）：已结束的子实例数（用于汇聚 join 判定） */
  subDone: integer('sub_done').default(0).notNull(),
  /** 审批超时截止时间（仅 pending 任务，由调度器扫描；waiting/已完成任务为 null） */
  timeoutAt: timestamp('timeout_at', { withTimezone: true }),
  /** 已发送的超时提醒次数（用于 action='remind' 时限制提醒上限） */
  timeoutRemindCount: integer('timeout_remind_count').default(0).notNull(),
  /** 任务最初的处理人（创建时快照，转办/委派不会修改） */
  originalAssigneeId: integer('original_assignee_id').references(() => users.id, { onDelete: 'set null' }),
  /** 转办/委派链路上经手过的处理人 ID（含原始创建人） */
  transferChain: jsonb('transfer_chain').$type<number[]>().default([]).notNull(),
  /** 委派来源（仅委派时设置，原 assignee 接手时清空） */
  delegatedFromId: integer('delegated_from_id').references(() => users.id, { onDelete: 'set null' }),
  /** 退回模式 backToOrigin：被退回任务记录发起退回的来源节点 key，通过后直接跳回该节点 */
  returnOriginNodeKey: varchar('return_origin_node_key', { length: 64 }),
  /** 抄送已读时间（仅 ccNode 任务有意义；null 表示未读） */
  ccReadAt: timestamp('cc_read_at', { withTimezone: true }),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export type WorkflowTaskRow = typeof workflowTasks.$inferSelect;
export type NewWorkflowTask = typeof workflowTasks.$inferInsert;

// 任务催办记录：发起人或管理员对 pending 任务的催办流水
export const workflowTaskUrges = pgTable('workflow_task_urges', {
  id: serial('id').primaryKey(),
  taskId: integer('task_id').notNull().references(() => workflowTasks.id, { onDelete: 'cascade' }),
  instanceId: integer('instance_id').notNull().references(() => workflowInstances.id, { onDelete: 'cascade' }),
  urgerId: integer('urger_id').references(() => users.id, { onDelete: 'set null' }),
  urgerName: varchar('urger_name', { length: 64 }),
  message: varchar('message', { length: 256 }),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export type WorkflowTaskUrgeRow = typeof workflowTaskUrges.$inferSelect;
export type NewWorkflowTaskUrge = typeof workflowTaskUrges.$inferInsert;

// ─── 工作流事件订阅 / 投递 / 触发器执行 ─────────────────────────────────────
export const workflowEventSubscriptions = pgTable('workflow_event_subscriptions', {
  id: serial('id').primaryKey(),
  name: varchar('name', { length: 64 }).notNull(),
  description: varchar('description', { length: 256 }),
  /** 为 null 表示订阅全部流程；否则仅订阅指定流程 */
  definitionId: integer('definition_id').references(() => workflowDefinitions.id, { onDelete: 'cascade' }),
  /** 订阅的事件类型列表，存为 JSON 数组字符串 */
  events: text('events').notNull(),
  url: varchar('url', { length: 512 }).notNull(),
  secret: varchar('secret', { length: 256 }),
  signMode: workflowEventSignModeEnum('sign_mode').default('hmacSha256').notNull(),
  /** 自定义请求头，JSON 字符串 */
  headers: text('headers'),
  enabled: boolean('enabled').default(true).notNull(),
  tenantId: integer('tenant_id').references(() => tenants.id, { onDelete: 'cascade' }),
  createdBy: integer('created_by').references(() => users.id, { onDelete: 'set null' }),
  updatedBy: integer('updated_by').references(() => users.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export type WorkflowEventSubscriptionRow = typeof workflowEventSubscriptions.$inferSelect;
export type NewWorkflowEventSubscription = typeof workflowEventSubscriptions.$inferInsert;

export const workflowEventDeliveries = pgTable('workflow_event_deliveries', {
  id: serial('id').primaryKey(),
  subscriptionId: integer('subscription_id').notNull().references(() => workflowEventSubscriptions.id, { onDelete: 'cascade' }),
  instanceId: integer('instance_id'),
  taskId: integer('task_id'),
  eventId: varchar('event_id', { length: 64 }).notNull(),
  eventType: varchar('event_type', { length: 64 }).notNull(),
  payload: jsonb('payload'),
  attempt: integer('attempt').default(0).notNull(),
  status: workflowEventDeliveryStatusEnum('status').default('pending').notNull(),
  requestUrl: varchar('request_url', { length: 512 }),
  requestHeaders: text('request_headers'),
  responseStatus: integer('response_status'),
  responseBody: text('response_body'),
  errorMessage: text('error_message'),
  durationMs: integer('duration_ms'),
  nextRetryAt: timestamp('next_retry_at', { withTimezone: true }),
  startedAt: timestamp('started_at', { withTimezone: true }),
  finishedAt: timestamp('finished_at', { withTimezone: true }),
  tenantId: integer('tenant_id').references(() => tenants.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export type WorkflowEventDeliveryRow = typeof workflowEventDeliveries.$inferSelect;
export type NewWorkflowEventDelivery = typeof workflowEventDeliveries.$inferInsert;

export const workflowEventOutbox = pgTable('workflow_event_outbox', {
  id: serial('id').primaryKey(),
  eventId: varchar('event_id', { length: 64 }).notNull().unique(),
  eventType: varchar('event_type', { length: 64 }).notNull(),
  instanceId: integer('instance_id'),
  definitionId: integer('definition_id'),
  taskId: integer('task_id'),
  payload: jsonb('payload').notNull(),
  status: varchar('status', { length: 16 }).notNull().default('pending'),
  attempts: integer('attempts').notNull().default(0),
  errorMessage: text('error_message'),
  nextRetryAt: timestamp('next_retry_at', { withTimezone: true }),
  processedAt: timestamp('processed_at', { withTimezone: true }),
  tenantId: integer('tenant_id').references(() => tenants.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (t) => [
  index('workflow_event_outbox_status_idx').on(t.status, t.nextRetryAt),
  index('workflow_event_outbox_instance_idx').on(t.instanceId),
]);

export type WorkflowEventOutboxRow = typeof workflowEventOutbox.$inferSelect;
export type NewWorkflowEventOutbox = typeof workflowEventOutbox.$inferInsert;

export const workflowTriggerExecutions = pgTable('workflow_trigger_executions', {
  id: serial('id').primaryKey(),
  instanceId: integer('instance_id').notNull().references(() => workflowInstances.id, { onDelete: 'cascade' }),
  taskId: integer('task_id').references(() => workflowTasks.id, { onDelete: 'set null' }),
  nodeKey: varchar('node_key', { length: 64 }).notNull(),
  nodeName: varchar('node_name', { length: 64 }),
  triggerType: varchar('trigger_type', { length: 32 }).notNull(),
  status: workflowTriggerExecutionStatusEnum('status').default('pending').notNull(),
  attempt: integer('attempt').default(0).notNull(),
  requestUrl: varchar('request_url', { length: 512 }),
  requestMethod: varchar('request_method', { length: 16 }),
  requestBody: text('request_body'),
  responseStatus: integer('response_status'),
  responseBody: text('response_body'),
  errorMessage: text('error_message'),
  durationMs: integer('duration_ms'),
  tenantId: integer('tenant_id').references(() => tenants.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export type WorkflowTriggerExecutionRow = typeof workflowTriggerExecutions.$inferSelect;
export type NewWorkflowTriggerExecution = typeof workflowTriggerExecutions.$inferInsert;

// ─── 流程评论 / 沟通时间线 ────────────────────────────────────────────────────
// 审批人 / 抄送人 / 发起人均可在实例下自由留言（不影响审批流转），支持 @ 提及
export const workflowComments = pgTable('workflow_comments', {
  id: serial('id').primaryKey(),
  instanceId: integer('instance_id').notNull().references(() => workflowInstances.id, { onDelete: 'cascade' }),
  /** 关联的任务（在某审批任务上下文中评论时填写，可为空） */
  taskId: integer('task_id').references(() => workflowTasks.id, { onDelete: 'set null' }),
  userId: integer('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  content: text('content').notNull(),
  /** @ 提及的用户 ID 列表 */
  mentions: jsonb('mentions').$type<number[]>().default([]).notNull(),
  /** 附件列表（{ name, url, size? }[]） */
  attachments: jsonb('attachments').$type<Array<{ name: string; url: string; size?: number }>>().default([]).notNull(),
  tenantId: integer('tenant_id').references(() => tenants.id, { onDelete: 'cascade' }),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export type WorkflowCommentRow = typeof workflowComments.$inferSelect;
export type NewWorkflowComment = typeof workflowComments.$inferInsert;

// ─── 审批意见常用语 ───────────────────────────────────────────────────────────
// userId 为 null 表示系统预置（所有人可见）；否则为个人常用语
export const workflowQuickPhrases = pgTable('workflow_quick_phrases', {
  id: serial('id').primaryKey(),
  userId: integer('user_id').references(() => users.id, { onDelete: 'cascade' }),
  content: varchar('content', { length: 255 }).notNull(),
  sort: integer('sort').default(0).notNull(),
  tenantId: integer('tenant_id').references(() => tenants.id, { onDelete: 'cascade' }),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().$onUpdate(() => new Date()).notNull(),
});

export type WorkflowQuickPhraseRow = typeof workflowQuickPhrases.$inferSelect;
export type NewWorkflowQuickPhrase = typeof workflowQuickPhrases.$inferInsert;

// ─── 审批代理 / 离岗委托 ──────────────────────────────────────────────────────
// principal 在 [startAt, endAt] 区间内（或永久）将其待审批任务自动转交给 delegate
export const workflowDelegations = pgTable('workflow_delegations', {
  id: serial('id').primaryKey(),
  /** 委托人（被代理人）：其待办将被转交 */
  principalId: integer('principal_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  /** 代理人（受托人）：接收待办 */
  delegateId: integer('delegate_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  /** 限定的流程定义（为 null 表示对全部流程生效） */
  definitionId: integer('definition_id').references(() => workflowDefinitions.id, { onDelete: 'cascade' }),
  reason: varchar('reason', { length: 255 }),
  /** 生效开始时间（为 null 表示立即生效） */
  startAt: timestamp('start_at', { withTimezone: true }),
  /** 生效结束时间（为 null 表示长期有效） */
  endAt: timestamp('end_at', { withTimezone: true }),
  enabled: boolean('enabled').default(true).notNull(),
  tenantId: integer('tenant_id').references(() => tenants.id, { onDelete: 'cascade' }),
  ...auditColumns(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().$onUpdate(() => new Date()).notNull(),
});

export type WorkflowDelegationRow = typeof workflowDelegations.$inferSelect;
export type NewWorkflowDelegation = typeof workflowDelegations.$inferInsert;

// ─── 业务编号计数器 ───────────────────────────────────────────────────────────
// 每个流程定义 + 周期键（如 '20260620' / 'ALL'）维护一个自增序列，原子自增防并发
export const workflowSerialCounters = pgTable('workflow_serial_counters', {
  id: serial('id').primaryKey(),
  definitionId: integer('definition_id').notNull().references(() => workflowDefinitions.id, { onDelete: 'cascade' }),
  periodKey: varchar('period_key', { length: 16 }).notNull(),
  seq: integer('seq').default(0).notNull(),
}, (t) => [unique('workflow_serial_counters_def_period_uniq').on(t.definitionId, t.periodKey)]);

export type WorkflowSerialCounterRow = typeof workflowSerialCounters.$inferSelect;
export type NewWorkflowSerialCounter = typeof workflowSerialCounters.$inferInsert;

// ─── 流程模板库 ───────────────────────────────────────────────────────────────
export const workflowTemplates = pgTable('workflow_templates', {
  id: serial('id').primaryKey(),
  name: varchar('name', { length: 64 }).notNull(),
  code: varchar('code', { length: 64 }),
  description: text('description'),
  categoryName: varchar('category_name', { length: 64 }),
  icon: varchar('icon', { length: 64 }),
  color: varchar('color', { length: 16 }),
  /** 流程图数据（React Flow / process JSON），克隆时写入新流程定义的 flowData */
  flowData: jsonb('flow_data'),
  /** 表单结构（{ fields, settings }），克隆时创建对应表单 */
  formSchema: jsonb('form_schema'),
  sort: integer('sort').default(0).notNull(),
  /** 系统内置模板（不可删除） */
  builtin: boolean('builtin').default(false).notNull(),
  tenantId: integer('tenant_id').references(() => tenants.id, { onDelete: 'cascade' }),
  ...auditColumns(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().$onUpdate(() => new Date()).notNull(),
}, (t) => [unique('workflow_templates_code_uniq').on(t.code)]);

export type WorkflowTemplateRow = typeof workflowTemplates.$inferSelect;
export type NewWorkflowTemplate = typeof workflowTemplates.$inferInsert;

// ─── 审批协办 / 邀请处理意见 ──────────────────────────────────────────────────
export const workflowTaskConsultStatusEnum = pgEnum('workflow_task_consult_status', ['pending', 'replied', 'revoked']);

export const workflowTaskConsults = pgTable('workflow_task_consults', {
  id: serial('id').primaryKey(),
  taskId: integer('task_id').notNull().references(() => workflowTasks.id, { onDelete: 'cascade' }),
  instanceId: integer('instance_id').notNull().references(() => workflowInstances.id, { onDelete: 'cascade' }),
  /** 发起协办的审批人 */
  inviterId: integer('inviter_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  /** 被邀请协办的人 */
  consulteeId: integer('consultee_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  question: varchar('question', { length: 500 }),
  opinion: text('opinion'),
  status: workflowTaskConsultStatusEnum('status').default('pending').notNull(),
  repliedAt: timestamp('replied_at', { withTimezone: true }),
  tenantId: integer('tenant_id').references(() => tenants.id, { onDelete: 'cascade' }),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export type WorkflowTaskConsultRow = typeof workflowTaskConsults.$inferSelect;
export type NewWorkflowTaskConsult = typeof workflowTaskConsults.$inferInsert;

// ─── 聊天会话表 ───────────────────────────────────────────────────────────────
export const chatConversationTypeEnum = pgEnum('chat_conversation_type', ['direct', 'group']);
export const chatMemberRoleEnum = pgEnum('chat_member_role', ['owner', 'member']);

export const chatConversations = pgTable('chat_conversations', {
  id: serial('id').primaryKey(),
  type: chatConversationTypeEnum('type').notNull().default('direct'),
  name: varchar('name', { length: 64 }),
  announcement: varchar('announcement', { length: 500 }),
  ...auditColumns(),
  tenantId: integer('tenant_id').references(() => tenants.id, { onDelete: 'cascade' }),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().$onUpdate(() => new Date()).notNull(),
});

export type ChatConversationRow = typeof chatConversations.$inferSelect;
export type NewChatConversation = typeof chatConversations.$inferInsert;

// ─── 聊天会话成员表 ───────────────────────────────────────────────────────────
export const chatConversationMembers = pgTable('chat_conversation_members', {
  conversationId: integer('conversation_id').notNull().references(() => chatConversations.id, { onDelete: 'cascade' }),
  userId: integer('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  role: chatMemberRoleEnum('role').notNull().default('member'),
  isPinned: boolean('is_pinned').notNull().default(false),
  isStarred: boolean('is_starred').notNull().default(false),
  isMuted: boolean('is_muted').notNull().default(false),
  lastReadAt: timestamp('last_read_at', { withTimezone: true }),
  joinedAt: timestamp('joined_at').defaultNow().notNull(),
}, (t) => [primaryKey({ columns: [t.conversationId, t.userId] })]);

export type ChatConversationMemberRow = typeof chatConversationMembers.$inferSelect;

// ─── 聊天消息表 ───────────────────────────────────────────────────────────────
export const chatMessageTypeEnum = pgEnum('chat_message_type', ['text', 'image', 'file', 'system', 'forward', 'vote', 'voice', 'card']);

export const chatMessages = pgTable('chat_messages', {
  id: serial('id').primaryKey(),
  conversationId: integer('conversation_id').notNull().references(() => chatConversations.id, { onDelete: 'cascade' }),
  senderId: integer('sender_id').references(() => users.id, { onDelete: 'set null' }),
  type: chatMessageTypeEnum('type').notNull().default('text'),
  content: text('content').notNull(),
  replyToId: integer('reply_to_id'),
  isRecalled: boolean('is_recalled').notNull().default(false),
  isEdited: boolean('is_edited').notNull().default(false),
  extra: jsonb('extra'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().$onUpdate(() => new Date()).notNull(),
});

export type ChatMessageRow = typeof chatMessages.$inferSelect;
export type NewChatMessage = typeof chatMessages.$inferInsert;

export const chatMessageReactions = pgTable('chat_message_reactions', {
  id: serial('id').primaryKey(),
  messageId: integer('message_id').notNull().references(() => chatMessages.id, { onDelete: 'cascade' }),
  userId: integer('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  emoji: varchar('emoji', { length: 10 }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  unique().on(table.messageId, table.userId, table.emoji),
]);

export type ChatMessageReactionRow = typeof chatMessageReactions.$inferSelect;

// ─── 聊天入站 Webhook 机器人 ────────────────────────────────────────────────
export const chatWebhooks = pgTable('chat_webhooks', {
  id: serial('id').primaryKey(),
  name: varchar('name', { length: 64 }).notNull(),
  avatar: varchar('avatar', { length: 256 }),
  description: varchar('description', { length: 255 }),
  /** 入站推送令牌（明文存储，随机生成） */
  token: varchar('token', { length: 128 }).notNull().unique(),
  /** 消息投递的目标会话 */
  conversationId: integer('conversation_id').notNull().references(() => chatConversations.id, { onDelete: 'cascade' }),
  enabled: boolean('enabled').notNull().default(true),
  lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
  ...auditColumns(),
  tenantId: integer('tenant_id').references(() => tenants.id, { onDelete: 'cascade' }),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().$onUpdate(() => new Date()).notNull(),
});

export type ChatWebhookRow = typeof chatWebhooks.$inferSelect;
export type NewChatWebhook = typeof chatWebhooks.$inferInsert;

// ─── Channel（站内公众号 / 系统号）────────────────────────────────────────────
export const channelTypeEnum = pgEnum('channel_type', ['system', 'business']);
export const channelAudienceEnum = pgEnum('channel_audience', ['broadcast', 'targeted']);
export const channelMessageTypeEnum = pgEnum('channel_message_type', ['text', 'card', 'image', 'news']);
export const channelMessageStatusEnum = pgEnum('channel_message_status', ['sent', 'draft', 'scheduled']);
export const channelMessageDirectionEnum = pgEnum('channel_message_direction', ['out', 'in']);
export const channelMenuTypeEnum = pgEnum('channel_menu_type', ['click', 'view']);
export const channelAutoReplyMatchEnum = pgEnum('channel_auto_reply_match', ['subscribe', 'keyword', 'default']);
export const channelAutoReplyKeywordModeEnum = pgEnum('channel_auto_reply_keyword_mode', ['exact', 'contains']);
export const channelConversationStatusEnum = pgEnum('channel_conversation_status', ['open', 'processing', 'resolved']);

export const channels = pgTable('channels', {
  id: serial('id').primaryKey(),
  code: varchar('code', { length: 64 }).notNull().unique(),
  name: varchar('name', { length: 64 }).notNull(),
  avatar: varchar('avatar', { length: 256 }),
  description: varchar('description', { length: 255 }),
  type: channelTypeEnum('type').notNull().default('system'),
  builtin: boolean('builtin').notNull().default(false),
  status: statusEnum('status').notNull().default('enabled'),
  tenantId: integer('tenant_id').references(() => tenants.id, { onDelete: 'cascade' }),
  ...auditColumns(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().$onUpdate(() => new Date()).notNull(),
});
export type ChannelRow = typeof channels.$inferSelect;
export type NewChannel = typeof channels.$inferInsert;

export const channelMessages = pgTable('channel_messages', {
  id: serial('id').primaryKey(),
  channelId: integer('channel_id').notNull().references(() => channels.id, { onDelete: 'cascade' }),
  audienceType: channelAudienceEnum('audience_type').notNull().default('broadcast'),
  type: channelMessageTypeEnum('type').notNull().default('text'),
  title: varchar('title', { length: 200 }),
  content: text('content').notNull(),
  extra: jsonb('extra'),
  publishedById: integer('published_by_id').references(() => users.id, { onDelete: 'set null' }),
  direction: channelMessageDirectionEnum('direction').notNull().default('out'),
  senderUserId: integer('sender_user_id').references(() => users.id, { onDelete: 'set null' }),
  status: channelMessageStatusEnum('status').notNull().default('sent'),
  scheduledAt: timestamp('scheduled_at', { withTimezone: true }),
  retractedAt: timestamp('retracted_at', { withTimezone: true }),
  targetSpec: jsonb('target_spec'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});
export type ChannelMessageRow = typeof channelMessages.$inferSelect;
export type NewChannelMessage = typeof channelMessages.$inferInsert;

export const channelSubscriptions = pgTable('channel_subscriptions', {
  channelId: integer('channel_id').notNull().references(() => channels.id, { onDelete: 'cascade' }),
  userId: integer('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  lastReadAt: timestamp('last_read_at', { withTimezone: true }),
  isMuted: boolean('is_muted').notNull().default(false),
  subscribedAt: timestamp('subscribed_at').defaultNow().notNull(),
}, (t) => [primaryKey({ columns: [t.channelId, t.userId] })]);
export type ChannelSubscriptionRow = typeof channelSubscriptions.$inferSelect;

export const channelMessageTargets = pgTable('channel_message_targets', {
  messageId: integer('message_id').notNull().references(() => channelMessages.id, { onDelete: 'cascade' }),
  userId: integer('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  readAt: timestamp('read_at', { withTimezone: true }),
}, (t) => [primaryKey({ columns: [t.messageId, t.userId] })]);
export type ChannelMessageTargetRow = typeof channelMessageTargets.$inferSelect;

export const channelsRelations = relations(channels, ({ many }) => ({
  messages: many(channelMessages),
  subscriptions: many(channelSubscriptions),
}));
export const channelMessagesRelations = relations(channelMessages, ({ one, many }) => ({
  channel: one(channels, { fields: [channelMessages.channelId], references: [channels.id] }),
  publishedBy: one(users, { fields: [channelMessages.publishedById], references: [users.id] }),
  targets: many(channelMessageTargets),
}));
export const channelSubscriptionsRelations = relations(channelSubscriptions, ({ one }) => ({
  channel: one(channels, { fields: [channelSubscriptions.channelId], references: [channels.id] }),
  user: one(users, { fields: [channelSubscriptions.userId], references: [users.id] }),
}));
export const channelMessageTargetsRelations = relations(channelMessageTargets, ({ one }) => ({
  message: one(channelMessages, { fields: [channelMessageTargets.messageId], references: [channelMessages.id] }),
  user: one(users, { fields: [channelMessageTargets.userId], references: [users.id] }),
}));

// ─── Channel 公众号菜单（运营号底部菜单） ──────────────────────────────────────
export const channelMenus = pgTable('channel_menus', {
  id: serial('id').primaryKey(),
  channelId: integer('channel_id').notNull().references(() => channels.id, { onDelete: 'cascade' }),
  parentId: integer('parent_id'),
  name: varchar('name', { length: 32 }).notNull(),
  type: channelMenuTypeEnum('type').notNull().default('click'),
  value: varchar('value', { length: 500 }),
  sort: integer('sort').notNull().default(0),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().$onUpdate(() => new Date()).notNull(),
});
export type ChannelMenuRow = typeof channelMenus.$inferSelect;

// ─── Channel 自动回复规则 ──────────────────────────────────────────────────────
export const channelAutoReplies = pgTable('channel_auto_replies', {
  id: serial('id').primaryKey(),
  channelId: integer('channel_id').notNull().references(() => channels.id, { onDelete: 'cascade' }),
  matchType: channelAutoReplyMatchEnum('match_type').notNull().default('keyword'),
  keyword: varchar('keyword', { length: 100 }),
  keywordMode: channelAutoReplyKeywordModeEnum('keyword_mode').notNull().default('contains'),
  replyType: channelMessageTypeEnum('reply_type').notNull().default('text'),
  replyContent: text('reply_content').notNull(),
  replyExtra: jsonb('reply_extra'),
  hitCount: integer('hit_count').notNull().default(0),
  status: statusEnum('status').notNull().default('enabled'),
  sort: integer('sort').notNull().default(0),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().$onUpdate(() => new Date()).notNull(),
});
export type ChannelAutoReplyRow = typeof channelAutoReplies.$inferSelect;

export const channelMenusRelations = relations(channelMenus, ({ one }) => ({
  channel: one(channels, { fields: [channelMenus.channelId], references: [channels.id] }),
}));
export const channelAutoRepliesRelations = relations(channelAutoReplies, ({ one }) => ({
  channel: one(channels, { fields: [channelAutoReplies.channelId], references: [channels.id] }),
}));

// ─── Channel 客服快捷回复库（D：channelId 为 null 表示全局，所有运营号可用） ────
export const channelQuickReplies = pgTable('channel_quick_replies', {
  id: serial('id').primaryKey(),
  channelId: integer('channel_id').references(() => channels.id, { onDelete: 'cascade' }),
  title: varchar('title', { length: 100 }).notNull(),
  content: text('content').notNull(),
  sort: integer('sort').notNull().default(0),
  ...auditColumns(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().$onUpdate(() => new Date()).notNull(),
});
export type ChannelQuickReplyRow = typeof channelQuickReplies.$inferSelect;
export type NewChannelQuickReply = typeof channelQuickReplies.$inferInsert;

export const channelQuickRepliesRelations = relations(channelQuickReplies, ({ one }) => ({
  channel: one(channels, { fields: [channelQuickReplies.channelId], references: [channels.id] }),
}));

// ─── Channel 客服会话治理（G：状态机 / 指派转接 / 标签；属性表 left join 到消息聚合） ──
export const channelConversations = pgTable('channel_conversations', {
  channelId: integer('channel_id').notNull().references(() => channels.id, { onDelete: 'cascade' }),
  userId: integer('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  status: channelConversationStatusEnum('status').notNull().default('open'),
  assigneeId: integer('assignee_id').references(() => users.id, { onDelete: 'set null' }),
  tags: jsonb('tags').$type<string[]>().notNull().default([]),
  resolvedAt: timestamp('resolved_at', { withTimezone: true }),
  rating: integer('rating'),
  ratingComment: text('rating_comment'),
  ratedAt: timestamp('rated_at', { withTimezone: true }),
  ...auditColumns(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().$onUpdate(() => new Date()).notNull(),
}, (t) => [primaryKey({ columns: [t.channelId, t.userId] })]);
export type ChannelConversationRow = typeof channelConversations.$inferSelect;
export type NewChannelConversation = typeof channelConversations.$inferInsert;

export const channelConversationsRelations = relations(channelConversations, ({ one }) => ({
  channel: one(channels, { fields: [channelConversations.channelId], references: [channels.id] }),
  user: one(users, { fields: [channelConversations.userId], references: [users.id] }),
  assignee: one(users, { fields: [channelConversations.assigneeId], references: [users.id] }),
}));

// ─── Channel 群发消息模板（运营常用群发内容保存复用） ──────────────────────────
export const channelMessageTemplates = pgTable('channel_message_templates', {
  id: serial('id').primaryKey(),
  name: varchar('name', { length: 100 }).notNull(),
  type: channelMessageTypeEnum('type').notNull().default('text'),
  title: varchar('title', { length: 200 }),
  content: text('content').notNull().default(''),
  extra: jsonb('extra'),
  ...auditColumns(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().$onUpdate(() => new Date()).notNull(),
});
export type ChannelMessageTemplateRow = typeof channelMessageTemplates.$inferSelect;
export type NewChannelMessageTemplate = typeof channelMessageTemplates.$inferInsert;

// ═══════════════════════════════════════════════════════════════════════════
// 支付中心（Payment Center）
// ═══════════════════════════════════════════════════════════════════════════
export const paymentChannelEnum = pgEnum('payment_channel', ['wechat', 'alipay']);
export const paymentMethodEnum = pgEnum('payment_method', [
  'wechat_native', 'wechat_jsapi', 'wechat_h5',
  'alipay_page', 'alipay_wap', 'alipay_app',
]);
export const paymentOrderStatusEnum = pgEnum('payment_order_status', [
  'pending', 'paying', 'success', 'closed', 'refunding', 'refunded', 'failed',
]);
export const paymentRefundStatusEnum = pgEnum('payment_refund_status', [
  'pending', 'processing', 'success', 'failed',
]);
export const paymentRefundApprovalStatusEnum = pgEnum('payment_refund_approval_status', [
  'none', 'pending', 'approved', 'rejected',
]);

// ─── 支付渠道配置表（密钥字段以 encryptField 加密存储）─────────────────────────
export const paymentChannelConfigs = pgTable('payment_channel_configs', {
  id: serial('id').primaryKey(),
  name: varchar('name', { length: 64 }).notNull(),
  channel: paymentChannelEnum('channel').notNull(),
  status: statusEnum('status').notNull().default('enabled'),
  isDefault: boolean('is_default').notNull().default(false),
  sandbox: boolean('sandbox').notNull().default(false),
  notifyUrl: varchar('notify_url', { length: 512 }),
  // 微信支付 v3
  wechatAppId: varchar('wechat_app_id', { length: 64 }),
  wechatMchId: varchar('wechat_mch_id', { length: 64 }),
  wechatApiV3KeyEncrypted: text('wechat_api_v3_key_encrypted'),
  wechatPrivateKeyEncrypted: text('wechat_private_key_encrypted'),
  wechatSerialNo: varchar('wechat_serial_no', { length: 128 }),
  wechatPlatformCert: text('wechat_platform_cert'),
  // 支付宝
  alipayAppId: varchar('alipay_app_id', { length: 64 }),
  alipayPrivateKeyEncrypted: text('alipay_private_key_encrypted'),
  alipayPublicKey: text('alipay_public_key'),
  alipaySignType: varchar('alipay_sign_type', { length: 16 }).default('RSA2'),
  alipayGateway: varchar('alipay_gateway', { length: 256 }),
  remark: varchar('remark', { length: 256 }),
  tenantId: integer('tenant_id').references(() => tenants.id, { onDelete: 'cascade' }),
  ...auditColumns(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().$onUpdate(() => new Date()).notNull(),
});

export type PaymentChannelConfigRow = typeof paymentChannelConfigs.$inferSelect;
export type NewPaymentChannelConfig = typeof paymentChannelConfigs.$inferInsert;

// ─── 支付订单表（核心交易表）──────────────────────────────────────────────────
export const paymentOrders = pgTable('payment_orders', {
  id: serial('id').primaryKey(),
  orderNo: varchar('order_no', { length: 64 }).notNull().unique(),
  outTradeNo: varchar('out_trade_no', { length: 64 }).notNull(),
  channelTradeNo: varchar('channel_trade_no', { length: 128 }),
  bizType: varchar('biz_type', { length: 64 }).notNull(),
  bizId: varchar('biz_id', { length: 128 }).notNull(),
  subject: varchar('subject', { length: 256 }).notNull(),
  body: varchar('body', { length: 512 }),
  amount: integer('amount').notNull(),
  currency: varchar('currency', { length: 8 }).notNull().default('CNY'),
  channel: paymentChannelEnum('channel').notNull(),
  channelConfigId: integer('channel_config_id').references(() => paymentChannelConfigs.id, { onDelete: 'set null' }),
  payMethod: paymentMethodEnum('pay_method').notNull(),
  status: paymentOrderStatusEnum('status').notNull().default('pending'),
  userId: integer('user_id').references(() => users.id, { onDelete: 'set null' }),
  openId: varchar('open_id', { length: 128 }),
  clientIp: varchar('client_ip', { length: 64 }),
  departmentId: integer('department_id').references(() => departments.id, { onDelete: 'set null' }),
  paidAmount: integer('paid_amount'),
  feeAmount: integer('fee_amount'),
  netAmount: integer('net_amount'),
  paidAt: timestamp('paid_at', { withTimezone: true }),
  expiredAt: timestamp('expired_at', { withTimezone: true }),
  notifyData: text('notify_data'),
  errorMessage: varchar('error_message', { length: 512 }),
  tenantId: integer('tenant_id').references(() => tenants.id, { onDelete: 'cascade' }),
  ...auditColumns(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().$onUpdate(() => new Date()).notNull(),
}, (t) => [
  unique('payment_orders_channel_out_trade_no_uq').on(t.channel, t.outTradeNo),
  index('payment_orders_biz_idx').on(t.bizType, t.bizId),
  index('payment_orders_status_idx').on(t.status),
  index('payment_orders_expired_idx').on(t.expiredAt),
]);

export type PaymentOrderRow = typeof paymentOrders.$inferSelect;
export type NewPaymentOrder = typeof paymentOrders.$inferInsert;

// ─── 支付退款表 ───────────────────────────────────────────────────────────────
export const paymentRefunds = pgTable('payment_refunds', {
  id: serial('id').primaryKey(),
  refundNo: varchar('refund_no', { length: 64 }).notNull().unique(),
  outRefundNo: varchar('out_refund_no', { length: 64 }).notNull(),
  orderNo: varchar('order_no', { length: 64 }).notNull(),
  orderId: integer('order_id').references(() => paymentOrders.id, { onDelete: 'cascade' }),
  channelRefundNo: varchar('channel_refund_no', { length: 128 }),
  channel: paymentChannelEnum('channel').notNull(),
  refundAmount: integer('refund_amount').notNull(),
  totalAmount: integer('total_amount').notNull(),
  reason: varchar('reason', { length: 256 }),
  status: paymentRefundStatusEnum('status').notNull().default('pending'),
  approvalStatus: paymentRefundApprovalStatusEnum('approval_status').notNull().default('none'),
  appliedById: integer('applied_by_id').references(() => users.id, { onDelete: 'set null' }),
  approverId: integer('approver_id').references(() => users.id, { onDelete: 'set null' }),
  approvedAt: timestamp('approved_at', { withTimezone: true }),
  approvalRemark: varchar('approval_remark', { length: 256 }),
  operatorId: integer('operator_id').references(() => users.id, { onDelete: 'set null' }),
  refundedAt: timestamp('refunded_at', { withTimezone: true }),
  notifyData: text('notify_data'),
  errorMessage: varchar('error_message', { length: 512 }),
  tenantId: integer('tenant_id').references(() => tenants.id, { onDelete: 'cascade' }),
  ...auditColumns(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().$onUpdate(() => new Date()).notNull(),
}, (t) => [
  index('payment_refunds_order_no_idx').on(t.orderNo),
  index('payment_refunds_status_idx').on(t.status),
]);

export type PaymentRefundRow = typeof paymentRefunds.$inferSelect;
export type NewPaymentRefund = typeof paymentRefunds.$inferInsert;

// ─── 支付回调日志表（追加型，不含审计列）──────────────────────────────────────
export const paymentNotifyLogs = pgTable('payment_notify_logs', {
  id: serial('id').primaryKey(),
  channel: paymentChannelEnum('channel').notNull(),
  scene: varchar('scene', { length: 16 }).notNull().default('payment'),
  orderNo: varchar('order_no', { length: 64 }),
  rawBody: text('raw_body'),
  headers: text('headers'),
  signatureValid: boolean('signature_valid').notNull().default(false),
  result: varchar('result', { length: 32 }),
  message: varchar('message', { length: 512 }),
  ip: varchar('ip', { length: 64 }),
  tenantId: integer('tenant_id').references(() => tenants.id, { onDelete: 'cascade' }),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (t) => [
  index('payment_notify_logs_order_no_idx').on(t.orderNo),
]);

export type PaymentNotifyLogRow = typeof paymentNotifyLogs.$inferSelect;
export type NewPaymentNotifyLog = typeof paymentNotifyLogs.$inferInsert;

// ─── 支付事件 Outbox 表（保证支付/退款成功事件可靠投递，进程崩溃后由 cron 补投）─────
export const paymentEventStatusEnum = pgEnum('payment_event_status', ['pending', 'done', 'failed']);
export const paymentEvents = pgTable('payment_events', {
  id: serial('id').primaryKey(),
  type: varchar('type', { length: 32 }).notNull(),
  orderNo: varchar('order_no', { length: 64 }).notNull(),
  payload: text('payload').notNull(),
  status: paymentEventStatusEnum('status').notNull().default('pending'),
  attempts: integer('attempts').notNull().default(0),
  lastError: varchar('last_error', { length: 512 }),
  tenantId: integer('tenant_id').references(() => tenants.id, { onDelete: 'cascade' }),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  processedAt: timestamp('processed_at', { withTimezone: true }),
}, (t) => [index('payment_events_status_idx').on(t.status)]);

export type PaymentEventRow = typeof paymentEvents.$inferSelect;
export type NewPaymentEvent = typeof paymentEvents.$inferInsert;

// ─── 支付中心关系声明 ─────────────────────────────────────────────────────────
export const paymentChannelConfigsRelations = relations(paymentChannelConfigs, ({ many }) => ({
  orders: many(paymentOrders),
}));
export const paymentOrdersRelations = relations(paymentOrders, ({ one, many }) => ({
  channelConfig: one(paymentChannelConfigs, { fields: [paymentOrders.channelConfigId], references: [paymentChannelConfigs.id] }),
  user: one(users, { fields: [paymentOrders.userId], references: [users.id] }),
  refunds: many(paymentRefunds),
}));
export const paymentRefundsRelations = relations(paymentRefunds, ({ one }) => ({
  order: one(paymentOrders, { fields: [paymentRefunds.orderId], references: [paymentOrders.id] }),
}));

// ═══════════════════════════════════════════════════════════════════════════
// 支付中心扩展 · A 档（对账 / Webhook / 资金台账）
// ═══════════════════════════════════════════════════════════════════════════

// ─── 对账中心 ─────────────────────────────────────────────────────────────────
export const paymentReconStatusEnum = pgEnum('payment_recon_status', ['pending', 'comparing', 'done', 'failed']);
export const paymentReconResultEnum = pgEnum('payment_recon_result', ['matched', 'local_only', 'channel_only', 'amount_diff', 'status_diff']);

export const paymentReconBatches = pgTable('payment_recon_batches', {
  id: serial('id').primaryKey(),
  batchNo: varchar('batch_no', { length: 64 }).notNull().unique(),
  channel: paymentChannelEnum('channel').notNull(),
  billDate: varchar('bill_date', { length: 10 }).notNull(),
  status: paymentReconStatusEnum('status').notNull().default('pending'),
  localCount: integer('local_count').notNull().default(0),
  localAmount: integer('local_amount').notNull().default(0),
  channelCount: integer('channel_count').notNull().default(0),
  channelAmount: integer('channel_amount').notNull().default(0),
  matchedCount: integer('matched_count').notNull().default(0),
  diffCount: integer('diff_count').notNull().default(0),
  remark: varchar('remark', { length: 256 }),
  tenantId: integer('tenant_id').references(() => tenants.id, { onDelete: 'cascade' }),
  ...auditColumns(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().$onUpdate(() => new Date()).notNull(),
}, (t) => [index('payment_recon_batches_date_idx').on(t.billDate)]);
export type PaymentReconBatchRow = typeof paymentReconBatches.$inferSelect;
export type NewPaymentReconBatch = typeof paymentReconBatches.$inferInsert;

export const paymentReconItems = pgTable('payment_recon_items', {
  id: serial('id').primaryKey(),
  batchId: integer('batch_id').notNull().references(() => paymentReconBatches.id, { onDelete: 'cascade' }),
  orderNo: varchar('order_no', { length: 64 }),
  channelTradeNo: varchar('channel_trade_no', { length: 128 }),
  localAmount: integer('local_amount'),
  channelAmount: integer('channel_amount'),
  localStatus: varchar('local_status', { length: 32 }),
  channelStatus: varchar('channel_status', { length: 32 }),
  result: paymentReconResultEnum('result').notNull(),
  remark: varchar('remark', { length: 256 }),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (t) => [index('payment_recon_items_batch_idx').on(t.batchId)]);
export type PaymentReconItemRow = typeof paymentReconItems.$inferSelect;
export type NewPaymentReconItem = typeof paymentReconItems.$inferInsert;

// ─── 业务方 Webhook ───────────────────────────────────────────────────────────
export const paymentWebhookDeliveryStatusEnum = pgEnum('payment_webhook_delivery_status', ['pending', 'success', 'failed']);

export const paymentWebhookEndpoints = pgTable('payment_webhook_endpoints', {
  id: serial('id').primaryKey(),
  name: varchar('name', { length: 64 }).notNull(),
  url: varchar('url', { length: 512 }).notNull(),
  secretEncrypted: text('secret_encrypted'),
  bizType: varchar('biz_type', { length: 64 }),
  events: jsonb('events').$type<string[]>().default([]).notNull(),
  status: statusEnum('status').notNull().default('enabled'),
  remark: varchar('remark', { length: 256 }),
  tenantId: integer('tenant_id').references(() => tenants.id, { onDelete: 'cascade' }),
  ...auditColumns(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().$onUpdate(() => new Date()).notNull(),
});
export type PaymentWebhookEndpointRow = typeof paymentWebhookEndpoints.$inferSelect;
export type NewPaymentWebhookEndpoint = typeof paymentWebhookEndpoints.$inferInsert;

export const paymentWebhookDeliveries = pgTable('payment_webhook_deliveries', {
  id: serial('id').primaryKey(),
  endpointId: integer('endpoint_id').notNull().references(() => paymentWebhookEndpoints.id, { onDelete: 'cascade' }),
  eventType: varchar('event_type', { length: 32 }).notNull(),
  orderNo: varchar('order_no', { length: 64 }),
  payload: text('payload').notNull(),
  status: paymentWebhookDeliveryStatusEnum('status').notNull().default('pending'),
  attempts: integer('attempts').notNull().default(0),
  httpStatus: integer('http_status'),
  responseBody: varchar('response_body', { length: 1024 }),
  lastError: varchar('last_error', { length: 512 }),
  nextRetryAt: timestamp('next_retry_at', { withTimezone: true }),
  tenantId: integer('tenant_id').references(() => tenants.id, { onDelete: 'cascade' }),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().$onUpdate(() => new Date()).notNull(),
}, (t) => [index('payment_webhook_deliveries_endpoint_idx').on(t.endpointId), index('payment_webhook_deliveries_status_idx').on(t.status)]);
export type PaymentWebhookDeliveryRow = typeof paymentWebhookDeliveries.$inferSelect;
export type NewPaymentWebhookDelivery = typeof paymentWebhookDeliveries.$inferInsert;

// ─── 资金流水台账 ─────────────────────────────────────────────────────────────
export const paymentLedgerDirectionEnum = pgEnum('payment_ledger_direction', ['in', 'out']);
export const paymentLedgerTypeEnum = pgEnum('payment_ledger_type', ['payment', 'refund', 'fee', 'settlement', 'adjust']);

export const paymentLedgerEntries = pgTable('payment_ledger_entries', {
  id: serial('id').primaryKey(),
  entryNo: varchar('entry_no', { length: 64 }).notNull().unique(),
  direction: paymentLedgerDirectionEnum('direction').notNull(),
  type: paymentLedgerTypeEnum('type').notNull(),
  amount: integer('amount').notNull(),
  orderNo: varchar('order_no', { length: 64 }),
  refundNo: varchar('refund_no', { length: 64 }),
  channel: paymentChannelEnum('channel'),
  bizType: varchar('biz_type', { length: 64 }),
  remark: varchar('remark', { length: 256 }),
  tenantId: integer('tenant_id').references(() => tenants.id, { onDelete: 'cascade' }),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (t) => [index('payment_ledger_order_idx').on(t.orderNo), index('payment_ledger_type_idx').on(t.type)]);
export type PaymentLedgerEntryRow = typeof paymentLedgerEntries.$inferSelect;
export type NewPaymentLedgerEntry = typeof paymentLedgerEntries.$inferInsert;

export const paymentReconBatchesRelations = relations(paymentReconBatches, ({ many }) => ({
  items: many(paymentReconItems),
}));
export const paymentReconItemsRelations = relations(paymentReconItems, ({ one }) => ({
  batch: one(paymentReconBatches, { fields: [paymentReconItems.batchId], references: [paymentReconBatches.id] }),
}));
export const paymentWebhookEndpointsRelations = relations(paymentWebhookEndpoints, ({ many }) => ({
  deliveries: many(paymentWebhookDeliveries),
}));
export const paymentWebhookDeliveriesRelations = relations(paymentWebhookDeliveries, ({ one }) => ({
  endpoint: one(paymentWebhookEndpoints, { fields: [paymentWebhookDeliveries.endpointId], references: [paymentWebhookEndpoints.id] }),
}));

// ═══════════════════════════════════════════════════════════════════════════
// 支付中心扩展 · B 档（费率 / 结算 / 分账 / 支付链接 / 风控 / 支付方式 / 报表）
// ═══════════════════════════════════════════════════════════════════════════

// ─── 手续费/费率规则 ─────────────────────────────────────────────────────────
export const paymentFeeRules = pgTable('payment_fee_rules', {
  id: serial('id').primaryKey(),
  name: varchar('name', { length: 64 }).notNull(),
  channel: paymentChannelEnum('channel').notNull(),
  payMethod: paymentMethodEnum('pay_method'),
  rateBps: integer('rate_bps').notNull().default(0),
  fixedFee: integer('fixed_fee').notNull().default(0),
  minFee: integer('min_fee'),
  maxFee: integer('max_fee'),
  status: statusEnum('status').notNull().default('enabled'),
  priority: integer('priority').notNull().default(0),
  remark: varchar('remark', { length: 256 }),
  tenantId: integer('tenant_id').references(() => tenants.id, { onDelete: 'cascade' }),
  ...auditColumns(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().$onUpdate(() => new Date()).notNull(),
}, (t) => [index('payment_fee_rules_channel_idx').on(t.channel)]);
export type PaymentFeeRuleRow = typeof paymentFeeRules.$inferSelect;
export type NewPaymentFeeRule = typeof paymentFeeRules.$inferInsert;

// ─── 结算批次 ─────────────────────────────────────────────────────────────────
export const paymentSettlementStatusEnum = pgEnum('payment_settlement_status', ['pending', 'settling', 'settled', 'failed']);
export const paymentSettlementBatches = pgTable('payment_settlement_batches', {
  id: serial('id').primaryKey(),
  batchNo: varchar('batch_no', { length: 64 }).notNull().unique(),
  channel: paymentChannelEnum('channel').notNull(),
  periodStart: varchar('period_start', { length: 10 }).notNull(),
  periodEnd: varchar('period_end', { length: 10 }).notNull(),
  status: paymentSettlementStatusEnum('status').notNull().default('pending'),
  orderCount: integer('order_count').notNull().default(0),
  grossAmount: integer('gross_amount').notNull().default(0),
  feeAmount: integer('fee_amount').notNull().default(0),
  refundAmount: integer('refund_amount').notNull().default(0),
  netAmount: integer('net_amount').notNull().default(0),
  settledAt: timestamp('settled_at', { withTimezone: true }),
  remark: varchar('remark', { length: 256 }),
  tenantId: integer('tenant_id').references(() => tenants.id, { onDelete: 'cascade' }),
  ...auditColumns(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().$onUpdate(() => new Date()).notNull(),
}, (t) => [index('payment_settlement_batches_status_idx').on(t.status)]);
export type PaymentSettlementBatchRow = typeof paymentSettlementBatches.$inferSelect;
export type NewPaymentSettlementBatch = typeof paymentSettlementBatches.$inferInsert;

// ─── 分账接收方 + 分账单 ─────────────────────────────────────────────────────
export const paymentSharingReceiverTypeEnum = pgEnum('payment_sharing_receiver_type', ['merchant', 'personal']);
export const paymentSharingOrderStatusEnum = pgEnum('payment_sharing_order_status', ['pending', 'processing', 'success', 'failed']);

export const paymentSharingReceivers = pgTable('payment_sharing_receivers', {
  id: serial('id').primaryKey(),
  name: varchar('name', { length: 64 }).notNull(),
  receiverType: paymentSharingReceiverTypeEnum('receiver_type').notNull().default('merchant'),
  account: varchar('account', { length: 128 }).notNull(),
  ratioBps: integer('ratio_bps'),
  status: statusEnum('status').notNull().default('enabled'),
  remark: varchar('remark', { length: 256 }),
  tenantId: integer('tenant_id').references(() => tenants.id, { onDelete: 'cascade' }),
  ...auditColumns(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().$onUpdate(() => new Date()).notNull(),
});
export type PaymentSharingReceiverRow = typeof paymentSharingReceivers.$inferSelect;
export type NewPaymentSharingReceiver = typeof paymentSharingReceivers.$inferInsert;

export const paymentSharingOrders = pgTable('payment_sharing_orders', {
  id: serial('id').primaryKey(),
  sharingNo: varchar('sharing_no', { length: 64 }).notNull().unique(),
  orderNo: varchar('order_no', { length: 64 }).notNull(),
  receiverId: integer('receiver_id').notNull().references(() => paymentSharingReceivers.id, { onDelete: 'cascade' }),
  amount: integer('amount').notNull(),
  status: paymentSharingOrderStatusEnum('status').notNull().default('pending'),
  channelSharingNo: varchar('channel_sharing_no', { length: 128 }),
  finishedAt: timestamp('finished_at', { withTimezone: true }),
  remark: varchar('remark', { length: 256 }),
  tenantId: integer('tenant_id').references(() => tenants.id, { onDelete: 'cascade' }),
  ...auditColumns(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().$onUpdate(() => new Date()).notNull(),
}, (t) => [index('payment_sharing_orders_order_no_idx').on(t.orderNo), index('payment_sharing_orders_receiver_idx').on(t.receiverId)]);
export type PaymentSharingOrderRow = typeof paymentSharingOrders.$inferSelect;
export type NewPaymentSharingOrder = typeof paymentSharingOrders.$inferInsert;

export const paymentSharingReceiversRelations = relations(paymentSharingReceivers, ({ many }) => ({
  sharingOrders: many(paymentSharingOrders),
}));
export const paymentSharingOrdersRelations = relations(paymentSharingOrders, ({ one }) => ({
  receiver: one(paymentSharingReceivers, { fields: [paymentSharingOrders.receiverId], references: [paymentSharingReceivers.id] }),
}));

// ─── 支付链接/收款码 ─────────────────────────────────────────────────────────
export const paymentLinkStatusEnum = pgEnum('payment_link_status', ['active', 'disabled', 'expired']);
export const paymentLinks = pgTable('payment_links', {
  id: serial('id').primaryKey(),
  linkNo: varchar('link_no', { length: 64 }).notNull().unique(),
  token: varchar('token', { length: 64 }).notNull().unique(),
  subject: varchar('subject', { length: 256 }).notNull(),
  amount: integer('amount'),
  payMethod: paymentMethodEnum('pay_method'),
  bizType: varchar('biz_type', { length: 64 }).notNull(),
  maxUses: integer('max_uses'),
  usedCount: integer('used_count').notNull().default(0),
  expiredAt: timestamp('expired_at', { withTimezone: true }),
  status: paymentLinkStatusEnum('status').notNull().default('active'),
  remark: varchar('remark', { length: 256 }),
  tenantId: integer('tenant_id').references(() => tenants.id, { onDelete: 'cascade' }),
  ...auditColumns(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().$onUpdate(() => new Date()).notNull(),
});
export type PaymentLinkRow = typeof paymentLinks.$inferSelect;
export type NewPaymentLink = typeof paymentLinks.$inferInsert;

// ─── 风控限额规则 ─────────────────────────────────────────────────────────────
export const paymentRiskScopeEnum = pgEnum('payment_risk_scope', ['global', 'channel', 'bizType']);
export const paymentRiskRules = pgTable('payment_risk_rules', {
  id: serial('id').primaryKey(),
  name: varchar('name', { length: 64 }).notNull(),
  scope: paymentRiskScopeEnum('scope').notNull().default('global'),
  channel: paymentChannelEnum('channel'),
  bizType: varchar('biz_type', { length: 64 }),
  singleLimit: integer('single_limit'),
  dailyLimit: integer('daily_limit'),
  dailyCountLimit: integer('daily_count_limit'),
  blocklist: jsonb('blocklist').$type<string[]>().default([]).notNull(),
  status: statusEnum('status').notNull().default('enabled'),
  remark: varchar('remark', { length: 256 }),
  tenantId: integer('tenant_id').references(() => tenants.id, { onDelete: 'cascade' }),
  ...auditColumns(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().$onUpdate(() => new Date()).notNull(),
}, (t) => [index('payment_risk_rules_scope_idx').on(t.scope)]);
export type PaymentRiskRuleRow = typeof paymentRiskRules.$inferSelect;
export type NewPaymentRiskRule = typeof paymentRiskRules.$inferInsert;

// ─── 支付方式配置 ─────────────────────────────────────────────────────────────
export const paymentMethodConfigs = pgTable('payment_method_configs', {
  id: serial('id').primaryKey(),
  method: paymentMethodEnum('method').notNull().unique(),
  channel: paymentChannelEnum('channel').notNull(),
  label: varchar('label', { length: 64 }).notNull(),
  icon: varchar('icon', { length: 128 }),
  enabled: boolean('enabled').notNull().default(true),
  sort: integer('sort').notNull().default(0),
  tenantId: integer('tenant_id').references(() => tenants.id, { onDelete: 'cascade' }),
  ...auditColumns(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().$onUpdate(() => new Date()).notNull(),
});
export type PaymentMethodConfigRow = typeof paymentMethodConfigs.$inferSelect;
export type NewPaymentMethodConfig = typeof paymentMethodConfigs.$inferInsert;

// ─── 关系声明（Drizzle Relational Query API）──────────────────────────────────
// 声明后可使用 db.query.xxx.findMany({ with: { ... } }) 进行关联查询

export const tenantsRelations = relations(tenants, ({ one, many }) => ({
  package: one(tenantPackages, { fields: [tenants.packageId], references: [tenantPackages.id] }),
  departments: many(departments),
  positions: many(positions),
  users: many(users),
  roles: many(roles),
  dicts: many(dicts),
  userGroups: many(userGroups),
  managedFiles: many(managedFiles),
  announcements: many(announcements),
  systemConfigs: many(systemConfigs),
  workflowDefinitions: many(workflowDefinitions),
  workflowInstances: many(workflowInstances),
}));

export const tenantPackagesRelations = relations(tenantPackages, ({ many }) => ({
  packageMenus: many(tenantPackageMenus),
  tenants: many(tenants),
}));

export const tenantPackageMenusRelations = relations(tenantPackageMenus, ({ one }) => ({
  package: one(tenantPackages, { fields: [tenantPackageMenus.packageId], references: [tenantPackages.id] }),
  menu: one(menus, { fields: [tenantPackageMenus.menuId], references: [menus.id] }),
}));

export const departmentsRelations = relations(departments, ({ one, many }) => ({
  tenant: one(tenants, { fields: [departments.tenantId], references: [tenants.id] }),
  users: many(users),
  leader: one(users, { fields: [departments.leaderId], references: [users.id], relationName: 'departmentLeader' }),
  userGroups: many(userGroups),
}));

export const positionsRelations = relations(positions, ({ one, many }) => ({
  tenant: one(tenants, { fields: [positions.tenantId], references: [tenants.id] }),
  userPositions: many(userPositions),
}));

export const userGroupsRelations = relations(userGroups, ({ one, many }) => ({
  tenant: one(tenants, { fields: [userGroups.tenantId], references: [tenants.id] }),
  owner: one(users, { fields: [userGroups.ownerId], references: [users.id], relationName: 'userGroupOwner' }),
  department: one(departments, { fields: [userGroups.departmentId], references: [departments.id] }),
  members: many(userGroupMembers),
}));

export const userGroupMembersRelations = relations(userGroupMembers, ({ one }) => ({
  group: one(userGroups, { fields: [userGroupMembers.groupId], references: [userGroups.id] }),
  user: one(users, { fields: [userGroupMembers.userId], references: [users.id] }),
}));

export const usersRelations = relations(users, ({ one, many }) => ({
  department: one(departments, { fields: [users.departmentId], references: [departments.id] }),
  tenant: one(tenants, { fields: [users.tenantId], references: [tenants.id] }),
  userRoles: many(userRoles),
  userPositions: many(userPositions),
  userGroupMembers: many(userGroupMembers),
  ownedUserGroups: many(userGroups, { relationName: 'userGroupOwner' }),
  oauthAccounts: many(userOauthAccounts),
  apiTokens: many(userApiTokens),
  passwordResetTokens: many(passwordResetTokens),
  leadingDepartments: many(departments, { relationName: 'departmentLeader' }),
  userMenus: many(userMenus),
  userDeptScopes: many(userDeptScopes),
}));

export const rolesRelations = relations(roles, ({ one, many }) => ({
  tenant: one(tenants, { fields: [roles.tenantId], references: [tenants.id] }),
  roleMenus: many(roleMenus),
  userRoles: many(userRoles),
  deptScopes: many(roleDeptScopes),
}));

export const menusRelations = relations(menus, ({ many }) => ({
  roleMenus: many(roleMenus),
  userMenus: many(userMenus),
  tenantPackageMenus: many(tenantPackageMenus),
}));

export const userRolesRelations = relations(userRoles, ({ one }) => ({
  user: one(users, { fields: [userRoles.userId], references: [users.id] }),
  role: one(roles, { fields: [userRoles.roleId], references: [roles.id] }),
}));

export const userPositionsRelations = relations(userPositions, ({ one }) => ({
  user: one(users, { fields: [userPositions.userId], references: [users.id] }),
  position: one(positions, { fields: [userPositions.positionId], references: [positions.id] }),
}));

export const roleMenusRelations = relations(roleMenus, ({ one }) => ({
  role: one(roles, { fields: [roleMenus.roleId], references: [roles.id] }),
  menu: one(menus, { fields: [roleMenus.menuId], references: [menus.id] }),
}));

export const roleDeptScopesRelations = relations(roleDeptScopes, ({ one }) => ({
  role: one(roles, { fields: [roleDeptScopes.roleId], references: [roles.id] }),
  department: one(departments, { fields: [roleDeptScopes.deptId], references: [departments.id] }),
}));

export const userMenusRelations = relations(userMenus, ({ one }) => ({
  user: one(users, { fields: [userMenus.userId], references: [users.id] }),
  menu: one(menus, { fields: [userMenus.menuId], references: [menus.id] }),
}));

export const userDeptScopesRelations = relations(userDeptScopes, ({ one }) => ({
  user: one(users, { fields: [userDeptScopes.userId], references: [users.id] }),
  department: one(departments, { fields: [userDeptScopes.deptId], references: [departments.id] }),
}));

export const dictsRelations = relations(dicts, ({ one, many }) => ({
  tenant: one(tenants, { fields: [dicts.tenantId], references: [tenants.id] }),
  items: many(dictItems),
}));

export const dictItemsRelations = relations(dictItems, ({ one, many }) => ({
  dict: one(dicts, { fields: [dictItems.dictId], references: [dicts.id] }),
  parent: one(dictItems, { fields: [dictItems.parentId], references: [dictItems.id], relationName: 'parent_child' }),
  children: many(dictItems, { relationName: 'parent_child' }),
}));

export const fileStorageConfigsRelations = relations(fileStorageConfigs, ({ many }) => ({
  files: many(managedFiles),
}));

export const managedFilesRelations = relations(managedFiles, ({ one }) => ({
  storageConfig: one(fileStorageConfigs, { fields: [managedFiles.storageConfigId], references: [fileStorageConfigs.id] }),
  tenant: one(tenants, { fields: [managedFiles.tenantId], references: [tenants.id] }),
  createdByUser: one(users, { fields: [managedFiles.createdBy], references: [users.id] }),
}));

export const uploadSessionsRelations = relations(uploadSessions, ({ one, many }) => ({
  storageConfig: one(fileStorageConfigs, { fields: [uploadSessions.storageConfigId], references: [fileStorageConfigs.id] }),
  tenant: one(tenants, { fields: [uploadSessions.tenantId], references: [tenants.id] }),
  createdByUser: one(users, { fields: [uploadSessions.createdBy], references: [users.id] }),
  chunks: many(uploadChunks),
}));

export const uploadChunksRelations = relations(uploadChunks, ({ one }) => ({
  session: one(uploadSessions, { fields: [uploadChunks.uploadSessionId], references: [uploadSessions.id] }),
}));

export const cronJobsRelations = relations(cronJobs, ({ many }) => ({
  logs: many(cronJobLogs),
}));

export const cronJobLogsRelations = relations(cronJobLogs, ({ one }) => ({
  job: one(cronJobs, { fields: [cronJobLogs.jobId], references: [cronJobs.id] }),
}));

export const announcementsRelations = relations(announcements, ({ one, many }) => ({
  tenant: one(tenants, { fields: [announcements.tenantId], references: [tenants.id] }),
  reads: many(announcementReads),
  recipients: many(announcementRecipients),
  attachments: many(businessFiles),
}));

export const announcementReadsRelations = relations(announcementReads, ({ one }) => ({
  announcement: one(announcements, { fields: [announcementReads.announcementId], references: [announcements.id] }),
}));

export const announcementRecipientsRelations = relations(announcementRecipients, ({ one }) => ({
  announcement: one(announcements, { fields: [announcementRecipients.announcementId], references: [announcements.id] }),
}));

export const businessFilesRelations = relations(businessFiles, ({ one }) => ({
  file: one(managedFiles, { fields: [businessFiles.fileId], references: [managedFiles.id] }),
  tenant: one(tenants, { fields: [businessFiles.tenantId], references: [tenants.id] }),
}));

export const userOauthAccountsRelations = relations(userOauthAccounts, ({ one }) => ({
  user: one(users, { fields: [userOauthAccounts.userId], references: [users.id] }),
}));

export const userApiTokensRelations = relations(userApiTokens, ({ one }) => ({
  user: one(users, { fields: [userApiTokens.userId], references: [users.id] }),
}));

export const passwordResetTokensRelations = relations(passwordResetTokens, ({ one }) => ({
  user: one(users, { fields: [passwordResetTokens.userId], references: [users.id] }),
}));

export const dbBackupsRelations = relations(dbBackups, ({ one }) => ({
  file: one(managedFiles, { fields: [dbBackups.fileId], references: [managedFiles.id] }),
  createdByUser: one(users, { fields: [dbBackups.createdBy], references: [users.id] }),
}));

export const workflowCategoriesRelations = relations(workflowCategories, ({ one, many }) => ({
  tenant: one(tenants, { fields: [workflowCategories.tenantId], references: [tenants.id] }),
  definitions: many(workflowDefinitions),
  forms: many(workflowForms),
}));

export const workflowFormsRelations = relations(workflowForms, ({ one, many }) => ({
  tenant: one(tenants, { fields: [workflowForms.tenantId], references: [tenants.id] }),
  createdByUser: one(users, { fields: [workflowForms.createdBy], references: [users.id] }),
  category: one(workflowCategories, { fields: [workflowForms.categoryId], references: [workflowCategories.id] }),
  definitions: many(workflowDefinitions),
}));

export const workflowDefinitionsRelations = relations(workflowDefinitions, ({ one, many }) => ({
  tenant: one(tenants, { fields: [workflowDefinitions.tenantId], references: [tenants.id] }),
  createdByUser: one(users, { fields: [workflowDefinitions.createdBy], references: [users.id] }),
  category: one(workflowCategories, { fields: [workflowDefinitions.categoryId], references: [workflowCategories.id] }),
  form: one(workflowForms, { fields: [workflowDefinitions.formId], references: [workflowForms.id] }),
  instances: many(workflowInstances),
  versions: many(workflowDefinitionVersions),
  automations: many(workflowAutomations),
}));

export const workflowAutomationsRelations = relations(workflowAutomations, ({ one }) => ({
  definition: one(workflowDefinitions, { fields: [workflowAutomations.definitionId], references: [workflowDefinitions.id] }),
  tenant: one(tenants, { fields: [workflowAutomations.tenantId], references: [tenants.id] }),
}));

export const workflowDefinitionVersionsRelations = relations(workflowDefinitionVersions, ({ one }) => ({
  definition: one(workflowDefinitions, { fields: [workflowDefinitionVersions.definitionId], references: [workflowDefinitions.id] }),
  publishedByUser: one(users, { fields: [workflowDefinitionVersions.publishedBy], references: [users.id] }),
  tenant: one(tenants, { fields: [workflowDefinitionVersions.tenantId], references: [tenants.id] }),
}));

export const workflowCommentsRelations = relations(workflowComments, ({ one }) => ({
  instance: one(workflowInstances, { fields: [workflowComments.instanceId], references: [workflowInstances.id] }),
  task: one(workflowTasks, { fields: [workflowComments.taskId], references: [workflowTasks.id] }),
  user: one(users, { fields: [workflowComments.userId], references: [users.id] }),
}));

export const workflowQuickPhrasesRelations = relations(workflowQuickPhrases, ({ one }) => ({
  user: one(users, { fields: [workflowQuickPhrases.userId], references: [users.id] }),
}));

export const workflowDelegationsRelations = relations(workflowDelegations, ({ one }) => ({
  principal: one(users, { fields: [workflowDelegations.principalId], references: [users.id], relationName: 'delegationPrincipal' }),
  delegate: one(users, { fields: [workflowDelegations.delegateId], references: [users.id], relationName: 'delegationDelegate' }),
  definition: one(workflowDefinitions, { fields: [workflowDelegations.definitionId], references: [workflowDefinitions.id] }),
  tenant: one(tenants, { fields: [workflowDelegations.tenantId], references: [tenants.id] }),
}));

export const workflowTaskConsultsRelations = relations(workflowTaskConsults, ({ one }) => ({
  task: one(workflowTasks, { fields: [workflowTaskConsults.taskId], references: [workflowTasks.id] }),
  instance: one(workflowInstances, { fields: [workflowTaskConsults.instanceId], references: [workflowInstances.id] }),
  inviter: one(users, { fields: [workflowTaskConsults.inviterId], references: [users.id], relationName: 'consultInviter' }),
  consultee: one(users, { fields: [workflowTaskConsults.consulteeId], references: [users.id], relationName: 'consultConsultee' }),
}));

export const workflowInstancesRelations = relations(workflowInstances, ({ one, many }) => ({
  definition: one(workflowDefinitions, { fields: [workflowInstances.definitionId], references: [workflowDefinitions.id] }),
  initiator: one(users, { fields: [workflowInstances.initiatorId], references: [users.id] }),
  tenant: one(tenants, { fields: [workflowInstances.tenantId], references: [tenants.id] }),
  tasks: many(workflowTasks),
}));

export const workflowTasksRelations = relations(workflowTasks, ({ one, many }) => ({
  instance: one(workflowInstances, { fields: [workflowTasks.instanceId], references: [workflowInstances.id] }),
  assignee: one(users, { fields: [workflowTasks.assigneeId], references: [users.id] }),
  urges: many(workflowTaskUrges),
}));

export const workflowTaskUrgesRelations = relations(workflowTaskUrges, ({ one }) => ({
  task: one(workflowTasks, { fields: [workflowTaskUrges.taskId], references: [workflowTasks.id] }),
  instance: one(workflowInstances, { fields: [workflowTaskUrges.instanceId], references: [workflowInstances.id] }),
  urger: one(users, { fields: [workflowTaskUrges.urgerId], references: [users.id] }),
}));

export const chatConversationsRelations = relations(chatConversations, ({ one, many }) => ({
  createdByUser: one(users, { fields: [chatConversations.createdBy], references: [users.id] }),
  tenant: one(tenants, { fields: [chatConversations.tenantId], references: [tenants.id] }),
  members: many(chatConversationMembers),
  messages: many(chatMessages),
}));

export const chatConversationMembersRelations = relations(chatConversationMembers, ({ one }) => ({
  conversation: one(chatConversations, { fields: [chatConversationMembers.conversationId], references: [chatConversations.id] }),
  user: one(users, { fields: [chatConversationMembers.userId], references: [users.id] }),
}));

export const chatMessagesRelations = relations(chatMessages, ({ one, many }) => ({
  conversation: one(chatConversations, { fields: [chatMessages.conversationId], references: [chatConversations.id] }),
  sender: one(users, { fields: [chatMessages.senderId], references: [users.id] }),
  reactions: many(chatMessageReactions),
}));

export const chatMessageReactionsRelations = relations(chatMessageReactions, ({ one }) => ({
  message: one(chatMessages, { fields: [chatMessageReactions.messageId], references: [chatMessages.id] }),
  user: one(users, { fields: [chatMessageReactions.userId], references: [users.id] }),
}));

export const chatWebhooksRelations = relations(chatWebhooks, ({ one }) => ({
  conversation: one(chatConversations, { fields: [chatWebhooks.conversationId], references: [chatConversations.id] }),
  tenant: one(tenants, { fields: [chatWebhooks.tenantId], references: [tenants.id] }),
}));

// ─── 通知模块 relations ─────────────────────────────────────────────────────
export const emailTemplatesRelations = relations(emailTemplates, ({ one, many }) => ({
  tenant: one(tenants, { fields: [emailTemplates.tenantId], references: [tenants.id] }),
  logs: many(emailSendLogs),
}));

export const emailSendLogsRelations = relations(emailSendLogs, ({ one }) => ({
  template: one(emailTemplates, { fields: [emailSendLogs.templateId], references: [emailTemplates.id] }),
  user: one(users, { fields: [emailSendLogs.userId], references: [users.id] }),
  tenant: one(tenants, { fields: [emailSendLogs.tenantId], references: [tenants.id] }),
}));

export const smsConfigsRelations = relations(smsConfigs, ({ one, many }) => ({
  tenant: one(tenants, { fields: [smsConfigs.tenantId], references: [tenants.id] }),
  logs: many(smsSendLogs),
}));

export const smsTemplatesRelations = relations(smsTemplates, ({ one, many }) => ({
  tenant: one(tenants, { fields: [smsTemplates.tenantId], references: [tenants.id] }),
  logs: many(smsSendLogs),
}));

export const smsSendLogsRelations = relations(smsSendLogs, ({ one }) => ({
  config: one(smsConfigs, { fields: [smsSendLogs.configId], references: [smsConfigs.id] }),
  template: one(smsTemplates, { fields: [smsSendLogs.templateId], references: [smsTemplates.id] }),
  user: one(users, { fields: [smsSendLogs.userId], references: [users.id] }),
  tenant: one(tenants, { fields: [smsSendLogs.tenantId], references: [tenants.id] }),
}));

export const inAppTemplatesRelations = relations(inAppTemplates, ({ one, many }) => ({
  tenant: one(tenants, { fields: [inAppTemplates.tenantId], references: [tenants.id] }),
  messages: many(inAppMessages),
}));

export const inAppMessagesRelations = relations(inAppMessages, ({ one }) => ({
  template: one(inAppTemplates, { fields: [inAppMessages.templateId], references: [inAppTemplates.id] }),
  user: one(users, { fields: [inAppMessages.userId], references: [users.id], relationName: 'inAppMessageUser' }),
  sender: one(users, { fields: [inAppMessages.senderId], references: [users.id], relationName: 'inAppMessageSender' }),
  tenant: one(tenants, { fields: [inAppMessages.tenantId], references: [tenants.id] }),
}));

// ─── AI 对话模块 ──────────────────────────────────────────────────────────────

export const aiProviderEnum = pgEnum('ai_provider', ['openai_compatible', 'anthropic', 'gemini', 'baidu']);
export const aiMessageRoleEnum = pgEnum('ai_message_role', ['system', 'user', 'assistant']);
export const aiFeedbackStatusEnum = pgEnum('ai_feedback_status', ['pending', 'resolved', 'ignored']);

export const aiProviderConfigs = pgTable('ai_provider_configs', {
  id: serial('id').primaryKey(),
  name: varchar('name', { length: 100 }).notNull(),
  provider: aiProviderEnum('provider').notNull().default('openai_compatible'),
  baseUrl: varchar('base_url', { length: 500 }).notNull(),
  apiKey: varchar('api_key', { length: 1000 }).notNull(),
  model: varchar('model', { length: 100 }).notNull(),
  systemPrompt: text('system_prompt'),
  maxTokens: integer('max_tokens').notNull().default(4096),
  temperature: varchar('temperature', { length: 10 }).notNull().default('0.7'),
  isDefault: boolean('is_default').notNull().default(false),
  isEnabled: boolean('is_enabled').notNull().default(true),
  ...auditColumns(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().$onUpdate(() => new Date()).notNull(),
});

export type AiProviderConfigRow = typeof aiProviderConfigs.$inferSelect;
export type NewAiProviderConfig = typeof aiProviderConfigs.$inferInsert;

export const aiConversations = pgTable('ai_conversations', {
  id: serial('id').primaryKey(),
  userId: integer('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  tenantId: integer('tenant_id').references(() => tenants.id, { onDelete: 'cascade' }),
  title: varchar('title', { length: 200 }).notNull().default('新对话'),
  providerSnapshot: jsonb('provider_snapshot').$type<{ provider: string; model: string; configId?: number }>(),
  isArchived: boolean('is_archived').notNull().default(false),
  isPinned: boolean('is_pinned').notNull().default(false),
  systemPromptOverride: text('system_prompt_override'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().$onUpdate(() => new Date()).notNull(),
});

export type AiConversationRow = typeof aiConversations.$inferSelect;
export type NewAiConversation = typeof aiConversations.$inferInsert;

export const aiMessages = pgTable('ai_messages', {
  id: serial('id').primaryKey(),
  conversationId: integer('conversation_id').notNull().references(() => aiConversations.id, { onDelete: 'cascade' }),
  role: aiMessageRoleEnum('role').notNull(),
  content: text('content').notNull(),
  /** 该条 assistant 消息生成时所用的模型（user 消息为 null） */
  model: varchar('model', { length: 100 }),
  tokensInput: integer('tokens_input').notNull().default(0),
  tokensOutput: integer('tokens_output').notNull().default(0),
  /** 用户反馈：1 = 👍 点赞，-1 = 👎 点踩，null = 未反馈 */
  feedback: integer('feedback'),
  /** 点踩原因（如 不准确/不相关/有害/其他） */
  feedbackReason: varchar('feedback_reason', { length: 200 }),
  /** 反馈处理状态：pending 待处理 / resolved 已处理 / ignored 已忽略 */
  feedbackStatus: aiFeedbackStatusEnum('feedback_status'),
  /** 管理员处理备注 */
  feedbackRemark: varchar('feedback_remark', { length: 500 }),
  /** 反馈处理时间 */
  feedbackHandledAt: timestamp('feedback_handled_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export type AiMessageRow = typeof aiMessages.$inferSelect;
export type NewAiMessage = typeof aiMessages.$inferInsert;

export const userAiConfigs = pgTable('user_ai_configs', {
  id: serial('id').primaryKey(),
  userId: integer('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  name: varchar('name', { length: 100 }),
  provider: aiProviderEnum('provider').notNull().default('openai_compatible'),
  baseUrl: varchar('base_url', { length: 500 }),
  apiKey: varchar('api_key', { length: 1000 }),
  model: varchar('model', { length: 100 }),
  temperature: varchar('temperature', { length: 10 }),
  maxTokens: integer('max_tokens'),
  systemPrompt: text('system_prompt'),
  isEnabled: boolean('is_enabled').notNull().default(true),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().$onUpdate(() => new Date()).notNull(),
});

export type UserAiConfigRow = typeof userAiConfigs.$inferSelect;
export type NewUserAiConfig = typeof userAiConfigs.$inferInsert;

export const aiPromptScopeEnum = pgEnum('ai_prompt_scope', ['system', 'user']);

export const aiPromptTemplates = pgTable('ai_prompt_templates', {
  id: serial('id').primaryKey(),
  name: varchar('name', { length: 100 }).notNull(),
  content: text('content').notNull(),
  description: varchar('description', { length: 300 }),
  category: varchar('category', { length: 50 }),
  scope: aiPromptScopeEnum('scope').notNull().default('system'),
  userId: integer('user_id').references(() => users.id, { onDelete: 'cascade' }),
  isBuiltin: boolean('is_builtin').notNull().default(false),
  sort: integer('sort').notNull().default(0),
  isEnabled: boolean('is_enabled').notNull().default(true),
  ...auditColumns(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().$onUpdate(() => new Date()).notNull(),
});

export type AiPromptTemplateRow = typeof aiPromptTemplates.$inferSelect;
export type NewAiPromptTemplate = typeof aiPromptTemplates.$inferInsert;

export const aiProviderConfigsRelations = relations(aiProviderConfigs, ({ one }) => ({
  createdByUser: one(users, { fields: [aiProviderConfigs.createdBy], references: [users.id] }),
}));

export const aiConversationsRelations = relations(aiConversations, ({ one, many }) => ({
  user: one(users, { fields: [aiConversations.userId], references: [users.id] }),
  tenant: one(tenants, { fields: [aiConversations.tenantId], references: [tenants.id] }),
  messages: many(aiMessages),
}));

export const aiMessagesRelations = relations(aiMessages, ({ one }) => ({
  conversation: one(aiConversations, { fields: [aiMessages.conversationId], references: [aiConversations.id] }),
}));

export const userAiConfigsRelations = relations(userAiConfigs, ({ one }) => ({
  user: one(users, { fields: [userAiConfigs.userId], references: [users.id] }),
}));

export const aiPromptTemplatesRelations = relations(aiPromptTemplates, ({ one }) => ({
  user: one(users, { fields: [aiPromptTemplates.userId], references: [users.id] }),
  createdByUser: one(users, { fields: [aiPromptTemplates.createdBy], references: [users.id] }),
}));

// ─── 数据脱敏配置 ─────────────────────────────────────────────────────────────

export const dataMaskConfigs = pgTable('data_mask_configs', {
  id:              serial('id').primaryKey(),
  /** 实体名称，如 user / tenant */
  entity:          varchar('entity', { length: 64 }).notNull(),
  /** 字段名称，如 phone / email */
  field:           varchar('field', { length: 64 }).notNull(),
  /** 字段中文标签，供前端展示 */
  label:           varchar('label', { length: 64 }).notNull(),
  maskType:        maskTypeEnum('mask_type').notNull(),
  /**
   * 自定义规则（maskType='custom' 时使用）
   * 格式：{ prefixKeep: number; suffixKeep: number; maskChar?: string }
   */
  customRule:      jsonb('custom_rule'),
  /**
   * 豁免角色 code 列表（这些角色可看原始值）
   * 格式：string[]，如 ["super_admin", "hr_admin"]
   */
  exemptRoleCodes: jsonb('exempt_role_codes').notNull().default([]),
  enabled:         boolean('enabled').notNull().default(true),
  remark:          varchar('remark', { length: 256 }),
  ...auditColumns(),
  createdAt:       timestamp('created_at').defaultNow().notNull(),
  updatedAt:       timestamp('updated_at').defaultNow().$onUpdate(() => new Date()).notNull(),
}, (t) => [unique('data_mask_entity_field_unique').on(t.entity, t.field)]);

export type DataMaskConfigRow = typeof dataMaskConfigs.$inferSelect;
export type NewDataMaskConfig = typeof dataMaskConfigs.$inferInsert;

// ─── OAuth2 服务端 ─────────────────────────────────────────────────────────

/**
 * OAuth2 应用（客户端）注册表
 * 管理接入本系统的第三方应用（ClientID / Secret / 回调URL / 权限范围）
 */
export const oauth2Clients = pgTable('oauth2_clients', {
  id: serial('id').primaryKey(),
  /** UUID，即 client_id */
  clientId: varchar('client_id', { length: 64 }).notNull().unique(),
  /** client_secret sha256 哈希值（机密客户端），公开客户端为 null */
  clientSecretHash: varchar('client_secret_hash', { length: 128 }),
  /** secret 前缀，用于列表页展示（前 8 位 + ...）*/
  clientSecretPrefix: varchar('client_secret_prefix', { length: 20 }),
  name: varchar('name', { length: 100 }).notNull(),
  description: text('description'),
  logoUrl: varchar('logo_url', { length: 500 }),
  /** 允许的回调 URL 列表 */
  redirectUris: text('redirect_uris').array().notNull().default([]),
  /** 允许申请的 scope 子集，如 ['openid','profile','email'] */
  allowedScopes: text('allowed_scopes').array().notNull().default([]),
  /** 允许的授权流程，如 ['authorization_code','client_credentials'] */
  grantTypes: text('grant_types').array().notNull().default([]),
  /** 是否为公开客户端（无 secret，必须使用 PKCE）*/
  isPublic: boolean('is_public').notNull().default(false),
  status: statusEnum('status').notNull().default('enabled'),
  /** 应用归属用户 */
  ownerId: integer('owner_id').references((): AnyPgColumn => users.id, { onDelete: 'set null' }),
  ...auditColumns(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().$onUpdate(() => new Date()).notNull(),
});

export type OAuth2ClientRow = typeof oauth2Clients.$inferSelect;
export type NewOAuth2Client = typeof oauth2Clients.$inferInsert;

/**
 * OAuth2 授权码表
 * 短期有效（10 分钟），用于 authorization_code 流程
 */
export const oauth2AuthorizationCodes = pgTable('oauth2_authorization_codes', {
  id: serial('id').primaryKey(),
  /** 授权码原始值（带前缀 oc_ 的随机串，存明文，单次使用后标记 used）*/
  code: varchar('code', { length: 128 }).notNull().unique(),
  clientId: varchar('client_id', { length: 64 }).notNull(),
  userId: integer('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  redirectUri: text('redirect_uri').notNull(),
  scopes: text('scopes').array().notNull().default([]),
  /** PKCE code_challenge */
  codeChallenge: varchar('code_challenge', { length: 256 }),
  /** S256 | plain */
  codeChallengeMethod: varchar('code_challenge_method', { length: 10 }),
  expiresAt: timestamp('expires_at').notNull(),
  used: boolean('used').notNull().default(false),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export type OAuth2AuthorizationCodeRow = typeof oauth2AuthorizationCodes.$inferSelect;
export type NewOAuth2AuthorizationCode = typeof oauth2AuthorizationCodes.$inferInsert;

/**
 * OAuth2 令牌表（access_token + refresh_token 共用）
 */
export const oauth2Tokens = pgTable('oauth2_tokens', {
  id: serial('id').primaryKey(),
  /** access | refresh */
  tokenType: varchar('token_type', { length: 20 }).notNull(),
  /** sha256 哈希后存储 */
  tokenHash: varchar('token_hash', { length: 128 }).notNull().unique(),
  /** token 前缀（oa_ / or_），用于列表页展示 */
  tokenPrefix: varchar('token_prefix', { length: 20 }),
  clientId: varchar('client_id', { length: 64 }).notNull(),
  /** client_credentials 流程时为 null */
  userId: integer('user_id').references(() => users.id, { onDelete: 'cascade' }),
  scopes: text('scopes').array().notNull().default([]),
  expiresAt: timestamp('expires_at'),
  revoked: boolean('revoked').notNull().default(false),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export type OAuth2TokenRow = typeof oauth2Tokens.$inferSelect;
export type NewOAuth2Token = typeof oauth2Tokens.$inferInsert;

/**
 * OAuth2 用户授权记录表
 * 记录用户对某应用授权的 scope 集合，避免重复弹同意页
 */
export const oauth2UserGrants = pgTable('oauth2_user_grants', {
  id: serial('id').primaryKey(),
  userId: integer('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  clientId: varchar('client_id', { length: 64 }).notNull(),
  scopes: text('scopes').array().notNull().default([]),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().$onUpdate(() => new Date()).notNull(),
}, (t) => [unique('oauth2_user_grants_user_client_unique').on(t.userId, t.clientId)]);

export type OAuth2UserGrantRow = typeof oauth2UserGrants.$inferSelect;
export type NewOAuth2UserGrant = typeof oauth2UserGrants.$inferInsert;

export const oauth2ClientsRelations = relations(oauth2Clients, ({ one }) => ({
  owner: one(users, { fields: [oauth2Clients.ownerId], references: [users.id] }),
}));

export const oauth2AuthorizationCodesRelations = relations(oauth2AuthorizationCodes, ({ one }) => ({
  user: one(users, { fields: [oauth2AuthorizationCodes.userId], references: [users.id] }),
}));

export const oauth2TokensRelations = relations(oauth2Tokens, ({ one }) => ({
  user: one(users, { fields: [oauth2Tokens.userId], references: [users.id] }),
}));

export const oauth2UserGrantsRelations = relations(oauth2UserGrants, ({ one }) => ({
  user: one(users, { fields: [oauth2UserGrants.userId], references: [users.id] }),
}));

// ─── 维护模式（单例，id 固定为 1）───────────────────────────────────────────
export const maintenanceMode = pgTable('maintenance_mode', {
  id: serial('id').primaryKey(),
  enabled: boolean('enabled').notNull().default(false),
  message: varchar('message', { length: 512 }).notNull().default('系统维护中，请稍后重试'),
  estimatedEndAt: timestamp('estimated_end_at'),
  startedAt: timestamp('started_at'),
  startedByName: varchar('started_by_name', { length: 64 }),
  updatedAt: timestamp('updated_at').defaultNow().$onUpdate(() => new Date()).notNull(),
});

export type MaintenanceModeRow = typeof maintenanceMode.$inferSelect;
export type NewMaintenanceMode = typeof maintenanceMode.$inferInsert;

// ─── 维护记录（每次「开启→关闭」为一条维护时段）─────────────────────────────
export const maintenanceLogs = pgTable('maintenance_logs', {
  id: serial('id').primaryKey(),
  message: varchar('message', { length: 512 }).notNull(),
  estimatedEndAt: timestamp('estimated_end_at'),
  startedAt: timestamp('started_at').notNull(),
  startedById: integer('started_by_id'),
  startedByName: varchar('started_by_name', { length: 64 }),
  endedAt: timestamp('ended_at'),
  endedById: integer('ended_by_id'),
  endedByName: varchar('ended_by_name', { length: 64 }),
  durationSeconds: integer('duration_seconds'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (t) => [
  index('maintenance_logs_started_at_idx').on(t.startedAt),
  index('maintenance_logs_ended_at_idx').on(t.endedAt),
]);

export type MaintenanceLogRow = typeof maintenanceLogs.$inferSelect;
export type NewMaintenanceLog = typeof maintenanceLogs.$inferInsert;

// ─── 终端录屏表 ─────────────────────────────────────────────────────────
/** 终端 session 录屏事件：[timeOffset(秒), type('o'|’i'), data] */
export type RecordingEvent = [number, 'o' | 'i', string];

export const terminalRecordings = pgTable('terminal_recordings', {
  id: serial('id').primaryKey(),
  title: varchar('title', { length: 256 }).notNull().default(''),
  userId: integer('user_id').references(() => users.id, { onDelete: 'cascade' }).notNull(),
  tenantId: integer('tenant_id').references(() => tenants.id, { onDelete: 'cascade' }),
  shell: varchar('shell', { length: 64 }),
  cols: integer('cols').notNull().default(80),
  rows: integer('rows').notNull().default(24),
  duration: real('duration').notNull().default(0), // 秒
  events: jsonb('events').$type<RecordingEvent[]>().notNull().default([]),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().$onUpdate(() => new Date()).notNull(),
});

export type TerminalRecordingRow = typeof terminalRecordings.$inferSelect;
export type NewTerminalRecording = typeof terminalRecordings.$inferInsert;

// ─── SSH 连接配置表 ────────────────────────────────────────────────────────────

export const sshAuthTypeEnum = pgEnum('ssh_auth_type', ['password', 'key_path', 'key_content', 'agent']);

export const sshProfiles = pgTable('ssh_profiles', {
  id: serial('id').primaryKey(),
  userId: integer('user_id').references(() => users.id, { onDelete: 'cascade' }).notNull(),
  name: varchar('name', { length: 128 }).notNull(),
  host: varchar('host', { length: 255 }).notNull(),
  port: integer('port').notNull().default(22),
  username: varchar('username', { length: 128 }).notNull(),
  authType: sshAuthTypeEnum('auth_type').notNull().default('password'),
  /** 加密存储的密码（authType=password 时使用） */
  passwordEncrypted: text('password_encrypted'),
  /** 服务端私钥文件路径（authType=key_path 时使用，如 ~/.ssh/id_rsa） */
  keyPath: text('key_path'),
  /** 加密存储的私钥内容（authType=key_content 时使用） */
  keyContentEncrypted: text('key_content_encrypted'),
  /** 加密存储的私钥口令（authType=key_path|key_content 时可选） */
  keyPassphraseEncrypted: text('key_passphrase_encrypted'),
  /** 连接后自动设置的环境变量 */
  envVars: jsonb('env_vars').$type<Record<string, string>>().notNull().default({}),
  /** 所属分组名称（用于在 SSH 连接面板中按分组折叠展示，null 表示未分组） */
  groupName: varchar('group_name', { length: 128 }),
  /** 标签数组（用于筛选与标注，如 prod / staging / db） */
  tags: jsonb('tags').$type<string[]>().notNull().default([]),
  /** 列表排序权重（数字越小越靠前） */
  orderNum: integer('order_num').notNull().default(0),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().$onUpdate(() => new Date()).notNull(),
});

export type SshProfileRow = typeof sshProfiles.$inferSelect;
export type NewSshProfile = typeof sshProfiles.$inferInsert;

// ═══════════════════════════════════════════════════════════════════════════
// 会员中心（Member Center）—— 面向 C 端的前台用户体系，与后台管理员 users 完全隔离
// ═══════════════════════════════════════════════════════════════════════════

// ─── 会员相关枚举（三端同步：pgEnum / TS union / Zod enum）───────────────────
export const memberStatusEnum = pgEnum('member_status', ['active', 'inactive', 'banned']);
export const pointTxTypeEnum = pgEnum('point_tx_type', ['earn', 'redeem', 'expire', 'adjust', 'refund']);
export const walletTxTypeEnum = pgEnum('wallet_tx_type', ['recharge', 'consume', 'refund', 'adjust']);
export const couponTypeEnum = pgEnum('coupon_type', ['amount', 'percent']);
export const couponValidTypeEnum = pgEnum('coupon_valid_type', ['fixed', 'relative']);
export const couponTemplateStatusEnum = pgEnum('coupon_template_status', ['draft', 'active', 'paused', 'expired']);
export const memberCouponStatusEnum = pgEnum('member_coupon_status', ['unused', 'used', 'expired', 'frozen']);

// ─── 会员等级配置表 ───────────────────────────────────────────────────────────
export const memberLevels = pgTable('member_levels', {
  id: serial('id').primaryKey(),
  name: varchar('name', { length: 32 }).notNull(),
  /** 等级序号（0=最低，数字越大等级越高，全局唯一）*/
  level: integer('level').notNull().default(0),
  /** 升至本等级所需的成长值门槛 */
  growthThreshold: integer('growth_threshold').notNull().default(0),
  /** 等级折扣（百分比，100=原价，95=95折）*/
  discount: integer('discount').notNull().default(100),
  icon: varchar('icon', { length: 256 }),
  /** 等级权益描述列表 */
  benefits: jsonb('benefits').$type<string[]>().notNull().default([]),
  description: varchar('description', { length: 256 }),
  sort: integer('sort').notNull().default(0),
  status: statusEnum('status').notNull().default('enabled'),
  ...auditColumns(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().$onUpdate(() => new Date()).notNull(),
}, (t) => [unique('member_levels_level_unique').on(t.level)]);

export type MemberLevelRow = typeof memberLevels.$inferSelect;
export type NewMemberLevel = typeof memberLevels.$inferInsert;

// ─── 会员主表（前台用户，全局唯一，保留 tenantId 备用，默认 null）──────────────
export const members = pgTable('members', {
  id: serial('id').primaryKey(),
  /** 登录用户名（可空，全局唯一）*/
  username: varchar('username', { length: 32 }),
  /** 手机号（可空，全局唯一，国内主登录凭证）*/
  phone: varchar('phone', { length: 20 }),
  /** 邮箱（可空，全局唯一）*/
  email: varchar('email', { length: 128 }),
  /** bcrypt 密码哈希（纯验证码注册时可为空）*/
  password: varchar('password', { length: 128 }),
  nickname: varchar('nickname', { length: 32 }).notNull(),
  avatar: varchar('avatar', { length: 256 }),
  gender: varchar('gender', { length: 20 }),
  birthday: varchar('birthday', { length: 20 }),
  status: memberStatusEnum('status').notNull().default('active'),
  levelId: integer('level_id').references((): AnyPgColumn => memberLevels.id, { onDelete: 'set null' }),
  /** 成长值（决定会员等级）*/
  growthValue: integer('growth_value').notNull().default(0),
  experience: integer('experience').notNull().default(0),
  /** 注册来源：web / h5 / app / admin */
  registerSource: varchar('register_source', { length: 32 }).notNull().default('web'),
  registerIp: varchar('register_ip', { length: 64 }),
  lastLoginAt: timestamp('last_login_at', { withTimezone: true }),
  lastLoginIp: varchar('last_login_ip', { length: 64 }),
  remark: varchar('remark', { length: 256 }),
  tenantId: integer('tenant_id').references(() => tenants.id, { onDelete: 'cascade' }),
  ...auditColumns(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().$onUpdate(() => new Date()).notNull(),
}, (t) => [
  uniqueIndex('members_phone_unique').on(t.phone),
  uniqueIndex('members_email_unique').on(t.email),
  uniqueIndex('members_username_unique').on(t.username),
  index('members_status_idx').on(t.status),
]);

export type MemberRow = typeof members.$inferSelect;
export type NewMember = typeof members.$inferInsert;

// ─── 会员积分账户表（一会员一账户，version 乐观锁）──────────────────────────────
export const memberPointAccounts = pgTable('member_point_accounts', {
  id: serial('id').primaryKey(),
  memberId: integer('member_id').notNull().references(() => members.id, { onDelete: 'cascade' }),
  /** 当前可用积分 */
  balance: integer('balance').notNull().default(0),
  /** 冻结积分 */
  frozen: integer('frozen').notNull().default(0),
  /** 累计获得积分 */
  totalEarned: integer('total_earned').notNull().default(0),
  /** 累计消耗积分 */
  totalSpent: integer('total_spent').notNull().default(0),
  /** 乐观锁版本号 */
  version: integer('version').notNull().default(0),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().$onUpdate(() => new Date()).notNull(),
}, (t) => [uniqueIndex('member_point_accounts_member_unique').on(t.memberId)]);

export type MemberPointAccountRow = typeof memberPointAccounts.$inferSelect;
export type NewMemberPointAccount = typeof memberPointAccounts.$inferInsert;

// ─── 会员积分流水表（追加型）──────────────────────────────────────────────────
export const memberPointTransactions = pgTable('member_point_transactions', {
  id: serial('id').primaryKey(),
  memberId: integer('member_id').notNull().references(() => members.id, { onDelete: 'cascade' }),
  type: pointTxTypeEnum('type').notNull(),
  /** 积分变动量（正=增加，负=减少）*/
  amount: integer('amount').notNull(),
  /** 变动后余额 */
  balanceAfter: integer('balance_after').notNull(),
  /** 业务类型：signin / purchase / redeem / admin_adjust / refund ... */
  bizType: varchar('biz_type', { length: 64 }),
  bizId: varchar('biz_id', { length: 128 }),
  remark: varchar('remark', { length: 256 }),
  /** 后台操作人（管理员手动调整时记录）*/
  operatorId: integer('operator_id').references(() => users.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (t) => [
  index('member_point_tx_member_idx').on(t.memberId),
  index('member_point_tx_biz_idx').on(t.bizType, t.bizId),
]);

export type MemberPointTransactionRow = typeof memberPointTransactions.$inferSelect;
export type NewMemberPointTransaction = typeof memberPointTransactions.$inferInsert;

// ─── 会员钱包账户表（余额单位：分，version 乐观锁）─────────────────────────────
export const memberWallets = pgTable('member_wallets', {
  id: serial('id').primaryKey(),
  memberId: integer('member_id').notNull().references(() => members.id, { onDelete: 'cascade' }),
  /** 余额（分）*/
  balance: integer('balance').notNull().default(0),
  /** 冻结金额（分）*/
  frozen: integer('frozen').notNull().default(0),
  /** 累计充值（分）*/
  totalRecharge: integer('total_recharge').notNull().default(0),
  /** 累计消费（分）*/
  totalConsume: integer('total_consume').notNull().default(0),
  /** 乐观锁版本号 */
  version: integer('version').notNull().default(0),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().$onUpdate(() => new Date()).notNull(),
}, (t) => [uniqueIndex('member_wallets_member_unique').on(t.memberId)]);

export type MemberWalletRow = typeof memberWallets.$inferSelect;
export type NewMemberWallet = typeof memberWallets.$inferInsert;

// ─── 会员钱包流水表（追加型）──────────────────────────────────────────────────
export const memberWalletTransactions = pgTable('member_wallet_transactions', {
  id: serial('id').primaryKey(),
  memberId: integer('member_id').notNull().references(() => members.id, { onDelete: 'cascade' }),
  type: walletTxTypeEnum('type').notNull(),
  /** 金额变动（分，正=增加，负=减少）*/
  amount: integer('amount').notNull(),
  /** 变动后余额（分）*/
  balanceAfter: integer('balance_after').notNull(),
  bizType: varchar('biz_type', { length: 64 }),
  bizId: varchar('biz_id', { length: 128 }),
  /** 充值时关联的支付订单 */
  paymentOrderId: integer('payment_order_id').references(() => paymentOrders.id, { onDelete: 'set null' }),
  remark: varchar('remark', { length: 256 }),
  operatorId: integer('operator_id').references(() => users.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (t) => [
  index('member_wallet_tx_member_idx').on(t.memberId),
  index('member_wallet_tx_biz_idx').on(t.bizType, t.bizId),
]);

export type MemberWalletTransactionRow = typeof memberWalletTransactions.$inferSelect;
export type NewMemberWalletTransaction = typeof memberWalletTransactions.$inferInsert;

// ─── 优惠券模板表 ─────────────────────────────────────────────────────────────
export const coupons = pgTable('coupons', {
  id: serial('id').primaryKey(),
  name: varchar('name', { length: 64 }).notNull(),
  /** amount=满减券, percent=折扣券 */
  type: couponTypeEnum('type').notNull(),
  /** 面值：amount 型为减免金额（分）；percent 型为折扣百分比（90=9折）*/
  faceValue: integer('face_value').notNull(),
  /** 使用门槛（分），0=无门槛 */
  threshold: integer('threshold').notNull().default(0),
  /** 折扣券最高减免金额（分），可空 */
  maxDiscount: integer('max_discount'),
  /** 发行总量，0=不限量 */
  totalQuantity: integer('total_quantity').notNull().default(0),
  /** 已发放数量 */
  issuedQuantity: integer('issued_quantity').notNull().default(0),
  /** 每人限领数量 */
  perLimit: integer('per_limit').notNull().default(1),
  /** 有效期类型：fixed=固定起止日期，relative=领取后 N 天 */
  validType: couponValidTypeEnum('valid_type').notNull().default('fixed'),
  validStart: timestamp('valid_start', { withTimezone: true }),
  validEnd: timestamp('valid_end', { withTimezone: true }),
  /** relative 型：领取后有效天数 */
  validDays: integer('valid_days'),
  status: couponTemplateStatusEnum('status').notNull().default('draft'),
  description: varchar('description', { length: 256 }),
  tenantId: integer('tenant_id').references(() => tenants.id, { onDelete: 'cascade' }),
  ...auditColumns(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().$onUpdate(() => new Date()).notNull(),
}, (t) => [index('coupons_status_idx').on(t.status)]);

export type CouponRow = typeof coupons.$inferSelect;
export type NewCoupon = typeof coupons.$inferInsert;

// ─── 会员优惠券（券码 / 领取记录）─────────────────────────────────────────────
export const memberCoupons = pgTable('member_coupons', {
  id: serial('id').primaryKey(),
  couponId: integer('coupon_id').notNull().references(() => coupons.id, { onDelete: 'cascade' }),
  memberId: integer('member_id').notNull().references(() => members.id, { onDelete: 'cascade' }),
  /** 券码（全局唯一）*/
  code: varchar('code', { length: 32 }).notNull().unique(),
  status: memberCouponStatusEnum('status').notNull().default('unused'),
  receivedAt: timestamp('received_at', { withTimezone: true }).defaultNow().notNull(),
  usedAt: timestamp('used_at', { withTimezone: true }),
  /** 实际过期时间（领取时按模板计算并固化）*/
  expireAt: timestamp('expire_at', { withTimezone: true }),
  /** 核销业务类型 / 单号（预留给未来订单系统）*/
  bizType: varchar('biz_type', { length: 64 }),
  bizId: varchar('biz_id', { length: 128 }),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().$onUpdate(() => new Date()).notNull(),
}, (t) => [
  index('member_coupons_member_idx').on(t.memberId),
  index('member_coupons_coupon_idx').on(t.couponId),
  index('member_coupons_status_idx').on(t.status),
]);

export type MemberCouponRow = typeof memberCoupons.$inferSelect;
export type NewMemberCoupon = typeof memberCoupons.$inferInsert;

// ─── 会员中心关系声明 ─────────────────────────────────────────────────────────
export const memberLevelsRelations = relations(memberLevels, ({ many }) => ({
  members: many(members),
}));
export const memberPointAccountsRelations = relations(memberPointAccounts, ({ one }) => ({
  member: one(members, { fields: [memberPointAccounts.memberId], references: [members.id] }),
}));
export const memberPointTransactionsRelations = relations(memberPointTransactions, ({ one }) => ({
  member: one(members, { fields: [memberPointTransactions.memberId], references: [members.id] }),
}));
export const memberWalletsRelations = relations(memberWallets, ({ one }) => ({
  member: one(members, { fields: [memberWallets.memberId], references: [members.id] }),
}));
export const memberWalletTransactionsRelations = relations(memberWalletTransactions, ({ one }) => ({
  member: one(members, { fields: [memberWalletTransactions.memberId], references: [members.id] }),
  paymentOrder: one(paymentOrders, { fields: [memberWalletTransactions.paymentOrderId], references: [paymentOrders.id] }),
}));
export const couponsRelations = relations(coupons, ({ many }) => ({
  memberCoupons: many(memberCoupons),
}));
export const memberCouponsRelations = relations(memberCoupons, ({ one }) => ({
  coupon: one(coupons, { fields: [memberCoupons.couponId], references: [coupons.id] }),
  member: one(members, { fields: [memberCoupons.memberId], references: [members.id] }),
}));

// ─── 会员登录日志表 ──────────────────────────────────────────────────────────
export const memberLoginLogs = pgTable('member_login_logs', {
  id: serial('id').primaryKey(),
  memberId: integer('member_id').references(() => members.id, { onDelete: 'cascade' }),
  ip: varchar('ip', { length: 64 }),
  location: varchar('location', { length: 128 }),
  browser: varchar('browser', { length: 64 }),
  os: varchar('os', { length: 64 }),
  userAgent: varchar('user_agent', { length: 512 }),
  status: loginStatusEnum('status').notNull(),
  message: varchar('message', { length: 256 }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});
export type MemberLoginLogRow = typeof memberLoginLogs.$inferSelect;
export type NewMemberLoginLog = typeof memberLoginLogs.$inferInsert;

// ─── 签到规则 ──────────────────────────────────────────────────────────────────
export const checkinRules = pgTable('checkin_rules', {
  id: serial('id').primaryKey(),
  dayNumber: integer('day_number').notNull(),
  points: integer('points').notNull().default(0),
  experience: integer('experience').notNull().default(0),
  remark: varchar('remark', { length: 256 }),
  ...auditColumns(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().$onUpdate(() => new Date()).notNull(),
}, (t) => [
  unique().on(t.dayNumber),
]);
export type CheckinRuleRow = typeof checkinRules.$inferSelect;
export type NewCheckinRule = typeof checkinRules.$inferInsert;

// ─── 会员签到记录 ───────────────────────────────────────────────────────────────
export const memberCheckins = pgTable('member_checkins', {
  id: serial('id').primaryKey(),
  memberId: integer('member_id').notNull().references(() => members.id, { onDelete: 'cascade' }),
  checkinDate: date('checkin_date').notNull(),
  consecutiveDays: integer('consecutive_days').notNull().default(1),
  pointsAwarded: integer('points_awarded').notNull().default(0),
  experienceAwarded: integer('experience_awarded').notNull().default(0),
  isMakeup: boolean('is_makeup').notNull().default(false),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (t) => [
  unique().on(t.memberId, t.checkinDate),
]);
export type MemberCheckinRow = typeof memberCheckins.$inferSelect;
export type NewMemberCheckin = typeof memberCheckins.$inferInsert;

export const memberCheckinsRelations = relations(memberCheckins, ({ one }) => ({
  member: one(members, { fields: [memberCheckins.memberId], references: [members.id] }),
}));

// ─── 签到设置（单行配置：补签开关 / 消耗积分 / 可回溯天数）────────────────────────
export const checkinSettings = pgTable('checkin_settings', {
  id: serial('id').primaryKey(),
  makeupEnabled: boolean('makeup_enabled').notNull().default(true),
  makeupCostPoints: integer('makeup_cost_points').notNull().default(20),
  makeupMaxDays: integer('makeup_max_days').notNull().default(7),
  ...auditColumns(),
  updatedAt: timestamp('updated_at').defaultNow().$onUpdate(() => new Date()).notNull(),
});
export type CheckinSettingsRow = typeof checkinSettings.$inferSelect;
export type NewCheckinSettings = typeof checkinSettings.$inferInsert;

// ─── 签到里程碑（累计签到天数达标奖励）──────────────────────────────────────────
export const checkinMilestoneRewardTypeEnum = pgEnum('checkin_milestone_reward_type', ['points', 'coupon']);

export const checkinMilestones = pgTable('checkin_milestones', {
  id: serial('id').primaryKey(),
  title: varchar('title', { length: 64 }).notNull(),
  cumulativeDays: integer('cumulative_days').notNull(),
  rewardType: checkinMilestoneRewardTypeEnum('reward_type').notNull().default('points'),
  rewardPoints: integer('reward_points').notNull().default(0),
  couponId: integer('coupon_id').references(() => coupons.id, { onDelete: 'set null' }),
  enabled: boolean('enabled').notNull().default(true),
  remark: varchar('remark', { length: 256 }),
  ...auditColumns(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().$onUpdate(() => new Date()).notNull(),
}, (t) => [
  unique().on(t.cumulativeDays),
]);
export type CheckinMilestoneRow = typeof checkinMilestones.$inferSelect;
export type NewCheckinMilestone = typeof checkinMilestones.$inferInsert;

export const checkinMilestonesRelations = relations(checkinMilestones, ({ one }) => ({
  coupon: one(coupons, { fields: [checkinMilestones.couponId], references: [coupons.id] }),
}));

// ─── 会员里程碑发放记录（防重复发放）──────────────────────────────────────────
export const memberCheckinMilestoneAwards = pgTable('member_checkin_milestone_awards', {
  id: serial('id').primaryKey(),
  memberId: integer('member_id').notNull().references(() => members.id, { onDelete: 'cascade' }),
  milestoneId: integer('milestone_id').notNull().references(() => checkinMilestones.id, { onDelete: 'cascade' }),
  cumulativeDays: integer('cumulative_days').notNull(),
  rewardType: checkinMilestoneRewardTypeEnum('reward_type').notNull(),
  rewardPoints: integer('reward_points').notNull().default(0),
  couponId: integer('coupon_id'),
  memberCouponId: integer('member_coupon_id'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (t) => [
  unique().on(t.memberId, t.milestoneId),
]);
export type MemberCheckinMilestoneAwardRow = typeof memberCheckinMilestoneAwards.$inferSelect;
export type NewMemberCheckinMilestoneAward = typeof memberCheckinMilestoneAwards.$inferInsert;

export const memberCheckinMilestoneAwardsRelations = relations(memberCheckinMilestoneAwards, ({ one }) => ({
  member: one(members, { fields: [memberCheckinMilestoneAwards.memberId], references: [members.id] }),
  milestone: one(checkinMilestones, { fields: [memberCheckinMilestoneAwards.milestoneId], references: [checkinMilestones.id] }),
}));

export const membersRelations = relations(members, ({ one, many }) => ({
  level: one(memberLevels, { fields: [members.levelId], references: [memberLevels.id] }),
  tenant: one(tenants, { fields: [members.tenantId], references: [tenants.id] }),
  pointAccount: one(memberPointAccounts, { fields: [members.id], references: [memberPointAccounts.memberId] }),
  wallet: one(memberWallets, { fields: [members.id], references: [memberWallets.memberId] }),
  pointTransactions: many(memberPointTransactions),
  walletTransactions: many(memberWalletTransactions),
  memberCoupons: many(memberCoupons),
  checkins: many(memberCheckins),
}));

// ─── 系统监控指标采样（时序持久化，追加型）──────────────────────────────────────
// 由 pg-boss 定时任务（默认每分钟）将 metricsSampler 最新快照落库，用于历史趋势与容量规划。
// 各百分比字段范围 0-100；*Bps 字段为字节/秒。
export const systemMetricSamples = pgTable('system_metric_samples', {
  id: serial('id').primaryKey(),
  sampledAt: timestamp('sampled_at', { withTimezone: true }).notNull().defaultNow(),
  cpu: real('cpu').notNull().default(0),
  memory: real('memory').notNull().default(0),
  disk: real('disk').notNull().default(0),
  swap: real('swap').notNull().default(0),
  load1: real('load1').notNull().default(0),
  procCpu: real('proc_cpu').notNull().default(0),
  heap: real('heap').notNull().default(0),
  loopLag: real('loop_lag').notNull().default(0),
  qps: real('qps').notNull().default(0),
  errorRate: real('error_rate').notNull().default(0),
  netRxBps: real('net_rx_bps').notNull().default(0),
  netTxBps: real('net_tx_bps').notNull().default(0),
  diskReadBps: real('disk_read_bps').notNull().default(0),
  diskWriteBps: real('disk_write_bps').notNull().default(0),
}, (t) => [
  index('system_metric_samples_at_idx').on(t.sampledAt),
]);
export type SystemMetricSampleRow = typeof systemMetricSamples.$inferSelect;
export type NewSystemMetricSample = typeof systemMetricSamples.$inferInsert;

// ─── 监控告警规则 ──────────────────────────────────────────────────────────────
// 可监控的指标维度（与 system_metric_samples 字段对应）
export const monitorMetricEnum = pgEnum('monitor_metric', [
  'cpu', 'memory', 'disk', 'swap', 'load1', 'procCpu', 'heap', 'loopLag', 'qps', 'errorRate', 'netRxBps', 'netTxBps', 'diskReadBps', 'diskWriteBps',
]);
export const monitorAlertOperatorEnum = pgEnum('monitor_alert_operator', ['gt', 'gte', 'lt', 'lte']);
export const monitorAlertLevelEnum = pgEnum('monitor_alert_level', ['info', 'warning', 'critical']);
export const monitorAlertStateEnum = pgEnum('monitor_alert_state', ['ok', 'firing']);
export const monitorAlertEventStatusEnum = pgEnum('monitor_alert_event_status', ['firing', 'resolved']);

export const monitorAlertRules = pgTable('monitor_alert_rules', {
  id: serial('id').primaryKey(),
  tenantId: integer('tenant_id').references(() => tenants.id, { onDelete: 'cascade' }),
  name: varchar('name', { length: 128 }).notNull(),
  metric: monitorMetricEnum('metric').notNull(),
  operator: monitorAlertOperatorEnum('operator').notNull().default('gt'),
  threshold: real('threshold').notNull(),
  /** 持续达标分钟数（0=瞬时触发，>0=持续超阈才触发，抑制毛刺）*/
  durationMinutes: integer('duration_minutes').notNull().default(0),
  level: monitorAlertLevelEnum('level').notNull().default('warning'),
  channels: jsonb('channels').$type<string[]>().notNull().default([]),
  webhookUrl: varchar('webhook_url', { length: 512 }),
  recipients: jsonb('recipients').$type<string[]>().notNull().default([]),
  /** 静默期分钟数：触发后该时间内不重复通知 */
  silenceMinutes: integer('silence_minutes').notNull().default(30),
  enabled: boolean('enabled').notNull().default(true),
  /** 运行态：ok / firing */
  state: monitorAlertStateEnum('state').notNull().default('ok'),
  breachingSince: timestamp('breaching_since', { withTimezone: true }),
  lastTriggeredAt: timestamp('last_triggered_at', { withTimezone: true }),
  lastValue: real('last_value'),
  ...auditColumns(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (t) => [
  index('monitor_alert_rules_tenant_idx').on(t.tenantId),
  index('monitor_alert_rules_enabled_idx').on(t.enabled),
]);
export type MonitorAlertRuleRow = typeof monitorAlertRules.$inferSelect;
export type NewMonitorAlertRule = typeof monitorAlertRules.$inferInsert;

// ─── 监控告警记录（追加型日志）────────────────────────────────────────────────
export const monitorAlertEvents = pgTable('monitor_alert_events', {
  id: serial('id').primaryKey(),
  tenantId: integer('tenant_id').references(() => tenants.id, { onDelete: 'cascade' }),
  ruleId: integer('rule_id').references((): AnyPgColumn => monitorAlertRules.id, { onDelete: 'set null' }),
  ruleName: varchar('rule_name', { length: 128 }).notNull(),
  metric: monitorMetricEnum('metric').notNull(),
  level: monitorAlertLevelEnum('level').notNull().default('warning'),
  operator: monitorAlertOperatorEnum('operator').notNull(),
  threshold: real('threshold').notNull(),
  value: real('value').notNull(),
  status: monitorAlertEventStatusEnum('status').notNull().default('firing'),
  message: text('message').notNull(),
  notified: boolean('notified').notNull().default(false),
  triggeredAt: timestamp('triggered_at', { withTimezone: true }).notNull().defaultNow(),
  resolvedAt: timestamp('resolved_at', { withTimezone: true }),
}, (t) => [
  index('monitor_alert_events_rule_idx').on(t.ruleId),
  index('monitor_alert_events_status_idx').on(t.status),
  index('monitor_alert_events_triggered_idx').on(t.triggeredAt),
  index('monitor_alert_events_tenant_idx').on(t.tenantId),
]);
export type MonitorAlertEventRow = typeof monitorAlertEvents.$inferSelect;
export type NewMonitorAlertEvent = typeof monitorAlertEvents.$inferInsert;

export const monitorAlertRulesRelations = relations(monitorAlertRules, ({ many }) => ({
  events: many(monitorAlertEvents),
}));

export const monitorAlertEventsRelations = relations(monitorAlertEvents, ({ one }) => ({
  rule: one(monitorAlertRules, { fields: [monitorAlertEvents.ruleId], references: [monitorAlertRules.id] }),
}));

// ─── SSL 证书 ──────────────────────────────────────────────────────────────
export const sslCertTypeEnum = pgEnum('ssl_cert_type', ['self_signed', 'uploaded', 'letsencrypt']);
export const sslCertStatusEnum = pgEnum('ssl_cert_status', ['valid', 'expiring', 'expired', 'invalid']);

export const sslCertificates = pgTable('ssl_certificates', {
  id: serial('id').primaryKey(),
  name: varchar('name', { length: 128 }).notNull(),
  domain: varchar('domain', { length: 256 }).notNull(),
  type: sslCertTypeEnum('type').notNull().default('self_signed'),
  certPath: varchar('cert_path', { length: 512 }),
  keyPath: varchar('key_path', { length: 512 }),
  certContent: text('cert_content'),
  keyContent: text('key_content'),
  issuer: varchar('issuer', { length: 256 }),
  subject: varchar('subject', { length: 256 }),
  validFrom: timestamp('valid_from', { withTimezone: true }),
  validTo: timestamp('valid_to', { withTimezone: true }),
  fingerprint: varchar('fingerprint', { length: 128 }),
  serialNumber: varchar('serial_number', { length: 128 }),
  status: sslCertStatusEnum('status').notNull().default('valid'),
  autoRenew: boolean('auto_renew').notNull().default(false),
  ...auditColumns(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});
export type SslCertificateRow = typeof sslCertificates.$inferSelect;
export type NewSslCertificate = typeof sslCertificates.$inferInsert;

// ─── 公众号管理 ────────────────────────────────────────────────────────────────
// 微信公众号账号（多公众号 + 租户隔离）。子实体（粉丝/标签/消息/菜单/素材/图文等）
// 在后续阶段加入，均通过 account_id 外键挂到此表。
export const mpAccountTypeEnum = pgEnum('mp_account_type', ['subscribe', 'service', 'test']);
export const mpEncryptModeEnum = pgEnum('mp_encrypt_mode', ['plaintext', 'compatible', 'safe']);

export const mpAccounts = pgTable('mp_accounts', {
  id: serial('id').primaryKey(),
  /** 公众号名称 */
  name: varchar('name', { length: 100 }).notNull(),
  /** 微信号 / 原始 ID（gh_xxx） */
  account: varchar('account', { length: 100 }),
  /** 公众号 AppID（全局唯一） */
  appId: varchar('app_id', { length: 64 }).notNull().unique(),
  /** 公众号 AppSecret（响应中脱敏） */
  appSecret: varchar('app_secret', { length: 128 }).notNull().default(''),
  /** 服务器配置 Token（回调签名校验用） */
  token: varchar('token', { length: 64 }).notNull().default(''),
  /** 消息加解密密钥（安全模式 / 兼容模式需要） */
  encodingAesKey: varchar('encoding_aes_key', { length: 64 }),
  /** 消息加解密方式：明文 / 兼容 / 安全 */
  encryptMode: mpEncryptModeEnum('encrypt_mode').notNull().default('plaintext'),
  /** 账号类型：订阅号 / 服务号 / 测试号 */
  type: mpAccountTypeEnum('type').notNull().default('service'),
  /** 二维码图片地址 */
  qrCodeUrl: varchar('qr_code_url', { length: 500 }),
  /** 是否默认公众号（同租户内唯一） */
  isDefault: boolean('is_default').notNull().default(false),
  /** 关注即注册会员：粉丝关注时自动创建并绑定会员 */
  autoCreateMember: boolean('auto_create_member').notNull().default(false),
  /** 是否对群发/客服消息启用内容安全校验（msg_sec_check） */
  contentCheckEnabled: boolean('content_check_enabled').notNull().default(false),
  status: statusEnum('status').notNull().default('enabled'),
  remark: text('remark'),
  tenantId: integer('tenant_id').references(() => tenants.id, { onDelete: 'cascade' }),
  ...auditColumns(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().$onUpdate(() => new Date()).notNull(),
}, (t) => [
  index('mp_accounts_tenant_idx').on(t.tenantId),
]);
export type MpAccountRow = typeof mpAccounts.$inferSelect;
export type NewMpAccount = typeof mpAccounts.$inferInsert;

export const mpAccountsRelations = relations(mpAccounts, ({ one, many }) => ({
  tenant: one(tenants, { fields: [mpAccounts.tenantId], references: [tenants.id] }),
  tags: many(mpTags),
  fans: many(mpFans),
}));

// 公众号粉丝标签（与微信标签同步；wechat_tag_id 同步后回填）
export const mpTags = pgTable('mp_tags', {
  id: serial('id').primaryKey(),
  accountId: integer('account_id').notNull().references((): AnyPgColumn => mpAccounts.id, { onDelete: 'cascade' }),
  /** 微信侧标签 id（从微信同步后回填，本地新建时为空） */
  wechatTagId: integer('wechat_tag_id'),
  name: varchar('name', { length: 30 }).notNull(),
  /** 该标签下粉丝数（同步时更新） */
  fansCount: integer('fans_count').notNull().default(0),
  tenantId: integer('tenant_id').references(() => tenants.id, { onDelete: 'cascade' }),
  ...auditColumns(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().$onUpdate(() => new Date()).notNull(),
}, (t) => [
  uniqueIndex('mp_tags_account_name_uq').on(t.accountId, t.name),
  index('mp_tags_account_idx').on(t.accountId),
]);
export type MpTagRow = typeof mpTags.$inferSelect;
export type NewMpTag = typeof mpTags.$inferInsert;

export const mpTagsRelations = relations(mpTags, ({ one }) => ({
  account: one(mpAccounts, { fields: [mpTags.accountId], references: [mpAccounts.id] }),
  tenant: one(tenants, { fields: [mpTags.tenantId], references: [tenants.id] }),
}));

// 公众号粉丝（关注者；从微信同步，本地可备注/打标签）
export const mpFanSubscribeEnum = pgEnum('mp_fan_subscribe', ['subscribed', 'unsubscribed']);

export const mpFans = pgTable('mp_fans', {
  id: serial('id').primaryKey(),
  accountId: integer('account_id').notNull().references((): AnyPgColumn => mpAccounts.id, { onDelete: 'cascade' }),
  openid: varchar('openid', { length: 64 }).notNull(),
  nickname: varchar('nickname', { length: 128 }),
  avatar: varchar('avatar', { length: 512 }),
  /** 性别：0 未知 / 1 男 / 2 女 */
  sex: smallint('sex').notNull().default(0),
  country: varchar('country', { length: 64 }),
  province: varchar('province', { length: 64 }),
  city: varchar('city', { length: 64 }),
  language: varchar('language', { length: 16 }),
  subscribe: mpFanSubscribeEnum('subscribe').notNull().default('subscribed'),
  subscribeTime: timestamp('subscribe_time', { withTimezone: true }),
  /** 本地备注 */
  remark: varchar('remark', { length: 128 }),
  /** 本地标签 id 列表（指向 mp_tags.id） */
  tagIds: jsonb('tag_ids').$type<number[]>().notNull().default([]),
  /** 微信 unionid（账号绑定开放平台时可获取，用于跨应用打通会员） */
  unionid: varchar('unionid', { length: 64 }),
  /** 关联的会员 id（公众号粉丝 ↔ 会员体系打通） */
  memberId: integer('member_id').references((): AnyPgColumn => members.id, { onDelete: 'set null' }),
  /** 是否已加入黑名单（微信 batchblacklist） */
  blacklisted: boolean('blacklisted').notNull().default(false),
  tenantId: integer('tenant_id').references(() => tenants.id, { onDelete: 'cascade' }),
  ...auditColumns(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().$onUpdate(() => new Date()).notNull(),
}, (t) => [
  uniqueIndex('mp_fans_account_openid_uq').on(t.accountId, t.openid),
  index('mp_fans_account_idx').on(t.accountId),
  index('mp_fans_member_idx').on(t.memberId),
]);
export type MpFanRow = typeof mpFans.$inferSelect;
export type NewMpFan = typeof mpFans.$inferInsert;

export const mpFansRelations = relations(mpFans, ({ one }) => ({
  account: one(mpAccounts, { fields: [mpFans.accountId], references: [mpAccounts.id] }),
  tenant: one(tenants, { fields: [mpFans.tenantId], references: [tenants.id] }),
}));

// 公众号消息（追加型：入站用户消息 / 出站客服消息）。作者天然为粉丝或当前管理员，故不加审计列。
export const mpMessageDirectionEnum = pgEnum('mp_message_direction', ['in', 'out']);
export const mpMessageTypeEnum = pgEnum('mp_message_type', ['text', 'image', 'voice', 'video', 'shortvideo', 'location', 'link', 'event']);
export const mpMessageStatusEnum = pgEnum('mp_message_status', ['received', 'sent', 'failed']);

export const mpMessages = pgTable('mp_messages', {
  id: serial('id').primaryKey(),
  accountId: integer('account_id').notNull().references((): AnyPgColumn => mpAccounts.id, { onDelete: 'cascade' }),
  openid: varchar('openid', { length: 64 }).notNull(),
  /** in=用户发来 out=客服回复 */
  direction: mpMessageDirectionEnum('direction').notNull(),
  msgType: mpMessageTypeEnum('msg_type').notNull().default('text'),
  /** 文本内容 / 链接地址 / 事件 EventKey */
  content: text('content'),
  /** 媒体素材 id（图片/语音/视频） */
  mediaId: varchar('media_id', { length: 128 }),
  /** 媒体 URL（图片 PicUrl 等） */
  mediaUrl: varchar('media_url', { length: 1000 }),
  /** 事件类型（msgType=event 时：subscribe/unsubscribe/CLICK/VIEW/SCAN…） */
  event: varchar('event', { length: 32 }),
  /** 微信消息 id（入站去重用） */
  msgId: varchar('msg_id', { length: 64 }),
  status: mpMessageStatusEnum('status').notNull().default('received'),
  errorMsg: text('error_msg'),
  tenantId: integer('tenant_id').references(() => tenants.id, { onDelete: 'cascade' }),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (t) => [
  index('mp_messages_account_openid_idx').on(t.accountId, t.openid),
  index('mp_messages_account_idx').on(t.accountId),
  // 入站消息去重：同一账号下 msg_id 唯一（仅对非空 msg_id 生效），保证微信重试不产生重复记录
  uniqueIndex('mp_messages_account_msgid_uq').on(t.accountId, t.msgId).where(sql`${t.msgId} IS NOT NULL`),
]);
export type MpMessageRow = typeof mpMessages.$inferSelect;
export type NewMpMessage = typeof mpMessages.$inferInsert;

export const mpMessagesRelations = relations(mpMessages, ({ one }) => ({
  account: one(mpAccounts, { fields: [mpMessages.accountId], references: [mpAccounts.id] }),
  tenant: one(tenants, { fields: [mpMessages.tenantId], references: [tenants.id] }),
}));

// 公众号自动回复（关注回复 / 关键词回复 / 默认回复）
export const mpAutoReplyTypeEnum = pgEnum('mp_auto_reply_type', ['subscribe', 'keyword', 'default']);
export const mpAutoReplyMatchEnum = pgEnum('mp_auto_reply_match', ['exact', 'contain', 'regex']);
export const mpReplyContentTypeEnum = pgEnum('mp_reply_content_type', ['text', 'image', 'voice', 'video', 'news']);

export const mpAutoReplies = pgTable('mp_auto_replies', {
  id: serial('id').primaryKey(),
  accountId: integer('account_id').notNull().references((): AnyPgColumn => mpAccounts.id, { onDelete: 'cascade' }),
  replyType: mpAutoReplyTypeEnum('reply_type').notNull(),
  /** 关键词（仅 replyType=keyword） */
  keyword: varchar('keyword', { length: 64 }),
  /** 匹配方式（仅 keyword）：exact=全匹配 contain=包含 */
  matchType: mpAutoReplyMatchEnum('match_type').notNull().default('contain'),
  contentType: mpReplyContentTypeEnum('content_type').notNull().default('text'),
  /** 文本回复内容（也用于视频标题） */
  content: text('content'),
  /** 图片/语音/视频回复素材 id（contentType=image/voice/video） */
  mediaId: varchar('media_id', { length: 128 }),
  /** 图文回复文章列表（contentType=news） */
  newsArticles: jsonb('news_articles').$type<{ title: string; description?: string; picUrl?: string; url: string }[]>(),
  /** 命中后是否转人工客服（接入多客服会话） */
  transferToKf: boolean('transfer_to_kf').notNull().default(false),
  status: statusEnum('status').notNull().default('enabled'),
  /** 关键词优先级（小在前） */
  sort: integer('sort').notNull().default(0),
  tenantId: integer('tenant_id').references(() => tenants.id, { onDelete: 'cascade' }),
  ...auditColumns(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().$onUpdate(() => new Date()).notNull(),
}, (t) => [
  index('mp_auto_replies_account_type_idx').on(t.accountId, t.replyType),
]);
export type MpAutoReplyRow = typeof mpAutoReplies.$inferSelect;
export type NewMpAutoReply = typeof mpAutoReplies.$inferInsert;

export const mpAutoRepliesRelations = relations(mpAutoReplies, ({ one }) => ({
  account: one(mpAccounts, { fields: [mpAutoReplies.accountId], references: [mpAccounts.id] }),
  tenant: one(tenants, { fields: [mpAutoReplies.tenantId], references: [tenants.id] }),
}));

// 自动回复未命中关键词收集（用于优化关键词库；按 account+keyword 累计命中次数）
export const mpUnmatchedKeywords = pgTable('mp_unmatched_keywords', {
  id: serial('id').primaryKey(),
  accountId: integer('account_id').notNull().references((): AnyPgColumn => mpAccounts.id, { onDelete: 'cascade' }),
  keyword: varchar('keyword', { length: 128 }).notNull(),
  count: integer('count').notNull().default(1),
  lastAt: timestamp('last_at').defaultNow().notNull(),
  tenantId: integer('tenant_id').references(() => tenants.id, { onDelete: 'cascade' }),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (t) => [
  uniqueIndex('mp_unmatched_keywords_account_kw_uq').on(t.accountId, t.keyword),
]);
export type MpUnmatchedKeywordRow = typeof mpUnmatchedKeywords.$inferSelect;
export type NewMpUnmatchedKeyword = typeof mpUnmatchedKeywords.$inferInsert;

export const mpUnmatchedKeywordsRelations = relations(mpUnmatchedKeywords, ({ one }) => ({
  account: one(mpAccounts, { fields: [mpUnmatchedKeywords.accountId], references: [mpAccounts.id] }),
  tenant: one(tenants, { fields: [mpUnmatchedKeywords.tenantId], references: [tenants.id] }),
}));

// 公众号自定义菜单（每账号一份，buttons 为微信菜单按钮树 JSON）
export const mpMenuStatusEnum = pgEnum('mp_menu_status', ['draft', 'published']);

export const mpMenus = pgTable('mp_menus', {
  id: serial('id').primaryKey(),
  accountId: integer('account_id').notNull().unique().references((): AnyPgColumn => mpAccounts.id, { onDelete: 'cascade' }),
  /** 微信菜单按钮树（最多 3 个一级，每个最多 5 个二级） */
  buttons: jsonb('buttons').$type<unknown[]>().notNull().default([]),
  status: mpMenuStatusEnum('status').notNull().default('draft'),
  publishedAt: timestamp('published_at', { withTimezone: true }),
  tenantId: integer('tenant_id').references(() => tenants.id, { onDelete: 'cascade' }),
  ...auditColumns(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().$onUpdate(() => new Date()).notNull(),
});
export type MpMenuRow = typeof mpMenus.$inferSelect;
export type NewMpMenu = typeof mpMenus.$inferInsert;

export const mpMenusRelations = relations(mpMenus, ({ one }) => ({
  account: one(mpAccounts, { fields: [mpMenus.accountId], references: [mpAccounts.id] }),
  tenant: one(tenants, { fields: [mpMenus.tenantId], references: [tenants.id] }),
}));

// 个性化菜单（按标签/性别/地区等匹配规则向不同人群下发不同菜单）
export const mpConditionalMenus = pgTable('mp_conditional_menus', {
  id: serial('id').primaryKey(),
  accountId: integer('account_id').notNull().references((): AnyPgColumn => mpAccounts.id, { onDelete: 'cascade' }),
  /** 本地名称（便于管理识别） */
  name: varchar('name', { length: 64 }).notNull(),
  /** 菜单按钮树（结构同普通自定义菜单） */
  buttons: jsonb('buttons').$type<unknown[]>().notNull().default([]),
  /** 匹配规则：tag_id/sex/country/province/city/client_platform_type/language */
  matchRule: jsonb('match_rule').$type<Record<string, string>>().notNull().default({}),
  /** 微信返回的 menuid（发布后写入） */
  menuId: varchar('menu_id', { length: 64 }),
  status: mpMenuStatusEnum('status').notNull().default('draft'),
  publishedAt: timestamp('published_at', { withTimezone: true }),
  tenantId: integer('tenant_id').references(() => tenants.id, { onDelete: 'cascade' }),
  ...auditColumns(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().$onUpdate(() => new Date()).notNull(),
}, (t) => [
  index('mp_conditional_menus_account_idx').on(t.accountId),
]);
export type MpConditionalMenuRow = typeof mpConditionalMenus.$inferSelect;
export type NewMpConditionalMenu = typeof mpConditionalMenus.$inferInsert;

export const mpConditionalMenusRelations = relations(mpConditionalMenus, ({ one }) => ({
  account: one(mpAccounts, { fields: [mpConditionalMenus.accountId], references: [mpAccounts.id] }),
  tenant: one(tenants, { fields: [mpConditionalMenus.tenantId], references: [tenants.id] }),
}));

// 公众号素材（图片 / 语音 / 视频 / 缩略图），本地登记 + 与微信永久素材同步
export const mpMaterialTypeEnum = pgEnum('mp_material_type', ['image', 'voice', 'video', 'thumb']);

export const mpMaterials = pgTable('mp_materials', {
  id: serial('id').primaryKey(),
  accountId: integer('account_id').notNull().references((): AnyPgColumn => mpAccounts.id, { onDelete: 'cascade' }),
  type: mpMaterialTypeEnum('type').notNull().default('image'),
  name: varchar('name', { length: 200 }).notNull(),
  /** 微信永久素材 media_id（同步 / 推送后回填） */
  wechatMediaId: varchar('wechat_media_id', { length: 128 }),
  /** 素材 URL（图片可直接预览） */
  url: varchar('url', { length: 1000 }),
  /** 文件大小（字节） */
  fileSize: integer('file_size'),
  tenantId: integer('tenant_id').references(() => tenants.id, { onDelete: 'cascade' }),
  ...auditColumns(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().$onUpdate(() => new Date()).notNull(),
}, (t) => [
  index('mp_materials_account_type_idx').on(t.accountId, t.type),
]);
export type MpMaterialRow = typeof mpMaterials.$inferSelect;
export type NewMpMaterial = typeof mpMaterials.$inferInsert;

export const mpMaterialsRelations = relations(mpMaterials, ({ one }) => ({
  account: one(mpAccounts, { fields: [mpMaterials.accountId], references: [mpAccounts.id] }),
  tenant: one(tenants, { fields: [mpMaterials.tenantId], references: [tenants.id] }),
}));

// 公众号图文草稿（articles 为图文消息数组，可多图文）
export const mpDraftStatusEnum = pgEnum('mp_draft_status', ['draft', 'published']);

export const mpDrafts = pgTable('mp_drafts', {
  id: serial('id').primaryKey(),
  accountId: integer('account_id').notNull().references((): AnyPgColumn => mpAccounts.id, { onDelete: 'cascade' }),
  /** 草稿标题（内部标识，取首篇文章标题） */
  title: varchar('title', { length: 200 }).notNull(),
  /** 图文文章数组 */
  articles: jsonb('articles').$type<unknown[]>().notNull().default([]),
  /** 微信草稿 media_id（推送后回填） */
  wechatMediaId: varchar('wechat_media_id', { length: 128 }),
  status: mpDraftStatusEnum('status').notNull().default('draft'),
  tenantId: integer('tenant_id').references(() => tenants.id, { onDelete: 'cascade' }),
  ...auditColumns(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().$onUpdate(() => new Date()).notNull(),
}, (t) => [
  index('mp_drafts_account_idx').on(t.accountId),
]);
export type MpDraftRow = typeof mpDrafts.$inferSelect;
export type NewMpDraft = typeof mpDrafts.$inferInsert;

export const mpDraftsRelations = relations(mpDrafts, ({ one }) => ({
  account: one(mpAccounts, { fields: [mpDrafts.accountId], references: [mpAccounts.id] }),
  tenant: one(tenants, { fields: [mpDrafts.tenantId], references: [tenants.id] }),
}));

// 公众号模板消息：模板库（与微信同步）
export const mpMessageTemplates = pgTable('mp_message_templates', {
  id: serial('id').primaryKey(),
  accountId: integer('account_id').notNull().references((): AnyPgColumn => mpAccounts.id, { onDelete: 'cascade' }),
  /** 微信模板 id */
  templateId: varchar('template_id', { length: 128 }).notNull(),
  title: varchar('title', { length: 200 }).notNull(),
  content: text('content'),
  example: text('example'),
  tenantId: integer('tenant_id').references(() => tenants.id, { onDelete: 'cascade' }),
  ...auditColumns(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().$onUpdate(() => new Date()).notNull(),
}, (t) => [
  uniqueIndex('mp_message_templates_account_tpl_uq').on(t.accountId, t.templateId),
]);
export type MpMessageTemplateRow = typeof mpMessageTemplates.$inferSelect;
export type NewMpMessageTemplate = typeof mpMessageTemplates.$inferInsert;

export const mpMessageTemplatesRelations = relations(mpMessageTemplates, ({ one }) => ({
  account: one(mpAccounts, { fields: [mpMessageTemplates.accountId], references: [mpAccounts.id] }),
  tenant: one(tenants, { fields: [mpMessageTemplates.tenantId], references: [tenants.id] }),
}));

// 公众号模板消息发送记录（追加型）
export const mpTemplateSendStatusEnum = pgEnum('mp_template_send_status', ['success', 'failed']);

export const mpTemplateSendLogs = pgTable('mp_template_send_logs', {
  id: serial('id').primaryKey(),
  accountId: integer('account_id').notNull().references((): AnyPgColumn => mpAccounts.id, { onDelete: 'cascade' }),
  templateId: varchar('template_id', { length: 128 }).notNull(),
  openid: varchar('openid', { length: 64 }).notNull(),
  data: jsonb('data').$type<Record<string, unknown>>(),
  url: varchar('url', { length: 1000 }),
  status: mpTemplateSendStatusEnum('status').notNull().default('success'),
  errorMsg: text('error_msg'),
  /** 微信返回的 msgid */
  msgId: varchar('msg_id', { length: 64 }),
  tenantId: integer('tenant_id').references(() => tenants.id, { onDelete: 'cascade' }),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (t) => [
  index('mp_template_send_logs_account_idx').on(t.accountId),
]);
export type MpTemplateSendLogRow = typeof mpTemplateSendLogs.$inferSelect;
export type NewMpTemplateSendLog = typeof mpTemplateSendLogs.$inferInsert;

export const mpTemplateSendLogsRelations = relations(mpTemplateSendLogs, ({ one }) => ({
  account: one(mpAccounts, { fields: [mpTemplateSendLogs.accountId], references: [mpAccounts.id] }),
  tenant: one(tenants, { fields: [mpTemplateSendLogs.tenantId], references: [tenants.id] }),
}));

// 公众号群发消息（按全部粉丝 / 按标签群发，支持文本 / 图片 / 图文）
export const mpBroadcastTypeEnum = pgEnum('mp_broadcast_type', ['text', 'image', 'mpnews']);
export const mpBroadcastTargetEnum = pgEnum('mp_broadcast_target', ['all', 'tag']);
export const mpBroadcastStatusEnum = pgEnum('mp_broadcast_status', ['draft', 'sent', 'failed']);

export const mpBroadcasts = pgTable('mp_broadcasts', {
  id: serial('id').primaryKey(),
  accountId: integer('account_id').notNull().references((): AnyPgColumn => mpAccounts.id, { onDelete: 'cascade' }),
  msgType: mpBroadcastTypeEnum('msg_type').notNull().default('text'),
  /** 群发对象：all=全部粉丝 tag=指定标签 */
  target: mpBroadcastTargetEnum('target').notNull().default('all'),
  /** 指定标签（target=tag 时），关联本地标签 id */
  tagId: integer('tag_id').references((): AnyPgColumn => mpTags.id, { onDelete: 'set null' }),
  /** 文本内容（msgType=text） */
  content: text('content'),
  /** 素材 media_id（msgType=image 用图片素材 / mpnews 用图文草稿） */
  mediaId: varchar('media_id', { length: 128 }),
  status: mpBroadcastStatusEnum('status').notNull().default('draft'),
  /** 微信返回的群发 msg_id（发送成功后回填） */
  wechatMsgId: varchar('wechat_msg_id', { length: 64 }),
  /** 定时群发时间（为空表示立即发送，由 mp-broadcast-tick 扫描到期发送） */
  scheduledAt: timestamp('scheduled_at'),
  errorMsg: text('error_msg'),
  sentAt: timestamp('sent_at'),
  tenantId: integer('tenant_id').references(() => tenants.id, { onDelete: 'cascade' }),
  ...auditColumns(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().$onUpdate(() => new Date()).notNull(),
}, (t) => [
  index('mp_broadcasts_account_idx').on(t.accountId),
  index('mp_broadcasts_account_status_idx').on(t.accountId, t.status),
]);
export type MpBroadcastRow = typeof mpBroadcasts.$inferSelect;
export type NewMpBroadcast = typeof mpBroadcasts.$inferInsert;

export const mpBroadcastsRelations = relations(mpBroadcasts, ({ one }) => ({
  account: one(mpAccounts, { fields: [mpBroadcasts.accountId], references: [mpAccounts.id] }),
  tag: one(mpTags, { fields: [mpBroadcasts.tagId], references: [mpTags.id] }),
  tenant: one(tenants, { fields: [mpBroadcasts.tenantId], references: [tenants.id] }),
}));

// 公众号带参数二维码（临时 / 永久），扫码事件计数
export const mpQrcodeTypeEnum = pgEnum('mp_qrcode_type', ['temporary', 'permanent']);

export const mpQrcodes = pgTable('mp_qrcodes', {
  id: serial('id').primaryKey(),
  accountId: integer('account_id').notNull().references((): AnyPgColumn => mpAccounts.id, { onDelete: 'cascade' }),
  type: mpQrcodeTypeEnum('type').notNull().default('permanent'),
  /** 场景值（字符串型 scene_str，用于渠道来源标识） */
  sceneStr: varchar('scene_str', { length: 64 }).notNull(),
  /** 备注名称 */
  name: varchar('name', { length: 100 }).notNull(),
  /** 微信返回的 ticket（换取二维码图片） */
  ticket: varchar('ticket', { length: 256 }),
  /** 二维码图片展示 URL */
  url: varchar('url', { length: 512 }),
  /** 有效期秒数（仅临时二维码） */
  expireSeconds: integer('expire_seconds'),
  /** 累计扫码次数（回调事件累加） */
  scanCount: integer('scan_count').notNull().default(0),
  /** 扫码关注奖励积分（粉丝已绑定会员时自动入账，0=不奖励） */
  rewardPoints: integer('reward_points').notNull().default(0),
  tenantId: integer('tenant_id').references(() => tenants.id, { onDelete: 'cascade' }),
  ...auditColumns(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().$onUpdate(() => new Date()).notNull(),
}, (t) => [
  index('mp_qrcodes_account_idx').on(t.accountId),
  index('mp_qrcodes_account_scene_idx').on(t.accountId, t.sceneStr),
]);
export type MpQrcodeRow = typeof mpQrcodes.$inferSelect;
export type NewMpQrcode = typeof mpQrcodes.$inferInsert;

export const mpQrcodesRelations = relations(mpQrcodes, ({ one }) => ({
  account: one(mpAccounts, { fields: [mpQrcodes.accountId], references: [mpAccounts.id] }),
  tenant: one(tenants, { fields: [mpQrcodes.tenantId], references: [tenants.id] }),
}));

// 公众号多客服账号（与微信多客服 kf_account 对应）
export const mpKfAccounts = pgTable('mp_kf_accounts', {
  id: serial('id').primaryKey(),
  accountId: integer('account_id').notNull().references((): AnyPgColumn => mpAccounts.id, { onDelete: 'cascade' }),
  /** 微信客服账号（形如 kf2001@gh_xxx） */
  kfAccount: varchar('kf_account', { length: 64 }).notNull(),
  nickname: varchar('nickname', { length: 64 }).notNull(),
  avatar: varchar('avatar', { length: 512 }),
  /** 微信侧客服 id（kf_id） */
  kfId: varchar('kf_id', { length: 64 }),
  /** 绑定微信号邀请状态：none/inviting/bound */
  inviteStatus: varchar('invite_status', { length: 32 }).notNull().default('none'),
  /** 绑定的微信号 */
  inviteWx: varchar('invite_wx', { length: 64 }),
  status: statusEnum('status').notNull().default('enabled'),
  tenantId: integer('tenant_id').references(() => tenants.id, { onDelete: 'cascade' }),
  ...auditColumns(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().$onUpdate(() => new Date()).notNull(),
}, (t) => [
  uniqueIndex('mp_kf_accounts_account_kf_uq').on(t.accountId, t.kfAccount),
  index('mp_kf_accounts_account_idx').on(t.accountId),
]);
export type MpKfAccountRow = typeof mpKfAccounts.$inferSelect;
export type NewMpKfAccount = typeof mpKfAccounts.$inferInsert;

export const mpKfAccountsRelations = relations(mpKfAccounts, ({ one }) => ({
  account: one(mpAccounts, { fields: [mpKfAccounts.accountId], references: [mpAccounts.id] }),
  tenant: one(tenants, { fields: [mpKfAccounts.tenantId], references: [tenants.id] }),
}));

// ─── 公众号多客服会话治理（实时状态机：接入/转接/超时自动路由/会话分配）──────────────
export const mpKfSessionStatusEnum = pgEnum('mp_kf_session_status', ['waiting', 'active', 'closed']);
export const mpKfSessionCloseReasonEnum = pgEnum('mp_kf_session_close_reason', ['manual', 'wait_timeout', 'idle_timeout', 'system']);
export const mpKfRoutingStrategyEnum = pgEnum('mp_kf_routing_strategy', ['manual', 'round_robin', 'least_active']);
export const mpKfSessionEventTypeEnum = pgEnum('mp_kf_session_event_type', ['create', 'assign', 'accept', 'transfer', 'reroute', 'close']);

// 多客服会话：一名粉丝（openid）与一个客服账号的一次会话，含排队(waiting)/进行(active)/结束(closed)状态机
export const mpKfSessions = pgTable('mp_kf_sessions', {
  id: serial('id').primaryKey(),
  accountId: integer('account_id').notNull().references((): AnyPgColumn => mpAccounts.id, { onDelete: 'cascade' }),
  openid: varchar('openid', { length: 64 }).notNull(),
  /** 当前承接的客服账号；waiting 时为 null */
  kfId: integer('kf_id').references((): AnyPgColumn => mpKfAccounts.id, { onDelete: 'set null' }),
  status: mpKfSessionStatusEnum('status').notNull().default('waiting'),
  /** 优先级（越大越靠前），超时未接入时自动提升 */
  priority: integer('priority').notNull().default(0),
  /** 会话来源（首条消息类型，如 text/event） */
  source: varchar('source', { length: 32 }),
  /** 未读（粉丝发来但客服未回复）条数 */
  unreadCount: integer('unread_count').notNull().default(0),
  lastFanMsgAt: timestamp('last_fan_msg_at'),
  lastKfMsgAt: timestamp('last_kf_msg_at'),
  lastMsgAt: timestamp('last_msg_at').defaultNow().notNull(),
  /** 进入排队的时间（用于等待超时计算） */
  waitingSince: timestamp('waiting_since'),
  acceptedAt: timestamp('accepted_at'),
  closedAt: timestamp('closed_at'),
  closeReason: mpKfSessionCloseReasonEnum('close_reason'),
  /** 满意度评分（1-5，结束后由粉丝/客服记录） */
  rating: integer('rating'),
  ratingRemark: varchar('rating_remark', { length: 255 }),
  remark: varchar('remark', { length: 255 }),
  tenantId: integer('tenant_id').references(() => tenants.id, { onDelete: 'cascade' }),
  ...auditColumns(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().$onUpdate(() => new Date()).notNull(),
}, (t) => [
  // 同一公众号下，一个粉丝至多存在一个未结束会话
  uniqueIndex('mp_kf_sessions_open_uq').on(t.accountId, t.openid).where(sql`${t.status} <> 'closed'`),
  index('mp_kf_sessions_account_status_idx').on(t.accountId, t.status),
  index('mp_kf_sessions_kf_idx').on(t.kfId),
]);
export type MpKfSessionRow = typeof mpKfSessions.$inferSelect;
export type NewMpKfSession = typeof mpKfSessions.$inferInsert;

// 会话事件流水：创建/分配/接入/转接/重路由/结束，支撑时间线与转接历史审计
export const mpKfSessionEvents = pgTable('mp_kf_session_events', {
  id: serial('id').primaryKey(),
  sessionId: integer('session_id').notNull().references((): AnyPgColumn => mpKfSessions.id, { onDelete: 'cascade' }),
  accountId: integer('account_id').notNull().references((): AnyPgColumn => mpAccounts.id, { onDelete: 'cascade' }),
  type: mpKfSessionEventTypeEnum('type').notNull(),
  fromKfId: integer('from_kf_id').references((): AnyPgColumn => mpKfAccounts.id, { onDelete: 'set null' }),
  toKfId: integer('to_kf_id').references((): AnyPgColumn => mpKfAccounts.id, { onDelete: 'set null' }),
  /** 操作人（人工操作时为后台用户；系统自动时为 null） */
  operatorId: integer('operator_id').references((): AnyPgColumn => users.id, { onDelete: 'set null' }),
  detail: varchar('detail', { length: 255 }),
  tenantId: integer('tenant_id').references(() => tenants.id, { onDelete: 'cascade' }),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (t) => [
  index('mp_kf_session_events_session_idx').on(t.sessionId),
]);
export type MpKfSessionEventRow = typeof mpKfSessionEvents.$inferSelect;
export type NewMpKfSessionEvent = typeof mpKfSessionEvents.$inferInsert;

// 多客服路由治理配置：每公众号一份，决定会话分配策略与超时阈值
export const mpKfRoutingConfigs = pgTable('mp_kf_routing_configs', {
  id: serial('id').primaryKey(),
  accountId: integer('account_id').notNull().references((): AnyPgColumn => mpAccounts.id, { onDelete: 'cascade' }),
  /** 是否启用会话治理（关闭则回调不再建会话） */
  enabled: boolean('enabled').notNull().default(true),
  strategy: mpKfRoutingStrategyEnum('strategy').notNull().default('least_active'),
  /** 单客服最大并发会话数（容量上限） */
  maxConcurrent: integer('max_concurrent').notNull().default(5),
  /** 排队等待超时（分钟）：超时自动重新路由 */
  waitTimeoutMinutes: integer('wait_timeout_minutes').notNull().default(3),
  /** 会话空闲超时（分钟）：超时自动结束 */
  idleTimeoutMinutes: integer('idle_timeout_minutes').notNull().default(15),
  autoCloseEnabled: boolean('auto_close_enabled').notNull().default(true),
  /** 接入后自动发送的欢迎语（可空） */
  welcomeText: varchar('welcome_text', { length: 500 }),
  tenantId: integer('tenant_id').references(() => tenants.id, { onDelete: 'cascade' }),
  ...auditColumns(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().$onUpdate(() => new Date()).notNull(),
}, (t) => [
  uniqueIndex('mp_kf_routing_configs_account_uq').on(t.accountId),
]);
export type MpKfRoutingConfigRow = typeof mpKfRoutingConfigs.$inferSelect;
export type NewMpKfRoutingConfig = typeof mpKfRoutingConfigs.$inferInsert;

export const mpKfSessionsRelations = relations(mpKfSessions, ({ one, many }) => ({
  account: one(mpAccounts, { fields: [mpKfSessions.accountId], references: [mpAccounts.id] }),
  kf: one(mpKfAccounts, { fields: [mpKfSessions.kfId], references: [mpKfAccounts.id] }),
  events: many(mpKfSessionEvents),
  tenant: one(tenants, { fields: [mpKfSessions.tenantId], references: [tenants.id] }),
}));

export const mpKfSessionEventsRelations = relations(mpKfSessionEvents, ({ one }) => ({
  session: one(mpKfSessions, { fields: [mpKfSessionEvents.sessionId], references: [mpKfSessions.id] }),
  fromKf: one(mpKfAccounts, { fields: [mpKfSessionEvents.fromKfId], references: [mpKfAccounts.id] }),
  toKf: one(mpKfAccounts, { fields: [mpKfSessionEvents.toKfId], references: [mpKfAccounts.id] }),
}));

export const mpKfRoutingConfigsRelations = relations(mpKfRoutingConfigs, ({ one }) => ({
  account: one(mpAccounts, { fields: [mpKfRoutingConfigs.accountId], references: [mpAccounts.id] }),
  tenant: one(tenants, { fields: [mpKfRoutingConfigs.tenantId], references: [tenants.id] }),
}));

// ════════════════════════════════════════════════════════════════════════════
// 报表中心（Report Center）—— 通用报表设计器 / 数据大屏
// ════════════════════════════════════════════════════════════════════════════
export const reportDatasourceTypeEnum = pgEnum('report_datasource_type', ['api', 'sql']);

/** 报表数据源：api=远程 HTTP；sql=内置只读主库 */
export const reportDatasources = pgTable('report_datasources', {
  id: serial('id').primaryKey(),
  name: varchar('name', { length: 64 }).notNull().unique(),
  type: reportDatasourceTypeEnum('type').notNull(),
  /** 连接配置：api→{url,method,headers}；sql→{connection:'internal'} */
  config: jsonb('config').$type<ReportDatasourceConfig>().notNull().default(sql`'{}'::jsonb`),
  status: statusEnum('status').notNull().default('enabled'),
  remark: varchar('remark', { length: 256 }),
  ...auditColumns(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().$onUpdate(() => new Date()).notNull(),
});
export type ReportDatasourceRow = typeof reportDatasources.$inferSelect;
export type NewReportDatasource = typeof reportDatasources.$inferInsert;

/** 报表数据集：绑定数据源 + 查询内容 + 字段定义 */
export const reportDatasets = pgTable('report_datasets', {
  id: serial('id').primaryKey(),
  name: varchar('name', { length: 64 }).notNull().unique(),
  datasourceId: integer('datasource_id').notNull().references(() => reportDatasources.id, { onDelete: 'restrict' }),
  /** 从数据源继承的类型（冗余，便于取数无需 JOIN） */
  type: reportDatasourceTypeEnum('type').notNull(),
  /** 查询内容：sql→{sql}；api→{itemsPath,params} */
  content: jsonb('content').$type<ReportDatasetContent>().notNull().default(sql`'{}'::jsonb`),
  /** 字段（列）定义 */
  fields: jsonb('fields').$type<ReportField[]>().notNull().default(sql`'[]'::jsonb`),
  status: statusEnum('status').notNull().default('enabled'),
  remark: varchar('remark', { length: 256 }),
  ...auditColumns(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().$onUpdate(() => new Date()).notNull(),
});
export type ReportDatasetRow = typeof reportDatasets.$inferSelect;
export type NewReportDataset = typeof reportDatasets.$inferInsert;

/** 报表仪表盘：网格布局 + 组件配置 */
export const reportDashboards = pgTable('report_dashboards', {
  id: serial('id').primaryKey(),
  name: varchar('name', { length: 64 }).notNull().unique(),
  /** react-grid-layout 布局数组 */
  layout: jsonb('layout').$type<ReportGridItem[]>().notNull().default(sql`'[]'::jsonb`),
  /** 组件配置数组 */
  widgets: jsonb('widgets').$type<ReportWidget[]>().notNull().default(sql`'[]'::jsonb`),
  status: statusEnum('status').notNull().default('enabled'),
  remark: varchar('remark', { length: 256 }),
  ...auditColumns(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().$onUpdate(() => new Date()).notNull(),
});
export type ReportDashboardRow = typeof reportDashboards.$inferSelect;
export type NewReportDashboard = typeof reportDashboards.$inferInsert;

export const reportDatasourcesRelations = relations(reportDatasources, ({ many }) => ({
  datasets: many(reportDatasets),
}));
export const reportDatasetsRelations = relations(reportDatasets, ({ one }) => ({
  datasource: one(reportDatasources, { fields: [reportDatasets.datasourceId], references: [reportDatasources.id] }),
}));
