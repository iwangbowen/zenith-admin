import { describe, expect, it } from 'vitest';
import { stripSqlServerTopLevelOrderBy } from './report-external-db';

describe('stripSqlServerTopLevelOrderBy', () => {
  it('removes the outer ORDER BY before wrapping', () => {
    expect(stripSqlServerTopLevelOrderBy('SELECT id FROM t ORDER BY created_at DESC'))
      .toBe('SELECT id FROM t');
  });

  it('keeps ORDER BY inside nested queries and string literals', () => {
    expect(stripSqlServerTopLevelOrderBy("SELECT * FROM (SELECT TOP 1 id FROM t ORDER BY id) x WHERE x.id = 'order by'"))
      .toContain('ORDER BY id');
  });
});
