/**
 * 规则中心：决策表条件单元格 DSL 的单一实现（parse / match / validate）。
 *
 * server 引擎（rules-engine.ts）、web 规则体检与命中解释（ruleTableUtils.ts）、
 * MSW mock（decision-tables handler）三方共用，杜绝三套解析器漂移。
 *
 * 单元格语法（when[i] 对应 inputs[i]）：
 *   - ''、'-'、'*'                     → 通配，恒真
 *   - '> 100' / '>=10' / '!= 3'       → 比较（number/date；'==' 与 '='、'===' 等价，'!==' 同 '!='）
 *   - '10-20'                          → 数值闭区间（仅 number）
 *   - '[10..20)' / '(0..5]'            → 开闭区间（number/date，FEEL 风格）
 *   - 'in a,b,c' / 'not in a,b'        → 枚举集合（string/number/boolean/date）
 *   - '!= x'                           → 不等（string/boolean 亦可）
 *   - 其它                             → 等值匹配（按列类型归一化）
 *
 * date 类型：值与操作数统一用 dayjs 解析（YYYY-MM-DD 或 YYYY-MM-DD HH:mm:ss），按时间戳比较。
 */
import dayjs from 'dayjs';
import type { RuleFieldType } from './types';

export type RuleCellCmpOp = '>' | '>=' | '<' | '<=' | '==' | '!=';

export type ParsedRuleCell =
  | { kind: 'any' }
  /** number/date 比较；operand 为数值或时间戳 */
  | { kind: 'cmp'; op: RuleCellCmpOp; operand: number }
  /** number/date 区间；min/max 为数值或时间戳 */
  | { kind: 'interval'; min: number; max: number; minInc: boolean; maxInc: boolean }
  /** 枚举集合（已按类型归一化）；negate=true 表示 not in */
  | { kind: 'in'; values: Array<string | number | boolean>; negate: boolean }
  | { kind: 'eq'; value: string | number | boolean }
  | { kind: 'ne'; value: string | number | boolean }
  | { kind: 'invalid'; message: string };

const CMP_RE = /^(>=|<=|===|!==|==|!=|>|<|=)\s*(.+)$/;
const CLOSED_RANGE_RE = /^(-?\d+(?:\.\d+)?)\s*-\s*(-?\d+(?:\.\d+)?)$/;
const FEEL_INTERVAL_RE = /^([[(])\s*(.+?)\s*\.\.\s*(.+?)\s*([\])])$/;
const IN_RE = /^(not\s+in|in)\s+(.+)$/i;

export function isWildcardRuleCell(cell: string | undefined | null): boolean {
  const t = (cell ?? '').trim();
  return t === '' || t === '-' || t === '*';
}

const normalizeCmpOp = (op: string): RuleCellCmpOp => {
  if (op === '=' || op === '==' || op === '===') return '==';
  if (op === '!==' || op === '!=') return '!=';
  return op as RuleCellCmpOp;
};

/** 解析日期字面量为时间戳；无效返回 null（date 列的值与操作数共用） */
export function parseRuleDateValue(raw: unknown): number | null {
  if (raw == null || raw === '') return null;
  if (raw instanceof Date) return raw.getTime();
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : null;
  const d = dayjs(String(raw).trim());
  return d.isValid() ? d.valueOf() : null;
}

function parseOperand(raw: string, type: RuleFieldType): number | null {
  if (type === 'date') return parseRuleDateValue(raw);
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

function coercePrimitive(raw: string, type: RuleFieldType): string | number | boolean | null {
  const text = raw.trim();
  if (type === 'number') {
    const n = Number(text);
    return Number.isFinite(n) ? n : null;
  }
  if (type === 'boolean') {
    if (/^(true|1)$/i.test(text)) return true;
    if (/^(false|0)$/i.test(text)) return false;
    return null;
  }
  if (type === 'date') {
    return parseRuleDateValue(text);
  }
  return text;
}

/** 解析单元格为结构化条件（无异常，语法错误返回 { kind: 'invalid' }） */
export function parseRuleCell(cellRaw: string | undefined | null, type: RuleFieldType): ParsedRuleCell {
  const cell = (cellRaw ?? '').trim();
  if (isWildcardRuleCell(cell)) return { kind: 'any' };

  const inMatch = cell.match(IN_RE);
  if (inMatch) {
    const negate = /^not/i.test(inMatch[1]);
    const parts = inMatch[2].split(',').map((s) => s.trim()).filter((s) => s !== '');
    if (parts.length === 0) return { kind: 'invalid', message: 'in 集合为空' };
    const values: Array<string | number | boolean> = [];
    for (const part of parts) {
      const v = coercePrimitive(part, type);
      if (v === null && type !== 'string') return { kind: 'invalid', message: `in 集合值「${part}」与类型不匹配` };
      values.push(type === 'date' ? (v as number) : (v as string | number | boolean));
    }
    return { kind: 'in', values, negate };
  }

  const feel = cell.match(FEEL_INTERVAL_RE);
  if (feel && (type === 'number' || type === 'date')) {
    const min = parseOperand(feel[2], type);
    const max = parseOperand(feel[3], type);
    if (min == null || max == null) return { kind: 'invalid', message: '区间端点无效' };
    if (min > max) return { kind: 'invalid', message: '区间左端点大于右端点' };
    return { kind: 'interval', min, max, minInc: feel[1] === '[', maxInc: feel[4] === ']' };
  }

  const cmp = cell.match(CMP_RE);
  if (cmp) {
    const op = normalizeCmpOp(cmp[1]);
    if (type === 'number' || type === 'date') {
      const operand = parseOperand(cmp[2], type);
      if (operand == null) return { kind: 'invalid', message: `比较操作数「${cmp[2]}」无效` };
      return { kind: 'cmp', op, operand };
    }
    // string/boolean 仅允许 ==/!=
    if (op === '==' || op === '!=') {
      const v = coercePrimitive(cmp[2], type);
      if (v === null) return { kind: 'invalid', message: `比较值「${cmp[2]}」与类型不匹配` };
      return op === '==' ? { kind: 'eq', value: v } : { kind: 'ne', value: v };
    }
    return { kind: 'invalid', message: `${type} 类型不支持 ${cmp[1]} 比较` };
  }

  if (type === 'number') {
    const range = cell.match(CLOSED_RANGE_RE);
    if (range) {
      const min = Number(range[1]);
      const max = Number(range[2]);
      if (min > max) return { kind: 'invalid', message: '区间左端点大于右端点' };
      return { kind: 'interval', min, max, minInc: true, maxInc: true };
    }
  }

  const value = coercePrimitive(cell, type);
  if (value === null && type !== 'string') return { kind: 'invalid', message: `字面量「${cell}」与类型不匹配` };
  if (type === 'date') return { kind: 'eq', value: value as number };
  return { kind: 'eq', value: value as string | number | boolean };
}

/** 归一化输入值：number/date → number（date 为时间戳），boolean → boolean，其它 → string；无效返回 null */
export function normalizeRuleValue(value: unknown, type: RuleFieldType): string | number | boolean | null {
  if (value == null) return null;
  if (type === 'number') {
    const n = typeof value === 'number' ? value : Number(value);
    return Number.isFinite(n) ? n : null;
  }
  if (type === 'boolean') {
    if (typeof value === 'boolean') return value;
    return value === 'true' || value === '1' || value === 1;
  }
  if (type === 'date') return parseRuleDateValue(value);
  return String(value);
}

function applyCmp(op: RuleCellCmpOp, left: number, right: number): boolean {
  switch (op) {
    case '>': return left > right;
    case '>=': return left >= right;
    case '<': return left < right;
    case '<=': return left <= right;
    case '!=': return left !== right;
    default: return left === right;
  }
}

/** 单元格匹配：给定输入值与列类型，返回是否命中（invalid 条件恒不命中） */
export function matchRuleCell(cellRaw: string | undefined | null, value: unknown, type: RuleFieldType): boolean {
  const parsed = parseRuleCell(cellRaw, type);
  return matchParsedRuleCell(parsed, value, type);
}

/** 已解析条件的匹配（供批量求值复用 parse 结果） */
export function matchParsedRuleCell(parsed: ParsedRuleCell, value: unknown, type: RuleFieldType): boolean {
  if (parsed.kind === 'any') return true;
  if (parsed.kind === 'invalid') return false;
  const actual = normalizeRuleValue(value, type);
  if (actual === null) return false;
  switch (parsed.kind) {
    case 'cmp':
      return typeof actual === 'number' && applyCmp(parsed.op, actual, parsed.operand);
    case 'interval': {
      if (typeof actual !== 'number') return false;
      const geMin = parsed.minInc ? actual >= parsed.min : actual > parsed.min;
      const leMax = parsed.maxInc ? actual <= parsed.max : actual < parsed.max;
      return geMin && leMax;
    }
    case 'in': {
      const hit = parsed.values.some((v) => v === actual);
      return parsed.negate ? !hit : hit;
    }
    case 'ne':
      return actual !== parsed.value;
    default:
      return actual === parsed.value;
  }
}

/** 校验单元格语法；合法返回 null，非法返回错误信息 */
export function validateRuleCell(cellRaw: string | undefined | null, type: RuleFieldType): string | null {
  const parsed = parseRuleCell(cellRaw, type);
  return parsed.kind === 'invalid' ? parsed.message : null;
}

/** 人类可读的条件描述（用于命中解释） */
export function describeParsedRuleCell(parsed: ParsedRuleCell, type: RuleFieldType): string {
  const fmt = (n: number) => (type === 'date' ? dayjs(n).format('YYYY-MM-DD HH:mm:ss') : String(n));
  switch (parsed.kind) {
    case 'any': return '通配';
    case 'cmp': return `${parsed.op} ${fmt(parsed.operand)}`;
    case 'interval': return `${parsed.minInc ? '[' : '('}${fmt(parsed.min)} .. ${fmt(parsed.max)}${parsed.maxInc ? ']' : ')'}`;
    case 'in': return `${parsed.negate ? 'not in' : 'in'} ${parsed.values.map((v) => (type === 'date' && typeof v === 'number' ? fmt(v) : String(v))).join(', ')}`;
    case 'ne': return `!= ${type === 'date' && typeof parsed.value === 'number' ? fmt(parsed.value) : String(parsed.value)}`;
    case 'eq': return `= ${type === 'date' && typeof parsed.value === 'number' ? fmt(parsed.value) : String(parsed.value)}`;
    default: return `无效条件：${parsed.message}`;
  }
}
