/**
 * 可视化建模 SQL 生成器（shared 纯函数）单测：
 * 标识符白名单/转义、值转义、维度/指标/筛选/排序/限行组装。
 */
import { describe, it, expect } from 'vitest';
import { buildVisualSql, visualMetricAlias } from '@zenith/shared';
import type { ReportVisualModel } from '@zenith/shared';

const base: ReportVisualModel = { table: 'orders', dimensions: [], metrics: [], filters: [], orderBy: null, limit: null };

describe('buildVisualSql', () => {
  it('无维度无指标 → SELECT *', () => {
    expect(buildVisualSql(base)).toBe('SELECT *\nFROM "orders"');
  });
  it('维度 + 指标 → GROUP BY + 聚合别名', () => {
    const sql = buildVisualSql({
      ...base,
      dimensions: ['dept'],
      metrics: [{ field: 'amount', aggregate: 'sum' }],
    });
    expect(sql).toContain('SELECT "dept", sum("amount") AS "amount_sum"');
    expect(sql).toContain('GROUP BY "dept"');
  });
  it('count 无字段 → count(*)', () => {
    const sql = buildVisualSql({ ...base, metrics: [{ field: '', aggregate: 'count', alias: 'cnt' }] });
    expect(sql).toContain('count(*) AS "cnt"');
  });
  it('筛选条件 AND 连接，值单引号转义', () => {
    const sql = buildVisualSql({
      ...base,
      filters: [
        { field: 'status', op: 'eq', value: "pa'id" },
        { field: 'amount', op: 'gte', value: '100' },
      ],
    });
    expect(sql).toContain(`WHERE "status"::text = 'pa''id' AND "amount" >= '100'`);
  });
  it('like → ILIKE 模糊匹配', () => {
    const sql = buildVisualSql({ ...base, filters: [{ field: 'name', op: 'like', value: '张' }] });
    expect(sql).toContain(`"name"::text ILIKE '%张%'`);
  });
  it('排序 + LIMIT（上限 5000）', () => {
    const sql = buildVisualSql({ ...base, orderBy: { field: 'id', order: 'asc' }, limit: 99999 });
    expect(sql).toContain('ORDER BY "id" ASC');
    expect(sql).toContain('LIMIT 5000');
  });
  it('支持多表 JOIN、别名与关联字段', () => {
    const sql = buildVisualSql({
      ...base,
      alias: 'o',
      joins: [{ type: 'left', table: 'users', alias: 'u', sourceAlias: 'o', sourceField: 'user_id', targetField: 'id' }],
      dimensions: ['u.name'],
      metrics: [{ field: 'o.amount', aggregate: 'sum', alias: 'total_amount' }],
      filters: [{ field: 'o.status', op: 'eq', value: 'paid' }],
      orderBy: { field: 'u.name', order: 'asc' },
    });
    expect(sql).toContain('FROM "orders" AS "o"');
    expect(sql).toContain('LEFT JOIN "users" AS "u" ON "o"."user_id" = "u"."id"');
    expect(sql).toContain('SELECT "u"."name", sum("o"."amount") AS "total_amount"');
    expect(sql).toContain(`WHERE "o"."status"::text = 'paid'`);
    expect(sql).toContain('GROUP BY "u"."name"');
  });
  it('非法标识符（注入尝试）抛错', () => {
    expect(() => buildVisualSql({ ...base, table: 'orders; DROP TABLE users' })).toThrow('非法标识符');
    expect(() => buildVisualSql({ ...base, dimensions: ['a"b'] })).toThrow('非法标识符');
    expect(() => buildVisualSql({ ...base, metrics: [{ field: 'v', aggregate: 'sum', alias: 'x y' }] })).toThrow('非法别名');
    expect(() => buildVisualSql({ ...base, joins: [{ type: 'left', table: 'users', alias: 'u-1', sourceField: 'id', targetField: 'id' }] })).toThrow('非法标识符');
  });
  it('生成结果不含分号（只读执行器单语句约束）', () => {
    const sql = buildVisualSql({
      ...base,
      dimensions: ['a'],
      metrics: [{ field: 'b', aggregate: 'avg' }],
      filters: [{ field: 'c', op: 'neq', value: 'x' }],
      orderBy: { field: 'a', order: 'desc' },
      limit: 10,
    });
    expect(sql).not.toContain(';');
  });
});

describe('visualMetricAlias', () => {
  it('默认别名 field_aggregate，自定义优先', () => {
    expect(visualMetricAlias({ field: 'amount', aggregate: 'sum' })).toBe('amount_sum');
    expect(visualMetricAlias({ field: 'amount', aggregate: 'sum', alias: 'total' })).toBe('total');
  });
});
