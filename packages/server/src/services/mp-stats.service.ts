import { eq, and, gte, sql } from 'drizzle-orm';
import { HTTPException } from 'hono/http-exception';
import { db } from '../db';
import { mpFans, mpTags, mpMaterials, mpDrafts, mpMessages, mpAutoReplies } from '../db/schema';
import { mergeWhere } from '../lib/where-helpers';
import { formatDate } from '../lib/datetime';
import { tenantScope } from '../lib/tenant';
import { ensureMpAccountExists } from './mp-account.service';
import { getUserSummary, getUserCumulate, getUpstreamMsg, getArticleSummary, DATACUBE_MAX_SPAN_DAYS } from '../lib/wechat';
import { mapWechatError } from '../lib/wechat-error';
import type { MpStats, MpDatacube } from '@zenith/shared';

/** 公众号数据统计（基于本地数据聚合，近 7 日趋势） */
export async function getMpStats(accountId: number): Promise<MpStats> {
  await ensureMpAccountExists(accountId);

  const [fanTotal, fanSubscribed, fanUnsubscribed, tagTotal, materialTotal, draftTotal, messageIn, messageOut, autoReplyTotal] = await Promise.all([
    db.$count(mpFans, mergeWhere(and(eq(mpFans.accountId, accountId), tenantScope(mpFans)))),
    db.$count(mpFans, mergeWhere(and(eq(mpFans.accountId, accountId), eq(mpFans.subscribe, 'subscribed'), tenantScope(mpFans)))),
    db.$count(mpFans, mergeWhere(and(eq(mpFans.accountId, accountId), eq(mpFans.subscribe, 'unsubscribed'), tenantScope(mpFans)))),
    db.$count(mpTags, mergeWhere(and(eq(mpTags.accountId, accountId), tenantScope(mpTags)))),
    db.$count(mpMaterials, mergeWhere(and(eq(mpMaterials.accountId, accountId), tenantScope(mpMaterials)))),
    db.$count(mpDrafts, mergeWhere(and(eq(mpDrafts.accountId, accountId), tenantScope(mpDrafts)))),
    db.$count(mpMessages, mergeWhere(and(eq(mpMessages.accountId, accountId), eq(mpMessages.direction, 'in'), tenantScope(mpMessages)))),
    db.$count(mpMessages, mergeWhere(and(eq(mpMessages.accountId, accountId), eq(mpMessages.direction, 'out'), tenantScope(mpMessages)))),
    db.$count(mpAutoReplies, mergeWhere(and(eq(mpAutoReplies.accountId, accountId), tenantScope(mpAutoReplies)))),
  ]);

  // 近 7 日日期序列
  const today = new Date();
  const days: string[] = [];
  for (let i = 6; i >= 0; i -= 1) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    days.push(formatDate(d));
  }
  const since = new Date(today);
  since.setDate(since.getDate() - 6);
  since.setHours(0, 0, 0, 0);

  const [fanRows, msgRows] = await Promise.all([
    db.select({ d: sql<string>`to_char(${mpFans.createdAt}, 'YYYY-MM-DD')`, n: sql<number>`count(*)::int` })
      .from(mpFans)
      .where(mergeWhere(and(eq(mpFans.accountId, accountId), gte(mpFans.createdAt, since), tenantScope(mpFans))))
      .groupBy(sql`to_char(${mpFans.createdAt}, 'YYYY-MM-DD')`),
    db.select({ d: sql<string>`to_char(${mpMessages.createdAt}, 'YYYY-MM-DD')`, dir: mpMessages.direction, n: sql<number>`count(*)::int` })
      .from(mpMessages)
      .where(mergeWhere(and(eq(mpMessages.accountId, accountId), gte(mpMessages.createdAt, since), tenantScope(mpMessages))))
      .groupBy(sql`to_char(${mpMessages.createdAt}, 'YYYY-MM-DD')`, mpMessages.direction),
  ]);

  const fanMap = new Map(fanRows.map((r) => [r.d, r.n]));
  const inMap = new Map<string, number>();
  const outMap = new Map<string, number>();
  for (const r of msgRows) (r.dir === 'in' ? inMap : outMap).set(r.d, r.n);

  return {
    fanTotal,
    fanSubscribed,
    fanUnsubscribed,
    tagTotal,
    materialTotal,
    draftTotal,
    messageIn,
    messageOut,
    autoReplyTotal,
    fanTrend: days.map((date) => ({ date, count: fanMap.get(date) ?? 0 })),
    messageTrend: days.map((date) => ({ date, in: inMap.get(date) ?? 0, out: outMap.get(date) ?? 0 })),
  };
}

/** 微信数据立方（真实接口对接）：用户增减/累计、消息概况、图文阅读。 */
export async function getMpDatacube(accountId: number, beginDate: string, endDate: string): Promise<MpDatacube> {
  const account = await ensureMpAccountExists(accountId);
  const spanDays = Math.floor((Date.parse(`${endDate}T00:00:00`) - Date.parse(`${beginDate}T00:00:00`)) / 86_400_000);
  if (Number.isNaN(spanDays) || spanDays < 0) throw new HTTPException(400, { message: '日期范围无效' });
  if (spanDays >= DATACUBE_MAX_SPAN_DAYS) throw new HTTPException(400, { message: `查询跨度不能超过 ${DATACUBE_MAX_SPAN_DAYS} 天` });
  try {
    const [userSummary, userCumulate, upstreamMsg, articleSummary] = await Promise.all([
      getUserSummary(account, beginDate, endDate),
      getUserCumulate(account, beginDate, endDate),
      getUpstreamMsg(account, beginDate, endDate),
      getArticleSummary(account, beginDate, endDate),
    ]);
    return { beginDate, endDate, userSummary, userCumulate, upstreamMsg, articleSummary };
  } catch (err) {
    return mapWechatError(err);
  }
}
