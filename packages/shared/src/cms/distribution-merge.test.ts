import { describe, expect, it } from 'vitest';
import { mergeCmsDistributionFields } from './distribution-merge';

describe('distribution three-way merge', () => {
  it('combines independent source and target edits without overwriting local work', () => {
    const merged = mergeCmsDistributionFields({ title: 'A', summary: 'old' }, { title: 'Local', summary: 'old' }, { title: 'A', summary: 'New' });
    expect(merged).toEqual({ patch: { summary: 'New' }, conflicts: [] });
  });
  it('reports simultaneous changes with the three actual values', () => {
    expect(mergeCmsDistributionFields({ title: 'A' }, { title: 'Local' }, { title: 'Source' }).conflicts)
      .toEqual([{ field: 'title', base: 'A', target: 'Local', incoming: 'Source' }]);
  });
  it('keeps explicitly target-owned fields on later synchronization', () => {
    expect(mergeCmsDistributionFields({ title: 'A' }, { title: 'Local' }, { title: 'Source' }, ['title'])).toEqual({ patch: {}, conflicts: [] });
  });
  it('does not conflict just because JSON object key order changes', () => {
    expect(mergeCmsDistributionFields({ extend: { a: 1, b: 2 } }, { extend: { b: 2, a: 1 } }, { extend: { a: 3, b: 2 } }).conflicts).toEqual([]);
  });
});
