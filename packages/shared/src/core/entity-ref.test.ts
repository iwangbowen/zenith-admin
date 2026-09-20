import { describe, expect, it } from 'vitest';
import { normalizeSubjectRefs, SUBJECT_REF_LIMIT } from './entity-ref';

describe('structured subject identity', () => {
  it('deduplicates the same role while preserving distinct roles', () => {
    expect(normalizeSubjectRefs([
      { type: 'payment.order', key: '12', role: 'primary' },
      { type: ' payment.order ', key: '12 ', role: 'primary' },
      { type: 'payment.order', key: '12', role: 'related' },
    ])).toEqual([
      { type: 'payment.order', key: '12', role: 'primary' },
      { type: 'payment.order', key: '12', role: 'related' },
    ]);
  });

  it('rejects malformed roles and types instead of persisting unqueryable references', () => {
    expect(() => normalizeSubjectRefs([{ type: '../payment', key: '12' }])).toThrow();
    expect(() => normalizeSubjectRefs([{ type: 'payment.order', key: '12', role: 'admin' as never }])).toThrow();
  });

  it('fails explicitly when the unique subject budget is exceeded', () => {
    const refs = Array.from({ length: SUBJECT_REF_LIMIT + 1 }, (_, index) => ({ type: 'payment.order', key: String(index) }));
    expect(() => normalizeSubjectRefs(refs)).toThrow('Too many subject references');
    expect(normalizeSubjectRefs(Array.from({ length: 200 }, () => refs[0]))).toHaveLength(1);
  });
});
