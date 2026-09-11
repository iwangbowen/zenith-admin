import { requireRow } from '../../lib/db-assert';
import {
  and,
  asc,
  desc,
  eq,
  gt,
  inArray,
  isNotNull,
  isNull,
  or,
  sql,
  type SQL,
} from 'drizzle-orm';
import { HTTPException } from 'hono/http-exception';
import type { AsyncTask, AsyncTaskItem } from '@zenith/shared/tasks';
import { db } from '../../db';
import {
  asyncTasks,
 cmsChannels,
 cmsContents,
 cmsDistributionRules,
  cmsSites,
 type CmsContentRow,
  type CmsDistributionRuleRow,
} from '../../db/schema';
import { parseDateRangeEnd, parseDateRangeStart } from '../../lib/datetime';
import { buildWhere, dateRangeConditions, keywordCondition } from '../../lib/where-helpers';
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
import { getEffectivelyEnabledCmsChannelIds } from './cms-channel-visibility.service';
import { assertSiteAccess } from './cms-sites.service';
import { captureCmsContentPublishSnapshot } from './cms-content-publish-snapshot.service';
import { acquireCmsSitePublishLock, lockCmsSiteForMutation } from './cms-site-publish-lock.service';
import { enqueueCmsPublishOutboxes, insertCmsSiteRefsRebuildOutbox } from './cms-publish-outbox.service';
import { resolveEffectiveCmsSite } from './cms-site-inheritance.service';
import {
  cmsDistributionIdempotencyKey,
  decideCmsDistributionConflict,
} from './cms-distribution-policy';
import { sanitizeCmsHtml } from './cms-html-sanitizer';
import { adoptCmsResourcesIntoSite, canonicalizeCmsResourceFields, syncCmsResourceRefs } from './cms-resource-refs.service';
import { contentSearchVector, extendSearchTexts } from './cms-search.service';
import {
getContentBodyExtendRaw,
} from './cms-contents.service';
import { insertContentPublishOutbox } from './cms-contents-internal';
import { assertCmsContentUnlocked } from './cms-content-lock.service';
import { logContentOp } from './cms-content-op-logs.service';
import {
  DISTRIBUTION_TASK_TYPE,
  ensureCmsDistributionRuleExists,
  ensureRuleAccessible,
  normalizedFilters,
  SYSTEM_USER,
} from './cms-distributions-shared';

export async function deleteCmsDistributionRule(id: number): Promise<void> {
  await ensureRuleAccessible(id);
  const result = await db.transaction(async (tx) => {
    const initialRule = await tx.select().from(cmsDistributionRules)
      .where(eq(cmsDistributionRules.id, id)).limit(1);
    const rule = initialRule[0];
    requireRow(rule, '分发规则不存在');
    await acquireCmsSitePublishLock(tx, rule.targetSiteId);
    const [lockedRule] = await tx.select().from(cmsDistributionRules)
      .where(eq(cmsDistributionRules.id, id)).for('update').limit(1);
    requireRow(lockedRule, '分发规则不存在');
    if (lockedRule.targetSiteId !== rule.targetSiteId) throw new HTTPException(409, { message: '分发规则目标站点已变化，请重试' });
    const [lockedSite] = await tx.select().from(cmsSites)
      .where(eq(cmsSites.id, rule.targetSiteId)).for('update').limit(1);
    requireRow(lockedSite, '目标站点不存在');
    const materialized = await tx.select().from(cmsContents)
      .where(and(eq(cmsContents.distributionRuleId, id), eq(cmsContents.siteId, rule.targetSiteId))).for('update');
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
      ? await tx.select().from(cmsContents).where(and(inArray(cmsContents.id, sourceIds), eq(cmsContents.siteId, rule.sourceSiteId)))
     : [];
    const originIds = [...new Set(directSources
      .map((source) => source.mappingSourceId)
      .filter((sourceId): sourceId is number => sourceId != null))];
   const origins = originIds.length
      ? await tx.select().from(cmsContents).where(and(inArray(cmsContents.id, originIds), eq(cmsContents.siteId, rule.sourceSiteId)))
     : [];
    const sourceById = new Map([...directSources, ...origins].map((source) => [source.id, source]));
   for (const content of materialized) {
      if (content.mappingSourceId == null) {
        await tx.update(cmsContents).set({
          distributionRuleId: null,
          distributionSourceId: null,
          distributionSourceVersion: null,
          version: sql`${cmsContents.version} + 1`,
        }).where(eq(cmsContents.id, content.id));
        continue;
      }
     const source = sourceById.get(content.mappingSourceId);
     const origin = source?.mappingSourceId ? sourceById.get(source.mappingSourceId) : source;
      if (source && source.siteId !== rule.sourceSiteId) throw new HTTPException(400, { message: '映射来源站点不匹配，拒绝跨站物化' });
      if (source?.mappingSourceId && !origin) throw new HTTPException(400, { message: '映射来源链不完整，拒绝跨站物化' });
      const body = sanitizeCmsHtml(origin?.body ?? content.body);
      const extend = origin?.extend ?? content.extend ?? {};
      const adopted = await adoptCmsResourcesIntoSite(tx, content.siteId, { body, extend });
      const [materializedRow] = await tx.update(cmsContents).set({
        ...adopted,
        searchVector: contentSearchVector(content.siteId, { ...content, ...adopted }, extendSearchTexts(adopted.extend)),
       mappingSourceId: null,
       distributionRuleId: null,
       distributionSourceId: null,
       distributionSourceVersion: null,
        version: sql`${cmsContents.version} + 1`,
      }).where(eq(cmsContents.id, content.id)).returning();
      // 正文从来源转移到本行，引用索引要跟着搬家，否则来源删除后素材被判为孤立
      if (materializedRow) {
        await syncCmsResourceRefs(tx, 'content', materializedRow.id, materializedRow.siteId, materializedRow);
      }
      await logContentOp(tx, content.id, 'updated', `分发规则 #${id} 删除，映射已物化为独立内容`);
    }
   const [deleted] = await tx.delete(cmsDistributionRules).where(eq(cmsDistributionRules.id, id)).returning();
   requireRow(deleted, '分发规则不存在');
    const publicRows = materialized.filter((content) => content.status === 'published'
      && content.deletedAt == null && content.archivedAt == null);
    const tasks: AsyncTask[] = [];
    if (publicRows.length > 0) {
      tasks.push(await insertCmsSiteRefsRebuildOutbox(
        tx,
        lockedSite,
        '分发规则删除后内容物化',
        `site:${rule.targetSiteId}:distribution-delete:${id}:${lockedSite.publicRevision + 1}`,
      ));
    }
    return { tasks };
 });
  if (result.tasks.length > 0) await enqueueCmsPublishOutboxes(result.tasks, '分发规则删除');
}

async function sourceConditions(rule: CmsDistributionRuleRow, afterId?: number): Promise<(SQL | undefined)[]> {
  const filters = normalizedFilters(rule.filters);
  const effectiveChannels = await getEffectivelyEnabledCmsChannelIds(rule.sourceSiteId);
  return [
    eq(cmsContents.siteId, rule.sourceSiteId),
    eq(cmsContents.status, 'published'),
    isNull(cmsContents.deletedAt),
    isNull(cmsContents.archivedAt),
    or(isNull(cmsContents.expireAt), gt(cmsContents.expireAt, new Date())),
    isNull(cmsContents.mappingSourceId),
    isNull(cmsContents.distributionSourceId),
    rule.sourceChannelId != null ? eq(cmsContents.channelId, rule.sourceChannelId) : undefined,
    effectiveChannels.size > 0 ? inArray(cmsContents.channelId, [...effectiveChannels]) : sql`false`,
    filters.contentTypes.length ? inArray(cmsContents.contentType, filters.contentTypes) : undefined,
    keywordCondition(filters.keyword, [cmsContents.title, cmsContents.summary], 'ilike'),
    ...dateRangeConditions(cmsContents.publishedAt, filters.publishedFrom ?? undefined, filters.publishedTo ?? undefined),
    afterId ? gt(cmsContents.id, afterId) : undefined,
  ];
}

function sourceMatchesRule(rule: CmsDistributionRuleRow, source: CmsContentRow, effectiveChannelIds?: ReadonlySet<number>): boolean {
  const filters = normalizedFilters(rule.filters);
  if (source.status !== 'published' || source.deletedAt || source.archivedAt) return false;
  if (source.expireAt && source.expireAt <= new Date()) return false;
  if (source.siteId !== rule.sourceSiteId) return false;
  if (effectiveChannelIds && !effectiveChannelIds.has(source.channelId)) return false;
  if (rule.sourceChannelId != null && source.channelId !== rule.sourceChannelId) return false;
  if (filters.contentTypes.length && !filters.contentTypes.includes(source.contentType)) return false;
  if (filters.keyword && !`${source.title} ${source.summary ?? ''}`.toLocaleLowerCase().includes(filters.keyword.toLocaleLowerCase())) return false;
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
  }).from(cmsContents).where(buildWhere(...await sourceConditions(rule)));
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

function updatePatch(source: CmsContentRow, body: string): Record<string, unknown> {
  return {
    expectedVersion: undefined,
   channelId: undefined,
   title: source.title,
    titleStyle: source.titleStyle ?? {},
    subTitle: source.subTitle,
    shortTitle: source.shortTitle,
    summary: source.summary,
    coverImage: source.coverImage,
    author: source.author,
    editor: source.editor,
    source: source.source,
   sourceUrl: source.sourceUrl,
   isOriginal: source.isOriginal,
   mediaData: source.mediaData,
    attachments: source.attachments ?? [],
    externalLink: source.externalLink,
    detailTemplate: null,
    isTop: false,
    topWeight: 0,
    topExpireAt: null,
    isRecommend: source.isRecommend,
   isHot: source.isHot,
    expireAt: source.expireAt?.toISOString() ?? null,
    seoTitle: source.seoTitle,
    seoKeywords: source.seoKeywords,
    seoDescription: source.seoDescription,
    body,
    extend: source.extend ?? {},
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
  // Keep the mapping identity for read-only UX and governance, while storing a
  // complete site-local snapshot so render-time reads never cross sites.
  const mappingSourceId = rule.mode === 'mapping' ? (source.mappingSourceId ?? source.id) : null;
  const [created] = await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext('cms-distribution-item'), ${source.id})`);
    const [existing] = await tx.select({ id: cmsContents.id }).from(cmsContents).where(and(
      eq(cmsContents.distributionRuleId, rule.id),
      eq(cmsContents.distributionSourceId, source.id),
      isNull(cmsContents.deletedAt),
    )).limit(1);
    if (existing) return tx.select().from(cmsContents).where(eq(cmsContents.id, existing.id)).limit(1);
    // 跨站复制：把来源站素材登记到目标站并改写句柄，让每个站点只引用自己的素材行
    const media = await adoptCmsResourcesIntoSite(tx, rule.targetSiteId, {
      coverImage: source.coverImage,
      mediaData: source.mediaData ?? {},
     body,
     extend,
     externalLink: source.externalLink,
     sourceUrl: source.sourceUrl,
      attachments: source.attachments ?? [],
   });
    const rows = await tx.insert(cmsContents).values({
      siteId: rule.targetSiteId,
      channelId: rule.targetChannelId,
      modelId: targetChannel.modelId ?? null,
      contentType: source.contentType,
     mediaData: media.mediaData,
     title: source.title,
      titleStyle: source.titleStyle ?? {},
      subTitle: source.subTitle,
      shortTitle: source.shortTitle,
      slug,
      summary: source.summary,
      coverImage: media.coverImage,
      author: source.author,
      editor: source.editor,
      source: source.source,
      sourceUrl: media.sourceUrl,
     isOriginal: false,
     body: media.body,
      attachments: media.attachments ?? [],
      extend: media.extend,
      externalLink: media.externalLink,
     detailTemplate: null,
     staticPath: null,
      isTop: source.isTop,
      topWeight: source.topWeight,
      isRecommend: source.isRecommend,
     isHot: source.isHot,
      topExpireAt: source.topExpireAt,
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
      expireAt: source.expireAt,
      mappingSourceId,
      distributionRuleId: rule.id,
      distributionSourceId: source.id,
      distributionSourceVersion: source.version,
      searchVector: contentSearchVector(rule.targetSiteId, { ...source, body }, extendSearchTexts(extend)),
    }).returning();
    await logContentOp(tx, rows[0].id, 'created', `分发规则 #${rule.id} 从内容 #${source.id} 创建草稿`);
    await syncCmsResourceRefs(tx, 'content', rows[0].id, rows[0].siteId, rows[0]);
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
  const mappingSourceId = rule.mode === 'mapping' ? (source.mappingSourceId ?? source.id) : null;
  const mutation = await db.transaction(async (tx) => {
    const site = await lockCmsSiteForMutation(tx, rule.targetSiteId);
    const [locked] = await tx.select().from(cmsContents)
      .where(and(eq(cmsContents.id, target.id), eq(cmsContents.siteId, rule.targetSiteId)))
      .for('update').limit(1);
    if (!locked || locked.version !== target.version || locked.lockedAt) {
      throw new HTTPException(409, { message: '目标内容已被其他操作修改或锁定' });
    }
    const oldPublish = locked.status === 'published'
      ? await captureCmsContentPublishSnapshot(tx, locked, { includeExistingArtifacts: true })
      : null;
    const adopted = await adoptCmsResourcesIntoSite(tx, rule.targetSiteId, updatePatch(source, body));
    const canonical = await canonicalizeCmsResourceFields(tx, rule.targetSiteId, adopted, 'content');
    const { expectedVersion: _expectedVersion, channelId: _channelId, ...contentPatch } = canonical;
    const [updated] = await tx.update(cmsContents).set({
      ...contentPatch,
      titleStyle: source.titleStyle ?? {},
      attachments: source.attachments ?? [],
      topExpireAt: source.topExpireAt,
      expireAt: source.expireAt,
      modelId: locked.modelId,
      mappingSourceId,
      distributionRuleId: rule.id,
      distributionSourceId: source.id,
      distributionSourceVersion: source.version,
      version: sql`${cmsContents.version} + 1`,
      searchVector: contentSearchVector(rule.targetSiteId, { ...source, ...contentPatch, body }, extendSearchTexts((contentPatch.extend ?? extend) as Record<string, unknown>)),
    }).where(and(eq(cmsContents.id, locked.id), eq(cmsContents.version, locked.version), isNull(cmsContents.lockedAt))).returning();
    requireRow(updated, '目标内容已被其他操作修改或锁定', 409);
    await syncCmsResourceRefs(tx, 'content', updated.id, updated.siteId, updated);
    await logContentOp(tx, target.id, 'updated', '分发规则 #' + rule.id + ' 同步来源内容 #' + source.id + ' v' + source.version);
    const task = oldPublish
      ? await insertContentPublishOutbox(tx, site, updated, 'distribution-sync', oldPublish.deletePaths, {
          build: updated.status === 'published' && !updated.deletedAt && !updated.externalLink?.trim(),
        })
      : null;
    return { updated, task };
  });
  if (mutation.task) await enqueueCmsPublishOutboxes([mutation.task], '分发规则 #' + rule.id + ' 内容同步');
  return mutation.updated;
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
  const sourceEffectiveChannelIds = await getEffectivelyEnabledCmsChannelIds(rule.sourceSiteId);
  if (!sourceMatchesRule(rule, source, sourceEffectiveChannelIds)) {
    return { outcome: 'skipped', targetContentId: null, message: '来源内容已不再满足分发规则' };
  }
  // 分发保留素材句柄：目标站沿用同一素材引用，来源站删除素材时会被删除保护拦下
  const resolved = await getContentBodyExtendRaw(source);
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
    eq(cmsContents.siteId, rule.targetSiteId),
   isNotNull(cmsContents.distributionSourceId),
    isNull(cmsContents.deletedAt),
    gt(cmsContents.id, afterTargetId),
  )).orderBy(asc(cmsContents.id)).limit(100);
  if (!targets.length) return [];
 const sourceIds = [...new Set(targets.map((target) => target.distributionSourceId!))];
  const sources = await db.select().from(cmsContents).where(and(
    inArray(cmsContents.id, sourceIds),
    eq(cmsContents.siteId, rule.sourceSiteId),
  ));
  const sourceById = new Map(sources.map((source) => [source.id, source]));
  return targets
    .map((target) => ({ target, source: sourceById.get(target.distributionSourceId!) ?? null }));
}

async function detachStaleMapping(
  rule: CmsDistributionRuleRow,
  target: CmsContentRow,
  source: CmsContentRow | null,
) {
  const safeSource = source && source.siteId === rule.sourceSiteId ? source : null;
  const mutation = await db.transaction(async (tx) => {
    const site = await lockCmsSiteForMutation(tx, target.siteId);
    const [locked] = await tx.select().from(cmsContents)
      .where(and(eq(cmsContents.id, target.id), eq(cmsContents.siteId, target.siteId)))
      .for('update').limit(1);
    if (!locked || locked.lockedAt) throw new HTTPException(409, { message: '目标内容锁状态已变化' });
    const oldPublish = locked.status === 'published'
      ? await captureCmsContentPublishSnapshot(tx, locked, { includeExistingArtifacts: true })
      : null;
    const body = sanitizeCmsHtml(safeSource?.body ?? locked.body);
    const extend = safeSource?.extend ?? locked.extend ?? {};
    const adopted = await adoptCmsResourcesIntoSite(
      tx,
      target.siteId,
      await canonicalizeCmsResourceFields(tx, target.siteId, { body, extend }, 'content'),
    );
    const [updated] = await tx.update(cmsContents).set({
      // 物化后正文归本行所有，与引用索引一并在事务内落定
      ...adopted,
      status: oldPublish ? 'offline' : locked.status,
      mappingSourceId: null,
      distributionRuleId: null,
      distributionSourceId: null,
      distributionSourceVersion: null,
      version: sql`${cmsContents.version} + 1`,
      searchVector: contentSearchVector(target.siteId, { ...locked, ...adopted, body }, extendSearchTexts(extend)),
    }).where(and(eq(cmsContents.id, locked.id), eq(cmsContents.version, locked.version), isNull(cmsContents.lockedAt))).returning();
    requireRow(updated, '目标内容已被其他操作修改', 409);
    await syncCmsResourceRefs(tx, 'content', updated.id, updated.siteId, updated);
    await logContentOp(
      tx,
      target.id,
      oldPublish ? 'offlined' : 'updated',
      `分发规则 #${rule.id} 来源不再满足已发布条件，已${oldPublish ? '下线并' : ''}物化最后快照`,
    );
    const task = oldPublish
      ? await insertContentPublishOutbox(tx, site, updated, 'distribution-detach', oldPublish.deletePaths, { build: false })
      : null;
    return { updated, task };
  });
  if (mutation.task) await enqueueCmsPublishOutboxes([mutation.task], `分发规则 #${rule.id} 映射失效`);
  return mutation.updated;
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
      const [sourceSite, targetSite] = await Promise.all([
        resolveEffectiveCmsSite(rule.sourceSiteId).catch(() => null),
        resolveEffectiveCmsSite(rule.targetSiteId).catch(() => null),
      ]);
      if (!sourceSite?.chain.every((site) => site.status === 'enabled')
        || !targetSite?.chain.every((site) => site.status === 'enabled')) {
        throw new TaskCancelledError('分发来源或目标站点已停用，任务已取消', { stale: true, ruleId });
      }
      if (rule.sourceChannelId != null) await assertChannelAccess(rule.sourceChannelId);
      await assertChannelAccess(rule.targetChannelId);
      const targetChannel = await ensureCmsChannelExists(rule.targetChannelId);
      if (targetChannel.siteId !== rule.targetSiteId
        || targetChannel.type !== 'list'
        || targetChannel.status !== 'enabled'
        || !(await getEffectivelyEnabledCmsChannelIds(rule.targetSiteId)).has(targetChannel.id)) {
        throw new TaskCancelledError('分发目标栏目已停用、失效或不再是列表栏目', { stale: true, ruleId });
      }
      const sourceEffectiveChannelIds = await getEffectivelyEnabledCmsChannelIds(rule.sourceSiteId);
      const sourceTotal = await db.$count(cmsContents, buildWhere(...await sourceConditions(rule)));
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
          .where(buildWhere(...await sourceConditions(rule, lastSourceId)))
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
              if (!source || !sourceMatchesRule(rule, source, sourceEffectiveChannelIds)) {
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
