import { pgTable, serial, varchar, timestamp, pgEnum, integer, boolean, primaryKey, unique, text, uniqueIndex, jsonb } from 'drizzle-orm/pg-core';

export const statusEnum = pgEnum('status', ['active', 'disabled']);
export const menuTypeEnum = pgEnum('menu_type', ['directory', 'menu', 'button']);
export const fileStorageProviderEnum = pgEnum('file_storage_provider', ['local', 'oss', 's3', 'cos']);
export const dataScopeEnum = pgEnum('data_scope', ['all', 'dept', 'self']);

// ─── 租户表 ───────────────────────────────────────────────────────────────────
export const tenants = pgTable('tenants', {
  id: serial('id').primaryKey(),
  name: varchar('name', { length: 100 }).notNull(),
  code: varchar('code', { length: 50 }).notNull().unique(),
  logo: varchar('logo', { length: 500 }),
  contactName: varchar('contact_name', { length: 50 }),
  contactPhone: varchar('contact_phone', { length: 20 }),
  status: statusEnum('status').notNull().default('active'),
  expireAt: timestamp('expire_at', { withTimezone: true }),
  maxUsers: integer('max_users'),
  remark: text('remark'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export type TenantRow = typeof tenants.$inferSelect;
export type NewTenant = typeof tenants.$inferInsert;

// ─── 部门表 ───────────────────────────────────────────────────────────────────
export const departments = pgTable('departments', {
  id: serial('id').primaryKey(),
  parentId: integer('parent_id').notNull().default(0),
  name: varchar('name', { length: 64 }).notNull(),
  code: varchar('code', { length: 64 }).notNull(),
  leader: varchar('leader', { length: 32 }),
  phone: varchar('phone', { length: 32 }),
  email: varchar('email', { length: 128 }),
  sort: integer('sort').notNull().default(0),
  status: statusEnum('status').notNull().default('active'),
  tenantId: integer('tenant_id').references(() => tenants.id, { onDelete: 'cascade' }),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (t) => [unique('departments_tenant_code_unique').on(t.tenantId, t.code)]);

export type DepartmentRow = typeof departments.$inferSelect;
export type NewDepartment = typeof departments.$inferInsert;

// ─── 岗位表 ───────────────────────────────────────────────────────────────────
export const positions = pgTable('positions', {
  id: serial('id').primaryKey(),
  name: varchar('name', { length: 64 }).notNull(),
  code: varchar('code', { length: 64 }).notNull(),
  sort: integer('sort').notNull().default(0),
  status: statusEnum('status').notNull().default('active'),
  remark: varchar('remark', { length: 256 }),
  tenantId: integer('tenant_id').references(() => tenants.id, { onDelete: 'cascade' }),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
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
  departmentId: integer('department_id').references(() => departments.id, { onDelete: 'set null' }),
  tenantId: integer('tenant_id').references(() => tenants.id, { onDelete: 'cascade' }),
  status: statusEnum('status').notNull().default('active'),
  passwordUpdatedAt: timestamp('password_updated_at').defaultNow().notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
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
  code: varchar('code', { length: 64 }).notNull(),
  description: varchar('description', { length: 256 }),
  status: statusEnum('status').notNull().default('active'),
  dataScope: dataScopeEnum('data_scope').notNull().default('all'),
  tenantId: integer('tenant_id').references(() => tenants.id, { onDelete: 'cascade' }),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
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

// ─── 角色-菜单关联表 ──────────────────────────────────────────────────────────
export const roleMenus = pgTable('role_menus', {
  roleId: integer('role_id').notNull().references(() => roles.id, { onDelete: 'cascade' }),
  menuId: integer('menu_id').notNull().references(() => menus.id, { onDelete: 'cascade' }),
}, (t) => [primaryKey({ columns: [t.roleId, t.menuId] })]);

// ─── 字典表 ───────────────────────────────────────────────────────────────────
export const dicts = pgTable('dicts', {
  id: serial('id').primaryKey(),
  name: varchar('name', { length: 64 }).notNull(),
  code: varchar('code', { length: 64 }).notNull(),
  description: varchar('description', { length: 256 }),
  status: statusEnum('status').notNull().default('active'),
  tenantId: integer('tenant_id').references(() => tenants.id, { onDelete: 'cascade' }),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (t) => [unique('dicts_tenant_code_unique').on(t.tenantId, t.code)]);

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
  status: statusEnum('status').notNull().default('active'),
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
  tenantId: integer('tenant_id').references(() => tenants.id, { onDelete: 'cascade' }),
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
  tenantId: integer('tenant_id').references(() => tenants.id, { onDelete: 'cascade' }),
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
  beforeData: text('before_data'),
  afterData: text('after_data'),
  responseCode: integer('response_code'),
  durationMs: integer('duration_ms'),
  ip: varchar('ip', { length: 64 }),
  userAgent: varchar('user_agent', { length: 512 }),
  os: varchar('os', { length: 64 }),
  browser: varchar('browser', { length: 64 }),
  tenantId: integer('tenant_id').references(() => tenants.id, { onDelete: 'cascade' }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export type OperationLogRow = typeof operationLogs.$inferSelect;
export type NewOperationLog = typeof operationLogs.$inferInsert;

// ─── 通知公告表 ─────────────────────────────────────────────────────────────────
export const notices = pgTable('notices', {
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
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export type NoticeRow = typeof notices.$inferSelect;
export type NewNotice = typeof notices.$inferInsert;

// ─── 通知已读记录表 ───────────────────────────────────────────────────────────
export const noticeReads = pgTable('notice_reads', {
  id: serial('id').primaryKey(),
  noticeId: integer('notice_id').notNull().references(() => notices.id, { onDelete: 'cascade' }),
  userId: integer('user_id').notNull(),
  readAt: timestamp('read_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [unique('uniq_notice_user').on(t.noticeId, t.userId)]);

export type NoticeReadRow = typeof noticeReads.$inferSelect;

// ─── 通知收件人表 ─────────────────────────────────────────────────────────────
export const noticeRecipients = pgTable('notice_recipients', {
  id: serial('id').primaryKey(),
  noticeId: integer('notice_id').notNull().references(() => notices.id, { onDelete: 'cascade' }),
  recipientType: varchar('recipient_type', { length: 16 }).notNull(), // 'user' | 'role' | 'dept'
  recipientId: integer('recipient_id').notNull(),
}, (t) => [unique('uniq_notice_recipient').on(t.noticeId, t.recipientType, t.recipientId)]);

export type NoticeRecipientRow = typeof noticeRecipients.$inferSelect;

// ─── 系统参数配置表 ──────────────────────────────────────────────────────────
export const configTypeEnum = pgEnum('config_type', ['string', 'number', 'boolean', 'json']);

export const systemConfigs = pgTable('system_configs', {
  id: serial('id').primaryKey(),
  configKey: varchar('config_key', { length: 128 }).notNull(),
  configValue: varchar('config_value', { length: 4096 }).notNull().default(''),
  configType: configTypeEnum('config_type').notNull().default('string'),
  description: varchar('description', { length: 256 }).notNull().default(''),
  tenantId: integer('tenant_id').references(() => tenants.id, { onDelete: 'cascade' }),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
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
  lastRunAt: timestamp('last_run_at', { withTimezone: true }),
  nextRunAt: timestamp('next_run_at', { withTimezone: true }),
  lastRunStatus: cronRunStatusEnum('last_run_status'),
  lastRunMessage: varchar('last_run_message', { length: 1024 }),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export type CronJobRow = typeof cronJobs.$inferSelect;
export type NewCronJob = typeof cronJobs.$inferInsert;

// ─── 定时任务执行日志表 ────────────────────────────────────────────────────────
export const cronJobLogs = pgTable('cron_job_logs', {
  id:          serial('id').primaryKey(),
  jobId:       integer('job_id').notNull().references(() => cronJobs.id, { onDelete: 'cascade' }),
  jobName:     varchar('job_name', { length: 64 }).notNull(),
  startedAt:   timestamp('started_at', { withTimezone: true }).defaultNow().notNull(),
  endedAt:     timestamp('ended_at', { withTimezone: true }),
  durationMs:  integer('duration_ms'),
  status:      cronRunStatusEnum('status').notNull().default('running'),
  output:      text('output'),
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
  status:     statusEnum('status').notNull().default('active'),
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
  status: statusEnum('status').notNull().default('active'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
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
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
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
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
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
  createdBy: integer('created_by').references(() => users.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export type DbBackupRow = typeof dbBackups.$inferSelect;
export type NewDbBackup = typeof dbBackups.$inferInsert;

// ─── 个人 API Token 表 ─────────────────────────────────────────────────────────
export const userApiTokens = pgTable('user_api_tokens', {
  id: serial('id').primaryKey(),
  userId: integer('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  name: varchar('name', { length: 64 }).notNull(),
  token: varchar('token', { length: 128 }).notNull().unique(),
  lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
  expiresAt: timestamp('expires_at', { withTimezone: true }),
  createdAt: timestamp('created_at').defaultNow().notNull(),
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

// ─── 消息模板 ─────────────────────────────────────────────────────────────────
export const messageChannelEnum = pgEnum('message_channel', ['email', 'sms', 'in_app']);

export const messageTemplates = pgTable('message_templates', {
  id: serial('id').primaryKey(),
  name: varchar('name', { length: 100 }).notNull(),
  code: varchar('code', { length: 100 }).notNull().unique(),
  channel: messageChannelEnum('channel').notNull(),
  subject: varchar('subject', { length: 200 }),
  content: text('content').notNull(),
  variables: text('variables'),
  status: statusEnum('status').default('active').notNull(),
  remark: text('remark'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export type MessageTemplateRow = typeof messageTemplates.$inferSelect;
export type NewMessageTemplate = typeof messageTemplates.$inferInsert;

// ─── 工作流引擎 ───────────────────────────────────────────────────────────────

export const workflowDefinitionStatusEnum = pgEnum('workflow_definition_status', ['draft', 'published', 'disabled']);
export const workflowInstanceStatusEnum = pgEnum('workflow_instance_status', ['draft', 'running', 'approved', 'rejected', 'withdrawn']);
export const workflowTaskStatusEnum = pgEnum('workflow_task_status', ['pending', 'approved', 'rejected', 'skipped']);

// 流程定义
export const workflowDefinitions = pgTable('workflow_definitions', {
  id: serial('id').primaryKey(),
  name: varchar('name', { length: 64 }).notNull(),
  description: text('description'),
  flowData: jsonb('flow_data'), // React Flow 节点+边 JSON
  formFields: jsonb('form_fields'), // 表单字段配置 JSON
  status: workflowDefinitionStatusEnum('status').default('draft').notNull(),
  version: integer('version').default(1).notNull(),
  tenantId: integer('tenant_id').references(() => tenants.id, { onDelete: 'cascade' }),
  createdBy: integer('created_by').references(() => users.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export type WorkflowDefinitionRow = typeof workflowDefinitions.$inferSelect;
export type NewWorkflowDefinition = typeof workflowDefinitions.$inferInsert;

// 流程实例
export const workflowInstances = pgTable('workflow_instances', {
  id: serial('id').primaryKey(),
  definitionId: integer('definition_id').notNull().references(() => workflowDefinitions.id, { onDelete: 'restrict' }),
  definitionSnapshot: jsonb('definition_snapshot').notNull(), // 发起时的定义快照
  title: varchar('title', { length: 128 }).notNull(),
  formData: jsonb('form_data'), // 填写的表单数据
  status: workflowInstanceStatusEnum('status').default('draft').notNull(),
  currentNodeKey: varchar('current_node_key', { length: 64 }),
  initiatorId: integer('initiator_id').notNull().references(() => users.id, { onDelete: 'restrict' }),
  tenantId: integer('tenant_id').references(() => tenants.id, { onDelete: 'cascade' }),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export type WorkflowInstanceRow = typeof workflowInstances.$inferSelect;
export type NewWorkflowInstance = typeof workflowInstances.$inferInsert;

// 审批任务
export const workflowTasks = pgTable('workflow_tasks', {
  id: serial('id').primaryKey(),
  instanceId: integer('instance_id').notNull().references(() => workflowInstances.id, { onDelete: 'cascade' }),
  nodeKey: varchar('node_key', { length: 64 }).notNull(),
  nodeName: varchar('node_name', { length: 64 }).notNull(),
  assigneeId: integer('assignee_id').references(() => users.id, { onDelete: 'set null' }),
  status: workflowTaskStatusEnum('status').default('pending').notNull(),
  comment: text('comment'),
  actionAt: timestamp('action_at', { withTimezone: true }),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export type WorkflowTaskRow = typeof workflowTasks.$inferSelect;
export type NewWorkflowTask = typeof workflowTasks.$inferInsert;
