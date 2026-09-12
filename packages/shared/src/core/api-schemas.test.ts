import { describe, it, expect, expectTypeOf } from 'vitest';
import * as z from 'zod';
import { dateRangeBound, dateRangeQuery, entityStatusQuery, idQuery, paginated, paginationQuery, queryBool, queryEnum } from './api-schemas';

describe('queryBool', () => {
  const schema = z.object({ enabled: queryBool() });

  it('parses the accepted string spellings and treats the empty string as absent', () => {
    expect(schema.parse({ enabled: 'true' })).toEqual({ enabled: true });
    expect(schema.parse({ enabled: '0' })).toEqual({ enabled: false });
    expect(schema.parse({ enabled: '' })).toEqual({ enabled: undefined });
    expect(schema.parse({})).toEqual({});
    expect(schema.safeParse({ enabled: 'maybe' }).success).toBe(false);
  });
});

describe('queryEnum', () => {
  const STATUSES = ['enabled', 'disabled'] as const;
  const schema = z.object({ status: queryEnum(STATUSES, '状态') });

  it('accepts listed values, maps the empty string to undefined and rejects others', () => {
    expect(schema.parse({ status: 'enabled' })).toEqual({ status: 'enabled' });
    expect(schema.parse({ status: '' })).toEqual({ status: undefined });
    expect(schema.parse({})).toEqual({});
    expect(schema.safeParse({ status: 'archived' }).success).toBe(false);
    expectTypeOf<z.output<typeof schema>['status']>().toEqualTypeOf<'enabled' | 'disabled' | undefined>();
  });

  it('documents the value set in OpenAPI metadata', () => {
    expect(queryEnum(STATUSES, '状态').meta()).toMatchObject({ type: 'string', enum: ['enabled', 'disabled'], description: '状态' });
  });

  it('entityStatusQuery is the shared enabled / disabled filter with empty string meaning "all"', () => {
    const schema = z.object({ status: entityStatusQuery });
    expect(schema.parse({ status: 'disabled' })).toEqual({ status: 'disabled' });
    expect(schema.parse({ status: '' })).toEqual({ status: undefined });
    expect(schema.safeParse({ status: 'archived' }).success).toBe(false);
    expectTypeOf<z.output<typeof schema>['status']>().toEqualTypeOf<'enabled' | 'disabled' | undefined>();
  });
});

describe('paginationQuery / dateRangeBound', () => {
  it('applies pagination defaults and accepts both date formats', () => {
    expect(paginationQuery.parse({})).toEqual({ page: 1, pageSize: 10 });
    const range = z.object({ startTime: dateRangeBound('起点') });
    expect(range.parse({ startTime: '2026-09-01' })).toEqual({ startTime: '2026-09-01' });
    expect(range.parse({ startTime: '2026-09-01 08:00:00' })).toEqual({ startTime: '2026-09-01 08:00:00' });
    expect(range.safeParse({ startTime: 'yesterday' }).success).toBe(false);
  });

  it('dateRangeQuery 展开为标准 startTime / endTime 端点，描述随 subject 生成', () => {
    const query = paginationQuery.extend({ ...dateRangeQuery('创建时间') });
    expect(query.parse({ startTime: '2026-09-01', endTime: '2026-09-30 23:59:59' })).toEqual({ page: 1, pageSize: 10, startTime: '2026-09-01', endTime: '2026-09-30 23:59:59' });
    expect(query.safeParse({ endTime: 'tomorrow' }).success).toBe(false);
    expect(query.shape.startTime.meta()?.description).toBe('创建时间起');
    expect(query.shape.endTime.meta()?.description).toBe('创建时间止');
    const generic = dateRangeQuery();
    expect(generic.startTime.meta()?.description).toBe('起始时间');
    expect(generic.endTime.meta()?.description).toBe('结束时间');
  });

  it('idQuery：查询串关联 ID 可选、字符串 coerce 为正整数，非法值 400', () => {
    const query = z.object({ channelId: idQuery('栏目'), taskId: idQuery() });
    expect(query.parse({})).toEqual({});
    expect(query.parse({ channelId: '12', taskId: 3 })).toEqual({ channelId: 12, taskId: 3 });
    expect(query.safeParse({ channelId: '0' }).success).toBe(false);
    expect(query.safeParse({ taskId: 'abc' }).success).toBe(false);
    expect(query.shape.channelId.meta()?.description).toBe('栏目');
    expect(query.shape.taskId.meta()).toBeUndefined();
  });

  it('wraps items into the paginated payload shape', () => {
    const page = paginated(z.object({ id: z.int() }));
    expect(page.parse({ list: [{ id: 1 }], total: 1, page: 1, pageSize: 10 })).toEqual({ list: [{ id: 1 }], total: 1, page: 1, pageSize: 10 });
  });
});
