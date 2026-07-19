import type {
  RuleCaseResult,
  RuleDecisionInput,
  RuleDecisionOutput,
  RuleDecisionRow,
  RuleDecisionTable,
  RuleFieldType,
  RuleHitPolicy,
  ParsedRuleCell,
} from '@zenith/shared';
import {
  parseRuleCell,
  matchParsedRuleCell,
  validateRuleCell,
  describeParsedRuleCell,
  isWildcardRuleCell,
  normalizeRuleValue,
} from '@zenith/shared';

export interface RuleInspectionIssue {
  severity: 'error' | 'warning';
  message: string;
  ref?: string;
}

export interface RuleCellExplanation {
  inputKey: string;
  label: string;
  expr: string;
  value: unknown;
  condition: string;
  matched: boolean;
  detail: string;
}

export interface RuleRowExplanation {
  index: number;
  rowId: string;
  label?: string;
  matched: boolean;
  cells: RuleCellExplanation[];
}

export interface ValueDiff {
  key: string;
  expected: unknown;
  actual: unknown;
  equal: boolean;
}

interface DraftLike {
  inputs: RuleDecisionInput[];
  outputs: RuleDecisionOutput[];
  rules: RuleDecisionRow[];
}

const KEY_PATTERN = /^[a-zA-Z][a-zA-Z0-9_-]*$/;
const SIMPLE_PATH_PATTERN = /^[a-zA-Z_$][\w$]*(\.[a-zA-Z_$][\w$]*)*$/;

export function isWildcardCell(cell: string | undefined): boolean {
  return isWildcardRuleCell(cell);
}

/** 输出单元格是否为表达式（'=' 前缀） */
export function isExpressionCell(value: unknown): value is string {
  return typeof value === 'string' && value.trim().startsWith('=');
}

export function coerceRuleValue(value: unknown, type: RuleFieldType): unknown {
  if (value === '' || value === undefined) return undefined;
  if (value === null) return null;
  if (type === 'number') {
    const n = typeof value === 'number' ? value : Number(value);
    return Number.isFinite(n) ? n : value;
  }
  if (type === 'boolean') {
    if (typeof value === 'boolean') return value;
    return value === 'true' || value === '1';
  }
  // date 以 'YYYY-MM-DD HH:mm:ss' 字符串流转
  return String(value);
}

export function setScopeValue(scope: Record<string, unknown>, expr: string, value: unknown): void {
  const path = (expr ?? '').trim();
  if (!SIMPLE_PATH_PATTERN.test(path)) return;
  const keys = path.split('.');
  let node = scope;
  keys.forEach((key, index) => {
    if (index === keys.length - 1) {
      node[key] = value;
      return;
    }
    const next = node[key];
    if (!next || typeof next !== 'object' || Array.isArray(next)) node[key] = {};
    node = node[key] as Record<string, unknown>;
  });
}

export function getScopeValue(scope: Record<string, unknown>, expr: string): unknown {
  const path = (expr ?? '').trim();
  if (!SIMPLE_PATH_PATTERN.test(path)) return undefined;
  return path.split('.').reduce<unknown>((node, key) => {
    if (node == null || typeof node !== 'object') return undefined;
    return (node as Record<string, unknown>)[key];
  }, scope);
}

export function formatRuleValue(value: unknown): string {
  if (value === undefined || value === null || value === '') return '空';
  if (typeof value === 'number' && Number.isNaN(value)) return '无效数字';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

export function buildTestScope(inputs: RuleDecisionInput[], values: Record<string, unknown>): Record<string, unknown> {
  const scope: Record<string, unknown> = {};
  inputs.forEach((input) => {
    const value = coerceRuleValue(values[input.key], input.type);
    setScopeValue(scope, input.expr, value);
  });
  return scope;
}

export function flattenInputValues(inputs: RuleDecisionInput[], scope: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(inputs.map((input) => [input.key, getScopeValue(scope, input.expr)]));
}

export function buildExpectedValues(outputs: RuleDecisionOutput[], values: Record<string, unknown>): Record<string, unknown> {
  const expected: Record<string, unknown> = {};
  outputs.forEach((output) => {
    expected[output.key] = coerceRuleValue(values[output.key], output.type);
  });
  return expected;
}

// ─── 用例样例生成（基于结构化解析） ─────────────────────────────────────────────

const formatTs = (ts: number): string => {
  const d = new Date(ts);
  const p = (n: number, l = 2) => String(n).padStart(l, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
};

const MINUTE_MS = 60_000;

function sampleFromCondition(cell: string | undefined, type: RuleFieldType): unknown {
  const parsed = parseRuleCell(cell, type);
  const fmt = (n: number) => (type === 'date' ? formatTs(n) : n);
  switch (parsed.kind) {
    case 'any':
      if (type === 'number') return 1;
      if (type === 'boolean') return true;
      if (type === 'date') return formatTs(Date.now());
      return 'sample';
    case 'cmp': {
      const step = type === 'date' ? MINUTE_MS : 1;
      if (parsed.op === '>') return fmt(parsed.operand + step);
      if (parsed.op === '<') return fmt(parsed.operand - step);
      if (parsed.op === '!=') return fmt(parsed.operand + step);
      return fmt(parsed.operand);
    }
    case 'interval': {
      const step = type === 'date' ? MINUTE_MS : 1;
      if (parsed.minInc) return fmt(parsed.min);
      if (parsed.maxInc) return fmt(parsed.max);
      return fmt(type === 'number' ? (parsed.min + parsed.max) / 2 : parsed.min + step);
    }
    case 'in': {
      if (!parsed.negate) {
        const v = parsed.values[0];
        return type === 'date' && typeof v === 'number' ? formatTs(v) : v;
      }
      if (type === 'number') return Math.max(...parsed.values.map(Number).filter(Number.isFinite), 0) + 1;
      if (type === 'boolean') return !parsed.values.includes(true);
      return 'other';
    }
    case 'ne':
      if (type === 'number' && typeof parsed.value === 'number') return parsed.value + 1;
      if (type === 'boolean') return parsed.value !== true;
      return 'other';
    case 'eq':
      return type === 'date' && typeof parsed.value === 'number' ? formatTs(parsed.value) : parsed.value;
    default:
      return type === 'number' ? 1 : type === 'boolean' ? true : 'sample';
  }
}

export function generateCaseFromRule(table: Pick<RuleDecisionTable, 'inputs' | 'outputs'>, row: RuleDecisionRow): { input: Record<string, unknown>; expected: Record<string, unknown> } {
  const input: Record<string, unknown> = {};
  table.inputs.forEach((col, index) => {
    setScopeValue(input, col.expr, sampleFromCondition(row.when?.[index], col.type));
  });
  const expected = Object.fromEntries(table.outputs.map((output) => [output.key, row.then?.[output.key] ?? output.default ?? null]));
  return { input, expected };
}

export function diffCaseOutputs(result: RuleCaseResult): ValueDiff[] {
  const keys = new Set([...Object.keys(result.expected ?? {}), ...Object.keys(result.actual ?? {})]);
  return [...keys].map((key) => {
    const expected = result.expected?.[key];
    const actual = result.actual?.[key];
    return { key, expected, actual, equal: JSON.stringify(expected) === JSON.stringify(actual) };
  });
}

function literalValid(value: unknown, type: RuleFieldType): boolean {
  if (value === undefined || value === null || value === '') return true;
  if (isExpressionCell(value)) return true; // '=' 表达式发布时由服务端校验
  if (type === 'number') return Number.isFinite(Number(value));
  if (type === 'boolean') return typeof value === 'boolean' || value === 'true' || value === 'false' || value === '1' || value === '0';
  if (type === 'date') return normalizeRuleValue(value, 'date') !== null;
  return true;
}

// ─── 静态分析：值域模型（overlap / 不可达 / gap） ─────────────────────────────────

interface Interval { min: number; max: number; minInc: boolean; maxInc: boolean }

const FULL: Interval = { min: -Infinity, max: Infinity, minInc: false, maxInc: false };

type CellModel =
  | { t: 'all' }
  | { t: 'invalid' }
  | { t: 'intervals'; list: Interval[] }          // number/date 正域
  | { t: 'excluded'; points: number[] }           // number/date 补域（!= / not in）
  | { t: 'set'; values: Array<string | boolean> } // string/boolean 正域
  | { t: 'notset'; values: Array<string | boolean> }; // string/boolean 补域

function toModel(parsed: ParsedRuleCell, type: RuleFieldType): CellModel {
  if (parsed.kind === 'any') return { t: 'all' };
  if (parsed.kind === 'invalid') return { t: 'invalid' };
  if (type === 'number' || type === 'date') {
    switch (parsed.kind) {
      case 'cmp': {
        const v = parsed.operand;
        if (parsed.op === '>') return { t: 'intervals', list: [{ ...FULL, min: v, minInc: false }] };
        if (parsed.op === '>=') return { t: 'intervals', list: [{ ...FULL, min: v, minInc: true }] };
        if (parsed.op === '<') return { t: 'intervals', list: [{ ...FULL, max: v, maxInc: false }] };
        if (parsed.op === '<=') return { t: 'intervals', list: [{ ...FULL, max: v, maxInc: true }] };
        if (parsed.op === '!=') return { t: 'excluded', points: [v] };
        return { t: 'intervals', list: [{ min: v, max: v, minInc: true, maxInc: true }] };
      }
      case 'interval':
        return { t: 'intervals', list: [{ min: parsed.min, max: parsed.max, minInc: parsed.minInc, maxInc: parsed.maxInc }] };
      case 'in': {
        const nums = parsed.values.map(Number).filter(Number.isFinite);
        return parsed.negate
          ? { t: 'excluded', points: nums }
          : { t: 'intervals', list: nums.map((n) => ({ min: n, max: n, minInc: true, maxInc: true })) };
      }
      case 'eq':
        return { t: 'intervals', list: [{ min: Number(parsed.value), max: Number(parsed.value), minInc: true, maxInc: true }] };
      case 'ne':
        return { t: 'excluded', points: [Number(parsed.value)] };
      default:
        return { t: 'all' };
    }
  }
  // string / boolean
  switch (parsed.kind) {
    case 'in':
      return parsed.negate
        ? { t: 'notset', values: parsed.values as Array<string | boolean> }
        : { t: 'set', values: parsed.values as Array<string | boolean> };
    case 'eq':
      return { t: 'set', values: [parsed.value as string | boolean] };
    case 'ne':
      return { t: 'notset', values: [parsed.value as string | boolean] };
    default:
      return { t: 'all' };
  }
}

const intervalOverlaps = (a: Interval, b: Interval): boolean => {
  const lo = a.min > b.min ? a : b;
  const hi = a.max < b.max ? a : b;
  if (lo.min > hi.max) return false;
  if (lo.min === hi.max) return lo.minInc && hi.maxInc;
  return true;
};

const intervalContains = (outer: Interval, inner: Interval): boolean => {
  const minOk = outer.min < inner.min || (outer.min === inner.min && (outer.minInc || !inner.minInc));
  const maxOk = outer.max > inner.max || (outer.max === inner.max && (outer.maxInc || !inner.maxInc));
  return minOk && maxOk;
};

const pointInInterval = (p: number, iv: Interval): boolean =>
  (p > iv.min || (p === iv.min && iv.minInc)) && (p < iv.max || (p === iv.max && iv.maxInc));

/** 布尔域实体化为正域集合，统一比较 */
function materializeBoolean(model: CellModel): CellModel {
  if (model.t === 'notset' && model.values.every((v) => typeof v === 'boolean')) {
    return { t: 'set', values: [true, false].filter((v) => !model.values.includes(v)) };
  }
  return model;
}

function modelsIntersect(aRaw: CellModel, bRaw: CellModel, type: RuleFieldType): boolean {
  let a = aRaw, b = bRaw;
  if (type === 'boolean') { a = materializeBoolean(a); b = materializeBoolean(b); }
  if (a.t === 'invalid' || b.t === 'invalid') return false;
  if (a.t === 'all' || b.t === 'all') return true;
  if (a.t === 'intervals' && b.t === 'intervals') return a.list.some((x) => b.list.some((y) => intervalOverlaps(x, y)));
  if (a.t === 'excluded' && b.t === 'excluded') return true;
  if (a.t === 'excluded' && b.t === 'intervals') return b.list.some((iv) => !(iv.min === iv.max && a.points.includes(iv.min)));
  if (a.t === 'intervals' && b.t === 'excluded') return modelsIntersect(b, a, type);
  if (a.t === 'set' && b.t === 'set') return a.values.some((v) => b.values.includes(v));
  if (a.t === 'set' && b.t === 'notset') return a.values.some((v) => !b.values.includes(v));
  if (a.t === 'notset' && b.t === 'set') return modelsIntersect(b, a, type);
  if (a.t === 'notset' && b.t === 'notset') return true;
  return true;
}

/** a ⊆ b（用于不可达行检测：后行被前行完全覆盖） */
function modelSubset(aRaw: CellModel, bRaw: CellModel, type: RuleFieldType): boolean {
  let a = aRaw, b = bRaw;
  if (type === 'boolean') { a = materializeBoolean(a); b = materializeBoolean(b); }
  if (a.t === 'invalid' || b.t === 'invalid') return false;
  if (b.t === 'all') return true;
  if (a.t === 'all') return false;
  if (a.t === 'intervals' && b.t === 'intervals') return a.list.every((x) => b.list.some((y) => intervalContains(y, x)));
  if (a.t === 'intervals' && b.t === 'excluded') return b.points.every((p) => !a.list.some((iv) => pointInInterval(p, iv)));
  if (a.t === 'excluded' && b.t === 'excluded') return b.points.every((p) => a.points.includes(p));
  if (a.t === 'excluded' && b.t === 'intervals') return false;
  if (a.t === 'set' && b.t === 'set') return a.values.every((v) => b.values.includes(v));
  if (a.t === 'set' && b.t === 'notset') return a.values.every((v) => !b.values.includes(v));
  if (a.t === 'notset' && b.t === 'notset') return b.values.every((v) => a.values.includes(v));
  if (a.t === 'notset' && b.t === 'set') return false;
  return false;
}

/** 单数值/日期输入列的未覆盖区间检测（仅报告有限内部缺口） */
function findCoverageGap(models: CellModel[], type: RuleFieldType): string | null {
  if (models.some((m) => m.t === 'all' || m.t === 'excluded' || m.t === 'notset' || m.t === 'invalid')) return null;
  const intervals = models.flatMap((m) => (m.t === 'intervals' ? m.list : []));
  if (intervals.length < 2) return null;
  const sorted = [...intervals].sort((x, y) => x.min - y.min || Number(y.minInc) - Number(x.minInc));
  let current = sorted[0];
  const fmt = (n: number) => (type === 'date' ? formatTs(n) : String(n));
  for (let i = 1; i < sorted.length; i += 1) {
    const next = sorted[i];
    const connected = next.min < current.max
      || (next.min === current.max && (next.minInc || current.maxInc));
    if (!connected && Number.isFinite(current.max) && Number.isFinite(next.min)) {
      return `${current.maxInc ? '(' : '['}${fmt(current.max)} .. ${fmt(next.min)}${next.minInc ? ')' : ']'}`;
    }
    if (next.max > current.max || (next.max === current.max && next.maxInc)) {
      current = { ...current, max: next.max, maxInc: next.maxInc };
    }
  }
  return null;
}

/** 行间重叠/不可达/gap 分析（按命中策略裁剪：first/priority 重叠属正常语义不报） */
function analyzeRules(draft: DraftLike, hitPolicy: RuleHitPolicy, issues: RuleInspectionIssue[]): void {
  const { inputs, rules } = draft;
  if (inputs.length === 0 || rules.length < 1) return;
  const parsedRows = rules.map((row) => inputs.map((input, ci) => toModel(parseRuleCell(row.when?.[ci] ?? '', input.type), input.type)));
  const rowRef = (i: number) => rules[i].label || `规则行 ${i + 1}`;

  // 重叠：unique 必然冲突风险；any 仅当输出不一致时才有风险
  if (hitPolicy === 'unique' || hitPolicy === 'any') {
    const limit = 6;
    let reported = 0;
    for (let i = 0; i < rules.length && reported < limit; i += 1) {
      for (let j = i + 1; j < rules.length && reported < limit; j += 1) {
        const overlaps = inputs.every((input, ci) => modelsIntersect(parsedRows[i][ci], parsedRows[j][ci], input.type));
        if (!overlaps) continue;
        if (hitPolicy === 'any' && JSON.stringify(rules[i].then) === JSON.stringify(rules[j].then)) continue;
        issues.push({
          severity: 'warning',
          message: hitPolicy === 'unique'
            ? `「${rowRef(i)}」与「${rowRef(j)}」条件存在重叠，唯一命中策略下会产生冲突`
            : `「${rowRef(i)}」与「${rowRef(j)}」条件重叠且输出不一致，any 策略下将判定冲突`,
        });
        reported += 1;
      }
    }
  }

  // 不可达：first 策略下后行被任一前行完全覆盖
  if (hitPolicy === 'first') {
    for (let i = 1; i < rules.length; i += 1) {
      for (let j = 0; j < i; j += 1) {
        const covered = inputs.every((input, ci) => modelSubset(parsedRows[i][ci], parsedRows[j][ci], input.type));
        if (covered) {
          issues.push({ severity: 'warning', message: `「${rowRef(i)}」被前面的「${rowRef(j)}」完全覆盖，永远不会命中` });
          break;
        }
      }
    }
  }

  // gap：单数值/日期输入列的有限内部缺口
  if (inputs.length === 1 && (inputs[0].type === 'number' || inputs[0].type === 'date')) {
    const gap = findCoverageGap(parsedRows.map((r) => r[0]), inputs[0].type);
    if (gap) issues.push({ severity: 'warning', message: `输入「${inputs[0].label}」存在未覆盖区间 ${gap}，落入该区间的输入不会命中任何规则` });
  }
}

export function inspectDecisionDraft(draft: DraftLike, hitPolicy: RuleHitPolicy): RuleInspectionIssue[] {
  const issues: RuleInspectionIssue[] = [];
  const inputKeys = new Map<string, number>();
  const outputKeys = new Map<string, number>();
  const rowIds = new Set<string>();
  const seenConditions = new Map<string, number>();

  if (draft.inputs.length === 0) issues.push({ severity: 'warning', message: '尚未配置输入列，发布前至少需要一个输入列' });
  if (draft.outputs.length === 0) issues.push({ severity: 'warning', message: '尚未配置输出列，发布前至少需要一个输出列' });
  if (draft.rules.length === 0) issues.push({ severity: 'warning', message: '尚未配置规则行，发布前至少需要一条规则' });

  draft.inputs.forEach((input, index) => {
    const ref = `输入列 ${index + 1}`;
    if (!input.key?.trim()) issues.push({ severity: 'error', message: `${ref} 缺少 key`, ref });
    else if (!KEY_PATTERN.test(input.key)) issues.push({ severity: 'error', message: `${ref} key 仅限字母开头的字母、数字、下划线或短横线`, ref });
    else if (inputKeys.has(input.key)) issues.push({ severity: 'error', message: `${ref} key 与输入列 ${inputKeys.get(input.key)! + 1} 重复`, ref });
    else inputKeys.set(input.key, index);
    if (!input.label?.trim()) issues.push({ severity: 'error', message: `${ref} 缺少名称`, ref });
    if (!input.expr?.trim()) issues.push({ severity: 'error', message: `${ref} 缺少取值表达式`, ref });
    else if (!SIMPLE_PATH_PATTERN.test(input.expr)) issues.push({ severity: 'warning', message: `${ref} 使用了复杂表达式，手动测试表单无法自动组装该输入`, ref });
  });

  draft.outputs.forEach((output, index) => {
    const ref = `输出列 ${index + 1}`;
    if (!output.key?.trim()) issues.push({ severity: 'error', message: `${ref} 缺少 key`, ref });
    else if (!KEY_PATTERN.test(output.key)) issues.push({ severity: 'error', message: `${ref} key 仅限字母开头的字母、数字、下划线或短横线`, ref });
    else if (outputKeys.has(output.key)) issues.push({ severity: 'error', message: `${ref} key 与输出列 ${outputKeys.get(output.key)! + 1} 重复`, ref });
    else outputKeys.set(output.key, index);
    if (!output.label?.trim()) issues.push({ severity: 'error', message: `${ref} 缺少名称`, ref });
    if (!literalValid(output.default, output.type)) issues.push({ severity: 'error', message: `${ref} 默认值与类型不匹配`, ref });
  });

  draft.rules.forEach((row, index) => {
    const ref = `规则行 ${index + 1}`;
    if (!row.id?.trim()) issues.push({ severity: 'error', message: `${ref} 缺少行 ID`, ref });
    else if (rowIds.has(row.id)) issues.push({ severity: 'error', message: `${ref} 行 ID 重复`, ref });
    else rowIds.add(row.id);

    if ((row.when ?? []).length !== draft.inputs.length) {
      issues.push({ severity: 'error', message: `${ref} 条件数量与输入列数量不一致`, ref });
    }
    draft.inputs.forEach((input, inputIndex) => {
      const cell = row.when?.[inputIndex] ?? '';
      const err = validateRuleCell(cell, input.type);
      if (err) issues.push({ severity: 'error', message: `${ref} 的「${input.label}」条件无效：${err}`, ref });
    });
    draft.outputs.forEach((output) => {
      const value = row.then?.[output.key];
      if (!Object.prototype.hasOwnProperty.call(row.then ?? {}, output.key) || value === '' || value === undefined) {
        issues.push({ severity: 'warning', message: `${ref} 未填写输出「${output.label}」，命中时会使用默认值或 null`, ref });
      } else if (output.isExpr && !isExpressionCell(value) && value !== null) {
        issues.push({ severity: 'warning', message: `${ref} 的输出「${output.label}」为表达式列，但值不是 '=' 开头的表达式`, ref });
      } else if (!literalValid(value, output.type)) {
        issues.push({ severity: 'error', message: `${ref} 的输出「${output.label}」与类型不匹配`, ref });
      }
    });

    const conditionKey = (row.when ?? []).join('\u0001');
    if (seenConditions.has(conditionKey)) {
      const previous = seenConditions.get(conditionKey)! + 1;
      issues.push({
        severity: hitPolicy === 'unique' ? 'error' : 'warning',
        message: `${ref} 与规则行 ${previous} 条件完全相同${hitPolicy === 'unique' ? '，唯一命中策略下会产生冲突' : ''}`,
        ref,
      });
    } else {
      seenConditions.set(conditionKey, index);
    }

    if (index < draft.rules.length - 1 && draft.inputs.length > 0 && draft.inputs.every((_, inputIndex) => isWildcardCell(row.when?.[inputIndex]))) {
      issues.push({ severity: 'warning', message: `${ref} 是全通配条件，后续规则可能无法命中`, ref });
    }
  });

  analyzeRules(draft, hitPolicy, issues);

  return issues;
}

export function explainDecisionRows(table: Pick<RuleDecisionTable, 'inputs' | 'rules'>, scope: Record<string, unknown>): RuleRowExplanation[] {
  return table.rules.map((row, index) => {
    const cells = table.inputs.map((input, inputIndex) => {
      const value = getScopeValue(scope, input.expr);
      const parsed = parseRuleCell(row.when?.[inputIndex] ?? '', input.type);
      const matched = matchParsedRuleCell(parsed, value, input.type);
      const described = describeParsedRuleCell(parsed, input.type);
      return {
        inputKey: input.key,
        label: input.label,
        expr: input.expr,
        value,
        condition: row.when?.[inputIndex] ?? '',
        matched,
        detail: `${described} · ${matched ? '满足' : '不满足'}`,
      };
    });
    return { index, rowId: row.id, label: row.label, matched: cells.every((cell) => cell.matched), cells };
  });
}
