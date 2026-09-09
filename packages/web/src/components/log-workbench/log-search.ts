import { escapeRegExp } from '@zenith/shared/core';
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

export interface SearchOptions {
  /** 按正则表达式解释关键词（无效正则返回 null） */
  regex?: boolean;
  /** 区分大小写 */
  caseSensitive?: boolean;
}

/** 把关键词编译为全局匹配正则；空关键词或无效正则返回 null */
export function compileSearchPattern(keyword: string, options: SearchOptions = {}): RegExp | null {
  const normalized = keyword.trim();
  if (!normalized) return null;
  const flags = options.caseSensitive ? 'g' : 'gi';
  try {
    return new RegExp(options.regex ? normalized : escapeRegExp(normalized), flags);
  } catch {
    return null;
  }
}

export function findMatchRanges(line: string, pattern: RegExp | string): MatchRange[] {
  const regex = typeof pattern === 'string' ? compileSearchPattern(pattern) : pattern;
  if (!regex) return [];

  const ranges: MatchRange[] = [];
  for (const match of line.matchAll(regex)) {
    // 跳过零宽匹配（如 /a*/ 可匹配空串），matchAll 自身会推进游标不会死循环
    if (match[0].length === 0) continue;
    const start = match.index ?? 0;
    ranges.push({ start, end: start + match[0].length });
  }
  return ranges;
}

/** 一次遍历构建搜索索引：导航用扁平列表 + 高亮用按行区间 Map */
export function buildSearchIndex(lines: string[], pattern: RegExp | string | null): SearchIndex {
  const regex = typeof pattern === 'string' ? compileSearchPattern(pattern) : pattern;
  if (!regex) return EMPTY_INDEX;

  const matches: SearchMatch[] = [];
  const lineRanges = new Map<number, MatchRange[]>();
  lines.forEach((line, lineIndex) => {
    const ranges = findMatchRanges(line, regex);
    if (ranges.length === 0) return;
    lineRanges.set(lineIndex, ranges);
    ranges.forEach((range, matchIndex) => {
      matches.push({ lineIndex, matchIndex, ...range });
    });
  });
  return { matches, lineRanges };
}

/** NDJSON 行（应用日志）：pino 的数字级别固定是行首第一个键（10=trace … 60=fatal） */
const NDJSON_LEVEL_RE = /^\{"level":(10|20|30|40|50|60)\b/;
const NDJSON_LEVEL_MAP: Record<string, LogLevel> = {
  10: 'debug', 20: 'debug', 30: 'info', 40: 'warn', 50: 'error', 60: 'error',
};
const BRACKET_LEVEL_RE = /\[(error|fatal|warn|warning|info|debug|trace)\]/i;
const WORD_LEVEL_RE = /\b(ERROR|FATAL|WARN|WARNING|INFO|DEBUG|TRACE)\b/;

function normalizeLevel(raw: string): LogLevel {
  const value = raw.toLowerCase();
  if (value === 'fatal' || value === 'error') return 'error';
  if (value === 'warn' || value === 'warning') return 'warn';
  if (value === 'trace' || value === 'debug') return 'debug';
  return 'info';
}

/**
 * 检测单行日志级别：
 * NDJSON 行首数字 level 键（应用日志）→ [level] 标记 → 全大写级别单词（http-traffic 等文本日志）
 */
export function detectLogLevel(line: string): LogLevel | null {
  const ndjson = NDJSON_LEVEL_RE.exec(line);
  if (ndjson) return NDJSON_LEVEL_MAP[ndjson[1]];
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
