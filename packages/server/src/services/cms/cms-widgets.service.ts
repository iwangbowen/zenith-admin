import { requireRow } from '../../lib/db-assert';
import { buildListResult } from '../../lib/list-query';
import {
  and, desc, eq, gt, inArray, isNull, or, sql,
} from 'drizzle-orm';
import { HTTPException } from 'hono/http-exception';
import { CMS_WIDGET_HIGH_FANOUT_THRESHOLD, CMS_WIDGET_RENDERER_KEYS, cmsWidgetDataSchema } from '@zenith/shared/cms';
import type { CmsPageBlock, CmsResolvedWidget, CmsResolvedWidgetItem, CmsWidgetData, CmsWidgetRefOwnerType, CmsWidgetRendererKey, CmsWidgetSlot, CmsWidgetSourceType, CreateCmsWidgetInput, UpdateCmsWidgetInput } from '@zenith/shared/cms';
import type { SaveCmsWidgetSlotInput } from '@zenith/shared/report';
import { db } from '../../db';
import {
  cmsChannels,
  cmsContents,
  cmsPages,
  cmsSites,
  cmsWidgetRefs,
  cmsWidgets,
  cmsWidgetSourceRefs,
  type CmsWidgetRefRow,
  type CmsWidgetRow,
} from '../../db/schema';
import type { DbExecutor } from '../../db/types';
import { formatDateTime, formatNullableDateTime } from '../../lib/datetime';
import { rethrowPgUniqueViolation } from '../../lib/db-errors';
import { buildWhere, withPagination, keywordCondition } from '../../lib/where-helpers';
import { getThemeWidgetSlots, listThemeWidgetRenderers, resolveThemeWidgetRenderer } from '../../cms/themes/registry';
import { renderCmsWidgetHtml } from '../../cms/themes/widgets';
import { assertSiteAccess, ensureCmsSiteExists } from './cms-sites.service';
import { resolveEffectiveCmsSiteRow } from './cms-site-inheritance.service';
import { lockCmsSiteForMutation } from './cms-site-publish-lock.service';
import {
  canonicalizeCmsResourceContent,
  deleteCmsResourceRefsForOwner,
  isSafeCmsResourceUrl,
  resolveCmsContentRows,
  resolveCmsResourcePayload,
  syncCmsResourceRefs,
} from './cms-resource-refs.service';
import { buildCmsLinkResolver } from './cms-link.service';
import { channelUrl, contentUrl } from './cms-urls';
import { cmsContentListColumns, listSummaryOf } from './cms-content-columns';
import { refreshCmsPublicConfiguration } from './cms-public-config-refresh.service';
import { getEffectivelyEnabledCmsChannelIds, resolveEffectivelyEnabledChannelIds } from './cms-channel-visibility.service';

const WIDGET_SCHEMA_VERSION = 1;
const rendererKeys = new Set<string>(CMS_WIDGET_RENDERER_KEYS);

function normalizeWidgetData(value: unknown): CmsWidgetData {
  const data = cmsWidgetDataSchema.parse(value) as CmsWidgetData;
  const ids = new Set<string>();
  for (const item of data.items) {
    if (ids.has(item.id)) throw new HTTPException(400, { message: `页面部件条目 id 重复：${item.id}` });
    ids.add(item.id);
  }
  return data;
}

function rendererKey(value: unknown, fallback: CmsWidgetRendererKey = 'list-sidebar'): CmsWidgetRendererKey {
  return typeof value === 'string' && rendererKeys.has(value)
    ? value as CmsWidgetRendererKey
    : fallback;
}

interface CmsWidgetReferenceStats {
  referenceCount: number;
  impactCount: number;
}

export function mapCmsWidget(
  row: CmsWidgetRow,
  stats: CmsWidgetReferenceStats = { referenceCount: 0, impactCount: 0 },
) {
  return {
    id: row.id,
    siteId: row.siteId,
    name: row.name,
    code: row.code,
    type: row.type,
    schemaVersion: row.schemaVersion,
    draftData: row.draftData,
    publishedData: row.publishedData ?? null,
    publishedName: row.publishedName ?? null,
    draftRevision: row.draftRevision,
    publishedRevision: row.publishedRevision,
    status: row.status,
    defaultRendererKey: rendererKey(row.defaultRendererKey),
    remark: row.remark ?? null,
    referenceCount: stats.referenceCount,
    impactCount: stats.impactCount,
    highFanout: stats.impactCount >= CMS_WIDGET_HIGH_FANOUT_THRESHOLD,
    hasUnpublishedChanges: row.draftRevision !== row.publishedRevision,
    createdBy: row.createdBy ?? null,
    updatedBy: row.updatedBy ?? null,
    createdAt: formatDateTime(row.createdAt),
    updatedAt: formatDateTime(row.updatedAt),
  };
}

async function referenceStats(widgetIds: number[]): Promise<Map<number, CmsWidgetReferenceStats>> {
  if (widgetIds.length === 0) return new Map();
  const rows = await db.select({
    widgetId: cmsWidgetRefs.widgetId,
    referenceCount: sql<number>`count(*)::int`,
    impactCount: sql<number>`count(distinct (${cmsWidgetRefs.ownerType}::text || ':' || ${cmsWidgetRefs.ownerId}::text))::int`,
  }).from(cmsWidgetRefs)
    .where(inArray(cmsWidgetRefs.widgetId, widgetIds))
    .groupBy(cmsWidgetRefs.widgetId);
  return new Map(rows.map((row) => [row.widgetId, {
    referenceCount: row.referenceCount,
    impactCount: row.impactCount,
  }]));
}

export async function listCmsWidgets(params: {
  page: number;
  pageSize: number;
  siteId: number;
  keyword?: string;
  status?: CmsWidgetRow['status'];
  type?: CmsWidgetRow['type'];
}) {
  await ensureCmsSiteExists(params.siteId);
  await assertSiteAccess(params.siteId);
  const where = buildWhere(
    eq(cmsWidgets.siteId, params.siteId),
    keywordCondition(params.keyword, [cmsWidgets.name, cmsWidgets.code], 'ilike'),
    params.status ? eq(cmsWidgets.status, params.status) : undefined,
    params.type ? eq(cmsWidgets.type, params.type) : undefined,
  );
  const result = await buildListResult({
    page: params.page,
    pageSize: params.pageSize,
    count: () => db.$count(cmsWidgets, where),
    rows: async () => {
      const rows = await withPagination(
        db.select().from(cmsWidgets).where(where).orderBy(desc(cmsWidgets.id)).$dynamic(),
        params.page,
        params.pageSize,
      );
      const stats = await referenceStats(rows.map((row) => row.id));
      return rows.map((row) => mapCmsWidget(row, stats.get(row.id)));
    },
  });
  return resolveCmsResourcePayload(result, params.siteId);
}

export async function listPublishedCmsWidgets(siteId: number) {
  await ensureCmsSiteExists(siteId);
  await assertSiteAccess(siteId);
  const rows = await db.select().from(cmsWidgets).where(and(
    eq(cmsWidgets.siteId, siteId),
    eq(cmsWidgets.status, 'published'),
  )).orderBy(cmsWidgets.name, cmsWidgets.id);
  const stats = await referenceStats(rows.map((row) => row.id));
  return resolveCmsResourcePayload(rows.map((row) => mapCmsWidget(row, stats.get(row.id))), siteId);
}

export async function listCmsWidgetRenderersForSite(siteId: number, type: CmsWidgetRow['type']) {
  await assertSiteAccess(siteId);
  const site = await resolveEffectiveCmsSiteRow(siteId);
  return listThemeWidgetRenderers(site.theme, type);
}

export async function ensureCmsWidgetExists(id: number, executor: DbExecutor = db): Promise<CmsWidgetRow> {
  const [row] = await executor.select().from(cmsWidgets).where(eq(cmsWidgets.id, id)).limit(1);
  return requireRow(row, '页面部件不存在');
}

export async function getCmsWidget(id: number) {
  const row = await ensureCmsWidgetExists(id);
  await assertSiteAccess(row.siteId);
  const stats = await referenceStats([id]);
  return resolveCmsResourcePayload(mapCmsWidget(row, stats.get(id)), row.siteId);
}

async function assertWidgetSources(
  executor: DbExecutor,
  siteId: number,
  data: CmsWidgetData,
  requirePublished: boolean,
): Promise<void> {
  const contentIds = [...new Set(data.items
    .filter((item) => item.sourceType === 'content')
    .map((item) => item.sourceId!)
    .filter(Boolean))];
  const channelIds = [...new Set(data.items
    .filter((item) => item.sourceType === 'channel')
    .map((item) => item.sourceId!)
    .filter(Boolean))];
  const [contents, channels] = await Promise.all([
    contentIds.length
      ? executor.select({
          id: cmsContents.id,
          siteId: cmsContents.siteId,
          status: cmsContents.status,
          deletedAt: cmsContents.deletedAt,
          archivedAt: cmsContents.archivedAt,
          expireAt: cmsContents.expireAt,
        }).from(cmsContents).where(inArray(cmsContents.id, contentIds))
      : [],
    channelIds.length
      ? executor.select({
          id: cmsChannels.id,
          siteId: cmsChannels.siteId,
          status: cmsChannels.status,
          parentId: cmsChannels.parentId,
          type: cmsChannels.type,
        }).from(cmsChannels).where(inArray(cmsChannels.id, channelIds))
      : [],
  ]);
  const contentById = new Map(contents.map((row) => [row.id, row]));
  const channelById = new Map(channels.map((row) => [row.id, row]));
  const effectiveChannelIds = resolveEffectivelyEnabledChannelIds(await executor.select({
    id: cmsChannels.id,
    parentId: cmsChannels.parentId,
    status: cmsChannels.status,
  }).from(cmsChannels).where(eq(cmsChannels.siteId, siteId)));
  for (const contentId of contentIds) {
    const content = contentById.get(contentId);
    const contentRow = requireRow(content, `引用内容 #${contentId} 不存在`, 400);
    if (contentRow.siteId !== siteId) throw new HTTPException(400, { message: `引用内容 #${contentId} 不属于当前站点` });
    if (requirePublished && (contentRow.status !== 'published' || contentRow.deletedAt || contentRow.archivedAt || (contentRow.expireAt && contentRow.expireAt <= new Date()))) {
      throw new HTTPException(400, { message: `引用内容 #${contentId} 必须处于已发布状态` });
    }
  }
  for (const channelId of channelIds) {
    const channel = channelById.get(channelId);
    const channelRow = requireRow(channel, `引用栏目 #${channelId} 不存在`, 400);
    if (channelRow.siteId !== siteId) throw new HTTPException(400, { message: `引用栏目 #${channelId} 不属于当前站点` });
    if (channelRow.type !== 'list' || !effectiveChannelIds.has(channelRow.id)) {
      throw new HTTPException(400, { message: `引用栏目 #${channelId} 必须是有效的列表栏目` });
    }
    if (requirePublished && channelRow.status !== 'enabled') {
      throw new HTTPException(400, { message: `引用栏目 #${channelId} 必须处于启用状态` });
    }
  }
}

async function syncPublishedSourceRefs(
  executor: DbExecutor,
  row: Pick<CmsWidgetRow, 'id' | 'siteId' | 'status' | 'publishedData'>,
): Promise<void> {
  await executor.delete(cmsWidgetSourceRefs).where(eq(cmsWidgetSourceRefs.widgetId, row.id));
  if (row.status !== 'published' || !row.publishedData) return;
  const values = row.publishedData.items.flatMap((item) =>
    item.sourceType === 'content' || item.sourceType === 'channel'
      ? [{
          siteId: row.siteId,
          widgetId: row.id,
          itemId: item.id,
          sourceType: item.sourceType,
          sourceId: item.sourceId!,
        }]
      : []);
  if (values.length > 0) await executor.insert(cmsWidgetSourceRefs).values(values);
}

export async function createCmsWidget(input: CreateCmsWidgetInput) {
  await ensureCmsSiteExists(input.siteId);
  await assertSiteAccess(input.siteId);
  const draftData = normalizeWidgetData(input.draftData ?? { items: [] });
  await assertWidgetSources(db, input.siteId, draftData, false);
  try {
    const id = await db.transaction(async (tx) => {
      await lockCmsSiteForMutation(tx, input.siteId);
      const canonicalData = await canonicalizeCmsResourceContent(tx, input.siteId, draftData);
      const [created] = await tx.insert(cmsWidgets).values({
        siteId: input.siteId,
        name: input.name,
        code: input.code,
        type: input.type ?? 'manual-list',
        schemaVersion: WIDGET_SCHEMA_VERSION,
        draftData: canonicalData,
        defaultRendererKey: input.defaultRendererKey ?? 'list-sidebar',
        remark: input.remark ?? null,
      }).returning();
      await syncCmsResourceRefs(tx, 'widget', created.id, created.siteId, created);
      return created.id;
    });
    return getCmsWidget(id);
  } catch (error) {
    rethrowPgUniqueViolation(error, '同站点下已存在相同编码的页面部件');
  }
}

export async function updateCmsWidget(id: number, input: UpdateCmsWidgetInput) {
  const initial = await ensureCmsWidgetExists(id);
  await assertSiteAccess(initial.siteId);
  const draftData = input.draftData === undefined ? undefined : normalizeWidgetData(input.draftData);
  if (draftData) await assertWidgetSources(db, initial.siteId, draftData, false);
  try {
    await db.transaction(async (tx) => {
      await lockCmsSiteForMutation(tx, initial.siteId);
      const [locked] = await tx.select().from(cmsWidgets).where(eq(cmsWidgets.id, id)).for('update').limit(1);
      requireRow(locked, '页面部件不存在');
      if (locked.draftRevision !== input.expectedRevision) {
        throw new HTTPException(409, { message: '页面部件草稿已被其他人更新，请刷新后再编辑' });
      }
      const canonicalData = draftData
        ? await canonicalizeCmsResourceContent(tx, locked.siteId, draftData)
        : undefined;
      const revisionChanged = canonicalData !== undefined
        || (input.name !== undefined && input.name !== locked.name)
        || (input.defaultRendererKey !== undefined && input.defaultRendererKey !== locked.defaultRendererKey)
        || (input.remark !== undefined && (input.remark ?? null) !== (locked.remark ?? null));
      const changes = {
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(canonicalData !== undefined ? { draftData: canonicalData } : {}),
        ...(input.defaultRendererKey !== undefined ? { defaultRendererKey: input.defaultRendererKey } : {}),
        ...(input.remark !== undefined ? { remark: input.remark ?? null } : {}),
        ...(revisionChanged ? { draftRevision: sql`${cmsWidgets.draftRevision} + 1` } : {}),
      };
      if (Object.keys(changes).length === 0) return;
      const [updated] = await tx.update(cmsWidgets).set(changes).where(eq(cmsWidgets.id, id)).returning();
      await syncCmsResourceRefs(tx, 'widget', updated.id, updated.siteId, updated);
    });
    return getCmsWidget(id);
  } catch (error) {
    rethrowPgUniqueViolation(error, '同站点下已存在相同编码的页面部件');
  }
}

export async function publishCmsWidget(
  id: number,
  options?: { skipAccessCheck?: boolean; suppressRefresh?: boolean },
) {
  const initial = await ensureCmsWidgetExists(id);
  if (!options?.skipAccessCheck) await assertSiteAccess(initial.siteId);
  const { updated, eventToken } = await db.transaction(async (tx) => {
    await lockCmsSiteForMutation(tx, initial.siteId);
    const [locked] = await tx.select().from(cmsWidgets).where(eq(cmsWidgets.id, id)).for('update').limit(1);
    requireRow(locked, '页面部件不存在');
    const data = normalizeWidgetData(locked.draftData);
    await assertWidgetSources(tx, locked.siteId, data, true);
    const [updated] = await tx.update(cmsWidgets).set({
      publishedData: data,
      publishedName: locked.name,
      publishedRevision: locked.draftRevision,
      status: 'published',
    }).where(eq(cmsWidgets.id, id)).returning();
    await syncPublishedSourceRefs(tx, updated);
    await syncCmsResourceRefs(tx, 'widget', updated.id, updated.siteId, updated);
    return { updated, eventToken: locked.updatedAt.getTime() };
  });
  if (!options?.suppressRefresh) {
    await refreshCmsPublicConfiguration(updated.siteId, '页面部件发布', `widget:${id}:publish:${updated.draftRevision}:${eventToken}`);
  }
  return options?.skipAccessCheck ? mapCmsWidget(await ensureCmsWidgetExists(id)) : getCmsWidget(id);
}

export async function offlineCmsWidget(
  id: number,
  options?: { skipAccessCheck?: boolean; suppressRefresh?: boolean; allowAlreadyOffline?: boolean },
) {
  const initial = await ensureCmsWidgetExists(id);
  if (!options?.skipAccessCheck) await assertSiteAccess(initial.siteId);
  if (initial.status === 'offline' && options?.allowAlreadyOffline) {
    return options.skipAccessCheck ? mapCmsWidget(initial) : getCmsWidget(id);
  }
  if (initial.status !== 'published') {
    throw new HTTPException(400, { message: `当前状态（${initial.status}）不允许下线` });
  }
  const { updated, eventToken } = await db.transaction(async (tx) => {
    await lockCmsSiteForMutation(tx, initial.siteId);
    const [locked] = await tx.select().from(cmsWidgets).where(eq(cmsWidgets.id, id)).for('update').limit(1);
    if (!locked || locked.status !== 'published') {
      throw new HTTPException(409, { message: '页面部件状态已变化，请刷新后重试' });
    }
    const [updated] = await tx.update(cmsWidgets).set({ status: 'offline' })
      .where(and(eq(cmsWidgets.id, id), eq(cmsWidgets.status, 'published')))
      .returning();
    requireRow(updated, '页面部件状态已变化，请刷新后重试', 409);
    await syncPublishedSourceRefs(tx, updated);
    return { updated, eventToken: locked.updatedAt.getTime() };
  });
  if (!options?.suppressRefresh) {
    await refreshCmsPublicConfiguration(updated.siteId, '页面部件下线', `widget:${id}:offline:${updated.draftRevision}:${eventToken}`);
  }
  return options?.skipAccessCheck ? mapCmsWidget(await ensureCmsWidgetExists(id)) : getCmsWidget(id);
}

export async function deleteCmsWidget(id: number, options?: { skipAccessCheck?: boolean }) {
  const initial = await ensureCmsWidgetExists(id);
  if (!options?.skipAccessCheck) await assertSiteAccess(initial.siteId);
  await db.transaction(async (tx) => {
    await lockCmsSiteForMutation(tx, initial.siteId);
    const [locked] = await tx.select({ id: cmsWidgets.id }).from(cmsWidgets)
      .where(eq(cmsWidgets.id, id)).for('update').limit(1);
    requireRow(locked, '页面部件不存在');
    const count = await tx.$count(cmsWidgetRefs, eq(cmsWidgetRefs.widgetId, id));
    if (count > 0) throw new HTTPException(409, { message: `该页面部件仍被 ${count} 个位置引用，请先解除引用` });
    await deleteCmsResourceRefsForOwner(tx, 'widget', [id], initial.siteId);
    await tx.delete(cmsWidgets).where(eq(cmsWidgets.id, id));
  });
}

function refStyleProps(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

export function extractCmsWidgetRefsFromBlocks(blocks: readonly CmsPageBlock[]) {
  return blocks.flatMap((block) => {
    if (block.type !== 'widget-ref') return [];
    const widgetId = Number(block.props.widgetId);
    if (!Number.isInteger(widgetId) || widgetId <= 0) {
      throw new HTTPException(400, { message: `区块「${block.id}」未选择有效页面部件` });
    }
    return [{
      widgetId,
      field: block.id,
      rendererKey: rendererKey(block.props.rendererKey),
      styleProps: refStyleProps(block.props.styleProps),
    }];
  });
}

export async function syncCmsPageWidgetRefs(
  executor: DbExecutor,
  pageId: number,
  siteId: number,
  blocks: readonly CmsPageBlock[],
): Promise<void> {
  const refs = extractCmsWidgetRefsFromBlocks(blocks);
  await executor.delete(cmsWidgetRefs).where(and(
    eq(cmsWidgetRefs.ownerType, 'page'),
    eq(cmsWidgetRefs.ownerId, pageId),
  ));
  if (refs.length === 0) return;
  const widgetIds = [...new Set(refs.map((ref) => ref.widgetId))];
  const widgets = await executor.select({ id: cmsWidgets.id, siteId: cmsWidgets.siteId })
    .from(cmsWidgets).where(inArray(cmsWidgets.id, widgetIds));
  const valid = new Set(widgets.filter((widget) => widget.siteId === siteId).map((widget) => widget.id));
  const invalid = widgetIds.find((widgetId) => !valid.has(widgetId));
  if (invalid) throw new HTTPException(400, { message: `页面部件 #${invalid} 不存在或不属于当前站点` });
  await executor.insert(cmsWidgetRefs).values(refs.map((ref) => ({
    siteId,
    widgetId: ref.widgetId,
    ownerType: 'page' as const,
    ownerId: pageId,
    field: ref.field,
    rendererKey: ref.rendererKey,
    styleProps: ref.styleProps,
  })));
}

export async function deleteCmsPageWidgetRefs(executor: DbExecutor, pageIds: number[]): Promise<void> {
  if (pageIds.length === 0) return;
  await executor.delete(cmsWidgetRefs).where(and(
    eq(cmsWidgetRefs.ownerType, 'page'),
    inArray(cmsWidgetRefs.ownerId, pageIds),
  ));
}

async function mapWidgetRefs(rows: CmsWidgetRefRow[]) {
  const pageIds = rows.filter((row) => row.ownerType === 'page').map((row) => row.ownerId);
  const siteIds = rows.filter((row) => row.ownerType === 'theme_slot').map((row) => row.ownerId);
  const [pages, sites] = await Promise.all([
    pageIds.length
      ? db.select({ id: cmsPages.id, name: cmsPages.name }).from(cmsPages).where(inArray(cmsPages.id, pageIds))
      : [],
    siteIds.length
      ? db.select({ id: cmsSites.id, name: cmsSites.name }).from(cmsSites).where(inArray(cmsSites.id, siteIds))
      : [],
  ]);
  const names = new Map<string, string>([
    ...pages.map((page) => [`page:${page.id}`, page.name] as const),
    ...sites.map((site) => [`theme_slot:${site.id}`, site.name] as const),
  ]);
  return rows.map((row) => ({
    id: row.id,
    siteId: row.siteId,
    widgetId: row.widgetId,
    ownerType: row.ownerType,
    ownerId: row.ownerId,
    field: row.field,
    rendererKey: rendererKey(row.rendererKey),
    styleProps: row.styleProps ?? {},
    ownerName: names.get(`${row.ownerType}:${row.ownerId}`) ?? null,
    createdAt: formatDateTime(row.createdAt),
    updatedAt: formatDateTime(row.updatedAt),
  }));
}

export async function listCmsWidgetRefs(id: number) {
  const widget = await ensureCmsWidgetExists(id);
  await assertSiteAccess(widget.siteId);
  const rows = await db.select().from(cmsWidgetRefs)
    .where(eq(cmsWidgetRefs.widgetId, id))
    .orderBy(cmsWidgetRefs.ownerType, cmsWidgetRefs.ownerId, cmsWidgetRefs.field);
  return mapWidgetRefs(rows);
}

export async function listCmsWidgetSlots(siteId: number): Promise<CmsWidgetSlot[]> {
  await assertSiteAccess(siteId);
  const site = await resolveEffectiveCmsSiteRow(siteId);
  const definitions = getThemeWidgetSlots(site.theme);
  const rows = await db.select().from(cmsWidgetRefs).where(and(
    eq(cmsWidgetRefs.siteId, siteId),
    eq(cmsWidgetRefs.ownerType, 'theme_slot'),
    eq(cmsWidgetRefs.ownerId, siteId),
  ));
  const bindings = new Map((await mapWidgetRefs(rows)).map((row) => [row.field, row]));
  return definitions.map((definition) => ({
    key: definition.key,
    label: definition.label,
    allowedTypes: [...definition.allowedTypes],
    rendererKeys: [...definition.rendererKeys],
    binding: bindings.get(definition.key) ?? null,
  }));
}

export async function saveCmsWidgetSlot(
  slotKey: 'home.sidebar',
  input: SaveCmsWidgetSlotInput,
) {
  await assertSiteAccess(input.siteId);
  const site = await resolveEffectiveCmsSiteRow(input.siteId);
  const maybeDefinition = getThemeWidgetSlots(site.theme).find((slot) => slot.key === slotKey);
  const definition = requireRow(maybeDefinition, `当前主题不支持插槽 ${slotKey}`, 400);
  if (!definition.rendererKeys.includes(input.rendererKey ?? 'list-sidebar')) {
    throw new HTTPException(400, { message: '所选展示模板不适用于该主题插槽' });
  }
  if (input.widgetId) {
    const widget = await ensureCmsWidgetExists(input.widgetId);
    if (widget.siteId !== input.siteId) throw new HTTPException(400, { message: '页面部件不属于当前站点' });
    if (widget.status !== 'published') throw new HTTPException(400, { message: '主题插槽只能绑定已发布的页面部件' });
    if (!definition.allowedTypes.includes(widget.type)) throw new HTTPException(400, { message: '页面部件类型不适用于该主题插槽' });
  }
  await db.transaction(async (tx) => {
    await lockCmsSiteForMutation(tx, input.siteId);
    await tx.delete(cmsWidgetRefs).where(and(
      eq(cmsWidgetRefs.ownerType, 'theme_slot'),
      eq(cmsWidgetRefs.ownerId, input.siteId),
      eq(cmsWidgetRefs.field, slotKey),
    ));
    if (input.widgetId) {
      await tx.insert(cmsWidgetRefs).values({
        siteId: input.siteId,
        widgetId: input.widgetId,
        ownerType: 'theme_slot',
        ownerId: input.siteId,
        field: slotKey,
        rendererKey: input.rendererKey ?? 'list-sidebar',
        styleProps: input.styleProps ?? {},
      });
    }
  });
  await refreshCmsPublicConfiguration(input.siteId, '页面部件插槽更新', `widget-slot:${slotKey}:${Date.now()}`);
  return listCmsWidgetSlots(input.siteId);
}

export async function assertCmsWidgetSourcesMutable(
  sourceType: Exclude<CmsWidgetSourceType, 'manual'>,
  sourceIds: number[],
  executor: DbExecutor = db,
): Promise<void> {
  if (sourceIds.length === 0) return;
  const refs = await executor.select({
    widgetId: cmsWidgets.id,
    widgetName: cmsWidgets.name,
    sourceId: cmsWidgetSourceRefs.sourceId,
  }).from(cmsWidgetSourceRefs)
    .innerJoin(cmsWidgets, eq(cmsWidgetSourceRefs.widgetId, cmsWidgets.id))
    .where(and(
      eq(cmsWidgetSourceRefs.sourceType, sourceType),
      inArray(cmsWidgetSourceRefs.sourceId, [...new Set(sourceIds)]),
      eq(cmsWidgets.status, 'published'),
    ));
  if (refs.length === 0) return;
  const names = [...new Set(refs.map((ref) => `#${ref.widgetId}「${ref.widgetName}」`))].slice(0, 5);
  throw new HTTPException(409, {
    message: `有已发布页面部件 ${names.join('、')} 引用了该${sourceType === 'content' ? '内容' : '栏目'}，请先下线或调整页面部件`,
  });
}

export async function listCmsWidgetSourceReferences(
  sourceType: Exclude<CmsWidgetSourceType, 'manual'>,
  sourceId: number,
) {
  const sourceRows = sourceType === 'content'
    ? await db.select({
        siteId: cmsContents.siteId,
        channelId: cmsContents.channelId,
      }).from(cmsContents)
      .where(eq(cmsContents.id, sourceId)).limit(1)
    : await db.select({
        siteId: cmsChannels.siteId,
        channelId: cmsChannels.id,
      }).from(cmsChannels)
      .where(eq(cmsChannels.id, sourceId)).limit(1);
  const source = sourceRows[0];
  const sourceRow = requireRow(source, sourceType === 'content' ? '内容不存在' : '栏目不存在');
  const { assertChannelAccess } = await import('./cms-channels.service');
  await assertChannelAccess(sourceRow.channelId);
  const directRows = await db.select({
    widgetId: cmsWidgets.id,
    widgetName: cmsWidgets.name,
    widgetCode: cmsWidgets.code,
    itemId: cmsWidgetSourceRefs.itemId,
    sourceType: cmsWidgetSourceRefs.sourceType,
    sourceId: cmsWidgetSourceRefs.sourceId,
  }).from(cmsWidgetSourceRefs)
    .innerJoin(cmsWidgets, eq(cmsWidgetSourceRefs.widgetId, cmsWidgets.id))
    .where(and(
      eq(cmsWidgetSourceRefs.sourceType, sourceType),
      eq(cmsWidgetSourceRefs.sourceId, sourceId),
      eq(cmsWidgets.status, 'published'),
    ))
    .orderBy(cmsWidgets.name, cmsWidgetSourceRefs.itemId);
  const contentRows = sourceType === 'channel'
    ? await db.select({
        widgetId: cmsWidgets.id,
        widgetName: cmsWidgets.name,
        widgetCode: cmsWidgets.code,
        itemId: cmsWidgetSourceRefs.itemId,
        sourceType: cmsWidgetSourceRefs.sourceType,
        sourceId: cmsWidgetSourceRefs.sourceId,
      }).from(cmsWidgetSourceRefs)
        .innerJoin(cmsWidgets, eq(cmsWidgetSourceRefs.widgetId, cmsWidgets.id))
        .innerJoin(cmsContents, eq(cmsWidgetSourceRefs.sourceId, cmsContents.id))
        .where(and(
          eq(cmsWidgetSourceRefs.sourceType, 'content'),
          eq(cmsContents.channelId, sourceId),
          eq(cmsWidgets.status, 'published'),
        ))
        .orderBy(cmsWidgets.name, cmsWidgetSourceRefs.itemId)
    : [];
  const rows = [...directRows, ...contentRows];
  const stats = await referenceStats(rows.map((row) => row.widgetId));
  return rows.map((row) => {
    const widgetStats = stats.get(row.widgetId) ?? { referenceCount: 0, impactCount: 0 };
    return {
      ...row,
      sourceType: row.sourceType as Exclude<CmsWidgetSourceType, 'manual'>,
      ...widgetStats,
      highFanout: widgetStats.impactCount >= CMS_WIDGET_HIGH_FANOUT_THRESHOLD,
    };
  });
}

export async function assertCmsWidgetChannelVisibilityMutable(
  channelIds: number[],
  executor: DbExecutor = db,
): Promise<void> {
  await assertCmsWidgetSourcesMutable('channel', channelIds, executor);
  if (channelIds.length === 0) return;
  const refs = await executor.select({
    widgetId: cmsWidgets.id,
    widgetName: cmsWidgets.name,
  }).from(cmsWidgetSourceRefs)
    .innerJoin(cmsWidgets, eq(cmsWidgetSourceRefs.widgetId, cmsWidgets.id))
    .innerJoin(cmsContents, eq(cmsWidgetSourceRefs.sourceId, cmsContents.id))
    .where(and(
      eq(cmsWidgetSourceRefs.sourceType, 'content'),
      inArray(cmsContents.channelId, [...new Set(channelIds)]),
      eq(cmsWidgets.status, 'published'),
    ));
  if (refs.length === 0) return;
  const names = [...new Set(refs.map((ref) => `#${ref.widgetId}「${ref.widgetName}」`))].slice(0, 5);
  throw new HTTPException(409, {
    message: `有已发布页面部件 ${names.join('、')} 引用了栏目下的内容，请先下线或调整页面部件`,
  });
}

export async function findPublishedWidgetIdsBySource(
  sourceType: Exclude<CmsWidgetSourceType, 'manual'>,
  sourceIds: number[],
): Promise<number[]> {
  if (sourceIds.length === 0) return [];
  const rows = await db.select({ widgetId: cmsWidgetSourceRefs.widgetId })
    .from(cmsWidgetSourceRefs)
    .innerJoin(cmsWidgets, eq(cmsWidgetSourceRefs.widgetId, cmsWidgets.id))
    .where(and(
      eq(cmsWidgetSourceRefs.sourceType, sourceType),
      inArray(cmsWidgetSourceRefs.sourceId, [...new Set(sourceIds)]),
      eq(cmsWidgets.status, 'published'),
    ));
  return [...new Set(rows.map((row) => row.widgetId))];
}

interface WidgetPlacement {
  key: string;
  widgetId: number;
  rendererKey?: CmsWidgetRendererKey;
}

export async function resolveCmsWidgetPlacements(
  siteId: number,
  baseUrl: string,
  placements: readonly WidgetPlacement[],
  options?: { useDraft?: boolean },
): Promise<Map<string, CmsResolvedWidget>> {
  if (placements.length === 0) return new Map();
  const widgetIds = [...new Set(placements.map((placement) => placement.widgetId))];
  const rows = await db.select().from(cmsWidgets).where(and(
    inArray(cmsWidgets.id, widgetIds),
    eq(cmsWidgets.siteId, siteId),
    ...(options?.useDraft ? [] : [eq(cmsWidgets.status, 'published')]),
  ));
  const rowById = new Map(rows.map((row) => [row.id, row]));
  const dataByWidget = new Map<number, CmsWidgetData>();
  const contentIds = new Set<number>();
  const directChannelIds = new Set<number>();
  for (const row of rows) {
    const raw = options?.useDraft ? row.draftData : row.publishedData;
    if (!raw) continue;
    const data = normalizeWidgetData(await resolveCmsResourcePayload(raw, siteId));
    dataByWidget.set(row.id, data);
    for (const item of data.items) {
      if (item.sourceType === 'content' && item.sourceId) contentIds.add(item.sourceId);
      if (item.sourceType === 'channel' && item.sourceId) directChannelIds.add(item.sourceId);
    }
  }
  const rawContents = contentIds.size
    ? await db.select(cmsContentListColumns).from(cmsContents).where(and(
        inArray(cmsContents.id, [...contentIds]),
        eq(cmsContents.siteId, siteId),
        eq(cmsContents.status, 'published'),
        isNull(cmsContents.deletedAt),
        isNull(cmsContents.archivedAt),
        or(isNull(cmsContents.expireAt), gt(cmsContents.expireAt, new Date())),
      ))
    : [];
  const contents = await resolveCmsContentRows(rawContents, siteId);
  const channelIds = new Set([...directChannelIds, ...contents.map((content) => content.channelId)]);
  const effectiveChannelIds = await getEffectivelyEnabledCmsChannelIds(siteId);
  const rawChannels = channelIds.size
    ? await db.select().from(cmsChannels).where(and(
        inArray(cmsChannels.id, [...channelIds]),
        eq(cmsChannels.siteId, siteId),
        eq(cmsChannels.status, 'enabled'),
        effectiveChannelIds.size > 0 ? inArray(cmsChannels.id, [...effectiveChannelIds]) : sql`false`,
      ))
    : [];
  const channels = await resolveCmsResourcePayload(rawChannels, siteId);
  const contentById = new Map(contents.map((content) => [content.id, content]));
  const channelById = new Map(channels.map((channel) => [channel.id, channel]));
  const linkResolver = await buildCmsLinkResolver(
    siteId,
    baseUrl,
    [
      ...contents.map((content) => content.externalLink),
      ...[...dataByWidget.values()].flatMap((data) => data.items.map((item) => item.url)),
    ],
  );

  const out = new Map<string, CmsResolvedWidget>();
  for (const placement of placements) {
    const row = rowById.get(placement.widgetId);
    const data = dataByWidget.get(placement.widgetId);
    if (!row || !data) continue;
    const items: CmsResolvedWidgetItem[] = [];
    for (const item of data.items) {
      let source: Omit<CmsResolvedWidgetItem, 'id' | 'sourceType' | 'sourceId'> | null = null;
      if (item.sourceType === 'content' && item.sourceId) {
        const content = contentById.get(item.sourceId);
        const channel = content ? channelById.get(content.channelId) : null;
        if (content && channel) {
          const resolvedExternal = content.externalLink ? linkResolver(content.externalLink) : null;
          source = {
            title: content.title,
            summary: listSummaryOf(content, 120),
            url: resolvedExternal?.url ?? contentUrl(baseUrl, channel, content),
            image: content.coverThumb ?? content.coverImage ?? null,
            displayDate: formatNullableDateTime(content.publishedAt),
          };
        }
      } else if (item.sourceType === 'channel' && item.sourceId) {
        const channel = channelById.get(item.sourceId);
        if (channel) {
          source = {
            title: channel.name,
            summary: channel.seoDescription ?? null,
            url: channelUrl(baseUrl, channel.path, 1),
            image: channel.image ?? null,
            displayDate: null,
          };
        }
      } else {
        source = {
          title: item.title?.trim() ?? '',
          summary: item.summary?.trim() || null,
          url: item.url?.trim() ? (linkResolver(item.url)?.url ?? null) : null,
          image: item.image?.trim() && isSafeCmsResourceUrl(item.image.trim()) ? item.image.trim() : null,
          displayDate: item.displayDate ?? null,
        };
      }
      if (!source) continue;
      items.push({
        id: item.id,
        sourceType: item.sourceType,
        sourceId: item.sourceId ?? null,
        title: item.title?.trim() || source.title,
        summary: item.summary?.trim() || source.summary,
        url: item.url?.trim() ? (linkResolver(item.url)?.url ?? null) : source.url,
        image: item.image?.trim() && isSafeCmsResourceUrl(item.image.trim()) ? item.image.trim() : source.image,
        displayDate: item.displayDate ?? source.displayDate,
      });
    }
    out.set(placement.key, {
      id: row.id,
      name: options?.useDraft ? row.name : (row.publishedName ?? row.name),
      type: row.type,
      rendererKey: placement.rendererKey ?? rendererKey(row.defaultRendererKey),
      items,
    });
  }
  return out;
}

export async function resolveCmsWidgetSlotForRender(
  siteId: number,
  slotKey: 'home.sidebar',
  baseUrl: string,
): Promise<CmsResolvedWidget | null> {
  const [binding] = await db.select().from(cmsWidgetRefs).where(and(
    eq(cmsWidgetRefs.siteId, siteId),
    eq(cmsWidgetRefs.ownerType, 'theme_slot'),
    eq(cmsWidgetRefs.ownerId, siteId),
    eq(cmsWidgetRefs.field, slotKey),
  )).limit(1);
  if (!binding) return null;
  const resolved = await resolveCmsWidgetPlacements(siteId, baseUrl, [{
    key: slotKey,
    widgetId: binding.widgetId,
    rendererKey: rendererKey(binding.rendererKey),
  }]);
  return resolved.get(slotKey) ?? null;
}

export async function getCmsWidgetPreview(id: number, requestedRenderer?: CmsWidgetRendererKey) {
  const row = await ensureCmsWidgetExists(id);
  await assertSiteAccess(row.siteId);
  await assertWidgetSources(db, row.siteId, normalizeWidgetData(row.draftData), false);
  const site = await resolveEffectiveCmsSiteRow(row.siteId);
  const key = requestedRenderer ?? rendererKey(row.defaultRendererKey);
  const resolved = await resolveCmsWidgetPlacements(row.siteId, `/__cms/${site.code}`, [{
    key: 'preview',
    widgetId: id,
    rendererKey: key,
  }], { useDraft: true });
  const maybeWidget = resolved.get('preview');
  const widget = requireRow(maybeWidget, '页面部件预览数据不存在');
  const maybeRenderer = resolveThemeWidgetRenderer(site.theme, widget.type, widget.rendererKey);
  const renderer = requireRow(maybeRenderer, '当前主题不支持所选展示模板', 400);
  const { renderCmsWidgetThemePreview } = await import('./cms-render.service');
  return {
    siteId: row.siteId,
    widget,
    html: renderCmsWidgetHtml(widget, renderer),
    documentHtml: await renderCmsWidgetThemePreview(site, widget),
    renderers: listThemeWidgetRenderers(site.theme, widget.type),
  };
}

export async function listCmsWidgetUsageTargets(widgetIds: number[]) {
  if (widgetIds.length === 0) return { refs: [], pages: [], sites: [] };
  const refs = await db.select().from(cmsWidgetRefs)
    .where(inArray(cmsWidgetRefs.widgetId, [...new Set(widgetIds)]));
  const pageIds = [...new Set(refs.filter((ref) => ref.ownerType === 'page').map((ref) => ref.ownerId))];
  const siteIds = [...new Set([
    ...refs.map((ref) => ref.siteId),
    ...refs.filter((ref) => ref.ownerType === 'theme_slot').map((ref) => ref.ownerId),
  ])];
  const [pages, sites] = await Promise.all([
    pageIds.length
      ? db.select().from(cmsPages).where(inArray(cmsPages.id, pageIds))
      : [],
    siteIds.length
      ? db.select().from(cmsSites).where(inArray(cmsSites.id, siteIds))
      : [],
  ]);
  return { refs, pages, sites };
}

export function isCmsWidgetRefOwnerType(value: string): value is CmsWidgetRefOwnerType {
  return value === 'page' || value === 'theme_slot';
}
