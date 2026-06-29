/**
 * 决策表求值引擎（规则中心）。
 *
 * 纯函数、只读、无副作用：给定输入 scope，按命中策略匹配规则行，输出结果。
 * 单元格匹配复用 `workflow-expression` 的安全表达式引擎，不引入新的 RCE 面。
 *
 * 单元格语义（when[i] 对应 inputs[i]）：
 *   - ''、'-'、'*'        → 通配，恒真
 *   - '> 100' / '>=10'   → 比较运算（value 绑定为列值），支持 > < >= <= == != === !==
 *   - '10-20'            → 闭区间（仅数值）
 *   - 其它               → 等值匹配（按列类型 string/number/boolean 归一化）
 */
import type { RuleDecisionInput, RuleDecisionOutput, RuleDecisionRow, RuleHitPolicy, RuleEvaluateResult } from '@zenith/shared';
import { evaluateExpression } from './workflow-expression';

interface DecisionTableLike {
  hitPolicy: RuleHitPolicy;
  inputs: RuleDecisionInput[];
  outputs: RuleDecisionOutput[];
  rules: RuleDecisionRow[];
}

const isWildcard = (cell: string): boolean => {
  const t = (cell ?? '').trim();
  return t === '' || t === '-' || t === '*';
};

function coerce(value: unknown, type: 'string' | 'number' | 'boolean'): unknown {
  if (value == null) return value;
  if (type === 'number') return typeof value === 'number' ? value : Number(value);
  if (type === 'boolean') return typeof value === 'boolean' ? value : value === 'true' || value === '1';
  return String(value);
}

function cellMatches(cellRaw: string, value: unknown, type: 'string' | 'number' | 'boolean'): boolean {
  const cell = (cellRaw ?? '').trim();
  if (isWildcard(cell)) return true;
  if (/^(>=|<=|===|!==|==|!=|>|<)/.test(cell)) {
    return Boolean(evaluateExpression(`value ${cell}`, { value }));
  }
  const rangeMatch = cell.match(/^(-?\d+(?:\.\d+)?)\s*-\s*(-?\d+(?:\.\d+)?)$/);
  if (rangeMatch) {
    const num = Number(value);
    return num >= Number(rangeMatch[1]) && num <= Number(rangeMatch[2]);
  }
  return coerce(value, type) === coerce(cell, type);
}

function rowMatches(row: RuleDecisionRow, inputs: RuleDecisionInput[], colValues: unknown[]): boolean {
  return inputs.every((col, i) => cellMatches(row.when?.[i] ?? '', colValues[i], col.type));
}

function buildOutputs(row: RuleDecisionRow, outputs: RuleDecisionOutput[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const o of outputs) {
    const raw = row.then?.[o.key];
    out[o.key] = raw == null ? (o.default ?? null) : coerce(raw, o.type);
  }
  return out;
}

/** 对决策表求值；scope 为输入上下文（input.expr 的取值环境，如 { form, starter }） */
export function evaluateDecisionTable(table: DecisionTableLike, scope: Record<string, unknown>): RuleEvaluateResult {
  const colValues = table.inputs.map((col) => evaluateExpression(col.expr, scope));
  const matched = table.rules.filter((row) => rowMatches(row, table.inputs, colValues));
  const empty: RuleEvaluateResult = { matched: false, outputs: {}, matchedRowIds: [], hitPolicy: table.hitPolicy };
  if (matched.length === 0) return empty;

  switch (table.hitPolicy) {
    case 'unique':
      if (matched.length > 1) return { ...empty, matchedRowIds: matched.map((r) => r.id) };
      return { matched: true, outputs: buildOutputs(matched[0], table.outputs), matchedRowIds: [matched[0].id], hitPolicy: 'unique' };
    case 'priority': {
      const top = [...matched].sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0))[0];
      return { matched: true, outputs: buildOutputs(top, table.outputs), matchedRowIds: [top.id], hitPolicy: 'priority' };
    }
    case 'collect':
      return { matched: true, outputs: buildOutputs(matched[0], table.outputs), matchedRowIds: matched.map((r) => r.id), hitPolicy: 'collect', collected: matched.map((r) => buildOutputs(r, table.outputs)) };
    case 'first':
    case 'any':
    default:
      return { matched: true, outputs: buildOutputs(matched[0], table.outputs), matchedRowIds: [matched[0].id], hitPolicy: table.hitPolicy };
  }
}
