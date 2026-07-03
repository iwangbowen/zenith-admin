import { describe, expect, it } from 'vitest';
import { buildSheetXml } from './xlsx-write';

describe('buildSheetXml', () => {
  it('表头 + 数字/字符串/布尔/NULL 单元格', () => {
    const xml = buildSheetXml(['id', 'name', 'ok'], [
      [1, 'Alice', true],
      [2, null, false],
    ]);
    expect(xml).toContain('<row r="1">');
    expect(xml).toContain('<c r="A1" t="inlineStr"><is><t xml:space="preserve">id</t></is></c>');
    expect(xml).toContain('<c r="A2"><v>1</v></c>');
    expect(xml).toContain('<c r="C2" t="b"><v>1</v></c>');
    expect(xml).toContain('<c r="B3"/>');
  });

  it('XML 特殊字符转义与控制字符剔除', () => {
    const xml = buildSheetXml(['t'], [['a<b>&"c\u0001']]);
    expect(xml).toContain('a&lt;b&gt;&amp;&quot;c');
    expect(xml).not.toContain('\u0001');
  });

  it('对象序列化为 JSON 字符串', () => {
    const xml = buildSheetXml(['j'], [[{ a: 1 }]]);
    expect(xml).toContain('{&quot;a&quot;:1}');
  });

  it('超过 26 列使用双字母列名', () => {
    const headers = Array.from({ length: 28 }, (_, i) => `c${i}`);
    const xml = buildSheetXml(headers, []);
    expect(xml).toContain('<c r="AA1"');
    expect(xml).toContain('<c r="AB1"');
  });
});
