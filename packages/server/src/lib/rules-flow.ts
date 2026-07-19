/**
 * 决策流引擎（规则中心）：多决策表顺序编排（DRD 简化版）。
 *
 * 语义：
 * - 步骤按序执行；每步先求 condition（安全表达式，假则跳过），再对引用的决策表求值；
 * - 步骤输出并入工作 scope（outputNamespace 为空平铺合并，非空挂在 scope[ns] 下），
 *   供后续步骤的 condition / 输入表达式引用，实现表间串联；
 * - 决策表解析通过注入的 resolver 完成（运行时=发布快照，测试=编辑态回退），引擎本身无 DB 依赖。
 */
import type {
  RuleDecisionInput, RuleDecisionOutput, RuleDecisionRow, RuleHitPolicy,
  RuleDecisionTableSettings, RuleFlowStep, RuleFlowEvaluateResult, RuleFlowStepTrace,
} from '@zenith/shared';
import { evaluateDecisionTable } from './rules-engine';
import { evaluateExpression } from './workflow-expression';

export interface FlowTableLike {
  hitPolicy: RuleHitPolicy;
  inputs: RuleDecisionInput[];
  outputs: RuleDecisionOutput[];
  rules: RuleDecisionRow[];
  settings?: RuleDecisionTableSettings | null;
}

export type FlowTableResolver = (tableKey: string) => Promise<FlowTableLike | null>;

/** 步骤执行回调（供运行时写执行记录）；scopeAtEval 为该步骤求值时的 scope 快照（不含本步输出） */
export type FlowStepObserver = (trace: RuleFlowStepTrace, stepIndex: number, scopeAtEval: Record<string, unknown>) => void;

export async function evaluateDecisionFlowSteps(
  steps: RuleFlowStep[],
  scope: Record<string, unknown>,
  resolve: FlowTableResolver,
  observe?: FlowStepObserver,
): Promise<RuleFlowEvaluateResult> {
  const workingScope: Record<string, unknown> = { ...scope };
  const combined: Record<string, unknown> = {};
  const traces: RuleFlowStepTrace[] = [];

  const emit = (trace: RuleFlowStepTrace, index: number, scopeAtEval: Record<string, unknown>) => {
    traces.push(trace);
    observe?.(trace, index, scopeAtEval);
  };

  for (let i = 0; i < steps.length; i += 1) {
    const step = steps[i];
    const base = { stepId: step.id, tableKey: step.tableKey, label: step.label, matched: false, outputs: {}, matchedRowIds: [] as string[] };
    // 本步求值输入快照（浅拷贝顶层键：后续步骤对 workingScope 顶层的合并不会污染它）
    const scopeAtEval: Record<string, unknown> = { ...workingScope };

    if (step.condition?.trim()) {
      let pass = false;
      let condError: string | undefined;
      try {
        pass = Boolean(evaluateExpression(step.condition, workingScope));
      } catch (err) {
        condError = err instanceof Error ? err.message : String(err);
      }
      if (condError) {
        emit({ ...base, skipped: true, skipReason: 'error', error: `条件求值失败：${condError}` }, i, scopeAtEval);
        continue;
      }
      if (!pass) {
        emit({ ...base, skipped: true, skipReason: 'condition' }, i, scopeAtEval);
        continue;
      }
    }

    const table = await resolve(step.tableKey);
    if (!table) {
      emit({ ...base, skipped: true, skipReason: 'unavailable', error: `决策表 ${step.tableKey} 不可用（未发布/已禁用/不存在）` }, i, scopeAtEval);
      continue;
    }

    let trace: RuleFlowStepTrace;
    try {
      const res = evaluateDecisionTable(table, workingScope);
      const outs = res.matched || res.usedFallback ? res.outputs : {};
      const ns = step.outputNamespace?.trim();
      if (ns) {
        const prev = (workingScope[ns] && typeof workingScope[ns] === 'object' && !Array.isArray(workingScope[ns])) ? workingScope[ns] as Record<string, unknown> : {};
        workingScope[ns] = { ...prev, ...outs };
        const prevCombined = (combined[ns] && typeof combined[ns] === 'object' && !Array.isArray(combined[ns])) ? combined[ns] as Record<string, unknown> : {};
        combined[ns] = { ...prevCombined, ...outs };
      } else {
        Object.assign(workingScope, outs);
        Object.assign(combined, outs);
      }
      trace = { ...base, skipped: false, matched: res.matched, outputs: outs, matchedRowIds: res.matchedRowIds, hitPolicy: res.hitPolicy, reason: res.reason };
    } catch (err) {
      trace = { ...base, skipped: true, skipReason: 'error', error: err instanceof Error ? err.message : String(err) };
    }
    emit(trace, i, scopeAtEval);
  }

  return { outputs: combined, steps: traces };
}
