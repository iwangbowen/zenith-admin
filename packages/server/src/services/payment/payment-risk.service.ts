/**
 * 支付风控 Service。
 * 两层裁决：规则中心 payment_risk 决策表（发布即优先接管，输出 block/review/pass）；
 * 原生维度规则（全局/按渠道/按业务类型）：单笔上限、当日累计金额/笔数、名单命中——
 * 黑/白名单统一引用规则中心名单库（blockListKeys/allowListKeys）。
 * 命中动作 block=拦截下单，review=落单挂起进入人工审核队列。
 * 每次命中均落留痕（payment_risk_hits）；审核放行后用户重新下单复用挂起订单继续支付，
 * 拒绝则本地关闭挂起订单（渠道侧从未下单）。
 */
import { and, desc, eq, gte, inArray, isNull, lte, or, sql } from 'drizzle-orm';
import { HTTPException } from 'hono/http-exception';
import { randomInt } from 'node:crypto';
import { db } from '../../db';
import { buildListResult } from '../../lib/list-query';
import {
  paymentOrders,
  paymentRiskHits,
  paymentRiskReviews,
  paymentRiskRules,
  type PaymentOrderRow,
  type PaymentRiskHitRow,
  type PaymentRiskReviewRow,
  type PaymentRiskRuleRow,
} from '../../db/schema';
import { requireRow } from '../../lib/db-assert';
import { currentUser } from '../../lib/context';
import { requireTenantScopeId, tenantCondition, exactTenantCondition } from '../../lib/tenant';
import { buildWhere, keywordCondition, withPagination } from '../../lib/where-helpers';
import logger from '../../lib/logger';
import { pageOffset } from '../../lib/pagination';
import { formatDateTime, formatNullableDateTime, parseDateRangeEnd, parseDateRangeStart } from '../../lib/datetime';
import { recordEvent, processEvent } from './payment-outbox.service';
import { checkRuleListsBatch, type RuleListBatchHit } from '../platform/rules-lists.service';
import { decide } from '../platform/rules-runtime.service';
import { resolveRuntimeDecisionTable } from '../platform/rules.service';
import type { CreatePaymentRiskRuleInput, UpdatePaymentRiskRuleInput } from '@zenith/shared/payment';
import type { PaymentChannel, PaymentRiskDimension, PaymentRiskHit, PaymentRiskReview, PaymentRiskReviewStatus, PaymentRiskRule, PaymentRiskScope } from '@zenith/shared/payment';

export function mapRiskRule(row: PaymentRiskRuleRow): PaymentRiskRule {
  return {
    id: row.id,
    name: row.name,
    scope: row.scope,
    channel: row.channel ?? null,
    bizType: row.bizType ?? null,
    singleLimit: row.singleLimit ?? null,
    dailyLimit: row.dailyLimit ?? null,
    dailyCountLimit: row.dailyCountLimit ?? null,
    blockListKeys: row.blockListKeys ?? [],
    allowListKeys: row.allowListKeys ?? [],
    action: row.action,
    status: row.status,
    remark: row.remark ?? null,
    createdAt: formatDateTime(row.createdAt),
    updatedAt: formatDateTime(row.updatedAt),
  };
}

export interface ListRiskRulesQuery {
  page?: number;
  pageSize?: number;
  scope?: PaymentRiskScope;
  status?: 'enabled' | 'disabled';
}

export async function listRiskRules(q: ListRiskRulesQuery) {
  const page = q.page ?? 1;
  const pageSize = q.pageSize ?? 10;
  const conds = [];
  if (q.scope) conds.push(eq(paymentRiskRules.scope, q.scope));
  if (q.status) conds.push(eq(paymentRiskRules.status, q.status));
  const where = buildWhere(...conds, tenantCondition(paymentRiskRules, currentUser()));
  return buildListResult({
    page,
    pageSize,
    count: () => db.$count(paymentRiskRules, where),
    rows: () => withPagination(db.select().from(paymentRiskRules).where(where).orderBy(desc(paymentRiskRules.id)).$dynamic(), page, pageSize),
    map: mapRiskRule,
  });
}

async function ensureRiskRule(id: number): Promise<PaymentRiskRuleRow> {
  const tc = tenantCondition(paymentRiskRules, currentUser());
  const [row] = await db.select().from(paymentRiskRules).where(and(eq(paymentRiskRules.id, id), tc)).limit(1);
  requireRow(row, '风控规则不存在');
  return row;
}

export async function getRiskRule(id: number): Promise<PaymentRiskRule> {
  return mapRiskRule(await ensureRiskRule(id));
}

function normalizeScopeFields(input: Partial<CreatePaymentRiskRuleInput>): { channel: PaymentChannel | null; bizType: string | null } {
  if (input.scope === 'channel') return { channel: input.channel ?? null, bizType: null };
  if (input.scope === 'bizType') return { channel: null, bizType: input.bizType ?? null };
  return { channel: null, bizType: null };
}

/** 名单引用校验：key 必须存在且启用，黑名单字段只能引用 black/grey 型、白名单字段只能引用 white 型 */
async function ensureListRefs(blockKeys: string[], allowKeys: string[]): Promise<void> {
  const keys = [...new Set([...blockKeys, ...allowKeys])];
  if (keys.length === 0) return;
  const { lists } = await checkRuleListsBatch(keys, []);
  const byKey = new Map(lists.map((l) => [l.key, l]));
  const missing = keys.filter((k) => !byKey.has(k));
  if (missing.length > 0) throw new HTTPException(400, { message: `引用的名单不存在或未启用：${missing.join('、')}` });
  const badBlock = blockKeys.filter((k) => byKey.get(k)!.type === 'white');
  if (badBlock.length > 0) throw new HTTPException(400, { message: `黑名单字段不能引用白名单库：${badBlock.join('、')}` });
  const badAllow = allowKeys.filter((k) => byKey.get(k)!.type !== 'white');
  if (badAllow.length > 0) throw new HTTPException(400, { message: `白名单字段只能引用白名单库：${badAllow.join('、')}` });
}

export async function createRiskRule(input: CreatePaymentRiskRuleInput): Promise<PaymentRiskRule> {
  const tenantId = requireTenantScopeId(currentUser());
  const scoped = normalizeScopeFields(input);
  if (input.scope === 'channel' && !scoped.channel) throw new HTTPException(400, { message: '按渠道规则需指定渠道' });
  if (input.scope === 'bizType' && !scoped.bizType) throw new HTTPException(400, { message: '按业务类型规则需指定业务类型' });
  await ensureListRefs(input.blockListKeys ?? [], input.allowListKeys ?? []);
  const [row] = await db
    .insert(paymentRiskRules)
    .values({
      name: input.name,
      scope: input.scope ?? 'global',
      channel: scoped.channel,
      bizType: scoped.bizType,
      singleLimit: input.singleLimit ?? null,
      dailyLimit: input.dailyLimit ?? null,
      dailyCountLimit: input.dailyCountLimit ?? null,
      blockListKeys: input.blockListKeys ?? [],
      allowListKeys: input.allowListKeys ?? [],
      action: input.action ?? 'block',
      status: input.status ?? 'enabled',
      remark: input.remark ?? null,
      tenantId,
    })
    .returning();
  return mapRiskRule(row);
}

export async function updateRiskRule(id: number, input: UpdatePaymentRiskRuleInput): Promise<PaymentRiskRule> {
  requireTenantScopeId(currentUser());
  const existing = await ensureRiskRule(id);
  const set: Partial<PaymentRiskRuleRow> = {};
  if (input.name !== undefined) set.name = input.name;
  const nextScope = input.scope ?? existing.scope;
  if (input.scope !== undefined || input.channel !== undefined || input.bizType !== undefined) {
    const scoped = normalizeScopeFields({ scope: nextScope, channel: input.channel ?? existing.channel ?? undefined, bizType: input.bizType ?? existing.bizType ?? undefined });
    if (nextScope === 'channel' && !scoped.channel) throw new HTTPException(400, { message: '按渠道规则需指定渠道' });
    if (nextScope === 'bizType' && !scoped.bizType) throw new HTTPException(400, { message: '按业务类型规则需指定业务类型' });
    set.scope = nextScope;
    set.channel = scoped.channel;
    set.bizType = scoped.bizType;
  }
  if (input.singleLimit !== undefined) set.singleLimit = input.singleLimit ?? null;
  if (input.dailyLimit !== undefined) set.dailyLimit = input.dailyLimit ?? null;
  if (input.dailyCountLimit !== undefined) set.dailyCountLimit = input.dailyCountLimit ?? null;
  if (input.blockListKeys !== undefined || input.allowListKeys !== undefined) {
    const nextBlock = input.blockListKeys ?? existing.blockListKeys ?? [];
    const nextAllow = input.allowListKeys ?? existing.allowListKeys ?? [];
    await ensureListRefs(nextBlock, nextAllow);
    set.blockListKeys = nextBlock;
    set.allowListKeys = nextAllow;
  }
  if (input.action !== undefined) set.action = input.action;
  if (input.status !== undefined) set.status = input.status;
  if (input.remark !== undefined) set.remark = input.remark ?? null;
  const tc = tenantCondition(paymentRiskRules, currentUser());
  const [row] = await db.update(paymentRiskRules).set(set).where(and(eq(paymentRiskRules.id, id), tc)).returning();
  return mapRiskRule(row);
}

export async function deleteRiskRule(id: number): Promise<void> {
  requireTenantScopeId(currentUser());
  await ensureRiskRule(id);
  await db.delete(paymentRiskRules).where(eq(paymentRiskRules.id, id));
}

// ─── 下单风控评估 ─────────────────────────────────────────────────────────────
export interface RiskCheckInput {
  channel: PaymentChannel;
  bizType: string;
  bizId: string;
  amount: number;
  openId?: string | null;
  userId?: number | null;
  clientIp?: string | null;
  tenantId?: number | null;
}

export type RiskDecision =
  | { action: 'pass' }
  | { action: 'block' | 'review'; ruleId: number | null; ruleName: string; dimension: PaymentRiskDimension; dimensionValue: string; message: string };

function ruleApplies(rule: PaymentRiskRuleRow, input: RiskCheckInput): boolean {
  if (rule.scope === 'global') return true;
  if (rule.scope === 'channel') return rule.channel === input.channel;
  if (rule.scope === 'bizType') return rule.bizType === input.bizType;
  return false;
}

function startOfToday(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

/** 参与名单匹配的标识集合（openid / 用户ID / 客户端IP） */
function identifiersOf(input: RiskCheckInput): string[] {
  return [input.openId, input.userId != null ? String(input.userId) : null, input.clientIp].filter((v): v is string => !!v);
}

/**
 * 当日已支付订单的金额/笔数聚合，按 scope 在单次评估内复用。
 *
 * 聚合条件只由 `rule.scope` 决定——channel / bizType 的取值来自本次下单入参而非规则本身，
 * 所以 N 条规则最多只有 global / channel / bizType 三种查询。保持按需触发：
 * 没有配日限额的规则不会产生任何查询，短路返回的语义也与逐条查询时一致。
 */
function createDailyStatsLoader(input: RiskCheckInput) {
  const cache = new Map<PaymentRiskScope, Promise<{ total: number; count: number }>>();
  return (scope: PaymentRiskScope): Promise<{ total: number; count: number }> => {
    const cached = cache.get(scope);
    if (cached) return cached;
    const scopeConds = [gte(paymentOrders.paidAt, startOfToday()), inArray(paymentOrders.status, ['success', 'refunding', 'refunded'])];
    if (scope === 'channel') scopeConds.push(eq(paymentOrders.channel, input.channel));
    if (scope === 'bizType') scopeConds.push(eq(paymentOrders.bizType, input.bizType));
    const where = and(...scopeConds, exactTenantCondition(paymentOrders.tenantId, input.tenantId ?? null));
    const pending = db
      .select({ total: sql<number>`coalesce(sum(${paymentOrders.amount}),0)`, count: sql<number>`count(*)` })
      .from(paymentOrders)
      .where(where)
      .then(([agg]) => ({ total: Number(agg?.total ?? 0), count: Number(agg?.count ?? 0) }));
    cache.set(scope, pending);
    return pending;
  };
}

/**
 * 下单前风控评估，两层裁决：
 * 1. 决策表策略层（规则中心 payment_risk 表，已发布时优先）：服务端组装事实
 *    （单笔/当日聚合/名单命中/主体标识）交由决策表裁决，命中即权威结论——
 *    block/review 直接生效，pass 为显式放行（跳过原生维度）；未命中或未发布回退第 2 层。
 * 2. 原生维度层：按启用规则依次检查白名单（跳过）、黑名单、单笔上限、当日累计金额/笔数。
 * 黑/白名单统一引用规则中心名单库（blockListKeys/allowListKeys），整批一次判定。
 * 返回第一条命中的决策（block/review）；全部通过返回 pass。不抛异常，由调用方决定拦截/挂起。
 */
export async function evaluateRisk(input: RiskCheckInput): Promise<RiskDecision> {
  const tenantCond = input.tenantId == null ? isNull(paymentRiskRules.tenantId) : or(eq(paymentRiskRules.tenantId, input.tenantId), isNull(paymentRiskRules.tenantId));
  const rules = await db.select().from(paymentRiskRules).where(and(eq(paymentRiskRules.status, 'enabled'), tenantCond));
  const applicable = rules.filter((r) => ruleApplies(r, input));

  const identifiers = identifiersOf(input);
  const dailyStats = createDailyStatsLoader(input);

  // 名单批量判定：一次解析全部引用名单（keys × 标识全组合，2~3 条 SQL）
  const allKeys = [...new Set(applicable.flatMap((r) => [...(r.allowListKeys ?? []), ...(r.blockListKeys ?? [])]))];
  const listHits = allKeys.length > 0 && identifiers.length > 0
    ? (await checkRuleListsBatch(allKeys, identifiers, { tenantId: input.tenantId ?? null })).hits
    : [];
  const hitsByKey = new Map<string, RuleListBatchHit[]>();
  for (const h of listHits) {
    const arr = hitsByKey.get(h.key) ?? [];
    arr.push(h);
    hitsByKey.set(h.key, arr);
  }

  // 第 1 层：决策表策略（未发布/未命中返回 null 回退原生维度）
  const verdict = await evaluateRiskDecisionTable(input, hitsByKey, dailyStats);
  if (verdict) return verdict;

  // 第 2 层：原生维度
  for (const rule of applicable) {
    // 白名单：任一引用名单命中任一标识则跳过本规则全部检查
    if ((rule.allowListKeys ?? []).some((k) => hitsByKey.get(k)?.length)) continue;
    // 黑名单：任一引用名单命中即触发动作
    const blockKey = (rule.blockListKeys ?? []).find((k) => hitsByKey.get(k)?.length);
    if (blockKey) {
      const hit = hitsByKey.get(blockKey)![0];
      return { action: rule.action, ruleId: rule.id, ruleName: rule.name, dimension: 'blocklist', dimensionValue: `${hit.value}@${blockKey}`, message: `命中名单「${blockKey}」（${rule.name}）` };
    }
    // 单笔上限
    if (rule.singleLimit != null && input.amount > rule.singleLimit) {
      return { action: rule.action, ruleId: rule.id, ruleName: rule.name, dimension: 'single_limit', dimensionValue: `${input.amount} > ${rule.singleLimit}`, message: `单笔金额超过限额（${rule.name}）` };
    }
    // 当日累计金额 / 笔数（按规则作用域聚合当日已支付订单；未支付的 pending/paying 不计入，避免误伤正常下单）
    if (rule.dailyLimit != null || rule.dailyCountLimit != null) {
      const { total: dayTotal, count: dayCount } = await dailyStats(rule.scope);
      if (rule.dailyLimit != null && dayTotal + input.amount > rule.dailyLimit) {
        return { action: rule.action, ruleId: rule.id, ruleName: rule.name, dimension: 'daily_limit', dimensionValue: `${dayTotal} + ${input.amount} > ${rule.dailyLimit}`, message: `当日累计金额超过限额（${rule.name}）` };
      }
      if (rule.dailyCountLimit != null && dayCount + 1 > rule.dailyCountLimit) {
        return { action: rule.action, ruleId: rule.id, ruleName: rule.name, dimension: 'daily_count', dimensionValue: `${dayCount} + 1 > ${rule.dailyCountLimit}`, message: `当日交易笔数超过限额（${rule.name}）` };
      }
    }
  }
  return { action: 'pass' };
}

/** 规则中心策略表 key（约定引用）：发布即接管裁决，停用/删除自动回退原生维度 */
const RISK_DECISION_TABLE_KEY = 'payment_risk';

/**
 * 决策表策略层：payment_risk 表已发布时组装事实求值。
 * 返回 null 表示不裁决（未发布/未命中/输出无有效动作），回退原生维度。
 */
async function evaluateRiskDecisionTable(
  input: RiskCheckInput,
  hitsByKey: Map<string, RuleListBatchHit[]>,
  dailyStats: (scope: PaymentRiskScope) => Promise<{ total: number; count: number }>,
): Promise<RiskDecision | null> {
  // 先廉价探测可用性（带缓存），避免为不存在的表白算当日聚合
  const snapshot = await resolveRuntimeDecisionTable(RISK_DECISION_TABLE_KEY, { tenantId: input.tenantId ?? null });
  if (!snapshot) return null;
  const [global, channel, biz] = await Promise.all([dailyStats('global'), dailyStats('channel'), dailyStats('bizType')]);
  const hits = [...hitsByKey.entries()].filter(([, arr]) => arr.length > 0);
  const blackEntry = hits.find(([, arr]) => arr[0].listType !== 'white');
  const whiteEntry = hits.find(([, arr]) => arr[0].listType === 'white');
  const facts = {
    order: { amount: input.amount, channel: input.channel, bizType: input.bizType },
    today: { amount: global.total, count: global.count, channelAmount: channel.total, channelCount: channel.count, bizAmount: biz.total, bizCount: biz.count },
    hit: { black: blackEntry?.[0] ?? '', white: whiteEntry?.[0] ?? '', value: blackEntry?.[1][0]?.value ?? '' },
    subject: { openId: input.openId ?? '', userId: input.userId ?? null, ip: input.clientIp ?? '' },
  };
  const decision = await decide({ kind: 'table', key: RISK_DECISION_TABLE_KEY }, facts, { caller: 'payment.risk', tenantId: input.tenantId ?? null, bizRef: `payment:${input.bizType}:${input.bizId}`.slice(0, 128) });
  if (!decision.matched) return null;
  const action = String(decision.outputs.action ?? '');
  if (action === 'pass') return { action: 'pass' };
  if (action !== 'block' && action !== 'review') return null;
  const reason = typeof decision.outputs.reason === 'string' && decision.outputs.reason ? decision.outputs.reason : '命中支付风控策略';
  return {
    action,
    ruleId: null,
    ruleName: `决策表 ${RISK_DECISION_TABLE_KEY}`,
    dimension: 'decision',
    dimensionValue: `${RISK_DECISION_TABLE_KEY} v${decision.ref.version ?? '-'}`,
    message: reason,
  };
}

// ─── 命中留痕 ─────────────────────────────────────────────────────────────────

function mapRiskHit(row: PaymentRiskHitRow): PaymentRiskHit {
  return {
    id: row.id,
    ruleId: row.ruleId ?? null,
    ruleName: row.ruleName,
    action: row.action,
    dimension: row.dimension,
    dimensionValue: row.dimensionValue ?? null,
    channel: row.channel,
    bizType: row.bizType,
    bizId: row.bizId,
    orderNo: row.orderNo ?? null,
    amount: row.amount,
    openId: row.openId ?? null,
    userId: row.userId ?? null,
    clientIp: row.clientIp ?? null,
    createdAt: formatDateTime(row.createdAt),
  };
}

/** 记录一次风控命中（block 无订单号；review 关联挂起订单号）。返回留痕 id。 */
export async function recordRiskHit(decision: Exclude<RiskDecision, { action: 'pass' }>, input: RiskCheckInput, orderNo?: string): Promise<number> {
  const [row] = await db
    .insert(paymentRiskHits)
    .values({
      ruleId: decision.ruleId,
      ruleName: decision.ruleName,
      action: decision.action,
      dimension: decision.dimension,
      dimensionValue: decision.dimensionValue.slice(0, 256),
      channel: input.channel,
      bizType: input.bizType,
      bizId: input.bizId,
      orderNo: orderNo ?? null,
      amount: input.amount,
      openId: input.openId ?? null,
      userId: input.userId ?? null,
      clientIp: input.clientIp ?? null,
      tenantId: input.tenantId ?? null,
    })
    .returning({ id: paymentRiskHits.id });
  return row.id;
}

export interface ListRiskHitsQuery {
  page?: number;
  pageSize?: number;
  keyword?: string;
  action?: 'block' | 'review';
  dimension?: PaymentRiskDimension;
  channel?: PaymentChannel;
  startTime?: string;
  endTime?: string;
}

export async function listRiskHits(q: ListRiskHitsQuery) {
  const page = q.page ?? 1;
  const pageSize = q.pageSize ?? 10;
  const conds = [];
  conds.push(keywordCondition(q.keyword, [paymentRiskHits.ruleName, paymentRiskHits.bizId, paymentRiskHits.orderNo]));
  if (q.action) conds.push(eq(paymentRiskHits.action, q.action));
  if (q.dimension) conds.push(eq(paymentRiskHits.dimension, q.dimension));
  if (q.channel) conds.push(eq(paymentRiskHits.channel, q.channel));
  const start = parseDateRangeStart(q.startTime);
  const end = parseDateRangeEnd(q.endTime);
  if (start) conds.push(gte(paymentRiskHits.createdAt, start));
  if (end) conds.push(lte(paymentRiskHits.createdAt, end));
  const where = buildWhere(...conds, tenantCondition(paymentRiskHits, currentUser()));
  return buildListResult({
    page,
    pageSize,
    count: () => db.$count(paymentRiskHits, where),
    rows: () => withPagination(db.select().from(paymentRiskHits).where(where).orderBy(desc(paymentRiskHits.id)).$dynamic(), page, pageSize),
    map: mapRiskHit,
  });
}

// ─── 人工审核队列 ─────────────────────────────────────────────────────────────

function genReviewNo(): string {
  return `RSK${Date.now()}${randomInt(1000, 9999)}`;
}

function mapRiskReview(row: PaymentRiskReviewRow & { reviewer?: { nickname: string | null } | null }): PaymentRiskReview {
  return {
    id: row.id,
    reviewNo: row.reviewNo,
    hitId: row.hitId ?? null,
    orderNo: row.orderNo,
    channel: row.channel,
    appId: row.appId,
    currency: row.currency,
    bizType: row.bizType,
    bizId: row.bizId,
    amount: row.amount,
    reason: row.reason,
    status: row.status,
    reviewerName: row.reviewer?.nickname ?? null,
    reviewedAt: formatNullableDateTime(row.reviewedAt),
    reviewRemark: row.reviewRemark ?? null,
    createdAt: formatDateTime(row.createdAt),
    updatedAt: formatDateTime(row.updatedAt),
  };
}

/** 下单前置校验：同业务单存在待审核记录时禁止重复下单（等待审核结论） */
export async function assertNoPendingRiskReview(input: {
  bizType: string;
  bizId: string;
  tenantId: number | null;
  appId: number | null;
  currency: string;
}): Promise<void> {
  const [row] = await db
    .select({ reviewNo: paymentRiskReviews.reviewNo })
    .from(paymentRiskReviews)
    .where(and(
      eq(paymentRiskReviews.bizType, input.bizType),
      eq(paymentRiskReviews.bizId, input.bizId),
      exactTenantCondition(paymentRiskReviews.tenantId, input.tenantId),
      input.appId == null ? isNull(paymentRiskReviews.appId) : eq(paymentRiskReviews.appId, input.appId),
      eq(paymentRiskReviews.currency, input.currency),
      eq(paymentRiskReviews.status, 'pending'),
    ))
    .limit(1);
  if (row) throw new HTTPException(400, { message: `该交易正在风控人工审核中（审核单 ${row.reviewNo}），请等待审核结果` });
}

/** review 动作：为已落库的挂起订单创建审核单（订单不调渠道，支付窗口延长至 24h 等待审核） */
export async function suspendOrderForReview(order: PaymentOrderRow, decision: Exclude<RiskDecision, { action: 'pass' }>, input: RiskCheckInput): Promise<PaymentRiskReviewRow> {
  const hitId = await recordRiskHit(decision, input, order.orderNo);
  const [review] = await db
    .insert(paymentRiskReviews)
    .values({
      reviewNo: genReviewNo(),
      hitId,
      orderNo: order.orderNo,
      channel: order.channel,
      bizType: order.bizType,
      bizId: order.bizId,
      amount: order.amount,
      appId: order.appId,
      currency: order.currency,
      reason: `${decision.message}；${decision.dimensionValue}`.slice(0, 256),
      status: 'pending',
      tenantId: order.tenantId,
    })
    .returning();
  await db.update(paymentOrders).set({ expiredAt: new Date(Date.now() + 24 * 60 * 60 * 1000) }).where(eq(paymentOrders.id, order.id));
  return review;
}

export interface ListRiskReviewsQuery {
  page?: number;
  pageSize?: number;
  keyword?: string;
  status?: PaymentRiskReviewStatus;
  channel?: PaymentChannel;
}

export async function listRiskReviews(q: ListRiskReviewsQuery) {
  const page = q.page ?? 1;
  const pageSize = q.pageSize ?? 10;
  const conds = [];
  conds.push(keywordCondition(q.keyword, [paymentRiskReviews.reviewNo, paymentRiskReviews.orderNo, paymentRiskReviews.bizId]));
  if (q.status) conds.push(eq(paymentRiskReviews.status, q.status));
  if (q.channel) conds.push(eq(paymentRiskReviews.channel, q.channel));
  const where = buildWhere(...conds, tenantCondition(paymentRiskReviews, currentUser()));
  return buildListResult({
    page,
    pageSize,
    count: () => db.$count(paymentRiskReviews, where),
    rows: () => db.query.paymentRiskReviews.findMany({
      where,
      with: { reviewer: { columns: { nickname: true } } },
      orderBy: desc(paymentRiskReviews.id),
      limit: pageSize,
      offset: pageOffset(page, pageSize),
    }),
    map: mapRiskReview,
  });
}

async function ensureRiskReview(id: number): Promise<PaymentRiskReviewRow> {
  const tc = tenantCondition(paymentRiskReviews, currentUser());
  const [row] = await db.select().from(paymentRiskReviews).where(and(eq(paymentRiskReviews.id, id), tc)).limit(1);
  requireRow(row, '审核单不存在');
  return row;
}

/** 审计 before 数据（路由层用，不存在时返回 undefined 不抛错） */
export async function findRiskReviewById(id: number): Promise<PaymentRiskReviewRow | undefined> {
  const [row] = await db
    .select()
    .from(paymentRiskReviews)
    .where(and(eq(paymentRiskReviews.id, id), tenantCondition(paymentRiskReviews, currentUser())))
    .limit(1);
  return row;
}

/**
 * 审核放行：审核单置 approved，挂起订单支付窗口再延长 24h；
 * 用户重新发起支付时业务幂等复用该订单继续调渠道（审核单已非 pending，不再拦截）。
 */
export async function approveRiskReview(id: number, remark?: string): Promise<PaymentRiskReview> {
  requireTenantScopeId(currentUser());
  if (!remark?.trim()) throw new HTTPException(400, { message: '审核意见不能为空' });
  const row = await ensureRiskReview(id);
  if (row.status !== 'pending') throw new HTTPException(400, { message: '该审核单已处理' });
  const [updated] = await db
    .update(paymentRiskReviews)
    .set({ status: 'approved', reviewerId: currentUser().userId, reviewedAt: new Date(), reviewRemark: remark.trim() })
    .where(and(eq(paymentRiskReviews.id, id), eq(paymentRiskReviews.status, 'pending')))
    .returning();
  if (!updated) throw new HTTPException(400, { message: '该审核单已被并发处理' });
  await db
    .update(paymentOrders)
    .set({ expiredAt: new Date(Date.now() + 24 * 60 * 60 * 1000) })
    .where(and(
      eq(paymentOrders.orderNo, row.orderNo),
      exactTenantCondition(paymentOrders.tenantId, row.tenantId),
      inArray(paymentOrders.status, ['pending', 'paying']),
    ));
  return mapRiskReview(updated);
}

/** 审核拒绝：审核单置 rejected 并本地关闭挂起订单（渠道侧从未下单，无需渠道关单） */
export async function rejectRiskReview(id: number, remark?: string): Promise<PaymentRiskReview> {
  requireTenantScopeId(currentUser());
  if (!remark?.trim()) throw new HTTPException(400, { message: '审核意见不能为空' });
  const row = await ensureRiskReview(id);
  if (row.status !== 'pending') throw new HTTPException(400, { message: '该审核单已处理' });
  const result = await db.transaction(async (tx) => {
    const [updated] = await tx
      .update(paymentRiskReviews)
      .set({ status: 'rejected', reviewerId: currentUser().userId, reviewedAt: new Date(), reviewRemark: remark.trim() })
      .where(and(eq(paymentRiskReviews.id, id), eq(paymentRiskReviews.status, 'pending')))
      .returning();
    if (!updated) throw new HTTPException(409, { message: '该审核单已被并发处理' });
    const [order] = await tx
      .select()
      .from(paymentOrders)
      .where(and(
        eq(paymentOrders.orderNo, row.orderNo),
        exactTenantCondition(paymentOrders.tenantId, row.tenantId),
      ))
      .limit(1);
    let eventId: number | null = null;
    if (order && (order.status === 'pending' || order.status === 'paying')) {
      const closed = await tx
        .update(paymentOrders)
        .set({ status: 'closed', errorMessage: '风控审核拒绝', version: sql`${paymentOrders.version} + 1` })
        .where(and(eq(paymentOrders.id, order.id), inArray(paymentOrders.status, ['pending', 'paying'])))
        .returning({ id: paymentOrders.id });
      if (closed.length > 0) {
        eventId = await recordEvent(tx, {
          type: 'payment.closed',
          orderNo: order.orderNo,
          tenantId: order.tenantId,
          payload: {
            type: 'payment.closed',
            orderNo: order.orderNo,
            outTradeNo: order.outTradeNo,
            bizType: order.bizType,
            bizId: order.bizId,
            channel: order.channel,
            channelConfigId: order.channelConfigId,
            appId: order.appId,
            currency: order.currency,
            amount: order.amount,
            userId: order.userId,
            tenantId: order.tenantId,
          },
        });
      }
    }
    return { updated, eventId };
  });
  if (result.eventId != null) {
    setImmediate(() => {
      void processEvent(result.eventId!).catch((err) => logger.error('[payment-risk] process event failed', { eventId: result.eventId, err }));
    });
  }
  return mapRiskReview(result.updated);
}
