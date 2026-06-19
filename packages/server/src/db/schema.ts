import { pgTable, serial, varchar, timestamp, pgEnum, integer, boolean, primaryKey, unique, text, uniqueIndex, index, jsonb, smallint, real, date, type AnyPgColumn } from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';

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
  remark: text('remark'),
  ...auditColumns(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().$onUpdate(() => new Date()).notNull(),
});

export type TenantRow = typeof tenants.$inferSelect;
export type NewTenant = typeof tenants.$inferInsert;

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
  id: serial('id').primaryKey(),
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

// ─── 登录日志表 ─────────────────────────────────────────────────────────────────
export const loginStatusEnum = pgEnum('login_status', ['success', 'fail']);

export const loginLogs = pgTable('login_logs', {
  id: serial('id').primaryKey(),
  userId: integer('user_id'),
  username: varchar('username', { length: 64 }).notNull(),
  ip: varchar('ip', { length: 64 }),
  location: varchar('location', { length: 128 }),
  browser: varchar('browser', { length: 64 }),
  os: varchar('os', { length: 64 }),
  userAgent: varchar('user_agent', { length: 512 }),
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

// ─── 用户行为事件表 ─────────────────────────────────────────────────────────────
export const userBehaviorEventTypeEnum = pgEnum('user_behavior_event_type', ['page_view', 'page_leave', 'feature_use', 'area_click']);

export const userEvents = pgTable('user_events', {
  id: serial('id').primaryKey(),
  userId: integer('user_id'),
  username: varchar('username', { length: 64 }),
  tenantId: integer('tenant_id').references(() => tenants.id, { onDelete: 'cascade' }),
  sessionId: varchar('session_id', { length: 36 }),
  eventType: userBehaviorEventTypeEnum('event_type').notNull(),
  pagePath: varchar('page_path', { length: 256 }).notNull(),
  pageTitle: varchar('page_title', { length: 128 }),
  elementKey: varchar('element_key', { length: 128 }),
  elementLabel: varchar('element_label', { length: 128 }),
  componentArea: varchar('component_area', { length: 64 }),
  clickX: real('click_x'),
  clickY: real('click_y'),
  durationMs: integer('duration_ms'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export type UserEventRow = typeof userEvents.$inferSelect;
export type NewUserEvent = typeof userEvents.$inferInsert;

// ─── 前端错误上报表 ────────────────────────────────────────────────────────────
export const frontendErrorTypeEnum = pgEnum('frontend_error_type', ['js_error', 'promise_rejection', 'resource_error', 'console_error']);

export const frontendErrors = pgTable('frontend_errors', {
  id: serial('id').primaryKey(),
  fingerprint: varchar('fingerprint', { length: 64 }).notNull(), // MD5(type+message+source) for dedup
  errorType: frontendErrorTypeEnum('error_type').notNull(),
  message: text('message').notNull(),
  stack: text('stack'),
  sourceUrl: varchar('source_url', { length: 512 }),
  lineNo: integer('line_no'),
  colNo: integer('col_no'),
  pageUrl: varchar('page_url', { length: 512 }),
  userAgent: varchar('user_agent', { length: 512 }),
  userId: integer('user_id'),
  username: varchar('username', { length: 64 }),
  tenantId: integer('tenant_id').references(() => tenants.id, { onDelete: 'cascade' }),
  sessionId: varchar('session_id', { length: 36 }),
  count: integer('count').notNull().default(1),
  firstSeenAt: timestamp('first_seen_at', { withTimezone: true }).notNull().defaultNow(),
  lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull().defaultNow(),
});

export type FrontendErrorRow = typeof frontendErrors.$inferSelect;
export type NewFrontendError = typeof frontendErrors.$inferInsert;

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
  fileId: integer('file_id').notNull().references(() => managedFiles.id, { onDelete: 'cascade' }),
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
  fileId: integer('file_id').references(() => managedFiles.id, { onDelete: 'set null' }),
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
}, (t) => [unique('workflow_categories_code_uniq').on(t.code)]);

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
}, (t) => [unique('workflow_forms_code_uniq').on(t.code)]);

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
  publishedAt: timestamp('published_at', { withTimezone: true }).defaultNow().notNull(),
  publishedBy: integer('published_by').references(() => users.id, { onDelete: 'set null' }),
  tenantId: integer('tenant_id').references(() => tenants.id, { onDelete: 'cascade' }),
}, (t) => [unique('workflow_def_versions_def_ver_uniq').on(t.definitionId, t.version)]);

export type WorkflowDefinitionVersionRow = typeof workflowDefinitionVersions.$inferSelect;
export type NewWorkflowDefinitionVersion = typeof workflowDefinitionVersions.$inferInsert;

// 流程级自动化规则：当实例终结（通过/拒绝/撤回）时执行的动作
export const workflowAutomationTriggerEnum = pgEnum('workflow_automation_trigger', ['approved', 'rejected', 'withdrawn']);

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
export type WorkflowAutomationActionConfig =
  | WorkflowAutomationActionStartWorkflow
  | WorkflowAutomationActionSendMessage;

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

// 流程实例
export const workflowInstances = pgTable('workflow_instances', {
  id: serial('id').primaryKey(),
  definitionId: integer('definition_id').notNull().references(() => workflowDefinitions.id, { onDelete: 'restrict' }),
  definitionSnapshot: jsonb('definition_snapshot').notNull(), // 发起时的定义快照
  formSnapshot: jsonb('form_snapshot'), // 发起时的表单结构快照（WorkflowFormField[]），冻结历史不受表单修改影响
  title: varchar('title', { length: 128 }).notNull(),
  formData: jsonb('form_data'), // 填写的表单数据
  status: workflowInstanceStatusEnum('status').default('draft').notNull(),
  currentNodeKey: varchar('current_node_key', { length: 64 }),
  initiatorId: integer('initiator_id').notNull().references(() => users.id, { onDelete: 'restrict' }),
  tenantId: integer('tenant_id').references(() => tenants.id, { onDelete: 'cascade' }),
  /** 子流程：父实例 ID（subProcess 节点触发产生的子实例填此字段） */
  parentInstanceId: integer('parent_instance_id'),
  /** 子流程：父实例中触发本子流程的 subProcess 任务 ID，子实例完成时用于唤醒父任务 */
  parentTaskId: integer('parent_task_id'),
  ...auditColumns(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().$onUpdate(() => new Date()).notNull(),
});

export type WorkflowInstanceRow = typeof workflowInstances.$inferSelect;
export type NewWorkflowInstance = typeof workflowInstances.$inferInsert;

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
export const chatMessageTypeEnum = pgEnum('chat_message_type', ['text', 'image', 'file', 'system', 'forward', 'vote', 'voice']);

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

// ─── 关系声明（Drizzle Relational Query API）──────────────────────────────────
// 声明后可使用 db.query.xxx.findMany({ with: { ... } }) 进行关联查询

export const tenantsRelations = relations(tenants, ({ many }) => ({
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
  tokensInput: integer('tokens_input').notNull().default(0),
  tokensOutput: integer('tokens_output').notNull().default(0),
  /** 用户反馈：1 = 👍 点赞，-1 = 👎 点踩，null = 未反馈 */
  feedback: integer('feedback'),
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
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (t) => [
  unique().on(t.memberId, t.checkinDate),
]);
export type MemberCheckinRow = typeof memberCheckins.$inferSelect;
export type NewMemberCheckin = typeof memberCheckins.$inferInsert;

export const memberCheckinsRelations = relations(memberCheckins, ({ one }) => ({
  member: one(members, { fields: [memberCheckins.memberId], references: [members.id] }),
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
