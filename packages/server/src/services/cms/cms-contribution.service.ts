/**
 * 会员投稿（前台 C 端）：会员在 member SPA 提交内容 → 进入 CMS 审核（简单/工作流按站点配置）。
 * 全部按 currentMemberId() 过滤防越权；发布仍走后台既有审核/发布管道。
 */
import { requireRow } from '../../lib/db-assert';
import { buildListResult } from '../../lib/list-query';
import { and, desc, eq, isNull, inArray } from 'drizzle-orm';
import { HTTPException } from 'hono/http-exception';
import { db } from '../../db';
import { cmsContents, cmsChannels, cmsSites, members } from '../../db/schema';
import type { CmsContentRow } from '../../db/schema';
import { formatDateTime, formatNullableDateTime } from '../../lib/datetime';
import { withPagination } from '../../lib/where-helpers';
import { currentMemberId } from '../../lib/member-context';
import { contentSearchVector } from './cms-search.service';
import { submitCmsContent } from './cms-contents.service';
import { applyCmsContentPolicies } from './cms-contents-write.service';
import { ensureCmsSiteExists } from './cms-sites.service';
import { resolveEffectiveCmsSite } from './cms-site-inheritance.service';
import { assertCmsContentUnlocked } from './cms-content-lock.service';
import { getEffectivelyEnabledCmsChannelIds } from './cms-channel-visibility.service';
import {
  canonicalizeCmsResourceFields, deleteCmsResourceRefsForOwner, resolveCmsContentRow, resolveCmsContentRows,
  syncCmsResourceRefs,
} from './cms-resource-refs.service';

const CONTRIBUTION_SOURCE = '会员投稿';

function mapContribution(row: CmsContentRow, channelName?: string | null) {
  return {
    id: row.id,
    siteId: row.siteId,
    channelId: row.channelId,
    channelName: channelName ?? null,
    title: row.title,
    summary: row.summary ?? null,
    coverImage: row.coverImage ?? null,
    body: row.body ?? null,
    status: row.status,
    rejectReason: row.rejectReason ?? null,
    publishedAt: formatNullableDateTime(row.publishedAt),
    viewCount: row.viewCount,
    createdAt: formatDateTime(row.createdAt),
    updatedAt: formatDateTime(row.updatedAt),
  };
}

async function resolveContributionRows(rows: readonly CmsContentRow[]): Promise<(CmsContentRow & { coverThumb: string | null })[]> {
  const resolved = new Array<CmsContentRow & { coverThumb: string | null }>(rows.length);
  const groups = new Map<number, number[]>();
  rows.forEach((row, index) => groups.set(row.siteId, [...(groups.get(row.siteId) ?? []), index]));
  await Promise.all([...groups].map(async ([siteId, indexes]) => {
    const values = await resolveCmsContentRows(indexes.map((index) => rows[index]), siteId);
    indexes.forEach((index, offset) => { resolved[index] = values[offset]; });
  }));
  return resolved;
}

/** 可投稿站点（启用中）+ 其 list 型栏目 */
export async function listContributableChannels() {
  const sites = await db.select({ id: cmsSites.id, name: cmsSites.name })
    .from(cmsSites).where(eq(cmsSites.status, 'enabled')).orderBy(cmsSites.id);
  if (sites.length === 0) return [];
  const channels = await db.select({
    id: cmsChannels.id, siteId: cmsChannels.siteId, name: cmsChannels.name,
  }).from(cmsChannels).where(and(
    inArray(cmsChannels.siteId, sites.map((s) => s.id)),
    eq(cmsChannels.type, 'list'),
    eq(cmsChannels.status, 'enabled'),
  )).orderBy(cmsChannels.sort, cmsChannels.id);
  const effectiveBySite = new Map<number, Set<number>>();
  for (const site of sites) effectiveBySite.set(site.id, await getEffectivelyEnabledCmsChannelIds(site.id));
  return sites
    .map((s) => ({ ...s, channels: channels.filter((c) => c.siteId === s.id && effectiveBySite.get(s.id)?.has(c.id)).map(({ id, name }) => ({ id, name })) }))
    .filter((s) => s.channels.length > 0);
}

export async function listMyContributions(params: { page: number; pageSize: number; status?: string }) {
  const memberId = currentMemberId();
  const conds = [eq(cmsContents.memberId, memberId), isNull(cmsContents.deletedAt)];
  if (params.status) conds.push(eq(cmsContents.status, params.status as CmsContentRow['status']));
  const where = and(...conds);
  return buildListResult({
    page: params.page,
    pageSize: params.pageSize,
    count: () => db.$count(cmsContents, where),
    rows: async () => {
      const rows = await withPagination(
        db.select({ content: cmsContents, channelName: cmsChannels.name })
          .from(cmsContents)
          .leftJoin(cmsChannels, and(
            eq(cmsContents.channelId, cmsChannels.id),
          ))
          .where(where)
          .orderBy(desc(cmsContents.id))
          .$dynamic(),
        params.page, params.pageSize,
      );
      const resolved = await resolveContributionRows(rows.map((r) => r.content));
      return resolved.map((content, index) => mapContribution(content, rows[index].channelName));
    },
  });
}

async function getOwnContribution(id: number): Promise<CmsContentRow> {
  const memberId = currentMemberId();
  const [row] = await db.select().from(cmsContents)
    .where(and(eq(cmsContents.id, id), eq(cmsContents.memberId, memberId), isNull(cmsContents.deletedAt)))
    .limit(1);
  return requireRow(row, '投稿不存在');
}

export async function getMyContribution(id: number) {
  const row = await getOwnContribution(id);
  const [channel] = await db.select({ name: cmsChannels.name }).from(cmsChannels).where(and(
    eq(cmsChannels.id, row.channelId),
  )).limit(1);
  return mapContribution(await resolveCmsContentRow(row, row.siteId), channel?.name);
}

async function ensureContributableChannel(siteId: number, channelId: number) {
  const effective = await resolveEffectiveCmsSite(siteId).catch(() => null);
  if (!effective || !effective.chain.every((site) => site.status === 'enabled')) {
    throw new HTTPException(400, { message: '该站点不可投稿' });
  }
  const [channel] = await db.select().from(cmsChannels)
    .where(and(
      eq(cmsChannels.id, channelId),
      eq(cmsChannels.siteId, siteId),
    )).limit(1);
  if (!channel || channel.type !== 'list' || channel.status !== 'enabled' || !(await getEffectivelyEnabledCmsChannelIds(siteId)).has(channel.id)) {
    throw new HTTPException(400, { message: '该栏目不可投稿' });
  }
  return channel;
}

export interface ContributionInput {
  siteId: number;
  channelId: number;
  title: string;
  summary?: string;
  body: string;
}

/** 提交投稿：建稿 → 走统一提交审核管道（站点 simple/workflow 自动生效） */
export async function createContribution(input: ContributionInput) {
  const memberId = currentMemberId();
  const channel = await ensureContributableChannel(input.siteId, input.channelId);
  const site = await ensureCmsSiteExists(input.siteId);
  const policy = await applyCmsContentPolicies({
    title: input.title,
    summary: input.summary ?? null,
    body: input.body,
  }, site);
  const body = policy.body ?? '';
  if (!body.trim()) throw new HTTPException(400, { message: '正文净化后不能为空' });
  const [me] = await db.select({ nickname: members.nickname }).from(members).where(eq(members.id, memberId)).limit(1);
  const created = await db.transaction(async (tx) => {
    const canonical = await canonicalizeCmsResourceFields(tx, input.siteId, { body }, 'content');
    const [row] = await tx.insert(cmsContents).values({
      siteId: input.siteId,
      channelId: input.channelId,
      modelId: channel.modelId ?? null,
      title: policy.title,
      summary: policy.summary ?? null,
      body: canonical.body,
      author: me?.nickname ?? `会员${memberId}`,
      source: CONTRIBUTION_SOURCE,
      status: 'draft',
      memberId,
      searchVector: contentSearchVector(input.siteId, { title: policy.title, summary: policy.summary ?? null, body }),
    }).returning();
    await syncCmsResourceRefs(tx, 'content', row.id, row.siteId, row);
    return row;
  });
  await submitCmsContent(created.id, { skipAccessCheck: true });
  return getMyContribution(created.id);
}

/** 修改被驳回/草稿投稿并重新提交审核 */
export async function updateMyContribution(id: number, input: Omit<ContributionInput, 'siteId'>) {
  const row = await getOwnContribution(id);
  assertCmsContentUnlocked(row);
  if (row.status !== 'draft' && row.status !== 'rejected') {
    throw new HTTPException(400, { message: '仅草稿或被驳回的投稿可修改' });
  }
  await ensureContributableChannel(row.siteId, input.channelId);
  const site = await ensureCmsSiteExists(row.siteId);
  const policy = await applyCmsContentPolicies({
    title: input.title,
    summary: input.summary ?? null,
    body: input.body,
  }, site);
  const body = policy.body ?? '';
  if (!body.trim()) throw new HTTPException(400, { message: '正文净化后不能为空' });
  await db.transaction(async (tx) => {
    const canonical = await canonicalizeCmsResourceFields(tx, row.siteId, { body }, 'content');
    const [updated] = await tx.update(cmsContents).set({
      channelId: input.channelId,
      title: policy.title,
      summary: policy.summary ?? null,
      body: canonical.body,
      searchVector: contentSearchVector(row.siteId, { title: policy.title, summary: policy.summary ?? null, body }),
    }).where(and(eq(cmsContents.id, id), isNull(cmsContents.lockedAt))).returning();
    if (updated) await syncCmsResourceRefs(tx, 'content', updated.id, updated.siteId, updated);
  });
  await submitCmsContent(id, { skipAccessCheck: true });
  return getMyContribution(id);
}

/** 删除投稿（仅草稿/被驳回；已发布内容不可自行删除） */
export async function deleteMyContribution(id: number) {
  const row = await getOwnContribution(id);
  assertCmsContentUnlocked(row);
  if (row.status !== 'draft' && row.status !== 'rejected') {
    throw new HTTPException(400, { message: '仅草稿或被驳回的投稿可删除' });
  }
  await db.transaction(async (tx) => {
    const deleted = await tx.delete(cmsContents)
      .where(and(eq(cmsContents.id, id), isNull(cmsContents.lockedAt)))
      .returning({ id: cmsContents.id });
    await deleteCmsResourceRefsForOwner(tx, 'content', deleted.map((item) => item.id), row.siteId);
  });
}
