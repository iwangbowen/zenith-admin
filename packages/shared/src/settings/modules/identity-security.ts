import * as z from 'zod';
import { LOGIN_RISK_NEW_DEVICE_ACTIONS, MFA_MODES } from '../../identity/constants';
import { defineSettingsModule } from '../module-def';

/** 身份安全策略：密码规则、登录锁定、MFA、登录风险 */
export const identitySecuritySettingsSchema = z.object({
  password: z.object({
    minLength: z.int().min(6).max(64).default(6).meta({ title: '密码最小长度' }),
    requireUppercase: z.boolean().default(false).meta({ title: '必须包含大写字母' }),
    requireSpecialChar: z.boolean().default(false).meta({ title: '必须包含特殊字符' }),
    expiryEnabled: z.boolean().default(false).meta({ title: '密码过期强制重置' }),
    expiryDays: z.int().min(1).max(3650).default(90).meta({ title: '密码过期天数' }),
  }).prefault({}).meta({ title: '密码策略' }),
  lockout: z.object({
    maxAttempts: z.int().min(1).max(100).default(10).meta({ title: '登录失败最大次数', description: '超出后锁定账号' }),
    durationMinutes: z.int().min(1).max(1440).default(30).meta({ title: '锁定时长（分钟）' }),
  }).prefault({}).meta({ title: '登录锁定' }),
  mfa: z.object({
    enabled: z.boolean().default(false).meta({ title: '启用 MFA' }),
    mode: z.enum(MFA_MODES).default('off').meta({ title: 'MFA 模式', description: 'off 关闭 / optional 用户自选 / required 强制' }),
    rememberDeviceDays: z.int().min(1).max(365).default(30).meta({ title: '可信设备免 MFA 天数' }),
  }).prefault({}).meta({ title: '多因素认证' }),
  risk: z.object({
    enabled: z.boolean().default(false).meta({ title: '启用登录风险策略' }),
    newDeviceAction: z.enum(LOGIN_RISK_NEW_DEVICE_ACTIONS).default('allow').meta({ title: '新设备登录动作', description: 'allow 放行 / challenge 要求 MFA' }),
  }).prefault({}).meta({ title: '登录风险' }),
}).meta({ id: 'Settings.IdentitySecurity' });

export type IdentitySecuritySettings = z.output<typeof identitySecuritySettingsSchema>;
export type PasswordPolicy = IdentitySecuritySettings['password'];
/** 校验明文密码只需要的三条规则（过期策略与之无关），供只持有部分字段的调用方复用 */
export type PasswordRules = Pick<PasswordPolicy, 'minLength' | 'requireUppercase' | 'requireSpecialChar'>;

export const identitySecuritySettingsModule = defineSettingsModule({
  schema: identitySecuritySettingsSchema,
  title: '身份安全',
  description: '密码策略、登录锁定、多因素认证与登录风险',
  scope: 'tenant',
  readPermission: 'system:identity-security:manage',
  writePermission: 'system:identity-security:manage',
  // 密码规则在注册 / 找回密码页匿名可见
  visibility: { password: 'public' },
  page: '/system/identity-security',
  sort: 20,
});

/**
 * 按密码策略校验明文密码；返回错误文案，合规返回 `null`。
 * 前后端共用（用户新增 / 重置 / 注册 / 导入 / 租户初始管理员），禁止各自重写。
 */
export function validatePassword(password: string, policy: PasswordRules): string | null {
  if (password.length < policy.minLength) {
    return `密码长度不能少于 ${policy.minLength} 位`;
  }
  if (policy.requireUppercase && !/[A-Z]/.test(password)) {
    return '密码必须包含至少一个大写字母';
  }
  if (policy.requireSpecialChar && !/[!@#$%^&*()_+\-=[\]{};':"\\|,.<>/?]/.test(password)) {
    return '密码必须包含至少一个特殊字符';
  }
  return null;
}

/** 密码规则的一句话提示（表单 placeholder / extra） */
export function formatPasswordPolicyHint(policy: PasswordRules | null | undefined): string {
  if (!policy) return '至少 6 位';
  const parts: string[] = [`至少 ${policy.minLength} 位`];
  if (policy.requireUppercase) parts.push('包含大写字母');
  if (policy.requireSpecialChar) parts.push('包含特殊字符');
  return parts.join('、');
}
