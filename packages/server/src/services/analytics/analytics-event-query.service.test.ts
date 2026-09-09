/**
 * 行为中心阶段 1：通用事件分析工作台 queryEvents 单测。
 * 覆盖：
 *  - groupBy 维度白名单（即便绕过 TS 类型传入非法维度也会在服务端被拒绝，不接受任意列名）
 *  - 属性过滤 key 非法时拒绝（复用 analytics-property-filter 的注入防护）
 *  - 默认 groupBy=['date'] / metric='events'
 *  - segmentId 必须先经 ensureSegmentAccessible 校验 tenant 归属，再用于成员子查询过滤
 *  - tenantScope 总是被应用（强制 tenant 隔离）
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { HTTPException } from 'hono/http-exception';

const { select, ensureSegmentAccessible, segmentMemberDistinctIdSubquery, tenantScope } = vi.hoisted(() => ({
  select: vi.fn(),
  ensureSegmentAccessible: vi.fn(async () => ({ id: 1, tenantId: null })),
  segmentMemberDistinctIdSubquery: vi.fn(() => 'SEGMENT_SUBQUERY_MARKER'),
  tenantScope: vi.fn(() => undefined as unknown),
}));

vi.mock('../../db', () => ({ db: { select } }));
vi.mock('./analytics-segments.service', () => ({ ensureSegmentAccessible, segmentMemberDistinctIdSubquery }));
vi.mock('../../lib/tenant', () => ({ tenantScope }));

import { analyticsEventQuerySchema } from '@zenith/shared/analytics';
import { queryEvents } from './analytics-event-query.service';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function makeChain(rows: unknown[]): any {
  const chain: Record<string, unknown> = {};
  chain.from = vi.fn(() => chain);
  chain.where = vi.fn(() => chain);
  chain.groupBy = vi.fn(() => chain);
  chain.orderBy = vi.fn(() => chain);
  chain.limit = vi.fn(() => chain);
  chain.offset = vi.fn(async () => rows);
  chain.$dynamic = vi.fn(() => chain);
  return chain;
}

describe('queryEvents — groupBy 白名单 + 属性注入防护 + tenantScope + segment 归属', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('rejects a groupBy dimension outside the whitelist (defense-in-depth even if the type system were bypassed)', async () => {
    select.mockReturnValue(makeChain([]));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await expect(queryEvents({ groupBy: ['__proto__' as any] })).rejects.toThrow(HTTPException);
    expect(select).not.toHaveBeenCalled();
  });

  it('rejects a property filter whose key fails the injection-safety regex', async () => {
    select.mockReturnValue(makeChain([]));
    await expect(queryEvents({ propertyFilters: [{ key: "x'; DROP TABLE t;--", op: 'eq', value: 1 }] }))
      .rejects.toThrow(HTTPException);
    expect(select).not.toHaveBeenCalled();
  });

  it('defaults to groupBy=[date] and metric=events, and maps rows into dimensions/value shape', async () => {
    const chain = makeChain([{ d0: '2026-01-01', value: 5, __total: 1 }]);
    select.mockReturnValue(chain);
    const result = await queryEvents({});
    expect(result.queryMeta.groupBy).toEqual(['date']);
    expect(result.queryMeta.metric).toBe('events');
    expect(result.list).toEqual([{ dimensions: { date: '2026-01-01' }, value: 5 }]);
    expect(result.total).toBe(1);
  });

  it('caps groupBy to the first 2 dimensions when more are supplied', async () => {
    const chain = makeChain([]);
    select.mockReturnValue(chain);
    const result = await queryEvents({ groupBy: ['date', 'eventName', 'source'] });
    expect(result.queryMeta.groupBy).toEqual(['date', 'eventName']);
  });

  it('validates segmentId via ensureSegmentAccessible (tenant ownership) before using it to filter distinctId', async () => {
    const chain = makeChain([]);
    select.mockReturnValue(chain);
    await queryEvents({ segmentId: 42 });
    expect(ensureSegmentAccessible).toHaveBeenCalledWith(42);
    expect(segmentMemberDistinctIdSubquery).toHaveBeenCalledWith(42);
  });

  it('never touches segment helpers when no segmentId is provided', async () => {
    const chain = makeChain([]);
    select.mockReturnValue(chain);
    await queryEvents({});
    expect(ensureSegmentAccessible).not.toHaveBeenCalled();
    expect(segmentMemberDistinctIdSubquery).not.toHaveBeenCalled();
  });

  it('always applies tenantScope(userEvents) to enforce tenant isolation on every query', async () => {
    const chain = makeChain([]);
    select.mockReturnValue(chain);
    await queryEvents({ eventNames: ['$pageview'] });
    expect(tenantScope).toHaveBeenCalledTimes(1);
  });

  it('pageSize 上限由契约 analyticsEventQuerySchema 守住（1..200），服务层按解析值原样下发 limit', async () => {
    expect(analyticsEventQuerySchema.safeParse({ pageSize: 5000 }).success).toBe(false);
    const chain = makeChain([]);
    select.mockReturnValue(chain);
    await queryEvents(analyticsEventQuerySchema.parse({ pageSize: 200 }));
    expect(chain.limit).toHaveBeenCalledWith(200);
  });

  it('translates page into an offset so paging actually skips rows', async () => {
    const chain = makeChain([]);
    select.mockReturnValue(chain);
    await queryEvents({ page: 3, pageSize: 20 });
    expect(chain.limit).toHaveBeenCalledWith(20);
    expect(chain.offset).toHaveBeenCalledWith(40);
  });

  it('switches to UV metric (distinct distinctId count) when metric=uv is requested', async () => {
    const chain = makeChain([{ d0: 'checkout', value: 3, __total: 1 }]);
    select.mockReturnValue(chain);
    const result = await queryEvents({ metric: 'uv', groupBy: ['eventName'] });
    expect(result.queryMeta.metric).toBe('uv');
  });
});
