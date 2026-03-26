import { db } from '../db';
import { systemConfigs } from '../db/schema';
import { inArray } from 'drizzle-orm';

export interface PasswordPolicy {
  minLength: number;
  requireUppercase: boolean;
  requireSpecialChar: boolean;
}

const POLICY_KEYS = ['password_min_length', 'password_require_uppercase', 'password_require_special_char'] as const;

export async function getPasswordPolicy(): Promise<PasswordPolicy> {
  const configs = await db.select().from(systemConfigs).where(inArray(systemConfigs.configKey, [...POLICY_KEYS]));
  const map = Object.fromEntries(configs.map((c) => [c.configKey, c.configValue]));
  const rawMinLength = map['password_min_length'];
  const parsedMinLength = rawMinLength !== undefined ? Number(rawMinLength) : NaN;
  const safeMinLength = Number.isFinite(parsedMinLength) && parsedMinLength >= 1 ? parsedMinLength : 8;
  return {
    minLength: safeMinLength,
    requireUppercase: map['password_require_uppercase'] === 'true',
    requireSpecialChar: map['password_require_special_char'] === 'true',
  };
}

export function validatePassword(password: string, policy: PasswordPolicy): string | null {
  if (password.length < policy.minLength) {
    return `密码长度不能少于 ${policy.minLength} 位`;
  }
  if (policy.requireUppercase && !/[A-Z]/.test(password)) {
    return '密码必须包含至少一个大写字母';
  }
  if (policy.requireSpecialChar && !/[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>/?]/.test(password)) {
    return '密码必须包含至少一个特殊字符';
  }
  return null;
}
