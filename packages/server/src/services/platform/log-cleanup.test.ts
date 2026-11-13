import { beforeEach, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';

const { select, execute } = vi.hoisted(() => ({ select: vi.fn(), execute: vi.fn() }));
vi.mock('../../db', () => ({ db: { select, execute } }));
import { operationLogs, loginLogs, cronJobLogs } from '../../db/schema';
import { deleteLogRows } from './log-cleanup';

beforeEach(() => {
  vi.resetAllMocks();
  select.mockReturnValue({ from: () => ({ where: async () => [{ id: 9123 }] }) });
});

describe('manual log deletion batches', () => {
  it('returns without deleting when the authorized scope has no records', async () => {
    select.mockReturnValue({ from: () => ({ where: async () => [{ id: 0 }] }) });
    await expect(deleteLogRows(operationLogs, undefined)).resolves.toBe(0);
    expect(execute).not.toHaveBeenCalled();
  });
  it('continues full batches, counts returned IDs and freezes the initial ID boundary', async () => {
    execute.mockResolvedValueOnce(Array.from({ length: 5000 }, (_, id) => ({ id }))).mockResolvedValueOnce([{ id: 6001 }, { id: 6002 }]);
    await expect(deleteLogRows(operationLogs, eq(operationLogs.tenantId, 42))).resolves.toBe(5002);
    expect(execute).toHaveBeenCalledTimes(2);
    for (const [query] of execute.mock.calls) {
      const compiled = new PgDialect({ casing: 'snake_case' }).sqlToQuery(query);
      expect(compiled.sql).toContain('"operation_logs"."tenant_id" =');
      expect(compiled.sql).toContain('"operation_logs"."id" <=');
      expect(compiled.sql).toContain('returning "operation_logs"."id"');
      expect(compiled.params).toEqual([42, 9123, 5000]);
    }
  });
  it.each([loginLogs, cronJobLogs])('supports each log table without loading all IDs', async table => {
    execute.mockResolvedValueOnce([{ id: 1 }]);
    await expect(deleteLogRows(table, undefined)).resolves.toBe(1);
    const compiled = new PgDialect({ casing: 'snake_case' }).sqlToQuery(execute.mock.calls[0][0]);
    expect(compiled.sql).toContain('where true and');
    expect(compiled.params).toEqual([9123, 5000]);
  });
});
