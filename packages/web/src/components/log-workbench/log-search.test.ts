import { describe, expect, it } from 'vitest';
import { buildSearchIndex, compileSearchPattern, computeEffectiveLevels, detectLogLevel, findMatchRanges } from './log-search';

describe('log file search helpers', () => {
  it('finds all case-insensitive match ranges in one line', () => {
    expect(findMatchRanges('ERROR 500 at ERROR retry', 'error')).toEqual([
      { start: 0, end: 5 },
      { start: 13, end: 18 },
    ]);
  });

  it('builds navigation indexes and per-line ranges for matching lines', () => {
    const { matches, lineRanges } = buildSearchIndex([
      'INFO start',
      'WARN error here',
      'ERROR error again',
      'INFO done',
    ], 'error');

    expect(matches).toEqual([
      { lineIndex: 1, matchIndex: 0, start: 5, end: 10 },
      { lineIndex: 2, matchIndex: 0, start: 0, end: 5 },
      { lineIndex: 2, matchIndex: 1, start: 6, end: 11 },
    ]);
    expect(lineRanges.get(0)).toBeUndefined();
    expect(lineRanges.get(1)).toEqual([{ start: 5, end: 10 }]);
    expect(lineRanges.get(2)).toEqual([
      { start: 0, end: 5 },
      { start: 6, end: 11 },
    ]);
  });

  it('returns an empty index for a blank keyword', () => {
    const { matches, lineRanges } = buildSearchIndex(['ERROR boom'], '   ');
    expect(matches).toEqual([]);
    expect(lineRanges.size).toBe(0);
  });
});

describe('compileSearchPattern', () => {
  it('escapes literal keywords by default and ignores case', () => {
    const pattern = compileSearchPattern('a.b');
    expect(findMatchRanges('A.B axb', pattern!)).toEqual([{ start: 0, end: 3 }]);
  });

  it('supports case-sensitive matching', () => {
    const pattern = compileSearchPattern('Error', { caseSensitive: true });
    expect(findMatchRanges('error Error ERROR', pattern!)).toEqual([{ start: 6, end: 11 }]);
  });

  it('supports regex mode', () => {
    const p = compileSearchPattern(String.raw`\berr\w+`, { regex: true });
    expect(findMatchRanges('an error and errno', p!)).toEqual([
      { start: 3, end: 8 },
      { start: 13, end: 18 },
    ]);
  });

  it('returns null for an invalid regex and search degrades to empty', () => {
    const pattern = compileSearchPattern('([', { regex: true });
    expect(pattern).toBeNull();
    expect(buildSearchIndex(['(['], pattern).matches).toEqual([]);
  });

  it('skips zero-width regex matches', () => {
    const pattern = compileSearchPattern('x*', { regex: true });
    expect(findMatchRanges('axxb', pattern!)).toEqual([{ start: 1, end: 3 }]);
  });
});

describe('log level detection', () => {
  it('detects bracketed levels case-insensitively and normalizes aliases', () => {
    expect(detectLogLevel('2026-07-18 19:12:32 [warn] [task-center] duplicated')).toBe('warn');
    expect(detectLogLevel('2026-07-18 19:12:32 [INFO] ready')).toBe('info');
    expect(detectLogLevel('[Warning] deprecated api')).toBe('warn');
    expect(detectLogLevel('[fatal] out of memory')).toBe('error');
    expect(detectLogLevel('[trace] enter fn')).toBe('debug');
  });

  it('falls back to uppercase level words and ignores lowercase noise', () => {
    expect(detectLogLevel('ERROR failed to connect')).toBe('error');
    expect(detectLogLevel('an error occurred in handler')).toBeNull();
    expect(detectLogLevel('plain line without level')).toBeNull();
  });

  it('detects levels from NDJSON app-log lines by the leading numeric level key', () => {
    expect(detectLogLevel('{"level":30,"time":"2026-08-28T13:19:18.123Z","msg":"ready"}')).toBe('info');
    expect(detectLogLevel('{"level":50,"time":"2026-08-28T13:19:18.123Z","err":{"type":"Error"}}')).toBe('error');
    expect(detectLogLevel('{"level":40,"msg":"slow query"}')).toBe('warn');
    expect(detectLogLevel('{"level":60,"msg":"oom"}')).toBe('error');
    expect(detectLogLevel('{"level":10,"msg":"enter"}')).toBe('debug');
    expect(detectLogLevel('{"level":20,"msg":"detail"}')).toBe('debug');
    // level 键不在行首（消息内容里出现同形串）不误判为该级别
    expect(detectLogLevel('{"time":"2026-08-28","msg":"saw \\"level\\":50 in payload"}')).toBeNull();
  });

  it('lets continuation lines inherit the previous level', () => {
    expect(computeEffectiveLevels([
      'no level yet',
      '[error] boom',
      '    at Object.fn (app.ts:10)',
      '[info] recovered',
      'trailing detail',
    ])).toEqual([null, 'error', 'error', 'info', 'info']);
  });
});
