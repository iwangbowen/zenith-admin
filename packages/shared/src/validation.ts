import { z } from 'zod';

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
  fileIds: z.array(z.number().int()).optional().default([]),
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
  fileIds: z.array(z.number().int()).optional(),
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
  remark: z.string().max(500).optional(),
});

export const updateTenantSchema = createTenantSchema.partial();

export const switchTenantSchema = z.object({
  tenantId: z.number().int().positive().nullable(),
});

export type CreateTenantInput = z.infer<typeof createTenantSchema>;
export type UpdateTenantInput = z.infer<typeof updateTenantSchema>;
export type SwitchTenantInput = z.infer<typeof switchTenantSchema>;
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
  'approve', 'reject', 'transfer', 'addSign', 'return', 'comment', 'signature', 'opinionRequired',
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
  uploadRequired: z.boolean().optional(),
});
export const workflowTimeoutConfigSchema = z.object({
  enabled: z.boolean(),
  duration: z.number().int().min(1),
  unit: z.enum(['minutes', 'hours', 'days']).optional(),
  action: z.enum(['remind', 'autoApprove', 'autoReject']),
  remindCount: z.number().int().min(1).optional(),
  escalateAction: z.enum(['none', 'autoApprove', 'autoReject', 'transferToManager']).optional(),
  escalateManagerLevel: z.number().int().min(1).optional(),
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
  operator: z.enum(['eq', 'neq', 'in', 'contains']),
  value: z.unknown(),
});

export const workflowFormFieldSchema: z.ZodType<unknown> = z.lazy(() =>
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
      'row', 'divider', 'group',
    ]),
    required: z.boolean().optional(),
    placeholder: z.string().optional(),
    helpText: z.string().optional(),
    options: z.array(z.string()).optional(),
    defaultValue: z.unknown().optional(),
    visibilityCondition: workflowFieldVisibilityConditionSchema.optional(),
    visibilityRules: z.object({
      logic: z.enum(['and', 'or']),
      rules: z.array(workflowFieldVisibilityConditionSchema),
    }).optional(),
    children: z.array(workflowFormFieldSchema).optional(),
    precision: z.number().int().min(0).max(6).optional(),
    step: z.number().optional(),
    unit: z.string().optional(),
    currency: z.string().optional(),
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
    daysFromKey: z.string().optional(),
    optionsFrom: z.object({
      sourceKey: z.string().min(1),
      mapping: z.record(z.string(), z.array(z.string())),
    }).optional(),
    columns: z.array(z.object({
      span: z.number().min(1).max(24),
      fields: z.array(workflowFormFieldSchema),
    })).optional(),
    title: z.string().optional(),
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

export type CreateWorkflowFormInput = z.infer<typeof createWorkflowFormSchema>;
export type UpdateWorkflowFormInput = z.infer<typeof updateWorkflowFormSchema>;

export const createWorkflowDefinitionSchema = z.object({
  name: z.string().min(1, '流程名称不能为空').max(64),
  description: z.string().max(500).nullable().optional(),
  flowData: z.record(z.string(), z.unknown()).nullable().optional(),
  formId: z.number().int().positive().nullable().optional(),
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

export const workflowAutomationActionSchema = z.discriminatedUnion('type', [
  workflowAutomationActionStartWorkflowSchema,
  workflowAutomationActionSendMessageSchema,
]);

export const createWorkflowAutomationSchema = z.object({
  definitionId: z.number().int().positive('请选择流程'),
  name: z.string().min(1, '规则名称不能为空').max(128),
  trigger: z.enum(['approved', 'rejected', 'withdrawn']),
  actions: z.array(workflowAutomationActionSchema).min(1, '至少配置 1 个动作').max(10),
  status: z.enum(['enabled', 'disabled']).default('enabled'),
  sort: z.number().int().nonnegative().default(0),
});

export const updateWorkflowAutomationSchema = createWorkflowAutomationSchema.partial();

export type WorkflowAutomationActionInput = z.infer<typeof workflowAutomationActionSchema>;
export type CreateWorkflowAutomationInput = z.infer<typeof createWorkflowAutomationSchema>;
export type UpdateWorkflowAutomationInput = z.infer<typeof updateWorkflowAutomationSchema>;


export const createWorkflowInstanceSchema = z.object({
  definitionId: z.number().int().positive('请选择流程'),
  title: z.string().min(1, '申请标题不能为空').max(128),
  formData: z.record(z.string(), z.unknown()).nullable().optional(),
});

export const approveWorkflowTaskSchema = z.object({
  comment: z.string().max(500).optional(),
  /** 手写签名（data URL，节点要求签名时必填） */
  signature: z.string().max(2_000_000).optional(),
  attachments: z.array(z.object({
    name: z.string().max(255),
    url: z.string().max(1024),
    size: z.number().int().nonnegative().optional(),
  })).optional(),
  /** 当下一节点为 approverSelect 类型时，由当前审批人指定的下一节点审批人 ID 列表 */
  selectedNextApprovers: z.array(z.number().int().positive()).optional(),
});

export const rejectWorkflowTaskSchema = z.object({
  comment: z.string().min(1, '驳回原因不能为空').max(500),
});

export const transferWorkflowTaskSchema = z.object({
  targetUserId: z.number().int().positive('请选择转办人'),
  comment: z.string().max(500).optional(),
});

export const delegateWorkflowTaskSchema = z.object({
  targetUserId: z.number().int().positive('请选择委派人'),
  comment: z.string().max(500).optional(),
});

export const addSignWorkflowTaskSchema = z.object({
  targetUserIds: z.array(z.number().int().positive()).min(1, '请选择加签人'),
  position: z.enum(['before', 'after', 'parallel']).default('parallel'),
  comment: z.string().max(500).optional(),
});

export const reduceSignWorkflowTaskSchema = z.object({
  targetTaskIds: z.array(z.number().int().positive()).min(1, '请选择要减签的任务'),
  comment: z.string().max(500).optional(),
});

export const returnWorkflowTaskSchema = z.object({
  targetNodeKeys: z.array(z.string().min(1)).min(1, '请选择退回节点').max(20),
  comment: z.string().min(1, '退回原因不能为空').max(500),
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

export const updateWorkflowInstanceSchema = z.object({
  title: z.string().min(1, '申请标题不能为空').max(128).optional(),
  formData: z.record(z.string(), z.unknown()).nullable().optional(),
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

// ── 流程评论 ──
export const createWorkflowCommentSchema = z.object({
  content: z.string().min(1, '评论内容不能为空').max(2000),
  taskId: z.number().int().positive().nullable().optional(),
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
});

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
export type UpdateWorkflowInstanceInput = z.infer<typeof updateWorkflowInstanceSchema>;
export type BatchApproveWorkflowTaskInput = z.infer<typeof batchApproveWorkflowTaskSchema>;
export type BatchRejectWorkflowTaskInput = z.infer<typeof batchRejectWorkflowTaskSchema>;
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
  kind: z.enum(['image', 'file', 'voice']),
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
  type: z.enum(['text', 'image', 'file', 'system', 'forward', 'vote', 'voice', 'card']),
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
  type: z.enum(['text', 'image', 'file', 'forward', 'vote', 'voice']).default('text'),
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
  channel: z.enum(['wechat', 'alipay']),
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
  payMethod: z.enum(['wechat_native', 'wechat_jsapi', 'wechat_h5', 'alipay_page', 'alipay_wap', 'alipay_app']),
  channelConfigId: z.number().int().positive().optional(),
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
