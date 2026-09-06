/**
 * 跨域纯函数单测：数值比较算子、百分比、正整数 ID 归一化、凭据打码。
 * 期望值取自迁移前各域的历史实现输出（golden），保证上移 shared 后行为不变。
 */
import { describe, expect, it } from 'vitest';
import { compareNumber, NUMERIC_COMPARE_OPS } from './compare';
import { isPositiveInt, percentOf, uniquePositiveInts } from './math';
import { maskSecret, SECRET_PLACEHOLDER, REDACTED_TEXT } from './sensitive';

describe('compareNumber', () => {
  it('六种算子与历史 switch 实现逐一对应', () => {
    expect(compareNumber(5, 'gt', 3)).toBe(true);
    expect(compareNumber(3, 'gt', 3)).toBe(false);
    expect(compareNumber(3, 'gte', 3)).toBe(true);
    expect(compareNumber(2, 'lt', 3)).toBe(true);
    expect(compareNumber(3, 'lt', 3)).toBe(false);
    expect(compareNumber(3, 'lte', 3)).toBe(true);
    expect(compareNumber(3, 'eq', 3)).toBe(true);
    expect(compareNumber(3, 'eq', 4)).toBe(false);
    expect(compareNumber(3, 'neq', 4)).toBe(true);
    expect(compareNumber(3, 'neq', 3)).toBe(false);
  });

  it('未知算子 fail-closed', () => {
    expect(compareNumber(1, 'between' as never, 1)).toBe(false);
    expect(NUMERIC_COMPARE_OPS).toEqual(['gt', 'gte', 'lt', 'lte', 'eq', 'neq']);
  });
});

describe('percentOf', () => {
  it('默认保留 1 位小数，与 Math.round(ratio * 1000) / 10 完全一致', () => {
    const samples: Array<[number, number]> = [[1, 3], [2, 3], [7, 9], [29, 100], [1, 7], [999, 1000], [0, 5], [5, 5]];
    for (const [part, total] of samples) {
      expect(percentOf(part, total)).toBe(Math.round((part / total) * 1000) / 10);
    }
  });

  it('分母为 0 / 负数 / 非有限数返回 null，由调用方决定空值', () => {
    expect(percentOf(3, 0)).toBeNull();
    expect(percentOf(3, -1)).toBeNull();
    expect(percentOf(Number.NaN, 10)).toBeNull();
    expect(percentOf(3, Number.POSITIVE_INFINITY)).toBeNull();
    expect(percentOf(3, 0) ?? 0).toBe(0);
  });

  it('可指定小数位数', () => {
    expect(percentOf(1, 3, 0)).toBe(33);
    expect(percentOf(1, 3, 2)).toBe(33.33);
  });
});

describe('uniquePositiveInts', () => {
  it('过滤非正整数、去重并保持首次出现顺序', () => {
    expect(uniquePositiveInts([3, 1, 3, 0, -2, 2.5, 1, 7])).toEqual([3, 1, 7]);
  });

  it('接受数字字符串（Number 转换），拒绝 null / undefined / 空串 / NaN', () => {
    expect(uniquePositiveInts(['8', 8, '9', null, undefined, '', 'abc', ' 10 '])).toEqual([8, 9, 10]);
  });

  it('空输入返回空数组', () => {
    expect(uniquePositiveInts(null)).toEqual([]);
    expect(uniquePositiveInts(undefined)).toEqual([]);
    expect(uniquePositiveInts([])).toEqual([]);
  });

  it('isPositiveInt 只认数字类型的正整数', () => {
    expect(isPositiveInt(1)).toBe(true);
    expect(isPositiveInt(0)).toBe(false);
    expect(isPositiveInt(1.5)).toBe(false);
    expect(isPositiveInt('1')).toBe(false);
  });
});

describe('maskSecret', () => {
  it('默认保留头 4 尾 4，中间 ****（Webhook 订阅密钥口径）', () => {
    expect(maskSecret('whsec_1234567890abcdef')).toBe('whse****cdef');
  });

  it('长度不足以保留头尾时整体输出 short（默认与 filler 相同）', () => {
    expect(maskSecret('12345678')).toBe('****');
    expect(maskSecret('short', { filler: '...', short: SECRET_PLACEHOLDER })).toBe('******');
  });

  it('API Key 口径：头 4 + ... + 尾 4', () => {
    expect(maskSecret('sk-live-abcdef123456', { filler: '...' })).toBe('sk-l...3456');
  });

  it('AccessKey 口径：头 4 + ****** + 尾 4', () => {
    expect(maskSecret('LTAI5tABCDEFGHIJKLMN', { filler: SECRET_PLACEHOLDER })).toBe('LTAI******KLMN');
  });

  it('可只保留头部（tail = 0）', () => {
    expect(maskSecret('123456789:AAHfakeTokenValue', { head: 12, tail: 0, filler: '••••' })).toBe('123456789:AA••••');
    expect(maskSecret('tooshort', { head: 12, tail: 0, filler: '••••' })).toBe('••••');
  });

  it('按码点切分，不会切开代理对', () => {
    expect(maskSecret('😀😀😀😀😀😀😀😀😀', { head: 2, tail: 2 })).toBe('😀😀****😀😀');
  });

  it('SECRET_PLACEHOLDER 与 REDACTED_TEXT 同值', () => {
    expect(SECRET_PLACEHOLDER).toBe(REDACTED_TEXT);
    expect(SECRET_PLACEHOLDER).toBe('******');
  });
});
