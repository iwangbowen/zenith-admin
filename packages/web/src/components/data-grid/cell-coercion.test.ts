import { describe, expect, it } from 'vitest';
import { coerceCellInput, editorTextForValue, normalizeSmartQuotes, valuesEqual } from './cell-coercion';

describe('coerceCellInput', () => {
  it('NULL 关键字（任意大小写）→ null', () => {
    expect(coerceCellInput('NULL', { kind: 'text', original: 'x' })).toEqual({ ok: true, value: null });
    expect(coerceCellInput('null', { kind: 'int', original: 1 })).toEqual({ ok: true, value: null });
  });

  it('非空列输入 NULL 报错', () => {
    const r = coerceCellInput('NULL', { kind: 'text', original: 'x', nullable: false });
    expect(r.ok).toBe(false);
  });

  it('空串 + 原值 null → 保持 null（dbx 语义）', () => {
    expect(coerceCellInput('', { kind: 'int', original: null })).toEqual({ ok: true, value: null });
  });

  it('空串 + 文本列 → 空字符串（与 NULL 区分）', () => {
    expect(coerceCellInput('', { kind: 'text', original: 'abc' })).toEqual({ ok: true, value: '' });
  });

  it('整数：合法转数字，非法报错', () => {
    expect(coerceCellInput('42', { kind: 'int', original: 1 })).toEqual({ ok: true, value: 42 });
    expect(coerceCellInput('-7', { kind: 'int', original: 1 })).toEqual({ ok: true, value: -7 });
    expect(coerceCellInput('3.5', { kind: 'int', original: 1 }).ok).toBe(false);
    expect(coerceCellInput('abc', { kind: 'int', original: 1 }).ok).toBe(false);
  });

  it('超大整数保留为字符串防精度丢失', () => {
    const r = coerceCellInput('92233720368547758070', { kind: 'int', original: 1 });
    expect(r).toEqual({ ok: true, value: '92233720368547758070' });
  });

  it('数字：小数合法，NaN 报错', () => {
    expect(coerceCellInput('3.14', { kind: 'number', original: 0 })).toEqual({ ok: true, value: 3.14 });
    expect(coerceCellInput('1e3', { kind: 'number', original: 0 })).toEqual({ ok: true, value: 1000 });
    expect(coerceCellInput('x', { kind: 'number', original: 0 }).ok).toBe(false);
  });

  it('布尔：true/1/t 与 false/0/f', () => {
    expect(coerceCellInput('true', { kind: 'bool', original: false })).toEqual({ ok: true, value: true });
    expect(coerceCellInput('1', { kind: 'bool', original: false })).toEqual({ ok: true, value: true });
    expect(coerceCellInput('F', { kind: 'bool', original: true })).toEqual({ ok: true, value: false });
    expect(coerceCellInput('maybe', { kind: 'bool', original: true }).ok).toBe(false);
  });

  it('JSON：解析对象；弯引号自动标准化（dbx 智能引号）', () => {
    expect(coerceCellInput('{"a":1}', { kind: 'json', original: null })).toEqual({ ok: true, value: { a: 1 } });
    const smart = coerceCellInput('{\u201ca\u201d: 1}', { kind: 'json', original: null });
    expect(smart).toEqual({ ok: true, value: { a: 1 } });
    expect(coerceCellInput('{bad', { kind: 'json', original: null }).ok).toBe(false);
  });

  it('日期时间：校验格式并补秒', () => {
    expect(coerceCellInput('2026-03-23 14:30', { kind: 'datetime', original: null }))
      .toEqual({ ok: true, value: '2026-03-23 14:30:00' });
    expect(coerceCellInput('2026-03-23T14:30:05', { kind: 'datetime', original: null }))
      .toEqual({ ok: true, value: '2026-03-23 14:30:05' });
    expect(coerceCellInput('2026-3-1', { kind: 'datetime', original: null }).ok).toBe(false);
    expect(coerceCellInput('2026-03-23', { kind: 'date', original: null })).toEqual({ ok: true, value: '2026-03-23' });
    expect(coerceCellInput('14:30', { kind: 'time', original: null })).toEqual({ ok: true, value: '14:30:00' });
  });
});

describe('editorTextForValue', () => {
  it('null → 空串；对象 → JSON；布尔 → true/false', () => {
    expect(editorTextForValue(null, 'text')).toBe('');
    expect(editorTextForValue({ a: 1 }, 'text')).toBe('{"a":1}');
    expect(editorTextForValue(true, 'bool')).toBe('true');
  });
  it('json 类型使用缩进格式', () => {
    expect(editorTextForValue({ a: 1 }, 'json')).toBe('{\n  "a": 1\n}');
  });
});

describe('normalizeSmartQuotes', () => {
  it('弯引号替换为直引号', () => {
    expect(normalizeSmartQuotes('\u201cx\u201d\u2018y\u2019')).toBe('"x"\'y\'');
  });
});

describe('valuesEqual', () => {
  it('null/undefined 等价；对象深比较', () => {
    expect(valuesEqual(null, undefined)).toBe(true);
    expect(valuesEqual({ a: 1 }, { a: 1 })).toBe(true);
    expect(valuesEqual({ a: 1 }, { a: 2 })).toBe(false);
    expect(valuesEqual(1, '1')).toBe(false);
  });
});
