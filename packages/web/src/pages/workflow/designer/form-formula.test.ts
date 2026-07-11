import { describe, it, expect } from 'vitest';
import { evalFormula } from './form-formula';

describe('evalFormula 基础计算', () => {
  it('计算简单四则与字段引用', () => {
    expect(evalFormula('{a} + {b} * 2', { a: 1, b: 3 })).toBe(7);
    expect(evalFormula('({a} + {b}) / 2', { a: 1, b: 3 })).toBe(2);
  });

  it('SUM/AVG/MAX/MIN/COUNT 支持明细列引用', () => {
    const values = { items: [{ price: 10 }, { price: 20 }, { price: 30 }] };
    expect(evalFormula('SUM({items.price})', values)).toBe(60);
    expect(evalFormula('AVG({items.price})', values)).toBe(20);
    expect(evalFormula('MAX({items.price})', values)).toBe(30);
    expect(evalFormula('MIN({items.price})', values)).toBe(10);
    expect(evalFormula('COUNT({items.price})', values)).toBe(3);
  });

  it('明细引用不存在/非数组时聚合为空集', () => {
    expect(evalFormula('SUM({items.price})', { items: null })).toBe(0);
    expect(evalFormula('COUNT({items.price})', {})).toBe(0);
  });

  it('IF/AND/OR/NOT 逻辑函数', () => {
    expect(evalFormula('IF({a} > 10, 100, 200)', { a: 20 })).toBe(100);
    expect(evalFormula('IF(AND({a} > 0, {b} > 0), 1, 0)', { a: 1, b: -1 })).toBe(0);
    expect(evalFormula('IF(OR({a} > 0, {b} > 0), 1, 0)', { a: 1, b: -1 })).toBe(1);
    expect(evalFormula('IF(NOT({a} > 0), 1, 0)', { a: 1 })).toBe(0);
  });

  it('文本函数返回字符串', () => {
    expect(evalFormula('CONCAT({a}, "-", {b})', { a: 'x', b: 'y' })).toBe('x-y');
    expect(evalFormula('UPPER({s})', { s: 'ab' })).toBe('AB');
    expect(evalFormula('LEN({s})', { s: 'hello' })).toBe(5);
    expect(evalFormula('LEFT({s}, 2)', { s: 'hello' })).toBe('he');
  });

  it('ROUND 与 precision 舍入', () => {
    expect(evalFormula('ROUND({a}, 1)', { a: 1.25 })).toBe(1.3);
    expect(evalFormula('{a} / {b}', { a: 10, b: 3 }, 2)).toBe(3.33);
    expect(evalFormula('{a} / {b}', { a: 10, b: 3 }, 0)).toBe(3);
  });

  it('DATEDIF 计算日期差', () => {
    expect(evalFormula('DATEDIF({start}, {end}, "d")', { start: '2026-01-01', end: '2026-01-11' })).toBe(10);
    expect(evalFormula('DATEDIF({start}, {end}, "m")', { start: '2026-01-01', end: '2026-04-01' })).toBe(3);
  });

  it('字符串数字自动强转参与计算', () => {
    expect(evalFormula('{a} + {b}', { a: '1', b: '2' })).toBe(3);
  });
});

describe('evalFormula 边界与安全', () => {
  it('空公式 / 不可计算返回 null', () => {
    expect(evalFormula('', {})).toBeNull();
    expect(evalFormula('   ', {})).toBeNull();
    expect(evalFormula('{a} / {b}', { a: 1, b: 0 })).toBeNull(); // Infinity → null
    expect(evalFormula('{missing} + 1', {})).toBeNull(); // NaN → null
  });

  it('拒绝白名单外的标识符（防注入）', () => {
    expect(evalFormula('alert(1)', {})).toBeNull();
    expect(evalFormula('window.location', {})).toBeNull();
    expect(evalFormula('constructor("return 1")()', {})).toBeNull();
    expect(evalFormula('SUM({a}) + fetch("x")', { a: 1 })).toBeNull();
  });

  it('拒绝非法字符', () => {
    expect(evalFormula('{a} + `x`', { a: 1 })).toBeNull();
    expect(evalFormula('{a}; 1', { a: 1 })).toBeNull();
  });

  it('字符串字面量中的可疑词不误伤', () => {
    expect(evalFormula('CONCAT("alert", {a})', { a: '!' })).toBe('alert!');
  });

  it('语法错误返回 null 而不抛异常', () => {
    expect(evalFormula('SUM({a},', { a: 1 })).toBeNull();
    expect(evalFormula('(((', {})).toBeNull();
  });
});
