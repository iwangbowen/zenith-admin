import { describe, expect, it } from 'vitest';
import { hasAnsi, parseAnsi, stripAnsi } from './ansi';

describe('ansi helpers', () => {
  it('stripAnsi removes SGR sequences and leaves plain text untouched', () => {
    expect(stripAnsi('\x1b[31mERROR\x1b[0m boom')).toBe('ERROR boom');
    const plain = 'plain line';
    expect(stripAnsi(plain)).toBe(plain);
    expect(hasAnsi(plain)).toBe(false);
  });

  it('parseAnsi preserves text when splitting ANSI sequences', () => {
    const raw = '\x1b[1;31mERROR\x1b[0m boom \x1b[92mok\x1b[39m';
    const spans = parseAnsi(raw);
    expect(spans.map((s) => s.text).join('')).toBe(stripAnsi(raw));
  });
});
