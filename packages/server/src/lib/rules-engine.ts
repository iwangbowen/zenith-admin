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
import type { RuleDecisionInput, RuleDecisionOutput, RuleDecisionRow, RuleHitPolicy, RuleEvaluateResult, RuleDecisionTableSettings } from '@zenith/shared/rules';
import { matchDecisionRows, resolveDecisionHits } from '@zenith/shared/rules';
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

/**
 * 对决策表求值；scope 为输入上下文（input.expr 的取值环境，如 { form, starter }）。
 * 行匹配与 hit-policy 装配在 `@zenith/shared/rules`（与 Mock 同源），这里只提供表达式求值。
 */
export function evaluateDecisionTable(table: DecisionTableLike, scope: Record<string, unknown>): RuleEvaluateResult {
  const colValues = table.inputs.map((col) => evaluateExpression(col.expr, scope));
  const matched = matchDecisionRows(table, colValues);
  return resolveDecisionHits(table, matched, (row) => buildOutputs(row, table.outputs, scope));
}
