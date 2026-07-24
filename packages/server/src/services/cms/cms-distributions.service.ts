import { CronExpressionParser } from 'cron-parser';
import {
  and,
  asc,
  desc,
  eq,
  gt,
  gte,
  ilike,
  inArray,
  isNotNull,
  isNull,
  lte,
  or,
  sql,
  type SQL,
} from 'drizzle-orm';
import { HTTPException } from 'hono/http-exception';
import {
  createCmsDistributionRuleSchema,
  type AsyncTaskItem,
  type CmsDistributionFilters,
  type CmsDistributionMode,
  type CreateCmsDistributionRuleInput,
  type UpdateCmsContentInput,
  type UpdateCmsDistributionRuleInput,
} from '@zenith/shared';
import { db } from '../../db';
import {
  asyncTaskItems,
  asyncTasks,
  cmsChannels,
  cmsContents,
  cmsDistributionRules,
  cmsSites,
  type CmsContentRow,
  type CmsDistributionRuleRow,
} from '../../db/schema';
import { formatDateTime, formatNullableDateTime, parseDateRangeEnd, parseDateRangeStart } from '../../lib/datetime';
import { pageOffset } from '../../lib/pagination';
import { escapeLike } from '../../lib/where-helpers';
import logger from '../../lib/logger';
import {
  currentUserOrNull,
  hasPermission,
  runWithCurrentUser,
} from '../../lib/context';
import {
  mapAsyncTask,
  registerTaskHandler,
  submitAsyncTask,
  TaskCancelledError,
} from '../../lib/task-center';
import {
  assertChannelAccess,
  ensureCmsChannelExists,
} from './cms-channels.service';
import {
  assertSiteAccess,
  ensureCmsSiteExists,
  getAccessibleSiteIds,
} from './cms-sites.service';
import {
  assertCmsDistributionScope,
  cmsDistributionIdempotencyKey,
  decideCmsDistributionConflict,
} from './cms-distribution-policy';
import { sanitizeCmsHtml } from './cms-html-sanitizer';
import { buildSearchVector } from './cms-search.service';
import {
  resolveContentBodyExtend,
  offlineCmsContent,
  updateCmsContent,
} from './cms-contents.service';
import { assertCmsContentUnlocked } from './cms-content-lock.service';
import { logContentOp } from './cms-content-op-logs.service';

const SYSTEM_USER = { userId: 1, username: 'admin', roles: ['super_admin'], tenantId: null };
const DISTRIBUTION_TASK_TYPE = 'cms-distribution-sync';
const SCHEDULER_TIMEZONE = 'Asia/Shanghai';

function normalizedFilters(value: Partial<CmsDistributionFilters> | undefined): CmsDistributionFilters {
  return {
    statuses: ['published'],
    contentTypes: [...(value?.contentTypes ?? [])],
    keyword: value?.keyword?.trim() || null,
    publishedFrom: value?.publishedFrom ?? null,
    publishedTo: value?.publishedTo ?? null,
  };
}

function nextSchedule(cron: string | null, from = new Date()): Date | null {
  if (!cron) return null;
  try {
    return CronExpressionParser.parse(cron.trim(), {
      currentDate: from,
      tz: SCHEDULER_TIMEZONE,
    }).next().toDate();
  } catch {
    throw new HTTPException(400, { message: 'Cron 表达式无效' });
  }
}

async function validateRuleScope(input: {
  sourceSiteId: number;
  sourceChannelId: number | null;
  targetSiteId: number;
  targetChannelId: number;
  mode: CmsDistributionMode;
  scheduleCron: string | null;
  filters: CmsDistributionFilters;
}) {
  assertCmsDistributionScope(input);
  const [sourceSite, targetSite, targetChannel] = await Promise.all([
    ensureCmsSiteExists(input.sourceSiteId),
    ensureCmsSiteExists(input.targetSiteId),
    ensureCmsChannelExists(input.targetChannelId),
  ]);
  await assertSiteAccess(sourceSite.id);
  await assertSiteAccess(targetSite.id);
  await assertChannelAccess(targetChannel.id);
  if (sourceSite.status !== 'enabled' || targetSite.status !== 'enabled') {
    throw new HTTPException(400, { message: '来源站点与目标站点必须均为启用状态' });
  }
  if (targetChannel.siteId !== targetSite.id) {
    throw new HTTPException(400, { message: '目标栏目不属于目标站点' });
  }
  if (input.sourceChannelId != null) {
    const sourceChannel = await ensureCmsChannelExists(input.sourceChannelId);
    await assertChannelAccess(sourceChannel.id);
    if (sourceChannel.siteId !== sourceSite.id) {
      throw new HTTPException(400, { message: '来源栏目不属于来源站点' });
    }
  }
}

function mapRule(row: CmsDistributionRuleRow & {
  sourceSite: { name: string };
  sourceChannel?: { name: string } | null;
  targetSite: { name: string };
  targetChannel: { name: string };
}) {
  return {
    id: row.id,
    name: row.name,
    sourceSiteId: row.sourceSiteId,
    sourceSiteName: row.sourceSite.name,
    sourceChannelId: row.sourceChannelId ?? null,
    sourceChannelName: row.sourceChannel?.name ?? null,
    targetSiteId: row.targetSiteId,
    targetSiteName: row.targetSite.name,
    targetChannelId: row.targetChannelId,
    targetChannelName: row.targetChannel.name,
    mode: row.mode,
    conflictStrategy: row.conflictStrategy,
    filters: normalizedFilters(row.filters),
    scheduleCron: row.scheduleCron ?? null,
    nextRunAt: formatNullableDateTime(row.nextRunAt),
    lastRunAt: formatNullableDateTime(row.lastRunAt),
    status: row.status,
    revision: row.revision,
    remark: row.remark ?? null,
    createdBy: row.createdBy ?? null,
    updatedBy: row.updatedBy ?? null,
    createdAt: formatDateTime(row.createdAt),
    updatedAt: formatDateTime(row.updatedAt),
  };
}

async function ruleAccessConditions(): Promise<SQL[]> {
  const accessible = await getAccessibleSiteIds();
  if (accessible === null) return [];
  if (accessible.length === 0) return [sql`false`];
  return [
    inArray(cmsDistributionRules.sourceSiteId, accessible),
    inArray(cmsDistributionRules.targetSiteId, accessible),
  ];
}

export interface ListCmsDistributionRulesQuery {
  page: number;
  pageSize: number;
  keyword?: string;
  sourceSiteId?: number;
  targetSiteId?: number;
  mode?: CmsDistributionRuleRow['mode'];
  status?: CmsDistributionRuleRow['status'];
}

export async function listCmsDistributionRules(query: ListCmsDistributionRulesQuery) {
  const conditions = await ruleAccessConditions();
  if (query.keyword?.trim()) {
    conditions.push(ilike(cmsDistributionRules.name, `%${escapeLike(query.keyword.trim())}%`));
  }
  if (query.sourceSiteId) {
    await assertSiteAccess(query.sourceSiteId);
    conditions.push(eq(cmsDistributionRules.sourceSiteId, query.sourceSiteId));
  }
  if (query.targetSiteId) {
    await assertSiteAccess(query.targetSiteId);
    conditions.push(eq(cmsDistributionRules.targetSiteId, query.targetSiteId));
  }
  if (query.mode) conditions.push(eq(cmsDistributionRules.mode, query.mode));
  if (query.status) conditions.push(eq(cmsDistributionRules.status, query.status));
  const where = conditions.length ? and(...conditions) : undefined;
  const [total, rows] = await Promise.all([
    db.$count(cmsDistributionRules, where),
    db.query.cmsDistributionRules.findMany({
      where,
      with: {
        sourceSite: { columns: { name: true } },
        sourceChannel: { columns: { name: true } },
        targetSite: { columns: { name: true } },
        targetChannel: { columns: { name: true } },
      },
      orderBy: [desc(cmsDistributionRules.id)],
      limit: query.pageSize,
      offset: pageOffset(query.page, query.pageSize),
    }),
  ]);
  return { list: rows.map(mapRule), total, page: query.page, pageSize: query.pageSize };
}

export async function ensureCmsDistributionRuleExists(id: number) {
  const row = await db.query.cmsDistributionRules.findFirst({
    where: eq(cmsDistributionRules.id, id),
    with: {
      sourceSite: { columns: { name: true } },
      sourceChannel: { columns: { name: true } },
      targetSite: { columns: { name: true } },
      targetChannel: { columns: { name: true } },
    },
  });
  if (!row) throw new HTTPException(404, { message: '分发规则不存在' });
  return row;
}

async function ensureRuleAccessible(id: number) {
  const row = await ensureCmsDistributionRuleExists(id);
  await assertSiteAccess(row.sourceSiteId);
  await assertSiteAccess(row.targetSiteId);
  if (row.sourceChannelId != null) await assertChannelAccess(row.sourceChannelId);
  await assertChannelAccess(row.targetChannelId);
  return row;
}

export async function getCmsDistributionRule(id: number) {
  return mapRule(await ensureRuleAccessible(id));
}

export async function createCmsDistributionRule(input: CreateCmsDistributionRuleInput) {
  const filters = normalizedFilters(input.filters);
  const scope = {
    sourceSiteId: input.sourceSiteId,
    sourceChannelId: input.sourceChannelId ?? null,
    targetSiteId: input.targetSiteId,
    targetChannelId: input.targetChannelId,
    mode: input.mode ?? 'copy',
    scheduleCron: input.scheduleCron ?? null,
    filters,
  };
  await validateRuleScope(scope);
  const [row] = await db.insert(cmsDistributionRules).values({
    name: input.name.trim(),
    ...scope,
    conflictStrategy: input.conflictStrategy ?? 'skip',
    nextRunAt: input.status !== 'disabled' && scope.mode === 'scheduled'
      ? nextSchedule(scope.scheduleCron)
      : null,
    status: input.status ?? 'enabled',
    remark: input.remark ?? null,
  }).returning();
  return getCmsDistributionRule(row.id);
}

export async function updateCmsDistributionRule(id: number, input: UpdateCmsDistributionRuleInput) {
  const current = await ensureRuleAccessible(id);
  if (input.mode && input.mode !== current.mode) {
    const materialized = await db.$count(cmsContents, eq(cmsContents.distributionRuleId, id));
    if (materialized > 0) {
      throw new HTTPException(409, { message: '规则已有物化内容，不能切换分发模式；请新建规则' });
    }
  }
  const merged = {
    name: input.name ?? current.name,
    sourceSiteId: input.sourceSiteId ?? current.sourceSiteId,
    sourceChannelId: input.sourceChannelId === undefined ? current.sourceChannelId : input.sourceChannelId,
    targetSiteId: input.targetSiteId ?? current.targetSiteId,
    targetChannelId: input.targetChannelId ?? current.targetChannelId,
    mode: input.mode ?? current.mode,
    conflictStrategy: input.conflictStrategy ?? current.conflictStrategy,
    filters: normalizedFilters(input.filters ?? current.filters),
    scheduleCron: input.scheduleCron === undefined ? current.scheduleCron : input.scheduleCron,
    status: input.status ?? current.status,
    remark: input.remark === undefined ? current.remark : input.remark,
  };
  const parsed = createCmsDistributionRuleSchema.safeParse(merged);
  if (!parsed.success) throw new HTTPException(400, { message: parsed.error.issues[0]?.message ?? '分发规则无效' });
  await validateRuleScope({
    sourceSiteId: merged.sourceSiteId,
    sourceChannelId: merged.sourceChannelId,
    targetSiteId: merged.targetSiteId,
    targetChannelId: merged.targetChannelId,
    mode: merged.mode,
    scheduleCron: merged.scheduleCron,
    filters: merged.filters,
  });
  const [updated] = await db.update(cmsDistributionRules).set({
    ...merged,
    nextRunAt: merged.status === 'enabled' && merged.mode === 'scheduled'
      ? nextSchedule(merged.scheduleCron)
      : null,
    revision: sql`${cmsDistributionRules.revision} + 1`,
  }).where(eq(cmsDistributionRules.id, id)).returning();
  if (!updated) throw new HTTPException(404, { message: '分发规则不存在' });
  return getCmsDistributionRule(id);
}

export async function deleteCmsDistributionRule(id: number): Promise<void> {
  await ensureRuleAccessible(id);
  await db.transaction(async (tx) => {
    const [rule] = await tx.select().from(cmsDistributionRules)
      .where(eq(cmsDistributionRules.id, id)).for('update').limit(1);
    if (!rule) throw new HTTPException(404, { message: '分发规则不存在' });
    const materialized = await tx.select().from(cmsContents)
      .where(eq(cmsContents.distributionRuleId, id)).for('update');
    const lockedMapping = materialized.find((content) => content.mappingSourceId != null && content.lockedAt);
    if (lockedMapping) {
      throw new HTTPException(423, {
        message: `映射内容 #${lockedMapping.id} 已锁定，不能删除规则并解除映射`,
      });
    }
    const sourceIds = [...new Set(materialized
      .map((content) => content.mappingSourceId)
      .filter((sourceId): sourceId is number => sourceId != null))];
    const directSources = sourceIds.length
      ? await tx.select().from(cmsContents).where(inArray(cmsContents.id, sourceIds))
      : [];
    const originIds = [...new Set(directSources
      .map((source) => source.mappingSourceId)
      .filter((sourceId): sourceId is number => sourceId != null))];
    const origins = originIds.length
      ? await tx.select().from(cmsContents).where(inArray(cmsContents.id, originIds))
      : [];
    const sourceById = new Map([...directSources, ...origins].map((source) => [source.id, source]));
    for (const content of materialized) {
      if (content.mappingSourceId == null) continue;
      const source = sourceById.get(content.mappingSourceId);
      const origin = source?.mappingSourceId ? sourceById.get(source.mappingSourceId) : source;
      await tx.update(cmsContents).set({
        body: sanitizeCmsHtml(origin?.body ?? content.body),
        extend: origin?.extend ?? content.extend ?? {},
        mappingSourceId: null,
        distributionRuleId: null,
        version: sql`${cmsContents.version} + 1`,
      }).where(eq(cmsContents.id, content.id));
      await logContentOp(tx, content.id, 'updated', `分发规则 #${id} 删除，映射已物化为独立内容`);
    }
    const [deleted] = await tx.delete(cmsDistributionRules).where(eq(cmsDistributionRules.id, id)).returning();
    if (!deleted) throw new HTTPException(404, { message: '分发规则不存在' });
  });
}

function sourceConditions(rule: CmsDistributionRuleRow, afterId?: number): SQL[] {
  const filters = normalizedFilters(rule.filters);
  const conditions: SQL[] = [
    eq(cmsContents.siteId, rule.sourceSiteId),
    eq(cmsContents.status, 'published'),
    isNull(cmsContents.deletedAt),
    isNull(cmsContents.archivedAt),
    isNull(cmsContents.distributionSourceId),
  ];
  if (rule.sourceChannelId != null) conditions.push(eq(cmsContents.channelId, rule.sourceChannelId));
  if (filters.contentTypes.length) conditions.push(inArray(cmsContents.contentType, filters.contentTypes));
  if (filters.keyword) {
    const keyword = `%${escapeLike(filters.keyword)}%`;
    conditions.push(or(ilike(cmsContents.title, keyword), ilike(cmsContents.summary, keyword))!);
  }

  const start = parseDateRangeStart(filters.publishedFrom ?? undefined);
  const end = parseDateRangeEnd(filters.publishedTo ?? undefined);
  if (start) conditions.push(gte(cmsContents.publishedAt, start));
  if (end) conditions.push(lte(cmsContents.publishedAt, end));
  if (afterId) conditions.push(gt(cmsContents.id, afterId));
  return conditions;
}

function sourceMatchesRule(rule: CmsDistributionRuleRow, source: CmsContentRow): boolean {
  const filters = normalizedFilters(rule.filters);
  if (source.status !== 'published' || source.deletedAt || source.archivedAt) return false;
  if (source.siteId !== rule.sourceSiteId) return false;
  if (rule.sourceChannelId != null && source.channelId !== rule.sourceChannelId) return false;
  if (filters.contentTypes.length && !filters.contentTypes.includes(source.contentType)) return false;
  if (filters.keyword && !`${source.title} ${source.summary ?? ''}`.includes(filters.keyword)) return false;
  const start = parseDateRangeStart(filters.publishedFrom ?? undefined);
  const end = parseDateRangeEnd(filters.publishedTo ?? undefined);
  if (start && (!source.publishedAt || source.publishedAt < start)) return false;
  if (end && (!source.publishedAt || source.publishedAt > end)) return false;
  return true;
}

async function sourceWatermark(rule: CmsDistributionRuleRow): Promise<string> {
  const [row] = await db.select({
    maxId: sql<number>`coalesce(max(${cmsContents.id}), 0)::int`,
    maxVersion: sql<number>`coalesce(max(${cmsContents.version}), 0)::int`,
    count: sql<number>`count(*)::int`,
  }).from(cmsContents).where(and(...sourceConditions(rule)));
  return `${row?.count ?? 0}-${row?.maxId ?? 0}-${row?.maxVersion ?? 0}`;
}

export async function submitCmsDistributionRun(
  ruleId: number,
  trigger: 'manual' | 'scheduled' | 'mapping-update' = 'manual',
  options?: { system?: boolean; watermark?: string },
) {
  if (!options?.system && !(await hasPermission('cms:distribution:run'))) {
    throw new HTTPException(403, { message: '缺少 cms:distribution:run 权限' });
  }
  const rule = options?.system
    ? await ensureCmsDistributionRuleExists(ruleId)
    : await ensureRuleAccessible(ruleId);
  if (rule.status !== 'enabled') throw new HTTPException(409, { message: '分发规则已停用' });
  const watermark = options?.watermark ?? await sourceWatermark(rule);
  const actor = currentUserOrNull() ?? SYSTEM_USER;
  return runWithCurrentUser({ ...actor, tenantId: null, viewingTenantId: undefined }, async () => {
    const baseIdempotencyKey = cmsDistributionIdempotencyKey({
      ruleId: rule.id,
      revision: rule.revision,
      trigger,
      watermark,
    });
    let idempotencyKey = baseIdempotencyKey;
    if (trigger === 'manual') {
      const [latest] = await db.select().from(asyncTasks).where(and(
        eq(asyncTasks.taskType, DISTRIBUTION_TASK_TYPE),
        sql`${asyncTasks.payload}->>'ruleId' = ${String(rule.id)}`,
        sql`${asyncTasks.payload}->>'expectedRevision' = ${String(rule.revision)}`,
        sql`${asyncTasks.payload}->>'trigger' = 'manual'`,
        sql`${asyncTasks.payload}->>'watermark' = ${watermark}`,
      )).orderBy(desc(asyncTasks.id)).limit(1);
      if (latest && ['pending', 'running'].includes(latest.status)) return mapAsyncTask(latest);
      if (latest) idempotencyKey = `${baseIdempotencyKey.slice(0, 104)}:retry:${latest.id}`.slice(0, 128);
    }
    const row = await submitAsyncTask({
      taskType: DISTRIBUTION_TASK_TYPE,
      title: `CMS 内容分发：${rule.name}`,
      payload: {
        ruleId: rule.id,
        expectedRevision: rule.revision,
        sourceSiteId: rule.sourceSiteId,
        targetSiteId: rule.targetSiteId,
        trigger,
        watermark,
      },
      idempotencyKey,
    });
    return mapAsyncTask(row);
  });
}

function updatePatch(source: CmsContentRow, body: string, mode: CmsDistributionMode): UpdateCmsContentInput {
  return {
    expectedVersion: undefined,
    channelId: undefined,
    title: source.title,
    subTitle: source.subTitle,
    shortTitle: source.shortTitle,
    summary: source.summary,
    coverImage: source.coverImage,
    coverThumb: source.coverThumb,
    author: source.author,
    editor: source.editor,
    source: source.source,
    sourceUrl: source.sourceUrl,
    isOriginal: source.isOriginal,
    mediaData: source.mediaData,
    externalLink: source.externalLink,
    detailTemplate: null,
    isTop: false,
    topWeight: 0,
    topExpireAt: null,
    isRecommend: source.isRecommend,
    isHot: source.isHot,
    seoTitle: source.seoTitle,
    seoKeywords: source.seoKeywords,
    seoDescription: source.seoDescription,
    ...(mode === 'mapping' ? {} : { body, extend: source.extend ?? {} }),
  };
}

async function createMaterializedContent(
  rule: CmsDistributionRuleRow,
  source: CmsContentRow,
  targetChannel: typeof cmsChannels.$inferSelect,
  body: string,
  extend: Record<string, unknown>,
  slug: string | null,
) {
  const mappingSourceId = rule.mode === 'mapping' ? (source.mappingSourceId ?? source.id) : null;
  const [created] = await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext('cms-distribution-item'), ${source.id})`);
    const [existing] = await tx.select({ id: cmsContents.id }).from(cmsContents).where(and(
      eq(cmsContents.distributionRuleId, rule.id),
      eq(cmsContents.distributionSourceId, source.id),
      isNull(cmsContents.deletedAt),
    )).limit(1);
    if (existing) return tx.select().from(cmsContents).where(eq(cmsContents.id, existing.id)).limit(1);
    const rows = await tx.insert(cmsContents).values({
      siteId: rule.targetSiteId,
      channelId: rule.targetChannelId,
      modelId: targetChannel.modelId ?? null,
      contentType: source.contentType,
      mediaData: source.mediaData ?? {},
      title: source.title,
      subTitle: source.subTitle,
      shortTitle: source.shortTitle,
      slug,
      summary: source.summary,
      coverImage: source.coverImage,
      coverThumb: source.coverThumb,
      author: source.author,
      editor: source.editor,
      source: source.source,
      sourceUrl: source.sourceUrl,
      isOriginal: false,
      body: rule.mode === 'mapping' ? null : body,
      extend: rule.mode === 'mapping' ? {} : extend,
      externalLink: source.externalLink,
      detailTemplate: null,
      isTop: false,
      topWeight: 0,
      isRecommend: source.isRecommend,
      isHot: source.isHot,
      hasImage: source.hasImage,
      hasVideo: source.hasVideo,
      hasAttachment: source.hasAttachment,
      status: 'draft',
      viewCount: 0,
      likeCount: 0,
      favoriteCount: 0,
      sort: source.sort,
      seoTitle: source.seoTitle,
      seoKeywords: source.seoKeywords,
      seoDescription: source.seoDescription,
      socialImageAlt: source.socialImageAlt,
      twitterCreator: source.twitterCreator,
      mappingSourceId,
      distributionRuleId: rule.id,
      distributionSourceId: source.id,
      distributionSourceVersion: source.version,
      searchVector: buildSearchVector({
        siteId: rule.targetSiteId,
        title: source.title,
        seoKeywords: source.seoKeywords,
        summary: source.summary,
        body,
        extendTexts: Object.values(extend).filter((value): value is string => typeof value === 'string'),
      }),
    }).returning();
    await logContentOp(tx, rows[0].id, 'created', `分发规则 #${rule.id} 从内容 #${source.id} 创建草稿`);
    return rows;
  });
  return created;
}

async function synchronizeExisting(
  rule: CmsDistributionRuleRow,
  source: CmsContentRow,
  target: CmsContentRow,
  body: string,
  extend: Record<string, unknown>,
) {
  assertCmsContentUnlocked(target);
  const patch = updatePatch(source, body, rule.mode);
  patch.expectedVersion = target.version;
  await updateCmsContent(target.id, patch, { suppressDistributionSideEffects: true });
  const mappingSourceId = rule.mode === 'mapping' ? (source.mappingSourceId ?? source.id) : null;
  const [updated] = await db.update(cmsContents).set({
    mappingSourceId,
    ...(rule.mode === 'mapping' ? { body: null, extend: {} } : { body, extend }),
    distributionRuleId: rule.id,
    distributionSourceId: source.id,
    distributionSourceVersion: source.version,
    searchVector: buildSearchVector({
      siteId: rule.targetSiteId,
      title: source.title,
      seoKeywords: source.seoKeywords,
      summary: source.summary,
      body,
      extendTexts: Object.values(extend).filter((value): value is string => typeof value === 'string'),
    }),
  }).where(eq(cmsContents.id, target.id)).returning();
  await logContentOp(db, target.id, 'updated', `分发规则 #${rule.id} 同步来源内容 #${source.id} v${source.version}`);
  return updated;
}

interface SyncOneResult {
  outcome: 'success' | 'skipped' | 'conflict';
  targetContentId: number | null;
  message: string;
}

async function synchronizeOne(
  rule: CmsDistributionRuleRow,
  source: CmsContentRow,
  targetChannel: typeof cmsChannels.$inferSelect,
): Promise<SyncOneResult> {
  if (source.status !== 'published' || source.deletedAt || source.archivedAt) {
    return { outcome: 'skipped', targetContentId: null, message: '来源内容已不再满足已发布条件' };
  }
  const resolved = await resolveContentBodyExtend(source);
  const body = sanitizeCmsHtml(resolved.body);
  const extend = resolved.extend;
  const [tracked] = await db.select().from(cmsContents).where(and(
    eq(cmsContents.distributionRuleId, rule.id),
    eq(cmsContents.distributionSourceId, source.id),
    isNull(cmsContents.deletedAt),
  )).limit(1);
  const identity = source.slug
    ? or(eq(cmsContents.slug, source.slug), eq(cmsContents.title, source.title))
    : eq(cmsContents.title, source.title);
  const [conflict] = tracked ? [null] : await db.select().from(cmsContents).where(and(
    eq(cmsContents.siteId, rule.targetSiteId),
    eq(cmsContents.channelId, rule.targetChannelId),
    isNull(cmsContents.deletedAt),
    identity,
  )).orderBy(asc(cmsContents.id)).limit(1);
  const candidate = tracked ?? conflict;
  const decision = decideCmsDistributionConflict({
    tracked: Boolean(tracked),
    conflict: Boolean(conflict),
    locked: Boolean(candidate?.lockedAt),
    strategy: rule.conflictStrategy,
  });
  if (decision === 'locked') {
    return { outcome: 'conflict', targetContentId: candidate?.id ?? null, message: '目标内容已锁定，禁止覆盖' };
  }
  if (decision === 'skip') {
    return { outcome: 'conflict', targetContentId: conflict?.id ?? null, message: '目标存在同标识内容，按规则跳过' };
  }
  if (tracked && (tracked.distributionSourceVersion ?? 0) >= source.version) {
    return { outcome: 'skipped', targetContentId: tracked.id, message: `来源 v${source.version} 已同步，幂等跳过` };
  }
  if (decision === 'update-tracked' || decision === 'overwrite') {
    const updated = await synchronizeExisting(rule, source, candidate!, body, extend);
    return {
      outcome: 'success',
      targetContentId: updated.id,
      message: decision === 'overwrite' ? '已安全覆盖目标内容' : `已同步来源 v${source.version}`,
    };
  }
  const created = await createMaterializedContent(
    rule,
    source,
    targetChannel,
    body,
    extend,
    decision === 'create-new' ? null : source.slug,
  );
  return {
    outcome: 'success',
    targetContentId: created.id,
    message: rule.mode === 'mapping' ? '已创建映射草稿' : '已创建独立草稿',
  };
}

async function mappingTargetsForCheck(rule: CmsDistributionRuleRow, afterTargetId: number) {
  if (rule.mode !== 'mapping') return [];
  const targets = await db.select().from(cmsContents).where(and(
    eq(cmsContents.distributionRuleId, rule.id),
    isNotNull(cmsContents.distributionSourceId),
    isNull(cmsContents.deletedAt),
    gt(cmsContents.id, afterTargetId),
  )).orderBy(asc(cmsContents.id)).limit(100);
  if (!targets.length) return [];
  const sourceIds = [...new Set(targets.map((target) => target.distributionSourceId!))];
  const sources = await db.select().from(cmsContents).where(inArray(cmsContents.id, sourceIds));
  const sourceById = new Map(sources.map((source) => [source.id, source]));
  return targets
    .map((target) => ({ target, source: sourceById.get(target.distributionSourceId!) ?? null }));
}

async function detachStaleMapping(
  rule: CmsDistributionRuleRow,
  target: CmsContentRow,
  source: CmsContentRow | null,
) {
  assertCmsContentUnlocked(target);
  if (target.status === 'published') await offlineCmsContent(target.id);
  const body = sanitizeCmsHtml(source?.body ?? target.body);
  const extend = source?.extend ?? target.extend ?? {};
  const [updated] = await db.update(cmsContents).set({
    body,
    extend,
    mappingSourceId: null,
    distributionSourceVersion: source?.version ?? target.distributionSourceVersion,
    version: sql`${cmsContents.version} + 1`,
    searchVector: buildSearchVector({
      siteId: target.siteId,
      title: target.title,
      seoKeywords: target.seoKeywords,
      summary: target.summary,
      body,
      extendTexts: Object.values(extend).filter((value): value is string => typeof value === 'string'),
    }),
  }).where(and(eq(cmsContents.id, target.id), isNull(cmsContents.lockedAt))).returning();
  if (!updated) throw new HTTPException(409, { message: '目标内容锁状态已变化' });
  await logContentOp(
    db,
    target.id,
    'offlined',
    `分发规则 #${rule.id} 来源不再满足已发布条件，已下线并物化最后快照`,
  );
  return updated;
}

async function assertDistributionRuleFence(ruleId: number, expectedRevision: number): Promise<void> {
  const [current] = await db.select({
    revision: cmsDistributionRules.revision,
    status: cmsDistributionRules.status,
  }).from(cmsDistributionRules).where(eq(cmsDistributionRules.id, ruleId)).limit(1);
  if (!current || current.revision !== expectedRevision || current.status !== 'enabled') {
    throw new TaskCancelledError('分发规则已删除、变更或停用，任务已在批次边界取消', {
      stale: true,
      ruleId,
      expectedRevision,
      currentRevision: current?.revision ?? null,
      deleted: !current,
    });
  }
}

export function registerCmsDistributionTaskHandler(): void {
  registerTaskHandler({
    taskType: DISTRIBUTION_TASK_TYPE,
    title: 'CMS 内容分发同步',
    module: 'CMS内容管理',
    description: '按受治理规则批量同步已发布内容，支持断点、取消、行级结果与有限幂等。',
    allowConcurrent: true,
    maxAttempts: 3,
    retryDelayMs: 5000,
    async run(ctx) {
      if (!(await hasPermission('cms:distribution:run'))) {
        throw new Error('分发任务创建者的 cms:distribution:run 权限已失效');
      }
      const ruleId = Number(ctx.payload.ruleId);
      const expectedRevision = Number(ctx.payload.expectedRevision);
      let rule;
      try {
        rule = await ensureCmsDistributionRuleExists(ruleId);
      } catch (error) {
        if (error instanceof HTTPException && error.status === 404) {
          throw new TaskCancelledError('分发规则已删除，旧任务已取消', {
            stale: true,
            ruleId,
            expectedRevision,
            deleted: true,
          });
        }
        throw error;
      }
      if (rule.revision !== expectedRevision || rule.status !== 'enabled') {
        throw new TaskCancelledError('分发规则已变更或停用，旧任务已取消', {
          stale: true,
          ruleId,
          expectedRevision,
          currentRevision: rule.revision,
        });
      }
      await assertSiteAccess(rule.sourceSiteId);
      await assertSiteAccess(rule.targetSiteId);
      if (rule.sourceChannelId != null) await assertChannelAccess(rule.sourceChannelId);
      await assertChannelAccess(rule.targetChannelId);
      const targetChannel = await ensureCmsChannelExists(rule.targetChannelId);
      if (targetChannel.siteId !== rule.targetSiteId) throw new Error('目标栏目范围已失效');
      const sourceTotal = await db.$count(cmsContents, and(...sourceConditions(rule)));
      let total = sourceTotal;
      let lastSourceId = Number(ctx.checkpoint?.lastSourceId ?? 0);
      let lastTargetId = Number(ctx.checkpoint?.lastTargetId ?? 0);
      let processed = Number(ctx.checkpoint?.processed ?? 0);
      let succeeded = Number(ctx.checkpoint?.succeeded ?? 0);
      let skipped = Number(ctx.checkpoint?.skipped ?? 0);
      let conflicts = Number(ctx.checkpoint?.conflicts ?? 0);
      let failed = Number(ctx.checkpoint?.failed ?? 0);
      while (true) {
        await assertDistributionRuleFence(ruleId, expectedRevision);
        const rows = await db.select().from(cmsContents)
          .where(and(...sourceConditions(rule, lastSourceId)))
          .orderBy(asc(cmsContents.id))
          .limit(100);
        if (!rows.length) break;
        for (const source of rows) {
          let itemStatus: AsyncTaskItem['status'] = 'success';
          let message: string;
          let targetContentId: number | null = null;
          let outcome: 'success' | 'skipped' | 'conflict' | 'failed';
          try {
            const result = await synchronizeOne(rule, source, targetChannel);
            outcome = result.outcome;
            message = result.message;
            targetContentId = result.targetContentId;
            if (result.outcome === 'success') succeeded += 1;
            else if (result.outcome === 'skipped') {
              skipped += 1;
              itemStatus = 'skipped';
            } else {
              conflicts += 1;
              itemStatus = 'skipped';
            }
          } catch (error) {
            outcome = 'failed';
            failed += 1;
            itemStatus = 'failed';
            message = error instanceof Error ? error.message.slice(0, 500) : '同步失败';
          }
          processed += 1;
          lastSourceId = source.id;
          await ctx.reportItems([{
            key: `source:${source.id}`,
            label: source.title,
            status: itemStatus,
            message,
            data: {
              outcome,
              ruleId,
              sourceContentId: source.id,
              targetContentId,
              sourceVersion: source.version,
            },
          }]);
          const checkpoint = { lastSourceId, lastTargetId, processed, succeeded, skipped, conflicts, failed };
          const progress = await ctx.progress({
            processed,
            failed,
            total,
            note: `分发 ${processed}/${total}：成功 ${succeeded}，跳过 ${skipped}，冲突 ${conflicts}，失败 ${failed}`,
            checkpoint,
          });
          if (progress.cancelRequested) return checkpoint;
        }
      }
      if (rule.mode === 'mapping') {
        const mappingTotal = await db.$count(cmsContents, and(
          eq(cmsContents.distributionRuleId, rule.id),
          isNotNull(cmsContents.distributionSourceId),
          isNull(cmsContents.deletedAt),
        ));
        total = sourceTotal + mappingTotal;
        while (true) {
          await assertDistributionRuleFence(ruleId, expectedRevision);
          const targets = await mappingTargetsForCheck(rule, lastTargetId);
          if (!targets.length) break;
          for (const { target, source } of targets) {
            let status: AsyncTaskItem['status'] = 'skipped';
            let outcome: 'success' | 'skipped' | 'conflict' | 'failed' = 'skipped';
            let message = '映射来源仍满足规则';
            try {
              if (!source || !sourceMatchesRule(rule, source)) {
                if (target.lockedAt) {
                  outcome = 'conflict';
                  conflicts += 1;
                  message = '来源已失效，但目标内容被锁定，未自动下线';
                } else {
                  await detachStaleMapping(rule, target, source);
                  outcome = 'success';
                  status = 'success';
                  succeeded += 1;
                  message = '来源不再满足规则，目标已安全下线并物化最后快照';
                }
              } else {
                skipped += 1;
              }
            } catch (error) {
              outcome = 'failed';
              status = 'failed';
              failed += 1;
              message = error instanceof Error ? error.message.slice(0, 500) : '映射失效处理失败';
            }
            processed += 1;
            lastTargetId = target.id;
            await ctx.reportItems([{
              key: `mapping-check:${target.id}`,
              label: target.title,
              status,
              message,
              data: {
                outcome,
                ruleId,
                sourceContentId: target.distributionSourceId,
                targetContentId: target.id,
              },
            }]);
            const checkpoint = { lastSourceId, lastTargetId, processed, succeeded, skipped, conflicts, failed };
            const progress = await ctx.progress({
              processed,
              failed,
              total,
              note: `分发 ${processed}/${total}：成功 ${succeeded}，跳过 ${skipped}，冲突 ${conflicts}，失败 ${failed}`,
              checkpoint,
            });
            if (progress.cancelRequested) return checkpoint;
          }
        }
      }
      await db.update(cmsDistributionRules).set({ lastRunAt: new Date() }).where(and(
        eq(cmsDistributionRules.id, rule.id),
        eq(cmsDistributionRules.revision, expectedRevision),
      ));
      return { processed, succeeded, skipped, conflicts, failed };
    },
  });
}

export async function submitCmsMappingDistributionSideEffects(sourceContentId: number): Promise<void> {
  const [source] = await db.select({
    id: cmsContents.id,
    siteId: cmsContents.siteId,
    channelId: cmsContents.channelId,
    version: cmsContents.version,
    distributionSourceId: cmsContents.distributionSourceId,
  }).from(cmsContents).where(eq(cmsContents.id, sourceContentId)).limit(1);
  if (!source || source.distributionSourceId != null) return;
  const rules = await db.select().from(cmsDistributionRules).where(and(
    eq(cmsDistributionRules.sourceSiteId, source.siteId),
    or(isNull(cmsDistributionRules.sourceChannelId), eq(cmsDistributionRules.sourceChannelId, source.channelId)),
    eq(cmsDistributionRules.mode, 'mapping'),
    eq(cmsDistributionRules.status, 'enabled'),
  ));
  for (const rule of rules) {
    await runWithCurrentUser(SYSTEM_USER, () => submitCmsDistributionRun(rule.id, 'mapping-update', {
      system: true,
      watermark: `${source.id}-v${source.version}`,
    }));
  }
}

export interface ListCmsDistributionRunsQuery {
  page: number;
  pageSize: number;
  ruleId?: number;
  siteId?: number;
  status?: 'pending' | 'running' | 'success' | 'failed' | 'cancelled';
  startTime?: string;
  endTime?: string;
}

export async function buildCmsDistributionRunConditions(
  query: Omit<ListCmsDistributionRunsQuery, 'page' | 'pageSize'>,
): Promise<SQL[]> {
  const conditions: SQL[] = [eq(asyncTasks.taskType, DISTRIBUTION_TASK_TYPE)];
  const accessible = await getAccessibleSiteIds();
  if (accessible !== null) {
    if (!accessible.length) conditions.push(sql`false`);
    else {
      const values = sql.join(accessible.map((id) => sql`${String(id)}`), sql`, `);
      conditions.push(sql`${asyncTasks.payload}->>'sourceSiteId' in (${values})`);
      conditions.push(sql`${asyncTasks.payload}->>'targetSiteId' in (${values})`);
    }
  }
  if (query.ruleId) conditions.push(sql`${asyncTasks.payload}->>'ruleId' = ${String(query.ruleId)}`);
  if (query.siteId) {
    await assertSiteAccess(query.siteId);
    conditions.push(sql`(
      ${asyncTasks.payload}->>'sourceSiteId' = ${String(query.siteId)}
      or ${asyncTasks.payload}->>'targetSiteId' = ${String(query.siteId)}
    )`);
  }
  if (query.status) conditions.push(eq(asyncTasks.status, query.status));
  const start = parseDateRangeStart(query.startTime);
  const end = parseDateRangeEnd(query.endTime);
  if (start) conditions.push(gte(asyncTasks.createdAt, start));
  if (end) conditions.push(lte(asyncTasks.createdAt, end));
  return conditions;
}

async function mapRuns(rows: Array<typeof asyncTasks.$inferSelect>) {
  const ruleIds = [...new Set(rows.map((row) => Number(row.payload.ruleId)).filter((id) => id > 0))];
  const siteIds = [...new Set(rows.flatMap((row) => [
    Number(row.payload.sourceSiteId),
    Number(row.payload.targetSiteId),
  ]).filter((id) => id > 0))];
  const [rules, sites] = await Promise.all([
    ruleIds.length
      ? db.select({ id: cmsDistributionRules.id, name: cmsDistributionRules.name }).from(cmsDistributionRules)
        .where(inArray(cmsDistributionRules.id, ruleIds))
      : Promise.resolve([]),
    siteIds.length
      ? db.select({ id: cmsSites.id, name: cmsSites.name }).from(cmsSites).where(inArray(cmsSites.id, siteIds))
      : Promise.resolve([]),
  ]);
  return rows.map((row) => {
    const task = mapAsyncTask(row);
    const result = row.result ?? {};
    const ruleId = Number(row.payload.ruleId);
    const sourceSiteId = Number(row.payload.sourceSiteId);
    const targetSiteId = Number(row.payload.targetSiteId);
    return {
      ...task,
      ruleId,
      ruleName: rules.find((rule) => rule.id === ruleId)?.name ?? null,
      sourceSiteId,
      sourceSiteName: sites.find((site) => site.id === sourceSiteId)?.name ?? null,
      targetSiteId,
      targetSiteName: sites.find((site) => site.id === targetSiteId)?.name ?? null,
      trigger: ['scheduled', 'mapping-update'].includes(String(row.payload.trigger))
        ? row.payload.trigger as 'scheduled' | 'mapping-update'
        : 'manual' as const,
      succeeded: Number(result.succeeded ?? 0),
      skipped: Number(result.skipped ?? 0),
      conflicts: Number(result.conflicts ?? 0),
    };
  });
}

export async function listCmsDistributionRuns(query: ListCmsDistributionRunsQuery) {
  const where = and(...await buildCmsDistributionRunConditions(query));
  const [total, rows] = await Promise.all([
    db.$count(asyncTasks, where),
    db.select().from(asyncTasks).where(where).orderBy(desc(asyncTasks.id))
      .limit(query.pageSize).offset(pageOffset(query.page, query.pageSize)),
  ]);
  return { list: await mapRuns(rows), total, page: query.page, pageSize: query.pageSize };
}

async function ensureDistributionRunAccessible(id: number) {
  const conditions = await buildCmsDistributionRunConditions({});
  const [row] = await db.select().from(asyncTasks).where(and(eq(asyncTasks.id, id), ...conditions)).limit(1);
  if (!row) throw new HTTPException(404, { message: '分发同步记录不存在' });
  return row;
}

function mapRunItem(row: typeof asyncTaskItems.$inferSelect): AsyncTaskItem {
  return {
    id: row.id,
    taskId: row.taskId,
    itemKey: row.itemKey,
    label: row.label ?? null,
    status: row.status,
    message: row.message ?? null,
    data: row.data ?? null,
    attempt: row.attempt,
    createdAt: formatDateTime(row.createdAt),
    updatedAt: formatDateTime(row.updatedAt),
  };
}

export async function getCmsDistributionRunDetail(id: number) {
  const row = await ensureDistributionRunAccessible(id);
  const [run] = await mapRuns([row]);
  const items = await db.select().from(asyncTaskItems)
    .where(eq(asyncTaskItems.taskId, id))
    .orderBy(asc(asyncTaskItems.id))
    .limit(5000);
  return { run, items: items.map(mapRunItem) };
}

export async function loadCmsDistributionExportRows(query: Record<string, unknown>) {
  const positive = (value: unknown) => {
    const parsed = Number(value);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
  };
  const conditions = await buildCmsDistributionRunConditions({
    ruleId: positive(query.ruleId),
    siteId: positive(query.siteId),
    status: typeof query.status === 'string'
      ? query.status as ListCmsDistributionRunsQuery['status']
      : undefined,
    startTime: typeof query.startTime === 'string' ? query.startTime : undefined,
    endTime: typeof query.endTime === 'string' ? query.endTime : undefined,
  });
  const rows = await db.select({ task: asyncTasks, item: asyncTaskItems })
    .from(asyncTaskItems)
    .innerJoin(asyncTasks, eq(asyncTaskItems.taskId, asyncTasks.id))
    .where(and(...conditions))
    .orderBy(desc(asyncTasks.id), asc(asyncTaskItems.id))
    .limit(50_000);
  const mappedRuns = await mapRuns([...new Map(rows.map(({ task }) => [task.id, task])).values()]);
  const runById = new Map(mappedRuns.map((run) => [run.id, run]));
  return rows.map(({ task, item }) => {
    const run = runById.get(task.id)!;
    return {
      taskId: task.id,
      ruleId: run.ruleId,
      ruleName: run.ruleName ?? '',
      sourceSite: run.sourceSiteName ?? `#${run.sourceSiteId}`,
      targetSite: run.targetSiteName ?? `#${run.targetSiteId}`,
      trigger: run.trigger,
      sourceContentId: Number(item.data?.sourceContentId) || null,
      targetContentId: Number(item.data?.targetContentId) || null,
      outcome: typeof item.data?.outcome === 'string' ? item.data.outcome : item.status,
      title: item.label ?? '',
      message: item.message ?? '',
      createdAt: formatDateTime(task.createdAt),
    };
  });
}

export async function dispatchDueCmsDistributionRules(): Promise<string> {
  const now = new Date();
  const due = await db.select({ id: cmsDistributionRules.id }).from(cmsDistributionRules).where(and(
    eq(cmsDistributionRules.mode, 'scheduled'),
    eq(cmsDistributionRules.status, 'enabled'),
    isNotNull(cmsDistributionRules.nextRunAt),
    lte(cmsDistributionRules.nextRunAt, now),
  )).orderBy(asc(cmsDistributionRules.nextRunAt)).limit(100);
  let submitted = 0;
  let failures = 0;
  for (const { id } of due) {
    const claimed = await db.transaction(async (tx) => {
      const lock = await tx.execute(sql`select pg_try_advisory_xact_lock(hashtext('cms-distribution-schedule'), ${id}) as locked`);
      if (!(lock[0] as { locked?: boolean } | undefined)?.locked) return null;
      const [rule] = await tx.select().from(cmsDistributionRules).where(and(
        eq(cmsDistributionRules.id, id),
        eq(cmsDistributionRules.mode, 'scheduled'),
        eq(cmsDistributionRules.status, 'enabled'),
        isNotNull(cmsDistributionRules.nextRunAt),
        lte(cmsDistributionRules.nextRunAt, now),
      )).for('update').limit(1);
      if (!rule) return null;
      const slot = formatDateTime(rule.nextRunAt!);
      await tx.update(cmsDistributionRules).set({
        nextRunAt: nextSchedule(rule.scheduleCron, rule.nextRunAt!),
      }).where(eq(cmsDistributionRules.id, id));
      return { rule, slot };
    });
    if (!claimed) continue;
    try {
      await runWithCurrentUser(SYSTEM_USER, () => submitCmsDistributionRun(claimed.rule.id, 'scheduled', {
        system: true,
        watermark: claimed.slot,
      }));
    } catch (error) {
      await db.update(cmsDistributionRules).set({ nextRunAt: now }).where(and(
        eq(cmsDistributionRules.id, claimed.rule.id),
        eq(cmsDistributionRules.revision, claimed.rule.revision),
        eq(cmsDistributionRules.status, 'enabled'),
      ));
      failures += 1;
      logger.error(`[cms-distribution] 定时规则 #${claimed.rule.id} 提交失败，将在下一轮重试`, error);
      continue;
    }
    submitted += 1;
  }
  return `CMS 定时分发扫描完成：提交 ${submitted} 条规则，待重试 ${failures} 条`;
}
