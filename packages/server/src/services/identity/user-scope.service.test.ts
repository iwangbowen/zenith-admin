import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';

const dbMocks = vi.hoisted(() => ({
  execute: vi.fn(),
  select: vi.fn(),
}));

vi.mock('../../db', () => ({
  db: {
    execute: dbMocks.execute,
    select: dbMocks.select,
  },
}));

vi.mock('../../lib/tenant', () => ({
  exactTenantCondition: vi.fn(() => undefined),
  tenantScope: vi.fn(() => undefined),
}));

import {
  buildScopeMemberSummaryMap,
  getScopeMemberSummaries,
  validateScopeUserIds,
} from './user-scope.service';

function createSelectChain(result: unknown[]) {
  const chain = {
    from: vi.fn(),
    where: vi.fn(),
    then: (resolve: (value: unknown[]) => unknown, reject?: (reason: unknown) => unknown) =>
      Promise.resolve(result).then(resolve, reject),
  };
  chain.from.mockReturnValue(chain);
  chain.where.mockReturnValue(chain);
  return chain;
}

beforeEach(() => {
  vi.resetAllMocks();
});

describe('buildScopeMemberSummaryMap', () => {
  it('keeps the exact count and only the first five ordered previews per scope', () => {
    const rows = Array.from({ length: 7 }, (_, index) => ({
      scopeId: 10,
      id: index + 1,
      nickname: `用户${index + 1}`,
      avatar: index === 0 ? null : `avatar-${index + 1}`,
      count: 7,
    }));
    rows.push({
      scopeId: 20,
      id: 99,
      nickname: '另一用户',
      avatar: null,
      count: 1,
    });

    const summaries = buildScopeMemberSummaryMap(rows);

    expect(summaries.get(10)).toEqual({
      count: 7,
      preview: rows.slice(0, 5).map(({ id, nickname, avatar }) => ({ id, nickname, avatar })),
    });
    expect(summaries.get(20)).toEqual({
      count: 1,
      preview: [{ id: 99, nickname: '另一用户', avatar: null }],
    });
  });
});

describe('getScopeMemberSummaries', () => {
  it('returns immediately for an empty scope list', async () => {
    await expect(getScopeMemberSummaries('role', [])).resolves.toEqual(new Map());
    expect(dbMocks.execute).not.toHaveBeenCalled();
  });

  it('uses one bounded summary query for all requested scopes', async () => {
    dbMocks.execute.mockResolvedValueOnce([
      { scopeId: 1, id: 11, nickname: '甲', avatar: null, count: 2 },
      { scopeId: 1, id: 12, nickname: '乙', avatar: null, count: 2 },
      { scopeId: 2, id: 21, nickname: '丙', avatar: null, count: 1 },
    ]);

    const summaries = await getScopeMemberSummaries('position', [1, 1, 2]);

    expect(dbMocks.execute).toHaveBeenCalledTimes(1);
    const generatedSql = new PgDialect().sqlToQuery(dbMocks.execute.mock.calls[0][0]).sql;
    expect(generatedSql).toContain('COUNT(*) OVER (PARTITION BY scope_id)');
    expect(generatedSql).toContain('ROW_NUMBER() OVER (PARTITION BY scope_id ORDER BY user_id)');
    expect(generatedSql).toContain('preview_rank <= $');
    expect(generatedSql).toContain('IS NOT DISTINCT FROM');
    expect(summaries.get(1)?.count).toBe(2);
    expect(summaries.get(1)?.preview.map((user) => user.id)).toEqual([11, 12]);
    expect(summaries.get(2)?.preview.map((user) => user.id)).toEqual([21]);
  });
});

describe('validateScopeUserIds', () => {
  it('deduplicates user IDs after tenant-aware validation', async () => {
    dbMocks.select.mockReturnValueOnce(createSelectChain([{ id: 3 }, { id: 5 }]));

    await expect(validateScopeUserIds([3, 3, 5], 7)).resolves.toEqual([3, 5]);
  });

  it('rejects IDs outside the target scope tenant', async () => {
    dbMocks.select.mockReturnValueOnce(createSelectChain([{ id: 3 }]));

    await expect(validateScopeUserIds([3, 5], 7)).rejects.toThrow('存在无效用户');
  });
});
