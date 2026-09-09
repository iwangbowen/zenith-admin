/**
 * 统一求值门面（规则中心唯一业务消费入口）。
 *
 * 业务侧不感知各资产的解析、快照与缓存细节，一律：
 *   decide({ kind, key }, facts, { caller, mode }) → RuleDecision
 *
 * 语义约定：
 * - 只跑**发布快照**（决策表含灰度选版），编辑态永不进入业务链路；
 * - mode='optional'（默认）：资产不存在/未发布/已禁用/求值异常 → matched=false + reason，不阻断业务
 *   （即「资产存在才生效」的可插拔接入样板）；
 * - mode='required'：资产不可用直接抛 HTTPException(400)，求值异常原样上抛；
 * - 统一执行留痕（refKind/caller/version/bizRef）：决策表/流/评分卡每次求值留痕，名单仅命中时留痕；
 * - kind='list' 需传 opts.subjects（待检测主体值集合，如 [openid, userId, ip]）。
 */
import { HTTPException } from 'hono/http-exception';
import { eq } from 'drizzle-orm';
import type { RuleDecision, RuleExecutionSource, RuleFlowStep, RuleRef } from '@zenith/shared/rules';
import { RULE_REF_KIND_LABELS } from '@zenith/shared/rules';
import { db } from '../../db';
import { ruleDecisionFlows, ruleScorecards } from '../../db/schema';
import { currentUserOrNull } from '../../lib/context';
import logger from '../../lib/logger';
import { pickTenantScopedRow } from '../../lib/tenant';
import { evaluateDecisionTable } from '../../lib/rules-engine';
import { evaluateDecisionFlowSteps } from '../../lib/rules-flow';
import { evaluateScorecard, type ScorecardLike } from '../../lib/rules-scorecard';
import { resolveRuntimeDecisionTable, resolveGrayPinnedVersion } from './rules.service';
import { checkRuleListsBatch } from './rules-lists.service';
import { recordRuleExecution, snapshotRuleScope } from './rules-executions.service';
import { cachedRuleRuntime } from './rules-runtime-cache';

export interface DecideOptions {
  /** 调用方标识（点分小写，如 workflow.gateway / member.coupon），用于执行留痕与消费方分析 */
  caller: string;
  /** optional=资产不可用不阻断（默认）；required=资产不可用抛 400 */
  mode?: 'optional' | 'required';
  /** 执行留痕来源，默认 runtime */
  source?: RuleExecutionSource;
  /** 运行时租户：显式指定 > 当前登录用户生效租户 > 无上下文（member/cron 场景） */
  tenantId?: number | null;
  /** 仅决策表：pin 指定发布版本（缺省走灰度选版/最新快照） */
  version?: number;
  /** 关联上下文（调用方自定语义，如 workflow:42#gateway_1 / payment:order:ORD1），用于留痕追溯 */
  bizRef?: string | null;
  /** 仅名单：待检测主体值集合 */
  subjects?: string[];
}

/** 运行时求值使用的租户：显式指定 > 当前登录用户生效租户 > 无上下文 */
function runtimeTenantId(explicit?: number | null): number | null | undefined {
  if (explicit !== undefined) return explicit;
  const u = currentUserOrNull();
  return u ? (u.viewingTenantId ?? u.tenantId ?? null) : undefined;
}

function tenantCacheTag(tenantId: number | null | undefined): string {
  return tenantId === undefined ? 'ctxless' : String(tenantId ?? 'global');
}

type FlowRow = typeof ruleDecisionFlows.$inferSelect;
type ScorecardRow = typeof ruleScorecards.$inferSelect;

async function resolveRuntimeFlow(key: string, tenantId: number | null | undefined): Promise<FlowRow | null> {
  return cachedRuleRuntime('flow', `${tenantCacheTag(tenantId)}|${key}`, async () => {
    const candidates = await db.select().from(ruleDecisionFlows).where(eq(ruleDecisionFlows.key, key));
    const row = pickTenantScopedRow(candidates, tenantId);
    return row && row.status === 'published' && row.publishedSteps ? row : null;
  });
}

async function resolveRuntimeScorecard(key: string, tenantId: number | null | undefined): Promise<ScorecardRow | null> {
  return cachedRuleRuntime('scorecard', `${tenantCacheTag(tenantId)}|${key}`, async () => {
    const candidates = await db.select().from(ruleScorecards).where(eq(ruleScorecards.key, key));
    const row = pickTenantScopedRow(candidates, tenantId);
    return row && row.status === 'published' && row.publishedSnapshot ? row : null;
  });
}

function unavailable(ref: RuleRef, mode: 'optional' | 'required'): RuleDecision {
  if (mode === 'required') {
    throw new HTTPException(400, { message: `规则资产不可用：${RULE_REF_KIND_LABELS[ref.kind]} ${ref.key}（不存在/未发布/已禁用）` });
  }
  return { matched: false, outputs: {}, ref: { ...ref, version: null }, reason: 'not_found' };
}

/** 统一求值：按 ref.kind 分发到对应资产，返回统一决策信封 */
export async function decide(ref: RuleRef, facts: Record<string, unknown>, opts: DecideOptions): Promise<RuleDecision> {
  const mode = opts.mode ?? 'optional';
  try {
    switch (ref.kind) {
      case 'table': return await decideTable(ref, facts, opts, mode);
      case 'flow': return await decideFlow(ref, facts, opts, mode);
      case 'scorecard': return await decideScorecard(ref, facts, opts, mode);
      case 'list': return await decideList(ref, opts, mode);
    }
  } catch (err) {
    if (mode === 'required' || err instanceof HTTPException) throw err;
    logger.warn(`规则求值异常（optional 降级）：${ref.kind}:${ref.key} caller=${opts.caller}`, { error: err instanceof Error ? err.message : String(err) });
    return { matched: false, outputs: {}, ref: { ...ref, version: null }, reason: 'error' };
  }
}

async function decideTable(ref: RuleRef, facts: Record<string, unknown>, opts: DecideOptions, mode: 'optional' | 'required'): Promise<RuleDecision> {
  // 未显式 pin 版本时应用灰度选版（同一主体稳定命中同一版本）
  const pinned = opts.version ?? await resolveGrayPinnedVersion(ref.key, facts, opts.tenantId);
  const snapshot = await resolveRuntimeDecisionTable(ref.key, { tenantId: opts.tenantId, version: pinned });
  if (!snapshot) return unavailable(ref, mode);
  const res = evaluateDecisionTable(snapshot, facts);
  recordRuleExecution({
    refKind: 'table', refId: snapshot.tableId, ruleKey: ref.key, version: snapshot.version,
    caller: opts.caller, source: opts.source ?? 'runtime',
    bizRef: opts.bizRef ?? null,
    matched: res.matched, hitPolicy: res.hitPolicy,
    input: snapshotRuleScope(facts), outputs: res.outputs, matchedRowIds: res.matchedRowIds,
    tenantId: snapshot.tenantId,
  });
  return {
    matched: res.matched,
    outputs: res.outputs,
    ref: { ...ref, version: snapshot.version },
    reason: res.reason,
    usedFallback: res.usedFallback,
  };
}

async function decideFlow(ref: RuleRef, facts: Record<string, unknown>, opts: DecideOptions, mode: 'optional' | 'required'): Promise<RuleDecision> {
  const tenantId = runtimeTenantId(opts.tenantId);
  const row = await resolveRuntimeFlow(ref.key, tenantId);
  if (!row) return unavailable(ref, mode);
  // 步骤留痕的关联上下文：沿用调用方 bizRef（无则以流 key 定位），追加步骤序号便于还原执行轨迹
  const stepBase = opts.bizRef ?? `flow:${ref.key}`;
  const res = await evaluateDecisionFlowSteps(
    (row.publishedSteps ?? []) as RuleFlowStep[],
    facts,
    (k) => resolveRuntimeDecisionTable(k, { tenantId: opts.tenantId }),
    (trace, index, scopeAtEval) => {
      if (trace.skipped) return;
      recordRuleExecution({
        refKind: 'table', refId: null, ruleKey: trace.tableKey, version: null,
        caller: opts.caller, source: opts.source ?? 'runtime',
        bizRef: `${stepBase}#step${index + 1}`.slice(0, 128),
        matched: trace.matched, hitPolicy: trace.hitPolicy ?? null,
        input: snapshotRuleScope(scopeAtEval), outputs: trace.outputs, matchedRowIds: trace.matchedRowIds,
        tenantId: row.tenantId ?? null,
      });
    },
  );
  const matched = res.steps.some((s) => !s.skipped && s.matched);
  recordRuleExecution({
    refKind: 'flow', refId: row.id, ruleKey: ref.key, version: row.version,
    caller: opts.caller, source: opts.source ?? 'runtime',
    bizRef: opts.bizRef ?? null,
    matched, hitPolicy: null,
    input: snapshotRuleScope(facts), outputs: res.outputs, matchedRowIds: [],
    tenantId: row.tenantId ?? null,
  });
  return { matched, outputs: res.outputs, ref: { ...ref, version: row.version }, reason: matched ? undefined : 'no_match' };
}

async function decideScorecard(ref: RuleRef, facts: Record<string, unknown>, opts: DecideOptions, mode: 'optional' | 'required'): Promise<RuleDecision> {
  const tenantId = runtimeTenantId(opts.tenantId);
  const row = await resolveRuntimeScorecard(ref.key, tenantId);
  if (!row) return unavailable(ref, mode);
  const res = evaluateScorecard(row.publishedSnapshot as ScorecardLike, snapshotRuleScope(facts));
  const outputs = { totalScore: res.totalScore, baseScore: res.baseScore, grade: res.grade, decision: res.decision };
  recordRuleExecution({
    refKind: 'scorecard', refId: row.id, ruleKey: ref.key, version: row.version,
    caller: opts.caller, source: opts.source ?? 'runtime',
    bizRef: opts.bizRef ?? null,
    matched: true, hitPolicy: null,
    input: snapshotRuleScope(facts), outputs, matchedRowIds: [],
    tenantId: row.tenantId ?? null,
  });
  return { matched: true, outputs, ref: { ...ref, version: row.version } };
}

async function decideList(ref: RuleRef, opts: DecideOptions, mode: 'optional' | 'required'): Promise<RuleDecision> {
  const subjects = (opts.subjects ?? []).map((s) => s?.trim()).filter((s): s is string => !!s);
  const { lists, hits } = await checkRuleListsBatch([ref.key], subjects, { tenantId: opts.tenantId });
  const list = lists.find((l) => l.key === ref.key);
  if (!list) return unavailable(ref, mode);
  const matched = hits.length > 0;
  const outputs = {
    hit: matched,
    listType: list.type,
    matches: hits.map((h) => ({ value: h.value, label: h.label })),
  };
  // 名单判定量大且未命中是常态，仅命中时留痕
  if (matched) {
    recordRuleExecution({
      refKind: 'list', refId: list.id, ruleKey: ref.key, version: null,
      caller: opts.caller, source: opts.source ?? 'runtime',
      bizRef: opts.bizRef ?? null,
      matched: true, hitPolicy: null,
      input: { subjects }, outputs, matchedRowIds: hits.map((h) => h.value),
      tenantId: list.tenantId,
    });
  }
  return { matched, outputs, ref: { ...ref, version: null }, reason: matched ? undefined : 'no_match' };
}
