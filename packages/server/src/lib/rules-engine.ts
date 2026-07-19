/**
 * 决策表求值引擎（规则中心）。
 *
 * 纯函数、只读、无副作用：给定输入 scope，按命中策略匹配规则行，输出结果。
 * 单元格匹配使用 `@zenith/shared` 的 rule-cell DSL（与前端体检/MSW mock 同源）；
 * 输入列取值与「=表达式」输出复用 `workflow-expression` 安全表达式引擎，不引入新的 RCE 面。
 *
 * 输出单元格语义（then[key]）：
 *   - 字面量           → 按输出列类型归一化
 *   - '= 表达式'       → 以 scope 求值（如 '= form.amount * 0.8'），再按类型归一化
 *
 * settings：
 *   - collectAggregate  → collect 策略聚合方式（list/sum/min/max/count/distinct）
 *   - fallbackToDefaults → 未命中时回退输出列默认值（matched 仍为 false，usedFallback=true）
 */
import type {
  RuleDecisionInput, RuleDecisionOutput, RuleDecisionRow, RuleHitPolicy,
  RuleEvaluateResult, RuleDecisionTableSettings, RuleCollectAggregate,
} from '@zenith/shared';
import { matchRuleCell } from '@zenith/shared';
import { evaluateExpression } from './workflow-expression';

interface DecisionTableLike {
  hitPolicy: RuleHitPolicy;
  inputs: RuleDecisionInput[];
  outputs: RuleDecisionOutput[];
  rules: RuleDecisionRow[];
  settings?: RuleDecisionTableSettings | null;
}

function coerce(value: unknown, type: RuleDecisionOutput['type']): unknown {
  if (value == null) return value;
  if (type === 'number') return typeof value === 'number' ? value : Number(value);
  if (type === 'boolean') return typeof value === 'boolean' ? value : value === 'true' || value === '1';
  return String(value);
}

/** 判断输出单元格是否为表达式（'=' 前缀） */
export function isOutputExpression(raw: unknown): raw is string {
  return typeof raw === 'string' && raw.trim().startsWith('=');
}

function rowMatches(row: RuleDecisionRow, inputs: RuleDecisionInput[], colValues: unknown[]): boolean {
  return inputs.every((col, i) => matchRuleCell(row.when?.[i] ?? '', colValues[i], col.type));
}

function buildOutputs(row: RuleDecisionRow, outputs: RuleDecisionOutput[], scope: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const o of outputs) {
    const raw = row.then?.[o.key];
    if (raw == null) {
      out[o.key] = o.default ?? null;
    } else if (isOutputExpression(raw)) {
      let value: unknown;
      try { value = evaluateExpression(raw.trim().slice(1), scope); } catch { value = null; }
      out[o.key] = value == null ? (o.default ?? null) : coerce(value, o.type);
    } else {
      out[o.key] = coerce(raw, o.type);
    }
  }
  return out;
}

function defaultOutputs(outputs: RuleDecisionOutput[]): Record<string, unknown> {
  return Object.fromEntries(outputs.map((o) => [o.key, o.default ?? null]));
}

/** collect 聚合：对每个输出键在全部命中行上聚合 */
function aggregateCollected(collected: Array<Record<string, unknown>>, outputs: RuleDecisionOutput[], mode: RuleCollectAggregate): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const o of outputs) {
    const values = collected.map((c) => c[o.key]);
    switch (mode) {
      case 'sum':
        out[o.key] = values.reduce<number>((acc, v) => acc + (Number.isFinite(Number(v)) ? Number(v) : 0), 0);
        break;
      case 'min':
      case 'max': {
        const nums = values.map(Number).filter((n) => Number.isFinite(n));
        out[o.key] = nums.length === 0 ? null : (mode === 'min' ? Math.min(...nums) : Math.max(...nums));
        break;
      }
      case 'count':
        out[o.key] = collected.length;
        break;
      case 'distinct': {
        const seen = new Set<string>();
        out[o.key] = values.filter((v) => {
          const k = JSON.stringify(v ?? null);
          if (seen.has(k)) return false;
          seen.add(k);
          return true;
        });
        break;
      }
      default:
        out[o.key] = values;
    }
  }
  return out;
}

/** 对决策表求值；scope 为输入上下文（input.expr 的取值环境，如 { form, starter }） */
export function evaluateDecisionTable(table: DecisionTableLike, scope: Record<string, unknown>): RuleEvaluateResult {
  const colValues = table.inputs.map((col) => evaluateExpression(col.expr, scope));
  const matched = table.rules.filter((row) => rowMatches(row, table.inputs, colValues));
  const empty: RuleEvaluateResult = { matched: false, outputs: {}, matchedRowIds: [], hitPolicy: table.hitPolicy };
  const noMatch = (): RuleEvaluateResult => (table.settings?.fallbackToDefaults
    ? { ...empty, outputs: defaultOutputs(table.outputs), reason: 'no_match', usedFallback: true }
    : { ...empty, reason: 'no_match' });
  if (matched.length === 0) return noMatch();

  switch (table.hitPolicy) {
    case 'unique':
      if (matched.length > 1) return { ...empty, matchedRowIds: matched.map((r) => r.id), reason: 'unique_conflict' };
      return { matched: true, outputs: buildOutputs(matched[0], table.outputs, scope), matchedRowIds: [matched[0].id], hitPolicy: 'unique' };
    case 'priority': {
      const top = [...matched].sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0))[0];
      return { matched: true, outputs: buildOutputs(top, table.outputs, scope), matchedRowIds: [top.id], hitPolicy: 'priority' };
    }
    case 'collect': {
      const collected = matched.map((r) => buildOutputs(r, table.outputs, scope));
      const mode = table.settings?.collectAggregate ?? 'list';
      return { matched: true, outputs: aggregateCollected(collected, table.outputs, mode), matchedRowIds: matched.map((r) => r.id), hitPolicy: 'collect', collected };
    }
    case 'any': {
      // DMN ANY 语义：允许多命中，但所有命中行输出必须一致，否则视为冲突
      const all = matched.map((r) => buildOutputs(r, table.outputs, scope));
      const head = JSON.stringify(all[0]);
      if (all.some((o) => JSON.stringify(o) !== head)) {
        return { ...empty, matchedRowIds: matched.map((r) => r.id), reason: 'any_conflict' };
      }
      return { matched: true, outputs: all[0], matchedRowIds: matched.map((r) => r.id), hitPolicy: 'any' };
    }
    case 'first':
    default:
      return { matched: true, outputs: buildOutputs(matched[0], table.outputs, scope), matchedRowIds: [matched[0].id], hitPolicy: table.hitPolicy };
  }
}
