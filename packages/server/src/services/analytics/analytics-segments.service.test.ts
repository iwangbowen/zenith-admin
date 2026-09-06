/**
 * 行为中心阶段 1：用户分群 CRUD + 规则合法性校验 + AND/OR SQL 编译 + 物化事务 单测。
 *
 * 覆盖：
 *  - validateRules 边界（条件数量 0/11、事件属性 key 非法、属性字段非法）经 createSegment 触发，
 *    且必须在触碰 DB 之前抛出（db.insert 不应被调用）
 *  - ensureSegmentExists / ensureSegmentAccessible 404（tenant 不匹配或不存在）
 *  - buildSegmentDistinctIdSql：AND→INTERSECT / OR→UNION，tenantId null→IS NULL / 非 null→绑定参数比较，
 *    单条件不拼接联接符，minCount>1 走 HAVING COUNT(*) >=
 *  - materializeSegment 事务流程：先删旧快照 → INSERT...SELECT 新成员 → 统计人数 → 回写 estimatedSize/snapshotAt
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';
import { HTTPException } from 'hono/http-exception';
import type { AnalyticsSegmentRule, CreateAnalyticsUserSegmentInput } from '@zenith/shared/analytics';

const { select, insert, update, del, count, transaction } = vi.hoisted(() => ({
  select: vi.fn(),
  insert: vi.fn(),
  update: vi.fn(),
  del: vi.fn(),
  count: vi.fn(async () => 0),
  transaction: vi.fn(),
}));

vi.mock('../../db', () => ({
  db: { select, insert, update, delete: del, $count: count, transaction },
}));

vi.mock('../../lib/context', () => ({
  currentUser: () => ({ userId: 1, tenantId: 7, roles: ['user'] }),
}));

vi.mock('../../lib/tenant', async () => {
  const { eq, sql } = await import('drizzle-orm');
  return {
    currentCreateTenantId: () => 7,
    tenantScope: () => undefined,
    exactTenantCondition: (column: Parameters<typeof eq>[0], tenantId: number | null) => (tenantId == null ? sql`${column} IS NULL` : eq(column, tenantId)),
  };
});

import {
  createSegment, ensureSegmentExists, ensureSegmentAccessible, buildSegmentDistinctIdSql, materializeSegment,
} from './analytics-segments.service';

function makeSelectChain(rows: unknown[]) {
  const chain: Record<string, unknown> = {};
  chain.from = vi.fn(() => chain);
  chain.where = vi.fn(() => chain);
  chain.limit = vi.fn(async () => rows);
  chain.orderBy = vi.fn(() => chain);
  chain.offset = vi.fn(async () => rows);
  return chain;
}

describe('createSegment — validateRules 边界（必须在 DB 调用前抛出）', () => {
  beforeEach(() => vi.clearAllMocks());

  const baseInput = (rules: AnalyticsSegmentRule): CreateAnalyticsUserSegmentInput => ({
    name: 'seg', description: null, status: 'enabled', rules,
  });

  it('rejects 0 conditions', async () => {
    await expect(createSegment(baseInput({ operator: 'AND', conditions: [] }))).rejects.toThrow(HTTPException);
    expect(insert).not.toHaveBeenCalled();
  });

  it('rejects more than 10 conditions', async () => {
    const conditions = Array.from({ length: 11 }, () => ({ type: 'event' as const, eventName: 'view', days: 7 }));
    await expect(createSegment(baseInput({ operator: 'AND', conditions }))).rejects.toThrow(HTTPException);
    expect(insert).not.toHaveBeenCalled();
  });

  it('rejects an event condition with an illegal property key', async () => {
    const rules: AnalyticsSegmentRule = {
      operator: 'AND',
      conditions: [{ type: 'event', eventName: 'view', days: 7, properties: [{ key: "x'; DROP TABLE t;--", op: 'eq', value: 1 }] }],
    };
    await expect(createSegment(baseInput(rules))).rejects.toThrow(HTTPException);
    expect(insert).not.toHaveBeenCalled();
  });

  it('rejects an attribute condition with an unsupported field', async () => {
    const rules: AnalyticsSegmentRule = {
      operator: 'AND',
      conditions: [{ type: 'attribute', field: 'password', op: 'eq', value: 'x' }],
    };
    await expect(createSegment(baseInput(rules))).rejects.toThrow(HTTPException);
    expect(insert).not.toHaveBeenCalled();
  });

  it('accepts valid rules (direct attribute field + event with valid property key) and inserts via currentCreateTenantId()', async () => {
    const insertedRow = {
      id: 1, tenantId: 7, name: 'seg', description: null,
      rules: { operator: 'AND', conditions: [{ type: 'attribute', field: 'userId', op: 'eq', value: 1 }] },
      status: 'enabled', estimatedSize: 0, snapshotAt: null, createdBy: 1, updatedBy: 1,
      createdAt: new Date('2026-01-01T00:00:00Z'), updatedAt: new Date('2026-01-01T00:00:00Z'),
    };
    const returning = vi.fn(async () => [insertedRow]);
    const values = vi.fn(() => ({ returning }));
    insert.mockReturnValue({ values });

    const rules: AnalyticsSegmentRule = { operator: 'AND', conditions: [{ type: 'attribute', field: 'userId', op: 'eq', value: 1 }] };
    const result = await createSegment(baseInput(rules));
    // createdBy/updatedBy 由 db/index.ts 审计 Proxy 自动注入，service 不再手动传入
    expect(values).toHaveBeenCalledWith(expect.objectContaining({ tenantId: 7, name: 'seg' }));
    expect(values).toHaveBeenCalledWith(expect.not.objectContaining({ createdBy: expect.anything() }));
    expect(result.id).toBe(1);
  });
});

describe('ensureSegmentExists / ensureSegmentAccessible — tenant 归属校验', () => {
  beforeEach(() => vi.clearAllMocks());

  it('throws 404 when the segment does not exist or belongs to another tenant', async () => {
    select.mockReturnValue(makeSelectChain([]));
    await expect(ensureSegmentExists(999)).rejects.toThrow(HTTPException);
  });

  it('returns the row when found (and ensureSegmentAccessible is a thin alias of the same check)', async () => {
    const row = { id: 5, tenantId: 7, name: 'seg', rules: { operator: 'AND', conditions: [] } };
    select.mockReturnValue(makeSelectChain([row]));
    await expect(ensureSegmentExists(5)).resolves.toEqual(row);
    select.mockReturnValue(makeSelectChain([row]));
    await expect(ensureSegmentAccessible(5)).resolves.toEqual(row);
  });
});

describe('buildSegmentDistinctIdSql — AND→INTERSECT / OR→UNION + tenant 绑定 + 注入防护', () => {
  const dialect = new PgDialect();

  it('renders a single condition without any set-operator', () => {
    const rules: AnalyticsSegmentRule = { operator: 'AND', conditions: [{ type: 'event', eventName: 'view', days: 7 }] };
    const { sql: text } = dialect.sqlToQuery(buildSegmentDistinctIdSql(rules, 7));
    expect(text).not.toContain('INTERSECT');
    expect(text).not.toContain('UNION');
  });

  it('joins 2+ AND conditions with INTERSECT', () => {
    const rules: AnalyticsSegmentRule = {
      operator: 'AND',
      conditions: [
        { type: 'event', eventName: 'view', days: 7 },
        { type: 'event', eventName: 'checkout', days: 7 },
      ],
    };
    const { sql: text } = dialect.sqlToQuery(buildSegmentDistinctIdSql(rules, 7));
    expect(text).toContain('INTERSECT');
    expect(text).not.toContain('UNION');
  });

  it('joins 2+ OR conditions with UNION', () => {
    const rules: AnalyticsSegmentRule = {
      operator: 'OR',
      conditions: [
        { type: 'event', eventName: 'view', days: 7 },
        { type: 'event', eventName: 'checkout', days: 7 },
      ],
    };
    const { sql: text } = dialect.sqlToQuery(buildSegmentDistinctIdSql(rules, 7));
    expect(text).toContain('UNION');
    expect(text).not.toContain('INTERSECT');
  });

  it('binds a null tenantId as "IS NULL" (platform-wide segment) rather than a bound parameter', () => {
    const rules: AnalyticsSegmentRule = { operator: 'AND', conditions: [{ type: 'event', eventName: 'view', days: 7 }] };
    const { sql: text, params } = dialect.sqlToQuery(buildSegmentDistinctIdSql(rules, null));
    expect(text).toContain('IS NULL');
    expect(params).not.toContain(null);
  });

  it('binds a non-null tenantId as a parameter (not inlined)', () => {
    const rules: AnalyticsSegmentRule = { operator: 'AND', conditions: [{ type: 'event', eventName: 'view', days: 7 }] };
    const { sql: text, params } = dialect.sqlToQuery(buildSegmentDistinctIdSql(rules, 7));
    expect(text).not.toContain(' = 7');
    expect(params).toContain(7);
  });

  it('uses HAVING COUNT(*) >= for minCount > 1', () => {
    const rules: AnalyticsSegmentRule = { operator: 'AND', conditions: [{ type: 'event', eventName: 'view', days: 7, minCount: 3 }] };
    const { sql: text, params } = dialect.sqlToQuery(buildSegmentDistinctIdSql(rules, 7));
    expect(text).toContain('HAVING COUNT(*) >=');
    expect(params).toContain(3);
  });

  it('compiles an attribute condition on a property.<key> field via the shared JSON property builder', () => {
    const rules: AnalyticsSegmentRule = {
      operator: 'AND',
      conditions: [{ type: 'attribute', field: 'property.vipLevel', op: 'gte', value: 3 }],
    };
    const { sql: text, params } = dialect.sqlToQuery(buildSegmentDistinctIdSql(rules, 7));
    expect(text).toContain('analytics_user_profiles');
    expect(params).toContain('vipLevel');
    expect(params).toContain(3);
  });
});

describe('materializeSegment — 事务内先删旧快照，再 INSERT...SELECT，再回写 estimatedSize/snapshotAt', () => {
  beforeEach(() => vi.clearAllMocks());

  function makeTx() {
    const callOrder: string[] = [];
    const deleteWhere = vi.fn(async () => { callOrder.push('delete'); });
    const execute = vi.fn(async () => { callOrder.push('execute'); });
    const countSelectChain = {
      from: vi.fn(() => countSelectChain),
      where: vi.fn(async () => { callOrder.push('count-select'); return [{ count: 5 }]; }),
    };
    const updateWhere = vi.fn(async () => { callOrder.push('update'); });
    const tx = {
      delete: vi.fn(() => ({ where: deleteWhere })),
      execute,
      select: vi.fn(() => countSelectChain),
      update: vi.fn(() => ({ set: vi.fn(() => ({ where: updateWhere })) })),
    };
    return { tx, callOrder };
  }

  it('runs delete → insert-select → count → update in order and returns estimatedSize', async () => {
    const segmentRow = {
      id: 3, tenantId: 7, rules: { operator: 'AND', conditions: [{ type: 'event', eventName: 'view', days: 7 }] },
    };
    select.mockReturnValue(makeSelectChain([segmentRow]));
    const { tx, callOrder } = makeTx();
    transaction.mockImplementation(async (cb: (tx: unknown) => Promise<unknown>) => cb(tx));

    const result = await materializeSegment(3);
    expect(callOrder).toEqual(['delete', 'execute', 'count-select', 'update']);
    expect(result).toEqual({ estimatedSize: 5 });
  });

  it('accepts an externally-provided executor and skips db.transaction() entirely', async () => {
    const segmentRow = {
      id: 4, tenantId: null, rules: { operator: 'AND', conditions: [{ type: 'event', eventName: 'view', days: 7 }] },
    };
    select.mockReturnValue(makeSelectChain([segmentRow]));
    const { tx } = makeTx();

    const result = await materializeSegment(4, tx as never);
    expect(transaction).not.toHaveBeenCalled();
    expect(result).toEqual({ estimatedSize: 5 });
  });

  it('re-validates tenant ownership via ensureSegmentExists before materializing (404 short-circuits without touching the transaction)', async () => {
    select.mockReturnValue(makeSelectChain([]));
    await expect(materializeSegment(999)).rejects.toThrow(HTTPException);
    expect(transaction).not.toHaveBeenCalled();
  });
});
