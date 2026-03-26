import { z } from 'zod';

export const loginSchema = z.object({
  username: z.string().min(3, '用户名至少3个字符').max(32),
  password: z.string().min(6, '密码至少6个字符').max(64),
  captchaId: z.string().optional(),
  captchaCode: z.string().optional(),
});

export const registerSchema = z.object({
  username: z.string().min(3, '用户名至少3个字符').max(32),
  nickname: z.string().min(1, '昵称不能为空').max(32),
  email: z.string().email('邮箱格式不正确'),
  password: z.string().min(6, '密码至少6个字符').max(64),
});

export const createUserSchema = z.object({
  username: z.string().min(3).max(32),
  nickname: z.string().min(1).max(32),
  email: z.string().email(),
  password: z.string().min(6).max(64),
  departmentId: z.number().int().positive().nullable().optional(),
  positionIds: z.array(z.number().int().positive()).default([]),
  roleIds: z.array(z.number().int()).default([]),
  status: z.enum(['active', 'disabled']).default('active'),
});

export const updateUserSchema = createUserSchema.partial().omit({ password: true });

export const changePasswordSchema = z.object({
  oldPassword: z.string().min(6, '原密码至少6个字符').max(64),
  newPassword: z.string().min(6, '新密码至少6个字符').max(64),
});

export const resetUserPasswordSchema = z.object({
  password: z.string().min(6, '新密码至少6个字符').max(64),
});

export const updateProfileSchema = z.object({
  nickname: z.string().min(1, '昵称不能为空').max(32).optional(),
  email: z.string().email('邮箱格式不正确').optional(),
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
  status: z.enum(['active', 'disabled']).default('active'),
  visible: z.boolean().default(true),
});

export const updateMenuSchema = createMenuSchema.partial();

// ─── 角色 Schema ──────────────────────────────────────────────────────────────
export const createRoleSchema = z.object({
  name: z.string().min(1, '角色名称不能为空').max(64),
  code: z.string().min(1, '角色编码不能为空').max(64).regex(/^[a-z_]+$/, '角色编码只能包含小写字母和下划线'),
  description: z.string().max(256).optional(),
  status: z.enum(['active', 'disabled']).default('active'),
  dataScope: z.enum(['all', 'dept', 'self']).default('all'),
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
  leader: z.string().max(32).optional(),
  phone: z.string().max(32).optional(),
  email: z.preprocess(
    (value) => (value === '' ? undefined : value),
    z.string().email('邮箱格式不正确').optional()
  ),
  sort: z.number().int().default(0),
  status: z.enum(['active', 'disabled']).default('active'),
});

export const updateDepartmentSchema = createDepartmentSchema.partial();

// ─── 岗位 Schema ──────────────────────────────────────────────────────────────
export const createPositionSchema = z.object({
  name: z.string().min(1, '岗位名称不能为空').max(64),
  code: z.string().min(1, '岗位编码不能为空').max(64).regex(/^\w+$/, '岗位编码只能包含字母、数字和下划线'),
  sort: z.number().int().default(0),
  status: z.enum(['active', 'disabled']).default('active'),
  remark: z.string().max(256).optional(),
});

export const updatePositionSchema = createPositionSchema.partial();

// ─── 字典 Schema ──────────────────────────────────────────────────────────────
export const createDictSchema = z.object({
  name: z.string().min(1, '字典名称不能为空').max(64),
  code: z.string().min(1, '字典编码不能为空').max(64).regex(/^[a-z_]+$/, '字典编码只能包含小写字母和下划线'),
  description: z.string().max(256).optional(),
  status: z.enum(['active', 'disabled']).default('active'),
});

export const updateDictSchema = createDictSchema.partial();

export const createDictItemSchema = z.object({
  label: z.string().min(1, '标签不能为空').max(64),
  value: z.string().min(1, '键值不能为空').max(64),
  color: z.string().max(32).optional(),
  sort: z.number().int().default(0),
  status: z.enum(['active', 'disabled']).default('active'),
  remark: z.string().max(256).optional(),
});

export const updateDictItemSchema = createDictItemSchema.partial();

// ─── 文件管理 Schema ─────────────────────────────────────────────────────────
export const createFileStorageConfigSchema = z.object({
  name: z.string().min(1, '配置名称不能为空').max(64),
  provider: z.enum(['local', 'oss']),
  status: z.enum(['active', 'disabled']).default('active'),
  isDefault: z.boolean().default(false),
  basePath: z.string().max(256).optional(),
  localRootPath: z.string().max(512).optional(),
  ossRegion: z.string().max(64).optional(),
  ossEndpoint: z.string().max(128).optional(),
  ossBucket: z.string().max(128).optional(),
  ossAccessKeyId: z.string().max(128).optional(),
  ossAccessKeySecret: z.string().max(256).optional(),
  remark: z.string().max(256).optional(),
}).superRefine((data, ctx) => {
  if (data.provider === 'local' && !data.localRootPath) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: '本地磁盘配置需要填写存储目录', path: ['localRootPath'] });
  }
  if (data.provider === 'oss') {
    const requiredFields: Array<keyof typeof data> = [
      'ossRegion',
      'ossEndpoint',
      'ossBucket',
      'ossAccessKeyId',
      'ossAccessKeySecret',
    ];
    for (const field of requiredFields) {
      if (!data[field]) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'OSS 配置项不能为空', path: [field] });
      }
    }
  }
});

export const updateFileStorageConfigSchema = createFileStorageConfigSchema;

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
export type CreateDictInput = z.infer<typeof createDictSchema>;
export type UpdateDictInput = z.infer<typeof updateDictSchema>;
export type CreateDictItemInput = z.infer<typeof createDictItemSchema>;
export type UpdateDictItemInput = z.infer<typeof updateDictItemSchema>;
export type CreateFileStorageConfigInput = z.infer<typeof createFileStorageConfigSchema>;
export type UpdateFileStorageConfigInput = z.infer<typeof updateFileStorageConfigSchema>;

// ─── 通知公告 Schema ─────────────────────────────────────────────────────────
export const createNoticeSchema = z.object({
  title: z.string().min(1, '标题不能为空').max(128),
  content: z.string().min(1, '内容不能为空').max(4096),
  type: z.string().min(1).max(32).default('notice'),
  publishStatus: z.enum(['draft', 'published', 'recalled']).default('draft'),
  priority: z.string().min(1).max(32).default('medium'),
  publishTime: z.string().datetime({ offset: true }).optional().nullable(),
});

export const updateNoticeSchema = createNoticeSchema.partial();

export type CreateNoticeInput = z.infer<typeof createNoticeSchema>;
export type UpdateNoticeInput = z.infer<typeof updateNoticeSchema>;

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
  status: z.enum(['active', 'disabled']).default('disabled'),
  description: z.string().max(256).default(''),
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
  status:     z.enum(['active', 'disabled']).default('active'),
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
  status: z.enum(['active', 'disabled']).default('active'),
});

export type EmailConfigInput = z.infer<typeof emailConfigSchema>;
