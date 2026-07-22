import { describe, expect, it } from 'vitest';
import { performance } from 'node:perf_hooks';
import { createCmsFormSchema, type CmsFormField } from '@zenith/shared';
import { compileCmsFormPattern } from './cms-form-pattern';
import { validateCmsFormFields } from './cms-form-validation';

function field(overrides: Partial<CmsFormField>): CmsFormField {
  return {
    name: 'value',
    label: '测试字段',
    fieldType: 'text',
    required: true,
    ...overrides,
  };
}

describe('CMS form field validation', () => {
  it.each([
    [field({ fieldType: 'email' }), 'bad-email'],
    [field({ fieldType: 'mobile' }), '123'],
    [field({ fieldType: 'url' }), 'javascript:alert(1)'],
    [field({ fieldType: 'number', min: 10 }), '9'],
    [field({ minLength: 3 }), 'ab'],
    [field({ pattern: '^ZEN-[0-9]{1,6}$' }), 'bad'],
  ] as const)('rejects invalid typed/constraint values', (definition, value) => {
    expect(() => validateCmsFormFields([definition], { value })).toThrow();
  });

  it('accepts valid values and uses a field-level custom message', () => {
    expect(validateCmsFormFields([
      field({ fieldType: 'email' }),
      field({ name: 'score', label: '分数', fieldType: 'number', min: 1, max: 10 }),
    ], { value: 'user@example.com', score: '8' })).toEqual({
      value: 'user@example.com',
      score: '8',
    });
    expect(() => validateCmsFormFields([
      field({ minLength: 5, errorMessage: '自定义错误' }),
    ], { value: 'x' })).toThrow('自定义错误');
  });

  it('compiles reviewer payloads with RE2 and executes them in linear time', () => {
    const input = `${'a'.repeat(100_000)}!`;
    for (const pattern of ['^a{0,20}...b$', '(a+)+$']) {
      const compiled = compileCmsFormPattern(pattern);
      const started = performance.now();
      expect(compiled.test(input)).toBe(false);
      expect(performance.now() - started).toBeLessThan(1000);
    }
    expect(createCmsFormSchema.safeParse({
      siteId: 1,
      code: 're2-linear',
      name: 'RE2 线性表单',
      fields: [{ name: 'value', label: '值', fieldType: 'text', pattern: '(a+)+$' }],
    }).success).toBe(true);
  });

  it('retains legal email and code patterns', () => {
    const pattern = '^[A-Z]{2}-\\d{4}$';
    const definition = field({ pattern });
    expect(validateCmsFormFields([definition], { value: 'AB-2026' })).toEqual({ value: 'AB-2026' });
    expect(() => validateCmsFormFields([definition], { value: 'bad' })).toThrow();
  });
});
