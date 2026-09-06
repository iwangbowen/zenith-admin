/**
 * 营销活动（抽奖）服务。
 *
 * 抽奖并发安全：
 * - 同会员同活动用 pg advisory 事务锁串行化，防止并发绕过次数限制；
 * - 奖品库存用「UPDATE ... WHERE stock > 0 RETURNING」原子扣减，抢不到降级为未中奖；
 * - 奖励发放在抽奖事务提交后执行（changePoints / issueCoupon 自带事务与重试），
 *   失败标记 grantStatus=failed 留痕，不回滚已扣库存（可人工补发），保证抽奖动作最终一致。
 */
import { and, count, desc, eq, gte, inArray, sql, type SQL } from 'drizzle-orm';
import { HTTPException } from 'hono/http-exception';
import type { CreateMarketingCampaignInput, SaveMarketingPrizeInput, UpdateMarketingCampaignInput, MarketingDrawResult } from '@zenith/shared/marketing';
import { db } from '../../db';
import {
  marketingCampaigns, marketingParticipations, marketingPrizes,
  coupons, members, shortLinks,
  type MarketingCampaignRow, type MarketingPrizeRow, type MarketingParticipationRow,
} from '../../db/schema';
import { formatDateTime, parseDateTimeInput } from '../../lib/datetime';
import logger from '../../lib/logger';
import { buildWhere, dateRangeConditions, keywordCondition, withPagination } from '../../lib/where-helpers';
import { currentUser } from '../../lib/context';
import { requireRow } from '../../lib/db-assert';
import { buildListResult } from '../../lib/list-query';
import { tenantCondition, getCreateTenantId } from '../../lib/tenant';
import { buildShortUrl, ensureShortLink } from '../short-link/short-link.service';
import { changePoints } from '../member/member-points.service';
import { issueCoupon } from '../member/coupons.service';
import { notify } from '../messaging/notification-outbox.service';

// ─── 数据映射 ─────────────────────────────────────────────────────────────────
export function mapMarketingCampaign(row: MarketingCampaignRow, extra?: { participationCount?: number; awardCount?: number; shortUrl?: string | null }) {
  return {
    id: row.id,
    name: row.name,
    type: row.type,
    status: row.status,
    startAt: formatDateTime(row.startAt),
    endAt: formatDateTime(row.endAt),
    perMemberLimit: row.perMemberLimit,
    dailyPerMemberLimit: row.dailyPerMemberLimit ?? null,
    landingUrl: row.landingUrl ?? null,
    shortUrl: extra?.shortUrl ?? null,
    description: row.description ?? null,
    participationCount: extra?.participationCount ?? 0,
    awardCount: extra?.awardCount ?? 0,
    createdBy: row.createdBy ?? null,
    updatedBy: row.updatedBy ?? null,
    createdAt: formatDateTime(row.createdAt),
    updatedAt: formatDateTime(row.updatedAt),
  };
}

export function mapMarketingPrize(row: MarketingPrizeRow, couponName: string | null = null) {
  return {
    id: row.id,
    campaignId: row.campaignId,
    name: row.name,
    prizeType: row.prizeType,
    points: row.points ?? null,
    couponId: row.couponId ?? null,
    couponName,
    stock: row.stock,
    totalStock: row.totalStock,
    weight: row.weight,
    sort: row.sort,
    createdAt: formatDateTime(row.createdAt),
    updatedAt: formatDateTime(row.updatedAt),
  };
}

function mapParticipation(row: MarketingParticipationRow, memberNickname: string | null = null) {
  return {
    id: row.id,
    campaignId: row.campaignId,
    memberId: row.memberId,
    memberNickname,
    prizeId: row.prizeId ?? null,
    prizeName: row.prizeName ?? null,
    grantStatus: row.grantStatus,
    grantNote: row.grantNote ?? null,
    createdAt: formatDateTime(row.createdAt),
  };
}

// ─── 活动 CRUD ────────────────────────────────────────────────────────────────
export interface ListMarketingCampaignsQuery {
  page?: number;
  pageSize?: number;
  keyword?: string;
  status?: 'draft' | 'published' | 'ended';
  startTime?: string;
  endTime?: string;
}

function buildCampaignWhere(q: ListMarketingCampaignsQuery & { id?: number }): SQL | undefined {
  return buildWhere(
    q.id !== undefined ? eq(marketingCampaigns.id, q.id) : undefined,
    keywordCondition(q.keyword, [marketingCampaigns.name, marketingCampaigns.description]),
    q.status ? eq(marketingCampaigns.status, q.status) : undefined,
    ...dateRangeConditions(marketingCampaigns.createdAt, q.startTime, q.endTime),
    tenantCondition(marketingCampaigns, currentUser()),
  );
}

export async function listMarketingCampaigns(q: ListMarketingCampaignsQuery) {
  const { page = 1, pageSize = 10 } = q;
  const where = buildCampaignWhere(q);
  const { list: rows, total } = await buildListResult({
    page,
    pageSize,
    count: () => db.$count(marketingCampaigns, where),
    rows: () => withPagination(
      db.select().from(marketingCampaigns).where(where).orderBy(desc(marketingCampaigns.id)).$dynamic(),
      page,
      pageSize,
    ),
  });

  const ids = rows.map((r) => r.id);
  const [statRows, linkRows] = ids.length
    ? await Promise.all([
      db
        .select({
          campaignId: marketingParticipations.campaignId,
          participations: count(),
          awards: count(marketingParticipations.prizeId),
        })
        .from(marketingParticipations)
        .where(inArray(marketingParticipations.campaignId, ids))
        .groupBy(marketingParticipations.campaignId),
      db
        .select({ bizRef: shortLinks.bizRef, code: shortLinks.code })
        .from(shortLinks)
        .where(and(eq(shortLinks.bizType, 'marketing'), inArray(shortLinks.bizRef, ids.map(String)))),
    ])
    : [[], []];
  const statMap = new Map(statRows.map((s) => [s.campaignId, s]));
  const linkMap = new Map(linkRows
    .filter((r): r is typeof r & { bizRef: string } => r.bizRef !== null)
    .map((r) => [Number(r.bizRef), buildShortUrl(r.code)]));

  return {
    list: rows.map((row) => mapMarketingCampaign(row, {
      participationCount: Number(statMap.get(row.id)?.participations ?? 0),
      awardCount: Number(statMap.get(row.id)?.awards ?? 0),
      shortUrl: linkMap.get(row.id) ?? null,
    })),
    total,
    page,
    pageSize,
  };
}

export async function ensureMarketingCampaignExists(id: number): Promise<MarketingCampaignRow> {
  const [row] = await db.select().from(marketingCampaigns).where(buildCampaignWhere({ id })).limit(1);
  return requireRow(row, '营销活动不存在');
}

export async function getMarketingCampaign(id: number) {
  const row = await ensureMarketingCampaignExists(id);
  const [link] = await db
    .select({ code: shortLinks.code })
    .from(shortLinks)
    .where(and(eq(shortLinks.bizType, 'marketing'), eq(shortLinks.bizRef, String(id))))
    .limit(1);
  return mapMarketingCampaign(row, { shortUrl: link ? buildShortUrl(link.code) : null });
}

function parseWindow(input: { startAt?: string; endAt?: string }, current?: MarketingCampaignRow) {
  const startAt = input.startAt !== undefined ? parseDateTimeInput(input.startAt) : current?.startAt ?? null;
  const endAt = input.endAt !== undefined ? parseDateTimeInput(input.endAt) : current?.endAt ?? null;
  if (!startAt || !endAt) throw new HTTPException(400, { message: '活动时间格式不正确' });
  if (endAt.getTime() <= startAt.getTime()) throw new HTTPException(400, { message: '结束时间必须晚于开始时间' });
  return { startAt, endAt };
}

export async function createMarketingCampaign(data: CreateMarketingCampaignInput) {
  const { startAt, endAt } = parseWindow(data);
  const [row] = await db.insert(marketingCampaigns).values({
    name: data.name,
    startAt,
    endAt,
    perMemberLimit: data.perMemberLimit,
    dailyPerMemberLimit: data.dailyPerMemberLimit ?? null,
    landingUrl: data.landingUrl ?? null,
    description: data.description ?? null,
    tenantId: getCreateTenantId(currentUser()),
  }).returning();
  return mapMarketingCampaign(row);
}

export async function updateMarketingCampaign(id: number, data: UpdateMarketingCampaignInput) {
  const current = await ensureMarketingCampaignExists(id);
  if (current.status === 'ended') throw new HTTPException(400, { message: '已结束的活动不可修改' });
  const { startAt, endAt } = parseWindow(data, current);
  const [row] = await db.update(marketingCampaigns).set({
    ...(data.name !== undefined ? { name: data.name } : {}),
    startAt,
    endAt,
    ...(data.perMemberLimit !== undefined ? { perMemberLimit: data.perMemberLimit } : {}),
    ...(data.dailyPerMemberLimit !== undefined ? { dailyPerMemberLimit: data.dailyPerMemberLimit } : {}),
    ...(data.landingUrl !== undefined ? { landingUrl: data.landingUrl } : {}),
    ...(data.description !== undefined ? { description: data.description } : {}),
  }).where(buildCampaignWhere({ id })).returning();
  return mapMarketingCampaign(requireRow(row, '营销活动不存在'));
}

export async function deleteMarketingCampaign(id: number): Promise<void> {
  const row = await ensureMarketingCampaignExists(id);
  if (row.status === 'published') throw new HTTPException(400, { message: '进行中的活动不可删除，请先结束' });
  await db.delete(marketingCampaigns).where(buildCampaignWhere({ id }));
}

/** 发布：需至少配置一个奖品；配置了落地页时幂等生成分享短链 */
export async function publishMarketingCampaign(id: number) {
  const row = await ensureMarketingCampaignExists(id);
  if (row.status === 'published') throw new HTTPException(400, { message: '活动已是进行中状态' });
  const prizeCount = await db.$count(marketingPrizes, eq(marketingPrizes.campaignId, id));
  if (prizeCount === 0) throw new HTTPException(400, { message: '请先配置奖品再发布' });
  const [updated] = await db.update(marketingCampaigns).set({ status: 'published' })
    .where(buildCampaignWhere({ id })).returning();
  if (row.landingUrl) {
    try {
      await ensureShortLink({
        targetUrl: row.landingUrl,
        bizType: 'marketing',
        bizRef: String(id),
        title: row.name,
        tenantId: row.tenantId ?? null,
      });
    } catch (err) {
      logger.warn(`[marketing] 活动 #${id} 分享短链生成失败`, err);
    }
  }
  return getMarketingCampaign(updated.id);
}

export async function endMarketingCampaign(id: number) {
  const row = await ensureMarketingCampaignExists(id);
  if (row.status !== 'published') throw new HTTPException(400, { message: '仅进行中的活动可结束' });
  const [updated] = await db.update(marketingCampaigns).set({ status: 'ended' })
    .where(buildCampaignWhere({ id })).returning();
  return mapMarketingCampaign(updated);
}

// ─── 奖品管理 ─────────────────────────────────────────────────────────────────
async function ensureCouponUsable(couponId: number | null | undefined): Promise<void> {
  if (!couponId) return;
  const [row] = await db.select({ id: coupons.id }).from(coupons).where(eq(coupons.id, couponId)).limit(1);
  if (!row) throw new HTTPException(400, { message: `指定的优惠券（id=${couponId}）不存在` });
}

export async function listMarketingPrizes(campaignId: number) {
  await ensureMarketingCampaignExists(campaignId);
  const rows = await db
    .select({ prize: marketingPrizes, couponName: coupons.name })
    .from(marketingPrizes)
    .leftJoin(coupons, eq(marketingPrizes.couponId, coupons.id))
    .where(eq(marketingPrizes.campaignId, campaignId))
    .orderBy(marketingPrizes.sort, marketingPrizes.id);
  return rows.map((r) => mapMarketingPrize(r.prize, r.couponName));
}

export async function saveMarketingPrize(campaignId: number, prizeId: number | null, data: SaveMarketingPrizeInput) {
  await ensureMarketingCampaignExists(campaignId);
  await ensureCouponUsable(data.prizeType === 'coupon' ? data.couponId : null);
  const values = {
    name: data.name,
    prizeType: data.prizeType,
    points: data.prizeType === 'points' ? data.points ?? null : null,
    couponId: data.prizeType === 'coupon' ? data.couponId ?? null : null,
    weight: data.weight,
    sort: data.sort,
  };
  if (prizeId === null) {
    const [row] = await db.insert(marketingPrizes).values({
      ...values,
      campaignId,
      stock: data.stock,
      totalStock: data.stock,
    }).returning();
    return mapMarketingPrize(row);
  }
  const [current] = await db.select().from(marketingPrizes)
    .where(and(eq(marketingPrizes.id, prizeId), eq(marketingPrizes.campaignId, campaignId))).limit(1);
  const prize = requireRow(current, '奖品不存在');
  // 编辑库存：按增量同步调整剩余库存，已发放部分不受影响
  const stockDelta = data.stock - prize.totalStock;
  const nextStock = prize.stock + stockDelta;
  if (nextStock < 0) throw new HTTPException(400, { message: `库存不可低于已发放数量（已发放 ${prize.totalStock - prize.stock}）` });
  const [row] = await db.update(marketingPrizes).set({
    ...values,
    totalStock: data.stock,
    stock: nextStock,
  }).where(eq(marketingPrizes.id, prizeId)).returning();
  return mapMarketingPrize(row);
}

export async function deleteMarketingPrize(campaignId: number, prizeId: number): Promise<void> {
  const campaign = await ensureMarketingCampaignExists(campaignId);
  if (campaign.status === 'published') throw new HTTPException(400, { message: '进行中的活动不可删除奖品' });
  const deleted = await db.delete(marketingPrizes)
    .where(and(eq(marketingPrizes.id, prizeId), eq(marketingPrizes.campaignId, campaignId)))
    .returning({ id: marketingPrizes.id });
  if (deleted.length === 0) throw new HTTPException(404, { message: '奖品不存在' });
}

// ─── 参与记录 ─────────────────────────────────────────────────────────────────
export interface ListParticipationsQuery {
  page?: number;
  pageSize?: number;
  memberId?: number;
  wonOnly?: boolean;
}

export async function listMarketingParticipations(campaignId: number, q: ListParticipationsQuery) {
  await ensureMarketingCampaignExists(campaignId);
  const { page = 1, pageSize = 10 } = q;
  const where = buildWhere(
    eq(marketingParticipations.campaignId, campaignId),
    q.memberId !== undefined ? eq(marketingParticipations.memberId, q.memberId) : undefined,
    q.wonOnly ? sql`${marketingParticipations.prizeId} IS NOT NULL` : undefined,
  );
  return buildListResult({
    page,
    pageSize,
    count: () => db.$count(marketingParticipations, where),
    rows: () => withPagination(
      db.select({ participation: marketingParticipations, memberNickname: members.nickname })
        .from(marketingParticipations)
        .leftJoin(members, eq(marketingParticipations.memberId, members.id))
        .where(where)
        .orderBy(desc(marketingParticipations.id))
        .$dynamic(),
      page,
      pageSize,
    ),
    map: (r) => mapParticipation(r.participation, r.memberNickname),
  });
}

// ─── C 端抽奖 ─────────────────────────────────────────────────────────────────
function weightedPick(prizes: MarketingPrizeRow[]): MarketingPrizeRow | null {
  const pool = prizes.filter((p) => p.prizeType === 'none' || p.stock > 0);
  if (pool.length === 0) return null;
  const totalWeight = pool.reduce((s, p) => s + p.weight, 0);
  let roll = Math.random() * totalWeight;
  for (const prize of pool) {
    roll -= prize.weight;
    if (roll <= 0) return prize;
  }
  return pool[pool.length - 1];
}

function startOfToday(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

/** C 端活动详情（进行中校验由调用方决定是否放宽） */
export async function getPublicMarketingCampaign(id: number) {
  const [row] = await db.select().from(marketingCampaigns).where(eq(marketingCampaigns.id, id)).limit(1);
  if (!row || row.status !== 'published') throw new HTTPException(404, { message: '活动不存在或未开始' });
  const prizes = await db.select().from(marketingPrizes)
    .where(eq(marketingPrizes.campaignId, id))
    .orderBy(marketingPrizes.sort, marketingPrizes.id);
  return {
    id: row.id,
    name: row.name,
    type: row.type,
    startAt: formatDateTime(row.startAt),
    endAt: formatDateTime(row.endAt),
    perMemberLimit: row.perMemberLimit,
    dailyPerMemberLimit: row.dailyPerMemberLimit ?? null,
    description: row.description ?? null,
    // C 端仅暴露展示所需字段，不泄露权重与剩余库存
    prizes: prizes.filter((p) => p.prizeType !== 'none').map((p) => ({ id: p.id, name: p.name, prizeType: p.prizeType })),
  };
}

export async function drawMarketingLottery(campaignId: number, memberId: number): Promise<MarketingDrawResult> {
  const [campaign] = await db.select().from(marketingCampaigns)
    .where(eq(marketingCampaigns.id, campaignId)).limit(1);
  if (!campaign || campaign.status !== 'published') throw new HTTPException(404, { message: '活动不存在或未开始' });
  const now = Date.now();
  if (now < campaign.startAt.getTime()) throw new HTTPException(400, { message: '活动尚未开始' });
  if (now > campaign.endAt.getTime()) throw new HTTPException(400, { message: '活动已结束' });

  const drawn = await db.transaction(async (tx) => {
    // 同会员同活动串行化：防止并发请求绕过次数限制
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`marketing:${campaignId}:${memberId}`}))`);

    const memberCond = and(
      eq(marketingParticipations.campaignId, campaignId),
      eq(marketingParticipations.memberId, memberId),
    );
    const [totalUsed, todayUsed] = await Promise.all([
      tx.$count(marketingParticipations, memberCond),
      campaign.dailyPerMemberLimit
        ? tx.$count(marketingParticipations, and(memberCond, gte(marketingParticipations.createdAt, startOfToday())))
        : Promise.resolve(0),
    ]);
    if (totalUsed >= campaign.perMemberLimit) throw new HTTPException(400, { message: '参与次数已用完' });
    if (campaign.dailyPerMemberLimit && todayUsed >= campaign.dailyPerMemberLimit) {
      throw new HTTPException(400, { message: '今日参与次数已用完，明天再来吧' });
    }

    const prizes = await tx.select().from(marketingPrizes).where(eq(marketingPrizes.campaignId, campaignId));
    let selected = weightedPick(prizes);
    if (selected && selected.prizeType !== 'none') {
      // 原子扣减：并发抢完时降级为未中奖
      const claimed = await tx.update(marketingPrizes)
        .set({ stock: sql`${marketingPrizes.stock} - 1` })
        .where(and(eq(marketingPrizes.id, selected.id), sql`${marketingPrizes.stock} > 0`))
        .returning({ id: marketingPrizes.id });
      if (claimed.length === 0) selected = null;
    }
    const won = selected !== null && selected.prizeType !== 'none';
    const [participation] = await tx.insert(marketingParticipations).values({
      campaignId,
      memberId,
      prizeId: won ? selected!.id : null,
      prizeName: won ? selected!.name : null,
      // 实物奖线下发放；积分/优惠券提交后自动发放，先占位 granted 语义由下方落实
      grantStatus: won ? (selected!.prizeType === 'physical' ? 'granted' : 'none') : 'none',
      grantNote: won && selected!.prizeType === 'physical' ? '实物奖品，线下发放' : null,
    }).returning();
    return { participation, prize: won ? selected : null, remaining: campaign.perMemberLimit - totalUsed - 1 };
  });

  // 事务提交后发放奖励（发放函数自带事务；失败留痕不回滚抽奖结果）
  if (drawn.prize && drawn.prize.prizeType !== 'physical') {
    let grantStatus: 'granted' | 'failed' = 'granted';
    let grantNote: string | null = null;
    try {
      if (drawn.prize.prizeType === 'points' && drawn.prize.points) {
        await changePoints({
          memberId,
          type: 'earn',
          amount: drawn.prize.points,
          bizType: 'marketing_lottery',
          bizId: String(drawn.participation.id),
          remark: `营销活动「${campaign.name}」中奖发放`,
        });
        grantNote = `已发放 ${drawn.prize.points} 积分`;
      } else if (drawn.prize.prizeType === 'coupon' && drawn.prize.couponId) {
        await issueCoupon(drawn.prize.couponId, memberId);
        grantNote = '优惠券已发放至会员账户';
      }
    } catch (err) {
      grantStatus = 'failed';
      grantNote = (err instanceof Error ? err.message : String(err)).slice(0, 256);
      logger.warn(`[marketing] 活动 #${campaignId} 参与 #${drawn.participation.id} 奖励发放失败`, err);
    }
    await db.update(marketingParticipations)
      .set({ grantStatus, grantNote })
      .where(eq(marketingParticipations.id, drawn.participation.id));
    if (grantStatus === 'granted') {
      notify('marketing.award.won', {
        recipients: [{ type: 'member', id: memberId }],
        vars: { campaignName: campaign.name, prizeName: drawn.prize.name },
        tenantId: campaign.tenantId ?? null,
        dedupeKey: `marketing-award:${drawn.participation.id}`,
      }).catch((err) => logger.warn('[marketing] 中奖通知发送失败', err));
    }
  }

  return {
    won: drawn.prize !== null,
    prizeId: drawn.prize?.id ?? null,
    prizeName: drawn.prize?.name ?? null,
    prizeType: drawn.prize?.prizeType ?? null,
    remainingTimes: Math.max(0, drawn.remaining),
  };
}

/** C 端：我的参与记录 */
export async function listMyParticipations(campaignId: number, memberId: number) {
  const rows = await db.select().from(marketingParticipations)
    .where(and(eq(marketingParticipations.campaignId, campaignId), eq(marketingParticipations.memberId, memberId)))
    .orderBy(desc(marketingParticipations.id))
    .limit(50);
  return rows.map((r) => mapParticipation(r));
}
