import { eq, and, desc, sql, type SQL } from 'drizzle-orm';
import { HTTPException } from 'hono/http-exception';
import { db } from '../../db';
import { cmsPolls, cmsPollVotes } from '../../db/schema';
import type { CmsPollRow } from '../../db/schema';
import { formatNullableDateTime, parseDateTimeInput } from '../../lib/datetime';
import { mergeWhere, withPagination } from '../../lib/where-helpers';
import { rethrowPgUniqueViolation } from '../../lib/db-errors';
import { assertSiteAccess } from './cms-sites.service';
import type { CmsPollResults, CreateCmsPollInput, UpdateCmsPollInput } from '@zenith/shared';
import { ensureCmsSiteExists } from './cms-sites.service';

// ─── 数据映射 ─────────────────────────────────────────────────────────────────
export function mapCmsPoll(row: CmsPollRow) {
  return {
    id: row.id,
    siteId: row.siteId,
    code: row.code,
    title: row.title,
    options: row.options ?? [],
    maxChoices: row.maxChoices,
    allowAnonymous: row.allowAnonymous,
    startAt: formatNullableDateTime(row.startAt),
    endAt: formatNullableDateTime(row.endAt),
    status: row.status,
    totalVotes: row.totalVotes,
    remark: row.remark ?? null,
    createdAt: formatNullableDateTime(row.createdAt)!,
    updatedAt: formatNullableDateTime(row.updatedAt)!,
  };
}

async function ensurePoll(id: number): Promise<CmsPollRow> {
  const [row] = await db.select().from(cmsPolls).where(eq(cmsPolls.id, id)).limit(1);
  if (!row) throw new HTTPException(404, { message: '投票不存在' });
  return row;
}

// ─── 后台管理 ─────────────────────────────────────────────────────────────────
export interface ListCmsPollsQuery {
  siteId: number;
  status?: 'draft' | 'published' | 'closed';
  page: number;
  pageSize: number;
}

export async function listCmsPolls(q: ListCmsPollsQuery) {
  await ensureCmsSiteExists(q.siteId);
  await assertSiteAccess(q.siteId);
  const conditions: SQL[] = [eq(cmsPolls.siteId, q.siteId)];
  if (q.status) conditions.push(eq(cmsPolls.status, q.status));
  const where = mergeWhere(and(...conditions));
  const [total, rows] = await Promise.all([
    db.$count(cmsPolls, where),
    withPagination(
      db.select().from(cmsPolls).where(where).orderBy(desc(cmsPolls.id)).$dynamic(),
      q.page, q.pageSize,
    ),
  ]);
  return { list: rows.map(mapCmsPoll), total, page: q.page, pageSize: q.pageSize };
}

export async function createCmsPoll(data: CreateCmsPollInput) {
  await ensureCmsSiteExists(data.siteId);
  await assertSiteAccess(data.siteId);
  try {
    const [row] = await db.insert(cmsPolls).values({
      siteId: data.siteId,
      code: data.code,
      title: data.title,
      options: data.options,
      maxChoices: data.maxChoices ?? 1,
      allowAnonymous: data.allowAnonymous ?? true,
      startAt: parseDateTimeInput(data.startAt ?? undefined),
      endAt: parseDateTimeInput(data.endAt ?? undefined),
      remark: data.remark ?? null,
    }).returning();
    return mapCmsPoll(row);
  } catch (err) {
    rethrowPgUniqueViolation(err, '同站点下投票标识已存在');
    throw err;
  }
}

export async function updateCmsPoll(id: number, data: UpdateCmsPollInput) {
  const current = await ensurePoll(id);
  await assertSiteAccess(current.siteId);
  const [row] = await db.update(cmsPolls).set({
    ...(data.title !== undefined ? { title: data.title } : {}),
    ...(data.options !== undefined ? { options: data.options } : {}),
    ...(data.maxChoices !== undefined ? { maxChoices: data.maxChoices } : {}),
    ...(data.allowAnonymous !== undefined ? { allowAnonymous: data.allowAnonymous } : {}),
    ...(data.startAt !== undefined ? { startAt: parseDateTimeInput(data.startAt ?? undefined) } : {}),
    ...(data.endAt !== undefined ? { endAt: parseDateTimeInput(data.endAt ?? undefined) } : {}),
    ...(data.remark !== undefined ? { remark: data.remark ?? null } : {}),
  }).where(eq(cmsPolls.id, id)).returning();
  return mapCmsPoll(row);
}

export async function setCmsPollStatus(id: number, status: 'draft' | 'published' | 'closed') {
  const current = await ensurePoll(id);
  await assertSiteAccess(current.siteId);
  const [row] = await db.update(cmsPolls).set({ status }).where(and(
    eq(cmsPolls.id, id),
  )).returning();
  return mapCmsPoll(row);
}

export async function deleteCmsPoll(id: number): Promise<void> {
  const current = await ensurePoll(id);
  await assertSiteAccess(current.siteId);
  await db.delete(cmsPolls).where(eq(cmsPolls.id, id));
}

// ─── 计票 ─────────────────────────────────────────────────────────────────────
export async function getCmsPollResults(poll: CmsPollRow): Promise<CmsPollResults> {
  const rows = await db.execute<{ option_id: number; votes: string }>(sql`
    SELECT (jsonb_array_elements_text(${cmsPollVotes.optionIds}))::int AS option_id, count(*) AS votes
    FROM ${cmsPollVotes}
    WHERE ${cmsPollVotes.pollId} = ${poll.id}
    GROUP BY 1
  `);
  const countById = new Map([...rows].map((r) => [Number(r.option_id), Number(r.votes)]));
  return {
    pollId: poll.id,
    title: poll.title,
    totalVotes: poll.totalVotes,
    options: (poll.options ?? []).map((o) => ({ ...o, votes: countById.get(o.id) ?? 0 })),
  };
}

export async function getCmsPollResultsById(id: number): Promise<CmsPollResults> {
  const poll = await ensurePoll(id);
  await assertSiteAccess(poll.siteId);
  return getCmsPollResults(poll);
}

// ─── 前台投票 ─────────────────────────────────────────────────────────────────
export async function getPublishedPollByCode(siteId: number, code: string): Promise<CmsPollRow | null> {
  const [row] = await db.select().from(cmsPolls)
    .where(and(eq(cmsPolls.siteId, siteId), eq(cmsPolls.code, code)))
    .limit(1);
  return row ?? null;
}

/** 前台会员投票取投票行（草稿不可见；不做后台站点授权校验） */
export async function getCmsPollByIdForVote(id: number): Promise<CmsPollRow> {
  const [row] = await db.select().from(cmsPolls).where(eq(cmsPolls.id, id)).limit(1);
  if (!row || row.status === 'draft') throw new HTTPException(404, { message: '投票不存在' });
  return row;
}

export interface VotePollMeta {
  memberId: number | null;
  ip: string;
}

/** 当前投票是否在有效窗口内 */
export function isPollOpen(poll: CmsPollRow, now = new Date()): boolean {
  if (poll.status !== 'published') return false;
  if (poll.startAt && now < poll.startAt) return false;
  if (poll.endAt && now > poll.endAt) return false;
  return true;
}

/** 投票：会员一人一票 / 游客一 IP 一票（DB 唯一约束兜底），事务内原子累计总票数 */
export async function voteCmsPoll(poll: CmsPollRow, optionIds: number[], meta: VotePollMeta): Promise<CmsPollResults> {
  if (!isPollOpen(poll)) throw new HTTPException(400, { message: '投票未开放或已结束' });
  if (!meta.memberId && !poll.allowAnonymous) throw new HTTPException(401, { message: '本投票仅限登录会员参与' });
  const validIds = new Set((poll.options ?? []).map((o) => o.id));
  const chosen = [...new Set(optionIds)];
  if (chosen.length === 0 || chosen.some((id) => !validIds.has(id))) {
    throw new HTTPException(400, { message: '投票选项无效' });
  }
  if (chosen.length > poll.maxChoices) {
    throw new HTTPException(400, { message: `最多可选 ${poll.maxChoices} 项` });
  }
  const inserted = await db.transaction(async (tx) => {
    const rows = await tx.insert(cmsPollVotes).values({
      pollId: poll.id,
      optionIds: chosen,
      memberId: meta.memberId,
      voterKey: meta.memberId ? null : meta.ip,
      ip: meta.ip,
    }).onConflictDoNothing().returning({ id: cmsPollVotes.id });
    if (rows.length > 0) {
      await tx.update(cmsPolls).set({ totalVotes: sql`${cmsPolls.totalVotes} + 1` }).where(and(
        eq(cmsPolls.id, poll.id),
      ));
    }
    return rows.length > 0;
  });
  if (!inserted) throw new HTTPException(400, { message: '您已参与过本次投票' });
  const [fresh] = await db.select().from(cmsPolls).where(and(
    eq(cmsPolls.id, poll.id),
  )).limit(1);
  return getCmsPollResults(fresh);
}

/** 当前访客是否已投票（前台回显） */
export async function hasVotedCmsPoll(pollId: number, meta: VotePollMeta): Promise<boolean> {
  const where = meta.memberId
    ? and(eq(cmsPollVotes.pollId, pollId), eq(cmsPollVotes.memberId, meta.memberId))
    : and(eq(cmsPollVotes.pollId, pollId), eq(cmsPollVotes.voterKey, meta.ip), sql`${cmsPollVotes.memberId} is null`);
  return (await db.$count(cmsPollVotes, where)) > 0;
}

// ─── 正文嵌入标记 ─────────────────────────────────────────────────────────────
const POLL_MARKER_RE = /(?:<p[^>]*>)?\s*\[投票:([a-z0-9-]+)\]\s*(?:<\/p>)?/gi;

/** 正文 [投票:code] 标记 → 投票占位 div（前台脚本按 data 属性拉数据渲染） */
export function applyPollMarkers(html: string, siteCode: string): string {
  if (!html || !html.includes('[投票:')) return html;
  return html.replace(POLL_MARKER_RE, (_m, code: string) =>
    `<div class="cms-poll" data-site="${siteCode}" data-code="${code}"></div>`);
}
