export type LogLevel = 'error' | 'warn' | 'info' | 'debug';

export interface MatchRange {
  start: number;
  end: number;
}

export interface SearchMatch extends MatchRange {
  lineIndex: number;
  matchIndex: number;
}

export interface SearchIndex {
  /** 扁平匹配列表，用于「上一个/下一个」导航与计数 */
  matches: SearchMatch[];
  /** 行号 → 该行所有匹配区间，用于渲染期高亮（避免重复跑正则） */
  lineRanges: Map<number, MatchRange[]>;
}

const EMPTY_INDEX: SearchIndex = { matches: [], lineRanges: new Map() };

export function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`);
}

export function findMatchRanges(line: string, keyword: string): MatchRange[] {
  const normalizedKeyword = keyword.trim();
  if (!normalizedKeyword) return [];

  const regex = new RegExp(escapeRegExp(normalizedKeyword), 'gi');
  return Array.from(line.matchAll(regex), (match) => {
    const start = match.index ?? 0;
    return { start, end: start + match[0].length };
  });
}

/** 一次遍历构建搜索索引：导航用扁平列表 + 高亮用按行区间 Map */
export function buildSearchIndex(lines: string[], keyword: string): SearchIndex {
  const normalizedKeyword = keyword.trim();
  if (!normalizedKeyword) return EMPTY_INDEX;

  const matches: SearchMatch[] = [];
  const lineRanges = new Map<number, MatchRange[]>();
  lines.forEach((line, lineIndex) => {
    const ranges = findMatchRanges(line, normalizedKeyword);
    if (ranges.length === 0) return;
    lineRanges.set(lineIndex, ranges);
    ranges.forEach((range, matchIndex) => {
      matches.push({ lineIndex, matchIndex, ...range });
    });
  });
  return { matches, lineRanges };
}

const BRACKET_LEVEL_RE = /\[(error|fatal|warn|warning|info|debug|trace)\]/i;
const WORD_LEVEL_RE = /\b(ERROR|FATAL|WARN|WARNING|INFO|DEBUG|TRACE)\b/;

function normalizeLevel(raw: string): LogLevel {
  const value = raw.toLowerCase();
  if (value === 'fatal' || value === 'error') return 'error';
  if (value === 'warn' || value === 'warning') return 'warn';
  if (value === 'trace' || value === 'debug') return 'debug';
  return 'info';
}

/** 检测单行日志级别：优先匹配 [level] 标记，回退到全大写级别单词 */
export function detectLogLevel(line: string): LogLevel | null {
  const bracket = BRACKET_LEVEL_RE.exec(line);
  if (bracket) return normalizeLevel(bracket[1]);
  const word = WORD_LEVEL_RE.exec(line);
  if (word) return normalizeLevel(word[1]);
  return null;
}

/** 每行的有效级别：无级别标记的行（堆栈/续行）继承上一个有级别行的级别 */
export function computeEffectiveLevels(lines: string[]): Array<LogLevel | null> {
  let current: LogLevel | null = null;
  return lines.map((line) => {
    const detected = detectLogLevel(line);
    if (detected) current = detected;
    return detected ?? current;
  });
}
