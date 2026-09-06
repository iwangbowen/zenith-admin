import { eq, and, inArray, sql, desc, type SQL } from 'drizzle-orm';
import { requireRow } from '../../lib/db-assert';
import { buildListResult } from '../../lib/list-query';
import { HTTPException } from 'hono/http-exception';
import { db } from '../../db';
import { mpFans, mpTags } from '../../db/schema';
import type { MpFanRow } from '../../db/schema';
import { buildWhere, withPagination, keywordCondition } from '../../lib/where-helpers';
import { formatDateTime, formatNullableDateTime } from '../../lib/datetime';
import { tenantScope, currentCreateTenantId } from '../../lib/tenant';
import { ensureMpAccountExists } from './mp-account.service';
import { getFollowerOpenids, batchGetFanInfo, getWechatBlacklist, batchBlacklistFans, batchUnblacklistFans, WechatApiError } from '../../lib/wechat';
import type { UpdateMpFanInput, MpFanSubscribe } from '@zenith/shared/mp';

export function mapMpFan(row: MpFanRow) {
  return {
    id: row.id,
    accountId: row.accountId,
    openid: row.openid,
    nickname: row.nickname ?? null,
    avatar: row.avatar ?? null,
    sex: row.sex,
    country: row.country ?? null,
    province: row.province ?? null,
    city: row.city ?? null,
    language: row.language ?? null,
    subscribe: row.subscribe,
    subscribeTime: formatNullableDateTime(row.subscribeTime),
    remark: row.remark ?? null,
    tagIds: row.tagIds ?? [],
    unionid: row.unionid ?? null,
    memberId: row.memberId ?? null,
    blacklisted: row.blacklisted,
    createdBy: row.createdBy ?? null,
    updatedBy: row.updatedBy ?? null,
    createdAt: formatDateTime(row.createdAt),
    updatedAt: formatDateTime(row.updatedAt),
  };
}

export async function ensureMpFanExists(id: number): Promise<MpFanRow> {
  const [row] = await db.select().from(mpFans).where(and(eq(mpFans.id, id), tenantScope(mpFans))).limit(1);
  return requireRow(row, '粉丝不存在');
}

export async function getMpFanBeforeAudit(id: number) {
  return mapMpFan(await ensureMpFanExists(id));
}

function compactFanAudit(row: Pick<MpFanRow, 'id' | 'accountId' | 'openid' | 'nickname' | 'remark' | 'blacklisted' | 'memberId'>) {
  return {
    id: row.id,
    accountId: row.accountId,
    openid: row.openid,
    nickname: row.nickname ?? null,
    remark: row.remark ?? null,
    memberId: row.memberId ?? null,
    blacklisted: row.blacklisted,
  };
}

export async function getMpFansBlacklistAudit(accountId: number, openids: string[]) {
  await ensureMpAccountExists(accountId);
  const uniqOpenids = [...new Set(openids)];
  if (uniqOpenids.length === 0) {
    return { accountId, openids: [], fans: [] };
  }
  const tenant = tenantScope(mpFans);
  const rows = await db
    .select({
      id: mpFans.id,
      accountId: mpFans.accountId,
      openid: mpFans.openid,
      nickname: mpFans.nickname,
      remark: mpFans.remark,
      memberId: mpFans.memberId,
      blacklisted: mpFans.blacklisted,
    })
    .from(mpFans)
    .where(and(eq(mpFans.accountId, accountId), inArray(mpFans.openid, uniqOpenids), tenant))
    .orderBy(mpFans.id);
  return {
    accountId,
    openids: uniqOpenids,
    fans: rows.map(compactFanAudit),
  };
}

export async function getMpBlacklistStateAudit(accountId: number) {
  await ensureMpAccountExists(accountId);
  const tenant = tenantScope(mpFans);
  const where = and(eq(mpFans.accountId, accountId), eq(mpFans.blacklisted, true), tenant);
  const [total, rows] = await Promise.all([
    db.$count(mpFans, where),
    db
      .select({
        id: mpFans.id,
        accountId: mpFans.accountId,
        openid: mpFans.openid,
        nickname: mpFans.nickname,
        remark: mpFans.remark,
        memberId: mpFans.memberId,
        blacklisted: mpFans.blacklisted,
      })
      .from(mpFans)
      .where(where)
      .orderBy(mpFans.id)
      .limit(100),
  ]);
  return {
    accountId,
    blacklistedCount: total,
    sampleSize: rows.length,
    blacklistedFansSample: rows.map(compactFanAudit),
  };
}

export interface ListMpFansQuery {
  accountId: number;
  keyword?: string;
  subscribe?: MpFanSubscribe;
  tagId?: number;
  blacklisted?: boolean;
  page: number;
  pageSize: number;
}

export async function listMpFans(q: ListMpFansQuery) {
  await ensureMpAccountExists(q.accountId); // 校验账号归属当前租户
  const conditions: (SQL | undefined)[] = [
    eq(mpFans.accountId, q.accountId),
    tenantScope(mpFans),
    keywordCondition(q.keyword, [mpFans.nickname, mpFans.openid, mpFans.remark], 'ilike'),
  ];
  if (q.subscribe) conditions.push(eq(mpFans.subscribe, q.subscribe));
  if (q.tagId) conditions.push(sql`${mpFans.tagIds} @> ${JSON.stringify([q.tagId])}::jsonb`);
  if (q.blacklisted !== undefined) conditions.push(eq(mpFans.blacklisted, q.blacklisted));
  const where = buildWhere(...conditions);
  return buildListResult({
    page: q.page,
    pageSize: q.pageSize,
    count: () => db.$count(mpFans, where),
    rows: () => withPagination(db.select().from(mpFans).where(where).orderBy(desc(mpFans.id)).$dynamic(), q.page, q.pageSize),
    map: mapMpFan,
  });
}

export async function updateMpFan(id: number, data: UpdateMpFanInput) {
  const fan = await ensureMpFanExists(id);
  const patch: Partial<typeof mpFans.$inferInsert> = {};
  if (data.remark !== undefined) patch.remark = data.remark;
  if (data.tagIds !== undefined) {
    if (data.tagIds.length > 0) {
      const valid = await db.select({ id: mpTags.id }).from(mpTags)
        .where(and(eq(mpTags.accountId, fan.accountId), inArray(mpTags.id, data.tagIds)));
      const validIds = new Set(valid.map((t) => t.id));
      const invalid = data.tagIds.filter((t) => !validIds.has(t));
      if (invalid.length > 0) throw new HTTPException(400, { message: '包含无效或不属于该公众号的标签' });
      patch.tagIds = data.tagIds;
    } else {
      patch.tagIds = [];
    }
  }
  if (Object.keys(patch).length === 0) return mapMpFan(fan); // 空更新直接返回，避免 Drizzle "No values to set"
  const [row] = await db.update(mpFans).set(patch).where(eq(mpFans.id, id)).returning();
  return mapMpFan(row ?? fan);
}

/** 从微信同步粉丝到本地（不覆盖本地备注 / 标签） */
export async function syncMpFans(accountId: number): Promise<{ success: boolean; synced: number; total: number }> {
  const account = await ensureMpAccountExists(accountId);
  const tenantId = currentCreateTenantId();

  // 预载微信标签 id → 本地标签 id 映射，用于新粉丝标签初始化
  const tagRows = await db.select({ id: mpTags.id, wechatTagId: mpTags.wechatTagId })
    .from(mpTags).where(eq(mpTags.accountId, accountId));
  const wxTagToLocal = new Map<number, number>();
  for (const t of tagRows) if (t.wechatTagId != null) wxTagToLocal.set(t.wechatTagId, t.id);

  let nextOpenid = '';
  let synced = 0;
  let total: number;
  try {
    do {
      const page = await getFollowerOpenids(account, nextOpenid);
      total = page.total;
      for (let i = 0; i < page.openids.length; i += 100) {
        const chunk = page.openids.slice(i, i + 100);
        const infos = await batchGetFanInfo(account, chunk);
        await db.transaction(async (tx) => {
          for (const info of infos) {
            const wxFields = {
              nickname: info.nickname ?? null,
              avatar: info.headimgurl ?? null,
              sex: info.sex ?? 0,
              country: info.country ?? null,
              province: info.province ?? null,
              city: info.city ?? null,
              language: info.language ?? null,
              subscribe: (info.subscribe === 1 ? 'subscribed' : 'unsubscribed') as MpFanSubscribe,
              subscribeTime: info.subscribe_time ? new Date(info.subscribe_time * 1000) : null,
            };
            const localTagIds = (info.tagid_list ?? [])
              .map((w) => wxTagToLocal.get(w))
              .filter((x): x is number => x != null);
            await tx.insert(mpFans)
              .values({ accountId, openid: info.openid, ...wxFields, tagIds: localTagIds, tenantId })
              .onConflictDoUpdate({ target: [mpFans.accountId, mpFans.openid], set: wxFields });
            synced += 1;
          }
        });
      }
      nextOpenid = page.openids.length > 0 ? page.nextOpenid : '';
    } while (nextOpenid);
  } catch (err) {
    if (err instanceof WechatApiError) throw new HTTPException(400, { message: err.message });
    throw new HTTPException(502, { message: '调用微信接口失败，请检查网络或稍后重试' });
  }
  return { success: true, synced, total };
}

function mapWechatErr(err: unknown): never {
  if (err instanceof WechatApiError) throw new HTTPException(400, { message: err.message });
  throw new HTTPException(502, { message: '调用微信接口失败，请检查网络或稍后重试' });
}

/** 拉黑粉丝：调微信 batchblacklist，成功后本地标记 blacklisted=true */
export async function blacklistMpFans(accountId: number, openids: string[]): Promise<{ success: boolean; count: number }> {
  const account = await ensureMpAccountExists(accountId);
  try {
    await batchBlacklistFans(account, openids);
  } catch (err) {
    mapWechatErr(err);
  }
  await db.update(mpFans).set({ blacklisted: true })
    .where(and(eq(mpFans.accountId, accountId), inArray(mpFans.openid, openids), tenantScope(mpFans)));
  return { success: true, count: openids.length };
}

/** 移出黑名单：调微信 batchunblacklist，成功后本地标记 blacklisted=false */
export async function unblacklistMpFans(accountId: number, openids: string[]): Promise<{ success: boolean; count: number }> {
  const account = await ensureMpAccountExists(accountId);
  try {
    await batchUnblacklistFans(account, openids);
  } catch (err) {
    mapWechatErr(err);
  }
  await db.update(mpFans).set({ blacklisted: false })
    .where(and(eq(mpFans.accountId, accountId), inArray(mpFans.openid, openids), tenantScope(mpFans)));
  return { success: true, count: openids.length };
}

/** 从微信同步黑名单：将远端黑名单 openid 在本地标记，其余取消标记 */
export async function syncMpBlacklist(accountId: number): Promise<{ success: boolean; total: number }> {
  const account = await ensureMpAccountExists(accountId);
  const blackset = new Set<string>();
  let nextOpenid = '';
  try {
    do {
      const page = await getWechatBlacklist(account, nextOpenid);
      for (const o of page.openids) blackset.add(o);
      nextOpenid = page.openids.length > 0 ? page.nextOpenid : '';
    } while (nextOpenid);
  } catch (err) {
    mapWechatErr(err);
  }
  await db.transaction(async (tx) => {
    await tx.update(mpFans).set({ blacklisted: false }).where(eq(mpFans.accountId, accountId));
    if (blackset.size > 0) {
      await tx.update(mpFans).set({ blacklisted: true })
        .where(and(eq(mpFans.accountId, accountId), inArray(mpFans.openid, [...blackset])));
    }
  });
  return { success: true, total: blackset.size };
}
