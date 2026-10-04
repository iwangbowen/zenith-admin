import { describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import { APP_TIME_ZONE } from './datetime';
import { localDate, localDayStart, localFormat, localTime, localTrunc } from './datetime-sql';

const dialect = new PgDialect();

describe('datetime-sql helpers', () => {
  it('时区以字面量内联、不产生绑定参数', () => {
    expect(dialect.sqlToQuery(localTime(sql`col`)).sql).toBe(`timezone('${APP_TIME_ZONE}', col)`);
    expect(dialect.sqlToQuery(localTime(sql`col`)).params).toEqual([]);

    expect(dialect.sqlToQuery(localDate(sql`col`)).sql).toBe(`to_char(timezone('${APP_TIME_ZONE}', col), 'YYYY-MM-DD')`);
    expect(dialect.sqlToQuery(localDate(sql`col`)).params).toEqual([]);

    expect(dialect.sqlToQuery(localFormat(sql`col`, 'YYYY-MM')).sql).toBe(`to_char(timezone('${APP_TIME_ZONE}', col), 'YYYY-MM')`);
    expect(dialect.sqlToQuery(localFormat(sql`col`, 'YYYY-MM-DD HH24:00:00')).params).toEqual([]);

    expect(dialect.sqlToQuery(localTrunc('day', sql`col`)).sql).toBe(`date_trunc('day', col, '${APP_TIME_ZONE}')`);
    expect(dialect.sqlToQuery(localTrunc('day', sql`col`)).params).toEqual([]);
  });

  it('同一表达式文本可复用（select / groupBy / orderBy 判等）', () => {
    const day = localDate(sql`col`);
    expect(dialect.sqlToQuery(day).sql).toBe(dialect.sqlToQuery(day).sql);
    expect(dialect.sqlToQuery(day).params).toEqual([]);
  });

  it('localDayStart 返回业务时区零点且内联天数', () => {
    const query = dialect.sqlToQuery(localDayStart(3));
    expect(query.sql).toContain(`'${APP_TIME_ZONE}'`);
    expect(query.sql).toContain('- 3');
    expect(query.params).toEqual([]);
  });

  it('localDayStart 拒绝负数', () => {
    expect(() => localDayStart(-1)).toThrow('非法天数');
  });
});
