import { describe, expect, it } from 'vitest';
import { isReadonlyReportSql, normalizeReadonlyReportSql } from './report-sql-safety';

describe('report SQL safety', () => {
  it('allows one SELECT or read-only CTE', () => {
    expect(normalizeReadonlyReportSql('SELECT * FROM orders;')).toBe('SELECT * FROM orders');
    expect(isReadonlyReportSql('WITH x AS (SELECT 1 AS n) SELECT * FROM x')).toBe(true);
  });

  it('allows keywords and semicolons inside literals/comments', () => {
    expect(isReadonlyReportSql("SELECT 'delete; update' AS text")).toBe(true);
    expect(isReadonlyReportSql('SELECT 1 /* delete from users */')).toBe(true);
    expect(isReadonlyReportSql('SELECT 1 AS "load"')).toBe(true);
    expect(isReadonlyReportSql('SELECT "comment" FROM posts')).toBe(true);
  });

  it('rejects multi statements and writes hidden in a CTE', () => {
    expect(isReadonlyReportSql('SELECT 1; SELECT 2')).toBe(false);
    expect(isReadonlyReportSql('WITH x AS (DELETE FROM users RETURNING id) SELECT * FROM x')).toBe(false);
  });

  it('rejects side-effect functions and SELECT INTO', () => {
    expect(isReadonlyReportSql("SELECT pg_read_file('/etc/passwd')")).toBe(false);
    expect(isReadonlyReportSql('SELECT "pg_read_file"(\'/etc/passwd\')')).toBe(false);
    expect(isReadonlyReportSql('SELECT * INTO backup_users FROM users')).toBe(false);
    expect(isReadonlyReportSql("SELECT load_file('/etc/passwd')")).toBe(false);
    expect(isReadonlyReportSql('SELECT 1 /*!50000 INTO OUTFILE \'/tmp/x\' */')).toBe(false);
  });
});
