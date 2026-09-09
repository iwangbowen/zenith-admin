/**
 * 键序稳定序列化 / 普通对象判定单测。排序规则被持久化指纹依赖，测试锁定其行为。
 */
import { describe, expect, it } from 'vitest';
import { getByPath, isPlainObject, stableStringify } from './json';

describe('stableStringify', () => {
  it('对象键按 localeCompare 排序，数组保序，标量与 JSON.stringify 一致', () => {
    expect(stableStringify({ b: 1, a: [3, { z: 1, y: 2 }] })).toBe('{"a":[3,{"y":2,"z":1}],"b":1}');
    expect(stableStringify({ B: 1, a: 2 })).toBe('{"a":2,"B":1}');
    expect(stableStringify(null)).toBe('null');
    expect(stableStringify('x')).toBe('"x"');
    expect(stableStringify(3)).toBe('3');
  });

  it('键序不同的等价对象产生相同结果', () => {
    expect(stableStringify({ a: 1, b: { c: 2, d: 3 } })).toBe(stableStringify({ b: { d: 3, c: 2 }, a: 1 }));
  });
});

describe('isPlainObject', () => {
  it('仅普通对象为真', () => {
    expect(isPlainObject({})).toBe(true);
    expect(isPlainObject({ a: 1 })).toBe(true);
    expect(isPlainObject([])).toBe(false);
    expect(isPlainObject(null)).toBe(false);
    expect(isPlainObject('s')).toBe(false);
  });
});

describe('getByPath', () => {
  const source = { data: { items: [{ name: 'a' }, { name: 'b' }], total: 2 } };

  it('空路径返回原值', () => {
    expect(getByPath(source, '')).toBe(source);
    expect(getByPath(source, null)).toBe(source);
    expect(getByPath(source, undefined)).toBe(source);
  });

  it('按点分段读取，数组可用下标段，段两端空白被忽略', () => {
    expect(getByPath(source, 'data.items')).toEqual([{ name: 'a' }, { name: 'b' }]);
    expect(getByPath(source, 'data.items.1.name')).toBe('b');
    expect(getByPath(source, 'data. total ')).toBe(2);
  });

  it('中途遇到缺失键或标量返回 undefined', () => {
    expect(getByPath(source, 'data.missing.x')).toBeUndefined();
    expect(getByPath(source, 'data.items.0.name.length')).toBeUndefined();
    expect(getByPath(null, 'a')).toBeUndefined();
  });
});
