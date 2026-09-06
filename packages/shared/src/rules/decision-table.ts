/**
 * 决策表命中策略的单一实现（server 求值引擎与 MSW mock 共用）。
 *
 * 输入列取值与「=表达式」输出的求值方式两端不同（服务端用安全表达式引擎，Demo 只支持简单路径），
 * 因此本模块只收口与求值环境无关的部分：行匹配、未命中回退、各 hit-policy 的结果装配与 collect 聚合。
 */
import { matchRuleCell } from './cell';
import type { RuleDecisionInput, RuleDecisionOutput, RuleDecisionRow, RuleDecisionTableSettings, RuleEvaluateResult } from './contracts';
import type { RuleCollectAggregate, RuleHitPolicy } from './types';

export interface DecisionTableLike {
  hitPolicy: RuleHitPolicy;
  inputs: RuleDecisionInput[];
  outputs: RuleDecisionOutput[];
  rules: RuleDecisionRow[];
  settings?: RuleDecisionTableSettings | null;
}

/** 按列类型匹配整行条件单元格（`when[i]` 对应 `inputs[i]`） */
export function decisionRowMatches(row: RuleDecisionRow, inputs: RuleDecisionInput[], colValues: unknown[]): boolean {
  return inputs.every((col, i) => matchRuleCell(row.when?.[i] ?? '', colValues[i], col.type));
}

/** 全部命中行（保持表内顺序） */
export function matchDecisionRows(table: DecisionTableLike, colValues: unknown[]): RuleDecisionRow[] {
  return table.rules.filter((row) => decisionRowMatches(row, table.inputs, colValues));
}

/** 各输出列的默认值（未命中回退时使用） */
export function defaultDecisionOutputs(outputs: RuleDecisionOutput[]): Record<string, unknown> {
  return Object.fromEntries(outputs.map((o) => [o.key, o.default ?? null]));
}

/** collect 聚合：对每个输出键在全部命中行上聚合 */
export function aggregateCollectedOutputs(
  collected: Array<Record<string, unknown>>,
  outputs: RuleDecisionOutput[],
  mode: RuleCollectAggregate,
): Record<string, unknown> {
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

/**
 * 按表的 hit-policy 把命中行装配为求值结果。
 * `buildOutputs(row)` 由调用方提供（决定输出单元格如何解析），未命中时按 `settings.fallbackToDefaults` 回退默认值。
 */
export function resolveDecisionHits(
  table: DecisionTableLike,
  matched: RuleDecisionRow[],
  buildOutputs: (row: RuleDecisionRow) => Record<string, unknown>,
): RuleEvaluateResult {
  const empty: RuleEvaluateResult = { matched: false, outputs: {}, matchedRowIds: [], hitPolicy: table.hitPolicy };
  if (matched.length === 0) {
    return table.settings?.fallbackToDefaults
      ? { ...empty, outputs: defaultDecisionOutputs(table.outputs), reason: 'no_match', usedFallback: true }
      : { ...empty, reason: 'no_match' };
  }

  switch (table.hitPolicy) {
    case 'unique':
      if (matched.length > 1) return { ...empty, matchedRowIds: matched.map((r) => r.id), reason: 'unique_conflict' };
      return { matched: true, outputs: buildOutputs(matched[0]), matchedRowIds: [matched[0].id], hitPolicy: 'unique' };
    case 'priority': {
      const top = [...matched].sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0))[0];
      return { matched: true, outputs: buildOutputs(top), matchedRowIds: [top.id], hitPolicy: 'priority' };
    }
    case 'collect': {
      const collected = matched.map(buildOutputs);
      const mode = table.settings?.collectAggregate ?? 'list';
      return { matched: true, outputs: aggregateCollectedOutputs(collected, table.outputs, mode), matchedRowIds: matched.map((r) => r.id), hitPolicy: 'collect', collected };
    }
    case 'any': {
      // DMN ANY 语义：允许多命中，但所有命中行输出必须一致，否则视为冲突
      const all = matched.map(buildOutputs);
      const head = JSON.stringify(all[0]);
      if (all.some((o) => JSON.stringify(o) !== head)) {
        return { ...empty, matchedRowIds: matched.map((r) => r.id), reason: 'any_conflict' };
      }
      return { matched: true, outputs: all[0], matchedRowIds: matched.map((r) => r.id), hitPolicy: 'any' };
    }
    case 'first':
    default:
      return { matched: true, outputs: buildOutputs(matched[0]), matchedRowIds: [matched[0].id], hitPolicy: table.hitPolicy };
  }
}
