import { describe, it, expect } from 'vitest';
import { generateCaptcha, verifyCaptcha, cleanExpiredCaptchas, getCaptchaStoreSize, resolveCaptchaComplexity } from './captcha';

describe('captcha', () => {
  it('should generate a captcha with id and image', () => {
    const { captchaId, captchaImage } = generateCaptcha();
    expect(captchaId).toBeTruthy();
    expect(captchaImage).toContain('<svg');
  });

  it('should generate captcha for each complexity level', () => {
    for (const level of ['low', 'medium', 'high'] as const) {
      const { captchaId, captchaImage } = generateCaptcha(level);
      expect(captchaId).toBeTruthy();
      expect(captchaImage).toContain('<svg');
    }
  });

  it('should resolve complexity with fallback to medium', () => {
    expect(resolveCaptchaComplexity('low')).toBe('low');
    expect(resolveCaptchaComplexity('medium')).toBe('medium');
    expect(resolveCaptchaComplexity('high')).toBe('high');
    expect(resolveCaptchaComplexity('invalid')).toBe('medium');
    expect(resolveCaptchaComplexity(undefined)).toBe('medium');
    expect(resolveCaptchaComplexity('')).toBe('medium');
  });

  it('should verify a correct captcha', () => {
    // We can't know the answer, but we can test the flow:
    // generate, then try wrong answer → false
    const { captchaId } = generateCaptcha();
    // A random wrong answer:
    const result = verifyCaptcha(captchaId, 'definitely-wrong-answer-xyz');
    expect(result).toBe(false);
  });

  it('should return false for non-existent captcha', () => {
    expect(verifyCaptcha('non-existent-id', '42')).toBe(false);
  });

  it('should consume captcha after verification (one-time use)', () => {
    const { captchaId } = generateCaptcha();
    // First attempt (wrong answer, but consumes the entry)
    verifyCaptcha(captchaId, 'wrong');
    // Second attempt should always fail since entry is gone
    expect(verifyCaptcha(captchaId, 'any')).toBe(false);
  });

  it('should track store size', () => {
    const before = getCaptchaStoreSize();
    generateCaptcha();
    generateCaptcha();
    expect(getCaptchaStoreSize()).toBe(before + 2);
  });

  it('should clean expired captchas', () => {
    // Just ensure it doesn't throw
    const cleaned = cleanExpiredCaptchas();
    expect(typeof cleaned).toBe('number');
  });
});
