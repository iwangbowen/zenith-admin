import { describe, it, expect } from 'vitest';
import { validatePassword, type PasswordPolicy } from '../lib/password-policy';

describe('validatePassword', () => {
  const defaultPolicy: PasswordPolicy = {
    minLength: 6,
    requireUppercase: false,
    requireSpecialChar: false,
  };

  it('should pass with valid password', () => {
    expect(validatePassword('abcdef', defaultPolicy)).toBeNull();
  });

  it('should fail when password is too short', () => {
    expect(validatePassword('abc', defaultPolicy)).toMatch(/不能少于 6 位/);
  });

  it('should fail when uppercase is required but missing', () => {
    const policy: PasswordPolicy = { ...defaultPolicy, requireUppercase: true };
    expect(validatePassword('abcdef', policy)).toMatch(/大写字母/);
  });

  it('should pass when uppercase is required and present', () => {
    const policy: PasswordPolicy = { ...defaultPolicy, requireUppercase: true };
    expect(validatePassword('Abcdef', policy)).toBeNull();
  });

  it('should fail when special char is required but missing', () => {
    const policy: PasswordPolicy = { ...defaultPolicy, requireSpecialChar: true };
    expect(validatePassword('Abcdef', policy)).toMatch(/特殊字符/);
  });

  it('should pass when special char is required and present', () => {
    const policy: PasswordPolicy = { ...defaultPolicy, requireSpecialChar: true };
    expect(validatePassword('Abc@ef', policy)).toBeNull();
  });

  it('should enforce all rules together', () => {
    const strictPolicy: PasswordPolicy = {
      minLength: 8,
      requireUppercase: true,
      requireSpecialChar: true,
    };
    expect(validatePassword('Ab@1234', strictPolicy)).toMatch(/不能少于 8 位/);
    expect(validatePassword('abcdefgh', strictPolicy)).toMatch(/大写字母/);
    expect(validatePassword('Abcdefgh', strictPolicy)).toMatch(/特殊字符/);
    expect(validatePassword('Ab@12345', strictPolicy)).toBeNull();
  });
});
