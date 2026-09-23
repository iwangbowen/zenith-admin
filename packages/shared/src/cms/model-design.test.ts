import { describe, expect, it } from 'vitest';
import { validateCmsStructuredFields } from './model-design';

describe('versioned content model validation', () => {
  it('allows incomplete drafts but requires publish fields', () => {
    const fields = [{ name: 'price', label: '价格', fieldType: 'number' as const, required: true }];
    expect(validateCmsStructuredFields(fields, {}, false)).toEqual([]);
    expect(validateCmsStructuredFields(fields, {}, true)[0].fieldPath).toBe('extend.price');
  });
  it('rejects unknown fields and disabled dictionary values', () => {
    const fields = [{ name: 'platform', label: '平台', fieldType: 'select' as const, resolvedOptions: [] }];
    expect(validateCmsStructuredFields(fields, { platform: 'old', hidden: 'value' }, false)).toHaveLength(2);
  });
  it('validates component instances at their own field paths', () => {
    const fields = [{ name: 'items', label: '规格', fieldType: 'array' as const, configuration: { fields: [{ name: 'name', label: '名称', fieldType: 'text' as const, required: true }] } }];
    expect(validateCmsStructuredFields(fields, { items: [{}] }, true)[0].fieldPath).toBe('extend.items.0.name');
  });
  it('rejects non-finite numbers and out-of-range values', () => {
    const fields = [{ name: 'rating', label: '评分', fieldType: 'number' as const, configuration: { min: 0, max: 10 } }];
    expect(validateCmsStructuredFields(fields, { rating: Infinity }, true)).toHaveLength(1);
    expect(validateCmsStructuredFields(fields, { rating: 11 }, true)).toHaveLength(1);
  });
});
