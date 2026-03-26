export interface PasswordPolicy {
  minLength: number;
  requireUppercase: boolean;
  requireSpecialChar: boolean;
}

export function formatPasswordPolicyHint(policy: PasswordPolicy | null): string {
  if (!policy) return '至少 6 位';
  const parts: string[] = [`至少 ${policy.minLength} 位`];
  if (policy.requireUppercase) parts.push('包含大写字母');
  if (policy.requireSpecialChar) parts.push('包含特殊字符');
  return parts.join('、');
}
