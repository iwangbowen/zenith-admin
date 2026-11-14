import { describe, expect, it } from 'vitest';
import { csvCell } from './csv';
describe('spreadsheet CSV values', () => {
  it.each(['=1+1', '+cmd', '-cmd', '@sum', ' 	=1+1'])('keeps %s literal', value => expect(csvCell(value)).toContain("'" + value));
  it('preserves numeric values and escapes CSV delimiters', () => {
    expect(csvCell(-12.3)).toBe('-12.3');
    const cr = String.fromCharCode(13);
    expect(csvCell('a' + cr + 'b')).toBe('"a' + cr + 'b"');
    expect(csvCell('a"b,c')).toBe('"a""b,c"');
    expect(csvCell(null)).toBe('');
  });
});
