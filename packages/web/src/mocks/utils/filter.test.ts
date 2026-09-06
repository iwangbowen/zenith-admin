import { describe, expect, it } from 'vitest';
import { filterByKeyword, includesKeyword } from './filter';

describe('mock keyword filters', () => {
  it('keeps raw includes case behaviour by default', () => {
    expect(includesKeyword('Al', 'Alpha', 'beta')).toBe(true);
    expect(includesKeyword('al', 'Alpha', 'beta')).toBe(false);
  });

  it('supports case-insensitive matching only when requested', () => {
    expect(includesKeyword('al', 'Alpha', { caseInsensitive: true })).toBe(true);
  });

  it('filters by selector fields', () => {
    const rows = [{ name: 'Alpha', code: 'A1' }, { name: 'Beta', code: 'B1' }];
    expect(filterByKeyword(rows, 'A1', [(row) => row.name, (row) => row.code])).toEqual([rows[0]]);
    expect(filterByKeyword(rows, '', [(row) => row.name])).toEqual(rows);
  });
});
