import { describe, expect, it } from 'vitest';
import { ApiError, compactParams, compactQuery, LOOKUP_STALE_TIME, toQueryString, unwrap } from './query';

describe('unwrap', () => {
  it('code 为 0 时返回 data', () => {
    expect(unwrap({ code: 0, message: 'success', data: { id: 1 } })).toEqual({ id: 1 });
  });

  it('data 为 null 时原样返回', () => {
    expect(unwrap({ code: 0, message: 'success', data: null })).toBeNull();
  });

  it('code 非 0 时抛出 ApiError（携带 code 与 message）', () => {
    try {
      unwrap({ code: 400, message: '参数错误', data: null });
      expect.unreachable('应当抛出 ApiError');
    } catch (err) {
      expect(err).toBeInstanceOf(ApiError);
      expect((err as ApiError).code).toBe(400);
      expect((err as ApiError).message).toBe('参数错误');
      expect((err as ApiError).name).toBe('ApiError');
    }
  });

  it('message 为空时生成默认错误信息', () => {
    expect(() => unwrap({ code: 500, message: '', data: null })).toThrowError('请求失败（code=500）');
  });
});

describe('toQueryString', () => {
  it('拼接普通参数并带 ? 前缀', () => {
    expect(toQueryString({ page: 1, pageSize: 10 })).toBe('?page=1&pageSize=10');
  });

  describe('compactQuery', () => {
    it('drops empty values while preserving zero and false', () => {
      expect(compactQuery({
        keyword: '',
        status: undefined,
        page: 0,
        enabled: false,
        channel: 'wechat',
      })).toEqual({
        page: 0,
        enabled: false,
        channel: 'wechat',
      });
    });
  });

  describe('compactParams', () => {
    it('与 compactQuery 同语义：丢弃 undefined / null / 空串，保留 0 / false', () => {
      expect(compactParams({ keyword: '', status: undefined, tenantId: null, minDurationMs: 0, enabled: false, type: 'a' }))
        .toEqual({ minDurationMs: 0, enabled: false, type: 'a' });
    });

    it('保留键类型：结果可展开进带可选字段的契约查询参数', () => {
      interface ListQuery { page: number; pageSize: number; keyword?: string; status?: 'enabled' | 'disabled'; limit?: number }
      const status = 'enabled' as 'enabled' | 'disabled' | undefined;
      const filter = compactParams({ keyword: '' as string | undefined, status, limit: 0 as number | null });
      // 类型断言：filter 的键为可选且已剔除 null / ''，可与分页字段一起满足 ListQuery
      const query: ListQuery = { page: 1, pageSize: 10, ...filter };
      expect(query).toEqual({ page: 1, pageSize: 10, status: 'enabled', limit: 0 });
    });
  });

  it('过滤 undefined / null / 空字符串', () => {
    expect(toQueryString({ page: 1, keyword: '', status: undefined, type: null })).toBe('?page=1');
  });

  it('全部参数为空时返回空字符串', () => {
    expect(toQueryString({ keyword: '', status: undefined })).toBe('');
  });

  it('对特殊字符进行 URL 编码', () => {
    expect(toQueryString({ keyword: '张三&李四' })).toBe(`?keyword=${encodeURIComponent('张三&李四').replaceAll('%20', '+')}`);
  });

  it('boolean 与 number 转为字符串', () => {
    expect(toQueryString({ enabled: true, count: 0 })).toBe('?enabled=true&count=0');
  });
});

describe('LOOKUP_STALE_TIME', () => {
  it('为 5 分钟', () => {
    expect(LOOKUP_STALE_TIME).toBe(5 * 60 * 1000);
  });
});
