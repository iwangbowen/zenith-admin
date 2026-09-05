import { describe, it, expect, expectTypeOf } from 'vitest';
import * as z from 'zod';
import { dateRangeBound, paginated, paginationQuery, queryBool, queryEnum } from './api-schemas';

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
});

describe('paginationQuery / dateRangeBound', () => {
  it('applies pagination defaults and accepts both date formats', () => {
    expect(paginationQuery.parse({})).toEqual({ page: 1, pageSize: 10 });
    const range = z.object({ startTime: dateRangeBound('起点') });
    expect(range.parse({ startTime: '2026-09-01' })).toEqual({ startTime: '2026-09-01' });
    expect(range.parse({ startTime: '2026-09-01 08:00:00' })).toEqual({ startTime: '2026-09-01 08:00:00' });
    expect(range.safeParse({ startTime: 'yesterday' }).success).toBe(false);
  });

  it('wraps items into the paginated payload shape', () => {
    const page = paginated(z.object({ id: z.int() }));
    expect(page.parse({ list: [{ id: 1 }], total: 1, page: 1, pageSize: 10 })).toEqual({ list: [{ id: 1 }], total: 1, page: 1, pageSize: 10 });
  });
});
