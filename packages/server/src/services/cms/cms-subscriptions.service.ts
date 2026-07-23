import { createHash } from 'node:crypto';
import dayjs from 'dayjs';
import {
  and,
  asc,
  desc,
  eq,
  gte,
  ilike,
  inArray,
  isNotNull,
  isNull,
  like,
  lt,
  lte,
  or,
  sql,
  type SQL,
} from 'drizzle-orm';
import { HTTPException } from 'hono/http-exception';
import {
  CMS_INTERACTION_DAILY_LIMITS,
  CMS_INTERACTION_POINTS,
  type CmsSubscriptionSubjectInput,
  type CmsSubscriptionSubjectType,
} from '@zenith/shared';
import { db } from '../../db';
import {
  cmsChannels,
  cmsContents,
  cmsMemberSubscriptions,
  cmsSites,
  memberPointAccounts,
  memberPointTransactions,
  members,
} from '../../db/schema';
import type { CmsContentRow, CmsMemberSubscriptionRow } from '../../db/schema';
import { currentMemberId } from '../../lib/member-context';
import { formatDateTime, formatNullableDateTime, parseDateRangeEnd, parseDateRangeStart } from '../../lib/datetime';
import { maskEmail, maskName, maskPhone } from '../../lib/masking';
import { escapeLike, withPagination } from '../../lib/where-helpers';
import { streamByDescendingId } from '../../lib/export-center/cursor-stream';
import { changePointsInTransaction } from '../member/member-points.service';
import { assertSiteAccess, ensureCmsSiteExists } from './cms-sites.service';

export function normalizeCmsAuthorKey(value: string): string {
  return value.normalize('NFKC').trim().replace(/\s+/gu, ' ').toLocaleLowerCase('en-US');
}

function normalizeAuthorLabel(value: string): string {
  return value.normalize('NFKC').trim().replace(/\s+/gu, ' ');
}

interface ResolvedSubject {
  siteId: number;
  subjectType: CmsSubscriptionSubjectType;
  subjectKey: string;
  subjectId: number | null;
  subjectLabel: string;
}

async function resolveSubscriptionSubject(input: CmsSubscriptionSubjectInput): Promise<ResolvedSubject> {
  const site = await ensureCmsSiteExists(input.siteId);
  if (site.status !== 'enabled') {
    throw new HTTPException(404, { message: '站点不存在或未开放订阅' });
  }
  if (input.subjectType === 'site') {
    if (input.subjectId !== site.id) {
      throw new HTTPException(400, { message: '站点订阅对象与 siteId 不一致' });
    }
    return {
      siteId: site.id,
      subjectType: 'site',
      subjectKey: String(site.id),
      subjectId: site.id,
      subjectLabel: site.name,
    };
  }
  if (input.subjectType === 'channel') {
    const [channel] = await db.select({ id: cmsChannels.id, siteId: cmsChannels.siteId, name: cmsChannels.name })
      .from(cmsChannels)
      .where(and(eq(cmsChannels.id, input.subjectId!), eq(cmsChannels.status, 'enabled')))
      .limit(1);
    if (!channel || channel.siteId !== site.id) {
      throw new HTTPException(404, { message: '栏目不存在或不属于该站点' });
    }
    return {
      siteId: site.id,
      subjectType: 'channel',
      subjectKey: String(channel.id),
      subjectId: channel.id,
      subjectLabel: channel.name,
    };
  }
  const requested = normalizeCmsAuthorKey(input.subjectKey ?? '');
  if (!requested) throw new HTTPException(400, { message: '作者不能为空' });
  const authors = await db.selectDistinct({ author: cmsContents.author }).from(cmsContents)
    .innerJoin(cmsChannels, eq(cmsContents.channelId, cmsChannels.id))
    .innerJoin(cmsSites, eq(cmsContents.siteId, cmsSites.id))
    .where(and(
      eq(cmsContents.siteId, site.id),
      eq(cmsContents.status, 'published'),
      eq(cmsChannels.status, 'enabled'),
      eq(cmsSites.status, 'enabled'),
      isNull(cmsContents.deletedAt),
      isNotNull(cmsContents.author),
      isNotNull(cmsContents.publishedAt),
      lte(cmsContents.publishedAt, new Date()),
      or(isNull(cmsContents.expireAt), gte(cmsContents.expireAt, new Date())),
    ));
  const matched = authors.find((row) => row.author && normalizeCmsAuthorKey(row.author) === requested)?.author;
  if (!matched) throw new HTTPException(404, { message: '作者不存在或暂无可订阅内容' });
  return {
    siteId: site.id,
    subjectType: 'author',
    subjectKey: requested,
    subjectId: null,
    subjectLabel: normalizeAuthorLabel(matched),
  };
}

function subscriptionPointBizId(row: Pick<CmsMemberSubscriptionRow, 'siteId' | 'subjectType' | 'subjectKey'>): string {
  const digest = createHash('sha256').update(row.subjectKey).digest('hex').slice(0, 24);
  return `subscribe:${row.siteId}:${row.subjectType}:${digest}`;
}

async function awardFirstSubscriptionPoints(row: CmsMemberSubscriptionRow): Promise<void> {
  if (row.pointsAwardedAt) return;
  const bizId = subscriptionPointBizId(row);
  await db.transaction(async (tx) => {
    const [locked] = await tx.select().from(cmsMemberSubscriptions)
      .where(eq(cmsMemberSubscriptions.id, row.id))
      .for('update')
      .limit(1);
    if (!locked || locked.pointsAwardedAt) return;
    const [existing, dailyCount] = await Promise.all([
      tx.select({ id: memberPointTransactions.id }).from(memberPointTransactions)
        .where(and(
          eq(memberPointTransactions.memberId, row.memberId),
          eq(memberPointTransactions.bizType, 'cms_interaction'),
          eq(memberPointTransactions.bizId, bizId),
        )).limit(1),
      tx.$count(memberPointTransactions, and(
        eq(memberPointTransactions.memberId, row.memberId),
        eq(memberPointTransactions.bizType, 'cms_interaction'),
        like(memberPointTransactions.bizId, 'subscribe:%'),
        gte(memberPointTransactions.createdAt, dayjs().startOf('day').toDate()),
      )),
    ]);
    if (existing.length === 0 && dailyCount < CMS_INTERACTION_DAILY_LIMITS.subscribe) {
      await tx.insert(memberPointAccounts).values({ memberId: row.memberId }).onConflictDoNothing();
      await changePointsInTransaction({
        memberId: row.memberId,
        type: 'earn',
        amount: CMS_INTERACTION_POINTS.subscribe,
        bizType: 'cms_interaction',
        bizId,
        remark: `CMS 首次订阅奖励（${row.subjectType}:${row.subjectLabel}）`,
      }, tx);
    }
    await tx.update(cmsMemberSubscriptions)
      .set({ pointsAwardedAt: new Date() })
      .where(eq(cmsMemberSubscriptions.id, row.id));
  });
}

export function mapCmsMemberSubscription(row: CmsMemberSubscriptionRow, extra?: {
  memberDisplay?: string | null;
  siteName?: string | null;
}) {
  return {
    id: row.id,
    memberId: row.memberId,
    memberDisplay: extra?.memberDisplay ?? null,
    siteId: row.siteId,
    siteName: extra?.siteName ?? null,
    subjectType: row.subjectType,
    subjectKey: row.subjectKey,
    subjectId: row.subjectId ?? null,
    subjectLabel: row.subjectLabel,
    notificationEnabled: row.notificationEnabled,
    active: row.active,
    pointsAwardedAt: formatNullableDateTime(row.pointsAwardedAt),
    createdAt: formatDateTime(row.createdAt),
    updatedAt: formatDateTime(row.updatedAt),
  };
}

export async function subscribeCmsSubject(input: CmsSubscriptionSubjectInput) {
  const memberId = currentMemberId();
  const subject = await resolveSubscriptionSubject(input);
  const [member] = await db.select({ status: members.status, deletedAt: members.deletedAt }).from(members)
    .where(eq(members.id, memberId)).limit(1);
  if (!member || member.deletedAt || member.status !== 'active') {
    throw new HTTPException(403, { message: '会员状态异常，无法订阅' });
  }
  const [row] = await db.insert(cmsMemberSubscriptions)
    .values({
      memberId,
      ...subject,
      notificationEnabled: input.notificationEnabled ?? true,
      active: true,
    })
    .onConflictDoUpdate({
      target: [
        cmsMemberSubscriptions.memberId,
        cmsMemberSubscriptions.siteId,
        cmsMemberSubscriptions.subjectType,
        cmsMemberSubscriptions.subjectKey,
      ],
      set: {
        subjectId: subject.subjectId,
        subjectLabel: subject.subjectLabel,
        notificationEnabled: input.notificationEnabled ?? true,
        active: true,
      },
    })
    .returning();
  await awardFirstSubscriptionPoints(row);
  const [fresh] = await db.select().from(cmsMemberSubscriptions).where(eq(cmsMemberSubscriptions.id, row.id)).limit(1);
  return mapCmsMemberSubscription(fresh);
}

export async function getMyCmsSubscriptionStatus(input: CmsSubscriptionSubjectInput) {
  const memberId = currentMemberId();
  const subject = await resolveSubscriptionSubject(input);
  const [row] = await db.select().from(cmsMemberSubscriptions).where(and(
    eq(cmsMemberSubscriptions.memberId, memberId),
    eq(cmsMemberSubscriptions.siteId, subject.siteId),
    eq(cmsMemberSubscriptions.subjectType, subject.subjectType),
    eq(cmsMemberSubscriptions.subjectKey, subject.subjectKey),
  )).limit(1);
  return row && row.active ? mapCmsMemberSubscription(row) : null;
}

async function ensureOwnedSubscription(id: number): Promise<CmsMemberSubscriptionRow> {
  const memberId = currentMemberId();
  const [row] = await db.select().from(cmsMemberSubscriptions).where(and(
    eq(cmsMemberSubscriptions.id, id),
    eq(cmsMemberSubscriptions.memberId, memberId),
  )).limit(1);
  if (!row) throw new HTTPException(404, { message: '订阅不存在' });
  return row;
}

export async function cancelMyCmsSubscription(id: number) {
  const row = await ensureOwnedSubscription(id);
  if (!row.active) return mapCmsMemberSubscription(row);
  const [updated] = await db.update(cmsMemberSubscriptions)
    .set({ active: false })
    .where(and(eq(cmsMemberSubscriptions.id, id), eq(cmsMemberSubscriptions.memberId, row.memberId)))
    .returning();
  return mapCmsMemberSubscription(updated);
}

export async function updateMyCmsSubscription(id: number, notificationEnabled: boolean) {
  const row = await ensureOwnedSubscription(id);
  const [updated] = await db.update(cmsMemberSubscriptions)
    .set({ notificationEnabled })
    .where(and(eq(cmsMemberSubscriptions.id, id), eq(cmsMemberSubscriptions.memberId, row.memberId)))
    .returning();
  return mapCmsMemberSubscription(updated);
}

export async function listMyCmsSubscriptions(q: {
  page: number;
  pageSize: number;
  subjectType?: CmsSubscriptionSubjectType;
}) {
  const memberId = currentMemberId();
  const conditions: SQL[] = [
    eq(cmsMemberSubscriptions.memberId, memberId),
    eq(cmsMemberSubscriptions.active, true),
  ];
  if (q.subjectType) conditions.push(eq(cmsMemberSubscriptions.subjectType, q.subjectType));
  const where = and(...conditions);
  const base = db.select({ subscription: cmsMemberSubscriptions, siteName: cmsSites.name })
    .from(cmsMemberSubscriptions)
    .innerJoin(cmsSites, eq(cmsMemberSubscriptions.siteId, cmsSites.id))
    .where(where)
    .orderBy(desc(cmsMemberSubscriptions.createdAt), desc(cmsMemberSubscriptions.id));
  const [total, rows] = await Promise.all([
    db.$count(cmsMemberSubscriptions, where),
    withPagination(base.$dynamic(), q.page, q.pageSize),
  ]);
  return {
    list: rows.map((row) => mapCmsMemberSubscription(row.subscription, { siteName: row.siteName })),
    total,
    page: q.page,
    pageSize: q.pageSize,
  };
}

function maskedMemberDisplay(row: {
  nickname: string | null;
  username: string | null;
  phone: string | null;
  email: string | null;
}): string {
  if (row.nickname) return maskName(row.nickname);
  if (row.username) return maskName(row.username);
  if (row.phone) return maskPhone(row.phone);
  if (row.email) return maskEmail(row.email);
  return '会员';
}

export interface ListCmsSubscriptionsQuery {
  siteId: number;
  subjectType?: CmsSubscriptionSubjectType;
  subjectKeyword?: string;
  startTime?: string;
  endTime?: string;
  page: number;
  pageSize: number;
}

export function buildCmsSubscriptionWhere(q: Omit<ListCmsSubscriptionsQuery, 'page' | 'pageSize'>): SQL {
  const conditions: SQL[] = [
    eq(cmsMemberSubscriptions.siteId, q.siteId),
    eq(cmsMemberSubscriptions.active, true),
  ];
  if (q.subjectType) conditions.push(eq(cmsMemberSubscriptions.subjectType, q.subjectType));
  if (q.subjectKeyword) {
    conditions.push(ilike(cmsMemberSubscriptions.subjectLabel, `%${escapeLike(q.subjectKeyword)}%`));
  }
  if (q.startTime) {
    const parsed = parseDateRangeStart(q.startTime);
    if (!parsed) throw new HTTPException(400, { message: '开始时间格式无效' });
    conditions.push(gte(cmsMemberSubscriptions.createdAt, parsed));
  }
  if (q.endTime) {
    const parsed = parseDateRangeEnd(q.endTime);
    if (!parsed) throw new HTTPException(400, { message: '结束时间格式无效' });
    conditions.push(lte(cmsMemberSubscriptions.createdAt, parsed));
  }
  return and(...conditions)!;
}

export async function listCmsSubscriptions(q: ListCmsSubscriptionsQuery) {
  await ensureCmsSiteExists(q.siteId);
  await assertSiteAccess(q.siteId);
  const where = buildCmsSubscriptionWhere(q);
  const base = db.select({
    subscription: cmsMemberSubscriptions,
    siteName: cmsSites.name,
    nickname: members.nickname,
    username: members.username,
    phone: members.phone,
    email: members.email,
  })
    .from(cmsMemberSubscriptions)
    .innerJoin(cmsSites, eq(cmsMemberSubscriptions.siteId, cmsSites.id))
    .innerJoin(members, eq(cmsMemberSubscriptions.memberId, members.id))
    .where(where)
    .orderBy(desc(cmsMemberSubscriptions.createdAt), desc(cmsMemberSubscriptions.id));
  const [total, rows] = await Promise.all([
    db.$count(cmsMemberSubscriptions, where),
    withPagination(base.$dynamic(), q.page, q.pageSize),
  ]);
  return {
    list: rows.map((row) => mapCmsMemberSubscription(row.subscription, {
      siteName: row.siteName,
      memberDisplay: maskedMemberDisplay(row),
    })),
    total,
    page: q.page,
    pageSize: q.pageSize,
  };
}

function rawMemberDisplay(row: {
  id: number;
  nickname: string | null;
  username: string | null;
  phone: string | null;
  email: string | null;
}): string {
  return row.nickname || row.username || row.phone || row.email || `会员 #${row.id}`;
}

export async function* streamCmsSubscriptions(
  q: Omit<ListCmsSubscriptionsQuery, 'page' | 'pageSize'>,
) {
  await ensureCmsSiteExists(q.siteId);
  await assertSiteAccess(q.siteId);
  const baseWhere = buildCmsSubscriptionWhere(q);
  yield* streamByDescendingId(async (beforeId, limit) => {
    const rows = await db.select({
      subscription: cmsMemberSubscriptions,
      siteName: cmsSites.name,
      memberId: members.id,
      nickname: members.nickname,
      username: members.username,
      phone: members.phone,
      email: members.email,
    })
      .from(cmsMemberSubscriptions)
      .innerJoin(cmsSites, eq(cmsMemberSubscriptions.siteId, cmsSites.id))
      .innerJoin(members, eq(cmsMemberSubscriptions.memberId, members.id))
      .where(and(baseWhere, beforeId === null ? undefined : lt(cmsMemberSubscriptions.id, beforeId)))
      .orderBy(desc(cmsMemberSubscriptions.id))
      .limit(limit);
    return rows.map((row) => mapCmsMemberSubscription(row.subscription, {
      siteName: row.siteName,
      memberDisplay: rawMemberDisplay({
        id: row.memberId,
        nickname: row.nickname,
        username: row.username,
        phone: row.phone,
        email: row.email,
      }),
    }));
  });
}

export async function listCmsSubscriptionAggregates(q: Omit<ListCmsSubscriptionsQuery, 'page' | 'pageSize'>) {
  await ensureCmsSiteExists(q.siteId);
  await assertSiteAccess(q.siteId);
  const where = buildCmsSubscriptionWhere(q);
  return db.select({
    siteId: cmsMemberSubscriptions.siteId,
    subjectType: cmsMemberSubscriptions.subjectType,
    subjectKey: cmsMemberSubscriptions.subjectKey,
    subjectId: cmsMemberSubscriptions.subjectId,
    subjectLabel: cmsMemberSubscriptions.subjectLabel,
    subscriberCount: sql<number>`count(distinct ${cmsMemberSubscriptions.memberId})::int`,
    notificationEnabledCount: sql<number>`count(distinct ${cmsMemberSubscriptions.memberId}) filter (where ${cmsMemberSubscriptions.notificationEnabled})::int`,
  })
    .from(cmsMemberSubscriptions)
    .where(where)
    .groupBy(
      cmsMemberSubscriptions.siteId,
      cmsMemberSubscriptions.subjectType,
      cmsMemberSubscriptions.subjectKey,
      cmsMemberSubscriptions.subjectId,
      cmsMemberSubscriptions.subjectLabel,
    )
    .orderBy(desc(sql`count(distinct ${cmsMemberSubscriptions.memberId})`), asc(cmsMemberSubscriptions.subjectLabel));
}

export interface CmsSubscriptionRecipient {
  subscriptionId: number;
  memberId: number;
}

export async function getPublicCmsSubscriptionNotificationContent(
  contentId: number,
  contentVersion: number,
): Promise<CmsContentRow | null> {
  const now = new Date();
  const [row] = await db.select({ content: cmsContents }).from(cmsContents)
    .innerJoin(cmsSites, eq(cmsContents.siteId, cmsSites.id))
    .innerJoin(cmsChannels, eq(cmsContents.channelId, cmsChannels.id))
    .where(and(
      eq(cmsContents.id, contentId),
      eq(cmsContents.version, contentVersion),
      eq(cmsContents.status, 'published'),
      isNull(cmsContents.deletedAt),
      isNotNull(cmsContents.publishedAt),
      lte(cmsContents.publishedAt, now),
      or(isNull(cmsContents.expireAt), gte(cmsContents.expireAt, now)),
      eq(cmsSites.status, 'enabled'),
      eq(cmsChannels.status, 'enabled'),
    ))
    .limit(1);
  return row?.content ?? null;
}

export async function listCmsSubscriptionRecipients(
  content: Pick<CmsContentRow, 'id' | 'siteId' | 'channelId' | 'author'>,
  afterSubscriptionId: number,
  maxSubscriptionId: number,
  limit = 200,
): Promise<CmsSubscriptionRecipient[]> {
  const matches: SQL[] = [
    and(
      eq(cmsMemberSubscriptions.subjectType, 'site'),
      eq(cmsMemberSubscriptions.subjectKey, String(content.siteId)),
    )!,
    and(
      eq(cmsMemberSubscriptions.subjectType, 'channel'),
      eq(cmsMemberSubscriptions.subjectKey, String(content.channelId)),
    )!,
  ];
  const authorKey = content.author ? normalizeCmsAuthorKey(content.author) : '';
  if (authorKey) {
    matches.push(and(
      eq(cmsMemberSubscriptions.subjectType, 'author'),
      eq(cmsMemberSubscriptions.subjectKey, authorKey),
    )!);
  }
  return db.select({
    subscriptionId: cmsMemberSubscriptions.id,
    memberId: cmsMemberSubscriptions.memberId,
  })
    .from(cmsMemberSubscriptions)
    .where(and(
      eq(cmsMemberSubscriptions.siteId, content.siteId),
      eq(cmsMemberSubscriptions.active, true),
      eq(cmsMemberSubscriptions.notificationEnabled, true),
      sql`${cmsMemberSubscriptions.id} > ${afterSubscriptionId}`,
      lte(cmsMemberSubscriptions.id, maxSubscriptionId),
      or(...matches),
      inArray(
        cmsMemberSubscriptions.memberId,
        db.select({ id: members.id }).from(members).where(and(eq(members.status, 'active'), isNull(members.deletedAt))),
      ),
    ))
    .orderBy(cmsMemberSubscriptions.id)
    .limit(Math.min(Math.max(limit, 1), 500));
}
