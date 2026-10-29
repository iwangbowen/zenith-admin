import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';
import type { SQL } from 'drizzle-orm';
import type { ReportDatasourceType } from '@zenith/shared/report';

const state = vi.hoisted(() => ({ statements: [] as Array<{ sql: string; values: unknown[] }>, empty: false }));
function reply(text: string, values: unknown[] = []) {
  state.statements.push({ sql: text, values });
  return /select count\(\*\)/i.test(text) ? [{ total: 9 }] : state.empty ? [] : [{ value: 1 }];
}
vi.mock('../db', async () => {
  const { drizzle } = await import('drizzle-orm/postgres-js');
  const tx = drizzle.mock({ casing: 'snake_case' });
  vi.spyOn(tx, 'execute').mockImplementation(async (query: unknown) => {
    const compiled = new PgDialect().sqlToQuery(query as SQL);
    if (/pg_has_role/i.test(compiled.sql)) return [{ member: true }];
    if (/^select (?:count|\*)/i.test(compiled.sql)) return reply(compiled.sql, compiled.params);
    state.statements.push({ sql: compiled.sql, values: compiled.params });
    return [];
  });
  vi.spyOn(tx, 'transaction').mockImplementation(async (fn) => fn(tx as never));
  return { db: tx };
});
vi.mock('postgres', () => ({ default: () => ({ unsafe: async (text: string, values: unknown[]) => reply(text, values), end: async () => {} }) }));
vi.mock('./outbound-url', async (original) => ({
  ...await original<typeof import('./outbound-url')>(),
  resolveSafeOutboundHost: async () => [{ address: '127.0.0.1', family: 4 }],
}));
vi.mock('node:module', async (original) => {
  const actual = await original<typeof import('node:module')>();
  return { ...actual, createRequire: (url: string) => {
    const require = actual.createRequire(url);
    return (name: string) => {
      if (name === 'mysql2/promise') return { createPool: () => ({
        getConnection: async () => ({ query: async (q: { sql: string; values: unknown[] }) => [reply(q.sql, q.values), []], release: () => {} }),
        end: async () => {},
      }) };
      if (name === 'mssql') return { ConnectionPool: class {
        connected = true;
        async connect() { return this; }
        async close() {}
        request() {
          const values: unknown[] = [];
          return { input: (_key: string, value: unknown) => { values.push(value); }, query: async (text: string) => ({ recordset: reply(text, values) }) };
        }
      } };
      return require(name);
    };
  } };
});

import { runExternalQuery, invalidateExternalDatasourcePools } from './report-external-db';
import { runReportData } from '../services/report/report-dataset-execution.service';

const config = { host: '127.0.0.1', database: 'counting-regression', user: 'test' };
const types = ['sql', 'postgresql', 'mysql', 'sqlserver'] as const;
const run = (type: typeof types[number], paged: boolean) => type === 'sql'
  ? runReportData('sql', {}, { sql: 'SELECT value FROM demo WHERE owner_id = ${owner}' }, { owner: 7 }, paged ? { page: 4, pageSize: 2 } : { limit: 2 })
  : runExternalQuery(type, config, `SELECT value FROM demo WHERE owner_id = ${type === 'postgresql' ? '$1' : type === 'mysql' ? '?' : '@p0'}`, [7], paged ? { page: 4, pageSize: 2 } : { limit: 2 });

beforeEach(() => { state.statements.length = 0; state.empty = false; });
afterEach(async () => { for (const type of types.slice(1)) await invalidateExternalDatasourcePools(type as ReportDatasourceType, config); });

describe.each(types)('%s query counting policy', (type) => {
  it('executes only the bounded data query for charts and previews', async () => {
    const result = await run(type, false);
    const queries = state.statements.filter((s) => /^select (?:count|\*)/i.test(s.sql));
    expect(queries).toHaveLength(1);
    expect(queries[0].sql).not.toMatch(/count\(\*\)/i);
    expect(queries[0].values).toContain(7);
    expect(result.total).toBeNull();
    expect(result.rows).toEqual([{ value: 1 }]);
    if (type === 'sql') expect(state.statements.some((s) => /set local role/i.test(s.sql))).toBe(true);
  });
  it('keeps exact totals on empty pages and binds the same parameters to both statements', async () => {
    state.empty = true;
    const result = await run(type, true);
    const queries = state.statements.filter((s) => /^select (?:count|\*)/i.test(s.sql));
    expect(queries).toHaveLength(2);
    expect(queries.every((s) => s.values.includes(7))).toBe(true);
    expect(queries.find((s) => /^select \*/i.test(s.sql))?.sql).toMatch(/offset 6/i);
    expect(result.rows).toEqual([]);
    expect(result.total).toBe(9);
  });
});
