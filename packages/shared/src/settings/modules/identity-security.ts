import * as z from 'zod';
import { LOGIN_RISK_NEW_DEVICE_ACTIONS, MFA_MODES, SESSION_CONCURRENCY_SCOPES, SESSION_EXCEED_ACTIONS } from '../../identity/constants';
import { defineSettingsModule } from '../module-def';

/** 身份安全策略：密码规则、登录失败防护、会话并发、MFA、登录风险 */
export const identitySecuritySettingsSchema = z.object({
  password: z.object({
    minLength: z.int().min(6).max(64).default(6).meta({ title: '密码最小长度' }),
    requireUppercase: z.boolean().default(false).meta({ title: '必须包含大写字母' }),
    requireSpecialChar: z.boolean().default(false).meta({ title: '必须包含特殊字符' }),
    expiryEnabled: z.boolean().default(false).meta({ title: '密码过期强制重置' }),
    expiryDays: z.int().min(1).max(3650).default(90).meta({ title: '密码过期天数' }),
  }).prefault({}).meta({ title: '密码策略' }),
  loginChallenge: z.object({
    maxAttemptsPerSource: z.int().min(1).max(1000).default(30).meta({
      title: '单来源失败次数阈值',
      description: '同一账号同一 IP 在窗口内的失败次数，达到后该来源登录需先通过验证码',
    }),
    sourceLimit: z.int().min(1).max(100).default(5).meta({
      title: '多来源失败阈值',
      description: '窗口内失败来源 IP 数达到后，该账号所有来源登录都需通过验证码（应对分布式猜解）',
    }),
    windowMinutes: z.int().min(1).max(1440).default(30).meta({
      title: '计数窗口（分钟）',
      description: '失败计数与验证码要求的持续时长',
    }),
    alert: z.object({
      enabled: z.boolean().default(true).meta({
        title: '登录失败突增告警',
        description: '同一账号在窗口内出现多个失败来源或失败量异常时通知安全管理员，攻击进行中即可看到',
      }),
      sourceThreshold: z.int().min(2).max(100).default(3).meta({
        title: '多来源告警阈值',
        description: '窗口内失败来源 IP 数达到后告警一次（疑似分布式猜解）',
      }),
      failureThreshold: z.int().min(5).max(100000).default(60).meta({
        title: '失败总量告警阈值',
        description: '窗口内同一账号的失败总次数达到后告警一次（疑似口令爆破）',
      }),
    }).prefault({}).meta({ title: '突增告警' }),
  }).prefault({}).meta({ title: '登录失败防护' }),
  session: z.object({
    maxSessions: z.int().min(0).max(20).default(0).meta({ title: '同时在线上限', description: '0 不限制；1 = 同一账号只能在一处登录；模拟登录会话不计入' }),
    scope: z.enum(SESSION_CONCURRENCY_SCOPES).default('global').meta({ title: '统计范围', description: 'global 全部终端合计 / per-client 网页、移动审批、桌面端各算一份' }),
    exceedAction: z.enum(SESSION_EXCEED_ACTIONS).default('kick-oldest').meta({ title: '超限处理', description: 'kick-oldest 新登录挤掉最早的会话 / reject-new 拒绝新登录，登录页可选择下线其它设备' }),
  }).prefault({}).meta({ title: '会话并发' }),
  mfa: z.object({
    enabled: z.boolean().default(false).meta({ title: '启用 MFA' }),
    mode: z.enum(MFA_MODES).default('off').meta({ title: 'MFA 模式', description: 'off 关闭 / optional 用户自选 / required 强制' }),
    rememberDeviceDays: z.int().min(1).max(365).default(30).meta({ title: '可信设备免 MFA 天数' }),
  }).prefault({}).meta({ title: '多因素认证' }),
  risk: z.object({
    enabled: z.boolean().default(false).meta({ title: '启用登录风险策略' }),
    newDeviceAction: z.enum(LOGIN_RISK_NEW_DEVICE_ACTIONS).default('allow').meta({ title: '新设备登录动作', description: 'allow 放行 / challenge 要求 MFA' }),
  }).prefault({}).meta({ title: '登录风险' }),
  impersonation: z.object({
    enabled: z.boolean().default(true).meta({ title: '允许模拟登录', description: '关闭后持有权限的管理员也无法以用户身份登录' }),
    maxMinutes: z.int().min(1).max(120).default(30).meta({ title: '单次模拟时长上限（分钟）', description: '模拟会话到期自动失效，不可续期；上限 120 分钟' }),
    allowWrite: z.boolean().default(false).meta({ title: '允许可操作模式', description: '关闭时模拟会话只能只读；开启后发起时可选择可操作' }),
    notifyTarget: z.boolean().default(true).meta({ title: '通知被模拟用户', description: '开始模拟时向目标用户发送站内通知' }),
  }).prefault({}).meta({ title: '模拟登录' }),
}).meta({ id: 'Settings.IdentitySecurity' });

export type IdentitySecuritySettings = z.output<typeof identitySecuritySettingsSchema>;
export type PasswordPolicy = IdentitySecuritySettings['password'];
export type SessionConcurrencyPolicy = IdentitySecuritySettings['session'];
/** 校验明文密码只需要的三条规则（过期策略与之无关），供只持有部分字段的调用方复用 */
export type PasswordRules = Pick<PasswordPolicy, 'minLength' | 'requireUppercase' | 'requireSpecialChar'>;

export const identitySecuritySettingsModule = defineSettingsModule({
  schema: identitySecuritySettingsSchema,
  title: '身份安全',
  description: '密码策略、登录失败防护、多因素认证与登录风险',
  scope: 'tenant',
  readPermission: 'system:identity-security:manage',
  writePermission: 'system:identity-security:manage',
  // 密码规则在注册 / 找回密码页匿名可见；模拟登录参数供发起弹窗（登录用户）读取上限与模式开关；
  // 会话并发策略供「我的设备」向用户说明为何会被挤下线
  visibility: { password: 'public', impersonation: 'authenticated', session: 'authenticated' },
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

/**
 * 会话并发策略的一句话说明：身份安全页保存前预览、「我的设备」向用户解释为何会被挤下线 / 新设备登不上。
 * 前后端文案同源，禁止各自重写。
 */
export function formatSessionPolicyHint(policy: SessionConcurrencyPolicy): string {
  if (policy.maxSessions <= 0) return '不限制同一账号的同时在线数量。';
  const where = policy.scope === 'per-client' ? '每种终端（网页 / 移动审批 / 桌面端）各' : '';
  const limit = policy.maxSessions === 1 ? '只能在一处登录' : `最多同时在 ${policy.maxSessions} 处登录`;
  const action = policy.exceedAction === 'kick-oldest'
    ? '新登录会挤掉最早登录的会话，被挤设备会收到提示'
    : '超出后新登录会被拒绝，可在登录页选择下线其它设备后再登录';
  return `同一账号${where}${limit}；${action}。模拟登录会话不计入。`;
}
