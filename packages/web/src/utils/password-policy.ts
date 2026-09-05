/**
 * 密码规则文案与类型：唯一实现在 `@zenith/shared/settings`（与服务端校验同源），这里只做别名转发，
 * 保持 `@/utils/password-policy` 引用路径稳定。
 */
export { formatPasswordPolicyHint, validatePassword } from '@zenith/shared/settings';
export type { PasswordRules as PasswordPolicy } from '@zenith/shared/settings';