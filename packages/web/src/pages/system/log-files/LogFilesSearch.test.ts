import { describe, expect, it } from 'vitest';
import { buildSearchMatchMap, findMatchRanges } from './logFilesSearch';

describe('log file search helpers', () => {
  it('finds all case-insensitive match ranges in one line', () => {
    expect(findMatchRanges('ERROR 500 at ERROR retry', 'error')).toEqual([
      { start: 0, end: 5 },
      { start: 13, end: 18 },
    ]);
  });

  it('builds navigation indexes for matching lines', () => {
    expect(buildSearchMatchMap([
      'INFO start',
      'WARN error here',
      'ERROR error again',
      'INFO done',
    ], 'error')).toEqual([
      { lineIndex: 1, matchIndex: 0, start: 5, end: 10 },
      { lineIndex: 2, matchIndex: 0, start: 0, end: 5 },
      { lineIndex: 2, matchIndex: 1, start: 6, end: 11 },
    ]);
  });
});
