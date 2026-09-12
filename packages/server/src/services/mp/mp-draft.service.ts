import { eq, and, desc } from 'drizzle-orm';
import { requireRow } from '../../lib/db-assert';
import { buildListResult } from '../../lib/list-query';
import { db } from '../../db';
import { mpDrafts } from '../../db/schema';
import type { MpDraftRow } from '../../db/schema';
import { buildWhere, withPagination, keywordCondition } from '../../lib/where-helpers';
import { formatTimestamps } from '../../lib/datetime';
import { tenantScope, currentCreateTenantId } from '../../lib/tenant';
import { ensureMpAccountExists } from './mp-account.service';
import { addWechatDraft } from '../../lib/wechat';
import { mapWechatError } from '../../lib/wechat-error';
import type { CreateMpDraftInput, UpdateMpDraftInput, MpArticle, mpDraftContract } from '@zenith/shared/mp';
import type { QueryOutputOf } from '@zenith/shared/core';

export function mapMpDraft(row: MpDraftRow) {
  return {
    id: row.id,
    accountId: row.accountId,
    title: row.title,
    articles: (row.articles ?? []) as MpArticle[],
    wechatMediaId: row.wechatMediaId ?? null,
    status: row.status,
    createdBy: row.createdBy ?? null,
    updatedBy: row.updatedBy ?? null,
    ...formatTimestamps(row),
  };
}

export async function ensureMpDraftExists(id: number): Promise<MpDraftRow> {
  const [row] = await db.select().from(mpDrafts).where(and(eq(mpDrafts.id, id), tenantScope(mpDrafts))).limit(1);
  return requireRow(row, '图文草稿不存在');
}

export async function getMpDraft(id: number) {
  return mapMpDraft(await ensureMpDraftExists(id));
}

export async function listMpDrafts(q: QueryOutputOf<typeof mpDraftContract.list>) {
  await ensureMpAccountExists(q.accountId);
  const where = buildWhere(
    eq(mpDrafts.accountId, q.accountId),
    tenantScope(mpDrafts),
    keywordCondition(q.keyword, [mpDrafts.title], 'ilike'),
  );
  return buildListResult({
    page: q.page,
    pageSize: q.pageSize,
    count: () => db.$count(mpDrafts, where),
    rows: () => withPagination(db.select().from(mpDrafts).where(where).orderBy(desc(mpDrafts.id)).$dynamic(), q.page, q.pageSize),
    map: mapMpDraft,
  });
}

export async function createMpDraft(data: CreateMpDraftInput) {
  await ensureMpAccountExists(data.accountId);
  const tenantId = currentCreateTenantId();
  const title = data.articles[0]?.title ?? '未命名图文';
  const [row] = await db.insert(mpDrafts).values({ accountId: data.accountId, title, articles: data.articles, tenantId }).returning();
  return mapMpDraft(row);
}

export async function updateMpDraft(id: number, data: UpdateMpDraftInput) {
  await ensureMpDraftExists(id);
  const title = data.articles[0]?.title ?? '未命名图文';
  const [row] = await db.update(mpDrafts).set({ title, articles: data.articles, status: 'draft', wechatMediaId: null }).where(eq(mpDrafts.id, id)).returning();
  return mapMpDraft(row);
}

export async function deleteMpDraft(id: number) {
  await ensureMpDraftExists(id);
  await db.delete(mpDrafts).where(eq(mpDrafts.id, id));
}

/** 推送图文草稿到微信草稿箱 */
export async function pushMpDraft(id: number) {
  const row = await ensureMpDraftExists(id);
  const account = await ensureMpAccountExists(row.accountId);
  const articles = (row.articles ?? []) as MpArticle[];
  requireRow(articles[0], '草稿内容为空', 400);
  let mediaId: string;
  try {
    mediaId = await addWechatDraft(account, articles);
  } catch (err) {
    return mapWechatError(err);
  }
  const [updated] = await db.update(mpDrafts).set({ wechatMediaId: mediaId, status: 'published' }).where(eq(mpDrafts.id, id)).returning();
  return mapMpDraft(updated);
}
