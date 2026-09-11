import { describe, expect, it } from 'vitest';
import { buildDemoPdf } from './pdf';

describe('buildDemoPdf', () => {
  it('生成交叉引用偏移正确的最小 PDF，非 ASCII 字符降级为 ?', () => {
    const bytes = buildDemoPdf(['Zenith Demo', '审批单 #1 (test)']);
    const text = new TextDecoder().decode(bytes);
    expect(text.startsWith('%PDF-1.4')).toBe(true);
    expect(text).toContain('(??? #1 \\(test\\)) Tj');
    const startxref = Number(/startxref\n(\d+)/.exec(text)![1]);
    expect(text.slice(startxref, startxref + 4)).toBe('xref');
    const offsets = [...text.matchAll(/^(\d{10}) 00000 n /gm)].map((m) => Number(m[1]));
    expect(offsets).toHaveLength(5);
    offsets.forEach((offset, index) => {
      expect(text.slice(offset, offset + `${index + 1} 0 obj`.length)).toBe(`${index + 1} 0 obj`);
    });
  });
});
