import { describe, expect, it } from 'vitest';
import { hasAnsi, parseAnsi, stripAnsi } from './ansi';

describe('ansi helpers', () => {
  it('stripAnsi removes SGR sequences and leaves plain text untouched', () => {
    expect(stripAnsi('\x1b[31mERROR\x1b[0m boom')).toBe('ERROR boom');
    const plain = 'plain line';
    expect(stripAnsi(plain)).toBe(plain);
    expect(hasAnsi(plain)).toBe(false);
  });

  it('parseAnsi splits into styled spans whose text concatenates to the stripped line', () => {
    const raw = '\x1b[1;31mERROR\x1b[0m boom \x1b[92mok\x1b[39m';
    const spans = parseAnsi(raw);
    expect(spans.map((s) => s.text).join('')).toBe(stripAnsi(raw));
    expect(spans[0]).toMatchObject({ text: 'ERROR', bold: true, color: '#c0392b' });
    expect(spans[1]).toEqual({ text: ' boom ' });
    expect(spans[2]).toMatchObject({ text: 'ok', color: '#2ecc71' });
  });

  it('parseAnsi resets attributes on code 0 and handles background colors', () => {
    const spans = parseAnsi('\x1b[44mbg\x1b[0mplain');
    expect(spans[0]).toMatchObject({ text: 'bg', bg: '#2980b9' });
    expect(spans[1]).toEqual({ text: 'plain' });
  });
});
