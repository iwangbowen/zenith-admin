import type {
  RULE_COLLECT_AGGREGATES,
  RULE_DECISION_STATUSES,
  RULE_EVALUATE_REASONS,
  RULE_FIELD_TYPES,
  RULE_HIT_POLICIES,
  RULE_LIST_MATCH_MODES,
  RULE_LIST_TYPES,
  RULE_SCORECARD_BAND_OPS,
  RuleRefKind,
} from './constants';

// ─── 规则中心：枚举别名 ──────────────────────────────────────────────────────────
export type RuleHitPolicy = (typeof RULE_HIT_POLICIES)[number];

export type RuleDecisionStatus = (typeof RULE_DECISION_STATUSES)[number];

export type RuleFieldType = (typeof RULE_FIELD_TYPES)[number];

export type RuleCollectAggregate = (typeof RULE_COLLECT_AGGREGATES)[number];

export type RuleEvaluateReason = (typeof RULE_EVALUATE_REASONS)[number];

export type RuleScorecardBandOp = (typeof RULE_SCORECARD_BAND_OPS)[number];

export type RuleListType = (typeof RULE_LIST_TYPES)[number];

export type RuleListMatchMode = (typeof RULE_LIST_MATCH_MODES)[number];

// ─── 规则中心：统一求值门面 ──────────────────────────────────────────────────────
/** 统一规则资产引用：kind + key 定位一个可求值资产 */
export interface RuleRef {
  kind: RuleRefKind;
  key: string;
}

/**
 * 统一求值结论信封（rules-runtime decide() 返回值）。
 * 业务消费方只依赖该结构，不感知各资产的解析与快照细节。
 */
export interface RuleDecision {
  matched: boolean;
  outputs: Record<string, unknown>;
  /** 实际求值的资产与版本（名单无版本概念，为 null） */
  ref: { kind: RuleRefKind; key: string; version: number | null };
  /** matched=false 的原因；not_found=资产不存在/未发布/已禁用；error=求值异常（仅 optional 模式） */
  reason?: RuleEvaluateReason | 'not_found' | 'error';
  /** 决策表未命中但按设置回退了默认输出 */
  usedFallback?: boolean;
}
