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

export type LoginInput = z.infer<typeof loginSchema>;
export type RegisterInput = z.infer<typeof registerSchema>;
export type CreateUserInput = z.infer<typeof createUserSchema>;
export type UpdateUserInput = z.infer<typeof updateUserSchema>;
