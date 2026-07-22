import { and, asc, desc, eq, gte, lte, sql, type SQL } from 'drizzle-orm';
import { HTTPException } from 'hono/http-exception';
import { db } from '../../db';
import { cmsHotwordGroups, cmsHotwords, cmsSearchLogs } from '../../db/schema';
import type { CmsHotwordGroupRow } from '../../db/schema';
import { config } from '../../config';
import redis from '../../lib/redis';
import { formatDateTime, parseDateRangeEnd, parseDateRangeStart } from '../../lib/datetime';
import { rethrowPgUniqueViolation } from '../../lib/db-errors';
import { escapeLike } from '../../lib/where-helpers';
import type {
  CmsHotKeyword, CreateCmsHotwordGroupInput, CreateCmsHotwordInput, UpdateCmsHotwordGroupInput, UpdateCmsHotwordInput,
} from '@zenith/shared';
import { assertSiteAccess, ensureCmsSiteExists } from './cms-sites.service';

const HOTWORD_PREFIX = `${config.redis.keyPrefix}cms:hotwords:`;

export function mapCmsHotwordGroup(row: CmsHotwordGroupRow) {
  return {
    id: row.id,
    siteId: row.siteId,
    name: row.name,
    sort: row.sort,
    status: row.status,
    createdAt: formatDateTime(row.createdAt),
    updatedAt: formatDateTime(row.updatedAt),
  };
}

export async function ensureCmsHotwordGroupExists(id: number): Promise<CmsHotwordGroupRow> {
  const [row] = await db.select().from(cmsHotwordGroups).where(eq(cmsHotwordGroups.id, id)).limit(1);
  if (!row) throw new HTTPException(404, { message: '热词分组不存在' });
  return row;
}

export async function listCmsHotwordGroups(siteId: number) {
  await ensureCmsSiteExists(siteId);
  await assertSiteAccess(siteId);
  const rows = await db.select().from(cmsHotwordGroups)
    .where(eq(cmsHotwordGroups.siteId, siteId))
    .orderBy(asc(cmsHotwordGroups.sort), asc(cmsHotwordGroups.id));
  return rows.map(mapCmsHotwordGroup);
}

export async function createCmsHotwordGroup(input: CreateCmsHotwordGroupInput) {
  await ensureCmsSiteExists(input.siteId);
  await assertSiteAccess(input.siteId);
  try {
    const [row] = await db.insert(cmsHotwordGroups).values(input).returning();
    return mapCmsHotwordGroup(row);
  } catch (err) {
    rethrowPgUniqueViolation(err, '当前站点已存在同名热词分组');
  }
}

export async function updateCmsHotwordGroup(id: number, input: UpdateCmsHotwordGroupInput) {
  const current = await ensureCmsHotwordGroupExists(id);
  await assertSiteAccess(current.siteId);
  try {
    const [row] = await db.update(cmsHotwordGroups).set(input).where(eq(cmsHotwordGroups.id, id)).returning();
    return mapCmsHotwordGroup(row);
  } catch (err) {
    rethrowPgUniqueViolation(err, '当前站点已存在同名热词分组');
  }
}

export async function deleteCmsHotwordGroup(id: number): Promise<void> {
  const current = await ensureCmsHotwordGroupExists(id);
  await assertSiteAccess(current.siteId);
  if (await db.$count(cmsHotwords, eq(cmsHotwords.groupId, id)) > 0) {
    throw new HTTPException(400, { message: '分组内仍有热词，请先移动或删除热词' });
  }
  await db.delete(cmsHotwordGroups).where(eq(cmsHotwordGroups.id, id));
}

async function loadKeywordCounts(siteId: number, startTime?: string, endTime?: string): Promise<Map<string, number>> {
  const start = parseDateRangeStart(startTime);
  const end = parseDateRangeEnd(endTime);
  if (start || end) {
    const conditions: SQL[] = [eq(cmsSearchLogs.siteId, siteId)];
    if (start) conditions.push(gte(cmsSearchLogs.createdAt, start));
    if (end) conditions.push(lte(cmsSearchLogs.createdAt, end));
    const rows = await db.select({
      keyword: cmsSearchLogs.keyword,
      count: sql<number>`count(*)::int`,
    }).from(cmsSearchLogs).where(and(...conditions))
      .groupBy(cmsSearchLogs.keyword)
      .orderBy(desc(sql`count(*)`))
      .limit(500);
    return new Map(rows.map((row) => [row.keyword, row.count]));
  }
  const raw = await redis.zrevrange(`${HOTWORD_PREFIX}${siteId}`, 0, 499, 'WITHSCORES').catch(() => [] as string[]);
  const counts = new Map<string, number>();
  for (let index = 0; index < raw.length; index += 2) counts.set(raw[index], Number(raw[index + 1]) || 0);
  return counts;
}

export async function listCmsHotwords(input: {
  siteId: number;
  groupId?: number;
  keyword?: string;
  status?: 'enabled' | 'disabled';
  startTime?: string;
  endTime?: string;
  limit?: number;
}) {
  await ensureCmsSiteExists(input.siteId);
  await assertSiteAccess(input.siteId);
  const conditions: SQL[] = [eq(cmsHotwords.siteId, input.siteId)];
  if (input.groupId) conditions.push(eq(cmsHotwords.groupId, input.groupId));
  if (input.status) conditions.push(eq(cmsHotwords.status, input.status));
  if (input.keyword) conditions.push(sql`${cmsHotwords.keyword} ilike ${`%${escapeLike(input.keyword)}%`} escape '\\'`);
  const managed = await db.select({ hotword: cmsHotwords, groupName: cmsHotwordGroups.name })
    .from(cmsHotwords)
    .leftJoin(cmsHotwordGroups, eq(cmsHotwords.groupId, cmsHotwordGroups.id))
    .where(and(...conditions))
    .orderBy(asc(cmsHotwords.sort), asc(cmsHotwords.id));
  const counts = await loadKeywordCounts(input.siteId, input.startTime, input.endTime);
  const result: CmsHotKeyword[] = managed.map(({ hotword, groupName }) => ({
    id: hotword.id,
    siteId: hotword.siteId,
    groupId: hotword.groupId ?? null,
    groupName: groupName ?? null,
    keyword: hotword.keyword,
    count: counts.get(hotword.keyword) ?? 0,
    sort: hotword.sort,
    status: hotword.status,
  }));
  if (!input.groupId && !input.status && !input.keyword) {
    const managedKeywords = new Set(result.map((row) => row.keyword));
    for (const [keyword, count] of counts) {
      if (managedKeywords.has(keyword)) continue;
      result.push({ id: null, siteId: input.siteId, groupId: null, groupName: null, keyword, count, sort: 999999, status: 'enabled' });
    }
  }
  return result.sort((a, b) => a.sort - b.sort || b.count - a.count).slice(0, input.limit ?? 100);
}

async function ensureHotwordGroupForSite(siteId: number, groupId: number | null | undefined) {
  if (!groupId) return;
  const group = await ensureCmsHotwordGroupExists(groupId);
  if (group.siteId !== siteId) throw new HTTPException(400, { message: '热词分组不属于当前站点' });
}

export async function createCmsHotword(input: CreateCmsHotwordInput) {
  await ensureCmsSiteExists(input.siteId);
  await assertSiteAccess(input.siteId);
  await ensureHotwordGroupForSite(input.siteId, input.groupId);
  try {
    const [row] = await db.insert(cmsHotwords).values(input).returning();
    return row;
  } catch (err) {
    rethrowPgUniqueViolation(err, '当前站点已存在该热词');
  }
}

export async function updateCmsHotword(id: number, input: UpdateCmsHotwordInput) {
  const [current] = await db.select().from(cmsHotwords).where(eq(cmsHotwords.id, id)).limit(1);
  if (!current) throw new HTTPException(404, { message: '热词不存在' });
  await assertSiteAccess(current.siteId);
  await ensureHotwordGroupForSite(current.siteId, input.groupId);
  try {
    const [row] = await db.update(cmsHotwords).set(input).where(eq(cmsHotwords.id, id)).returning();
    return row;
  } catch (err) {
    rethrowPgUniqueViolation(err, '当前站点已存在该热词');
  }
}

export async function deleteCmsHotword(id: number): Promise<void> {
  const [current] = await db.select().from(cmsHotwords).where(eq(cmsHotwords.id, id)).limit(1);
  if (!current) throw new HTTPException(404, { message: '热词不存在' });
  await assertSiteAccess(current.siteId);
  await db.delete(cmsHotwords).where(eq(cmsHotwords.id, id));
}
