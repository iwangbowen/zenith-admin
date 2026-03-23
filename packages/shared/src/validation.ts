import { z } from 'zod';

export const loginSchema = z.object({
  username: z.string().min(3, '用户名至少3个字符').max(32),
  password: z.string().min(6, '密码至少6个字符').max(64),
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
  role: z.enum(['admin', 'user']).default('user'),
  status: z.enum(['active', 'disabled']).default('active'),
});

export const updateUserSchema = createUserSchema.partial().omit({ password: true });

export const changePasswordSchema = z.object({
  oldPassword: z.string().min(6, '原密码至少6个字符').max(64),
  newPassword: z.string().min(6, '新密码至少6个字符').max(64),
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
});

export const updateRoleSchema = createRoleSchema.partial();

export const assignRoleMenusSchema = z.object({
  menuIds: z.array(z.number().int()),
});

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
export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;
export type CreateMenuInput = z.infer<typeof createMenuSchema>;
export type UpdateMenuInput = z.infer<typeof updateMenuSchema>;
export type CreateRoleInput = z.infer<typeof createRoleSchema>;
export type UpdateRoleInput = z.infer<typeof updateRoleSchema>;
export type AssignRoleMenusInput = z.infer<typeof assignRoleMenusSchema>;
export type CreateDictInput = z.infer<typeof createDictSchema>;
export type UpdateDictInput = z.infer<typeof updateDictSchema>;
export type CreateDictItemInput = z.infer<typeof createDictItemSchema>;
export type UpdateDictItemInput = z.infer<typeof updateDictItemSchema>;
export type CreateFileStorageConfigInput = z.infer<typeof createFileStorageConfigSchema>;
export type UpdateFileStorageConfigInput = z.infer<typeof updateFileStorageConfigSchema>;
