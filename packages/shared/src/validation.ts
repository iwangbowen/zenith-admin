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
  dataScope: z.enum(['all', 'dept', 'self']).default('all'),
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
  color: z.string().max(32).optional(),
  sort: z.number().int().default(0),
  status: z.enum(['enabled', 'disabled']).default('enabled'),
  remark: z.string().max(256).optional(),
});

export const updateDictItemSchema = createDictItemSchema.partial();

// ─── 文件管理 Schema ─────────────────────────────────────────────────────────
const baseFileStorageConfigSchema = z.object({
  name: z.string().min(1, '配置名称不能为空').max(64),
  provider: z.enum(['local', 'oss', 's3', 'cos']),
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
  publishStatus: z.enum(['draft', 'published', 'recalled']).default('draft'),
  priority: z.string().min(1).max(32).default('medium'),
  targetType: z.enum(['all', 'specific']).default('all'),
  recipients: z.array(announcementRecipientSchema).optional().default([]),
  publishTime: dateTimeStringSchema.optional().nullable(),
});

export const updateAnnouncementSchema = createAnnouncementSchema.partial();

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
  retryInterval: z.number().int().min(0, '重试间隔不能为负').default(0),
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
export const workflowConditionOperatorSchema = z.enum(['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'in', 'contains']);

export const workflowEdgeConditionSchema = z.object({
  field: z.string().min(1),
  operator: workflowConditionOperatorSchema,
  value: z.union([z.string(), z.number(), z.boolean()]),
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
      'text', 'textarea', 'number', 'date', 'dateRange',
      'select', 'multiSelect', 'amount',
      'phone', 'email', 'idCard', 'url', 'rate', 'formula',
      'attachment', 'image',
      'contact', 'department', 'detail', 'description', 'serialNumber',
      'row', 'divider', 'group',
    ]),
    required: z.boolean().optional(),
    placeholder: z.string().optional(),
    helpText: z.string().optional(),
    options: z.array(z.string()).optional(),
    defaultValue: z.unknown().optional(),
    visibilityCondition: workflowFieldVisibilityConditionSchema.optional(),
    children: z.array(workflowFormFieldSchema).optional(),
    precision: z.number().int().min(0).max(6).optional(),
    step: z.number().optional(),
    unit: z.string().optional(),
    currency: z.string().optional(),
    dateFormat: z.string().optional(),
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

export const createWorkflowDefinitionSchema = z.object({
  name: z.string().min(1, '流程名称不能为空').max(64),
  description: z.string().max(500).nullable().optional(),
  flowData: z.record(z.string(), z.unknown()).nullable().optional(),
  formFields: z.array(workflowFormFieldSchema).nullable().optional(),
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
  kind: z.enum(['image', 'file']),
  name: z.string().min(1).max(512),
  size: z.number().int().nonnegative(),
  mimeType: z.string().max(255).nullable(),
  extension: z.string().max(50).nullable(),
  width: z.number().int().positive().nullable().optional(),
  height: z.number().int().positive().nullable().optional(),
  thumbnailUrl: z.string().max(2048).nullable().optional(),
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
  type: z.enum(['text', 'image', 'file', 'system', 'forward', 'vote']),
  content: z.string().max(4096),
  createdAt: z.string(),
  asset: chatAssetMetaSchema.nullable().optional(),
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
}).strict();

export const sendChatMessageSchema = z.object({
  content: z.string().min(1, '消息不能为空').max(4096),
  type: z.enum(['text', 'image', 'file', 'forward', 'vote']).default('text'),
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

// ─── AI 对话模块 ──────────────────────────────────────────────────────────────

export const aiProviderEnum = z.enum(['openai_compatible', 'anthropic', 'gemini', 'baidu']);

export const createAiProviderConfigSchema = z.object({
  name: z.string().min(1, '名称不能为空').max(100),
  provider: aiProviderEnum.default('openai_compatible'),
  baseUrl: z.string().url('请输入有效的 URL').max(500),
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

export const createAiConversationSchema = z.object({
  title: z.string().max(200).optional(),
});

export const sendAiMessageSchema = z.object({
  message: z.string().min(1, '消息不能为空').max(8192),
});

export type SendAiMessageInput = z.infer<typeof sendAiMessageSchema>;

export const saveUserAiConfigSchema = z.object({
  provider: aiProviderEnum.optional(),
  baseUrl: z.string().url('请输入有效的 URL').max(500).nullable().optional(),
  apiKey: z.string().max(1000).nullable().optional(),
  model: z.string().max(100).nullable().optional(),
  isEnabled: z.boolean().optional(),
});

export type SaveUserAiConfigInput = z.infer<typeof saveUserAiConfigSchema>;
