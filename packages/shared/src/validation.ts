import { z } from 'zod';
import { REPORT_DATASOURCE_TYPES, REPORT_WIDGET_TYPES } from './types';
import type { WorkflowFormField, MpMenuButton, MpArticle } from './types';
import { FILE_OBJECT_ACL_SUPPORT } from './constants';

const DATE_TIME_PATTERN = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/;
const dateTimeStringSchema = z.string().regex(DATE_TIME_PATTERN, '日期时间格式必须为 YYYY-MM-DD HH:mm:ss');

export const loginSchema = z.object({
  username: z.string().min(2, '用户名至少2个字符').max(32),
  password: z.string().min(6, '密码至少6个字符').max(64),
  captchaId: z.string().optional(),
  captchaCode: z.string().optional(),
  tenantCode: z.string().max(50).optional(),
});

export const registerSchema = z.object({
  username: z.string().min(2, '用户名至少2个字符').max(32),
  nickname: z.string().min(1, '昵称不能为空').max(32),
  email: z.email('邮箱格式不正确'),
  password: z.string().min(6, '密码至少6个字符').max(64),
});

export const createUserSchema = z.object({
  username: z.string().min(2).max(32),
  nickname: z.string().min(1).max(32),
  email: z.email(),
  password: z.string().min(6).max(64),
  phone: z.preprocess(
    (value) => (value === '' ? undefined : value),
    z.string().regex(/^1[3-9]\d{9}$/, '请输入正确的手机号码').optional()
  ),
  departmentId: z.number().int().positive().nullable().optional(),
  positionIds: z.array(z.number().int().positive()).default([]),
  roleIds: z.array(z.number().int()).default([]),
  status: z.enum(['enabled', 'disabled']).default('enabled'),
});

export const updateUserSchema = createUserSchema.partial().omit({ password: true });

export const changePasswordSchema = z.object({
  oldPassword: z.string().min(6, '原密码至少6个字符').max(64),
  newPassword: z.string().min(6, '新密码至少6个字符').max(64),
});

export const forgotPasswordSchema = z.object({
  email: z.email('邮箱格式不正确'),
});

export const resetPasswordSchema = z.object({
  token: z.string().min(1, 'token 不能为空'),
  newPassword: z.string().min(6, '新密码至少6个字符').max(64),
});

export type ForgotPasswordInput = z.infer<typeof forgotPasswordSchema>;
export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;

export const resetUserPasswordSchema = z.object({
  password: z.string().min(6, '新密码至少6个字符').max(64),
});

export const createExportJobSchema = z.object({
  entity: z.string().min(1, '导出实体不能为空').max(128),
  format: z.enum(['xlsx', 'csv']).default('xlsx'),
  query: z.record(z.string(), z.unknown()).optional().default({}),
  columns: z.array(z.string().min(1).max(128)).optional(),
  raw: z.boolean().optional().default(true),
  watermark: z.boolean().optional().default(true),
  executionMode: z.enum(['sync', 'async', 'auto']).optional().default('sync'),
});

export const updateProfileSchema = z.object({
  nickname: z.string().min(1, '昵称不能为空').max(32).optional(),
  email: z.email('邮箱格式不正确').optional(),
  avatar: z.string().max(256).optional(),
});

// ─── 菜单 Schema ──────────────────────────────────────────────────────────────
export const createMenuSchema = z.object({
  parentId: z.number().int().default(0),
  title: z.string().min(1, '菜单标题不能为空').max(64),
  name: z.string().max(64).optional(),
  path: z.string().max(256).optional(),
  component: z.string().max(256).optional(),
  icon: z.string().max(64).optional(),
  type: z.enum(['directory', 'menu', 'button']).default('menu'),
  permission: z.string().max(128).optional(),
  sort: z.number().int().default(0),
  status: z.enum(['enabled', 'disabled']).default('enabled'),
  visible: z.boolean().default(true),
});

export const updateMenuSchema = createMenuSchema.partial();

// ─── 角色 Schema ──────────────────────────────────────────────────────────────
export const createRoleSchema = z.object({
  name: z.string().min(1, '角色名称不能为空').max(64),
  code: z.string().min(1, '角色编码不能为空').max(64).regex(/^[a-z_]+$/, '角色编码只能包含小写字母和下划线'),
  description: z.string().max(256).optional(),
  status: z.enum(['enabled', 'disabled']).default('enabled'),
  dataScope: z.enum(['all', 'custom', 'dept_only', 'dept', 'self']).default('all'),
  deptScopeIds: z.array(z.number().int().positive()).optional().nullable(),
});

export const updateRoleSchema = createRoleSchema.partial();

export const assignRoleMenusSchema = z.object({
  menuIds: z.array(z.number().int()),
});

export const assignRoleUsersSchema = z.object({
  userIds: z.array(z.number().int()),
});

// ─── 部门 Schema ──────────────────────────────────────────────────────────────
export const createDepartmentSchema = z.object({
  parentId: z.number().int().min(0).default(0),
  name: z.string().min(1, '部门名称不能为空').max(64),
  code: z.string().min(1, '部门编码不能为空').max(64).regex(/^\w+$/, '部门编码只能包含字母、数字和下划线'),
  category: z.enum(['group', 'company', 'department']).default('department'),
  leaderId: z.number().int().nullable().optional(),
  phone: z.string().max(32).optional(),
  email: z.preprocess(
    (value) => (value === '' ? undefined : value),
    z.email('邮箱格式不正确').optional()
  ),
  sort: z.number().int().default(0),
  status: z.enum(['enabled', 'disabled']).default('enabled'),
});

export const updateDepartmentSchema = createDepartmentSchema.partial();

// ─── 岗位 Schema ──────────────────────────────────────────────────────────────
export const createPositionSchema = z.object({
  name: z.string().min(1, '岗位名称不能为空').max(64),
  code: z.string().min(1, '岗位编码不能为空').max(64).regex(/^\w+$/, '岗位编码只能包含字母、数字和下划线'),
  sort: z.number().int().default(0),
  status: z.enum(['enabled', 'disabled']).default('enabled'),
  remark: z.string().max(256).optional(),
});

export const updatePositionSchema = createPositionSchema.partial();

// ─── 用户组 Schema ────────────────────────────────────────────────────────
export const createUserGroupSchema = z.object({
  name: z.string().min(1, '用户组名称不能为空').max(64),
  code: z.string().min(1, '用户组编码不能为空').max(64).regex(/^\w+$/, '用户组编码只能包含字母、数字和下划线'),
  description: z.string().max(256).optional(),
  ownerId: z.number().int().positive().nullable().optional(),
  departmentId: z.number().int().positive().nullable().optional(),
  status: z.enum(['enabled', 'disabled']).default('enabled'),
});

export const updateUserGroupSchema = createUserGroupSchema.partial();

export const assignUserGroupMembersSchema = z.object({
  userIds: z.array(z.number().int().positive()),
});

// ─── 字典 Schema ──────────────────────────────────────────────────────────────
export const createDictSchema = z.object({
  name: z.string().min(1, '字典名称不能为空').max(64),
  code: z.string().min(1, '字典编码不能为空').max(64).regex(/^[a-z_]+$/, '字典编码只能包含小写字母和下划线'),
  description: z.string().max(256).optional(),
  status: z.enum(['enabled', 'disabled']).default('enabled'),
});

export const updateDictSchema = createDictSchema.partial();

export const createDictItemSchema = z.object({
  label: z.string().min(1, '标签不能为空').max(64),
  value: z.string().min(1, '键值不能为空').max(64),
  color: z.string().max(32).nullish(),
  sort: z.number().int().default(0),
  status: z.enum(['enabled', 'disabled']).default('enabled'),
  remark: z.string().max(256).nullish(),
  parentId: z.number().int().nullable().optional(),
  metadata: z.record(z.string(), z.unknown()).nullable().optional(),
});

export const updateDictItemSchema = createDictItemSchema.partial();

// ─── 文件管理 Schema ─────────────────────────────────────────────────────────
const baseFileStorageConfigSchema = z.object({
  name: z.string().min(1, '配置名称不能为空').max(64),
  provider: z.enum(['local', 'oss', 's3', 'cos', 'obs', 'kodo', 'bos', 'azure', 'sftp']),
  status: z.enum(['enabled', 'disabled']).default('enabled'),
  isDefault: z.boolean().default(false),
  basePath: z.string().max(256).optional(),
  // 对象读写权限（仅 oss/s3/cos/obs/bos 生效）；default = 继承 Bucket
  objectAcl: z.enum(['default', 'private', 'public-read', 'public-read-write']).default('default'),
  // 本地存储
  localRootPath: z.string().max(512).optional(),
  // 阿里云 OSS
  ossRegion: z.string().max(64).optional(),
  ossEndpoint: z.string().max(128).optional(),
  ossBucket: z.string().max(128).optional(),
  ossAccessKeyId: z.string().max(128).optional(),
  ossAccessKeySecret: z.string().max(256).optional(),
  // S3 兼容存储
  s3Region: z.string().max(64).optional(),
  s3Endpoint: z.string().max(256).optional(),
  s3Bucket: z.string().max(128).optional(),
  s3AccessKeyId: z.string().max(128).optional(),
  s3SecretAccessKey: z.string().max(256).optional(),
  s3ForcePathStyle: z.boolean().optional(),
  // 腾讯云 COS
  cosRegion: z.string().max(64).optional(),
  cosBucket: z.string().max(128).optional(),
  cosSecretId: z.string().max(128).optional(),
  cosSecretKey: z.string().max(256).optional(),
  // 华为云 OBS
  obsEndpoint: z.string().max(256).optional(),
  obsBucket: z.string().max(128).optional(),
  obsAccessKeyId: z.string().max(128).optional(),
  obsSecretAccessKey: z.string().max(256).optional(),
  // 七牛云 Kodo
  kodoAccessKey: z.string().max(128).optional(),
  kodoSecretKey: z.string().max(256).optional(),
  kodoBucket: z.string().max(128).optional(),
  kodoRegion: z.string().max(64).optional(),
  kodoEndpoint: z.string().max(256).optional(),
  // 百度云 BOS
  bosEndpoint: z.string().max(256).optional(),
  bosBucket: z.string().max(128).optional(),
  bosAccessKeyId: z.string().max(128).optional(),
  bosSecretAccessKey: z.string().max(256).optional(),
  // Azure Blob Storage
  azureAccountName: z.string().max(128).optional(),
  azureAccountKey: z.string().max(256).optional(),
  azureContainerName: z.string().max(128).optional(),
  azureEndpoint: z.string().max(256).optional(),
  // SFTP
  sftpHost: z.string().max(256).optional(),
  sftpPort: z.number().int().min(1).max(65535).optional(),
  sftpUsername: z.string().max(128).optional(),
  sftpPassword: z.string().max(256).optional(),
  sftpPrivateKey: z.string().optional(),
  sftpRootPath: z.string().max(512).optional(),
  sftpBaseUrl: z.string().max(512).optional(),
  remark: z.string().max(256).optional(),
});

export const createFileStorageConfigSchema = baseFileStorageConfigSchema.superRefine((data, ctx) => {
  const supportedAcls = FILE_OBJECT_ACL_SUPPORT[data.provider];
  if (data.objectAcl !== 'default' && !(supportedAcls ?? []).includes(data.objectAcl)) {
    const message = supportedAcls
      ? `该存储类型的对象读写权限仅支持：${supportedAcls.join(' / ')}`
      : '该存储类型不支持设置对象读写权限';
    ctx.addIssue({ code: 'custom', message, path: ['objectAcl'] });
  }
  if (data.provider === 'local' && !data.localRootPath) {
    ctx.addIssue({ code: 'custom', message: '本地磁盘配置需要填写存储目录', path: ['localRootPath'] });
  }
  if (data.provider === 'oss') {
    const requiredFields: Array<keyof typeof data> = ['ossRegion', 'ossEndpoint', 'ossBucket', 'ossAccessKeyId', 'ossAccessKeySecret'];
    for (const field of requiredFields) {
      if (!data[field]) {
        ctx.addIssue({ code: 'custom', message: 'OSS 配置项不能为空', path: [field] });
      }
    }
  }
  if (data.provider === 's3') {
    const requiredFields: Array<keyof typeof data> = ['s3Region', 's3Bucket', 's3AccessKeyId', 's3SecretAccessKey'];
    for (const field of requiredFields) {
      if (!data[field]) {
        ctx.addIssue({ code: 'custom', message: 'S3 配置项不能 为空', path: [field] });
      }
    }
  }
  if (data.provider === 'cos') {
    const requiredFields: Array<keyof typeof data> = ['cosRegion', 'cosBucket', 'cosSecretId', 'cosSecretKey'];
    for (const field of requiredFields) {
      if (!data[field]) {
        ctx.addIssue({ code: 'custom', message: '腾讯云 COS 配 置项不能为空', path: [field] });
      }
    }
  }
  if (data.provider === 'obs') {
    const requiredFields: Array<keyof typeof data> = ['obsEndpoint', 'obsBucket', 'obsAccessKeyId', 'obsSecretAccessKey'];
    for (const field of requiredFields) {
      if (!data[field]) ctx.addIssue({ code: 'custom', message: '华为云 OBS 配置项不能为空', path: [field] });
    }
  }
  if (data.provider === 'kodo') {
    const requiredFields: Array<keyof typeof data> = ['kodoAccessKey', 'kodoSecretKey', 'kodoBucket'];
    for (const field of requiredFields) {
      if (!data[field]) ctx.addIssue({ code: 'custom', message: '七牛云 Kodo 配置项不能为空', path: [field] });
    }
  }
  if (data.provider === 'bos') {
    const requiredFields: Array<keyof typeof data> = ['bosEndpoint', 'bosBucket', 'bosAccessKeyId', 'bosSecretAccessKey'];
    for (const field of requiredFields) {
      if (!data[field]) ctx.addIssue({ code: 'custom', message: '百度云 BOS 配置项不能为空', path: [field] });
    }
  }
  if (data.provider === 'azure') {
    const requiredFields: Array<keyof typeof data> = ['azureAccountName', 'azureAccountKey', 'azureContainerName'];
    for (const field of requiredFields) {
      if (!data[field]) ctx.addIssue({ code: 'custom', message: 'Azure Blob 配置项不能为空', path: [field] });
    }
  }
  if (data.provider === 'sftp') {
    const requiredFields: Array<keyof typeof data> = ['sftpHost', 'sftpUsername'];
    for (const field of requiredFields) {
      if (!data[field]) ctx.addIssue({ code: 'custom', message: 'SFTP 配置项不能为空', path: [field] });
    }
  }
});

export const updateFileStorageConfigSchema = baseFileStorageConfigSchema.partial();

// ─── 分片上传 ─────────────────────────────────────────────────────────────────
export const initChunkUploadSchema = z.object({
  fileName: z.string().min(1, '文件名不能为空').max(256),
  fileSize: z.number().int().nonnegative(),
  mimeType: z.string().max(128).optional(),
  chunkSize: z.number().int().positive().max(100 * 1024 * 1024),
});
export const completeChunkUploadSchema = z.object({
  uploadId: z.string().min(1).max(64),
});
export type InitChunkUploadInput = z.infer<typeof initChunkUploadSchema>;
export type CompleteChunkUploadInput = z.infer<typeof completeChunkUploadSchema>;

export type LoginInput = z.infer<typeof loginSchema>;
export type RegisterInput = z.infer<typeof registerSchema>;
export type CreateUserInput = z.infer<typeof createUserSchema>;
export type UpdateUserInput = z.infer<typeof updateUserSchema>;
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;
export type ResetUserPasswordInput = z.infer<typeof resetUserPasswordSchema>;
export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;
export type CreateMenuInput = z.infer<typeof createMenuSchema>;
export type UpdateMenuInput = z.infer<typeof updateMenuSchema>;
export type CreateRoleInput = z.infer<typeof createRoleSchema>;
export type UpdateRoleInput = z.infer<typeof updateRoleSchema>;
export type AssignRoleMenusInput = z.infer<typeof assignRoleMenusSchema>;
export type CreateDepartmentInput = z.infer<typeof createDepartmentSchema>;
export type UpdateDepartmentInput = z.infer<typeof updateDepartmentSchema>;
export type CreatePositionInput = z.infer<typeof createPositionSchema>;
export type UpdatePositionInput = z.infer<typeof updatePositionSchema>;
export type CreateUserGroupInput = z.infer<typeof createUserGroupSchema>;
export type UpdateUserGroupInput = z.infer<typeof updateUserGroupSchema>;
export type AssignUserGroupMembersInput = z.infer<typeof assignUserGroupMembersSchema>;
export type CreateDictInput = z.infer<typeof createDictSchema>;
export type UpdateDictInput = z.infer<typeof updateDictSchema>;
export type CreateDictItemInput = z.infer<typeof createDictItemSchema>;
export type UpdateDictItemInput = z.infer<typeof updateDictItemSchema>;
export type CreateFileStorageConfigInput = z.infer<typeof createFileStorageConfigSchema>;
export type UpdateFileStorageConfigInput = z.infer<typeof updateFileStorageConfigSchema>;

// ─── 公告 Schema ─────────────────────────────────────────────────────────────
export const announcementRecipientSchema = z.object({
  recipientType: z.enum(['user', 'role', 'dept']),
  recipientId: z.number().int().positive(),
});

export const createAnnouncementSchema = z.object({
  title: z.string().min(1, '标题不能为空').max(128),
  content: z.string().min(1, '内容不能为空').max(4096),
  type: z.string().min(1).max(32).default('notice'),
  publishStatus: z.enum(['draft', 'published', 'recalled', 'scheduled']).default('draft'),
  priority: z.string().min(1).max(32).default('medium'),
  targetType: z.enum(['all', 'specific']).default('all'),
  recipients: z.array(announcementRecipientSchema).optional().default([]),
  publishTime: dateTimeStringSchema.optional().nullable(),
  fileIds: z.array(z.string().uuid()).optional().default([]),
});

export const updateAnnouncementSchema = z.object({
  title: z.string().min(1, '标题不能为空').max(128).optional(),
  content: z.string().min(1, '内容不能为空').max(4096).optional(),
  type: z.string().min(1).max(32).optional(),
  publishStatus: z.enum(['draft', 'published', 'recalled', 'scheduled']).optional(),
  priority: z.string().min(1).max(32).optional(),
  targetType: z.enum(['all', 'specific']).optional(),
  recipients: z.array(announcementRecipientSchema).optional(),
  publishTime: dateTimeStringSchema.optional().nullable(),
  fileIds: z.array(z.string().uuid()).optional(),
});

export type CreateAnnouncementInput = z.infer<typeof createAnnouncementSchema>;
export type UpdateAnnouncementInput = z.infer<typeof updateAnnouncementSchema>;
export type AnnouncementRecipientInput = z.infer<typeof announcementRecipientSchema>;

// ─── 系统参数配置 Schema ─────────────────────────────────────────────────────
export const createSystemConfigSchema = z.object({
  configKey: z.string().min(1, '键名不能为空').max(128).regex(/^[\w.]+$/, '键名只能包含字母、数字、下划线和点号'),
  configValue: z.string().max(4096),
  configType: z.enum(['string', 'number', 'boolean', 'json']).default('string'),
  description: z.string().max(256).default(''),
});

export const updateSystemConfigSchema = createSystemConfigSchema.partial();

export type CreateSystemConfigInput = z.infer<typeof createSystemConfigSchema>;
export type UpdateSystemConfigInput = z.infer<typeof updateSystemConfigSchema>;

// ─── 定时任务 Schema ────────────────────────────────────────────────────────
export const createCronJobSchema = z.object({
  name: z.string().min(1, '任务名称不能为空').max(64),
  cronExpression: z.string().min(1, 'Cron 表达式不能为空').max(128),
  handler: z.string().min(1, '处理器不能为空').max(128),
  params: z.string().max(4096).nullable().optional(),
  status: z.enum(['enabled', 'disabled']).default('disabled'),
  description: z.string().max(256).default(''),
  retryCount: z.number().int().min(0, '重试次数不能为负').max(10).default(0),
  /** 重试间隔，单位：秒 */
  retryInterval: z.number().int().min(0, '重试间隔不能为负').default(0),
  retryBackoff: z.boolean().default(false),
  monitorTimeout: z.number().int().min(0).nullable().optional(),
});

export const updateCronJobSchema = createCronJobSchema.partial();

export type CreateCronJobInput = z.infer<typeof createCronJobSchema>;
export type UpdateCronJobInput = z.infer<typeof updateCronJobSchema>;

// ─── 地区管理 Schema ───────────────────────────────────────────────────────────
export const createRegionSchema = z.object({
  code:       z.string().min(1, '区划代码不能为空').max(12),
  name:       z.string().min(1, '名称不能为空').max(64),
  level:      z.enum(['province', 'city', 'county']),
  parentCode: z.string().max(12).nullable().optional(),
  sort:       z.number().int().default(0),
  status:     z.enum(['enabled', 'disabled']).default('enabled'),
});

export const updateRegionSchema = createRegionSchema.partial();

export type CreateRegionInput = z.infer<typeof createRegionSchema>;
export type UpdateRegionInput = z.infer<typeof updateRegionSchema>;

// ─── 邮件配置 Schema ─────────────────────────────────────────────────────────
export const emailConfigSchema = z.object({
  smtpHost: z.string().min(1, 'SMTP 服务器地址不能为空').max(128).optional(),
  smtpPort: z.number().int().min(1).max(65535).default(465),
  smtpUser: z.string().min(1, 'SMTP 用户名不能为空').max(128).optional(),
  smtpPassword: z.string().max(256).optional(),
  fromName: z.string().max(64).default('Zenith Admin'),
  fromEmail: z.string().max(128).optional(),
  encryption: z.enum(['none', 'ssl', 'tls']).default('ssl'),
  status: z.enum(['enabled', 'disabled']).default('enabled'),
});

export type EmailConfigInput = z.infer<typeof emailConfigSchema>;

// ─── 数据库备份 Schema ─────────────────────────────────────────────────────
export const createBackupSchema = z.object({
  type: z.enum(['pg_dump', 'drizzle_export']),
  name: z.string().min(1, '备份名称不能为空').max(128).optional(),
});

export type CreateBackupInput = z.infer<typeof createBackupSchema>;

// ─── OAuth 配置 Schema ─────────────────────────────────────────────────────
export const updateOauthConfigSchema = z.object({
  clientId: z.string().max(256).default(''),
  clientSecret: z.string().max(512).default(''),
  agentId: z.string().max(128).nullable().optional(),
  corpId: z.string().max(128).nullable().optional(),
  enabled: z.boolean().default(false),
});

// ─── 企业身份源 Schema ───────────────────────────────────────────────────
export const identityProviderAttributeMappingSchema = z.object({
  subject: z.string().max(64).optional(),
  email: z.string().max(64).optional(),
  username: z.string().max(64).optional(),
  nickname: z.string().max(64).optional(),
  phone: z.string().max(64).optional(),
  department: z.string().max(64).optional(),
});

export const createTenantIdentityProviderSchema = z.object({
  tenantId: z.number().int().positive().nullable().optional(),
  name: z.string().min(1, '身份源名称不能为空').max(100),
  code: z.string().min(1, '身份源编码不能为空').max(64).regex(/^[a-z][a-z0-9_-]*$/, '编码只能包含小写字母、数字、中划线和下划线，且以字母开头'),
  type: z.enum(['oidc', 'saml', 'ldap', 'ad']),
  status: z.enum(['enabled', 'disabled']).default('disabled'),
  issuer: z.string().max(512).nullable().optional(),
  authorizationEndpoint: z.string().max(512).nullable().optional(),
  tokenEndpoint: z.string().max(512).nullable().optional(),
  userinfoEndpoint: z.string().max(512).nullable().optional(),
  jwksUri: z.string().max(512).nullable().optional(),
  clientId: z.string().max(256).nullable().optional(),
  clientSecret: z.string().max(1024).optional(),
  scopes: z.string().max(256).default('openid profile email'),
  samlSsoUrl: z.string().max(512).nullable().optional(),
  samlEntityId: z.string().max(512).nullable().optional(),
  samlCertificate: z.string().max(4096).optional(),
  ldapUrl: z.string().max(512).nullable().optional(),
  ldapStartTls: z.boolean().default(false),
  ldapSkipTlsVerify: z.boolean().default(false),
  ldapBaseDn: z.string().max(512).nullable().optional(),
  ldapBindDn: z.string().max(512).nullable().optional(),
  ldapBindPassword: z.string().max(1024).optional(),
  ldapUserFilter: z.string().max(1000).nullable().optional(),
  ldapUserSearchFilter: z.string().max(1000).nullable().optional(),
  ldapSyncFilter: z.string().max(1000).nullable().optional(),
  ldapGroupBaseDn: z.string().max(512).nullable().optional(),
  ldapGroupFilter: z.string().max(1000).nullable().optional(),
  ldapTimeoutMs: z.number().int().min(1000).max(60000).default(5000),
  attributeMapping: identityProviderAttributeMappingSchema.default({
    subject: 'sub',
    email: 'email',
    username: 'preferred_username',
    nickname: 'name',
    phone: 'phone_number',
    department: 'department',
  }),
  jitEnabled: z.boolean().default(false),
  defaultRoleIds: z.array(z.number().int().positive()).default([]),
  remark: z.string().max(500).nullable().optional(),
});

export const updateTenantIdentityProviderSchema = createTenantIdentityProviderSchema.partial();

export const searchIdentityProviderUsersSchema = z.object({
  keyword: z.string().max(100).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export const syncIdentityProviderUsersSchema = z.object({
  limit: z.number().int().min(1).max(5000).default(500),
});

export const enterpriseLdapLoginSchema = z.object({
  providerId: z.number().int().positive(),
  username: z.string().min(1, '请输入目录账号').max(128),
  password: z.string().min(1, '请输入目录密码').max(512),
  redirectTo: z.string().max(512).nullable().optional(),
  deviceInfo: z.record(z.string(), z.unknown()).optional(),
});


// ─── 租户 Schema ────────────────────────────────────────────────────────────
export const createTenantSchema = z.object({
  name: z.string().min(1, '租户名称不能为空').max(100),
  code: z.string().min(1, '租户编码不能为空').max(50).regex(/^[a-z][a-z0-9_]*$/, '租户编码只能包含小写字母、数字和下划线，且以字母开头'),
  logo: z.string().max(500).optional(),
  contactName: z.string().max(50).optional(),
  contactPhone: z.string().max(20).optional(),
  status: z.enum(['enabled', 'disabled']).default('enabled'),
  expireAt: dateTimeStringSchema.optional().nullable(),
  maxUsers: z.number().int().positive().optional().nullable(),
  packageId: z.number().int().positive().optional().nullable(),
  remark: z.string().max(500).optional(),
  adminUsername: z.string().min(2, '管理员用户名至少 2 个字符').max(64).optional(),
  adminPassword: z.string().min(6, '管理员密码至少 6 个字符').max(64).optional(),
  adminNickname: z.string().max(64).optional(),
  adminEmail: z.string().email('管理员邮箱格式不正确').max(128).optional(),
});

export const updateTenantSchema = createTenantSchema
  .omit({ adminUsername: true, adminPassword: true, adminNickname: true, adminEmail: true })
  .partial();

export const switchTenantSchema = z.object({
  tenantId: z.number().int().positive().nullable(),
});

export type CreateTenantInput = z.infer<typeof createTenantSchema>;
export type UpdateTenantInput = z.infer<typeof updateTenantSchema>;
export type SwitchTenantInput = z.infer<typeof switchTenantSchema>;

// ─── 租户套餐 ────────────────────────────────────────────────────────────────
export const createTenantPackageSchema = z.object({
  name: z.string().min(1, '套餐名称不能为空').max(100),
  status: z.enum(['enabled', 'disabled']).default('enabled'),
  remark: z.string().max(500).optional(),
});

export const updateTenantPackageSchema = createTenantPackageSchema.partial();

export const assignTenantPackageMenusSchema = z.object({
  menuIds: z.array(z.number().int()).default([]),
});

export type CreateTenantPackageInput = z.infer<typeof createTenantPackageSchema>;
export type UpdateTenantPackageInput = z.infer<typeof updateTenantPackageSchema>;
export type AssignTenantPackageMenusInput = z.infer<typeof assignTenantPackageMenusSchema>;
export type UpdateOauthConfigInput = z.infer<typeof updateOauthConfigSchema>;

// ─── 通知模块（邮件 / 短信 / 站内信）─────────────────────────────────────────
export const SMS_PROVIDERS = ['aliyun', 'tencent'] as const;
export const SEND_STATUSES = ['pending', 'success', 'failed'] as const;
export const SEND_SOURCES = ['manual', 'test', 'system', 'api'] as const;
export const IN_APP_MESSAGE_TYPES = ['info', 'success', 'warning', 'error'] as const;

// ── 邮件模板 ────────────────────────────────────────────────────────────────
export const createEmailTemplateSchema = z.object({
  name: z.string().min(1, '模板名称不能为空').max(100),
  code: z.string().min(1, '模板编码不能为空').max(100).regex(/^[a-zA-Z]\w*$/, '编码只能包含字母、数字和下划线，且以字母开头'),
  subject: z.string().min(1, '邮件主题不能为空').max(200),
  content: z.string().min(1, '邮件内容不能为空'),
  variables: z.string().optional(),
  status: z.enum(['enabled', 'disabled']).default('enabled'),
  remark: z.string().max(500).optional(),
});
export const updateEmailTemplateSchema = createEmailTemplateSchema.partial();
export type CreateEmailTemplateInput = z.infer<typeof createEmailTemplateSchema>;
export type UpdateEmailTemplateInput = z.infer<typeof updateEmailTemplateSchema>;

// ── 邮件发送（手动 / 测试）─────────────────────────────────────────────────
export const sendEmailSchema = z.object({
  templateId: z.number().int().positive().optional(),
  toEmail: z.email('邮箱格式不正确'),
  subject: z.string().min(1).max(200).optional(),
  content: z.string().min(1).optional(),
  variables: z.record(z.string(), z.string()).optional(),
});
export type SendEmailInput = z.infer<typeof sendEmailSchema>;

// ── 短信服务商配置 ──────────────────────────────────────────────────────────
export const createSmsConfigSchema = z.object({
  name: z.string().min(1, '配置名称不能为空').max(100),
  provider: z.enum(SMS_PROVIDERS, { error: '请选择短信服务商' }),
  accessKeyId: z.string().min(1, 'AccessKeyId 不能为空').max(256),
  accessKeySecret: z.string().min(1, 'AccessKeySecret 不能为空').max(512),
  region: z.string().max(64).optional(),
  signName: z.string().min(1, '签名不能为空').max(64),
  isDefault: z.boolean().default(false),
  status: z.enum(['enabled', 'disabled']).default('enabled'),
  remark: z.string().max(500).optional(),
});
export const updateSmsConfigSchema = createSmsConfigSchema.partial().extend({
  accessKeySecret: z.string().max(512).optional(), // 更新时允许不传（保持原值）
});
export type CreateSmsConfigInput = z.infer<typeof createSmsConfigSchema>;
export type UpdateSmsConfigInput = z.infer<typeof updateSmsConfigSchema>;

// ── 短信模板 ────────────────────────────────────────────────────────────────
export const createSmsTemplateSchema = z.object({
  name: z.string().min(1, '模板名称不能为空').max(100),
  code: z.string().min(1, '模板编码不能为空').max(100).regex(/^[a-zA-Z]\w*$/, '编码只能包含字母、数字和下划线，且以字母开头'),
  templateCode: z.string().min(1, '厂商模板ID不能为空').max(100),
  signName: z.string().max(64).optional(),
  content: z.string().min(1, '模板内容不能为空'),
  variables: z.string().optional(),
  provider: z.enum(SMS_PROVIDERS, { error: '请选择适用服务商' }),
  status: z.enum(['enabled', 'disabled']).default('enabled'),
  remark: z.string().max(500).optional(),
});
export const updateSmsTemplateSchema = createSmsTemplateSchema.partial();
export type CreateSmsTemplateInput = z.infer<typeof createSmsTemplateSchema>;
export type UpdateSmsTemplateInput = z.infer<typeof updateSmsTemplateSchema>;

// ── 短信发送（手动 / 测试）─────────────────────────────────────────────────
export const sendSmsSchema = z.object({
  templateId: z.number().int().positive(),
  phone: z.string().regex(/^1[3-9]\d{9}$/, '手机号格式不正确'),
  variables: z.record(z.string(), z.string()).optional(),
});
export type SendSmsInput = z.infer<typeof sendSmsSchema>;

// ── 站内信模板 ──────────────────────────────────────────────────────────────
export const createInAppTemplateSchema = z.object({
  name: z.string().min(1, '模板名称不能为空').max(100),
  code: z.string().min(1, '模板编码不能为空').max(100).regex(/^[a-zA-Z]\w*$/, '编码只能包含字母、数字和下划线，且以字母开头'),
  title: z.string().min(1, '标题不能为空').max(200),
  content: z.string().min(1, '内容不能为空'),
  type: z.enum(IN_APP_MESSAGE_TYPES).default('info'),
  variables: z.string().optional(),
  status: z.enum(['enabled', 'disabled']).default('enabled'),
  remark: z.string().max(500).optional(),
});
export const updateInAppTemplateSchema = createInAppTemplateSchema.partial();
export type CreateInAppTemplateInput = z.infer<typeof createInAppTemplateSchema>;
export type UpdateInAppTemplateInput = z.infer<typeof updateInAppTemplateSchema>;

// ── 站内信发送 ──────────────────────────────────────────────────────────────
export const sendInAppSchema = z.object({
  templateId: z.number().int().positive().optional(),
  userIds: z.array(z.number().int().positive()).min(1, '至少选择一名收件人'),
  title: z.string().min(1).max(200).optional(),
  content: z.string().min(1).optional(),
  type: z.enum(IN_APP_MESSAGE_TYPES).default('info'),
  variables: z.record(z.string(), z.string()).optional(),
});
export type SendInAppInput = z.infer<typeof sendInAppSchema>;

// ─── 标签管理 Schema ─────────────────────────────────────────────────────────
export const createTagSchema = z.object({
  name:        z.string().min(1, '标签名称不能为空').max(50),
  color:       z.string().max(20).optional(),
  groupName:   z.string().max(50).optional(),
  description: z.string().max(500).optional(),
  status:      z.enum(['enabled', 'disabled']).default('enabled'),
  sortOrder:   z.number().int().default(0),
});

export const updateTagSchema = createTagSchema.partial();

export type CreateTagInput = z.infer<typeof createTagSchema>;
export type UpdateTagInput = z.infer<typeof updateTagSchema>;

// ─── 工作流引擎 Schema ────────────────────────────────────────────────────────
export const workflowConditionOperatorSchema = z.enum(['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'in', 'notIn', 'contains', 'isEmpty', 'isNotEmpty', 'between', 'withinDays', 'beforeDays']);

export const workflowEdgeConditionSchema = z.object({
  field: z.string().min(1),
  operator: workflowConditionOperatorSchema,
  value: z.union([z.string(), z.number(), z.boolean()]),
  source: z.enum(['form', 'starter']).optional(),
  aggregate: z.enum(['sum', 'count', 'avg']).optional(),
  aggregateField: z.string().optional(),
});

export const workflowConditionGroupSchema = z.object({
  type: z.enum(['and', 'or']),
  rules: z.array(workflowEdgeConditionSchema).min(1),
});

export const workflowNodeTypeSchema = z.enum([
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

export const workflowAssigneeTypeSchema = z.enum([
  'user', 'role', 'department', 'userGroup', 'post', 'deptMember',
  'initiator', 'initiatorLeader', 'initiatorDept', 'startUserDeptResponsible',
  'manager', 'multiLevelManager', 'multiLevelDeptHead',
  'formUser', 'formDepartment', 'nodeApprover',
  'initiatorSelect', 'initiatorSelectScope', 'approverSelect',
  'expression',
]);

export const workflowApproveMethodSchema = z.enum(['and', 'or', 'sequential', 'ratio', 'random', 'auto']);
export const workflowApprovalTypeSchema = z.enum(['manual', 'autoApprove', 'autoReject']);
export const workflowEmptyAssigneeStrategySchema = z.enum(['autoApprove', 'assignToAdmin', 'reject', 'assignTo']);
export const workflowSameInitiatorStrategySchema = z.enum(['selfApprove', 'autoSkip', 'toDirectManager', 'toDeptHead']);
export const workflowDeduplicateStrategySchema = z.enum(['autoSkip', 'repeatApprove']);
export const workflowOperationPermissionSchema = z.enum([
  'approve', 'reject', 'comment', 'signature', 'opinionRequired',
]);
export const workflowFieldPermissionSchema = z.enum(['read', 'edit', 'hidden']);
export const workflowActionButtonKeySchema = z.enum([
  'approve', 'reject', 'transfer', 'delegate', 'addSign', 'return',
]);
export const workflowActionButtonConfigSchema = z.object({
  enabled: z.boolean(),
  displayName: z.string().max(32).optional(),
  opinionName: z.string().max(32).optional(),
  jumpToNodeKey: z.string().optional(),
  /** 附件配置：不显示/选填/必填，默认 hidden */
  uploadMode: z.enum(['hidden', 'optional', 'required']).optional(),
});
export const workflowTimeoutConfigSchema = z.object({
  enabled: z.boolean(),
  duration: z.number().int().min(1),
  unit: z.enum(['minutes', 'hours', 'days']).optional(),
  action: z.enum(['remind', 'autoApprove', 'autoReject']),
  remindCount: z.number().int().min(1).optional(),
  escalateAction: z.enum(['none', 'autoApprove', 'autoReject', 'transferToManager']).optional(),
  escalateManagerLevel: z.number().int().min(1).optional(),
  escalateFallbackAction: z.enum(['none', 'autoApprove', 'autoReject']).optional(),
});

export const workflowCompensationActionSchema = z.object({
  type: z.enum(['none', 'http', 'connector', 'sms', 'email', 'updateData']),
  connectorId: z.number().int().optional(),
  url: z.string().max(1000).optional(),
  httpMethod: z.enum(['GET', 'POST', 'PUT', 'DELETE']).optional(),
  headers: z.record(z.string(), z.string()).optional(),
  bodyTemplate: z.string().max(8000).optional(),
  templateId: z.number().int().optional(),
  recipients: z.array(z.string().max(200)).optional(),
  fieldKeys: z.array(z.string()).optional(),
  fieldValues: z.record(z.string(), z.string()).optional(),
  idempotencyKeyTemplate: z.string().max(200).optional(),
  maxRetries: z.number().int().min(0).max(10).optional(),
  timeoutMs: z.number().int().min(0).max(600000).optional(),
});
export const workflowNodeFailurePolicySchema = z.object({
  action: z.enum(['continue', 'retry', 'compensate', 'fallback', 'notify', 'terminate']),
  maxRetries: z.number().int().min(0).max(10).optional(),
  fallbackNodeKey: z.string().optional(),
  fallbackAction: workflowCompensationActionSchema.optional(),
  compensation: workflowCompensationActionSchema.optional(),
  notifyUserIds: z.array(z.number().int()).nullable().optional(),
  continueAfter: z.boolean().optional(),
  sagaRollback: z.boolean().optional(),
});

export const workflowNodeConfigSchema = z.looseObject({
  key: z.string().min(1),
  type: workflowNodeTypeSchema,
  label: z.string().min(1),
  assigneeId: z.number().int().nullable().optional(),
  assigneeName: z.string().nullable().optional(),
  assigneeIds: z.array(z.number().int()).nullable().optional(),
  assigneeNames: z.array(z.string()).nullable().optional(),
  isDefault: z.boolean().optional(),
  assigneeType: workflowAssigneeTypeSchema.optional(),
  approvalType: workflowApprovalTypeSchema.optional(),
  excludeFromStats: z.boolean().optional(),
  userIds: z.array(z.number().int()).nullable().optional(),
  roleIds: z.array(z.number().int()).nullable().optional(),
  deptIds: z.array(z.number().int()).nullable().optional(),
  userGroupIds: z.array(z.number().int()).nullable().optional(),
  postIds: z.array(z.number().int()).nullable().optional(),
  postNames: z.array(z.string()).nullable().optional(),
  deptMemberDeptIds: z.array(z.number().int()).nullable().optional(),
  deptMemberDeptNames: z.array(z.string()).nullable().optional(),
  deptMemberIncludeChildren: z.boolean().optional(),
  selectScopeType: z.enum(['user', 'role', 'department', 'userGroup']).optional(),
  selectScopeIds: z.array(z.number().int()).nullable().optional(),
  assigneeExpression: z.string().max(2000).optional(),
  approveMethod: workflowApproveMethodSchema.optional(),
  approveRatio: z.number().int().min(1).max(100).optional(),
  emptyStrategy: workflowEmptyAssigneeStrategySchema.optional(),
  emptyAssignTo: z.number().int().optional(),
  emptyAssignToName: z.string().optional(),
  emptyAssignToIds: z.array(z.number().int()).nullable().optional(),
  emptyAssignToNames: z.array(z.string()).nullable().optional(),
  sameInitiatorStrategy: workflowSameInitiatorStrategySchema.optional(),
  deduplicateStrategy: workflowDeduplicateStrategySchema.optional(),
  operations: z.array(workflowOperationPermissionSchema).optional(),
  actionButtons: z.record(workflowActionButtonKeySchema, workflowActionButtonConfigSchema).optional(),
  fieldPermissions: z.record(z.string(), workflowFieldPermissionSchema).optional(),
  timeout: workflowTimeoutConfigSchema.optional(),
  managerLevel: z.number().int().min(1).optional(),
  multiLevelEndType: z.enum(['topLevel', 'level', 'role']).optional(),
  multiLevelEndLevel: z.number().int().min(1).optional(),
  multiLevelEndRoleId: z.number().int().optional(),
  formUserField: z.string().optional(),
  formDeptField: z.string().optional(),
  formDeptHeadLevel: z.number().int().min(1).optional(),
  nodeApproverNodeId: z.string().optional(),
  onlyOnApprove: z.boolean().optional(),
  subProcessId: z.number().int().optional(),
  subProcessName: z.string().optional(),
  subProcessFieldMapping: z.record(z.string(), z.string()).optional(),
  subProcessOutputMapping: z.record(z.string(), z.string()).optional(),
  subProcessWaitChild: z.boolean().optional(),
  subProcessMode: z.enum(['single', 'multi']).optional(),
  subProcessMultiSource: z.string().optional(),
  subProcessMultiExecution: z.enum(['parallel', 'serial']).optional(),
  subProcessMultiItemKey: z.string().optional(),
  subProcessOnChildReject: z.enum(['abort', 'continue']).optional(),
  subProcessInitiator: z.enum(['parentInitiator', 'formField', 'specifiedUser']).optional(),
  subProcessInitiatorField: z.string().optional(),
  subProcessInitiatorUserId: z.number().int().optional(),
  subProcessIgnoreReject: z.boolean().optional(),
  catchAction: z.enum(['toAdmin', 'notify', 'terminate']).optional(),
  catchNotifyUserIds: z.array(z.number().int()).nullable().optional(),
  failurePolicy: workflowNodeFailurePolicySchema.optional(),
  isAsync: z.boolean().optional(),
  nodeListeners: z.array(z.object({
    type: z.literal('webhook'),
    url: z.url('URL 格式不正确').max(1000),
    method: z.enum(['GET', 'POST']).optional(),
    headers: z.record(z.string(), z.string()).optional(),
    events: z.array(z.enum(['onCreate', 'onApprove', 'onReject'])).min(1, '至少选择一个事件'),
  })).optional(),
});

export const workflowFieldVisibilityConditionSchema = z.object({
  field: z.string().min(1),
  operator: z.enum(['eq', 'neq', 'in', 'contains', 'gt', 'lt', 'gte', 'lte', 'isEmpty', 'notEmpty']),
  value: z.unknown(),
});

export const workflowFormFieldSchema: z.ZodType<WorkflowFormField> = z.lazy(() =>
  z.object({
    key: z.string().min(1, '字段 key 不能为空'),
    label: z.string().min(1, '字段标签不能为空'),
    type: z.enum([
      'text', 'textarea', 'number', 'date', 'dateRange', 'time',
      'select', 'multiSelect', 'autoComplete', 'radio', 'checkbox', 'switch', 'slider', 'tags', 'colorPicker',
      'amount',
      'phone', 'email', 'idCard', 'url', 'password', 'pinCode', 'rate', 'formula',
      'attachment', 'image',
      'region', 'signature', 'richtext',
      'userSelect', 'deptSelect', 'dictSelect',
      'detail', 'description', 'serialNumber',
      'row', 'divider', 'group', 'tabs', 'steps',
    ]),
    required: z.boolean().optional(),
    placeholder: z.string().optional(),
    helpText: z.string().optional(),
    options: z.array(z.string()).optional(),
    optionItems: z.array(z.object({
      value: z.string(),
      label: z.string().optional(),
      color: z.string().optional(),
      disabled: z.boolean().optional(),
    })).optional(),
    allowOther: z.boolean().optional(),
    defaultValue: z.unknown().optional(),
    visibilityCondition: workflowFieldVisibilityConditionSchema.optional(),
    visibilityRules: z.object({
      logic: z.enum(['and', 'or']),
      rules: z.array(workflowFieldVisibilityConditionSchema),
    }).optional(),
    requiredRules: z.object({
      logic: z.enum(['and', 'or']),
      rules: z.array(workflowFieldVisibilityConditionSchema),
    }).optional(),
    readOnlyRules: z.object({
      logic: z.enum(['and', 'or']),
      rules: z.array(workflowFieldVisibilityConditionSchema),
    }).optional(),
    children: z.array(workflowFormFieldSchema).optional(),
    precision: z.number().int().min(0).max(6).optional(),
    step: z.number().optional(),
    unit: z.string().optional(),
    currency: z.string().optional(),
    amountInWords: z.boolean().optional(),
    dateFormat: z.string().optional(),
    timeFormat: z.string().optional(),
    regionLevel: z.enum(['province', 'city', 'district']).optional(),
    dictCode: z.string().optional(),
    multiple: z.boolean().optional(),
    sliderMarks: z.boolean().optional(),
    alpha: z.boolean().optional(),
    labelPosition: z.enum(['top', 'left', 'inset']).optional(),
    labelAlign: z.enum(['left', 'right']).optional(),
    labelWidth: z.number().int().min(40).max(400).optional(),
    columnSpan: z.number().int().min(1).max(24).optional(),
    readOnly: z.boolean().optional(),
    hidden: z.boolean().optional(),
    maxCount: z.number().int().min(1).optional(),
    description: z.string().optional(),
    serialPrefix: z.string().optional(),
    rateMax: z.number().int().min(1).max(10).optional(),
    formula: z.string().optional(),
    detailSummary: z.boolean().optional(),
    minLength: z.number().int().min(0).optional(),
    maxLength: z.number().int().min(1).optional(),
    min: z.number().optional(),
    max: z.number().optional(),
    pattern: z.string().optional(),
    patternMessage: z.string().optional(),
    unique: z.boolean().optional(),
    compareRules: z.array(z.object({
      operator: z.enum(['gt', 'gte', 'lt', 'lte', 'eq', 'neq']),
      field: z.string().min(1),
      message: z.string().optional(),
    })).optional(),
    dateLimit: z.enum(['none', 'noPast', 'noFuture', 'custom']).optional(),
    minDate: z.string().optional(),
    maxDate: z.string().optional(),
    accept: z.string().optional(),
    maxSize: z.number().positive().optional(),
    daysFromKey: z.string().optional(),
    optionsFrom: z.object({
      sourceKey: z.string().min(1),
      mapping: z.record(z.string(), z.array(z.string())),
    }).optional(),
    autoFill: z.object({
      targets: z.array(z.string()),
      byOption: z.record(z.string(), z.record(z.string(), z.string())),
    }).optional(),
    dataSourceId: z.number().int().positive().optional(),
    columns: z.array(z.object({
      span: z.number().min(1).max(24),
      fields: z.array(workflowFormFieldSchema),
    })).optional(),
    panes: z.array(z.object({
      title: z.string(),
      fields: z.array(workflowFormFieldSchema),
    })).optional(),
    title: z.string().optional(),
    collapsible: z.boolean().optional(),
    defaultCollapsed: z.boolean().optional(),
  })
);

// ─── 表单库 ─────────────────────────────────────────────────────────────────

export const workflowFormSettingsSchema = z.object({
  description: z.string().max(500).optional(),
  submitButtonText: z.string().max(32).optional(),
  labelPosition: z.enum(['top', 'left', 'inset']).optional(),
  labelAlign: z.enum(['left', 'right']).optional(),
  labelWidth: z.number().int().min(40).max(400).optional(),
});

export const workflowFormSchemaSchema = z.object({
  fields: z.array(workflowFormFieldSchema).default([]),
  settings: workflowFormSettingsSchema.optional(),
});

export const createWorkflowFormSchema = z.object({
  name: z.string().min(1, '表单名称不能为空').max(64),
  code: z.string().max(64).nullable().optional(),
  description: z.string().max(500).nullable().optional(),
  categoryId: z.number().int().positive().nullable().optional(),
  schema: workflowFormSchemaSchema.nullable().optional(),
  status: z.enum(['enabled', 'disabled']).default('enabled'),
});

export const updateWorkflowFormSchema = createWorkflowFormSchema.partial();

export type CreateWorkflowFormInput = z.input<typeof createWorkflowFormSchema>;
export type UpdateWorkflowFormInput = z.input<typeof updateWorkflowFormSchema>;

// ─── 表单远程数据源 ──────────────────────────────────────────────────────────
export const createWorkflowDataSourceSchema = z.object({
  name: z.string().min(1, '名称不能为空').max(64),
  method: z.enum(['GET', 'POST']).default('GET'),
  url: z.string().min(1, 'URL 不能为空').max(1024)
    .refine((u) => /^https?:\/\//i.test(u), 'URL 需以 http:// 或 https:// 开头'),
  headers: z.record(z.string(), z.string()).optional(),
  itemsPath: z.string().max(128).optional(),
  valueField: z.string().min(1, '取值字段不能为空').max(64),
  labelField: z.string().min(1, '显示字段不能为空').max(64),
  keywordParam: z.string().max(64).optional(),
  status: z.enum(['enabled', 'disabled']).default('enabled'),
  remark: z.string().max(256).optional(),
});

export const updateWorkflowDataSourceSchema = createWorkflowDataSourceSchema.partial();

export type CreateWorkflowDataSourceInput = z.input<typeof createWorkflowDataSourceSchema>;
export type UpdateWorkflowDataSourceInput = z.input<typeof updateWorkflowDataSourceSchema>;

// ── 流程连接器 ──
export const workflowConnectorTypeSchema = z.enum(['http', 'webhook', 'email', 'sms', 'wecom', 'dingtalk', 'feishu', 'mq', 'database']);

/** 凭据明文（按 authType 解释；落库前整体 AES 加密，绝不回传） */
export const workflowConnectorCredentialsSchema = z.object({
  token: z.string().max(2048).optional(),
  username: z.string().max(256).optional(),
  password: z.string().max(2048).optional(),
  apiKey: z.string().max(2048).optional(),
});

export const createWorkflowConnectorSchema = z.object({
  name: z.string().min(1, '名称不能为空').max(64),
  code: z.string().min(1, '编码不能为空').max(64).regex(/^[a-zA-Z][a-zA-Z0-9_-]*$/, '编码以字母开头，仅含字母/数字/下划线/连字符'),
  description: z.string().max(512).nullable().optional(),
  type: workflowConnectorTypeSchema.default('http'),
  config: z.record(z.string(), z.unknown()).default({}),
  credentials: workflowConnectorCredentialsSchema.optional(),
  timeoutMs: z.number().int().min(100).max(120000).default(10000),
  retryMax: z.number().int().min(0).max(10).default(0),
  circuitBreakerEnabled: z.boolean().default(true),
  failureThreshold: z.number().int().min(1).max(100).default(5),
  cooldownSec: z.number().int().min(1).max(3600).default(60),
  rateLimitEnabled: z.boolean().default(false),
  rateLimitWindowSec: z.number().int().min(1).max(3600).default(1),
  rateLimitMax: z.number().int().min(0).max(100000).default(0),
  status: z.enum(['enabled', 'disabled']).default('enabled'),
});

export const updateWorkflowConnectorSchema = createWorkflowConnectorSchema.partial().extend({
  /** true=清空凭据；不传且 credentials 也不传=保留原凭据 */
  clearCredentials: z.boolean().optional(),
});

/** 测试调用：对连接器发一次探测请求（http: 相对 baseUrl 的 path + 方法 + body 覆盖） */
export const testWorkflowConnectorSchema = z.object({
  path: z.string().max(1024).optional(),
  method: z.enum(['GET', 'POST', 'PUT', 'DELETE', 'PATCH']).optional(),
  body: z.unknown().optional(),
});

export type CreateWorkflowConnectorInput = z.input<typeof createWorkflowConnectorSchema>;
export type UpdateWorkflowConnectorInput = z.input<typeof updateWorkflowConnectorSchema>;
export type TestWorkflowConnectorInput = z.infer<typeof testWorkflowConnectorSchema>;

export const workflowFormTypeSchema = z.enum(['designer', 'custom', 'external']);

export const workflowCustomFormVariableSchema = z.object({
  id: z.string().optional(),
  key: z.string().min(1).max(64),
  label: z.string().min(1).max(64),
  type: z.enum(['string', 'number', 'boolean', 'date', 'user', 'dept']),
});

export const workflowCustomFormConfigSchema = z.object({
  // 允许草稿期为空（便于先存草稿再补全）；发布时强制校验非空
  createComponent: z.string().max(256),
  viewComponent: z.string().max(256).nullable().optional(),
  icon: z.string().max(64).nullable().optional(),
  variables: z.array(workflowCustomFormVariableSchema).optional(),
});

export const createWorkflowDefinitionSchema = z.object({
  name: z.string().min(1, '流程名称不能为空').max(64),
  description: z.string().max(500).nullable().optional(),
  flowData: z.record(z.string(), z.unknown()).nullable().optional(),
  formId: z.number().int().positive().nullable().optional(),
  formType: workflowFormTypeSchema.default('designer'),
  customForm: workflowCustomFormConfigSchema.nullable().optional(),
  status: z.enum(['draft', 'published', 'disabled']).default('draft'),
});

export const updateWorkflowDefinitionSchema = createWorkflowDefinitionSchema.partial();

// 流程级自动化规则
const workflowAutomationActionStartWorkflowSchema = z.object({
  type: z.literal('startWorkflow'),
  definitionId: z.number().int().positive('请选择目标流程'),
  titleTemplate: z.string().max(128).optional(),
  formMapping: z.record(z.string(), z.string()).optional(),
});

const workflowAutomationActionSendMessageSchema = z.object({
  type: z.literal('sendMessage'),
  title: z.string().min(1, '消息标题不能为空').max(128),
  content: z.string().min(1, '消息内容不能为空').max(2000),
  messageType: z.enum(['info', 'success', 'warning', 'error']).optional(),
  recipients: z
    .union([z.literal('initiator'), z.object({ userIds: z.array(z.number().int().positive()).min(1) })])
    .optional(),
  buttons: z
    .array(z.object({ text: z.string().min(1).max(32), url: z.string().min(1).max(512) }))
    .max(3, '按钮最多 3 个')
    .optional(),
});

const workflowAutomationActionWebhookSchema = z.object({
  type: z.literal('webhook'),
  url: z.string().min(1, 'Webhook 地址不能为空').max(512),
  method: z.enum(['GET', 'POST', 'PUT']).optional(),
  headers: z.record(z.string(), z.string()).optional(),
  bodyTemplate: z.string().max(4000).optional(),
});

const workflowAutomationActionUpdateFieldSchema = z.object({
  type: z.literal('updateField'),
  fields: z.record(z.string(), z.string()).refine((v) => Object.keys(v).length > 0, '至少配置 1 个字段'),
});

export const workflowAutomationActionSchema = z.discriminatedUnion('type', [
  workflowAutomationActionStartWorkflowSchema,
  workflowAutomationActionSendMessageSchema,
  workflowAutomationActionWebhookSchema,
  workflowAutomationActionUpdateFieldSchema,
]);

export const createWorkflowAutomationSchema = z.object({
  definitionId: z.number().int().positive('请选择流程'),
  name: z.string().min(1, '规则名称不能为空').max(128),
  trigger: z.enum(['approved', 'rejected', 'withdrawn', 'created']),
  actions: z.array(workflowAutomationActionSchema).min(1, '至少配置 1 个动作').max(10),
  status: z.enum(['enabled', 'disabled']).default('enabled'),
  sort: z.number().int().nonnegative().default(0),
});

export const updateWorkflowAutomationSchema = createWorkflowAutomationSchema.partial();

export type WorkflowAutomationActionInput = z.infer<typeof workflowAutomationActionSchema>;
export type CreateWorkflowAutomationInput = z.infer<typeof createWorkflowAutomationSchema>;
export type UpdateWorkflowAutomationInput = z.infer<typeof updateWorkflowAutomationSchema>;

// ── 流程定时发起 ──
export const createWorkflowScheduleSchema = z.object({
  definitionId: z.number().int().positive('请选择流程'),
  name: z.string().min(1, '规则名称不能为空').max(128),
  cronExpression: z.string().min(1, '请输入 cron 表达式').max(64),
  initiatorId: z.number().int().positive('请选择发起人'),
  titleTemplate: z.string().max(256).nullable().optional(),
  formData: z.record(z.string(), z.unknown()).nullable().optional(),
  status: z.enum(['enabled', 'disabled']).default('enabled'),
});
export const updateWorkflowScheduleSchema = createWorkflowScheduleSchema.partial();
export type CreateWorkflowScheduleInput = z.infer<typeof createWorkflowScheduleSchema>;
export type UpdateWorkflowScheduleInput = z.infer<typeof updateWorkflowScheduleSchema>;

// ── 列表保存视图 ──
export const createWorkflowSavedViewSchema = z.object({
  pageKey: z.string().min(1).max(64),
  name: z.string().min(1, '视图名称不能为空').max(64),
  filters: z.record(z.string(), z.unknown()).default({}),
  isDefault: z.boolean().optional(),
  sort: z.number().int().nonnegative().optional(),
});
export const updateWorkflowSavedViewSchema = createWorkflowSavedViewSchema.partial().omit({ pageKey: true });
export type CreateWorkflowSavedViewInput = z.infer<typeof createWorkflowSavedViewSchema>;
export type UpdateWorkflowSavedViewInput = z.infer<typeof updateWorkflowSavedViewSchema>;

// ── 提交前审批链路预览 ──
export const previewWorkflowSchema = z.object({
  formData: z.record(z.string(), z.unknown()).nullable().optional(),
});
export type PreviewWorkflowInput = z.infer<typeof previewWorkflowSchema>;

// ── 流程仿真 ──
export const workflowSimulationDecisionSchema = z.object({
  nodeKey: z.string().min(1, '节点标识不能为空'),
  action: z.enum(['approve', 'reject', 'skip', 'wait']),
  assigneeId: z.number().int().positive().optional(),
  reason: z.string().max(256).optional(),
  formPatch: z.record(z.string(), z.unknown()).optional(),
});

export const workflowSimulationOptionsSchema = z.object({
  maxSteps: z.number().int().min(1).max(500).optional(),
  mockDelay: z.boolean().optional(),
  mockTrigger: z.boolean().optional(),
  expandSubProcess: z.boolean().optional(),
});

export const simulateWorkflowSchema = z.object({
  definitionId: z.number().int().positive().optional(),
  flowData: z.looseObject({}).nullable().optional(),
  formData: z.record(z.string(), z.unknown()).nullable().optional(),
  starterUserId: z.number().int().positive().optional(),
  decisions: z.array(workflowSimulationDecisionSchema).max(200).optional(),
  options: workflowSimulationOptionsSchema.optional(),
}).refine((v) => v.definitionId || v.flowData, {
  message: 'definitionId 和 flowData 至少需要提供一个',
});
export type SimulateWorkflowInput = z.infer<typeof simulateWorkflowSchema>;

/** 保存仿真用例（按 definitionId + name 归档，重名覆盖） */
export const saveWorkflowSimulationCaseSchema = z.object({
  definitionId: z.number().int().positive(),
  name: z.string().min(1, '用例名称不能为空').max(64),
  starterUserId: z.number().int().positive().nullish(),
  formData: z.record(z.string(), z.unknown()).default({}),
  decisions: z.array(workflowSimulationDecisionSchema).max(200).default([]),
});
export type SaveWorkflowSimulationCaseInput = z.input<typeof saveWorkflowSimulationCaseSchema>;

export const workflowHealthCheckSchema = z.object({
  definitionId: z.number().int().positive().optional(),
  flowData: z.looseObject({}).nullable().optional(),
  /** 设计器草稿：当前绑定表单的字段（key + 类型），用于条件/表达式字段引用与类型兼容性实时校验 */
  formFields: z.array(z.object({ key: z.string(), type: z.string().optional() })).optional(),
}).refine((v) => v.definitionId || v.flowData, {
  message: 'definitionId 和 flowData 至少需要提供一个',
});
export type WorkflowHealthCheckInput = z.infer<typeof workflowHealthCheckSchema>;

// ── 主动抄送 / 转发 ──
export const forwardInstanceSchema = z.object({
  userIds: z.array(z.number().int().positive()).min(1, '请选择抄送人').max(50),
  note: z.string().max(256).optional(),
});
export type ForwardInstanceInput = z.infer<typeof forwardInstanceSchema>;


export const workflowPriorityEnum = z.enum(['low', 'normal', 'high', 'urgent']);
export const workflowSelectedApproversSchema = z.record(
  z.string().min(1),
  z.array(z.number().int().positive()).min(1, '请选择审批人').max(50),
);

export const createWorkflowInstanceSchema = z.object({
  definitionId: z.number().int().positive('请选择流程'),
  title: z.string().min(1, '申请标题不能为空').max(128),
  formData: z.record(z.string(), z.unknown()).nullable().optional(),
  /** 加急/优先级（默认 normal） */
  priority: workflowPriorityEnum.optional(),
  /** 发起时自选抄送人（提交后立即抄送，与流程内 ccNode 并存） */
  ccUserIds: z.array(z.number().int().positive()).max(50).optional(),
  /** 发起时按节点选择审批人：{ [nodeKey]: userIds } */
  selectedInitiatorApprovers: workflowSelectedApproversSchema.optional(),
});

/** 审批动作附件（[{name,url,size}]）—— 各动作通用 */
export const workflowTaskAttachmentSchema = z.object({
  name: z.string().max(255),
  url: z.string().max(1024),
  size: z.number().int().nonnegative().optional(),
});
export const workflowTaskAttachmentsSchema = z.array(workflowTaskAttachmentSchema);

export const approveWorkflowTaskSchema = z.object({
  comment: z.string().max(500).optional(),
  /** 手写签名（data URL，节点要求签名时必填） */
  signature: z.string().max(2_000_000).optional(),
  attachments: workflowTaskAttachmentsSchema.optional(),
  /** 当紧邻的下一节点为 approverSelect 类型时，由当前审批人按节点指定审批人：{ [nodeKey]: userIds } */
  selectedNextApprovers: workflowSelectedApproversSchema.optional(),
  /** 审批人对节点「可编辑」字段的修改（{ 字段key: 新值 }），服务端按节点 fieldPermissions 白名单过滤后合并进实例 formData */
  formUpdates: z.record(z.string(), z.unknown()).optional(),
});

export const rejectWorkflowTaskSchema = z.object({
  comment: z.string().min(1, '驳回原因不能为空').max(500),
  attachments: workflowTaskAttachmentsSchema.optional(),
});

export const transferWorkflowTaskSchema = z.object({
  targetUserId: z.number().int().positive('请选择转办人'),
  comment: z.string().max(500).optional(),
  attachments: workflowTaskAttachmentsSchema.optional(),
});

export const delegateWorkflowTaskSchema = z.object({
  targetUserId: z.number().int().positive('请选择委派人'),
  comment: z.string().max(500).optional(),
  attachments: workflowTaskAttachmentsSchema.optional(),
});

export const addSignWorkflowTaskSchema = z.object({
  targetUserIds: z.array(z.number().int().positive()).min(1, '请选择加签人'),
  position: z.enum(['before', 'after', 'parallel']).default('parallel'),
  /** 多加签人时的会签/或签模式：and=全部通过(会签), or=任一通过(或签)。仅 parallel 生效 */
  signMode: z.enum(['and', 'or']).optional(),
  comment: z.string().max(500).optional(),
  attachments: workflowTaskAttachmentsSchema.optional(),
});

export const reduceSignWorkflowTaskSchema = z.object({
  targetTaskIds: z.array(z.number().int().positive()).min(1, '请选择要减签的任务'),
  comment: z.string().max(500).optional(),
});

export const returnWorkflowTaskSchema = z.object({
  targetNodeKeys: z.array(z.string().min(1)).min(1, '请选择退回节点').max(20),
  comment: z.string().min(1, '退回原因不能为空').max(500),
  attachments: workflowTaskAttachmentsSchema.optional(),
});

export const urgeWorkflowTaskSchema = z.object({
  message: z.string().max(256).optional(),
});

export const addInstanceCcSchema = z.object({
  nodeKey: z.string().min(1, '请选择抄送节点'),
  userIds: z.array(z.number().int().positive()).min(1, '请选择抄送人'),
});

// ── 草稿 / 重新提交 ──
export const createWorkflowInstanceWithDraftSchema = createWorkflowInstanceSchema.extend({
  /** true = 保存为草稿（不进入审批流转） */
  asDraft: z.boolean().optional(),
});

export const submitWorkflowDraftSchema = z.object({
  /** 草稿提交时补充发起人自选审批人 */
  selectedInitiatorApprovers: workflowSelectedApproversSchema.optional(),
});

export const updateWorkflowInstanceSchema = z.object({
  title: z.string().min(1, '申请标题不能为空').max(128).optional(),
  formData: z.record(z.string(), z.unknown()).nullable().optional(),
  priority: workflowPriorityEnum.optional(),
});

// ── 批量审批 ──
export const batchApproveWorkflowTaskSchema = z.object({
  taskIds: z.array(z.number().int().positive()).min(1, '请选择任务').max(200),
  comment: z.string().max(500).optional(),
});

export const batchRejectWorkflowTaskSchema = z.object({
  taskIds: z.array(z.number().int().positive()).min(1, '请选择任务').max(200),
  comment: z.string().min(1, '驳回原因不能为空').max(500),
});

// ── 批量撤回 / 批量催办（跨实例，发起人/管理员维度）──
export const batchWithdrawWorkflowInstanceSchema = z.object({
  instanceIds: z.array(z.number().int().positive()).min(1, '请选择流程').max(200),
  comment: z.string().max(500).optional(),
});

export const batchUrgeWorkflowInstanceSchema = z.object({
  instanceIds: z.array(z.number().int().positive()).min(1, '请选择流程').max(200),
  message: z.string().max(256).optional(),
});

// ── 流程定义导入（自包含 JSON）──
export const importWorkflowDefinitionSchema = z.object({
  name: z.string().min(1, '流程名称不能为空').max(128),
  description: z.string().max(512).nullable().optional(),
  categoryName: z.string().max(64).nullable().optional(),
  flowData: z.unknown(),
  formType: workflowFormTypeSchema.optional(),
  customForm: workflowCustomFormConfigSchema.nullable().optional(),
  form: z.object({
    name: z.string().max(128),
    description: z.string().max(512).nullable().optional(),
    schema: z.unknown(),
  }).nullable().optional(),
  schemaVersion: z.number().int().positive().optional(),
});

// ── 流程评论 ──
export const createWorkflowCommentSchema = z.object({
  content: z.string().min(1, '评论内容不能为空').max(2000),
  taskId: z.number().int().positive().nullable().optional(),
  /** 回复引用的父评论 ID（须属于同一实例） */
  parentId: z.number().int().positive().nullable().optional(),
  mentions: z.array(z.number().int().positive()).max(50).optional(),
  attachments: z.array(z.object({
    name: z.string().max(255),
    url: z.string().max(1024),
    size: z.number().int().nonnegative().optional(),
  })).max(20).optional(),
});

// ── 审批意见常用语 ──
export const createWorkflowQuickPhraseSchema = z.object({
  content: z.string().min(1, '内容不能为空').max(255),
  sort: z.number().int().nonnegative().default(0),
});
export const updateWorkflowQuickPhraseSchema = createWorkflowQuickPhraseSchema.partial();

// ── 审批代理 / 离岗委托 ──
export const createWorkflowDelegationSchema = z.object({
  /** 委托人（被代理人）；不传则默认当前登录用户 */
  principalId: z.number().int().positive().optional(),
  delegateId: z.number().int().positive('请选择代理人'),
  definitionId: z.number().int().positive().nullable().optional(),
  reason: z.string().max(255).nullable().optional(),
  startAt: z.string().max(32).nullable().optional(),
  endAt: z.string().max(32).nullable().optional(),
  enabled: z.boolean().default(true),
});
export const updateWorkflowDelegationSchema = createWorkflowDelegationSchema.partial();

// ── 管理员强制操作 ──
export const jumpWorkflowInstanceSchema = z.object({
  /** 强制跳转到的目标节点 key */
  targetNodeKey: z.string().min(1, '请选择目标节点'),
  comment: z.string().max(500).optional(),
});

export const reassignWorkflowTaskSchema = z.object({
  targetUserId: z.number().int().positive('请选择新的处理人'),
  comment: z.string().max(500).optional(),
});

/** 管理员挂起流程实例 */
export const suspendWorkflowInstanceSchema = z.object({
  reason: z.string().min(1, '请填写挂起原因').max(500),
});

/** 离职交接：把 fromUser 名下未处理待办批量移交 toUser */
export const workflowHandoverSchema = z.object({
  fromUserId: z.number().int().positive('请选择交接人'),
  toUserId: z.number().int().positive('请选择接手人'),
  /** 同时停用交接人名下启用中的审批代理规则（默认 true） */
  disableDelegations: z.boolean().optional(),
  comment: z.string().max(255).optional(),
});

// ── 流程模板 ──
export const createWorkflowTemplateSchema = z.object({
  name: z.string().min(1, '模板名称不能为空').max(64),
  code: z.string().max(64).nullable().optional(),
  description: z.string().max(500).nullable().optional(),
  categoryName: z.string().max(64).nullable().optional(),
  icon: z.string().max(64).nullable().optional(),
  color: z.string().max(16).nullable().optional(),
  flowData: z.record(z.string(), z.unknown()).nullable().optional(),
  formSchema: z.record(z.string(), z.unknown()).nullable().optional(),
  sort: z.number().int().nonnegative().default(0),
});
export const updateWorkflowTemplateSchema = createWorkflowTemplateSchema.partial();
/** 从现有流程定义另存为模板 */
export const saveAsTemplateSchema = z.object({
  definitionId: z.number().int().positive('请选择流程定义'),
  name: z.string().min(1, '模板名称不能为空').max(64),
  code: z.string().max(64).nullable().optional(),
  description: z.string().max(500).nullable().optional(),
  icon: z.string().max(64).nullable().optional(),
  color: z.string().max(16).nullable().optional(),
});
/** 从模板创建流程定义 */
export const cloneFromTemplateSchema = z.object({
  name: z.string().min(1, '流程名称不能为空').max(64).optional(),
  description: z.string().max(512).nullable().optional(),
  categoryId: z.number().int().positive().nullable().optional(),
});

/** 批量推进卡死实例：按流程定义 + 节点 + 卡死时长筛选活动 Token 后逐个跳过推进 */
export const batchSkipStuckTokensSchema = z.object({
  definitionId: z.number().int().positive(),
  nodeKey: z.string().min(1, '请指定节点').max(64),
  olderThanMinutes: z.number().int().nonnegative().max(100000).optional(),
  reason: z.string().max(256).optional(),
});
export type BatchSkipStuckTokensInput = z.infer<typeof batchSkipStuckTokensSchema>;


// ── 审批协办 ──
export const createWorkflowConsultSchema = z.object({
  consulteeIds: z.array(z.number().int().positive()).min(1, '请选择协办人').max(20),
  question: z.string().max(500).optional(),
});
export const replyWorkflowConsultSchema = z.object({
  opinion: z.string().min(1, '协办意见不能为空').max(1000),
});

// ── 撤回已办 ──
export const recallWorkflowTaskSchema = z.object({
  comment: z.string().max(500).optional(),
});

export type CreateWorkflowDefinitionInput = z.infer<typeof createWorkflowDefinitionSchema>;
export type UpdateWorkflowDefinitionInput = z.infer<typeof updateWorkflowDefinitionSchema>;
export type CreateWorkflowInstanceInput = z.infer<typeof createWorkflowInstanceSchema>;
export type ApproveWorkflowTaskInput = z.infer<typeof approveWorkflowTaskSchema>;
export type RejectWorkflowTaskInput = z.infer<typeof rejectWorkflowTaskSchema>;
export type TransferWorkflowTaskInput = z.infer<typeof transferWorkflowTaskSchema>;
export type DelegateWorkflowTaskInput = z.infer<typeof delegateWorkflowTaskSchema>;
export type AddSignWorkflowTaskInput = z.infer<typeof addSignWorkflowTaskSchema>;
export type ReduceSignWorkflowTaskInput = z.infer<typeof reduceSignWorkflowTaskSchema>;
export type ReturnWorkflowTaskInput = z.infer<typeof returnWorkflowTaskSchema>;
export type UrgeWorkflowTaskInput = z.infer<typeof urgeWorkflowTaskSchema>;
export type AddInstanceCcInput = z.infer<typeof addInstanceCcSchema>;
export type CreateWorkflowInstanceWithDraftInput = z.infer<typeof createWorkflowInstanceWithDraftSchema>;
export type SubmitWorkflowDraftInput = z.infer<typeof submitWorkflowDraftSchema>;
export type UpdateWorkflowInstanceInput = z.infer<typeof updateWorkflowInstanceSchema>;
export type BatchApproveWorkflowTaskInput = z.infer<typeof batchApproveWorkflowTaskSchema>;
export type BatchRejectWorkflowTaskInput = z.infer<typeof batchRejectWorkflowTaskSchema>;
export type BatchWithdrawWorkflowInstanceInput = z.infer<typeof batchWithdrawWorkflowInstanceSchema>;
export type BatchUrgeWorkflowInstanceInput = z.infer<typeof batchUrgeWorkflowInstanceSchema>;
export type ImportWorkflowDefinitionInput = z.infer<typeof importWorkflowDefinitionSchema>;
export type CreateWorkflowCommentInput = z.infer<typeof createWorkflowCommentSchema>;
export type CreateWorkflowQuickPhraseInput = z.infer<typeof createWorkflowQuickPhraseSchema>;
export type UpdateWorkflowQuickPhraseInput = z.infer<typeof updateWorkflowQuickPhraseSchema>;
export type CreateWorkflowDelegationInput = z.infer<typeof createWorkflowDelegationSchema>;
export type UpdateWorkflowDelegationInput = z.infer<typeof updateWorkflowDelegationSchema>;
export type JumpWorkflowInstanceInput = z.infer<typeof jumpWorkflowInstanceSchema>;
export type ReassignWorkflowTaskInput = z.infer<typeof reassignWorkflowTaskSchema>;
export type CreateWorkflowTemplateInput = z.infer<typeof createWorkflowTemplateSchema>;
export type UpdateWorkflowTemplateInput = z.infer<typeof updateWorkflowTemplateSchema>;
export type SaveAsTemplateInput = z.infer<typeof saveAsTemplateSchema>;
export type CloneFromTemplateInput = z.infer<typeof cloneFromTemplateSchema>;
export type CreateWorkflowConsultInput = z.infer<typeof createWorkflowConsultSchema>;
export type ReplyWorkflowConsultInput = z.infer<typeof replyWorkflowConsultSchema>;
export type RecallWorkflowTaskInput = z.infer<typeof recallWorkflowTaskSchema>;

// ─── 聊天 ─────────────────────────────────────────────────────────────────────
export const chatLinkPreviewSchema = z.object({
  url: z.url(),
  title: z.string().min(1).max(512),
  description: z.string().max(4000).nullable(),
  siteName: z.string().max(255).nullable(),
  image: z.url().nullable(),
  favicon: z.url().nullable(),
}).strict();

export const chatAssetMetaSchema = z.object({
  kind: z.enum(['image', 'file', 'voice', 'video']),
  name: z.string().min(1).max(512),
  size: z.number().int().nonnegative(),
  mimeType: z.string().max(255).nullable(),
  extension: z.string().max(50).nullable(),
  width: z.number().int().positive().nullable().optional(),
  height: z.number().int().positive().nullable().optional(),
  thumbnailUrl: z.string().max(2048).nullable().optional(),
  duration: z.number().nonnegative().nullable().optional(),
}).strict();

export const chatMentionSchema = z.object({
  userId: z.number().int().positive(),
  nickname: z.string().min(1).max(100),
}).strict();

export const chatAnnouncementHistorySchema = z.object({
  announcement: z.string().max(500).nullable(),
  operatorName: z.string().max(100).nullable(),
}).strict();

export const chatForwardedItemSchema = z.object({
  senderName: z.string().max(100).nullable(),
  type: z.enum(['text', 'image', 'file', 'system', 'forward', 'vote', 'voice', 'card', 'video']),
  content: z.string().max(4096),
  createdAt: z.string(),
  asset: chatAssetMetaSchema.nullable().optional(),
});

export const chatCardFieldSchema = z.object({
  label: z.string().max(60),
  value: z.string().max(500),
});

export const chatCardActionSchema = z.object({
  key: z.string().max(40),
  label: z.string().max(40),
  theme: z.enum(['primary', 'secondary', 'danger', 'tertiary']).optional(),
  action: z.enum(['workflow:approve', 'workflow:reject', 'link', 'none']),
  taskId: z.number().int().positive().nullable().optional(),
  url: z.string().max(1024).nullable().optional(),
  requireComment: z.boolean().optional(),
});

export const chatCardSchema = z.object({
  title: z.string().min(1).max(120),
  text: z.string().max(2000).nullable().optional(),
  fields: z.array(chatCardFieldSchema).max(20).nullable().optional(),
  actions: z.array(chatCardActionSchema).max(6).nullable().optional(),
  source: z.string().max(40).nullable().optional(),
  status: z.enum(['pending', 'done']).nullable().optional(),
  statusText: z.string().max(60).nullable().optional(),
  instanceId: z.number().int().positive().nullable().optional(),
});

export const chatBotMetaSchema = z.object({
  name: z.string().min(1).max(64),
  avatar: z.string().max(256).nullable().optional(),
});

export const chatVoteOptionSchema = z.object({
  id: z.string().max(36),
  label: z.string().min(1).max(200),
});

export const chatVoteRecordSchema = z.object({
  userId: z.number().int(),
  optionIds: z.array(z.string().max(36)),
  nickname: z.string().max(100),
});

export const chatVoteDataSchema = z.object({
  question: z.string().min(1).max(500),
  options: z.array(chatVoteOptionSchema).min(2).max(10),
  isMultiple: z.boolean(),
  isAnonymous: z.boolean(),
  expireAt: z.string().nullable(),
  votes: z.array(chatVoteRecordSchema),
  isClosed: z.boolean(),
});

export const chatMessageExtraSchema = z.object({
  asset: chatAssetMetaSchema.nullable().optional(),
  linkPreview: chatLinkPreviewSchema.nullable().optional(),
  mentions: z.array(chatMentionSchema).max(20).nullable().optional(),
  isFavorited: z.boolean().optional(),
  isPinned: z.boolean().optional(),
  announcementHistory: chatAnnouncementHistorySchema.nullable().optional(),
  forwardedMessages: z.array(chatForwardedItemSchema).max(100).nullable().optional(),
  forwardSourceConvName: z.string().max(100).nullable().optional(),
  hiddenFor: z.array(z.number().int()).nullable().optional(),
  voteData: chatVoteDataSchema.nullable().optional(),
  card: chatCardSchema.nullable().optional(),
  bot: chatBotMetaSchema.nullable().optional(),
}).strict();

export const sendChatMessageSchema = z.object({
  content: z.string().min(1, '消息不能为空').max(4096),
  type: z.enum(['text', 'image', 'file', 'forward', 'vote', 'voice', 'video']).default('text'),
  replyToId: z.number().int().positive().nullable().optional(),
  extra: chatMessageExtraSchema.nullable().optional(),
});

export const editChatMessageSchema = z.object({
  content: z.string().min(1, '消息不能为空').max(4096),
});

export type EditChatMessageInput = z.infer<typeof editChatMessageSchema>;

export const forwardMessagesSchema = z.object({
  messageIds: z.array(z.number().int().positive()).min(1).max(100),
  targetConversationIds: z.array(z.number().int().positive()).min(1).max(20),
  mode: z.enum(['merge', 'individual']),
});

export type SendChatMessageInput = z.infer<typeof sendChatMessageSchema>;
export type ForwardMessagesInput = z.infer<typeof forwardMessagesSchema>;

// ── 聊天入站 Webhook 机器人 ──
export const createChatWebhookSchema = z.object({
  name: z.string().min(1, '名称不能为空').max(64),
  avatar: z.string().max(256).nullable().optional(),
  description: z.string().max(255).nullable().optional(),
  conversationId: z.number().int().positive('请选择目标会话'),
  enabled: z.boolean().default(true),
});
export const updateChatWebhookSchema = createChatWebhookSchema.partial().omit({ conversationId: true });

export type CreateChatWebhookInput = z.infer<typeof createChatWebhookSchema>;
export type UpdateChatWebhookInput = z.infer<typeof updateChatWebhookSchema>;

/** 入站 Webhook 推送 body：文本或卡片 */
export const chatWebhookPayloadSchema = z.object({
  type: z.enum(['text', 'card']).default('text'),
  text: z.string().max(4096).optional(),
  card: chatCardSchema.optional(),
}).refine((v) => (v.type === 'card' ? !!v.card : !!v.text), {
  message: 'text 或 card 至少提供一个',
});

export type ChatWebhookPayloadInput = z.infer<typeof chatWebhookPayloadSchema>;

// ─── Channel（站内公众号）管理 ────────────────────────────────────────────────
export const createChannelSchema = z.object({
  code: z.string().min(1).max(64).regex(/^[a-z0-9-]+$/, 'code 只能包含小写字母、数字和连字符'),
  name: z.string().min(1).max(64),
  avatar: z.string().max(256).nullable().optional(),
  description: z.string().max(255).nullable().optional(),
});
export type CreateChannelInput = z.infer<typeof createChannelSchema>;

export const updateChannelSchema = z.object({
  name: z.string().min(1).max(64).optional(),
  avatar: z.string().max(256).nullable().optional(),
  description: z.string().max(255).nullable().optional(),
  status: z.enum(['enabled', 'disabled']).optional(),
});
export type UpdateChannelInput = z.infer<typeof updateChannelSchema>;

/** 群发受众范围定义（mode=all 时其余字段忽略） */
export const channelPublishAudienceSchema = z.object({
  mode: z.enum(['all', 'users', 'departments', 'roles']).default('all'),
  userIds: z.array(z.number().int().positive()).optional(),
  departmentIds: z.array(z.number().int().positive()).optional(),
  roleIds: z.array(z.number().int().positive()).optional(),
});
export type ChannelPublishAudienceInput = z.infer<typeof channelPublishAudienceSchema>;

/** 管理端群发（文本 / 图片 / 图文 + 受众 + 立即/定时/草稿） */
export const publishChannelSchema = z
  .object({
    type: z.enum(['text', 'image', 'news']).default('text'),
    title: z.string().max(200).nullable().optional(),
    content: z.string().max(10000).default(''),
    imageUrl: z.string().max(1000).nullable().optional(),
    cover: z.string().max(1000).nullable().optional(),
    summary: z.string().max(500).nullable().optional(),
    linkUrl: z.string().max(1000).nullable().optional(),
    audience: channelPublishAudienceSchema.default({ mode: 'all' }),
    sendMode: z.enum(['now', 'scheduled', 'draft']).default('now'),
    scheduledAt: z.string().max(32).nullable().optional(),
  })
  .refine((v) => v.type !== 'text' || v.content.trim().length > 0, { message: '文本内容不能为空', path: ['content'] })
  .refine((v) => v.type !== 'image' || (v.imageUrl?.trim().length ?? 0) > 0, { message: '请上传图片', path: ['imageUrl'] })
  .refine((v) => v.type !== 'news' || (v.title?.trim().length ?? 0) > 0, { message: '图文消息必须填写标题', path: ['title'] })
  .refine((v) => v.sendMode !== 'scheduled' || (v.scheduledAt?.trim().length ?? 0) > 0, { message: '定时发送必须选择发送时间', path: ['scheduledAt'] })
  .refine((v) => v.audience.mode !== 'users' || (v.audience.userIds?.length ?? 0) > 0, { message: '请选择目标用户', path: ['audience', 'userIds'] })
  .refine((v) => v.audience.mode !== 'departments' || (v.audience.departmentIds?.length ?? 0) > 0, { message: '请选择目标部门', path: ['audience', 'departmentIds'] })
  .refine((v) => v.audience.mode !== 'roles' || (v.audience.roleIds?.length ?? 0) > 0, { message: '请选择目标角色', path: ['audience', 'roleIds'] });
export type PublishChannelInput = z.infer<typeof publishChannelSchema>;

/** 用户向运营号发送一条消息 */
export const sendChannelMessageSchema = z.object({
  content: z.string().min(1, '内容不能为空').max(2000),
});
export type SendChannelMessageInput = z.infer<typeof sendChannelMessageSchema>;

/** 客服回复用户 */
export const channelReplySchema = z.object({
  content: z.string().min(1, '回复内容不能为空').max(2000),
});
export type ChannelReplyInput = z.infer<typeof channelReplySchema>;

/** 公众号底部菜单 —— 单个菜单节点 */
const channelMenuNodeSchema = z.object({
  name: z.string().min(1, '菜单名称不能为空').max(32),
  type: z.enum(['click', 'view']).default('click'),
  value: z.string().max(500).nullable().optional(),
  children: z
    .array(
      z.object({
        name: z.string().min(1, '子菜单名称不能为空').max(32),
        type: z.enum(['click', 'view']).default('click'),
        value: z.string().max(500).nullable().optional(),
      }),
    )
    .max(5, '每个一级菜单最多 5 个子菜单')
    .optional(),
});

/** 批量保存公众号底部菜单（整体替换） */
export const saveChannelMenusSchema = z.object({
  menus: z.array(channelMenuNodeSchema).max(3, '最多 3 个一级菜单'),
});
export type SaveChannelMenusInput = z.infer<typeof saveChannelMenusSchema>;

/** 富内容自动回复扩展（image: imageUrl；news: title/cover/summary/linkUrl） */
const channelRichReplyExtraSchema = z.object({
  imageUrl: z.string().max(1000).nullable().optional(),
  title: z.string().max(200).nullable().optional(),
  cover: z.string().max(1000).nullable().optional(),
  summary: z.string().max(500).nullable().optional(),
  linkUrl: z.string().max(1000).nullable().optional(),
});

/** 新建频道自动回复规则 */
export const createChannelAutoReplySchema = z
  .object({
    matchType: z.enum(['subscribe', 'keyword', 'default']),
    keyword: z.string().max(100).nullable().optional(),
    keywordMode: z.enum(['exact', 'contains']).default('contains'),
    replyType: z.enum(['text', 'image', 'news']).default('text'),
    replyContent: z.string().max(10000).default(''),
    replyExtra: channelRichReplyExtraSchema.nullable().optional(),
    status: z.enum(['enabled', 'disabled']).default('enabled'),
    sort: z.number().int().min(0).default(0),
  })
  .refine((v) => v.matchType !== 'keyword' || (v.keyword != null && v.keyword.trim().length > 0), {
    message: '关键词回复必须填写关键词',
    path: ['keyword'],
  })
  .refine((v) => v.replyType !== 'text' || v.replyContent.trim().length > 0, {
    message: '文本回复内容不能为空',
    path: ['replyContent'],
  })
  .refine((v) => v.replyType !== 'image' || (v.replyExtra?.imageUrl?.trim().length ?? 0) > 0, {
    message: '图片回复必须上传图片',
    path: ['replyExtra', 'imageUrl'],
  })
  .refine((v) => v.replyType !== 'news' || (v.replyExtra?.title?.trim().length ?? 0) > 0, {
    message: '图文回复必须填写标题',
    path: ['replyExtra', 'title'],
  });
export type CreateChannelAutoReplyInput = z.infer<typeof createChannelAutoReplySchema>;

/** 更新频道自动回复规则 */
export const updateChannelAutoReplySchema = z
  .object({
    keyword: z.string().max(100).nullable().optional(),
    keywordMode: z.enum(['exact', 'contains']).optional(),
    replyType: z.enum(['text', 'image', 'news']).optional(),
    replyContent: z.string().max(10000).optional(),
    replyExtra: channelRichReplyExtraSchema.nullable().optional(),
    status: z.enum(['enabled', 'disabled']).optional(),
    sort: z.number().int().min(0).optional(),
  });
export type UpdateChannelAutoReplyInput = z.infer<typeof updateChannelAutoReplySchema>;

/** 新建客服快捷回复（channelId 为 null = 全局，所有运营号通用） */
export const createChannelQuickReplySchema = z.object({
  channelId: z.number().int().positive().nullable().optional(),
  title: z.string().min(1, '标题不能为空').max(100),
  content: z.string().min(1, '内容不能为空').max(2000),
  sort: z.number().int().min(0).default(0),
});
export type CreateChannelQuickReplyInput = z.infer<typeof createChannelQuickReplySchema>;

/** 更新客服快捷回复 */
export const updateChannelQuickReplySchema = createChannelQuickReplySchema.partial();
export type UpdateChannelQuickReplyInput = z.infer<typeof updateChannelQuickReplySchema>;

/** 指派 / 转接会话（assigneeId 为 null = 取消指派） */
export const assignConversationSchema = z.object({
  assigneeId: z.number().int().positive().nullable(),
});
export type AssignConversationInput = z.infer<typeof assignConversationSchema>;

/** 设置会话标签（整体替换） */
export const setConversationTagsSchema = z.object({
  tags: z.array(z.string().min(1).max(20)).max(10, '最多 10 个标签'),
});
export type SetConversationTagsInput = z.infer<typeof setConversationTagsSchema>;

/** 群发受众预估请求（复用群发受众定义） */
export const audienceEstimateSchema = z.object({
  audience: channelPublishAudienceSchema,
});
export type AudienceEstimateInput = z.infer<typeof audienceEstimateSchema>;

/** 新建群发消息模板 */
export const createChannelTemplateSchema = z.object({
  name: z.string().min(1, '模板名称不能为空').max(100),
  type: z.enum(['text', 'image', 'news']).default('text'),
  title: z.string().max(200).nullable().optional(),
  content: z.string().max(10000).default(''),
  extra: z.record(z.string(), z.unknown()).nullable().optional(),
});
export type CreateChannelTemplateInput = z.infer<typeof createChannelTemplateSchema>;

/** 更新群发消息模板 */
export const updateChannelTemplateSchema = createChannelTemplateSchema.partial();
export type UpdateChannelTemplateInput = z.infer<typeof updateChannelTemplateSchema>;

/** 添加订阅者（运营号批量加订阅用户） */
export const addChannelSubscribersSchema = z.object({
  userIds: z.array(z.number().int().positive()).min(1, '请选择用户'),
});
export type AddChannelSubscribersInput = z.infer<typeof addChannelSubscribersSchema>;

/** 用户对客服会话评价 */
export const rateConversationSchema = z.object({
  rating: z.number().int().min(1).max(5),
  comment: z.string().max(500).nullable().optional(),
});
export type RateConversationInput = z.infer<typeof rateConversationSchema>;

// ── 通话记录（结束后写入会话系统消息）──
export const chatCallRecordSchema = z.object({
  callType: z.enum(['audio', 'video']),
  mode: z.enum(['p2p', 'group']),
  status: z.enum(['completed', 'missed', 'canceled', 'rejected']),
  /** 通话时长（秒），completed 时有效 */
  durationSec: z.number().int().nonnegative().default(0),
});

export type ChatCallRecordInput = z.infer<typeof chatCallRecordSchema>;

// ─── AI 对话模块 ──────────────────────────────────────────────────────────────

export const aiProviderEnum = z.enum(['openai_compatible', 'anthropic', 'gemini', 'baidu']);

export const createAiProviderConfigSchema = z.object({
  name: z.string().min(1, '名称不能为空').max(100),
  provider: aiProviderEnum.default('openai_compatible'),
  baseUrl: z.url('请输入有效的 URL').max(500),
  apiKey: z.string().min(1, 'API Key 不能为空').max(1000),
  model: z.string().min(1, '模型名称不能为空').max(100),
  systemPrompt: z.string().max(4096).nullable().optional(),
  maxTokens: z.number().int().min(1).max(128000).default(4096),
  temperature: z.string().regex(/^\d+(\.\d+)?$/, '温度须为数字字符串').default('0.7'),
  isDefault: z.boolean().default(false),
  isEnabled: z.boolean().default(true),
});

export const updateAiProviderConfigSchema = createAiProviderConfigSchema.partial();

export type CreateAiProviderConfigInput = z.infer<typeof createAiProviderConfigSchema>;
export type UpdateAiProviderConfigInput = z.infer<typeof updateAiProviderConfigSchema>;

export const testAiConnectionSchema = z.object({
  /** 已有配置的 id；提供时若 apiKey 为空则从 DB 取真实密钥 */
  id: z.number().int().positive().optional(),
  provider: aiProviderEnum.default('openai_compatible'),
  baseUrl: z.url('请输入有效的 URL').max(500),
  apiKey: z.string().max(1000).optional(),
  model: z.string().min(1, '模型名称不能为空').max(100),
});

export type TestAiConnectionInput = z.infer<typeof testAiConnectionSchema>;

export const createAiConversationSchema = z.object({
  title: z.string().max(200).optional(),
});

export const sendAiMessageSchema = z.object({
  message: z.string().min(1, '消息不能为空').max(8192),
});

export type SendAiMessageInput = z.infer<typeof sendAiMessageSchema>;

export const saveUserAiConfigSchema = z.object({
  name: z.string().max(100).nullable().optional(),
  provider: aiProviderEnum.optional(),
  baseUrl: z.url('请输入有效的 URL').max(500).nullable().optional(),
  apiKey: z.string().max(1000).nullable().optional(),
  model: z.string().max(100).nullable().optional(),
  temperature: z.string().max(10).nullable().optional(),
  maxTokens: z.number().int().min(1).max(128000).nullable().optional(),
  systemPrompt: z.string().max(5000).nullable().optional(),
  isEnabled: z.boolean().optional(),
});

export type SaveUserAiConfigInput = z.infer<typeof saveUserAiConfigSchema>;

// ─── AI 提示词模板 Schema ──────────────────────────────────────────────────────
export const aiPromptScopeEnum = z.enum(['system', 'user']);

export const createAiPromptTemplateSchema = z.object({
  name: z.string().min(1, '名称不能为空').max(100),
  content: z.string().min(1, '提示词内容不能为空').max(5000),
  description: z.string().max(300).nullable().optional(),
  category: z.string().max(50).nullable().optional(),
  scope: aiPromptScopeEnum.default('system'),
  sort: z.number().int().min(0).default(0),
  isEnabled: z.boolean().default(true),
});

export const updateAiPromptTemplateSchema = createAiPromptTemplateSchema.partial();

export type CreateAiPromptTemplateInput = z.infer<typeof createAiPromptTemplateSchema>;
export type UpdateAiPromptTemplateInput = z.infer<typeof updateAiPromptTemplateSchema>;

export const setConversationSystemPromptSchema = z.object({
  systemPrompt: z.string().max(5000).nullable(),
});

export const aiFeedbackReasonEnum = z.enum(['inaccurate', 'irrelevant', 'harmful', 'other']);
export const aiFeedbackStatusEnum = z.enum(['pending', 'resolved', 'ignored']);

export const submitAiFeedbackSchema = z.object({
  feedback: z.union([z.literal(1), z.literal(-1), z.null()]),
  reason: z.string().max(200).nullable().optional(),
});

export const updateAiFeedbackStatusSchema = z.object({
  status: aiFeedbackStatusEnum,
  remark: z.string().max(500).nullable().optional(),
});

export type SubmitAiFeedbackInput = z.infer<typeof submitAiFeedbackSchema>;
export type UpdateAiFeedbackStatusInput = z.infer<typeof updateAiFeedbackStatusSchema>;

// ─── 数据脱敏配置 Schema ──────────────────────────────────────────────────────

export const maskTypeValues = ['phone', 'email', 'id_card', 'name', 'bank_card', 'custom'] as const;

export const customMaskRuleSchema = z.object({
  prefixKeep: z.number().int().min(0).max(20),
  suffixKeep: z.number().int().min(0).max(20),
  maskChar:   z.string().max(2).optional(),
});

export const createDataMaskConfigSchema = z.object({
  entity:          z.string().min(1, '实体名称不能为空').max(64),
  field:           z.string().min(1, '字段名称不能为空').max(64),
  label:           z.string().min(1, '字段标签不能为空').max(64),
  maskType:        z.enum(maskTypeValues),
  customRule:      customMaskRuleSchema.nullable().optional(),
  exemptRoleCodes: z.array(z.string().max(64)).default([]),
  enabled:         z.boolean().default(true),
  remark:          z.string().max(256).optional(),
});

export const updateDataMaskConfigSchema = createDataMaskConfigSchema.partial();

export type CreateDataMaskConfigInput = z.infer<typeof createDataMaskConfigSchema>;
export type UpdateDataMaskConfigInput = z.infer<typeof updateDataMaskConfigSchema>;

// ─── 进程管理 ────────────────────────────────────────────────────────────────
export const killProcessSchema = z.object({
  signal: z.enum(['SIGTERM', 'SIGKILL', 'SIGINT', 'SIGHUP']).default('SIGTERM'),
});

export const setProcessPrioritySchema = z.object({
  /** Nice value -20~19 for Linux/macOS */
  nice: z.number().int().min(-20).max(19).optional(),
  /** Priority class for Windows */
  priorityClass: z.enum(['Idle', 'BelowNormal', 'Normal', 'AboveNormal', 'High', 'RealTime']).optional(),
});

export type KillProcessInput = z.infer<typeof killProcessSchema>;
export type SetProcessPriorityInput = z.infer<typeof setProcessPrioritySchema>;

// ─── SQL 收藏夹 ─────────────────────────────────────────────────────────────────
export const createDbQueryFavoriteSchema = z.object({
  name: z.string().min(1, '名称不能为空').max(100),
  sql: z.string().min(1, 'SQL 不能为空'),
  description: z.string().max(500).optional(),
  tags: z.array(z.string().max(50)).max(10).default([]),
});

export const updateDbQueryFavoriteSchema = createDbQueryFavoriteSchema.partial();

export type CreateDbQueryFavoriteInput = z.infer<typeof createDbQueryFavoriteSchema>;
export type UpdateDbQueryFavoriteInput = z.infer<typeof updateDbQueryFavoriteSchema>;

// ─── 支付中心 ────────────────────────────────────────────────────────
export const createPaymentChannelConfigSchema = z.object({
  name: z.string().min(1, '名称不能为空').max(64),
  channel: z.enum(['wechat', 'alipay', 'unionpay']),
  status: z.enum(['enabled', 'disabled']).default('enabled'),
  isDefault: z.boolean().default(false),
  sandbox: z.boolean().default(false),
  notifyUrl: z.string().max(512).optional(),
  // 微信（明文入参，service 层加密后入库）
  wechatAppId: z.string().max(64).optional(),
  wechatMchId: z.string().max(64).optional(),
  wechatApiV3Key: z.string().max(128).optional(),
  wechatPrivateKey: z.string().optional(),
  wechatSerialNo: z.string().max(128).optional(),
  wechatPlatformCert: z.string().optional(),
  // 支付宝
  alipayAppId: z.string().max(64).optional(),
  alipayPrivateKey: z.string().optional(),
  alipayPublicKey: z.string().optional(),
  alipaySignType: z.enum(['RSA2', 'RSA']).default('RSA2'),
  alipayGateway: z.string().max(256).optional(),
  // 云闪付（银联全渠道）
  unionpayMerId: z.string().max(64).optional(),
  unionpayPrivateKey: z.string().optional(),
  unionpayCertId: z.string().max(64).optional(),
  unionpayPublicKey: z.string().optional(),
  unionpayGateway: z.string().max(256).optional(),
  remark: z.string().max(256).optional(),
});

export const updatePaymentChannelConfigSchema = createPaymentChannelConfigSchema.partial();

/** 业务/后台发起支付下单 */
export const createPaymentSchema = z.object({
  bizType: z.string().min(1).max(64),
  bizId: z.string().min(1).max(128),
  subject: z.string().min(1).max(256),
  body: z.string().max(512).optional(),
  amount: z.number().int().positive('金额必须大于 0'), // 分
  payMethod: z.enum(['wechat_native', 'wechat_jsapi', 'wechat_h5', 'alipay_page', 'alipay_wap', 'alipay_app', 'unionpay_qr']),
  channelConfigId: z.number().int().positive().optional(),
  /** 按应用下单：路由到该应用绑定的渠道配置（与 channelConfigId 互斥，appKey 优先） */
  appKey: z.string().max(64).optional(),
  openId: z.string().max(128).optional(),
  userId: z.number().int().positive().optional(),
  expireMinutes: z.number().int().positive().max(1440).default(30),
});

/** 发起退款 */
export const createRefundSchema = z.object({
  orderNo: z.string().min(1).max(64),
  refundAmount: z.number().int().positive('退款金额必须大于 0'), // 分
  reason: z.string().max(256).optional(),
});

export type CreatePaymentChannelConfigInput = z.infer<typeof createPaymentChannelConfigSchema>;
export type UpdatePaymentChannelConfigInput = z.infer<typeof updatePaymentChannelConfigSchema>;
export type CreatePaymentInput = z.infer<typeof createPaymentSchema>;
export type CreateRefundInput = z.infer<typeof createRefundSchema>;

// ─── 支付中心扩展 · B 档（费率 / 分账 / 支付链接 / 风控 / 支付方式）──────────────
const paymentChannelZ = z.enum(['wechat', 'alipay', 'unionpay']);
const paymentMethodZ = z.enum(['wechat_native', 'wechat_jsapi', 'wechat_h5', 'alipay_page', 'alipay_wap', 'alipay_app', 'unionpay_qr']);

/** 手续费/费率规则 */
export const createPaymentFeeRuleSchema = z.object({
  name: z.string().min(1).max(64),
  channel: paymentChannelZ,
  payMethod: paymentMethodZ.optional(),
  rateBps: z.number().int().min(0).max(100000).default(0), // 万分比
  fixedFee: z.number().int().min(0).default(0), // 分
  minFee: z.number().int().min(0).optional(),
  maxFee: z.number().int().min(0).optional(),
  status: z.enum(['enabled', 'disabled']).default('enabled'),
  priority: z.number().int().min(0).max(9999).default(0),
  remark: z.string().max(256).optional(),
});
export const updatePaymentFeeRuleSchema = createPaymentFeeRuleSchema.partial();

/** 分账接收方 */
export const createPaymentSharingReceiverSchema = z.object({
  name: z.string().min(1).max(64),
  receiverType: z.enum(['merchant', 'personal']).default('merchant'),
  account: z.string().min(1).max(128),
  ratioBps: z.number().int().min(0).max(10000).optional(), // 万分比
  autoShare: z.boolean().default(false),
  status: z.enum(['enabled', 'disabled']).default('enabled'),
  remark: z.string().max(256).optional(),
});
export const updatePaymentSharingReceiverSchema = createPaymentSharingReceiverSchema.partial();

/** 对账差异处理 */
export const handlePaymentReconItemSchema = z.object({
  action: z.enum(['adjusted', 'suspended', 'ignored']),
  remark: z.string().max(256).optional(),
});

/** 转账/代付 */
export const createPaymentTransferSchema = z.object({
  channel: paymentChannelZ,
  channelConfigId: z.number().int().positive().optional(),
  receiverAccount: z.string().min(1).max(128),
  receiverName: z.string().max(64).optional(),
  amount: z.number().int().positive('转账金额必须大于 0'), // 分
  remark: z.string().max(256).optional(),
  bizType: z.string().max(64).optional(),
  bizId: z.string().max(128).optional(),
});

/** 支付应用（App 维度） */
export const createPaymentAppSchema = z.object({
  name: z.string().min(1).max(64),
  appKey: z.string().min(3).max(64).regex(/^[a-zA-Z0-9_-]+$/, 'appKey 仅允许字母/数字/下划线/中划线'),
  status: z.enum(['enabled', 'disabled']).default('enabled'),
  wechatConfigId: z.number().int().positive().nullable().optional(),
  alipayConfigId: z.number().int().positive().nullable().optional(),
  unionpayConfigId: z.number().int().positive().nullable().optional(),
  remark: z.string().max(256).optional(),
});
export const updatePaymentAppSchema = createPaymentAppSchema.partial();

/** 支付链接 */
export const createPaymentLinkSchema = z.object({
  subject: z.string().min(1).max(256),
  amount: z.number().int().positive().optional(), // 分，留空=用户填写
  payMethod: paymentMethodZ.optional(),
  bizType: z.string().min(1).max(64),
  maxUses: z.number().int().positive().optional(),
  expiredAt: z.string().max(32).optional(),
  status: z.enum(['active', 'disabled']).default('active'),
  remark: z.string().max(256).optional(),
});
export const updatePaymentLinkSchema = createPaymentLinkSchema.partial();

/** 风控限额规则 */
export const createPaymentRiskRuleSchema = z.object({
  name: z.string().min(1).max(64),
  scope: z.enum(['global', 'channel', 'bizType']).default('global'),
  channel: paymentChannelZ.optional(),
  bizType: z.string().max(64).optional(),
  singleLimit: z.number().int().min(0).optional(), // 分
  dailyLimit: z.number().int().min(0).optional(), // 分
  dailyCountLimit: z.number().int().min(0).optional(),
  blocklist: z.array(z.string().max(128)).default([]),
  status: z.enum(['enabled', 'disabled']).default('enabled'),
  remark: z.string().max(256).optional(),
});
export const updatePaymentRiskRuleSchema = createPaymentRiskRuleSchema.partial();

/** 支付方式配置（仅更新展示/启停/排序） */
export const updatePaymentMethodConfigSchema = z.object({
  label: z.string().min(1).max(64).optional(),
  icon: z.string().max(128).optional(),
  enabled: z.boolean().optional(),
  sort: z.number().int().min(0).max(9999).optional(),
});

export type CreatePaymentFeeRuleInput = z.infer<typeof createPaymentFeeRuleSchema>;
export type UpdatePaymentFeeRuleInput = z.infer<typeof updatePaymentFeeRuleSchema>;
export type CreatePaymentSharingReceiverInput = z.infer<typeof createPaymentSharingReceiverSchema>;
export type UpdatePaymentSharingReceiverInput = z.infer<typeof updatePaymentSharingReceiverSchema>;
export type HandlePaymentReconItemInput = z.infer<typeof handlePaymentReconItemSchema>;
export type CreatePaymentTransferInput = z.infer<typeof createPaymentTransferSchema>;
export type CreatePaymentAppInput = z.infer<typeof createPaymentAppSchema>;
export type UpdatePaymentAppInput = z.infer<typeof updatePaymentAppSchema>;
export type CreatePaymentLinkInput = z.infer<typeof createPaymentLinkSchema>;
export type UpdatePaymentLinkInput = z.infer<typeof updatePaymentLinkSchema>;
export type CreatePaymentRiskRuleInput = z.infer<typeof createPaymentRiskRuleSchema>;
export type UpdatePaymentRiskRuleInput = z.infer<typeof updatePaymentRiskRuleSchema>;
export type UpdatePaymentMethodConfigInput = z.infer<typeof updatePaymentMethodConfigSchema>;

// ─── 会员中心（Member Center）────────────────────────────────────────
const memberPhoneSchema = z.string().regex(/^1[3-9]\d{9}$/, '请输入正确的手机号码');

/** 会员注册（支持用户名/手机/邮箱多种方式，至少提供一个凭证）*/
export const memberRegisterSchema = z
  .object({
    username: z.string().min(2, '用户名至少2个字符').max(32).optional(),
    phone: memberPhoneSchema.optional(),
    email: z.email('邮箱格式不正确').optional(),
    password: z.string().min(6, '密码至少6个字符').max(64).optional(),
    smsCode: z.string().length(6, '验证码为6位').optional(),
    nickname: z.string().min(1).max(32).optional(),
    /** 邀请码（选填，注册成功后绑定邀请关系并奖励邀请人）*/
    inviteCode: z.string().min(4).max(16).optional(),
  })
  .refine((d) => !!(d.username || d.phone || d.email), { message: '请至少提供用户名、手机号或邮箱' });

/** 会员登录：password（账号+密码）或 sms（手机号+验证码）*/
export const memberLoginSchema = z
  .object({
    loginType: z.enum(['password', 'sms']).default('password'),
    account: z.string().min(1, '请输入登录账号').max(128).optional(),
    password: z.string().min(1).max(64).optional(),
    phone: memberPhoneSchema.optional(),
    smsCode: z.string().length(6).optional(),
  })
  .refine((d) => (d.loginType === 'password' ? !!d.account && !!d.password : !!d.phone && !!d.smsCode), {
    message: '登录参数不完整',
  });

/** 发送短信验证码 */
export const memberSmsCodeSchema = z.object({
  phone: memberPhoneSchema,
  scene: z.enum(['register', 'login', 'reset']).default('login'),
});

/** 会员修改资料 */
export const memberUpdateProfileSchema = z.object({
  nickname: z.string().min(1).max(32).optional(),
  avatar: z.string().max(256).nullish(),
  gender: z.string().max(20).nullable().optional(),
  birthday: z.string().max(20).nullable().optional(),
  email: z.email().nullish(),
});

/** 会员修改密码（首次设密时 oldPassword 可空）*/
export const memberChangePasswordSchema = z.object({
  oldPassword: z.string().min(6).max(64).optional(),
  newPassword: z.string().min(6, '密码至少6个字符').max(64),
});

/** 会员忘记密码（手机验证码重置）*/
export const memberResetPasswordSchema = z.object({
  phone: memberPhoneSchema,
  smsCode: z.string().length(6),
  newPassword: z.string().min(6).max(64),
});

export type MemberRegisterInput = z.infer<typeof memberRegisterSchema>;
export type MemberLoginInput = z.infer<typeof memberLoginSchema>;
export type MemberSmsCodeInput = z.infer<typeof memberSmsCodeSchema>;
export type MemberUpdateProfileInput = z.infer<typeof memberUpdateProfileSchema>;
export type MemberChangePasswordInput = z.infer<typeof memberChangePasswordSchema>;
export type MemberResetPasswordInput = z.infer<typeof memberResetPasswordSchema>;

// ════════════════════════════════════════════════════════════════════════════
// 数据分析 / 埋点 / 错误监控
// ════════════════════════════════════════════════════════════════════════════

export const userBehaviorEventTypeEnum = z.enum([
  'page_view', 'page_leave', 'feature_use', 'area_click', 'custom', 'perf', 'api_request', 'identify',
]);

// ─── 埋点事件上报 ─────────────────────────────────────────────────────────────
export const trackEventInputSchema = z.object({
  sessionId: z.string().max(36),
  anonymousId: z.string().max(64).optional(),
  distinctId: z.string().max(64).optional(),
  eventType: userBehaviorEventTypeEnum,
  eventName: z.string().max(128).optional(),
  pagePath: z.string().max(256),
  pageTitle: z.string().max(128).optional(),
  elementKey: z.string().max(128).optional(),
  elementLabel: z.string().max(128).optional(),
  componentArea: z.string().max(64).optional(),
  clickX: z.number().min(0).max(100).optional(),
  clickY: z.number().min(0).max(100).optional(),
  scrollDepth: z.number().int().min(0).max(100).optional(),
  durationMs: z.number().int().min(0).max(86_400_000).optional(),
  properties: z.record(z.string(), z.unknown()).optional(),
  referrer: z.string().max(512).optional(),
  utmSource: z.string().max(128).optional(),
  utmMedium: z.string().max(128).optional(),
  utmCampaign: z.string().max(128).optional(),
  utmTerm: z.string().max(128).optional(),
  utmContent: z.string().max(128).optional(),
  screenW: z.number().int().min(0).max(100_000).optional(),
  screenH: z.number().int().min(0).max(100_000).optional(),
  language: z.string().max(16).optional(),
  metricName: z.string().max(32).optional(),
  metricValue: z.number().optional(),
  ts: z.number().int().positive().optional(),
});

export const batchTrackEventsSchema = z.object({
  events: z.array(trackEventInputSchema).min(1).max(100),
});

// ─── 错误上报 ─────────────────────────────────────────────────────────────────
export const errorBreadcrumbSchema = z.object({
  type: z.enum(['navigation', 'click', 'http', 'console', 'custom']),
  message: z.string().max(512),
  level: z.enum(['fatal', 'error', 'warning', 'info']).optional(),
  data: z.record(z.string(), z.unknown()).optional(),
  timestamp: z.string().max(32),
});

export const errorReportSchema = z.object({
  errorType: z.enum(['js_error', 'promise_rejection', 'resource_error', 'console_error', 'http_error', 'white_screen', 'crash']),
  level: z.enum(['fatal', 'error', 'warning', 'info']).optional(),
  message: z.string().min(1).max(2000),
  stack: z.string().max(16_000).optional(),
  sourceUrl: z.string().max(512).optional(),
  lineNo: z.number().int().optional(),
  colNo: z.number().int().optional(),
  pageUrl: z.string().max(512).optional(),
  release: z.string().max(64).optional(),
  sessionId: z.string().max(36).optional(),
  breadcrumbs: z.array(errorBreadcrumbSchema).max(50).optional(),
  context: z.record(z.string(), z.unknown()).optional(),
  httpStatus: z.number().int().optional(),
  httpMethod: z.string().max(16).optional(),
  httpUrl: z.string().max(512).optional(),
});

// ─── 错误处理（后台）─────────────────────────────────────────────────────────
export const updateErrorGroupSchema = z.object({
  status: z.enum(['unresolved', 'resolved', 'ignored', 'muted']).optional(),
  level: z.enum(['fatal', 'error', 'warning', 'info']).optional(),
  assigneeId: z.number().int().positive().nullable().optional(),
  note: z.string().max(2000).nullable().optional(),
});

// ─── 告警规则 ─────────────────────────────────────────────────────────────────
export const createErrorAlertRuleSchema = z.object({
  name: z.string().min(1).max(128),
  errorType: z.enum(['js_error', 'promise_rejection', 'resource_error', 'console_error', 'http_error', 'white_screen', 'crash']).nullable().optional(),
  level: z.enum(['fatal', 'error', 'warning', 'info']).nullable().optional(),
  condition: z.enum(['new_error', 'threshold', 'spike']).default('threshold'),
  thresholdCount: z.number().int().min(1).max(100_000).default(10),
  windowMinutes: z.number().int().min(1).max(10_080).default(60),
  channels: z.array(z.enum(['email', 'webhook', 'inapp'])).default([]),
  webhookUrl: z.string().max(512).nullable().optional(),
  recipients: z.array(z.string().max(128)).default([]),
  enabled: z.boolean().default(true),
});
export const updateErrorAlertRuleSchema = createErrorAlertRuleSchema.partial();

// ─── 系统监控告警规则 ─────────────────────────────────────────────────────────
export const monitorMetricValues = [
  'cpu', 'memory', 'disk', 'swap', 'load1', 'procCpu', 'heap', 'loopLag', 'qps', 'errorRate', 'netRxBps', 'netTxBps', 'diskReadBps', 'diskWriteBps',
  'workflowHealth', 'workflowBacklog', 'workflowDeadLetter', 'workflowFailureRate', 'workflowStuckRunning',
] as const;

export const createMonitorAlertRuleSchema = z.object({
  name: z.string().min(1, '名称不能为空').max(128),
  metric: z.enum(monitorMetricValues),
  operator: z.enum(['gt', 'gte', 'lt', 'lte']).default('gt'),
  threshold: z.number(),
  durationMinutes: z.number().int().min(0).max(1440).default(0),
  level: z.enum(['info', 'warning', 'critical']).default('warning'),
  channels: z.array(z.enum(['email', 'webhook', 'inapp'])).default([]),
  webhookUrl: z.string().max(512).nullable().optional(),
  recipients: z.array(z.string().max(128)).default([]),
  silenceMinutes: z.number().int().min(0).max(10_080).default(30),
  enabled: z.boolean().default(true),
});
export const updateMonitorAlertRuleSchema = createMonitorAlertRuleSchema.partial();

export const monitorAlertEventQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  metric: z.enum(monitorMetricValues).optional(),
  level: z.enum(['info', 'warning', 'critical']).optional(),
  status: z.enum(['firing', 'resolved']).optional(),
  ruleId: z.coerce.number().int().positive().optional(),
});

export const monitorHistoryQuerySchema = z.object({
  range: z.enum(['1h', '6h', '24h', '7d', '30d']).default('1h'),
});

export type CreateMonitorAlertRuleInput = z.infer<typeof createMonitorAlertRuleSchema>;
export type UpdateMonitorAlertRuleInput = z.infer<typeof updateMonitorAlertRuleSchema>;
export type MonitorAlertEventQuery = z.infer<typeof monitorAlertEventQuerySchema>;
export type MonitorHistoryQuery = z.infer<typeof monitorHistoryQuerySchema>;

// ─── 事件元数据 ───────────────────────────────────────────────────────────────
export const analyticsEventPropertyDefSchema = z.object({
  key: z.string().max(64),
  type: z.string().max(32),
  description: z.string().max(256).optional(),
});
export const createAnalyticsEventMetaSchema = z.object({
  eventName: z.string().min(1).max(128),
  displayName: z.string().max(128).nullable().optional(),
  category: z.string().max(64).nullable().optional(),
  description: z.string().max(1000).nullable().optional(),
  propertySchema: z.array(analyticsEventPropertyDefSchema).nullable().optional(),
  status: z.enum(['active', 'deprecated', 'blocked']).default('active'),
});
export const updateAnalyticsEventMetaSchema = createAnalyticsEventMetaSchema.partial();

// ─── 采集设置 ─────────────────────────────────────────────────────────────────
export const updateAnalyticsSettingsSchema = z.object({
  enabled: z.boolean().optional(),
  sampleRate: z.number().min(0).max(1).optional(),
  trackPageviews: z.boolean().optional(),
  trackClicks: z.boolean().optional(),
  trackPerformance: z.boolean().optional(),
  trackErrors: z.boolean().optional(),
  trackApi: z.boolean().optional(),
  maskInputs: z.boolean().optional(),
  respectDnt: z.boolean().optional(),
  anonymizeIp: z.boolean().optional(),
  blacklistPaths: z.array(z.string().max(256)).optional(),
  retentionDays: z.number().int().min(1).max(3650).optional(),
  errorRetentionDays: z.number().int().min(1).max(3650).optional(),
  sessionTimeoutMinutes: z.number().int().min(1).max(1440).optional(),
});

// ─── 漏斗 / 路径分析查询 ──────────────────────────────────────────────────────
export const funnelStepSchema = z.object({
  eventType: userBehaviorEventTypeEnum.optional(),
  eventName: z.string().max(128).optional(),
  pagePath: z.string().max(256).optional(),
  elementKey: z.string().max(128).optional(),
  label: z.string().max(64),
});
export const funnelQuerySchema = z.object({
  days: z.number().int().min(1).max(365).default(30),
  steps: z.array(funnelStepSchema).min(2).max(10),
});

export const sourceMapUploadSchema = z.object({
  release: z.string().min(1).max(64),
  fileName: z.string().min(1).max(256),
  content: z.string().min(1),
});

export type TrackEventInputZod = z.infer<typeof trackEventInputSchema>;
export type ErrorReportInput = z.infer<typeof errorReportSchema>;
export type UpdateErrorGroupInput = z.infer<typeof updateErrorGroupSchema>;
export type CreateErrorAlertRuleInput = z.infer<typeof createErrorAlertRuleSchema>;
export type UpdateErrorAlertRuleInput = z.infer<typeof updateErrorAlertRuleSchema>;
export type CreateAnalyticsEventMetaInput = z.infer<typeof createAnalyticsEventMetaSchema>;
export type UpdateAnalyticsEventMetaInput = z.infer<typeof updateAnalyticsEventMetaSchema>;
export type UpdateAnalyticsSettingsInput = z.infer<typeof updateAnalyticsSettingsSchema>;
export type FunnelQueryInput = z.infer<typeof funnelQuerySchema>;
export type SourceMapUploadInput = z.infer<typeof sourceMapUploadSchema>;

// ── 业务接入示例：请假 ──
export const bizLeaveTypeSchema = z.enum(['annual', 'sick', 'personal', 'marriage', 'other']);

export const createBizLeaveSchema = z.object({
  leaveType: bizLeaveTypeSchema,
  startDate: z.string().min(1, '请选择开始日期'),
  endDate: z.string().min(1, '请选择结束日期'),
  days: z.coerce.number().positive('请假天数必须大于 0'),
  reason: z.string().max(500).nullable().optional(),
});

export const updateBizLeaveSchema = createBizLeaveSchema.partial();

export type CreateBizLeaveInput = z.infer<typeof createBizLeaveSchema>;
export type UpdateBizLeaveInput = z.infer<typeof updateBizLeaveSchema>;

// ─── 业务接入示例：支付接入 ───────────────────────────────────────────────────
/** 新建示例单（金额单位：分） */
export const createBizPayDemoSchema = z.object({
  subject: z.string().min(1, '请输入示例事项名称').max(128),
  amount: z.coerce.number().int().positive('金额必须大于 0'), // 分
});

/** 发起支付（选择支付方式，微信 JSAPI 需 openId） */
export const payBizPayDemoSchema = z.object({
  payMethod: z.enum(['wechat_native', 'wechat_jsapi', 'wechat_h5', 'alipay_page', 'alipay_wap', 'alipay_app', 'unionpay_qr']),
  openId: z.string().max(128).optional(),
});

export type CreateBizPayDemoInput = z.infer<typeof createBizPayDemoSchema>;
export type PayBizPayDemoInput = z.infer<typeof payBizPayDemoSchema>;

export const generateSelfSignedCertSchema = z.object({
  name: z.string().min(1).max(128),
  domain: z.string().min(1).max(256),
  days: z.number().int().min(1).max(3650).default(365),
  country: z.string().length(2).default('CN').optional(),
  organization: z.string().max(64).default('Organization').optional(),
  outputDir: z.string().max(500).optional(),
});

export const uploadCertSchema = z.object({
  name: z.string().min(1).max(128),
  domain: z.string().min(1).max(256),
  certContent: z.string().min(1),
  keyContent: z.string().min(1),
});

export type GenerateSelfSignedCertSchemaInput = z.infer<typeof generateSelfSignedCertSchema>;
export type UploadCertSchemaInput = z.infer<typeof uploadCertSchema>;

// ─── 公众号管理 ────────────────────────────────────────────────────────────────
export const MP_ACCOUNT_TYPES = ['subscribe', 'service', 'test'] as const;
export const MP_ENCRYPT_MODES = ['plaintext', 'compatible', 'safe'] as const;

export const createMpAccountSchema = z.object({
  name: z.string().min(1, '公众号名称不能为空').max(100),
  account: z.string().max(100).optional(),
  appId: z.string().min(1, 'AppID 不能为空').max(64),
  appSecret: z.string().min(1, 'AppSecret 不能为空').max(128),
  token: z.string().min(1, 'Token 不能为空').max(64).regex(/^[A-Za-z0-9]+$/, 'Token 只能包含字母和数字'),
  encodingAesKey: z.string().max(64).optional(),
  encryptMode: z.enum(MP_ENCRYPT_MODES).default('plaintext'),
  type: z.enum(MP_ACCOUNT_TYPES).default('service'),
  qrCodeUrl: z.string().max(500).optional(),
  isDefault: z.boolean().default(false),
  autoCreateMember: z.boolean().default(false),
  contentCheckEnabled: z.boolean().default(false),
  status: z.enum(['enabled', 'disabled']).default('enabled'),
  remark: z.string().max(500).optional(),
});
export const updateMpAccountSchema = createMpAccountSchema.partial().extend({
  appSecret: z.string().max(128).optional(), // 更新时留空表示保持原值
});
export type CreateMpAccountInput = z.infer<typeof createMpAccountSchema>;
export type UpdateMpAccountInput = z.infer<typeof updateMpAccountSchema>;

// 公众号标签
export const createMpTagSchema = z.object({
  accountId: z.number().int().positive(),
  name: z.string().min(1, '标签名称不能为空').max(30),
});
export const updateMpTagSchema = z.object({
  name: z.string().min(1, '标签名称不能为空').max(30),
});
export type CreateMpTagInput = z.infer<typeof createMpTagSchema>;
export type UpdateMpTagInput = z.infer<typeof updateMpTagSchema>;

// 公众号粉丝（本地备注 / 标签）
export const updateMpFanSchema = z.object({
  remark: z.string().max(128).optional(),
  tagIds: z.array(z.number().int().positive()).optional(),
});
export type UpdateMpFanInput = z.infer<typeof updateMpFanSchema>;

// 公众号客服消息（发送文本）
// 公众号网页授权（OAuth2）
export const MP_OAUTH_SCOPES = ['snsapi_base', 'snsapi_userinfo'] as const;
export const buildMpOAuthUrlSchema = z.object({
  accountId: z.number().int().positive(),
  redirectUri: z.string().url('回调地址需为合法 URL').max(1024),
  scope: z.enum(MP_OAUTH_SCOPES).default('snsapi_base'),
  state: z.string().max(128).optional(),
});
export type BuildMpOAuthUrlInput = z.infer<typeof buildMpOAuthUrlSchema>;

// 公众号客服消息（支持文本 / 图片 / 语音 / 视频 / 图文）
export const MP_CUSTOM_MSG_TYPES = ['text', 'image', 'voice', 'video', 'news'] as const;
export const sendMpMessageSchema = z.object({
  accountId: z.number().int().positive(),
  openid: z.string().min(1, '请选择粉丝').max(64),
  msgType: z.enum(MP_CUSTOM_MSG_TYPES).default('text'),
  content: z.string().max(2000).optional(),
  mediaId: z.string().max(128).optional(),
})
  .refine((d) => d.msgType !== 'text' || !!d.content, { message: '消息内容不能为空', path: ['content'] })
  .refine((d) => d.msgType === 'text' || !!d.mediaId, { message: '请选择素材', path: ['mediaId'] });
export type SendMpMessageInput = z.infer<typeof sendMpMessageSchema>;

// 公众号自动回复
export const MP_AUTO_REPLY_TYPES = ['subscribe', 'keyword', 'default'] as const;
export const MP_REPLY_CONTENT_TYPES = ['text', 'image', 'voice', 'video', 'news'] as const;
const mpReplyArticleSchema = z.object({
  title: z.string().min(1, '标题不能为空').max(120),
  description: z.string().max(300).optional(),
  picUrl: z.string().max(1024).optional(),
  url: z.string().min(1, '图文链接不能为空').max(1024),
});
const mpAutoReplyBase = z.object({
  accountId: z.number().int().positive(),
  replyType: z.enum(MP_AUTO_REPLY_TYPES),
  keyword: z.string().max(64).optional(),
  matchType: z.enum(['exact', 'contain', 'regex']).default('contain'),
  contentType: z.enum(MP_REPLY_CONTENT_TYPES).default('text'),
  content: z.string().max(2000).optional(),
  mediaId: z.string().max(128).optional(),
  newsArticles: z.array(mpReplyArticleSchema).max(8).optional(),
  transferToKf: z.boolean().default(false),
  status: z.enum(['enabled', 'disabled']).default('enabled'),
  sort: z.number().int().default(0),
});
export const createMpAutoReplySchema = mpAutoReplyBase
  .refine((d) => d.replyType !== 'keyword' || !!d.keyword, { message: '关键词回复必须填写关键词', path: ['keyword'] })
  .refine((d) => d.contentType !== 'text' || !!d.content, { message: '请填写回复内容', path: ['content'] })
  .refine((d) => !(['image', 'voice', 'video'] as string[]).includes(d.contentType) || !!d.mediaId, { message: '请选择素材', path: ['mediaId'] })
  .refine((d) => d.contentType !== 'news' || (d.newsArticles?.length ?? 0) > 0, { message: '请至少添加一篇图文', path: ['newsArticles'] });
export const updateMpAutoReplySchema = mpAutoReplyBase.omit({ accountId: true, replyType: true }).partial();
export type CreateMpAutoReplyInput = z.infer<typeof createMpAutoReplySchema>;
export type UpdateMpAutoReplyInput = z.infer<typeof updateMpAutoReplySchema>;

// 公众号自定义菜单
// 递归 schema：server 侧会为其注册 OpenAPI refId（见 packages/server/src/lib/dtos/mp.ts）
export const mpMenuButtonSchema: z.ZodType<MpMenuButton> = z.lazy(() => z.object({
  name: z.string().min(1, '按钮名称不能为空').max(60),
  type: z.string().max(32).optional(),
  key: z.string().max(128).optional(),
  url: z.string().max(1024).optional(),
  appid: z.string().max(64).optional(),
  pagepath: z.string().max(256).optional(),
  media_id: z.string().max(128).optional(),
  article_id: z.string().max(128).optional(),
  sub_button: z.array(mpMenuButtonSchema).max(5).optional(),
}));
export const saveMpMenuSchema = z.object({
  accountId: z.number().int().positive(),
  buttons: z.array(mpMenuButtonSchema).max(3, '一级菜单最多 3 个'),
});
export type SaveMpMenuInput = z.infer<typeof saveMpMenuSchema>;

// 个性化菜单（按匹配规则下发）
const mpMenuMatchRuleSchema = z.object({
  tagId: z.string().max(16).optional(),
  sex: z.string().max(4).optional(),
  country: z.string().max(64).optional(),
  province: z.string().max(64).optional(),
  city: z.string().max(64).optional(),
  clientPlatformType: z.string().max(4).optional(),
  language: z.string().max(16).optional(),
});
export const createMpConditionalMenuSchema = z.object({
  accountId: z.number().int().positive(),
  name: z.string().min(1, '名称不能为空').max(64),
  buttons: z.array(mpMenuButtonSchema).min(1, '至少一个一级菜单').max(3, '一级菜单最多 3 个'),
  matchRule: mpMenuMatchRuleSchema.refine((r) => Object.values(r).some((v) => v && v.length > 0), { message: '至少设置一个匹配条件' }),
});
export const updateMpConditionalMenuSchema = z.object({
  name: z.string().min(1).max(64).optional(),
  buttons: z.array(mpMenuButtonSchema).min(1).max(3).optional(),
  matchRule: mpMenuMatchRuleSchema.optional(),
});
export const tryMatchMpMenuSchema = z.object({
  accountId: z.number().int().positive(),
  userId: z.string().min(1, '请输入 openid 或微信号').max(128),
});
export type CreateMpConditionalMenuInput = z.infer<typeof createMpConditionalMenuSchema>;
export type UpdateMpConditionalMenuInput = z.infer<typeof updateMpConditionalMenuSchema>;
export type TryMatchMpMenuInput = z.infer<typeof tryMatchMpMenuSchema>;

// 粉丝黑名单 + 内容安全校验
export const blacklistMpFansSchema = z.object({
  accountId: z.number().int().positive(),
  openids: z.array(z.string().min(1)).min(1, '请选择粉丝').max(20, '每次最多 20 个'),
});
export const checkMpContentSchema = z.object({
  accountId: z.number().int().positive(),
  content: z.string().min(1, '内容不能为空').max(2500),
});
export type BlacklistMpFansInput = z.infer<typeof blacklistMpFansSchema>;
export type CheckMpContentInput = z.infer<typeof checkMpContentSchema>;

// 公众号素材
export const MP_MATERIAL_TYPES = ['image', 'voice', 'video', 'thumb'] as const;
export const createMpMaterialSchema = z.object({
  accountId: z.number().int().positive(),
  type: z.enum(MP_MATERIAL_TYPES).default('image'),
  name: z.string().min(1, '素材名称不能为空').max(200),
  url: z.string().max(1000).optional(),
  fileSize: z.number().int().nonnegative().optional(),
});
export const updateMpMaterialSchema = z.object({
  name: z.string().min(1, '素材名称不能为空').max(200),
});
export type CreateMpMaterialInput = z.infer<typeof createMpMaterialSchema>;
export type UpdateMpMaterialInput = z.infer<typeof updateMpMaterialSchema>;

// 公众号图文草稿
export const mpArticleSchema: z.ZodType<MpArticle> = z.object({
  title: z.string().min(1, '标题不能为空').max(120),
  author: z.string().max(60).optional(),
  digest: z.string().max(200).optional(),
  content: z.string().min(1, '正文不能为空'),
  thumbUrl: z.string().max(1000).optional(),
  thumbMediaId: z.string().max(128).optional(),
  contentSourceUrl: z.string().max(1000).optional(),
  showCoverPic: z.boolean().optional(),
});
export const createMpDraftSchema = z.object({
  accountId: z.number().int().positive(),
  articles: z.array(mpArticleSchema).min(1, '至少需要一篇图文'),
});
export const updateMpDraftSchema = z.object({
  articles: z.array(mpArticleSchema).min(1, '至少需要一篇图文'),
});
export type CreateMpDraftInput = z.infer<typeof createMpDraftSchema>;
export type UpdateMpDraftInput = z.infer<typeof updateMpDraftSchema>;

// 公众号模板消息发送
export const sendMpTemplateSchema = z.object({
  accountId: z.number().int().positive(),
  templateId: z.string().min(1, '请选择模板').max(128),
  openid: z.string().min(1, '请选择粉丝').max(64),
  url: z.string().max(1000).optional(),
  data: z.record(z.string(), z.object({ value: z.string(), color: z.string().optional() })),
});
export type SendMpTemplateInput = z.infer<typeof sendMpTemplateSchema>;

// 公众号群发消息
export const MP_BROADCAST_TYPES = ['text', 'image', 'mpnews'] as const;
export const MP_BROADCAST_TARGETS = ['all', 'tag'] as const;
const mpBroadcastBase = z.object({
  accountId: z.number().int().positive(),
  msgType: z.enum(MP_BROADCAST_TYPES).default('text'),
  target: z.enum(MP_BROADCAST_TARGETS).default('all'),
  tagId: z.number().int().positive().optional(),
  content: z.string().max(2000).optional(),
  mediaId: z.string().max(128).optional(),
  scheduledAt: z.string().max(32).nullish(),
});
export const createMpBroadcastSchema = mpBroadcastBase
  .refine((d) => d.msgType !== 'text' || !!d.content, { message: '请填写群发文本内容', path: ['content'] })
  .refine((d) => d.msgType === 'text' || !!d.mediaId, { message: '请选择图片素材或图文草稿', path: ['mediaId'] })
  .refine((d) => d.target !== 'tag' || !!d.tagId, { message: '按标签群发时请选择标签', path: ['tagId'] });
export const updateMpBroadcastSchema = mpBroadcastBase.omit({ accountId: true }).partial()
  .refine((d) => d.target !== 'tag' || d.tagId == null || d.tagId > 0, { message: '标签不合法', path: ['tagId'] });
export type CreateMpBroadcastInput = z.infer<typeof createMpBroadcastSchema>;
export type UpdateMpBroadcastInput = z.infer<typeof updateMpBroadcastSchema>;
export const previewMpBroadcastSchema = z.object({ openid: z.string().min(1, '请输入预览 openid').max(64) });
export type PreviewMpBroadcastInput = z.infer<typeof previewMpBroadcastSchema>;

// 模板消息：行业设置 + 批量发送
export const setMpTemplateIndustrySchema = z.object({
  accountId: z.number().int().positive(),
  industryId1: z.string().min(1, '请选择主营行业').max(8),
  industryId2: z.string().min(1, '请选择副营行业').max(8),
});
export const batchSendMpTemplateSchema = z.object({
  accountId: z.number().int().positive(),
  templateId: z.string().min(1, '请选择模板').max(128),
  openids: z.array(z.string().min(1)).min(1, '请选择粉丝').max(500, '单次最多 500 个'),
  url: z.string().max(1000).optional(),
  data: z.record(z.string(), z.object({ value: z.string(), color: z.string().optional() })),
});
export type SetMpTemplateIndustryInput = z.infer<typeof setMpTemplateIndustrySchema>;
export type BatchSendMpTemplateInput = z.infer<typeof batchSendMpTemplateSchema>;

// JS-SDK 配置签名
export const getMpJsConfigSchema = z.object({
  accountId: z.number().int().positive(),
  url: z.string().min(1, '请输入页面 URL').max(1000),
});
export type GetMpJsConfigInput = z.infer<typeof getMpJsConfigSchema>;

// 公众号带参数二维码
export const MP_QRCODE_TYPES = ['temporary', 'permanent'] as const;
export const createMpQrcodeSchema = z.object({
  accountId: z.number().int().positive(),
  type: z.enum(MP_QRCODE_TYPES).default('permanent'),
  sceneStr: z.string().min(1, '场景值不能为空').max(64).regex(/^[A-Za-z0-9_-]+$/, '场景值仅支持字母、数字、下划线、连字符'),
  name: z.string().min(1, '名称不能为空').max(100),
  /** 临时二维码有效期（秒），最长 30 天 */
  expireSeconds: z.number().int().min(60).max(2592000).optional(),
  /** 扫码关注奖励积分（粉丝已绑定会员时入账），0=不奖励 */
  rewardPoints: z.number().int().min(0).max(100000).default(0),
}).refine((d) => d.type !== 'temporary' || !!d.expireSeconds, { message: '临时二维码请设置有效期', path: ['expireSeconds'] });
export type CreateMpQrcodeInput = z.infer<typeof createMpQrcodeSchema>;

// 公众号多客服账号
export const createMpKfAccountSchema = z.object({
  accountId: z.number().int().positive(),
  kfAccount: z.string().min(1, '客服账号不能为空').max(64),
  nickname: z.string().min(1, '客服昵称不能为空').max(64),
});
export const updateMpKfAccountSchema = z.object({
  nickname: z.string().min(1, '客服昵称不能为空').max(64),
});
export type CreateMpKfAccountInput = z.infer<typeof createMpKfAccountSchema>;
export type UpdateMpKfAccountInput = z.infer<typeof updateMpKfAccountSchema>;

// 多客服会话治理（接入/转接/超时自动路由/会话分配）
export const acceptMpKfSessionSchema = z.object({
  kfId: z.number().int().positive(),
});
export const transferMpKfSessionSchema = z.object({
  toKfId: z.number().int().positive(),
  remark: z.string().max(255).optional(),
});
export const closeMpKfSessionSchema = z.object({
  remark: z.string().max(255).optional(),
});
export const rateMpKfSessionSchema = z.object({
  rating: z.number().int().min(1).max(5),
  remark: z.string().max(255).optional(),
});
export const replyMpKfSessionSchema = z.object({
  msgType: z.enum(['text', 'image', 'voice', 'video', 'news']).default('text'),
  content: z.string().max(2000).optional(),
  mediaId: z.string().max(128).optional(),
}).refine((v) => v.msgType !== 'text' || (v.content && v.content.trim().length > 0), {
  message: '文本消息内容不能为空', path: ['content'],
}).refine((v) => v.msgType === 'text' || !!v.mediaId, {
  message: '该消息类型需提供 mediaId', path: ['mediaId'],
});
export const updateMpKfRoutingConfigSchema = z.object({
  enabled: z.boolean().optional(),
  strategy: z.enum(['manual', 'round_robin', 'least_active']).optional(),
  maxConcurrent: z.number().int().min(1).max(100).optional(),
  waitTimeoutMinutes: z.number().int().min(1).max(1440).optional(),
  idleTimeoutMinutes: z.number().int().min(1).max(1440).optional(),
  autoCloseEnabled: z.boolean().optional(),
  welcomeText: z.string().max(500).nullable().optional(),
});
export type AcceptMpKfSessionInput = z.infer<typeof acceptMpKfSessionSchema>;
export type TransferMpKfSessionInput = z.infer<typeof transferMpKfSessionSchema>;
export type CloseMpKfSessionInput = z.infer<typeof closeMpKfSessionSchema>;
export type RateMpKfSessionInput = z.infer<typeof rateMpKfSessionSchema>;
export type ReplyMpKfSessionInput = z.infer<typeof replyMpKfSessionSchema>;
export type UpdateMpKfRoutingConfigInput = z.infer<typeof updateMpKfRoutingConfigSchema>;

// ════════════════════════════════════════════════════════════════════════════
// 报表中心（Report Center）
// ════════════════════════════════════════════════════════════════════════════
export const reportDatasourceTypeSchema = z.enum(REPORT_DATASOURCE_TYPES);
export const reportFieldTypeSchema = z.enum(['string', 'number', 'date', 'boolean']);
export const reportWidgetTypeSchema = z.enum(REPORT_WIDGET_TYPES);

/** 字段显示格式化（语义层 lite） */
export const reportFieldFormatSchema = z.object({
  kind: z.enum(['number', 'percent', 'currency', 'date', 'datetime', 'dict']),
  decimals: z.number().int().min(0).max(10).optional(),
  thousands: z.boolean().optional(),
  currencySymbol: z.string().max(8).optional(),
  prefix: z.string().max(16).optional(),
  suffix: z.string().max(16).optional(),
  dictCode: z.string().max(64).optional(),
});

/** 数据集字段（列）定义 */
export const reportFieldSchema = z.object({
  name: z.string().min(1, '列名不能为空').max(128),
  label: z.string().min(1, '显示名不能为空').max(128),
  type: reportFieldTypeSchema.default('string'),
  format: reportFieldFormatSchema.optional(),
});

/** 计算字段（衍生列）*/
export const reportComputedFieldSchema = z.object({
  name: z.string().min(1, '列名不能为空').max(128),
  label: z.string().min(1).max(128),
  expression: z.string().min(1, '表达式不能为空').max(512),
  type: reportFieldTypeSchema.optional(),
});

/** 数据集参数定义 */
export const reportDatasetParamSchema = z.object({
  name: z.string().min(1).max(64),
  label: z.string().min(1).max(64),
  type: reportFieldTypeSchema.default('string'),
  required: z.boolean().optional(),
  defaultValue: z.union([z.string(), z.number(), z.boolean(), z.null()]).optional(),
});

// ─── 数据源 ──────────────────────────────────────────────────────────────────
// config 形态随 type 而定（api→{url,method,headers}；sql→{connection:'internal'}），
// 这里用宽松对象，具体形态由 service 按 type 校验。
export const createReportDatasourceSchema = z.object({
  name: z.string().min(1, '名称不能为空').max(64),
  type: reportDatasourceTypeSchema,
  config: z.record(z.string(), z.unknown()).default({}),
  status: z.enum(['enabled', 'disabled']).default('enabled'),
  remark: z.string().max(256).optional(),
});
export const updateReportDatasourceSchema = createReportDatasourceSchema.partial();
export type CreateReportDatasourceInput = z.input<typeof createReportDatasourceSchema>;
export type UpdateReportDatasourceInput = z.input<typeof updateReportDatasourceSchema>;

/** 测试数据源连接（外部库）：可带 id（复用已存凭据）或完整 config */
export const reportDatasourceTestSchema = z.object({
  id: z.number().int().positive().optional(),
  type: reportDatasourceTypeSchema.optional(),
  config: z.record(z.string(), z.unknown()).optional(),
});
export type ReportDatasourceTestInput = z.input<typeof reportDatasourceTestSchema>;

// ─── 数据集 ──────────────────────────────────────────────────────────────────
// type 由 datasource 继承，不接受用户传入；content 形态由 service 按 type 校验。
export const reportDatasetMaterializeSchema = z.object({
  enabled: z.boolean().default(false),
  cron: z.string().max(64).optional(),
});
/** 行级权限规则：where 片段禁止分号（防拼接后多语句） */
export const reportRowRuleSchema = z.object({
  roles: z.array(z.string().max(64)).max(32).optional(),
  where: z.string().min(1, 'WHERE 片段不能为空').max(512).refine((s) => !s.includes(';'), 'WHERE 片段不能包含分号'),
  enabled: z.boolean().optional(),
  remark: z.string().max(128).optional(),
});
export const createReportDatasetSchema = z.object({
  name: z.string().min(1, '名称不能为空').max(64),
  datasourceId: z.number().int().positive('请选择数据源'),
  content: z.record(z.string(), z.unknown()).default({}),
  fields: z.array(reportFieldSchema).default([]),
  params: z.array(reportDatasetParamSchema).default([]),
  computedFields: z.array(reportComputedFieldSchema).default([]),
  cacheTtl: z.number().int().min(0).max(86_400).default(0),
  materialize: reportDatasetMaterializeSchema.optional(),
  rowRules: z.array(reportRowRuleSchema).max(32).default([]),
  status: z.enum(['enabled', 'disabled']).default('enabled'),
  remark: z.string().max(256).optional(),
});
export const updateReportDatasetSchema = createReportDatasetSchema.partial();
export type CreateReportDatasetInput = z.input<typeof createReportDatasetSchema>;
export type UpdateReportDatasetInput = z.input<typeof updateReportDatasetSchema>;

/** 试跑预览（不落库）：用未保存的数据源+content 直接取数 */
export const reportDatasetPreviewSchema = z.object({
  datasourceId: z.number().int().positive('请选择数据源'),
  content: z.record(z.string(), z.unknown()).default({}),
  params: z.record(z.string(), z.unknown()).optional(),
  computedFields: z.array(reportComputedFieldSchema).optional(),
  limit: z.number().int().min(1).max(1000).default(100),
});
export type ReportDatasetPreviewInput = z.input<typeof reportDatasetPreviewSchema>;

// ─── 仪表盘 ──────────────────────────────────────────────────────────────────
export const reportGridItemSchema = z.object({
  i: z.string().min(1),
  x: z.number().int().min(0),
  y: z.number().int().min(0),
  w: z.number().int().min(1),
  h: z.number().int().min(1),
  minW: z.number().int().min(1).optional(),
  minH: z.number().int().min(1).optional(),
});
export const reportCanvasItemSchema = z.object({
  i: z.string().min(1),
  x: z.number().int(),
  y: z.number().int(),
  w: z.number().int().min(1),
  h: z.number().int().min(1),
  z: z.number().int().optional(),
});
export const reportWidgetSchema = z.object({
  i: z.string().min(1),
  type: reportWidgetTypeSchema,
  title: z.string().max(128).default(''),
  datasetId: z.number().int().positive().nullable().optional(),
  options: z.record(z.string(), z.unknown()).default({}),
  paramBindings: z.array(z.object({ filterId: z.string(), param: z.string() })).optional(),
  interaction: z.object({ enabled: z.boolean().optional(), setFilterId: z.string().optional() }).optional(),
  drilldown: z.object({
    enabled: z.boolean().optional(),
    type: z.enum(['fields', 'dashboard', 'url']).optional(),
    fields: z.array(z.string()).optional(),
    targetDashboardId: z.number().int().positive().nullable().optional(),
    url: z.string().optional(),
    paramName: z.string().optional(),
  }).optional(),
  style: z.object({ background: z.string().optional(), showHeader: z.boolean().optional(), borderless: z.boolean().optional() }).optional(),
  page: z.number().int().min(1).max(50).optional(),
});
export const reportFilterTypeSchema = z.enum(['date', 'daterange', 'select', 'multiSelect', 'input', 'numberRange']);
export const reportFilterSchema = z.object({
  id: z.string().min(1),
  label: z.string().max(64),
  type: reportFilterTypeSchema,
  defaultValue: z.unknown().optional(),
  optionSource: z.object({
    kind: z.enum(['static', 'dataset']),
    options: z.array(z.object({ value: z.string(), label: z.string() })).optional(),
    datasetId: z.number().int().positive().nullable().optional(),
    valueField: z.string().optional(),
    labelField: z.string().optional(),
  }).optional(),
  width: z.number().int().min(1).max(24).optional(),
});
export const reportScreenConfigSchema = z.object({
  width: z.number().int().min(320).max(10000),
  height: z.number().int().min(240).max(10000),
  background: z.string().optional(),
  backgroundImage: z.string().optional(),
  scaleMode: z.enum(['fit', 'width', 'full']).optional(),
});
export const reportDashboardConfigSchema = z.object({
  theme: z.enum(['light', 'dark']).optional(),
  layoutMode: z.enum(['grid', 'canvas']).optional(),
  screen: z.boolean().optional(),
  screenConfig: reportScreenConfigSchema.optional(),
  refreshInterval: z.number().int().min(0).optional(),
  carousel: z.object({
    enabled: z.boolean().optional(),
    pageCount: z.number().int().min(1).max(50).optional(),
    intervalSec: z.number().int().min(0).max(3600).optional(),
    showDots: z.boolean().optional(),
  }).optional(),
});
export const createReportDashboardSchema = z.object({
  name: z.string().min(1, '名称不能为空').max(64),
  layout: z.array(reportGridItemSchema).default([]),
  canvasLayout: z.array(reportCanvasItemSchema).default([]),
  widgets: z.array(reportWidgetSchema).default([]),
  filters: z.array(reportFilterSchema).default([]),
  config: reportDashboardConfigSchema.default({}),
  categoryId: z.number().int().positive().nullable().optional(),
  status: z.enum(['enabled', 'disabled']).default('enabled'),
  remark: z.string().max(256).optional(),
});
export const updateReportDashboardSchema = createReportDashboardSchema.partial();
export type CreateReportDashboardInput = z.input<typeof createReportDashboardSchema>;
export type UpdateReportDashboardInput = z.input<typeof updateReportDashboardSchema>;

// ─── 取数（带参数）──────────────────────────────────────────────────────────
export const reportDatasetDataBodySchema = z.object({
  params: z.record(z.string(), z.unknown()).optional(),
  limit: z.number().int().min(1).max(5000).optional(),
});
export type ReportDatasetDataInput = z.input<typeof reportDatasetDataBodySchema>;

// ─── 仪表盘分类 ──────────────────────────────────────────────────────────────
export const createReportCategorySchema = z.object({
  name: z.string().min(1, '名称不能为空').max(64),
  sort: z.number().int().default(0),
  remark: z.string().max(256).optional(),
});
export const updateReportCategorySchema = createReportCategorySchema.partial();
export type CreateReportCategoryInput = z.input<typeof createReportCategorySchema>;
export type UpdateReportCategoryInput = z.input<typeof updateReportCategorySchema>;

// ─── 版本 ──────────────────────────────────────────────────────────────────
export const createReportVersionSchema = z.object({ remark: z.string().max(256).optional() });
export type CreateReportVersionInput = z.input<typeof createReportVersionSchema>;

// ─── 公开分享 ────────────────────────────────────────────────────────────────
export const createReportShareSchema = z.object({
  /** 过期时间：不传=默认 30 天；null=永久有效 */
  expireAt: z.string().nullable().optional(),
  password: z.string().min(8, '访问密码至少 8 位').max(64).optional(),
  enabled: z.boolean().default(true),
});
export const updateReportShareSchema = z.object({
  expireAt: z.string().nullable().optional(),
  password: z.string().min(8, '访问密码至少 8 位').max(64).nullable().optional(),
  enabled: z.boolean().optional(),
});
export type CreateReportShareInput = z.input<typeof createReportShareSchema>;
export type UpdateReportShareInput = z.input<typeof updateReportShareSchema>;
export const reportPublicAccessSchema = z.object({
  password: z.string().optional(),
  params: z.record(z.string(), z.unknown()).optional(),
});
export type ReportPublicAccessInput = z.input<typeof reportPublicAccessSchema>;

// ─── 订阅推送 ────────────────────────────────────────────────────────────────
export const reportNotifyChannelSchema = z.enum(['email', 'inApp', 'webhook']);
export const createReportSubscriptionSchema = z.object({
  dashboardId: z.number().int().positive(),
  cron: z.string().min(1, '请填写 Cron 表达式').max(64),
  channels: z.array(reportNotifyChannelSchema).min(1, '至少选择一个推送通道'),
  recipients: z.string().max(512).optional(),
  webhookUrl: z.url('Webhook 地址必须是合法 URL').max(512).nullable().optional(),
  enabled: z.boolean().default(true),
  remark: z.string().max(256).optional(),
});
export const updateReportSubscriptionSchema = createReportSubscriptionSchema.partial().extend({
  webhookUrl: z.union([z.url('Webhook 地址必须是合法 URL').max(512), z.literal('******')]).nullable().optional(),
});
export type CreateReportSubscriptionInput = z.input<typeof createReportSubscriptionSchema>;
export type UpdateReportSubscriptionInput = z.input<typeof updateReportSubscriptionSchema>;

// ─── 类 Excel 打印报表 ────────────────────────────────────────────────────────
export const reportPrintCellStyleSchema = z.object({
  bold: z.boolean().optional(),
  italic: z.boolean().optional(),
  fontSize: z.number().optional(),
  color: z.string().optional(),
  background: z.string().optional(),
  align: z.enum(['left', 'center', 'right']).optional(),
  valign: z.enum(['top', 'middle', 'bottom']).optional(),
  border: z.boolean().optional(),
  wrap: z.boolean().optional(),
});
export const reportPrintCellSchema = z.object({
  row: z.number().int().min(0),
  col: z.number().int().min(0),
  v: z.union([z.string(), z.number(), z.boolean(), z.null()]).optional(),
  s: reportPrintCellStyleSchema.optional(),
});
export const reportPrintMergeSchema = z.object({
  row: z.number().int().min(0), col: z.number().int().min(0),
  rowSpan: z.number().int().min(1), colSpan: z.number().int().min(1),
});
export const reportPrintGridSchema = z.object({
  rows: z.number().int().min(0).max(5000),
  cols: z.number().int().min(0).max(300),
  colWidths: z.array(z.number()).optional(),
  rowHeights: z.array(z.number()).optional(),
  cells: z.array(reportPrintCellSchema).default([]),
  merges: z.array(reportPrintMergeSchema).optional(),
});
export const reportPrintContentSchema = z.object({
  workbook: z.unknown().optional(),
  grid: reportPrintGridSchema.optional(),
});
export const reportPrintPageConfigSchema = z.object({
  paper: z.enum(['A4', 'A3', 'A5', 'Letter']).optional(),
  orientation: z.enum(['portrait', 'landscape']).optional(),
  margin: z.object({ top: z.number(), right: z.number(), bottom: z.number(), left: z.number() }).optional(),
  header: z.string().max(512).optional(),
  footer: z.string().max(512).optional(),
  backgroundImage: z.string().optional(),
});
export const createReportPrintTemplateSchema = z.object({
  name: z.string().min(1, '名称不能为空').max(64),
  datasetId: z.number().int().positive().nullable().optional(),
  content: reportPrintContentSchema.default({}),
  params: z.array(reportDatasetParamSchema).default([]),
  pageConfig: reportPrintPageConfigSchema.default({}),
  status: z.enum(['enabled', 'disabled']).default('enabled'),
  remark: z.string().max(256).optional(),
});
export const updateReportPrintTemplateSchema = createReportPrintTemplateSchema.partial();
export type CreateReportPrintTemplateInput = z.input<typeof createReportPrintTemplateSchema>;
export type UpdateReportPrintTemplateInput = z.input<typeof updateReportPrintTemplateSchema>;
/** 渲染（取数填充）入参 */
export const reportPrintRenderSchema = z.object({
  params: z.record(z.string(), z.unknown()).optional(),
  limit: z.number().int().min(1).max(5000).optional(),
});
export type ReportPrintRenderInput = z.input<typeof reportPrintRenderSchema>;

// ─── AI 自然语言取数（NL2SQL）────────────────────────────────────────────────
export const reportNl2SqlSchema = z.object({
  question: z.string().min(1, '请描述你想查询的数据').max(1000),
  datasetId: z.number().int().positive().optional(),
});
export type ReportNl2SqlInput = z.input<typeof reportNl2SqlSchema>;

// ─── 数据预警 ────────────────────────────────────────────────────────────────
export const createReportAlertSchema = z.object({
  name: z.string().min(1, '名称不能为空').max(64),
  datasetId: z.number().int().positive('请选择数据集'),
  field: z.string().max(128).nullable().optional(),
  /** 分组维度（可空=全局聚合；有值=按组聚合，任一组命中即触发） */
  groupByField: z.string().max(128).nullable().optional(),
  aggregate: z.enum(['sum', 'avg', 'max', 'min', 'count', 'first']).default('sum'),
  op: z.enum(['gt', 'gte', 'lt', 'lte', 'eq', 'neq']).default('gt'),
  threshold: z.number(),
  cron: z.string().max(64).nullable().optional(),
  channels: z.array(reportNotifyChannelSchema).min(1, '至少选择一个通知通道'),
  recipients: z.string().max(512).optional(),
  webhookUrl: z.url('Webhook 地址必须是合法 URL').max(512).nullable().optional(),
  /** 静默期（分钟）：持续触发时距上次通知不足该时长不重复通知；0=每次触发都通知（上限 7 天） */
  silenceMins: z.number().int().min(0).max(10080).default(60),
  /** 从触发恢复正常时是否发送恢复通知 */
  notifyOnRecover: z.boolean().default(false),
  enabled: z.boolean().default(true),
  remark: z.string().max(256).optional(),
});
export const updateReportAlertSchema = createReportAlertSchema.partial().extend({
  webhookUrl: z.union([z.url('Webhook 地址必须是合法 URL').max(512), z.literal('******')]).nullable().optional(),
});
export type CreateReportAlertInput = z.input<typeof createReportAlertSchema>;
export type UpdateReportAlertInput = z.input<typeof updateReportAlertSchema>;

// ─── 仪表盘评论 ──────────────────────────────────────────────────────────────
export const createReportCommentSchema = z.object({
  widgetId: z.string().max(64).nullable().optional(),
  content: z.string().min(1, '评论内容不能为空').max(1000),
});
export type CreateReportCommentInput = z.input<typeof createReportCommentSchema>;

// ─── 开放平台：API Scope ──────────────────────────────────────────────────────
export const createApiScopeSchema = z.object({
  code: z
    .string()
    .min(1, 'scope 编码不能为空')
    .max(64)
    .regex(/^[a-z][a-z0-9_.:-]*$/, 'scope 编码须以小写字母开头，仅含小写字母/数字/:._-'),
  name: z.string().min(1, '名称不能为空').max(100),
  description: z.string().max(500).optional(),
  scopeGroup: z.string().min(1).max(64).default('general'),
  status: z.enum(['enabled', 'disabled']).default('enabled'),
});
export const updateApiScopeSchema = createApiScopeSchema.partial().omit({ code: true });
export type CreateApiScopeInput = z.input<typeof createApiScopeSchema>;
export type UpdateApiScopeInput = z.input<typeof updateApiScopeSchema>;

// ─── 开放平台：限流套餐 ───────────────────────────────────────────────────────
export const createRatePlanSchema = z.object({
  code: z
    .string()
    .min(1, '套餐编码不能为空')
    .max(64)
    .regex(/^[a-z][a-z0-9_-]*$/, '套餐编码须以小写字母开头，仅含小写字母/数字/_-'),
  name: z.string().min(1, '名称不能为空').max(100),
  description: z.string().max(500).optional(),
  qpsLimit: z.number().int().min(0).max(1_000_000).default(10),
  dailyQuota: z.number().int().min(0).default(0),
  monthlyQuota: z.number().int().min(0).default(0),
  isDefault: z.boolean().default(false),
  status: z.enum(['enabled', 'disabled']).default('enabled'),
});
export const updateRatePlanSchema = createRatePlanSchema.partial().omit({ code: true });
export type CreateRatePlanInput = z.input<typeof createRatePlanSchema>;
export type UpdateRatePlanInput = z.input<typeof updateRatePlanSchema>;

// ─── 开放平台：签名验签工具 ───────────────────────────────────────────────────
export const openSignatureVerifySchema = z.object({
  appKey: z.string().min(1, 'AppKey 不能为空'),
  method: z.string().min(1).default('GET'),
  path: z.string().min(1, '请求路径不能为空'),
  query: z.string().optional(),
  body: z.string().optional(),
  timestamp: z.string().min(1, '时间戳不能为空'),
  nonce: z.string().min(1, '随机串不能为空'),
  /** 待校验的签名（可选；提供时返回 matched） */
  signature: z.string().optional(),
});
export type OpenSignatureVerifyInput = z.input<typeof openSignatureVerifySchema>;

// ─── 开放平台：Webhook 订阅 ───────────────────────────────────────────────────
export const createAppWebhookSchema = z.object({
  clientId: z.string().min(1, '请选择所属应用'),
  name: z.string().min(1, '名称不能为空').max(100),
  url: z.string().regex(/^https?:\/\/.+/, 'URL 必须以 http(s):// 开头').max(512),
  events: z.array(z.string()).default([]),
  signMode: z.enum(['hmacSha256', 'none']).default('hmacSha256'),
  headers: z.record(z.string(), z.string()).optional(),
  status: z.enum(['enabled', 'disabled']).default('enabled'),
});
export const updateAppWebhookSchema = createAppWebhookSchema.partial().omit({ clientId: true });
export type CreateAppWebhookInput = z.input<typeof createAppWebhookSchema>;
export type UpdateAppWebhookInput = z.input<typeof updateAppWebhookSchema>;

// ─── 规则中心：决策表 ────────────────────────────────────────────────────────────
const ruleFieldTypeSchema = z.enum(['string', 'number', 'boolean']);
const ruleHitPolicySchema = z.enum(['first', 'unique', 'priority', 'collect', 'any']);
const ruleLiteralSchema = z.union([z.string(), z.number(), z.boolean(), z.null()]);

export const ruleDecisionInputSchema = z.object({
  key: z.string().min(1).max(64),
  label: z.string().min(1).max(64),
  expr: z.string().min(1).max(500),
  type: ruleFieldTypeSchema,
});
export const ruleDecisionOutputSchema = z.object({
  key: z.string().min(1).max(64),
  label: z.string().min(1).max(64),
  type: ruleFieldTypeSchema,
  default: ruleLiteralSchema.optional(),
});
export const ruleDecisionRowSchema = z.object({
  id: z.string().min(1).max(64),
  when: z.array(z.string()).default([]),
  then: z.record(z.string(), ruleLiteralSchema).default({}),
  priority: z.number().int().optional(),
  label: z.string().max(64).optional(),
});

export const createDecisionTableSchema = z.object({
  key: z.string().min(1).max(64).regex(/^[a-zA-Z][a-zA-Z0-9_-]*$/, 'key 仅限字母开头的字母数字下划线'),
  name: z.string().min(1).max(64),
  description: z.string().max(500).nullable().optional(),
  categoryId: z.number().int().nullable().optional(),
  hitPolicy: ruleHitPolicySchema.default('first'),
  inputs: z.array(ruleDecisionInputSchema).default([]),
  outputs: z.array(ruleDecisionOutputSchema).default([]),
  rules: z.array(ruleDecisionRowSchema).default([]),
});
export const updateDecisionTableSchema = createDecisionTableSchema.partial().omit({ key: true });
export const evaluateDecisionTableSchema = z.object({
  input: z.record(z.string(), z.unknown()).default({}),
});
export type CreateDecisionTableInput = z.input<typeof createDecisionTableSchema>;
export type UpdateDecisionTableInput = z.input<typeof updateDecisionTableSchema>;

export const createRuleTestCaseSchema = z.object({
  name: z.string().min(1).max(64),
  input: z.record(z.string(), z.unknown()).default({}),
  expected: z.record(z.string(), z.unknown()).default({}),
});
export const updateRuleTestCaseSchema = createRuleTestCaseSchema.partial();
export type CreateRuleTestCaseInput = z.input<typeof createRuleTestCaseSchema>;

// ─── 意见反馈 Schema ─────────────────────────────────────────────────────────
export const createUserFeedbackSchema = z.object({
  score: z.number().int().min(1, '评分最低 1 分').max(5, '评分最高 5 分').nullable().optional(),
  category: z.enum(['suggestion', 'bug', 'ux', 'other']).default('suggestion'),
  content: z.string().max(1000, '反馈内容不能超过 1000 字').nullable().optional(),
  pagePath: z.string().max(200).nullable().optional(),
}).refine((v) => v.score != null || (v.content != null && v.content.trim() !== ''), {
  message: '评分与反馈内容至少填写一项',
  path: ['content'],
});

export const handleUserFeedbackSchema = z.object({
  status: z.enum(['pending', 'processing', 'resolved', 'ignored']),
  handleRemark: z.string().max(500, '处理备注不能超过 500 字').nullable().optional(),
});

export type CreateUserFeedbackInput = z.input<typeof createUserFeedbackSchema>;
export type HandleUserFeedbackInput = z.input<typeof handleUserFeedbackSchema>;
