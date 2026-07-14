/**
 * 表单公式引擎（扩展函数库）
 *
 * 支持：四则运算、比较/逻辑/三元，以及 数学 / 逻辑 / 文本 / 日期 四类函数，
 * 明细列引用 {明细key.列key}（解析为数组，供 SUM/AVG/COUNT 等聚合）。
 *
 * 安全模型：
 *  1) 先把所有 {引用} 替换为受控数组 R[i]，引用值作为数据传入，绝不拼进代码；
 *  2) 去掉字符串字面量后，校验剩余标识符必须是白名单函数名 / R / 布尔 / NaN；
 *  3) 再做字符白名单校验，杜绝任意 JS 注入；
 *  4) 以白名单函数为入参，通过 new Function 求值。
 */
import dayjs from 'dayjs';

// ─── 函数元信息（用于配置面板的「插入函数」助手） ──────────────────────
export interface FormulaFnMeta {
  name: string;
  insert: string;   // 点击插入的片段
  desc: string;
}
export interface FormulaFnGroup {
  group: string;
  fns: FormulaFnMeta[];
}

export const FORMULA_FN_GROUPS: FormulaFnGroup[] = [
  {
    group: '数学',
    fns: [
      { name: 'SUM', insert: 'SUM()', desc: '求和，支持明细列 SUM({明细.金额})' },
      { name: 'AVG', insert: 'AVG()', desc: '平均值' },
      { name: 'MAX', insert: 'MAX()', desc: '最大值' },
      { name: 'MIN', insert: 'MIN()', desc: '最小值' },
      { name: 'COUNT', insert: 'COUNT()', desc: '计数（有效数字个数）' },
      { name: 'ROUND', insert: 'ROUND(, 2)', desc: '四舍五入到指定小数位' },
      { name: 'ABS', insert: 'ABS()', desc: '绝对值' },
      { name: 'CEIL', insert: 'CEIL()', desc: '向上取整' },
      { name: 'FLOOR', insert: 'FLOOR()', desc: '向下取整' },
      { name: 'MOD', insert: 'MOD(, )', desc: '取余数' },
      { name: 'POWER', insert: 'POWER(, 2)', desc: '幂运算' },
      { name: 'SQRT', insert: 'SQRT()', desc: '平方根' },
    ],
  },
  {
    group: '逻辑',
    fns: [
      { name: 'IF', insert: 'IF(, , )', desc: '条件：IF(条件, 真值, 假值)' },
      { name: 'AND', insert: 'AND(, )', desc: '全部为真' },
      { name: 'OR', insert: 'OR(, )', desc: '任一为真' },
      { name: 'NOT', insert: 'NOT()', desc: '取反' },
    ],
  },
  {
    group: '文本',
    fns: [
      { name: 'CONCAT', insert: 'CONCAT(, )', desc: '拼接文本' },
      { name: 'LEN', insert: 'LEN()', desc: '文本长度' },
      { name: 'LEFT', insert: 'LEFT(, 1)', desc: '左起取 n 个字符' },
      { name: 'RIGHT', insert: 'RIGHT(, 1)', desc: '右起取 n 个字符' },
      { name: 'MID', insert: 'MID(, 1, 1)', desc: '从第 start 个起取 len 个字符' },
      { name: 'UPPER', insert: 'UPPER()', desc: '转大写' },
      { name: 'LOWER', insert: 'LOWER()', desc: '转小写' },
      { name: 'TRIM', insert: 'TRIM()', desc: '去除首尾空格' },
      { name: 'REPLACE', insert: 'REPLACE(, , )', desc: '替换文本：REPLACE(原文, 查找, 替换)' },
      { name: 'TEXT', insert: 'TEXT()', desc: '转为文本' },
    ],
  },
  {
    group: '日期',
    fns: [
      { name: 'TODAY', insert: 'TODAY()', desc: '今天（YYYY-MM-DD）' },
      { name: 'NOW', insert: 'NOW()', desc: '当前时间（YYYY-MM-DD HH:mm:ss）' },
      { name: 'YEAR', insert: 'YEAR()', desc: '取年份' },
      { name: 'MONTH', insert: 'MONTH()', desc: '取月份' },
      { name: 'DAY', insert: 'DAY()', desc: '取日' },
      { name: 'DATE', insert: 'DATE(, , )', desc: '构造日期：DATE(年, 月, 日)' },
      { name: 'DATEDIF', insert: 'DATEDIF(, , "d")', desc: '日期差：DATEDIF(起, 止, "d"|"m"|"y")' },
      { name: 'DATEADD', insert: 'DATEADD(, 1, "d")', desc: '日期加减：DATEADD(日期, n, "d"|"m"|"y")' },
      { name: 'NETWORKDAYS', insert: 'NETWORKDAYS(, )', desc: '两日期间的工作日天数（剔除周六日，含首尾）' },
    ],
  },
  {
    group: '查表/格式',
    fns: [
      { name: 'LOOKUP', insert: 'LOOKUP(, , )', desc: '查表：LOOKUP(值, 键列表, 值列表)，配合明细列使用' },
      { name: 'FORMAT', insert: 'FORMAT(, 2)', desc: '数字格式化为千分位文本：FORMAT(数值, 小数位)' },
      { name: 'ISEMPTY', insert: 'ISEMPTY()', desc: '是否为空（空值/空串/空数组返回真）' },
    ],
  },
];

const FUNC_NAMES = FORMULA_FN_GROUPS.flatMap((g) => g.fns.map((f) => f.name));
const FUNC_SET = new Set(FUNC_NAMES);

export const FORMULA_FUNCTION_NAMES: readonly string[] = FUNC_NAMES;

// ─── 引用解析与归一化 ────────────────────────────────────────────────
function resolveFormulaRef(values: Record<string, unknown>, ref: string): unknown {
  const trimmed = ref.trim();
  const dot = trimmed.indexOf('.');
  if (dot >= 0) {
    const detailKey = trimmed.slice(0, dot);
    const colKey = trimmed.slice(dot + 1);
    const rows = values[detailKey];
    if (Array.isArray(rows)) {
      return rows.map((r) => (r && typeof r === 'object' ? (r as Record<string, unknown>)[colKey] : undefined));
    }
    return [];
  }
  return values[trimmed];
}

function coerceScalar(v: unknown): number | string {
  if (v === null || v === undefined || v === '') return NaN;
  if (typeof v === 'number') return v;
  if (typeof v === 'boolean') return v ? 1 : 0;
  if (v instanceof Date) return dayjs(v).format('YYYY-MM-DD HH:mm:ss');
  const s = String(v);
  const n = Number(s);
  return s.trim() !== '' && Number.isFinite(n) ? n : s;
}

function normalizeRef(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(coerceScalar);
  return coerceScalar(v);
}

// ─── 函数实现 ────────────────────────────────────────────────────────
const flattenNums = (args: unknown[]): number[] =>
  args.flatMap((a) => (Array.isArray(a) ? a : [a])).map((x) => Number(x)).filter((x) => Number.isFinite(x));

const toStr = (x: unknown): string =>
  x === null || x === undefined || (typeof x === 'number' && !Number.isFinite(x)) ? '' : String(x);

const toDay = (x: unknown) => dayjs(typeof x === 'number' ? x : toStr(x));
const pad2 = (n: number) => String(n).padStart(2, '0');

type AnyFn = (...args: never[]) => unknown;
const fn = (f: (...args: unknown[]) => unknown): AnyFn => f as AnyFn;

const FORMULA_IMPL: Record<string, AnyFn> = {
  // 数学
  SUM: fn((...a) => flattenNums(a).reduce((s, x) => s + x, 0)),
  AVG: fn((...a) => { const xs = flattenNums(a); return xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : NaN; }),
  MAX: fn((...a) => { const xs = flattenNums(a); return xs.length ? Math.max(...xs) : NaN; }),
  MIN: fn((...a) => { const xs = flattenNums(a); return xs.length ? Math.min(...xs) : NaN; }),
  COUNT: fn((...a) => flattenNums(a).length),
  ROUND: fn((x, n = 0) => { const f = 10 ** Number(n); return Math.round(Number(x) * f) / f; }),
  ABS: fn((x) => Math.abs(Number(x))),
  CEIL: fn((x) => Math.ceil(Number(x))),
  FLOOR: fn((x) => Math.floor(Number(x))),
  MOD: fn((a, b) => Number(a) % Number(b)),
  POWER: fn((a, b) => Number(a) ** Number(b)),
  SQRT: fn((x) => Math.sqrt(Number(x))),
  // 逻辑
  IF: fn((cond, a, b) => (cond ? a : b)),
  AND: fn((...a) => a.every(Boolean)),
  OR: fn((...a) => a.some(Boolean)),
  NOT: fn((x) => !x),
  // 文本
  CONCAT: fn((...a) => a.map(toStr).join('')),
  LEN: fn((s) => toStr(s).length),
  LEFT: fn((s, n = 1) => toStr(s).slice(0, Math.max(0, Number(n)))),
  RIGHT: fn((s, n = 1) => { const str = toStr(s); const k = Math.max(0, Number(n)); return k ? str.slice(-k) : ''; }),
  MID: fn((s, start = 1, len = 0) => toStr(s).slice(Math.max(0, Number(start) - 1), Math.max(0, Number(start) - 1) + Number(len))),
  UPPER: fn((s) => toStr(s).toUpperCase()),
  LOWER: fn((s) => toStr(s).toLowerCase()),
  TRIM: fn((s) => toStr(s).trim()),
  REPLACE: fn((s, find, repl) => toStr(s).split(toStr(find)).join(toStr(repl))),
  TEXT: fn((x) => toStr(x)),
  // 日期
  TODAY: fn(() => dayjs().format('YYYY-MM-DD')),
  NOW: fn(() => dayjs().format('YYYY-MM-DD HH:mm:ss')),
  YEAR: fn((x) => { const d = toDay(x); return d.isValid() ? d.year() : NaN; }),
  MONTH: fn((x) => { const d = toDay(x); return d.isValid() ? d.month() + 1 : NaN; }),
  DAY: fn((x) => { const d = toDay(x); return d.isValid() ? d.date() : NaN; }),
  DATE: fn((y, m, d) => `${Number(y)}-${pad2(Number(m))}-${pad2(Number(d))}`),
  DATEDIF: fn((a, b, unit = 'd') => {
    const start = toDay(a); const end = toDay(b);
    if (!start.isValid() || !end.isValid()) return NaN;
    const u = String(unit).toLowerCase();
    return end.diff(start, u === 'y' ? 'year' : u === 'm' ? 'month' : 'day');
  }),
  DATEADD: fn((a, n = 1, unit = 'd') => {
    const d = toDay(a);
    if (!d.isValid()) return '';
    const u = String(unit).toLowerCase();
    const next = d.add(Number(n) || 0, u === 'y' ? 'year' : u === 'm' ? 'month' : 'day');
    return next.format('YYYY-MM-DD');
  }),
  NETWORKDAYS: fn((a, b) => {
    let start = toDay(a); let end = toDay(b);
    if (!start.isValid() || !end.isValid()) return NaN;
    if (end.isBefore(start)) [start, end] = [end, start];
    let count = 0;
    for (let d = start.startOf('day'); !d.isAfter(end.startOf('day')); d = d.add(1, 'day')) {
      const w = d.day();
      if (w !== 0 && w !== 6) count += 1;
    }
    return count;
  }),
  // 查表/格式
  LOOKUP: fn((value, keys, vals) => {
    const ks = Array.isArray(keys) ? keys : [keys];
    const vs = Array.isArray(vals) ? vals : [vals];
    const idx = ks.findIndex((k) => k === value || String(k) === String(value));
    return idx >= 0 ? vs[idx] : NaN;
  }),
  FORMAT: fn((x, digits = 2) => {
    const n = Number(x);
    if (!Number.isFinite(n)) return '';
    return n.toLocaleString('en-US', { minimumFractionDigits: Number(digits), maximumFractionDigits: Number(digits) });
  }),
  ISEMPTY: fn((x) => x === undefined || x === null || x === '' || (Array.isArray(x) && x.length === 0) || (typeof x === 'number' && Number.isNaN(x))),
};

const STRING_LITERAL_RE = /"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'/g;
const IDENT_RE = /[A-Za-z_$][A-Za-z0-9_$]*/g;
const SAFE_KEYWORDS = new Set(['R', 'NaN', 'true', 'false']);

/**
 * 计算公式，返回数字 / 文本 / null（不可计算）。
 */
export function evalFormula(
  formula: string,
  values: Record<string, unknown>,
  precision = 2,
): number | string | null {
  if (!formula?.trim()) return null;

  // 1) 引用替换为受控数组项 R[i]
  const refValues: unknown[] = [];
  const replaced = formula.replace(/\{([^}]+)\}/g, (_, ref: string) => {
    const idx = refValues.push(normalizeRef(resolveFormulaRef(values, ref))) - 1;
    return `R[${idx}]`;
  });

  // 2) 去字符串字面量后，标识符必须是白名单函数名 / R / 布尔 / NaN
  const noStrings = replaced.replace(STRING_LITERAL_RE, ' ');
  const idents = noStrings.match(IDENT_RE) ?? [];
  if (idents.some((id) => !SAFE_KEYWORDS.has(id) && !FUNC_SET.has(id))) return null;

  // 3) 字符白名单（去掉函数名 / R / 关键字 / 下标后只剩数字与运算符）
  const checkStr = noStrings
    .replace(new RegExp(`\\b(?:${FUNC_NAMES.join('|')}|R|NaN|true|false)\\b`, 'g'), '')
    .replace(/\[\d+\]/g, '');
  if (/[^0-9+\-*/%(),.<>=!&|?:\s[\]]/.test(checkStr)) return null;

  // 4) 以白名单函数求值
  try {
    const evaluator = new Function('R', ...FUNC_NAMES, `"use strict"; return (${replaced});`);
    const result = evaluator(refValues, ...FUNC_NAMES.map((k) => FORMULA_IMPL[k])) as unknown;
    if (typeof result === 'string') return result;
    const num = typeof result === 'boolean' ? (result ? 1 : 0) : Number(result);
    if (!Number.isFinite(num)) return null;
    return Number(num.toFixed(precision));
  } catch {
    return null;
  }
}
