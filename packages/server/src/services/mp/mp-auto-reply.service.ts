import { eq, and, desc, sql } from 'drizzle-orm';
import { requireRow } from '../../lib/db-assert';
import { buildListResult } from '../../lib/list-query';
import { HTTPException } from 'hono/http-exception';
import { db } from '../../db';
import { mpAutoReplies, mpUnmatchedKeywords } from '../../db/schema';
import type { MpAutoReplyRow, MpUnmatchedKeywordRow } from '../../db/schema';
import { buildWhere, withPagination, keywordCondition } from '../../lib/where-helpers';
import { formatDateTime } from '../../lib/datetime';
import { tenantScope, currentCreateTenantId } from '../../lib/tenant';
import { ensureMpAccountExists } from './mp-account.service';
import type { CreateMpAutoReplyInput, UpdateMpAutoReplyInput, MpReplyContentType, MpReplyArticle, mpAutoReplyContract } from '@zenith/shared/mp';
import type { QueryOutputOf } from '@zenith/shared/core';

export function mapMpAutoReply(row: MpAutoReplyRow) {
  return {
    id: row.id,
    accountId: row.accountId,
    replyType: row.replyType,
    keyword: row.keyword ?? null,
    matchType: row.matchType,
    contentType: row.contentType,
    content: row.content ?? null,
    mediaId: row.mediaId ?? null,
    newsArticles: row.newsArticles ?? null,
    transferToKf: row.transferToKf,
    status: row.status,
    sort: row.sort,
    createdBy: row.createdBy ?? null,
    updatedBy: row.updatedBy ?? null,
    createdAt: formatDateTime(row.createdAt),
    updatedAt: formatDateTime(row.updatedAt),
  };
}

export async function ensureMpAutoReplyExists(id: number): Promise<MpAutoReplyRow> {
  const [row] = await db.select().from(mpAutoReplies).where(and(eq(mpAutoReplies.id, id), tenantScope(mpAutoReplies))).limit(1);
  return requireRow(row, '自动回复不存在');
}

export async function getMpAutoReplyBeforeAudit(id: number) {
  return mapMpAutoReply(await ensureMpAutoReplyExists(id));
}

export function mapMpUnmatchedKeyword(row: MpUnmatchedKeywordRow) {
  return {
    id: row.id,
    accountId: row.accountId,
    keyword: row.keyword,
    count: row.count,
    lastAt: formatDateTime(row.lastAt),
  };
}

export async function getMpUnmatchedKeywordBeforeAudit(id: number) {
  const [row] = await db.select().from(mpUnmatchedKeywords).where(and(eq(mpUnmatchedKeywords.id, id), tenantScope(mpUnmatchedKeywords))).limit(1);
  if (!row) return null;
  return mapMpUnmatchedKeyword(row);
}

export async function listMpAutoReplies(q: QueryOutputOf<typeof mpAutoReplyContract.list>) {
  await ensureMpAccountExists(q.accountId);
  const where = buildWhere(
    eq(mpAutoReplies.accountId, q.accountId),
    tenantScope(mpAutoReplies),
    q.replyType ? eq(mpAutoReplies.replyType, q.replyType) : undefined,
    keywordCondition(q.keyword, [mpAutoReplies.keyword], 'ilike'),
  );
  return buildListResult({
    page: q.page,
    pageSize: q.pageSize,
    count: () => db.$count(mpAutoReplies, where),
    rows: () => withPagination(db.select().from(mpAutoReplies).where(where).orderBy(mpAutoReplies.replyType, mpAutoReplies.sort, mpAutoReplies.id).$dynamic(), q.page, q.pageSize),
    map: mapMpAutoReply,
  });
}

export async function createMpAutoReply(data: CreateMpAutoReplyInput) {
  await ensureMpAccountExists(data.accountId);
  // 关注回复 / 默认回复 每账号仅允许一条
  if (data.replyType === 'subscribe' || data.replyType === 'default') {
    const [existing] = await db.select({ id: mpAutoReplies.id }).from(mpAutoReplies)
      .where(and(eq(mpAutoReplies.accountId, data.accountId), eq(mpAutoReplies.replyType, data.replyType), tenantScope(mpAutoReplies)))
      .limit(1);
    if (existing) {
      throw new HTTPException(400, { message: data.replyType === 'subscribe' ? '已存在关注回复，请直接编辑' : '已存在默认回复，请直接编辑' });
    }
  }
  const tenantId = currentCreateTenantId();
  const [row] = await db.insert(mpAutoReplies).values({ ...data, tenantId }).returning();
  return mapMpAutoReply(row);
}

export async function updateMpAutoReply(id: number, data: UpdateMpAutoReplyInput) {
  const existing = await ensureMpAutoReplyExists(id);
  // 空补丁直接返回，避免 Drizzle "No values to set"
  if (Object.keys(data).length === 0) return mapMpAutoReply(existing);
  const [row] = await db.update(mpAutoReplies).set(data).where(eq(mpAutoReplies.id, id)).returning();
  return mapMpAutoReply(row);
}

export async function deleteMpAutoReply(id: number) {
  await ensureMpAutoReplyExists(id);
  await db.delete(mpAutoReplies).where(eq(mpAutoReplies.id, id));
}

/** 回调匹配到的回复（含富媒体字段） */
export interface ResolvedReply {
  contentType: MpReplyContentType;
  content: string | null;
  mediaId: string | null;
  newsArticles: MpReplyArticle[] | null;
  transferToKf: boolean;
}

function toResolved(row: MpAutoReplyRow): ResolvedReply {
  return { contentType: row.contentType, content: row.content ?? null, mediaId: row.mediaId ?? null, newsArticles: row.newsArticles ?? null, transferToKf: row.transferToKf };
}

function keywordMatches(text: string, keyword: string, matchType: string): boolean {
  if (matchType === 'exact') return text === keyword;
  if (matchType === 'regex') {
    try { return new RegExp(keyword).test(text); } catch { return false; }
  }
  return text.includes(keyword);
}

/** 记录未命中关键词（按 account+keyword 累计），仅对疑似关键词（短文本）记录，便于优化关键词库。 */
async function logUnmatchedKeyword(accountId: number, tenantId: number | null, text: string): Promise<void> {
  const kw = text.trim().slice(0, 128);
  if (!kw || kw.length > 20) return;
  await db.insert(mpUnmatchedKeywords)
    .values({ accountId, keyword: kw, count: 1, lastAt: new Date(), tenantId })
    .onConflictDoUpdate({ target: [mpUnmatchedKeywords.accountId, mpUnmatchedKeywords.keyword], set: { count: sql`${mpUnmatchedKeywords.count} + 1`, lastAt: new Date() } });
}

/**
 * 回调匹配自动回复（无登录上下文，按 accountId 过滤）。
 * - 关注事件 → 关注回复
 * - 文本消息 → 关键词回复（按 sort，exact/contain/regex），未命中则记录热词并回默认回复
 * 返回结构化回复（含富媒体 + 是否转人工），无匹配返回 null。
 */
export async function resolveAutoReply(accountId: number, input: { event?: string; text?: string }, tenantId: number | null = null): Promise<ResolvedReply | null> {
  if (input.event === 'subscribe') {
    const [r] = await db.select().from(mpAutoReplies)
      .where(and(eq(mpAutoReplies.accountId, accountId), eq(mpAutoReplies.replyType, 'subscribe'), eq(mpAutoReplies.status, 'enabled')))
      .limit(1);
    return r ? toResolved(r) : null;
  }
  if (input.text != null) {
    const keywordReplies = await db.select().from(mpAutoReplies)
      .where(and(eq(mpAutoReplies.accountId, accountId), eq(mpAutoReplies.replyType, 'keyword'), eq(mpAutoReplies.status, 'enabled')))
      .orderBy(mpAutoReplies.sort, mpAutoReplies.id);
    for (const r of keywordReplies) {
      if (!r.keyword) continue;
      if (keywordMatches(input.text, r.keyword, r.matchType)) return toResolved(r);
    }
    // 未命中关键词：记录热词（最佳努力）
    try { await logUnmatchedKeyword(accountId, tenantId, input.text); } catch { /* ignore */ }
    const [def] = await db.select().from(mpAutoReplies)
      .where(and(eq(mpAutoReplies.accountId, accountId), eq(mpAutoReplies.replyType, 'default'), eq(mpAutoReplies.status, 'enabled')))
      .limit(1);
    return def ? toResolved(def) : null;
  }
  return null;
}

// ─── 未命中热词查询/清理 ────────────────────────────────────────────────────────
export async function listMpUnmatchedKeywords(accountId: number, page: number, pageSize: number) {
  await ensureMpAccountExists(accountId);
  const where = buildWhere(and(eq(mpUnmatchedKeywords.accountId, accountId), tenantScope(mpUnmatchedKeywords)));
  return buildListResult({
    page: page,
    pageSize: pageSize,
    count: () => db.$count(mpUnmatchedKeywords, where),
    rows: () => withPagination(db.select().from(mpUnmatchedKeywords).where(where).orderBy(desc(mpUnmatchedKeywords.count), desc(mpUnmatchedKeywords.lastAt)).$dynamic(), page, pageSize),
    map: mapMpUnmatchedKeyword,
  });
}

export async function deleteMpUnmatchedKeyword(id: number): Promise<void> {
  const [row] = await db.select({ id: mpUnmatchedKeywords.id }).from(mpUnmatchedKeywords).where(and(eq(mpUnmatchedKeywords.id, id), tenantScope(mpUnmatchedKeywords))).limit(1);
  requireRow(row, '记录不存在');
  await db.delete(mpUnmatchedKeywords).where(eq(mpUnmatchedKeywords.id, id));
}
