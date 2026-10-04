import { is } from 'drizzle-orm';
import { getTableConfig, PgTable } from 'drizzle-orm/pg-core';
import { describe, expect, it } from 'vitest';
import * as schema from './schema';
import { dbColumnName } from './types';

describe('schema 时间列', () => {
  it('全部为 timestamptz', () => {
    const offenders: string[] = [];
    for (const value of Object.values(schema)) {
      if (!is(value, PgTable)) continue;
      const { name, columns } = getTableConfig(value);
      for (const column of columns) {
        const isTimestamp = column.columnType === 'PgTimestamp' || column.columnType === 'PgTimestampString';
        if (isTimestamp && !(column as unknown as { withTimezone: boolean }).withTimezone) {
          offenders.push(`${name}.${dbColumnName(column)}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});
