import { describe, expect, it } from 'vitest';
import { buildSearchIndex, computeEffectiveLevels, detectLogLevel, findMatchRanges } from './logFilesSearch';

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
