import { pgTable, serial, varchar, timestamp, pgEnum, integer, boolean, primaryKey } from 'drizzle-orm/pg-core';

export const statusEnum = pgEnum('status', ['active', 'disabled']);
export const menuTypeEnum = pgEnum('menu_type', ['directory', 'menu', 'button']);
export const fileStorageProviderEnum = pgEnum('file_storage_provider', ['local', 'oss']);

export const users = pgTable('users', {
  id: serial('id').primaryKey(),
  username: varchar('username', { length: 32 }).notNull().unique(),
  nickname: varchar('nickname', { length: 32 }).notNull(),
  email: varchar('email', { length: 128 }).notNull().unique(),
  password: varchar('password', { length: 128 }).notNull(),
  avatar: varchar('avatar', { length: 256 }),
  status: statusEnum('status').notNull().default('active'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

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
  sort: integer('sort').notNull().default(0),
  status: statusEnum('status').notNull().default('active'),
  visible: boolean('visible').notNull().default(true),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export type MenuRow = typeof menus.$inferSelect;
export type NewMenu = typeof menus.$inferInsert;

// ─── 角色表 ───────────────────────────────────────────────────────────────────
export const roles = pgTable('roles', {
  id: serial('id').primaryKey(),
  name: varchar('name', { length: 64 }).notNull(),
  code: varchar('code', { length: 64 }).notNull().unique(),
  description: varchar('description', { length: 256 }),
  status: statusEnum('status').notNull().default('active'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export type RoleRow = typeof roles.$inferSelect;
export type NewRole = typeof roles.$inferInsert;

// ─── 用户-角色关联表 ──────────────────────────────────────────────────────────
export const userRoles = pgTable('user_roles', {
  userId: integer('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  roleId: integer('role_id').notNull().references(() => roles.id, { onDelete: 'cascade' }),
}, (t) => [primaryKey({ columns: [t.userId, t.roleId] })]);

// ─── 角色-菜单关联表 ──────────────────────────────────────────────────────────
export const roleMenus = pgTable('role_menus', {
  roleId: integer('role_id').notNull().references(() => roles.id, { onDelete: 'cascade' }),
  menuId: integer('menu_id').notNull().references(() => menus.id, { onDelete: 'cascade' }),
}, (t) => [primaryKey({ columns: [t.roleId, t.menuId] })]);

// ─── 字典表 ───────────────────────────────────────────────────────────────────
export const dicts = pgTable('dicts', {
  id: serial('id').primaryKey(),
  name: varchar('name', { length: 64 }).notNull(),
  code: varchar('code', { length: 64 }).notNull().unique(),
  description: varchar('description', { length: 256 }),
  status: statusEnum('status').notNull().default('active'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export type DictRow = typeof dicts.$inferSelect;
export type NewDict = typeof dicts.$inferInsert;

// ─── 字典项表 ─────────────────────────────────────────────────────────────────
export const dictItems = pgTable('dict_items', {
  id: serial('id').primaryKey(),
  dictId: integer('dict_id').notNull().references(() => dicts.id, { onDelete: 'cascade' }),
  label: varchar('label', { length: 64 }).notNull(),
  value: varchar('value', { length: 64 }).notNull(),
  color: varchar('color', { length: 32 }),
  sort: integer('sort').notNull().default(0),
  status: statusEnum('status').notNull().default('active'),
  remark: varchar('remark', { length: 256 }),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export type DictItemRow = typeof dictItems.$inferSelect;
export type NewDictItem = typeof dictItems.$inferInsert;

// ─── 文件存储配置表 ──────────────────────────────────────────────────────────
export const fileStorageConfigs = pgTable('file_storage_configs', {
  id: serial('id').primaryKey(),
  name: varchar('name', { length: 64 }).notNull(),
  provider: fileStorageProviderEnum('provider').notNull().default('local'),
  status: statusEnum('status').notNull().default('active'),
  isDefault: boolean('is_default').notNull().default(false),
  basePath: varchar('base_path', { length: 256 }),
  localRootPath: varchar('local_root_path', { length: 512 }),
  ossRegion: varchar('oss_region', { length: 64 }),
  ossEndpoint: varchar('oss_endpoint', { length: 128 }),
  ossBucket: varchar('oss_bucket', { length: 128 }),
  ossAccessKeyId: varchar('oss_access_key_id', { length: 128 }),
  ossAccessKeySecret: varchar('oss_access_key_secret', { length: 256 }),
  remark: varchar('remark', { length: 256 }),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
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
  size: integer('size').notNull().default(0),
  mimeType: varchar('mime_type', { length: 128 }),
  extension: varchar('extension', { length: 32 }),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
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
  browser: varchar('browser', { length: 64 }),
  os: varchar('os', { length: 64 }),
  status: loginStatusEnum('status').notNull(),
  message: varchar('message', { length: 256 }),
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
  requestBody: varchar('request_body', { length: 4096 }),
  responseCode: integer('response_code'),
  durationMs: integer('duration_ms'),
  ip: varchar('ip', { length: 64 }),
  userAgent: varchar('user_agent', { length: 512 }),
  os: varchar('os', { length: 64 }),
  browser: varchar('browser', { length: 64 }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export type OperationLogRow = typeof operationLogs.$inferSelect;
export type NewOperationLog = typeof operationLogs.$inferInsert;
