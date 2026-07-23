import {
  and,
  desc,
  eq,
  gte,
  ilike,
  inArray,
  lte,
  or,
  sql,
  type SQL,
} from 'drizzle-orm';
import { HTTPException } from 'hono/http-exception';
import dayjs from 'dayjs';
import { createHash } from 'node:crypto';
import {
  CMS_PUBLISH_TASK_TYPES,
  CMS_PUBLISH_TARGET_TYPE_LABELS,
  type CmsPublishArtifactStatus,
  type CmsPublishSubmitInput,
  type CmsPublishTargetType,
} from '@zenith/shared';
import { db } from '../../db';
import {
  asyncTaskItems,
  asyncTasks,
  cmsContents,
  cmsPages,
  cmsPublishArtifacts,
  cmsSites,
  cmsTemplates,
  type AsyncTaskRow,
  type CmsPublishArtifactRow,
} from '../../db/schema';
import { pageOffset } from '../../lib/pagination';
import type { DbExecutor } from '../../db/types';
import {
  formatDateTime,
  formatNullableDateTime,
  parseDateRangeEnd,
  parseDateRangeStart,
} from '../../lib/datetime';
import { escapeLike } from '../../lib/where-helpers';
import {
  currentUser,
  currentUserOrNull,
  hasPermission,
  runWithCurrentUser,
} from '../../lib/context';
import {
  mapAsyncTask,
  enqueueAsyncTask,
  registerTaskHandler,
  requestCancelAsyncTask,
  restartAsyncTask,
  resumeAsyncTask,
  submitAsyncTask,
  type TaskRunContext,
  TaskCancelledError,
} from '../../lib/task-center';
import { assertCompleteCmsBatch, isCmsPlatformAdmin } from './cms-access';
import {
  assertSiteAccess,
  ensureCmsSiteExists,
  getAccessibleSiteIds,
} from './cms-sites.service';
import {
  assertAllCmsSiteChannelsAccess,
  assertChannelAccess,
  ensureCmsChannelExists,
} from './cms-channels.service';
import { getActivePublishChannels } from './cms-publish-channels.service';
import {
  buildSiteStatic,
  applyCmsContentPublishSnapshot,
  refreshChannelStatic,
  refreshContentStatic,
  refreshCustomPageStatic,
} from './cms-static.service';
import { recordCmsPublishArtifact, withCmsPublishArtifactTracking } from './cms-publish-artifact-tracker';
import logger from '../../lib/logger';
import {
  buildCmsPublishDedupeFingerprint,
  canAccessCmsPublishingTask,
  CMS_REUSABLE_PUBLISH_TASK_STATUSES,
  cmsPublishingTaskSiteIds,
  remainingCmsContentTargets,
  stableCmsContentTargets,
} from './cms-publishing-policy';
import { withCmsSitePublishLock } from './cms-site-publish-lock.service';

const SYSTEM_USER = { userId: 1, username: 'admin', roles: ['super_admin'], tenantId: null };

function taskTargetType(row: Pick<AsyncTaskRow, 'taskType' | 'payload'>): CmsPublishTargetType {
  const value = (row.payload as { targetType?: unknown } | null)?.targetType;
  if (typeof value === 'string' && value in CMS_PUBLISH_TARGET_TYPE_LABELS) return value as CmsPublishTargetType;
  if (row.taskType === 'cms-theme-rebuild') return 'theme';
  return 'site';
}

async function artifactCounts(taskIds: number[]) {
  if (!taskIds.length) return new Map<number, { total: number; failed: number }>();
  const rows = await db.select({
    taskId: cmsPublishArtifacts.taskId,
    total: sql<number>`count(*)::int`,
    failed: sql<number>`count(*) filter (where ${cmsPublishArtifacts.status} = 'failed')::int`,
  }).from(cmsPublishArtifacts)
    .where(inArray(cmsPublishArtifacts.taskId, taskIds))
    .groupBy(cmsPublishArtifacts.taskId);
  return new Map(rows.map((row) => [row.taskId, { total: row.total, failed: row.failed }]));
}

async function siteNames(siteIds: number[]) {
  if (!siteIds.length) return new Map<number, string>();
  const rows = await db.select({ id: cmsSites.id, name: cmsSites.name }).from(cmsSites)
    .where(inArray(cmsSites.id, [...new Set(siteIds)]));
  return new Map(rows.map((row) => [row.id, row.name]));
}

async function mapPublishingTasks(rows: Array<AsyncTaskRow & {
  createdByUser?: { nickname: string | null; username: string } | null;
}>) {
  const counts = await artifactCounts(rows.map((row) => row.id));
  const allSiteIds = rows.flatMap(cmsPublishingTaskSiteIds);
  const names = await siteNames(allSiteIds);
  return rows.map((row) => {
    const task = mapAsyncTask(row);
    const siteIds = cmsPublishingTaskSiteIds(row);
    const siteNameList = siteIds.map((siteId) => names.get(siteId)).filter((name): name is string => Boolean(name));
    const count = counts.get(row.id);
    return {
      ...task,
      siteId: siteIds[0] ?? null,
      siteName: siteNameList.length ? siteNameList.join('、') : null,
      siteIds,
      siteNames: siteNameList,
      targetType: taskTargetType(row),
      artifactCount: count?.total ?? 0,
      failedArtifactCount: count?.failed ?? 0,
    };
  });
}

export interface ListCmsPublishingQuery {
  page: number;
  pageSize: number;
  siteId?: number;
  targetType?: CmsPublishTargetType;
  status?: AsyncTaskRow['status'] | 'active' | 'terminal';
  taskType?: string;
  createdBy?: string;
  startTime?: string;
  endTime?: string;
  keyword?: string;
}

async function hasGlobalPublishingAccess(): Promise<boolean> {
  return isCmsPlatformAdmin() || hasPermission('system:async-task:list');
}

export async function buildCmsPublishingConditions(query: Omit<ListCmsPublishingQuery, 'page' | 'pageSize'>): Promise<SQL[]> {
  const user = currentUser();
  const conditions: SQL[] = [inArray(asyncTasks.taskType, [...CMS_PUBLISH_TASK_TYPES])];
  const global = await hasGlobalPublishingAccess();
  if (!global) {
    conditions.push(eq(asyncTasks.createdBy, user.userId));
    const accessible = await getAccessibleSiteIds();
    if (!accessible?.length) conditions.push(sql`false`);
    else conditions.push(sql`(
      (
        ${asyncTasks.taskType} <> 'cms-theme-rebuild'
        and ${asyncTasks.payload}->>'siteId' in (${sql.join(accessible.map((siteId) => sql`${String(siteId)}`), sql`, `)})
      )
      or
      (
        ${asyncTasks.taskType} = 'cms-theme-rebuild'
        and jsonb_typeof(${asyncTasks.payload}->'siteIds') = 'array'
        and jsonb_array_length(${asyncTasks.payload}->'siteIds') > 0
        and (${asyncTasks.payload}->'siteIds') <@ ${JSON.stringify(accessible)}::jsonb
      )
    )`);
  }
  if (query.siteId) {
    if (!global) await assertSiteAccess(query.siteId);
    conditions.push(sql`(
      ${asyncTasks.payload}->>'siteId' = ${String(query.siteId)}
      or (${asyncTasks.payload}->'siteIds') @> ${JSON.stringify([query.siteId])}::jsonb
    )`);
  }
  if (query.targetType) conditions.push(sql`${asyncTasks.payload}->>'targetType' = ${query.targetType}`);
  if (query.status === 'active') conditions.push(inArray(asyncTasks.status, ['pending', 'running']));
  else if (query.status === 'terminal') conditions.push(inArray(asyncTasks.status, ['success', 'failed', 'cancelled']));
  else if (query.status) conditions.push(eq(asyncTasks.status, query.status));
  if (query.taskType) conditions.push(eq(asyncTasks.taskType, query.taskType));
  if (query.keyword?.trim()) {
    const keyword = `%${escapeLike(query.keyword.trim())}%`;
    conditions.push(or(ilike(asyncTasks.title, keyword), ilike(asyncTasks.taskType, keyword))!);
  }
  const start = parseDateRangeStart(query.startTime);
  const end = parseDateRangeEnd(query.endTime);
  if (start) conditions.push(gte(asyncTasks.createdAt, start));
  if (end) conditions.push(lte(asyncTasks.createdAt, end));
  if (query.createdBy?.trim()) {
    const keyword = `%${escapeLike(query.createdBy.trim())}%`;
    const { users } = await import('../../db/schema');
    const creators = await db.select({ id: users.id }).from(users)
      .where(or(ilike(users.username, keyword), ilike(users.nickname, keyword)))
      .limit(500);
    conditions.push(creators.length ? inArray(asyncTasks.createdBy, creators.map((row) => row.id)) : sql`false`);
  }
  return conditions;
}

export async function listCmsPublishingTasks(query: ListCmsPublishingQuery) {
  const conditions = await buildCmsPublishingConditions(query);
  const where = and(...conditions);
  const [total, rows] = await Promise.all([
    db.$count(asyncTasks, where),
    db.query.asyncTasks.findMany({
      where,
      with: { createdByUser: { columns: { nickname: true, username: true } } },
      orderBy: desc(asyncTasks.id),
      limit: query.pageSize,
      offset: pageOffset(query.page, query.pageSize),
    }),
  ]);
  return {
    list: await mapPublishingTasks(rows),
    total,
    page: query.page,
    pageSize: query.pageSize,
  };
}

async function ensurePublishingTaskAccessible(id: number, manage = false) {
  const row = await db.query.asyncTasks.findFirst({
    where: eq(asyncTasks.id, id),
    with: { createdByUser: { columns: { nickname: true, username: true } } },
  });
  if (!row || !CMS_PUBLISH_TASK_TYPES.includes(row.taskType as (typeof CMS_PUBLISH_TASK_TYPES)[number])) {
    throw new HTTPException(404, { message: 'CMS 发布任务不存在' });
  }
  const siteIds = cmsPublishingTaskSiteIds(row);
  if (siteIds.length === 0) throw new HTTPException(403, { message: '发布任务缺少站点范围，拒绝访问' });
  const global = isCmsPlatformAdmin() || await hasPermission(manage ? 'system:async-task:manage' : 'system:async-task:list');
  const accessibleSiteIds = global ? [] : (await getAccessibleSiteIds() ?? []);
  if (!canAccessCmsPublishingTask({
    userId: currentUser().userId,
    createdBy: row.createdBy,
    siteIds,
    accessibleSiteIds,
    global,
  })) {
    throw new HTTPException(403, { message: '普通用户仅可访问自己提交且仍有站点权限的发布任务' });
  }
  return row;
}

function mapArtifact(row: CmsPublishArtifactRow) {
  return {
    id: row.id,
    taskId: row.taskId,
    siteId: row.siteId,
    publishChannelId: row.publishChannelId ?? null,
    targetType: row.targetType,
    contentId: row.contentId ?? null,
    channelId: row.channelId ?? null,
    pageId: row.pageId ?? null,
    themeCode: row.themeCode ?? null,
    themePackageId: row.themePackageId ?? null,
    templateId: row.templateId ?? null,
    templateVersion: row.templateVersion ?? null,
    path: row.path,
    url: row.url ?? null,
    checksum: row.checksum ?? null,
    size: row.size ?? null,
    status: row.status,
    error: row.error ?? null,
    generatedAt: formatNullableDateTime(row.generatedAt),
    createdAt: formatDateTime(row.createdAt),
    updatedAt: formatDateTime(row.updatedAt),
  };
}

function mapTaskItem(row: typeof asyncTaskItems.$inferSelect) {
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

export async function getCmsPublishingDetail(id: number) {
  const row = await ensurePublishingTaskAccessible(id);
  const [mapped] = await mapPublishingTasks([row]);
  const [items, artifacts] = await Promise.all([
    db.select().from(asyncTaskItems).where(eq(asyncTaskItems.taskId, id)).orderBy(desc(asyncTaskItems.id)).limit(1000),
    db.select().from(cmsPublishArtifacts).where(eq(cmsPublishArtifacts.taskId, id)).orderBy(desc(cmsPublishArtifacts.id)).limit(1000),
  ]);
  return { task: mapped, items: items.map(mapTaskItem), artifacts: artifacts.map(mapArtifact) };
}

export interface ListCmsPublishArtifactsQuery {
  page: number;
  pageSize: number;
  siteId?: number;
  taskId?: number;
  targetType?: CmsPublishTargetType;
  status?: CmsPublishArtifactStatus;
  startTime?: string;
  endTime?: string;
  keyword?: string;
}

export async function listCmsPublishArtifacts(query: ListCmsPublishArtifactsQuery) {
  const taskConditions = await buildCmsPublishingConditions({ siteId: query.siteId });
  if (query.taskId) taskConditions.push(eq(asyncTasks.id, query.taskId));
  const conditions: SQL[] = [...taskConditions, eq(cmsPublishArtifacts.taskId, asyncTasks.id)];
  if (query.targetType) conditions.push(eq(cmsPublishArtifacts.targetType, query.targetType));
  if (query.status) conditions.push(eq(cmsPublishArtifacts.status, query.status));
  if (query.keyword?.trim()) {
    const keyword = `%${escapeLike(query.keyword.trim())}%`;
    conditions.push(or(ilike(cmsPublishArtifacts.path, keyword), ilike(cmsPublishArtifacts.url, keyword), ilike(cmsPublishArtifacts.error, keyword))!);
  }
  const start = parseDateRangeStart(query.startTime);
  const end = parseDateRangeEnd(query.endTime);
  const artifactTime = sql`coalesce(${cmsPublishArtifacts.generatedAt}, ${cmsPublishArtifacts.updatedAt})`;
  if (start) conditions.push(sql`${artifactTime} >= ${start}`);
  if (end) conditions.push(sql`${artifactTime} <= ${end}`);
  const where = and(...conditions);
  const base = db.select({ artifact: cmsPublishArtifacts }).from(cmsPublishArtifacts)
    .innerJoin(asyncTasks, eq(cmsPublishArtifacts.taskId, asyncTasks.id))
    .where(where)
    .orderBy(desc(cmsPublishArtifacts.id))
    .limit(query.pageSize)
    .offset(pageOffset(query.page, query.pageSize));
  const [countRows, rows] = await Promise.all([
    db.select({ total: sql<number>`count(*)::int` }).from(cmsPublishArtifacts)
      .innerJoin(asyncTasks, eq(cmsPublishArtifacts.taskId, asyncTasks.id)).where(where),
    base,
  ]);
  return {
    list: rows.map((row) => mapArtifact(row.artifact)),
    total: countRows[0]?.total ?? 0,
    page: query.page,
    pageSize: query.pageSize,
  };
}

async function validatePublishInput(input: CmsPublishSubmitInput, skipAccessCheck = false): Promise<void> {
  const site = await ensureCmsSiteExists(input.siteId);
  if (!skipAccessCheck) await assertSiteAccess(input.siteId);
  if (['site', 'theme', 'template'].includes(input.targetType) && !skipAccessCheck) {
    await assertAllCmsSiteChannelsAccess(input.siteId);
  }
  if (input.targetType === 'content' || input.targetType === 'contents') {
    const ids = [...new Set(input.contentIds ?? [])];
    if (!ids.length || ids.length > 500) throw new HTTPException(400, { message: '请选择 1-500 条内容' });
    if (input.targetType === 'content' && ids.length !== 1) {
      throw new HTTPException(400, { message: '单内容发布必须且只能选择一条内容' });
    }
    const snapshots = input.contentSnapshots ?? [];
    if (snapshots.length) {
      if (snapshots.length !== ids.length || snapshots.some((snapshot) => snapshot.siteId !== site.id || !ids.includes(snapshot.contentId))) {
        throw new HTTPException(400, { message: '内容发布快照与目标范围不一致' });
      }
    } else {
      const rows = await db.select({ id: cmsContents.id, siteId: cmsContents.siteId, channelId: cmsContents.channelId })
        .from(cmsContents).where(inArray(cmsContents.id, ids));
      assertCompleteCmsBatch(ids, rows.filter((row) => row.siteId === site.id).map((row) => row.id), '内容');
      if (!skipAccessCheck) {
        for (const channelId of [...new Set(rows.map((row) => row.channelId))]) await assertChannelAccess(channelId);
      }
    }
  }
  if (input.targetType === 'channel') {
    if (!input.channelId) throw new HTTPException(400, { message: '缺少 channelId' });
    const channel = await ensureCmsChannelExists(input.channelId);
    if (channel.siteId !== site.id) throw new HTTPException(400, { message: '栏目不属于所选站点' });
    if (!skipAccessCheck) await assertChannelAccess(channel.id);
  }
  if (input.targetType === 'page') {
    if (!input.pageId && !input.pageSlug) throw new HTTPException(400, { message: '缺少 pageId/pageSlug' });
    if (input.pageId) {
      const [page] = await db.select().from(cmsPages).where(and(eq(cmsPages.id, input.pageId), eq(cmsPages.siteId, site.id))).limit(1);
      if (!page) throw new HTTPException(404, { message: '搭建页面不存在或不属于所选站点' });
    }
  }
  if (input.targetType === 'template') {
    if (!input.templateId) throw new HTTPException(400, { message: '缺少 templateId' });
    const [template] = await db.select().from(cmsTemplates).where(eq(cmsTemplates.id, input.templateId)).limit(1);
    if (!template || (template.siteId != null && template.siteId !== site.id)) {
      throw new HTTPException(404, { message: '模板不存在或不适用于所选站点' });
    }
  }
}

function publishTitle(input: CmsPublishSubmitInput): string {
  const target = CMS_PUBLISH_TARGET_TYPE_LABELS[input.targetType];
  const suffix = input.targetType === 'contents' ? `（${input.contentIds?.length ?? 0} 条）` : '';
  return `CMS ${target}发布${suffix}`;
}

export async function submitCmsPublishTask(
  input: CmsPublishSubmitInput,
  options?: {
    skipPermissionCheck?: boolean;
    skipAccessCheck?: boolean;
    executor?: DbExecutor;
    enqueue?: boolean;
    /** 生命周期事件唯一键（revision/event nonce）；同一事件永久幂等，不同事件绝不复用。 */
    eventKey?: string;
  },
) {
  if (!options?.skipPermissionCheck && !(await hasPermission('cms:publish:build'))) {
    throw new HTTPException(403, { message: '缺少 cms:publish:build 权限' });
  }
  await validatePublishInput(input, options?.skipAccessCheck === true);
  const user = currentUser();
  const executor = options?.executor ?? db;
  const dedupeFingerprint = buildCmsPublishDedupeFingerprint(input, user.userId);
  return runWithCurrentUser({ ...user, tenantId: null, viewingTenantId: undefined }, async () => {
    if (!options?.eventKey) {
      const [existing] = await executor.select().from(asyncTasks).where(and(
        eq(asyncTasks.taskType, 'cms-publish-build'),
        eq(asyncTasks.createdBy, user.userId),
        inArray(asyncTasks.status, [...CMS_REUSABLE_PUBLISH_TASK_STATUSES]),
        sql`${asyncTasks.payload}->>'dedupeFingerprint' = ${dedupeFingerprint}`,
      )).orderBy(desc(asyncTasks.id)).limit(1);
      if (existing) return mapAsyncTask(existing);
    }
    const row = await submitAsyncTask({
      taskType: 'cms-publish-build',
      title: publishTitle(input),
      payload: {
        ...input,
        submittedAt: formatDateTime(dayjs().toDate()),
        systemTriggered: options?.skipAccessCheck === true,
        dedupeFingerprint,
      },
      idempotencyKey: options?.eventKey ? `cms-publish-event:${options.eventKey}` : null,
    }, {
      executor: options?.executor,
      enqueue: options?.enqueue,
    });
    return mapAsyncTask(row);
  });
}

/** 发布状态事务提交后的静态副作用入口；请求、工作流、采集与系统调度统一走任务中心。 */
export function submitCmsPublishSideEffect(input: CmsPublishSubmitInput): void {
  const actor = currentUserOrNull() ?? SYSTEM_USER;
  void runWithCurrentUser(actor, () => submitCmsPublishTask(input, {
    skipPermissionCheck: true,
    skipAccessCheck: true,
  })).catch((error) => logger.error('[cms-publishing] 发布副作用任务提交失败', error));
}

export function submitCmsContentPublishSideEffect(contentId: number): void {
  const actor = currentUserOrNull() ?? SYSTEM_USER;
  void runWithCurrentUser(actor, async () => {
    const [content] = await db.select({ siteId: cmsContents.siteId }).from(cmsContents)
      .where(eq(cmsContents.id, contentId)).limit(1);
    if (!content) return;
    await submitCmsPublishTask({
      siteId: content.siteId,
      targetType: 'content',
      contentIds: [contentId],
      reason: '内容状态变更增量刷新',
    }, { skipPermissionCheck: true, skipAccessCheck: true });
  }).catch((error) => logger.error(`[cms-publishing] 内容 ${contentId} 发布任务提交失败`, error));
}

export function submitCmsPagePublishSideEffect(input: {
  siteId: number;
  pageId?: number;
  slug?: string;
  isHome?: boolean;
  removed?: boolean;
}): void {
  const actor = currentUserOrNull() ?? SYSTEM_USER;
  void runWithCurrentUser(actor, async () => {
    let pageId = input.pageId;
    if (!pageId && input.slug) {
      const [page] = await db.select({ id: cmsPages.id }).from(cmsPages).where(and(
        eq(cmsPages.siteId, input.siteId),
        eq(cmsPages.slug, input.slug),
      )).limit(1);
      pageId = page?.id;
    }
    await submitCmsPublishTask({
      siteId: input.siteId,
      targetType: 'page',
      pageId,
      pageSlug: input.slug,
      pageIsHome: input.isHome,
      pageRemoved: input.removed,
      reason: input.removed ? '搭建页面停用或删除' : '搭建页面保存',
    }, { skipPermissionCheck: true, skipAccessCheck: true });
  }).catch((error) => logger.error('[cms-publishing] 搭建页面发布任务提交失败', error));
}

async function trackingContext(input: CmsPublishSubmitInput, taskId: number, ctx: TaskRunContext) {
  const site = await ensureCmsSiteExists(input.siteId);
  const channels = await getActivePublishChannels(input.siteId);
  const [template] = input.templateId
    ? await db.select({ activeVersion: cmsTemplates.activeVersion, currentVersion: cmsTemplates.currentVersion })
      .from(cmsTemplates).where(eq(cmsTemplates.id, input.templateId)).limit(1)
    : [null];
  const protocol = (site.settings as Record<string, unknown> | null)?.protocol === 'http' ? 'http' : 'https';
  const defaultChannel = channels.find((item) => item.isDefault) ?? channels[0];
  const artifactProgress = { count: 0, failed: 0 };
  return {
    site,
    artifactProgress,
    context: {
      taskId,
      siteId: input.siteId,
      targetType: input.targetType,
      contentId: input.targetType === 'content' ? input.contentIds?.[0] ?? null : null,
      channelId: input.channelId ?? null,
      pageId: input.pageId ?? null,
      themeCode: input.themeCode ?? site.theme,
      themePackageId: input.themePackageId ?? null,
      templateId: input.templateId ?? null,
      templateVersion: template?.activeVersion ?? template?.currentVersion ?? null,
      publishChannelIds: Object.fromEntries(channels.map((item) => [item.code, item.id])),
      defaultChannelCode: defaultChannel.code,
      origins: Object.fromEntries(channels.map((item) => [
        item.code,
        item.domain ? `${protocol}://${item.domain}` : site.domain ? `${protocol}://${site.domain}` : null,
      ])),
      onArtifact: async (artifact: { path: string; status: CmsPublishArtifactStatus; error: string | null; size: number | null }) => {
        artifactProgress.count += 1;
        if (artifact.status === 'failed') artifactProgress.failed += 1;
        const itemKey = `path:${createHash('sha256').update(artifact.path).digest('hex').slice(0, 24)}:${artifact.path.slice(-90)}`;
        await ctx.reportItems([{
          key: itemKey,
          label: artifact.path,
          status: artifact.status === 'failed' ? 'failed' : artifact.status === 'deleted' ? 'skipped' : 'success',
          message: artifact.error,
          data: { path: artifact.path, size: artifact.size, artifactStatus: artifact.status },
        }]);
      },
    },
  };
}

export function registerCmsPublishingTaskHandler(): void {
  registerTaskHandler({
    taskType: 'cms-publish-build',
    title: 'CMS 统一发布',
    module: 'CMS内容管理',
    description: '统一处理内容、栏目、整站、主题与模板影响重建，并记录逐路径产物。',
    allowConcurrent: true,
    maxAttempts: 3,
    retryDelayMs: 5000,
    async run(ctx) {
      const input = ctx.payload as unknown as CmsPublishSubmitInput;
      const systemTriggered = (ctx.payload as { systemTriggered?: unknown }).systemTriggered === true;
      if (!systemTriggered && !(await hasPermission('cms:publish:build', 'cms:theme:activate', 'cms:template:activate'))) {
        throw new Error('发布任务创建者的 CMS 发布/主题/模板激活权限已失效');
      }
      return withCmsSitePublishLock(input.siteId, input, async () => {
      await validatePublishInput(input, systemTriggered);
      await db.delete(cmsPublishArtifacts).where(and(
        eq(cmsPublishArtifacts.taskId, ctx.taskId),
        eq(cmsPublishArtifacts.path, `@target/${input.targetType}`),
      ));
      const tracked = await trackingContext(input, ctx.taskId, ctx);
      try {
        if (input.targetType === 'content' || input.targetType === 'contents') {
          const snapshots = [...(input.contentSnapshots ?? [])].sort((a, b) => a.contentId - b.contentId);
          const ids = stableCmsContentTargets(snapshots.length ? snapshots.map((item) => item.contentId) : input.contentIds ?? []);
          const lastId = Number(ctx.checkpoint?.phase === 'content' ? ctx.checkpoint.lastId ?? 0 : 0);
          let processed = ids.filter((id) => id <= lastId).length;
          for (const contentId of remainingCmsContentTargets(ids, lastId)) {
            const snapshot = snapshots.find((item) => item.contentId === contentId);
            const [content] = await db.select({ channelId: cmsContents.channelId }).from(cmsContents)
              .where(eq(cmsContents.id, contentId)).limit(1);
            await withCmsPublishArtifactTracking(
              {
                ...tracked.context,
                contentId: snapshot?.purged ? null : contentId,
                channelId: snapshot?.channelId ?? content?.channelId ?? null,
              },
              () => snapshot
                ? applyCmsContentPublishSnapshot(snapshot, input.deletePaths ?? [])
                : refreshContentStatic(contentId),
            );
            processed += 1;
            const progress = await ctx.progress({
              processed,
              failed: tracked.artifactProgress.failed,
              total: ids.length,
              note: `已发布内容 ${processed}/${ids.length}`,
              checkpoint: { phase: 'content', lastId: contentId },
            });
            if (progress.cancelRequested) return { artifacts: tracked.artifactProgress.count };
          }
        } else if (input.targetType === 'channel') {
          await withCmsPublishArtifactTracking(tracked.context, () => refreshChannelStatic(input.channelId!));
          await ctx.progress({ processed: 1, failed: tracked.artifactProgress.failed, total: 1, note: '栏目重建完成', checkpoint: { phase: 'channel', lastId: input.channelId! } });
        } else if (input.targetType === 'page') {
          const [page] = input.pageId
            ? await db.select().from(cmsPages).where(eq(cmsPages.id, input.pageId)).limit(1)
            : [null];
          const slug = page?.slug ?? input.pageSlug;
          if (!slug) throw new Error('发布页面缺少 slug');
          await withCmsPublishArtifactTracking(tracked.context, () => refreshCustomPageStatic({
            siteId: input.siteId,
            slug,
            isHome: page?.isHome ?? input.pageIsHome ?? false,
            removed: input.pageRemoved ?? (page ? page.status !== 'enabled' : true),
          }));
          await ctx.progress({ processed: 1, failed: tracked.artifactProgress.failed, total: 1, note: '搭建页面重建完成', checkpoint: { phase: 'page', lastId: input.pageId ?? null, pageSlug: slug } });
        } else {
          await withCmsPublishArtifactTracking(tracked.context, () => buildSiteStatic(input.siteId, async (progress) => {
            const state = await ctx.progress({
              processed: progress.processed,
              failed: tracked.artifactProgress.failed,
              total: progress.total,
              note: progress.note,
              checkpoint: { ...progress.checkpoint },
            });
            return state.cancelRequested;
          }, { resumeAfterKey: typeof ctx.checkpoint?.lastKey === 'string' ? ctx.checkpoint.lastKey : null }));
        }
      } catch (error) {
        if (error instanceof TaskCancelledError) throw error;
        await withCmsPublishArtifactTracking(tracked.context, () => recordCmsPublishArtifact({
          relPath: `@target/${input.targetType}`,
          status: 'failed',
          error: error instanceof Error ? error.message : 'CMS 发布失败',
        })).catch((artifactError) => logger.error('[cms-publishing] 记录失败产物时出错', artifactError));
        throw error;
      }
      return {
        artifacts: tracked.artifactProgress.count,
        failedArtifacts: tracked.artifactProgress.failed,
        targetType: input.targetType,
      };
      }).catch(async (error) => {
        if (error instanceof TaskCancelledError) {
          await ctx.reportItems([{
            key: 'revision-fence',
            label: '发布修订屏障',
            status: 'skipped',
            message: error.message,
            data: error.result ?? null,
          }]);
          await ctx.progress({ processed: 0, total: 0, note: error.message, checkpoint: { stale: true } });
        }
        throw error;
      });
    },
  });
}

export async function cmsPublishingAction(id: number, action: 'cancel' | 'resume' | 'restart' | 'rebuild') {
  const task = await ensurePublishingTaskAccessible(id, true);
  if (action === 'cancel') return mapAsyncTask(await requestCancelAsyncTask(id));
  if (action === 'resume') return mapAsyncTask(await resumeAsyncTask(id));
  if (!['success', 'failed', 'cancelled'].includes(task.status)) {
    throw new HTTPException(400, { message: '仅已结束的任务可以重新开始或重建' });
  }
  const restarted = await db.transaction(async (tx) => {
    await tx.delete(cmsPublishArtifacts).where(eq(cmsPublishArtifacts.taskId, id));
    return restartAsyncTask(id, { executor: tx });
  });
  await enqueueAsyncTask(restarted.id).catch((error) => {
    logger.error(`[cms-publishing] 重启任务 #${restarted.id} 入队失败，等待 pending 恢复扫描补投`, error);
  });
  return mapAsyncTask(restarted);
}

export async function batchCmsPublishingAction(ids: number[], action: 'cancel' | 'resume' | 'restart' | 'rebuild') {
  let affected = 0;
  const errors: Array<{ id: number; message: string }> = [];
  for (const id of [...new Set(ids)]) {
    try {
      await cmsPublishingAction(id, action);
      affected += 1;
    } catch (error) {
      errors.push({ id, message: error instanceof Error ? error.message : '操作失败' });
    }
  }
  return { affected, errors };
}
