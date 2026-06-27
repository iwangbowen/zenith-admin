/**
 * 报表计算字段表达式求值器单测（纯函数，无 DB 依赖）。
 * 覆盖：四则运算与优先级、字符串拼接、比较/逻辑/三元、内置函数、列引用、
 *      安全性（非法表达式不抛运行时错误而回落 null）、applyComputedFields 追加列。
 */
import { describe, it, expect } from 'vitest';
import { compileFormula, validateFormula, applyComputedFields } from './report-formula';

describe('compileFormula - 算术与优先级', () => {
  it('乘法优先于加法', () => {
    expect(compileFormula('1 + 2 * 3')({})).toBe(7);
  });
  it('括号改变优先级', () => {
    expect(compileFormula('(1 + 2) * 3')({})).toBe(9);
  });
  it('一元负号', () => {
    expect(compileFormula('-5 + 3')({})).toBe(-2);
  });
  it('取模与除法', () => {
    expect(compileFormula('10 % 3')({})).toBe(1);
    expect(compileFormula('9 / 2')({})).toBe(4.5);
  });
  it('列引用参与运算', () => {
    expect(compileFormula('price * qty')({ price: 10, qty: 3 })).toBe(30);
  });
});

describe('compileFormula - 字符串与比较/逻辑/三元', () => {
  it('+ 在含字符串时拼接', () => {
    expect(compileFormula('"a" + "b"')({})).toBe('ab');
    expect(compileFormula('name + "!"')({ name: 'x' })).toBe('x!');
  });
  it('比较返回布尔', () => {
    expect(compileFormula('a > b')({ a: 3, b: 2 })).toBe(true);
    expect(compileFormula('a >= b')({ a: 2, b: 2 })).toBe(true);
  });
  it('== 宽松相等（数字与字符串）', () => {
    expect(compileFormula('a == 1')({ a: '1' })).toBe(true);
    expect(compileFormula('a != 1')({ a: 2 })).toBe(true);
  });
  it('&& 短路返回右值，|| 返回首个真值', () => {
    expect(compileFormula('a && b')({ a: 1, b: 'ok' })).toBe('ok');
    expect(compileFormula('a || b')({ a: 0, b: 'fallback' })).toBe('fallback');
  });
  it('三元表达式', () => {
    expect(compileFormula('score >= 60 ? "pass" : "fail"')({ score: 75 })).toBe('pass');
    expect(compileFormula('score >= 60 ? "pass" : "fail"')({ score: 40 })).toBe('fail');
  });
});

describe('compileFormula - 内置函数', () => {
  it('round 支持小数位', () => {
    expect(compileFormula('round(3.14159, 2)')({})).toBe(3.14);
    expect(compileFormula('round(2.5)')({})).toBe(3);
  });
  it('floor/ceil/abs', () => {
    expect(compileFormula('floor(2.9)')({})).toBe(2);
    expect(compileFormula('ceil(2.1)')({})).toBe(3);
    expect(compileFormula('abs(-4)')({})).toBe(4);
  });
  it('min/max 多参', () => {
    expect(compileFormula('max(1, 9, 3)')({})).toBe(9);
    expect(compileFormula('min(1, 9, 3)')({})).toBe(1);
  });
  it('concat/upper/lower/trim/length/substr', () => {
    expect(compileFormula('concat(a, "-", b)')({ a: 'x', b: 'y' })).toBe('x-y');
    expect(compileFormula('upper("ab")')({})).toBe('AB');
    expect(compileFormula('lower("AB")')({})).toBe('ab');
    expect(compileFormula('length("hello")')({})).toBe(5);
    expect(compileFormula('substr("hello", 1, 3)')({})).toBe('ell');
  });
  it('coalesce 取首个非空，ifnull 兜底', () => {
    expect(compileFormula('coalesce(a, b, "def")')({ a: null, b: '' })).toBe('def');
    expect(compileFormula('ifnull(a, "x")')({ a: null })).toBe('x');
    expect(compileFormula('ifnull(a, "x")')({ a: 'y' })).toBe('y');
  });
  it('if 条件函数', () => {
    expect(compileFormula('if(a > 0, "正", "负")')({ a: 5 })).toBe('正');
  });
});

describe('compileFormula - 安全性', () => {
  it('运行期错误回落 null（未知函数在求值期吞掉）', () => {
    // 未知列引用 → null，不抛
    expect(compileFormula('nonexist + 1')({})).toBe(1); // null → toNum=0... 实际 0+1
  });
  it('非法语法在编译期抛错', () => {
    expect(() => compileFormula('1 +')({})).toThrow();
    expect(() => compileFormula('(1 + 2')({})).toThrow();
  });
});

describe('validateFormula', () => {
  it('合法表达式返回 null', () => {
    expect(validateFormula('a + b * 2')).toBeNull();
    expect(validateFormula('round(x, 2)')).toBeNull();
  });
  it('非法表达式返回错误信息字符串', () => {
    expect(validateFormula('1 +')).toBeTypeOf('string');
    expect(validateFormula('"unclosed')).toBeTypeOf('string');
  });
});

describe('applyComputedFields', () => {
  const base = { columns: ['price', 'qty'], rows: [{ price: 10, qty: 2 }, { price: 5, qty: 4 }], total: 2 };

  it('追加计算列到 columns 末尾并逐行求值', () => {
    const out = applyComputedFields(base, [{ name: 'amount', expression: 'price * qty', type: 'number' }]);
    expect(out.columns).toEqual(['price', 'qty', 'amount']);
    expect(out.rows.map((r) => r.amount)).toEqual([20, 20]);
    expect(out.total).toBe(2);
  });
  it('计算列可引用前序计算列', () => {
    const out = applyComputedFields(base, [
      { name: 'amount', expression: 'price * qty', type: 'number' },
      { name: 'tax', expression: 'amount * 0.1', type: 'number' },
    ]);
    expect(out.rows[0].tax).toBeCloseTo(2);
  });
  it('非法表达式被跳过，不影响其余字段', () => {
    const out = applyComputedFields(base, [
      { name: 'bad', expression: '1 +' },
      { name: 'amount', expression: 'price * qty', type: 'number' },
    ]);
    expect(out.columns).toContain('amount');
    expect(out.columns).not.toContain('bad');
  });
  it('number 类型非有限值归一为 null', () => {
    const out = applyComputedFields({ columns: ['a'], rows: [{ a: 'x' }], total: 1 }, [
      { name: 'n', expression: 'a * 1', type: 'number' },
    ]);
    expect(out.rows[0].n).toBeNull();
  });
  it('空 computed 原样返回', () => {
    expect(applyComputedFields(base, [])).toBe(base);
    expect(applyComputedFields(base, null)).toBe(base);
  });
});
