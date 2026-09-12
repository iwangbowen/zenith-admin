import { requireRow } from '../../lib/db-assert';
import { buildListResult } from '../../lib/list-query';
import type { QueryOutputOf } from '@zenith/shared/core';
import {
  and,
  desc,
  eq,
  inArray,
  sql,
  type SQL,
} from 'drizzle-orm';
import { HTTPException } from 'hono/http-exception';
import dayjs from 'dayjs';
import { createHash, randomUUID } from 'node:crypto';
import { CMS_PUBLISH_TASK_TYPES, CMS_PUBLISH_TARGET_TYPE_LABELS, CMS_PUBLISH_TARGET_TYPES } from '@zenith/shared/cms';
import type { CmsPublishArtifactStatus, CmsPublishSubmitInput, CmsPublishTargetType, SubmitCmsSiteGroupPublishInput } from '@zenith/shared/cms';
import { isAsyncTaskTerminal } from '@zenith/shared/tasks';
import { cmsPublishingContract } from '@zenith/shared/cms';
import { db } from '../../db';
import {
  asyncTaskItems,
  asyncTasks,
  cmsContents,
  cmsPages,
  cmsPublishArtifacts,
  cmsSites,
  type AsyncTaskRow,
  type CmsPublishArtifactRow,
} from '../../db/schema';
import { pageOffset } from '../../lib/pagination';
import type { DbTransaction } from '../../db/types';
import {
  formatDateTime,
  formatNullableDateTime,
  parseDateRangeEnd,
  parseDateRangeStart,
} from '../../lib/datetime';
import { buildWhere, dateRangeConditions, keywordCondition } from '../../lib/where-helpers';
import {
  currentUser,
  currentUserOrNull,
  hasPermission,
  runWithCurrentUser,
} from '../../lib/context';
import {
  asyncTaskStatusCondition,
  mapAsyncTask,
  registerTaskHandler,
  requestCancelAsyncTask,
  resumeAsyncTask,
  persistAsyncTask,
  submitAsyncTask,
  type TaskRunContext,
  TaskCancelledError,
} from '../../lib/task-center';
import { assertCompleteCmsBatch, isCmsPlatformAdmin } from './cms-access';
import {
  assertSiteAccess,
  assertSitesAccess,
  ensureCmsSiteExists,
  getAccessibleSiteIds,
} from './cms-sites.service';
import {
  assertAllCmsSiteChannelsAccess,
  assertChannelAccess,
  ensureCmsChannelExists,
} from './cms-channels.service';
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
import { cmsSiteFencePayload, withCmsSitePublishLock } from './cms-site-publish-lock.service';
import { acquireCmsSitePublishLock } from './cms-site-publish-lock.service';
import { enqueueCmsPublishOutboxes, insertCmsPublishOutbox } from './cms-publish-outbox.service';
import { captureCmsContentPublishSnapshot } from './cms-content-publish-snapshot.service';
import {
  listCmsSubtreeIds,
  loadCmsInheritanceState,
  resolveEffectiveCmsSiteRow,
} from './cms-site-inheritance.service';
import { mapAsyncTaskItem } from '../../lib/task-center';

const SYSTEM_USER = { userId: 1, username: 'admin', roles: ['super_admin'], tenantId: null };

function taskTargetType(row: Pick<AsyncTaskRow, 'taskType' | 'payload'>): CmsPublishTargetType {
  const value = (row.payload as { targetType?: unknown } | null)?.targetType;
  if (typeof value === 'string' && value in CMS_PUBLISH_TARGET_TYPE_LABELS) return value as CmsPublishTargetType;
  return 'site';
}

export type CmsPublishingListFilter = Omit<QueryOutputOf<typeof cmsPublishingContract.list>, 'page' | 'pageSize'>;

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

async function hasGlobalPublishingAccess(): Promise<boolean> {
  return isCmsPlatformAdmin() || hasPermission('system:async-task:list');
}

/** 发布任务列表 / 产物 / 日志共用的任务级范围条件：任务类型 + 归属与站点可见性 + 列表筛选 */
export async function buildCmsPublishingWhere(query: CmsPublishingListFilter): Promise<SQL | undefined> {
  const user = currentUser();
  const global = await hasGlobalPublishingAccess();
  let ownerCondition: SQL | undefined;
  let accessibleCondition: SQL | undefined;
  if (!global) {
    ownerCondition = eq(asyncTasks.createdBy, user.userId);
    const accessible = await getAccessibleSiteIds();
    accessibleCondition = !accessible?.length
      ? sql`false`
      : sql`${asyncTasks.payload}->>'siteId' in (${sql.join(accessible.map((siteId) => sql`${String(siteId)}`), sql`, `)})`;
  }
  let siteCondition: SQL | undefined;
  if (query.siteId) {
    if (!global) await assertSiteAccess(query.siteId);
    siteCondition = sql`${asyncTasks.payload}->>'siteId' = ${String(query.siteId)}`;
  }
  let creatorCondition: SQL | undefined;
  if (query.createdBy?.trim()) {
    const { users } = await import('../../db/schema');
    const creators = await db.select({ id: users.id }).from(users)
      .where(keywordCondition(query.createdBy, [users.username, users.nickname], 'ilike'))
      .limit(500);
    creatorCondition = creators.length ? inArray(asyncTasks.createdBy, creators.map((row) => row.id)) : sql`false`;
  }
  return buildWhere(
    inArray(asyncTasks.taskType, [...CMS_PUBLISH_TASK_TYPES]),
    ownerCondition,
    accessibleCondition,
    siteCondition,
    query.targetType ? sql`${asyncTasks.payload}->>'targetType' = ${query.targetType}` : undefined,
    asyncTaskStatusCondition(query.status),
    query.taskType ? eq(asyncTasks.taskType, query.taskType) : undefined,
    keywordCondition(query.keyword, [asyncTasks.title, asyncTasks.taskType], 'ilike'),
    ...dateRangeConditions(asyncTasks.createdAt, query.startTime, query.endTime),
    creatorCondition,
  );
}

export async function listCmsPublishingTasks(query: QueryOutputOf<typeof cmsPublishingContract.list>) {
  const where = await buildCmsPublishingWhere(query);
  return buildListResult({
    page: query.page,
    pageSize: query.pageSize,
    count: () => db.$count(asyncTasks, where),
    rows: async () => mapPublishingTasks(await db.query.asyncTasks.findMany({
      where,
      with: { createdByUser: { columns: { nickname: true, username: true } } },
      orderBy: desc(asyncTasks.id),
      limit: query.pageSize,
      offset: pageOffset(query.page, query.pageSize),
    })),
  });
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
    targetType: row.targetType,
    contentId: row.contentId ?? null,
    channelId: row.channelId ?? null,
    pageId: row.pageId ?? null,
    themeCode: row.themeCode ?? null,
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

export async function getCmsPublishingDetail(id: number) {
  const row = await ensurePublishingTaskAccessible(id);
  const [mapped] = await mapPublishingTasks([row]);
  const [items, artifacts] = await Promise.all([
    db.select().from(asyncTaskItems).where(eq(asyncTaskItems.taskId, id)).orderBy(desc(asyncTaskItems.id)).limit(1000),
    db.select().from(cmsPublishArtifacts).where(eq(cmsPublishArtifacts.taskId, id)).orderBy(desc(cmsPublishArtifacts.id)).limit(1000),
  ]);
  return { task: mapped, items: items.map(mapAsyncTaskItem), artifacts: artifacts.map((a) => mapArtifact(a)) };
}

/**
 * Rebuilds must use the current CMS state.  Reusing a terminal task payload
 * would also reuse its revision fence and, for content tasks, potentially
 * render an obsolete body after a later edit.
 */
async function buildFreshCmsPublishInput(
  task: Pick<AsyncTaskRow, 'id' | 'taskType' | 'payload'>,
  action: 'restart' | 'rebuild',
): Promise<CmsPublishSubmitInput> {
  const payload = (task.payload ?? {}) as Record<string, unknown>;
  const siteId = Number(payload.siteId);
  if (!Number.isInteger(siteId) || siteId <= 0) throw new HTTPException(400, { message: '发布任务缺少有效站点' });
  const rawTarget = payload.targetType;
  const targetType: CmsPublishTargetType = typeof rawTarget === 'string'
    && CMS_PUBLISH_TARGET_TYPES.includes(rawTarget as CmsPublishTargetType)
    ? rawTarget as CmsPublishTargetType
    : 'site';
  const input: CmsPublishSubmitInput = {
    siteId,
    targetType,
    reason: `发布任务 #${task.id}${action === 'rebuild' ? '重建' : '重试'}`,
  };
  if (typeof payload.channelId === 'number' && Number.isInteger(payload.channelId)) input.channelId = payload.channelId;
  if (typeof payload.themeCode === 'string' && payload.themeCode.trim()) input.themeCode = payload.themeCode;

  if (targetType === 'content' || targetType === 'contents') {
    const contentIds = [...new Set(Array.isArray(payload.contentIds)
      ? payload.contentIds.map(Number).filter((id): id is number => Number.isInteger(id) && id > 0)
      : [])].sort((a, b) => a - b);
    if (!contentIds.length) throw new HTTPException(400, { message: '原发布任务缺少内容目标，无法重试' });
    input.contentIds = contentIds;
    const oldSnapshots = new Map<number, NonNullable<CmsPublishSubmitInput['contentSnapshots']>[number]>();
    if (Array.isArray(payload.contentSnapshots)) {
      for (const value of payload.contentSnapshots) {
        if (!value || typeof value !== 'object') continue;
        const snapshot = value as NonNullable<CmsPublishSubmitInput['contentSnapshots']>[number];
        if (Number.isInteger(snapshot?.contentId) && snapshot.contentId > 0) oldSnapshots.set(snapshot.contentId, snapshot);
      }
    }
    const rows = await db.select().from(cmsContents).where(inArray(cmsContents.id, contentIds));
    const rowById = new Map(rows.filter((row) => row.siteId === siteId).map((row) => [row.id, row]));
    const snapshots: NonNullable<CmsPublishSubmitInput['contentSnapshots']> = [];
    const deletePaths = new Set<string>(Array.isArray(payload.deletePaths)
      ? payload.deletePaths.filter((path): path is string => typeof path === 'string' && path.length > 0)
      : []);
    for (const contentId of contentIds) {
      const row = rowById.get(contentId);
      if (row) {
        const captured = await captureCmsContentPublishSnapshot(db, row, { includeExistingArtifacts: true });
        snapshots.push(captured.snapshot);
        captured.deletePaths.forEach((path) => deletePaths.add(path));
      } else {
        const previous = oldSnapshots.get(contentId);
        const previousSnapshot = requireRow(previous, `内容 #${contentId} 已不存在，无法重试`, 400);
        snapshots.push({ ...previousSnapshot, purged: true, build: false });
        (previousSnapshot.paths ?? []).forEach((path) => deletePaths.add(path));
      }
    }
    input.contentSnapshots = snapshots;
    input.deletePaths = [...deletePaths].sort();
  } else if (targetType === 'page') {
    const pageId = typeof payload.pageId === 'number' && Number.isInteger(payload.pageId) ? payload.pageId : undefined;
    const pageSlug = typeof payload.pageSlug === 'string' && payload.pageSlug.trim() ? payload.pageSlug : undefined;
    const page = pageId
      ? (await db.select().from(cmsPages).where(and(eq(cmsPages.id, pageId), eq(cmsPages.siteId, siteId))).limit(1))[0]
      : pageSlug
        ? (await db.select().from(cmsPages).where(and(eq(cmsPages.siteId, siteId), eq(cmsPages.slug, pageSlug))).limit(1))[0]
        : undefined;
    input.pageId = page?.id;
    input.pageSlug = page?.slug ?? pageSlug;
    input.pageIsHome = page?.isHome ?? (payload.pageIsHome === true);
    input.pageRemoved = page ? page.status !== 'enabled' : true;
    // Keep a prior path when present: the renderer removes it before writing
    // the current page, which closes the rename/orphan gap on retries.
    if (typeof payload.pageRemovePath === 'string' && payload.pageRemovePath.trim()) input.pageRemovePath = payload.pageRemovePath;
  }
  return input;
}

async function cmsPublishTaskNeedsFreshInput(task: Pick<AsyncTaskRow, 'payload' | 'errorMessage'>): Promise<boolean> {
  const payload = (task.payload ?? {}) as Record<string, unknown>;
  const siteId = Number(payload.siteId);
  if (!Number.isInteger(siteId) || siteId <= 0) return true;
  const [site] = await db.select({
    themeRevision: cmsSites.themeRevision,
    templateRefsRevision: cmsSites.templateRefsRevision,
    publicRevision: cmsSites.publicRevision,
  }).from(cmsSites).where(eq(cmsSites.id, siteId)).limit(1);
  if (!site) return true;
  for (const [key, current] of [
    ['expectedThemeRevision', site.themeRevision],
    ['expectedTemplateRefsRevision', site.templateRefsRevision],
    ['expectedPublicRevision', site.publicRevision],
  ] as const) {
    const expected = payload[key];
    if (expected != null && Number(expected) !== current) return true;
  }
  if (typeof task.errorMessage === 'string' && task.errorMessage.includes('发布修订已过期')) return true;
  const targetType = payload.targetType;
  if (targetType === 'content' || targetType === 'contents') {
    const snapshots = Array.isArray(payload.contentSnapshots) ? payload.contentSnapshots : [];
    const contentIds = Array.isArray(payload.contentIds)
      ? payload.contentIds.map(Number).filter((id) => Number.isInteger(id) && id > 0)
      : [];
    // Tasks without a complete immutable snapshot were created before the
    // current pipeline boundary; their payload cannot safely resume after a
    // path/body mutation.
    if (contentIds.length === 0 || snapshots.length !== new Set(contentIds).size) return true;
    const ids = snapshots
      .filter((value): value is { contentId: number; contentVersion: number } => !!value && typeof value === 'object')
      .map((value) => ({ contentId: Number(value.contentId), contentVersion: Number(value.contentVersion) }))
      .filter((value) => Number.isInteger(value.contentId) && value.contentId > 0 && Number.isInteger(value.contentVersion));
    if (ids.length > 0) {
      const rows = await db.select({ id: cmsContents.id, version: cmsContents.version })
        .from(cmsContents).where(inArray(cmsContents.id, ids.map((value) => value.contentId)));
      const versions = new Map(rows.map((row) => [row.id, row.version]));
      if (ids.some((value) => versions.get(value.contentId) !== value.contentVersion)) return true;
    }
  }
  return false;
}

export async function listCmsPublishArtifacts(query: QueryOutputOf<typeof cmsPublishingContract.artifacts>) {
  const taskWhere = await buildCmsPublishingWhere({ siteId: query.siteId });
  const start = parseDateRangeStart(query.startTime);
  const end = parseDateRangeEnd(query.endTime);
  const artifactTime = sql`coalesce(${cmsPublishArtifacts.generatedAt}, ${cmsPublishArtifacts.updatedAt})`;
  const where = buildWhere(
    taskWhere,
    query.taskId ? eq(asyncTasks.id, query.taskId) : undefined,
    eq(cmsPublishArtifacts.taskId, asyncTasks.id),
    query.targetType ? eq(cmsPublishArtifacts.targetType, query.targetType) : undefined,
    query.status ? eq(cmsPublishArtifacts.status, query.status) : undefined,
    keywordCondition(query.keyword, [cmsPublishArtifacts.path, cmsPublishArtifacts.url, cmsPublishArtifacts.error], 'ilike'),
    start ? sql`${artifactTime} >= ${start}` : undefined,
    end ? sql`${artifactTime} <= ${end}` : undefined,
  );
  const base = db.select({ artifact: cmsPublishArtifacts })
    .from(cmsPublishArtifacts)
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
  if (['site', 'theme'].includes(input.targetType) && !skipAccessCheck) {
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
      requireRow(page, '搭建页面不存在或不属于所选站点');
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
    /** 已完成权限与输入校验的外部事务；仅持久化，调用方提交后负责入队。 */
    executor?: DbTransaction;
    /** 生命周期事件唯一键（revision/event nonce）；同一事件永久幂等，不同事件绝不复用。 */
    eventKey?: string;
  },
) {
  if (!options?.skipPermissionCheck && !(await hasPermission('cms:publish:build'))) {
    throw new HTTPException(403, { message: '缺少 cms:publish:build 权限' });
  }
  if (!options?.executor) {
    await validatePublishInput(input, options?.skipAccessCheck === true);
  }
  const user = currentUser();
  const executor = options?.executor ?? db;
  const [site] = await executor.select().from(cmsSites).where(eq(cmsSites.id, input.siteId)).limit(1);
  requireRow(site, '站点不存在');
  const fence = await cmsSiteFencePayload(executor, site);
  const fencedInput: CmsPublishSubmitInput = {
    ...input,
    expectedThemeRevision: input.expectedThemeRevision ?? fence.expectedThemeRevision,
    expectedTemplateRefsRevision: input.expectedTemplateRefsRevision ?? fence.expectedTemplateRefsRevision,
    expectedPublicRevision: input.expectedPublicRevision ?? fence.expectedPublicRevision,
  };
  const dedupeFingerprint = buildCmsPublishDedupeFingerprint(fencedInput, user.userId);
  return runWithCurrentUser({ ...user, tenantId: null, viewingTenantId: undefined }, async () => {
    if (fencedInput.targetType === 'site' || fencedInput.targetType === 'theme') {
      const eventKey = options?.eventKey ?? ('manual:' + fencedInput.siteId + ':' + randomUUID());
      const task = options?.executor
        ? await insertCmsPublishOutbox(options.executor, fencedInput, eventKey)
        : await db.transaction((tx) => insertCmsPublishOutbox(tx, fencedInput, eventKey));
      if (!options?.executor) await enqueueCmsPublishOutboxes([task], 'CMS 整站发布任务提交');
      return task;
    }
    if (!options?.eventKey) {
      const [existing] = await executor.select().from(asyncTasks).where(and(
        eq(asyncTasks.taskType, 'cms-publish-build'),
        eq(asyncTasks.createdBy, user.userId),
        inArray(asyncTasks.status, [...CMS_REUSABLE_PUBLISH_TASK_STATUSES]),
        sql`${asyncTasks.payload}->>'dedupeFingerprint' = ${dedupeFingerprint}`,
      )).orderBy(desc(asyncTasks.id)).limit(1);
      if (existing) return mapAsyncTask(existing);
    }
    const taskInput = {
      taskType: 'cms-publish-build',
      title: publishTitle(fencedInput),
      payload: {
        ...fencedInput,
        submittedAt: formatDateTime(dayjs().toDate()),
        systemTriggered: options?.skipAccessCheck === true,
        dedupeFingerprint,
      },
      idempotencyKey: options?.eventKey ? `cms-publish-event:${options.eventKey}` : null,
    };
    const row = options?.executor
      ? await persistAsyncTask(options.executor, taskInput)
      : await submitAsyncTask(taskInput);
    return mapAsyncTask(row);
  });
}

export async function submitCmsSiteGroupPublish(input: SubmitCmsSiteGroupPublishInput) {
  if (!(await hasPermission('cms:publish:group'))) {
    throw new HTTPException(403, { message: '缺少 cms:publish:group 权限' });
  }
  const state = await loadCmsInheritanceState();
  const root = state.sites.find((site) => site.id === input.rootSiteId);
  const rootSite = requireRow(root, '站群根站点不存在');
  const targetSiteIds = listCmsSubtreeIds(state.sites, rootSite.id)
    .filter((id) => state.sites.find((site) => site.id === id)?.status === 'enabled')
    .sort((a, b) => a - b);
  if (!targetSiteIds.length) throw new HTTPException(400, { message: '站群中没有可发布的启用站点' });
  await assertSitesAccess(targetSiteIds);
  for (const siteId of targetSiteIds) await assertAllCmsSiteChannelsAccess(siteId);

  const tasks = await db.transaction(async (tx) => {
    // 一次取回站群内全部站点行，替代逐站点点查；仍按 targetSiteIds 顺序逐个校验状态，
    // 首个状态异常的站点即中止整个事务，报错口径不变
    const siteRows = await tx.select().from(cmsSites).where(inArray(cmsSites.id, targetSiteIds));
    const siteById = new Map(siteRows.map((row) => [row.id, row]));
    const submitted = [];
    for (const siteId of targetSiteIds) {
      const site = siteById.get(siteId);
      if (!site || site.status !== 'enabled') {
        throw new HTTPException(409, { message: `站点 #${siteId} 状态已变化，请刷新后重试` });
      }
      const fence = await cmsSiteFencePayload(tx, site);
      submitted.push(await submitCmsPublishTask({
        siteId,
        targetType: 'site',
        ...fence,
        reason: input.reason?.trim() || `站群 #${rootSite.id} 整组重建`,
      }, {
        skipPermissionCheck: true,
        skipAccessCheck: true,
        executor: tx,
      }));
    }
    return submitted;
  });
  await enqueueCmsPublishOutboxes(tasks, 'CMS 站群整组发布');
  return { rootSiteId: rootSite.id, targetSiteIds, tasks };
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
    const task = await db.transaction(async (tx) => {
      // Keep advisory→row ordering consistent with content/site mutations.
      await acquireCmsSitePublishLock(tx, content.siteId);
      const [site] = await tx.select().from(cmsSites).where(eq(cmsSites.id, content.siteId)).for('update').limit(1);
      if (!site) return null;
      return insertCmsPublishOutbox(tx, {
        siteId: content.siteId,
        targetType: 'content',
        contentIds: [contentId],
        ...await cmsSiteFencePayload(tx, site),
        reason: '内容状态变更增量刷新',
      }, `content-side-effect:${contentId}:${randomUUID()}`);
    });
    if (task) {
      await enqueueCmsPublishOutboxes([task], '内容状态变更增量刷新');
    }
  }).catch((error) => logger.error(`[cms-publishing] 内容 ${contentId} 发布任务提交失败`, error));
}

export function submitCmsPagePublishSideEffect(input: {
  siteId: number;
  pageId?: number;
  slug?: string;
  isHome?: boolean;
  removed?: boolean;
  removePath?: string | null;
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
      pageRemovePath: input.removePath ?? undefined,
      pageIsHome: input.isHome,
      pageRemoved: input.removed,
      reason: input.removed ? '搭建页面停用或删除' : '搭建页面保存',
    }, { skipPermissionCheck: true, skipAccessCheck: true });
  }).catch((error) => logger.error('[cms-publishing] 搭建页面发布任务提交失败', error));
}

async function trackingContext(input: CmsPublishSubmitInput, taskId: number, ctx: TaskRunContext) {
  const site = await resolveEffectiveCmsSiteRow(input.siteId);
  const protocol = (site.settings as Record<string, unknown> | null)?.protocol === 'http' ? 'http' : 'https';
  const artifactProgress = { count: 0, failed: 0 };
  return {
    site,
    artifactProgress,
    context: {
      taskId,
      siteId: input.siteId,
      publicRevision: input.expectedPublicRevision ?? site.publicRevision,
      targetType: input.targetType,
      contentId: input.targetType === 'content' ? input.contentIds?.[0] ?? null : null,
      channelId: input.channelId ?? null,
      pageId: input.pageId ?? null,
      themeCode: input.themeCode ?? site.theme,
      origin: site.domain ? `${protocol}://${site.domain}` : null,
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
    description: '统一处理内容、栏目、整站与主题影响重建，并记录逐路径产物。',
    allowConcurrent: true,
    maxAttempts: 3,
    retryDelayMs: 5000,
    // 发布产物索引（cms_publish_artifacts）随任务级联删除，保留期需长于全局默认的 30 天
    retentionDays: 180,
    async run(ctx) {
      const input = ctx.payload as unknown as CmsPublishSubmitInput;
      const systemTriggered = (ctx.payload as { systemTriggered?: unknown }).systemTriggered === true;
      if (!systemTriggered && !(await hasPermission('cms:publish:build'))) {
        throw new Error('发布任务创建者的 CMS 发布权限已失效');
      }
      return withCmsSitePublishLock(input.siteId, input, async () => {
      await validatePublishInput(input, systemTriggered);
      await db.delete(cmsPublishArtifacts).where(and(
        eq(cmsPublishArtifacts.taskId, ctx.taskId),
        eq(cmsPublishArtifacts.path, `@target/${input.targetType}`),
      ));
      const tracked = await trackingContext(input, ctx.taskId, ctx);
      let prunedArtifacts = 0;
      try {
        if (input.targetType === 'content' || input.targetType === 'contents') {
          const snapshots = [...(input.contentSnapshots ?? [])].sort((a, b) => a.contentId - b.contentId);
          const ids = stableCmsContentTargets(snapshots.length ? snapshots.map((item) => item.contentId) : input.contentIds ?? []);
          const lastId = Number(ctx.checkpoint?.phase === 'content' ? ctx.checkpoint.lastId ?? 0 : 0);
          let processed = ids.filter((id) => id <= lastId).length;
          const remaining = remainingCmsContentTargets(ids, lastId);
          const snapshotByContentId = new Map(snapshots.map((item) => [item.contentId, item]));
          // 批量预取内容的栏目归属，避免循环内逐条查询（N+1）
          const channelRows = remaining.length > 0
            ? await db.select({ id: cmsContents.id, channelId: cmsContents.channelId }).from(cmsContents)
              .where(inArray(cmsContents.id, remaining))
            : [];
          const channelIdByContentId = new Map(channelRows.map((row) => [row.id, row.channelId]));
          for (const contentId of remaining) {
            const snapshot = snapshotByContentId.get(contentId);
            await withCmsPublishArtifactTracking(
              {
                ...tracked.context,
                contentId: snapshot?.purged ? null : contentId,
                channelId: snapshot?.channelId ?? channelIdByContentId.get(contentId) ?? null,
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
            removePath: input.pageRemovePath ?? null,
          }));
          await ctx.progress({ processed: 1, failed: tracked.artifactProgress.failed, total: 1, note: '搭建页面重建完成', checkpoint: { phase: 'page', lastId: input.pageId ?? null, pageSlug: slug } });
        } else {
          const build = await withCmsPublishArtifactTracking(tracked.context, () => buildSiteStatic(input.siteId, async (progress) => {
            const state = await ctx.progress({
              processed: progress.processed,
              failed: tracked.artifactProgress.failed,
              total: progress.total,
              note: progress.note,
              checkpoint: { ...progress.checkpoint },
            });
            return state.cancelRequested;
          }, { resumeAfterKey: typeof ctx.checkpoint?.lastKey === 'string' ? ctx.checkpoint.lastKey : null }));
          prunedArtifacts = build.pruned;
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
        prunedArtifacts,
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
  if (action === 'resume') {
    // A checkpoint is safe only while its site fence and content snapshots
    // still describe the database.  Otherwise create a fresh task so the
    // operator's retry actually converges instead of immediately cancelling.
    if (await cmsPublishTaskNeedsFreshInput(task)) {
      const input = await buildFreshCmsPublishInput(task, 'restart');
      return submitCmsPublishTask(input, {
        skipPermissionCheck: true,
        skipAccessCheck: true,
        eventKey: `retry:${id}:resume:${randomUUID()}`,
      });
    }
    return mapAsyncTask(await resumeAsyncTask(id));
  }
  if (!isAsyncTaskTerminal(task.status)) {
    throw new HTTPException(400, { message: '仅已结束的任务可以重新开始或重建' });
  }
  if (action === 'rebuild' && task.status !== 'success') {
    throw new HTTPException(400, { message: '仅成功任务可以重建' });
  }
  const input = await buildFreshCmsPublishInput(task, action);
  // A retry is a new publication event: it captures current content and the
  // current site fence, while preserving the original task and its artifacts
  // as an auditable history record.
  return submitCmsPublishTask(input, {
    skipPermissionCheck: true,
    // The original task has already passed the CMS/site access check. Keep the
    // retry system-triggered so a manager without the build permission does
    // not create a task that can only fail in the worker.
    skipAccessCheck: true,
    eventKey: `retry:${id}:${action}:${randomUUID()}`,
  });
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

