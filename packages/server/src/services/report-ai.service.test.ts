/**
 * 报表 AI（NL2SQL）安全纯函数单测。
 * extractSql：从 AI 文本剥离 ```sql 围栏 / 说明文字 / 末尾分号。
 * isReadonlySelectSql：仅放行单条只读 SELECT/WITH，拦截写语句与多语句。
 */
import { describe, it, expect } from 'vitest';
import { extractSql, isReadonlySelectSql } from './report-ai.service';

describe('extractSql', () => {
  it('剥离 ```sql 代码围栏', () => {
    expect(extractSql('```sql\nSELECT a FROM t\n```')).toBe('SELECT a FROM t');
  });
  it('剥离无语言标记的围栏并从 SELECT/WITH 起截取', () => {
    expect(extractSql('```\nWITH x AS (SELECT 1) SELECT * FROM x\n```')).toBe('WITH x AS (SELECT 1) SELECT * FROM x');
  });
  it('跳过说明文字，从首个 SELECT 起，并去掉末尾分号', () => {
    expect(extractSql('这是你要的查询：\nSELECT a FROM t;')).toBe('SELECT a FROM t');
  });
  it('纯 SQL 原样（去分号）', () => {
    expect(extractSql('select 1;')).toBe('select 1');
  });
});

describe('isReadonlySelectSql', () => {
  it('放行单条 SELECT / WITH', () => {
    expect(isReadonlySelectSql('SELECT * FROM menus')).toBe(true);
    expect(isReadonlySelectSql('with t as (select 1 as n) select * from t')).toBe(true);
  });
  it('拦截写语句', () => {
    expect(isReadonlySelectSql('INSERT INTO t VALUES (1)')).toBe(false);
    expect(isReadonlySelectSql('UPDATE t SET a = 1')).toBe(false);
    expect(isReadonlySelectSql('DELETE FROM t')).toBe(false);
    expect(isReadonlySelectSql('DROP TABLE t')).toBe(false);
    expect(isReadonlySelectSql('TRUNCATE t')).toBe(false);
  });
  it('拦截 SELECT 后夹带写语句（多语句注入）', () => {
    expect(isReadonlySelectSql('SELECT 1; DROP TABLE users')).toBe(false);
    expect(isReadonlySelectSql('SELECT 1; DELETE FROM users')).toBe(false);
  });
  it('拦截非 SELECT 开头', () => {
    expect(isReadonlySelectSql('  explain select 1')).toBe(false);
  });
});
