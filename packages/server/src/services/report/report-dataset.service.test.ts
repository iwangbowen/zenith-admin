/**
 * 报表数据集纯函数单测：
 * resolveDatasetParams（默认值 + 类型强转 + 必填校验）；
 * buildExternalParamSql（${name} → 占位符 + values，参数化防注入，多方言）。
 */
import { describe, it, expect } from 'vitest';
import { HTTPException } from 'hono/http-exception';
import { resolveDatasetParams, buildExternalParamSql, applyRowRulesToSql } from './report-dataset.service';
import type { ReportDatasetParam } from '@zenith/shared';

describe('resolveDatasetParams', () => {
  it('未提供时套用默认值（默认值不强转）', () => {
    const defs: ReportDatasetParam[] = [{ name: 's', label: '状态', type: 'string', defaultValue: 'on' }];
    expect(resolveDatasetParams(defs, {})).toEqual({ s: 'on' });
  });
  it('按类型强转：number / boolean / string', () => {
    const defs: ReportDatasetParam[] = [
      { name: 'n', label: 'N', type: 'number' },
      { name: 'b', label: 'B', type: 'boolean' },
      { name: 's', label: 'S', type: 'string' },
    ];
    expect(resolveDatasetParams(defs, { n: '5', b: 'true', s: 123 })).toEqual({ n: 5, b: true, s: '123' });
    expect(resolveDatasetParams(defs, { n: 'x', b: '0' })).toMatchObject({ n: null, b: false });
  });
  it('空串视为未提供，套默认值', () => {
    const defs: ReportDatasetParam[] = [{ name: 's', label: 'S', type: 'string', defaultValue: 'def' }];
    expect(resolveDatasetParams(defs, { s: '' })).toEqual({ s: 'def' });
  });
  it('必填缺失抛 400', () => {
    const defs: ReportDatasetParam[] = [{ name: 'r', label: '必填', type: 'string', required: true }];
    expect(() => resolveDatasetParams(defs, {})).toThrow(HTTPException);
  });
  it('额外入参透传保留', () => {
    expect(resolveDatasetParams([], { extra: 1 })).toEqual({ extra: 1 });
  });
  it('剥离 __ 前缀的客户端伪造系统变量', () => {
    expect(resolveDatasetParams([], { __userId: 999, ok: 1 })).toEqual({ ok: 1 });
  });
});

describe('applyRowRulesToSql - 行级权限包裹', () => {
  it('无规则原样返回', () => {
    expect(applyRowRulesToSql('SELECT * FROM t', [])).toBe('SELECT * FROM t');
  });
  it('单规则包裹子查询', () => {
    const out = applyRowRulesToSql('SELECT * FROM t;', [{ where: 'dept_id = ${__deptId}' }]);
    expect(out).toBe('SELECT * FROM (\nSELECT * FROM t\n) AS _rls WHERE (dept_id = ${__deptId})');
  });
  it('多规则 OR 合并', () => {
    const out = applyRowRulesToSql('SELECT * FROM t', [{ where: 'a = 1' }, { where: 'b = 2' }]);
    expect(out).toContain('WHERE (a = 1) OR (b = 2)');
  });
  it('原 SQL 尾分号被剥离（防拼接多语句）', () => {
    const out = applyRowRulesToSql('SELECT 1;  ', [{ where: 'x > 0' }]);
    expect(out).not.toContain(';');
  });
});

describe('buildExternalParamSql - 参数化防注入', () => {
  const text = 'SELECT * FROM t WHERE name = ${name} AND age > ${age}';

  it('PostgreSQL → $N 占位符 + values 顺序', () => {
    const r = buildExternalParamSql(text, { name: 'A', age: 18 }, 'postgresql');
    expect(r.text).toBe('SELECT * FROM t WHERE name = $1 AND age > $2');
    expect(r.values).toEqual(['A', 18]);
  });
  it('MySQL → ? 占位符', () => {
    const r = buildExternalParamSql(text, { name: 'A', age: 18 }, 'mysql');
    expect(r.text).toBe('SELECT * FROM t WHERE name = ? AND age > ?');
    expect(r.values).toEqual(['A', 18]);
  });
  it('SQL Server → @pN 占位符', () => {
    const r = buildExternalParamSql(text, { name: 'A', age: 18 }, 'sqlserver');
    expect(r.text).toBe('SELECT * FROM t WHERE name = @p0 AND age > @p1');
    expect(r.values).toEqual(['A', 18]);
  });
  it('注入字符串进入 values 而非内联到 SQL', () => {
    const evil = "x'; DROP TABLE users; --";
    const r = buildExternalParamSql('SELECT * FROM t WHERE n = ${name}', { name: evil }, 'postgresql');
    expect(r.text).toBe('SELECT * FROM t WHERE n = $1');
    expect(r.text).not.toContain('DROP TABLE');
    expect(r.values).toEqual([evil]);
  });
  it('未提供的参数置 null', () => {
    const r = buildExternalParamSql('SELECT ${a}', {}, 'mysql');
    expect(r.values).toEqual([null]);
  });
  it('无参数时原样返回，values 为空', () => {
    const r = buildExternalParamSql('SELECT 1', {}, 'postgresql');
    expect(r.text).toBe('SELECT 1');
    expect(r.values).toEqual([]);
  });
});
