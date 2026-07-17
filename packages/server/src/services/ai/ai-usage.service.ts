import { sql, eq, and, gte, lte, desc } from 'drizzle-orm';
import { db } from '../../db';
import { aiMessages, aiConversations, aiProviderConfigs, users } from '../../db/schema';
import { parseDateRangeStart, parseDateRangeEnd } from '../../lib/datetime';
import { getAiReliability } from '../../lib/ai/reliability';

export interface UsageRange {
  startDate?: string;
  endDate?: string;
}

/** 消息时间范围条件（基于 ai_messages.created_at） */
function messageRangeConds(range: UsageRange) {
  const conds = [] as ReturnType<typeof gte>[];
  const start = range.startDate ? parseDateRangeStart(range.startDate) : null;
  const end = range.endDate ? parseDateRangeEnd(range.endDate) : null;
  if (start) conds.push(gte(aiMessages.createdAt, start));
  if (end) conds.push(lte(aiMessages.createdAt, end));
  return conds;
}

const MODEL_EXPR = sql<string>`coalesce(${aiMessages.model}, ${aiConversations.providerSnapshot}->>'model', '未知')`;
const TOTAL_TOKENS_EXPR = sql<number>`coalesce(sum(${aiMessages.tokensInput} + ${aiMessages.tokensOutput}),0)::int`;
/** 回复消息数（仅 assistant 角色，统一统计口径） */
const ASSISTANT_COUNT_EXPR = sql<number>`count(*) filter (where ${aiMessages.role} = 'assistant')::int`;
const AVG_TTFT_EXPR = sql<number | null>`round(avg(${aiMessages.ttftMs}))::int`;

/** 模型 → 单价 / 供应商映射（同名模型取第一个配置） */
async function getModelPricingMap() {
  const configs = await db
    .select({
      model: aiProviderConfigs.model,
      provider: aiProviderConfigs.provider,
      priceInputPerM: aiProviderConfigs.priceInputPerM,
      priceOutputPerM: aiProviderConfigs.priceOutputPerM,
    })
    .from(aiProviderConfigs);
  const map = new Map<string, { provider: string; priceInputPerM: number | null; priceOutputPerM: number | null }>();
  for (const c of configs) {
    if (!map.has(c.model)) {
      map.set(c.model, { provider: c.provider, priceInputPerM: c.priceInputPerM, priceOutputPerM: c.priceOutputPerM });
    }
  }
  return map;
}

/** 按单价估算成本（分）：tokens / 1,000,000 × 单价；未配置单价返回 null */
function estimateCostFen(
  tokensInput: number,
  tokensOutput: number,
  pricing?: { priceInputPerM: number | null; priceOutputPerM: number | null },
): number | null {
  if (!pricing || (pricing.priceInputPerM == null && pricing.priceOutputPerM == null)) return null;
  const inputCost = pricing.priceInputPerM != null ? (tokensInput / 1_000_000) * pricing.priceInputPerM : 0;
  const outputCost = pricing.priceOutputPerM != null ? (tokensOutput / 1_000_000) * pricing.priceOutputPerM : 0;
  return Math.round((inputCost + outputCost) * 100) / 100;
}

export async function getUsageOverview(range: UsageRange) {
  const msgConds = messageRangeConds(range);
  const msgWhere = msgConds.length ? and(...msgConds) : undefined;

  // 对话数 / 活跃用户：以「在范围内有消息」的对话为准
  const [aggMsg] = await db
    .select({
      totalMessages: ASSISTANT_COUNT_EXPR,
      tokensInput: sql<number>`coalesce(sum(${aiMessages.tokensInput}),0)::int`,
      tokensOutput: sql<number>`coalesce(sum(${aiMessages.tokensOutput}),0)::int`,
      avgTtftMs: AVG_TTFT_EXPR,
    })
    .from(aiMessages)
    .where(msgWhere);

  const [aggConv] = await db
    .select({
      totalConversations: sql<number>`count(distinct ${aiConversations.id})::int`,
      activeUsers: sql<number>`count(distinct ${aiConversations.userId})::int`,
    })
    .from(aiMessages)
    .innerJoin(aiConversations, eq(aiMessages.conversationId, aiConversations.id))
    .where(msgWhere);

  return {
    totalConversations: aggConv?.totalConversations ?? 0,
    totalMessages: aggMsg?.totalMessages ?? 0,
    tokensInput: aggMsg?.tokensInput ?? 0,
    tokensOutput: aggMsg?.tokensOutput ?? 0,
    totalTokens: (aggMsg?.tokensInput ?? 0) + (aggMsg?.tokensOutput ?? 0),
    activeUsers: aggConv?.activeUsers ?? 0,
    avgTtftMs: aggMsg?.avgTtftMs ?? null,
  };
}

export async function getUsageByModel(range: UsageRange) {
  const msgConds = messageRangeConds(range);
  const rows = await db
    .select({
      model: MODEL_EXPR,
      messages: ASSISTANT_COUNT_EXPR,
      tokensInput: sql<number>`coalesce(sum(${aiMessages.tokensInput}),0)::int`,
      tokensOutput: sql<number>`coalesce(sum(${aiMessages.tokensOutput}),0)::int`,
      totalTokens: TOTAL_TOKENS_EXPR,
      avgTtftMs: AVG_TTFT_EXPR,
    })
    .from(aiMessages)
    .innerJoin(aiConversations, eq(aiMessages.conversationId, aiConversations.id))
    .where(msgConds.length ? and(...msgConds) : undefined)
    .groupBy(MODEL_EXPR)
    .orderBy(desc(TOTAL_TOKENS_EXPR));

  const pricingMap = await getModelPricingMap();
  return rows.map((r) => {
    const pricing = pricingMap.get(r.model);
    return {
      ...r,
      provider: pricing?.provider ?? null,
      costFen: estimateCostFen(r.tokensInput, r.tokensOutput, pricing),
    };
  });
}

export async function getUsageByUser(range: UsageRange, limit = 10) {
  const msgConds = messageRangeConds(range);
  const rows = await db
    .select({
      userId: aiConversations.userId,
      username: users.username,
      nickname: users.nickname,
      conversations: sql<number>`count(distinct ${aiConversations.id})::int`,
      messages: ASSISTANT_COUNT_EXPR,
      totalTokens: TOTAL_TOKENS_EXPR,
    })
    .from(aiMessages)
    .innerJoin(aiConversations, eq(aiMessages.conversationId, aiConversations.id))
    .innerJoin(users, eq(aiConversations.userId, users.id))
    .where(msgConds.length ? and(...msgConds) : undefined)
    .groupBy(aiConversations.userId, users.username, users.nickname)
    .orderBy(desc(TOTAL_TOKENS_EXPR))
    .limit(limit);
  return rows;
}

export async function getUsageTrend(range: UsageRange) {
  const msgConds = messageRangeConds(range);
  const dateExpr = sql<string>`to_char(${aiMessages.createdAt}, 'YYYY-MM-DD')`;
  const rows = await db
    .select({
      date: dateExpr,
      messages: ASSISTANT_COUNT_EXPR,
      totalTokens: TOTAL_TOKENS_EXPR,
    })
    .from(aiMessages)
    .where(msgConds.length ? and(...msgConds) : undefined)
    .groupBy(dateExpr)
    .orderBy(dateExpr);
  return rows;
}

/** 仪表盘一次性聚合（概览 + 按模型 + 按用户 Top10 + 按日趋势 + 成功率/成本） */
export async function getUsageStats(range: UsageRange) {
  const [overview, byModel, byUser, trend, reliability] = await Promise.all([
    getUsageOverview(range),
    getUsageByModel(range),
    getUsageByUser(range, 10),
    getUsageTrend(range),
    getAiReliability(range.startDate, range.endDate),
  ]);
  const totalCostFen = Math.round(byModel.reduce((acc, m) => acc + (m.costFen ?? 0), 0) * 100) / 100;
  return {
    overview: { ...overview, totalCostFen, successRate: reliability.successRate },
    byModel,
    byUser,
    trend,
  };
}
