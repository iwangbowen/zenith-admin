import { describe, expect, it } from 'vitest';
import { columnKind, copyValue, displayValue } from './grid-format';

describe('columnKind', () => {
  it('识别常见 PG 类型', () => {
    expect(columnKind('boolean')).toBe('bool');
    expect(columnKind('integer')).toBe('int');
    expect(columnKind('bigint')).toBe('int');
    expect(columnKind('numeric')).toBe('number');
    expect(columnKind('double precision')).toBe('number');
    expect(columnKind('jsonb')).toBe('json');
    expect(columnKind('timestamp without time zone')).toBe('datetime');
    expect(columnKind('date')).toBe('date');
    expect(columnKind('uuid')).toBe('uuid');
    expect(columnKind('character varying')).toBe('text');
    expect(columnKind(undefined)).toBe('text');
  });
});

describe('displayValue / copyValue', () => {
  it('NULL 显示为空串', () => {
    expect(displayValue(null, 'text')).toBe('');
    expect(copyValue(undefined)).toBe('');
  });

  it('对象序列化为 JSON', () => {
    expect(displayValue({ a: 1 }, 'json')).toBe('{"a":1}');
  });

  it('布尔输出 true/false', () => {
    expect(displayValue(true, 'bool')).toBe('true');
    expect(displayValue(false, 'bool')).toBe('false');
  });

  it('datetime 类型统一格式化为 YYYY-MM-DD HH:mm:ss', () => {
    expect(displayValue('2026-03-23T14:30:00.000Z', 'datetime')).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
    expect(displayValue('2026-03-23 14:30:00', 'datetime')).toBe('2026-03-23 14:30:00');
  });

  it('非 ISO 字符串原样返回', () => {
    expect(displayValue('hello', 'datetime')).toBe('hello');
  });
});
