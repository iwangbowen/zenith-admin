/**
 * formatPasswordPolicyHint 单元测试
 *
 * 覆盖要点：
 *  1. policy = null   → 兜底提示 '至少 6 位'
 *  2. 仅 minLength    → '至少 N 位'
 *  3. requireUppercase = true  → 包含 '包含大写字母'
 *  4. requireSpecialChar = true → 包含 '包含特殊字符'
 *  5. 全部规则开启    → 完整拼接（顿号分隔）
 */
import { describe, it, expect } from 'vitest';
import { formatPasswordPolicyHint, type PasswordPolicy } from './password-policy';

describe('formatPasswordPolicyHint', () => {
  it('policy 为 null 时返回默认提示', () => {
    expect(formatPasswordPolicyHint(null)).toBe('至少 6 位');
  });

  it('仅设置 minLength 时只显示长度要求', () => {
    const policy: PasswordPolicy = { minLength: 8, requireUppercase: false, requireSpecialChar: false };
    expect(formatPasswordPolicyHint(policy)).toBe('至少 8 位');
  });

  it('minLength = 1 时正确显示', () => {
    const policy: PasswordPolicy = { minLength: 1, requireUppercase: false, requireSpecialChar: false };
    expect(formatPasswordPolicyHint(policy)).toBe('至少 1 位');
  });

  it('requireUppercase = true 时包含大写字母提示', () => {
    const policy: PasswordPolicy = { minLength: 6, requireUppercase: true, requireSpecialChar: false };
    const hint = formatPasswordPolicyHint(policy);
    expect(hint).toContain('至少 6 位');
    expect(hint).toContain('包含大写字母');
  });

  it('requireSpecialChar = true 时包含特殊字符提示', () => {
    const policy: PasswordPolicy = { minLength: 6, requireUppercase: false, requireSpecialChar: true };
    const hint = formatPasswordPolicyHint(policy);
    expect(hint).toContain('至少 6 位');
    expect(hint).toContain('包含特殊字符');
  });

  it('全部规则开启时用顿号拼接所有提示', () => {
    const policy: PasswordPolicy = { minLength: 12, requireUppercase: true, requireSpecialChar: true };
    const hint = formatPasswordPolicyHint(policy);
    expect(hint).toBe('至少 12 位、包含大写字母、包含特殊字符');
  });

  it('仅大写+特殊字符（无额外 minLength 强调）正确拼接', () => {
    const policy: PasswordPolicy = { minLength: 6, requireUppercase: true, requireSpecialChar: true };
    const hint = formatPasswordPolicyHint(policy);
    expect(hint).toBe('至少 6 位、包含大写字母、包含特殊字符');
  });
});
