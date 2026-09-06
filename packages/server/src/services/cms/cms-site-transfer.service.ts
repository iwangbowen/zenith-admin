import { requireRow } from '../../lib/db-assert';
import { eq, and, isNull, inArray, or, sql } from 'drizzle-orm';
import { HTTPException } from 'hono/http-exception';
import { db } from '../../db';
import {
  cmsSites, cmsChannels, cmsContents, cmsTags, cmsContentTags, cmsContentChannels, cmsContentRelations,
  cmsFriendLinkGroups, cmsFriendLinks, cmsRedirects, cmsLinkWords, cmsAdSlots, cmsAds, cmsForms, cmsPages,
  cmsResourceFolders, cmsResources,
  cmsModels, cmsModelFields,
  cmsInteractions, cmsInteractionQuestions,
  cmsSiteInheritances, cmsSiteUsers, cmsChannelUsers,
  cmsWidgetRefs, cmsWidgets,
} from '../../db/schema';
import { formatDateTime, parseDateTimeInput } from '../../lib/datetime';
import { contentSearchVector } from './cms-search.service';
import { ensureCmsSiteExists, assertSiteAccess, invalidateSiteCache } from './cms-sites.service';
import { isCmsPlatformAdmin } from './cms-access';
import { normalizeNewCmsSiteSettings, redactCmsSiteSettings } from './cms-site-settings';
import { sanitizeCmsHtml } from './cms-html-sanitizer';
import { CMS_SECRET_MASK, cmsPagePathSchema, cmsSlugRegex, cmsStaticPathSchema, cmsWidgetDataSchema, createCmsFormSchema, createCmsInteractionSchema, isValidCmsAssetUrl, isValidCmsLink, parseCmsLink, remapCmsEntityLink } from '@zenith/shared/cms';
import type { CmsPageBlock, CmsWidgetData } from '@zenith/shared/cms';
import { parseCmsImportSiteCode } from './cms-import-security';
import { currentUser } from '../../lib/context';
import { assertAllCmsSiteChannelsAccess } from './cms-channels.service';
import { cmsPageRequiresDynamic, sanitizeCmsPageBlocks } from './cms-page-blocks';
import { CMS_IMPORTED_CONTENT_LIFECYCLE } from './cms-publish-permission';
import { normalizeCmsFormFields, type FormFieldInput } from './cms-forms.service';
import { extractCmsResourceIds, remapCmsResourceUris } from '../../lib/cms-resource-uri';
import { assertSafeCmsResourceUrl, canonicalizeCmsResourceContent, syncCmsResourceRefs } from './cms-resource-refs.service';
import { detectContentFlags } from './cms-contents-write.service';
import { syncCmsPageWidgetRefs } from './cms-widgets.service';
import { assertTrustedRedirectTarget, invalidateRedirectCache } from './cms-redirects.service';
import { invalidateLinkWordCache } from './cms-link-words.service';
import { enqueueCmsPublishOutboxes, insertCmsSiteRefsRebuildOutbox } from './cms-publish-outbox.service';
import { isThemeRegistered } from '../../cms/themes/registry';
import { assertSiteTemplateSettings, assertSiteThemeConfig, assertTemplateName } from './cms-template-refs.service';

/**
 * 站点导入导出（P5 企业级治理）：整站结构与内容打包为 JSON，用于备份迁移 / 环境同步。
 * 覆盖范围：站点配置、栏目树、标签、素材库（文件夹 + 素材登记）、内容（含附加栏目/相关文章/标签关联）、
 * 友情链接、重定向、内链词、广告位+广告、自定义表单定义、搭建页面。
 * 不含运行数据（访问/搜索日志、互动记录、评论、表单提交、版本历史、操作日志、用户绑定）。
 *
 * 素材以 `cms-res://{id}` 句柄内嵌在正文与 JSONB 中，因此导入时必须先建素材、拿到 id 映射，
 * 再把所有句柄改写为新站 id，否则导入站点会跨站引用来源站素材（来源站删除即断链）。
 */

export const CMS_SITE_EXPORT_VERSION = 2;

/** 导出时统一剔除的列（导入侧由数据库默认值/当前用户重新生成） */
const OMIT_COMMON = new Set(['createdBy', 'updatedBy', 'createdAt', 'updatedAt']);

type PlainRow = Record<string, unknown>;

function exportRow(row: PlainRow, omit: string[] = []): PlainRow {
  const omitSet = new Set(omit);
  const out: PlainRow = {};
  for (const [key, value] of Object.entries(row)) {
    if (OMIT_COMMON.has(key) || omitSet.has(key)) continue;
    out[key] = value instanceof Date ? formatDateTime(value) : value;
  }
  return out;
}

// ─── 导出 ─────────────────────────────────────────────────────────────────────

export async function exportCmsSite(siteId: number) {
  await assertSiteAccess(siteId);
  await assertAllCmsSiteChannelsAccess(siteId);
  const site = await ensureCmsSiteExists(siteId);

  const [channels, tags, contents, friendLinkGroups, friendLinks, redirects, linkWords, adSlots, forms, interactions, pages, widgets, widgetSlots, resourceFolders, resources, models] = await Promise.all([
    db.select().from(cmsChannels).where(eq(cmsChannels.siteId, siteId)),
    db.select().from(cmsTags).where(eq(cmsTags.siteId, siteId)),
    // 回收站内容不导出；归档内容保留
    db.select().from(cmsContents).where(and(eq(cmsContents.siteId, siteId), isNull(cmsContents.deletedAt))),
    db.select().from(cmsFriendLinkGroups).where(eq(cmsFriendLinkGroups.siteId, siteId)),
    db.select().from(cmsFriendLinks).where(eq(cmsFriendLinks.siteId, siteId)),
    db.select().from(cmsRedirects).where(eq(cmsRedirects.siteId, siteId)),
    db.select().from(cmsLinkWords).where(eq(cmsLinkWords.siteId, siteId)),
    db.select().from(cmsAdSlots).where(eq(cmsAdSlots.siteId, siteId)),
    db.select().from(cmsForms).where(eq(cmsForms.siteId, siteId)),
    db.select().from(cmsInteractions).where(eq(cmsInteractions.siteId, siteId)),
    db.select().from(cmsPages).where(eq(cmsPages.siteId, siteId)),
    db.select().from(cmsWidgets).where(eq(cmsWidgets.siteId, siteId)),
    db.select().from(cmsWidgetRefs).where(and(
      eq(cmsWidgetRefs.siteId, siteId),
      eq(cmsWidgetRefs.ownerType, 'theme_slot'),
    )),
    db.select().from(cmsResourceFolders).where(eq(cmsResourceFolders.siteId, siteId)),
    db.select().from(cmsResources).where(eq(cmsResources.siteId, siteId)),
    // 包含本站专属模型及所有平台共享模型，导入时按稳定 code 重建/映射。
    db.select().from(cmsModels).where(or(isNull(cmsModels.ownerSiteId), eq(cmsModels.ownerSiteId, siteId))),
  ]);

  const modelFields = models.length > 0
    ? await db.select().from(cmsModelFields).where(inArray(cmsModelFields.modelId, models.map((model) => model.id)))
    : [];
  const interactionQuestions = interactions.length > 0
    ? await db.select().from(cmsInteractionQuestions).where(inArray(cmsInteractionQuestions.interactionId, interactions.map((interaction) => interaction.id)))
    : [];

  const contentIds = contents.map((c) => c.id);
  const slotIds = adSlots.map((s) => s.id);
  const [contentTags, contentChannels, contentRelations, ads] = await Promise.all([
    contentIds.length > 0 ? db.select().from(cmsContentTags).where(inArray(cmsContentTags.contentId, contentIds)) : Promise.resolve([]),
    contentIds.length > 0 ? db.select().from(cmsContentChannels).where(inArray(cmsContentChannels.contentId, contentIds)) : Promise.resolve([]),
    contentIds.length > 0 ? db.select().from(cmsContentRelations).where(inArray(cmsContentRelations.contentId, contentIds)) : Promise.resolve([]),
    slotIds.length > 0 ? db.select().from(cmsAds).where(inArray(cmsAds.slotId, slotIds)) : Promise.resolve([]),
  ]);

  // 映射内容：正文/扩展字段透传来源行，导出时物化为独立内容（跨环境不携带映射关系）
  const contentById = new Map(contents.map((c) => [c.id, c]));
  const exportedContents = await Promise.all(contents.map(async (c) => {
    let { body, extend } = c;
    if (c.mappingSourceId) {
      const source = contentById.get(c.mappingSourceId)
        ?? await db.query.cmsContents.findFirst({
          where: and(eq(cmsContents.id, c.mappingSourceId), eq(cmsContents.siteId, siteId)),
        });
      if (!source) {
        throw new HTTPException(400, { message: `映射内容 #${c.mappingSourceId} 不属于导出站点，无法安全物化` });
      }
      body = source.body;
      extend = source.extend;
    }
    return exportRow({ ...c, body, extend }, [
      'siteId', 'searchVector', 'viewCount', 'likeCount', 'favoriteCount', 'version',
      'deletedAt', 'mappingSourceId', 'distributionRuleId', 'distributionSourceId',
      'distributionSourceVersion', 'memberId', 'deptId', 'rejectReason',
    ]);
  }));

  return {
    version: CMS_SITE_EXPORT_VERSION,
    exportedAt: formatDateTime(new Date()),
    site: exportRow({ ...site, settings: redactCmsSiteSettings(site.settings) }, [
      'id', 'parentId', 'isDefault', 'domain', 'aliasDomains',
      'themeRevision', 'templateRefsRevision', 'publicRevision',
    ]),
    resourceFolders: resourceFolders.map((r) => exportRow(r, ['siteId'])),
    resources: resources.map((r) => exportRow(r, ['siteId'])),
    // Source IDs are package-local mapping keys, never inserted into the
    // destination database; retaining them is required to rebuild bindings.
    models: models.map((r) => exportRow(r)),
    modelFields: modelFields.map((r) => exportRow(r)),
    channels: channels.map((r) => exportRow(r, ['siteId'])),
    tags: tags.map((r) => exportRow(r, ['siteId', 'contentCount'])),
    contents: exportedContents,
    contentTags: contentTags.map((r) => ({ contentId: r.contentId, tagId: r.tagId })),
    contentChannels: contentChannels.map((r) => ({ contentId: r.contentId, channelId: r.channelId })),
    contentRelations: contentRelations.map((r) => ({ contentId: r.contentId, relatedId: r.relatedId, sort: r.sort })),
    friendLinkGroups: friendLinkGroups.map((r) => exportRow(r, ['siteId'])),
    friendLinks: friendLinks.map((r) => exportRow(r, ['id', 'siteId'])),
    redirects: redirects.map((r) => exportRow(r, ['id', 'siteId'])),
    linkWords: linkWords.map((r) => exportRow(r, ['id', 'siteId'])),
    adSlots: adSlots.map((r) => exportRow(r, ['siteId'])),
    ads: ads.map((r) => exportRow(r, ['id', 'clickCount', 'viewCount'])),
    forms: forms.map((r) => exportRow({
      ...r,
      turnstileSecret: r.turnstileSecret ? CMS_SECRET_MASK : null,
    }, ['id', 'siteId'])),
    interactions: interactions.map((r) => exportRow({ ...r, turnstileSecret: r.turnstileSecret ? CMS_SECRET_MASK : null }, ['siteId', 'responseCount'])),
    interactionQuestions: interactionQuestions.map((r) => exportRow(r, ['id'])),
    // The imported site starts without a home takeover, so preserving the
    // source flag is safe and keeps the transfer round-trip semantically exact.
    pages: pages.map((r) => exportRow(r, ['id', 'siteId'])),
    widgets: widgets.map((r) => exportRow(r, ['siteId'])),
    widgetSlots: widgetSlots.map((r) => exportRow(r, ['id', 'siteId', 'ownerType', 'ownerId'])),
  };
}

export type CmsSiteExportPackage = Awaited<ReturnType<typeof exportCmsSite>>;

// ─── 导入 ─────────────────────────────────────────────────────────────────────

/** 站点 code 冲突时自动追加序号找空位 */
async function resolveSiteCode(code: string): Promise<string> {
  parseCmsImportSiteCode(code);
  const base = String(code || 'imported-site').slice(0, 44);
  for (let i = 0; i < 100; i++) {
    const candidate = i === 0 ? base : `${base}-${i + 1}`;
    const exists = await db.query.cmsSites.findFirst({ where: eq(cmsSites.code, candidate), columns: { id: true } });
    if (!exists) return candidate;
  }
  throw new HTTPException(400, { message: '无法为导入站点分配唯一标识，请修改导出包中的站点 code' });
}

function num(v: unknown): number | null {
  return typeof v === 'number' && Number.isSafeInteger(v) ? v : null;
}
function str(v: unknown): string | null {
  return typeof v === 'string' ? v : null;
}

function requireSourceId(value: unknown, label: string, seen: Set<number>): number {
  const id = num(value);
  if (id == null || id <= 0 || seen.has(id)) {
    throw new HTTPException(400, { message: `${label}必须是包内唯一的正整数` });
  }
  seen.add(id);
  return id;
}

function requireMappedId(map: ReadonlyMap<number, number>, value: unknown, label: string): number {
  const sourceId = num(value);
  const targetId = sourceId == null ? undefined : map.get(sourceId);
  if (!targetId) throw new HTTPException(400, { message: `${label}未随导入包提供` });
  return targetId;
}

function importedRecord(value: unknown, label: string): Record<string, unknown> {
  if (value == null) return {};
  if (typeof value !== 'object' || Array.isArray(value)) {
    throw new HTTPException(400, { message: `${label}必须是对象` });
  }
  return value as Record<string, unknown>;
}

function importedSiteSettings(value: unknown): Record<string, unknown> {
  const settings = normalizeNewCmsSiteSettings(importedRecord(value, '站点设置'));
  for (const key of [
    'analyticsSiteKey', 'webhookUrl', 'webhookSecret', 'cdnPurgeUrl', 'cdnPurgeToken',
    'indexNowKey', 'baiduPushToken', 'turnstileSecret',
  ]) delete settings[key];
  return settings;
}

function remapModelCodesInSettings(settings: Record<string, unknown>, modelCodeMap: ReadonlyMap<string, string>): Record<string, unknown> {
  const cloned = structuredClone(settings);
  for (const key of ['defaultTemplates', 'templates']) {
    const defaults = cloned[key];
    if (!defaults || typeof defaults !== 'object' || Array.isArray(defaults)) continue;
    const byModel = (defaults as Record<string, unknown>).detailByModel;
    if (!byModel || typeof byModel !== 'object' || Array.isArray(byModel)) continue;
    (defaults as Record<string, unknown>).detailByModel = Object.fromEntries(Object.entries(byModel as Record<string, unknown>)
      .map(([code, value]) => [modelCodeMap.get(code) ?? code, value]));
  }
  return cloned;
}

function importedAttachments(value: unknown, label: string): Array<{ name: string; url: string; size: number; ext: string; sort: number }> {
  if (value == null) return [];
  if (!Array.isArray(value)) throw new HTTPException(400, { message: `${label}必须是数组` });
  if (value.length > 50) throw new HTTPException(400, { message: `${label}最多 50 项` });
  return value.map((raw, index) => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      throw new HTTPException(400, { message: `${label}[${index}]格式无效` });
    }
    const item = raw as Record<string, unknown>;
    const name = str(item.name)?.trim() ?? '';
    const ext = str(item.ext)?.trim() ?? '';
    const size = num(item.size) ?? 0;
    if (!name || name.length > 200 || ext.length > 20 || size < 0) {
      throw new HTTPException(400, { message: `${label}[${index}]字段超出允许范围` });
    }
    return {
      name,
      url: importedCmsAsset(item.url, `${label}[${index}].url`, true)!,
      size,
      ext,
      sort: num(item.sort) ?? index,
    };
  });
}

function remapImportedWidgetData(
  value: unknown,
  contentIdMap: ReadonlyMap<number, number>,
  channelIdMap: ReadonlyMap<number, number>,
): CmsWidgetData {
  if (value == null) return { items: [] };
  const parsed = cmsWidgetDataSchema.safeParse(value);
  if (!parsed.success) {
    throw new HTTPException(400, { message: '导入页面部件数据格式无效' });
  }
  const remapped = {
    items: parsed.data.items.map((item) => {
     if (item.sourceType === 'manual') return [item];
     const mapped = (item.sourceType === 'content' ? contentIdMap : channelIdMap).get(item.sourceId ?? 0);
     if (!mapped) throw new HTTPException(400, { message: `页面部件条目 ${item.id} 的来源未随包提供` });
     return [{ ...item, sourceId: mapped }];
   }).flat(),
 };
  return remapImportedEntityLinks(remapped, contentIdMap, channelIdMap);
}

function remapImportedWidgetBlocks(
  value: unknown,
  widgetIdMap: ReadonlyMap<number, number>,
  channelIdMap: ReadonlyMap<number, number>,
): CmsPageBlock[] {
  if (value == null) return [];
  if (!Array.isArray(value)) {
    throw new HTTPException(400, { message: '导入页面区块必须是数组' });
  }
  const blocks = value.flatMap((raw) => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return [raw];
    const block = raw as Record<string, unknown>;
    if (block.type !== 'widget-ref' && block.type !== 'content-list') return [raw];
    const props = block.props && typeof block.props === 'object' && !Array.isArray(block.props)
      ? block.props as Record<string, unknown>
      : {};
    if (block.type === 'widget-ref') {
      const mapped = widgetIdMap.get(Number(props.widgetId));
      if (!mapped) throw new HTTPException(400, { message: `页面区块 ${String(block.id)} 引用的部件未随包提供` });
      return [{ ...block, props: { ...props, widgetId: mapped } }];
    }
    // content-list blocks may still carry a numeric channelId.  Keep the block
    // only when the referenced channel was imported; an invalid reference must
    // not silently point at an unrelated channel in the destination site.
    if (props.channelId == null || props.channelId === '') return [raw];
    const mappedChannel = channelIdMap.get(Number(props.channelId));
    if (!mappedChannel) throw new HTTPException(400, { message: `页面区块 ${String(block.id)} 引用的栏目未随包提供` });
    return [{ ...block, props: { ...props, channelId: mappedChannel } }];
  });
  return sanitizeCmsPageBlocks(blocks);
}

function requireCmsSlug(value: unknown, label: string, maxLength = 100): string {
  const slug = str(value);
  if (!slug || slug.length > maxLength || !cmsSlugRegex.test(slug)) {
    throw new HTTPException(400, { message: `${label}格式无效，仅允许小写字母、数字或中划线` });
  }
  return slug;
}

function requireCmsFieldName(value: unknown, label: string): string {
  const name = str(value);
  if (!name || name.length > 50 || !/^[a-z][a-z0-9_]*$/.test(name)) {
    throw new HTTPException(400, { message: `${label}格式无效，仅允许小写字母、数字和下划线` });
  }
  return name;
}

function importedPagePath(value: unknown, label: string): string | null {
  const parsed = cmsPagePathSchema.safeParse(value == null ? null : String(value));
  if (!parsed.success) throw new HTTPException(400, { message: `${label}格式无效` });
  return parsed.data ?? null;
}

function importedStaticPath(value: unknown, label: string): string | null {
  const parsed = cmsStaticPathSchema.safeParse(value == null ? null : String(value));
  if (!parsed.success) throw new HTTPException(400, { message: `${label}格式无效，仅允许安全的 .html 路径` });
  return parsed.data ?? null;
}

function importedCmsLink(value: unknown, label: string, required = false): string | null {
  const link = str(value)?.trim() ?? '';
  if (!link) {
    if (required) throw new HTTPException(400, { message: `${label}不能为空` });
    return null;
  }
  // Resource handles are valid only in asset fields, never in href-like links.
 if (/^cms-res:\/\/\d+$/.test(link)) throw new HTTPException(400, { message: '链接不能使用素材句柄' });
  if (!isValidCmsLink(link)) {
    throw new HTTPException(400, { message: `${label}格式无效` });
  }
  return link;
}

function importedCmsAsset(value: unknown, label: string, required = false): string | null {
  const asset = str(value)?.trim() ?? '';
  if (!asset) {
    if (required) throw new HTTPException(400, { message: `${label}不能为空` });
    return null;
  }
  if (!isValidCmsAssetUrl(asset)) throw new HTTPException(400, { message: `${label}格式无效` });
  return asset;
}

/** 迁移包中的实体链接只允许引用本包内的新 ID；递归处理 extend、区块和部件等 JSONB。 */
function remapImportedEntityLinks<T>(value: T, contentIdMap: ReadonlyMap<number, number>, channelIdMap: ReadonlyMap<number, number>): T {
  const remapString = (raw: string): string => {
    const trimmed = raw.trim();
    if (!trimmed.startsWith('entity:')) return raw;
    const parsed = parseCmsLink(trimmed);
    if (!parsed || parsed.kind !== 'entity') {
      throw new HTTPException(400, { message: `导入实体链接格式无效：${trimmed}` });
    }
    const remapped = remapCmsEntityLink(trimmed, (entityType, id) =>
      (entityType === 'content' ? contentIdMap : channelIdMap).get(id));
    if (remapped == null) {
      throw new HTTPException(400, { message: `导入实体链接目标未随包提供：${trimmed}` });
    }
    return remapped;
  };
  const walk = (input: unknown): unknown => {
    if (typeof input === 'string') return remapString(input);
    if (Array.isArray(input)) return input.map(walk);
    if (input != null && typeof input === 'object' && (input as object).constructor === Object) {
      return Object.fromEntries(Object.entries(input as Record<string, unknown>).map(([key, item]) => [key, walk(item)]));
    }
    return input;
  };
  return walk(value) as T;
}

function importedMediaData(value: unknown, label: string): Record<string, unknown> {
  if (value == null) return {};
  if (typeof value !== 'object' || Array.isArray(value)) throw new HTTPException(400, { message: `${label}必须是对象` });
  const media = structuredClone(value as Record<string, unknown>);
  if (media.images !== undefined && !Array.isArray(media.images)) throw new HTTPException(400, { message: `${label}.images 必须是数组` });
  const imageList = Array.isArray(media.images) ? media.images : [];
  if (imageList.length > 100) throw new HTTPException(400, { message: `${label}.images 最多 100 项` });
  for (const [index, item] of imageList.entries()) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) throw new HTTPException(400, { message: `${label}.images[${index}] 格式无效` });
    const image = item as Record<string, unknown>;
    image.url = importedCmsAsset(image.url, `${label}.images[${index}].url`, true);
    image.thumb = importedCmsAsset(image.thumb, `${label}.images[${index}].thumb`);
  }
  media.images = imageList;
  media.mediaUrl = importedCmsAsset(media.mediaUrl, `${label}.mediaUrl`);
  media.poster = importedCmsAsset(media.poster, `${label}.poster`);
  if (media.mediaType !== undefined && !['video', 'audio'].includes(String(media.mediaType))) throw new HTTPException(400, { message: `${label}.mediaType 格式无效` });
  if (typeof media.duration === 'string' && media.duration.length > 20) throw new HTTPException(400, { message: `${label}.duration 过长` });
  return media;
}

function importedMediaSearchTexts(media: Record<string, unknown>): string[] {
  if (!Array.isArray(media.images)) return [];
  return media.images.flatMap((item) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return [];
    const caption = (item as Record<string, unknown>).caption;
    return typeof caption === 'string' && caption.trim() ? [caption] : [];
  });
}

const CMS_MODEL_FIELD_TYPES = new Set(['text', 'textarea', 'richtext', 'number', 'date', 'datetime', 'image', 'file', 'select', 'radio', 'checkbox', 'switch']);
const CMS_MODEL_OPTION_SOURCES = new Set(['manual', 'dict']);

function modelFieldType(value: unknown): 'text' | 'textarea' | 'richtext' | 'number' | 'date' | 'datetime' | 'image' | 'file' | 'select' | 'radio' | 'checkbox' | 'switch' {
  const candidate = str(value);
  if (!candidate || !CMS_MODEL_FIELD_TYPES.has(candidate)) throw new HTTPException(400, { message: `模型字段类型无效：${String(value)}` });
  return candidate as ReturnType<typeof modelFieldType>;
}

function modelOptionSource(value: unknown): 'manual' | 'dict' {
  const candidate = str(value);
  if (!candidate || !CMS_MODEL_OPTION_SOURCES.has(candidate)) throw new HTTPException(400, { message: `模型字段选项来源无效：${String(value)}` });
  return candidate as 'manual' | 'dict';
}

function modelOptions(
  value: unknown,
  optionSource: 'manual' | 'dict',
  fieldType: string,
  label: string,
): { label: string; value: string }[] | null {
  if (value == null) return null;
  if (!Array.isArray(value) || value.length > 500) {
    throw new HTTPException(400, { message: label + ' options 必须是最多 500 项的数组' });
  }
  if (optionSource === 'dict' && value.length > 0) {
    throw new HTTPException(400, { message: label + ' 使用字典时不能同时提供手工 options' });
  }
  if (!['select', 'radio', 'checkbox'].includes(fieldType) && value.length > 0) {
    throw new HTTPException(400, { message: label + ' 类型不支持 options' });
  }
  const seen = new Set<string>();
  return value.map((item, optionIndex) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      throw new HTTPException(400, { message: label + ' options[' + optionIndex + '] 格式无效' });
    }
    const row = item as Record<string, unknown>;
    const optionLabel = str(row.label)?.trim();
    const optionValue = str(row.value)?.trim();
    if (!optionLabel || !optionValue || optionLabel.length > 100 || optionValue.length > 100 || seen.has(optionValue)) {
      throw new HTTPException(400, { message: label + ' options[' + optionIndex + '] 内容无效或重复' });
    }
    seen.add(optionValue);
    return { label: optionLabel, value: optionValue };
  });
}

function importedModelFieldDefinition(field: PlainRow, index: number, modelCode: string) {
  const optionSource = modelOptionSource(field.optionSource);
  const fieldType = modelFieldType(field.fieldType ?? 'text');
  const dictCode = str(field.dictCode);
  if (optionSource === 'dict' && !dictCode) throw new HTTPException(400, { message: `模型「${modelCode}」字典字段缺少 dictCode` });
  return {
    name: requireCmsFieldName(field.name, `模型「${modelCode}」字段标识`),
    label: str(field.label) ?? str(field.name) ?? `字段${index + 1}`,
    fieldType,
    required: field.required === true,
    searchable: field.searchable === true,
    showInList: field.showInList === true,
    showInDetail: field.showInDetail === true,
    detailGroup: str(field.detailGroup),
    detailSort: num(field.detailSort) ?? index,
    placeholder: str(field.placeholder),
    defaultValue: str(field.defaultValue),
    optionSource,
    dictCode,
    options: modelOptions(field.options, optionSource, fieldType, '模型字段 ' + String(field.name)),
    sort: num(field.sort) ?? index,
  };
}

/** 导入整站：创建新站点并重映射全部内部引用。返回新站点 id 与各实体导入数量 */
export async function importCmsSite(payload: unknown) {
  const pkg = payload as Partial<CmsSiteExportPackage> | null;
  if (!pkg || typeof pkg !== 'object' || Number(pkg.version) !== CMS_SITE_EXPORT_VERSION || !pkg.site || typeof pkg.site !== 'object') {
    throw new HTTPException(400, { message: '导入文件格式不正确或版本不兼容' });
  }
  const packageArrays = [
    'resourceFolders', 'resources', 'models', 'modelFields', 'channels', 'tags', 'contents',
    'contentTags', 'contentChannels', 'contentRelations', 'friendLinkGroups', 'friendLinks',
    'redirects', 'linkWords', 'adSlots', 'ads', 'forms', 'interactions', 'interactionQuestions',
    'pages', 'widgets', 'widgetSlots',
  ] as const;
  const pkgRecord = pkg as unknown as PlainRow;
  for (const key of packageArrays) {
    const value = pkgRecord[key];
    if (value == null) continue;
    if (!Array.isArray(value) || value.length > 100_000 || value.some((row) => !row || typeof row !== 'object' || Array.isArray(row))) {
      throw new HTTPException(400, { message: `导入字段 ${key} 必须是对象数组，且最多 100000 项` });
    }
  }
  const site = pkg.site as PlainRow;
  const code = await resolveSiteCode(parseCmsImportSiteCode(site.code));
  const themeCode = str(site.theme) ?? 'default';
  if (!isThemeRegistered(themeCode)) throw new HTTPException(400, { message: `导入主题「${themeCode}」未注册` });
  const initialSettings = importedSiteSettings(site.settings);
  await assertSiteTemplateSettings(themeCode, initialSettings);
  assertSiteThemeConfig(themeCode, initialSettings);
  const platformAdmin = isCmsPlatformAdmin();
  const creatorId = currentUser().userId;

  const result = await db.transaction(async (tx) => {
    // 1. 站点（域名/默认站标记不迁移，避免与现有站点冲突）
    const [newSite] = await tx.insert(cmsSites).values({
      name: str(site.name) ?? '导入站点',
      code,
      title: str(site.title),
      keywords: str(site.keywords),
      description: str(site.description),
      logo: importedCmsAsset(site.logo, '站点 Logo'),
      favicon: importedCmsAsset(site.favicon, '站点 favicon'),
      icp: str(site.icp),
      copyright: str(site.copyright),
      theme: themeCode,
      modelId: null,
      extend: importedRecord(site.extend, '站点扩展字段'),
      staticMode: (str(site.staticMode) as typeof cmsSites.$inferInsert.staticMode) ?? 'hybrid',
      robots: str(site.robots),
      settings: initialSettings,
      status: (str(site.status) as typeof cmsSites.$inferInsert.status) ?? 'enabled',
      sort: num(site.sort) ?? 0,
      remark: str(site.remark),
    }).returning();
    const siteId = newSite.id;
    await tx.insert(cmsSiteInheritances).values({ siteId });
    if (!platformAdmin) {
      await tx.insert(cmsSiteUsers).values({ siteId, userId: creatorId });
    }

    // 1.5 素材库：必须先于其余实体建好，才能拿到 id 映射把包内 `cms-res://` 句柄改写到新站素材。
    //     句柄不改写的话，导入站点会一直引用来源站的素材行，来源站删除即整站断图。
    const folderIdMap = new Map<number, number>();
    const folderSourceIds = new Set<number>();
    const pendingFolders = [...(pkg.resourceFolders ?? [])] as PlainRow[];
    let folderGuard = pendingFolders.length * 2 + 10;
    while (pendingFolders.length > 0 && folderGuard-- > 0) {
      const idx = pendingFolders.findIndex((f) => {
        const parentId = num(f.parentId);
        return parentId === null || folderIdMap.has(parentId);
      });
      if (idx === -1) break;
      const folder = pendingFolders.splice(idx, 1)[0];
      const oldId = requireSourceId(folder.id, '素材文件夹 id', folderSourceIds);
      const oldParentId = num(folder.parentId);
      const [created] = await tx.insert(cmsResourceFolders).values({
        siteId,
        parentId: oldParentId === null ? null : (folderIdMap.get(oldParentId) ?? null),
        name: str(folder.name) ?? '未命名文件夹',
        sort: num(folder.sort) ?? 0,
      }).returning({ id: cmsResourceFolders.id });
      folderIdMap.set(oldId, created.id);
    }
    if (pendingFolders.length > 0) {
      throw new HTTPException(400, { message: '素材文件夹树包含缺失父节点或循环引用' });
    }

    const resourceIdMap = new Map<number, number>();
    const resourceSourceIds = new Set<number>();
    for (const res of (pkg.resources ?? []) as PlainRow[]) {
      const oldId = requireSourceId(res.id, '素材 id', resourceSourceIds);
      // 导入包是不可信输入（body schema 为 passthrough），素材地址会在读取时被直接拼进
      // 已净化的 HTML，因此必须在此拦住属性逃逸与 javascript: 之类的载荷
      const url = assertSafeCmsResourceUrl(str(res.url), `素材 #${oldId} 地址`);
      if (!url) throw new HTTPException(400, { message: `素材 #${oldId} 缺少有效地址` });
     const oldFolderId = num(res.folderId);
      if (oldFolderId != null && !folderIdMap.has(oldFolderId)) {
        throw new HTTPException(400, { message: `素材 #${oldId} 的文件夹未随包提供` });
      }
     const [created] = await tx.insert(cmsResources).values({
        siteId,
        folderId: oldFolderId === null ? null : (folderIdMap.get(oldFolderId) ?? null),
        type: (str(res.type) as typeof cmsResources.$inferInsert.type) ?? 'other',
        name: str(res.name) ?? '未命名素材',
        url,
        thumbUrl: assertSafeCmsResourceUrl(str(res.thumbUrl), `素材 #${oldId} 缩略图地址`),
        fileId: str(res.fileId),
        // 物理文件仍归导出方所有，导入站只是引用登记：清理本站素材不得删除源文件
        ownsFile: false,
        size: num(res.size) ?? 0,
        width: num(res.width),
        height: num(res.height),
        mimeType: str(res.mimeType),
        remark: str(res.remark),
      }).returning({ id: cmsResources.id });
      resourceIdMap.set(oldId, created.id);
    }

    const missingResourceIds = extractCmsResourceIds(pkg).filter((id) => !resourceIdMap.has(id));
    if (missingResourceIds.length > 0) {
      throw new HTTPException(400, { message: `导入包引用了未提供的素材句柄：${missingResourceIds.slice(0, 10).join(', ')}` });
    }
    // 句柄改写后再处理其余实体；站点自身的 logo/favicon/settings 需要回填一次
    let data = remapCmsResourceUris(pkg, resourceIdMap) as Partial<CmsSiteExportPackage>;
    const remappedSite = (data.site ?? {}) as PlainRow;
    const [siteWithResources] = await tx.update(cmsSites).set({
      logo: importedCmsAsset(remappedSite.logo, '站点 Logo'),
      favicon: importedCmsAsset(remappedSite.favicon, '站点 favicon'),
      extend: importedRecord(remappedSite.extend, '站点扩展字段'),
      settings: importedSiteSettings(remappedSite.settings),
    }).where(eq(cmsSites.id, siteId)).returning();
    await syncCmsResourceRefs(tx, 'site', siteId, siteId, siteWithResources);

    // 1.6 内容模型：按稳定 code 映射平台共享模型，站点专属模型在目标站重建，
    // 并把字段定义一并恢复。模型自增 id 只在本包内部使用，不能跨环境直传。
    const modelIdMap = new Map<number, number>();
    const modelCodeMap = new Map<string, string>();
    const modelSourceIds = new Set<number>();
    for (const rawModel of (data.models ?? []) as PlainRow[]) {
      const oldId = requireSourceId(rawModel.id, '内容模型 id', modelSourceIds);
      const modelCode = requireCmsSlug(rawModel.code, `导入模型 #${oldId} code`, 50);
      const [existing] = await tx.select().from(cmsModels).where(eq(cmsModels.code, modelCode)).limit(1);
      const sourceOwner = num(rawModel.ownerSiteId);
      if (existing && sourceOwner === null && existing.ownerSiteId !== null) {
        throw new HTTPException(400, { message: `模型「${modelCode}」与目标环境中其他作用域的模型冲突` });
      }
      let targetCode = modelCode;
      let targetId = sourceOwner === null || existing?.ownerSiteId === siteId ? existing?.id : undefined;
      if (sourceOwner !== null && existing && existing.ownerSiteId !== siteId) {
        for (let suffix = 0; suffix < 100; suffix += 1) {
          const tail = suffix === 0 ? `-${siteId}` : `-${siteId}-${suffix + 1}`;
          const candidate = `${modelCode.slice(0, 50 - tail.length)}${tail}`;
          const [taken] = await tx.select({ id: cmsModels.id }).from(cmsModels).where(eq(cmsModels.code, candidate)).limit(1);
          if (!taken) { targetCode = candidate; break; }
        }
      }
      const sourceFields = ((data.modelFields ?? []) as PlainRow[]).filter((field) => num(field.modelId) === oldId);
      const sourceDefinitions = sourceFields.map((field, index) => importedModelFieldDefinition(field, index, modelCode));
      if (!targetId) {
        if (rawModel.isSystem === true) {
          throw new HTTPException(400, { message: `系统模型「${modelCode}」在目标环境中不存在` });
        }
        if (sourceOwner === null && !platformAdmin) {
          throw new HTTPException(403, { message: `缺少创建平台共享模型「${modelCode}」的权限` });
        }
        const [createdModel] = await tx.insert(cmsModels).values({
          ownerSiteId: sourceOwner === null ? null : siteId,
          name: str(rawModel.name) ?? modelCode,
          code: targetCode,
          description: str(rawModel.description),
          isSystem: false,
          status: (str(rawModel.status) as typeof cmsModels.$inferInsert.status) ?? 'enabled',
          sort: num(rawModel.sort) ?? 0,
        }).returning({ id: cmsModels.id });
        targetId = createdModel.id;
        if (sourceDefinitions.length > 0) {
          await tx.insert(cmsModelFields).values(sourceDefinitions.map((definition) => ({ modelId: targetId!, ...definition })));
        }
      } else {
        const targetFields = await tx.select().from(cmsModelFields).where(eq(cmsModelFields.modelId, targetId));
        const targetDefinitions = targetFields
          .map((field, index) => importedModelFieldDefinition(field as unknown as PlainRow, index, modelCode))
          .sort((a, b) => a.name.localeCompare(b.name));
        const expectedDefinitions = [...sourceDefinitions].sort((a, b) => a.name.localeCompare(b.name));
        if (JSON.stringify(targetDefinitions) !== JSON.stringify(expectedDefinitions)) {
          throw new HTTPException(400, { message: `共享模型「${modelCode}」在目标环境中的字段定义不一致` });
        }
      }
      if (!targetId) throw new HTTPException(400, { message: `模型「${modelCode}」导入失败` });
      modelIdMap.set(oldId, targetId);
      modelCodeMap.set(modelCode, targetCode);
    }
    const sourceSiteModelId = num(site.modelId);
    const targetSiteModelId = sourceSiteModelId == null ? null : requireMappedId(modelIdMap, sourceSiteModelId, '站点模型');
    if (targetSiteModelId != null) {
      await tx.update(cmsSites).set({ modelId: targetSiteModelId }).where(eq(cmsSites.id, siteId));
    }
    const searchableFieldNamesByModel = new Map<number, string[]>();
    for (const field of (data.modelFields ?? []) as PlainRow[]) {
      const sourceModelId = num(field.modelId);
      const name = str(field.name);
      if (sourceModelId == null || !name || field.searchable !== true) continue;
      searchableFieldNamesByModel.set(sourceModelId, [...(searchableFieldNamesByModel.get(sourceModelId) ?? []), name]);
    }

    // 2. 栏目树：先父后子逐层插入，重映射 id/parentId
    const channelIdMap = new Map<number, number>();
    const channelPathMap = new Map<number, string>();
    const usedChannelCodes = new Set<string>();
    const channelSourceIds = new Set<number>();
    const pendingChannels = [...(data.channels ?? [])] as PlainRow[];
    let guard = pendingChannels.length * 2 + 10;
    while (pendingChannels.length > 0 && guard-- > 0) {
      const idx = pendingChannels.findIndex((ch) => {
        const parentId = num(ch.parentId) ?? 0;
        return parentId === 0 || channelIdMap.has(parentId);
      });
      if (idx === -1) break;
      const ch = pendingChannels.splice(idx, 1)[0];
      const oldId = requireSourceId(ch.id, '栏目 id', channelSourceIds);
      const oldParentId = num(ch.parentId) ?? 0;
      const slug = requireCmsSlug(ch.slug, `栏目 #${oldId} slug`);
      // code-based entity links are kept verbatim during remapping. A
      // duplicate therefore cannot be auto-renamed without changing meaning;
      // reject the package instead of creating an ambiguous route.
      const code = requireCmsSlug(str(ch.code) ?? slug, `栏目 #${oldId} code`, 50);
      if (usedChannelCodes.has(code)) {
        throw new HTTPException(400, { message: `导入栏目 code 重复：${code}` });
      }
      usedChannelCodes.add(code);
      const parentPath = oldParentId === 0 ? '' : channelPathMap.get(oldParentId);
      if (oldParentId !== 0 && !parentPath) throw new HTTPException(400, { message: `栏目 #${oldId} 的父栏目不存在` });
      const channelPath = parentPath ? `${parentPath}/${slug}` : slug;
      if (channelPath.length > 255) throw new HTTPException(400, { message: `栏目 #${oldId} 完整路径超过 255 字符` });
      assertTemplateName(themeCode, 'list', str(ch.listTemplate), `栏目 #${oldId} 列表模板`);
      assertTemplateName(themeCode, 'detail', str(ch.detailTemplate), `栏目 #${oldId} 详情模板`);
      const [created] = await tx.insert(cmsChannels).values({
        siteId,
        parentId: channelIdMap.get(oldParentId) ?? 0,
        modelId: num(ch.modelId) == null ? null : requireMappedId(modelIdMap, ch.modelId, `栏目 #${oldId} 模型`),
        name: str(ch.name) ?? '未命名栏目',
        code,
        slug,
        path: channelPath,
        type: (str(ch.type) as typeof cmsChannels.$inferInsert.type) ?? 'list',
        linkUrl: importedCmsLink(ch.linkUrl, `栏目 #${oldId} 链接`),
        listTemplate: str(ch.listTemplate),
        detailTemplate: str(ch.detailTemplate),
        staticMode: (str(ch.staticMode) as typeof cmsChannels.$inferInsert.staticMode) ?? 'inherit',
        detailPathRule: (str(ch.detailPathRule) as typeof cmsChannels.$inferInsert.detailPathRule) ?? 'none',
        pageSize: num(ch.pageSize) ?? 20,
        pageContent: sanitizeCmsHtml(str(ch.pageContent)),
        seoTitle: str(ch.seoTitle),
        seoKeywords: str(ch.seoKeywords),
        seoDescription: str(ch.seoDescription),
        image: importedCmsAsset(ch.image, `栏目 #${oldId} 图片`),
        visible: ch.visible !== false,
        status: (str(ch.status) as typeof cmsChannels.$inferInsert.status) ?? 'enabled',
        sort: num(ch.sort) ?? 0,
        settings: importedRecord(ch.settings, `栏目 #${oldId} 设置`),
      }).returning({ id: cmsChannels.id });
      channelIdMap.set(oldId, created.id);
      channelPathMap.set(oldId, channelPath);
      await syncCmsResourceRefs(tx, 'channel', created.id, siteId, {
        image: importedCmsAsset(ch.image, `栏目 #${oldId} 图片`),
        pageContent: sanitizeCmsHtml(str(ch.pageContent)),
        settings: importedRecord(ch.settings, `栏目 #${oldId} 设置`),
        linkUrl: importedCmsLink(ch.linkUrl, `栏目 #${oldId} 链接`),
      });
      if (!platformAdmin) {
        await tx.insert(cmsChannelUsers).values({
          channelId: created.id,
          userId: creatorId,
        });
      }
    }
    if (pendingChannels.length > 0) {
      throw new HTTPException(400, { message: '导入栏目树包含缺失父节点或循环引用' });
    }

    // 3. 标签
    const tagIdMap = new Map<number, number>();
    const tagSourceIds = new Set<number>();
    for (const tag of (data.tags ?? []) as PlainRow[]) {
      const oldId = requireSourceId(tag.id, '标签 id', tagSourceIds);
      const [created] = await tx.insert(cmsTags).values({
        siteId,
        name: str(tag.name) ?? `tag-${oldId}`,
        slug: requireCmsSlug(tag.slug, `标签 #${oldId} slug`),
        groupName: str(tag.groupName),
      }).returning({ id: cmsTags.id });
      tagIdMap.set(oldId, created.id);
    }

    // 4. 内容（searchVector 重建；发布/排期/归档状态统一降级为草稿）
    const contentIdMap = new Map<number, number>();
    const contentMainChannelById = new Map<number, number>();
    const contentSourceIds = new Set<number>();
    for (const c of (data.contents ?? []) as PlainRow[]) {
      const oldId = requireSourceId(c.id, '内容 id', contentSourceIds);
      const channelId = channelIdMap.get(num(c.channelId) ?? 0);
      if (!channelId) throw new HTTPException(400, { message: `内容 #${oldId} 的主栏目未随包提供` });
      const title = str(c.title) ?? '未命名内容';
      const rawContentSlug = str(c.slug);
      const mediaData = importedMediaData(c.mediaData, `内容 #${oldId} mediaData`);
      const body = sanitizeCmsHtml(str(c.body));
      const extend = importedRecord(c.extend, `内容 #${oldId} 扩展字段`);
      const attachments = importedAttachments(c.attachments, `内容 #${oldId} 附件`);
      const coverImage = importedCmsAsset(c.coverImage, `内容 #${oldId} 封面`);
      const sourceUrl = importedCmsLink(c.sourceUrl, `内容 #${oldId} 来源链接`);
      const externalLink = importedCmsLink(c.externalLink, `内容 #${oldId} 外链`);
      assertTemplateName(themeCode, 'detail', str(c.detailTemplate), `内容 #${oldId} 详情模板`);
      const sourceModelId = num(c.modelId);
      const searchTexts = [
        ...(sourceModelId == null ? [] : (searchableFieldNamesByModel.get(sourceModelId) ?? [])
          .map((name) => extend[name])
          .filter((value): value is string => typeof value === 'string' && value.trim() !== '')),
        ...importedMediaSearchTexts(mediaData),
      ];
      const [created] = await tx.insert(cmsContents).values({
        siteId,
        channelId,
        modelId: num(c.modelId) == null ? null : requireMappedId(modelIdMap, c.modelId, `内容 #${oldId} 模型`),
        contentType: (str(c.contentType) as typeof cmsContents.$inferInsert.contentType) ?? 'article',
        mediaData,
        title,
        titleStyle: (c.titleStyle && typeof c.titleStyle === 'object' && !Array.isArray(c.titleStyle)
          ? c.titleStyle : {}) as typeof cmsContents.$inferInsert.titleStyle,
        subTitle: str(c.subTitle),
        shortTitle: str(c.shortTitle),
        slug: rawContentSlug ? requireCmsSlug(rawContentSlug, `内容 #${oldId} slug`, 255) : null,
        summary: str(c.summary),
        coverImage,
        author: str(c.author),
        editor: str(c.editor),
        source: str(c.source),
        sourceUrl,
        isOriginal: c.isOriginal === true,
        body,
        attachments: attachments as typeof cmsContents.$inferInsert.attachments,
        extend,
        externalLink,
        detailTemplate: str(c.detailTemplate),
        staticPath: importedStaticPath(c.staticPath, `内容 #${oldId} staticPath`),
        isTop: c.isTop === true,
        topWeight: num(c.topWeight) ?? 0,
        topExpireAt: parseDateTimeInput(str(c.topExpireAt) ?? undefined),
        isRecommend: c.isRecommend === true,
        isHot: c.isHot === true,
        ...detectContentFlags({
          contentType: (str(c.contentType) as typeof cmsContents.$inferInsert.contentType) ?? 'article',
          body,
          mediaData,
          coverImage,
          attachments,
        }),
        ...CMS_IMPORTED_CONTENT_LIFECYCLE,
        expireAt: parseDateTimeInput(str(c.expireAt) ?? undefined),
        sort: num(c.sort) ?? 0,
        seoTitle: str(c.seoTitle),
        seoKeywords: str(c.seoKeywords),
        seoDescription: str(c.seoDescription),
        socialImageAlt: str(c.socialImageAlt),
        twitterCreator: str(c.twitterCreator),
        searchVector: contentSearchVector(siteId, {
          title,
          seoKeywords: str(c.seoKeywords),
          summary: str(c.summary),
          body,
        }, searchTexts),
      }).returning({ id: cmsContents.id });
      contentIdMap.set(oldId, created.id);
      contentMainChannelById.set(created.id, channelId);
      await syncCmsResourceRefs(tx, 'content', created.id, siteId, {
        coverImage,
        body,
        mediaData,
        extend,
        attachments,
        externalLink,
        sourceUrl,
      });
    }

    // Both maps are complete now. Remap exact entity-link leaves throughout
    // the package so nested extend/theme/widget/page data cannot retain a
    // source-site numeric ID.
    data = remapImportedEntityLinks(data, contentIdMap, channelIdMap) as Partial<CmsSiteExportPackage>;

    // Channels and contents were inserted before their maps existed. Apply
    // the remapped scalar/JSON fields back to those rows and rebuild resource
    // refs from the actual persisted values.
    const remappedSiteAfterEntities = (data.site ?? {}) as PlainRow;
    await tx.update(cmsSites).set({
      logo: importedCmsAsset(remappedSiteAfterEntities.logo, '站点 Logo'),
      favicon: importedCmsAsset(remappedSiteAfterEntities.favicon, '站点 favicon'),
      extend: importedRecord(remappedSiteAfterEntities.extend, '站点扩展字段'),
      settings: remapModelCodesInSettings(importedSiteSettings(remappedSiteAfterEntities.settings), modelCodeMap),
    }).where(eq(cmsSites.id, siteId));
    const remappedChannelRows = (data.channels ?? []) as PlainRow[];
    for (const channel of remappedChannelRows) {
      const newId = channelIdMap.get(num(channel.id) ?? 0);
      if (!newId) continue;
      const [updated] = await tx.update(cmsChannels).set({
        linkUrl: importedCmsLink(channel.linkUrl, `栏目 #${num(channel.id)} 链接`),
        image: importedCmsAsset(channel.image, `栏目 #${num(channel.id)} 图片`),
        pageContent: sanitizeCmsHtml(str(channel.pageContent)),
        settings: remapModelCodesInSettings(importedRecord(channel.settings, `栏目 #${num(channel.id)} 设置`), modelCodeMap),
      }).where(eq(cmsChannels.id, newId)).returning();
      if (updated) await syncCmsResourceRefs(tx, 'channel', updated.id, siteId, updated);
    }
    const remappedContentRows = (data.contents ?? []) as PlainRow[];
    for (const content of remappedContentRows) {
      const newId = contentIdMap.get(num(content.id) ?? 0);
      if (!newId) continue;
      const [updated] = await tx.update(cmsContents).set({
        body: sanitizeCmsHtml(str(content.body)),
        extend: importedRecord(content.extend, `内容 #${num(content.id)} 扩展字段`),
        mediaData: importedMediaData(content.mediaData, `内容 #${num(content.id)} mediaData`),
        coverImage: importedCmsAsset(content.coverImage, `内容 #${num(content.id)} 封面`),
        sourceUrl: importedCmsLink(content.sourceUrl, `内容 #${num(content.id)} 来源链接`),
        externalLink: importedCmsLink(content.externalLink, `内容 #${num(content.id)} 外链`),
        attachments: importedAttachments(content.attachments, `内容 #${num(content.id)} 附件`),
      }).where(eq(cmsContents.id, newId)).returning();
      if (updated) await syncCmsResourceRefs(tx, 'content', updated.id, siteId, updated);
    }

    // 5. 内容关联（标签 / 附加栏目 / 相关文章）
    const remappedContentTags = ((data.contentTags ?? []) as PlainRow[]).map((r) => ({
      contentId: requireMappedId(contentIdMap, r.contentId, '内容标签的内容'),
      tagId: requireMappedId(tagIdMap, r.tagId, '内容标签的标签'),
    }));
    if (remappedContentTags.length > 0) {
      await tx.insert(cmsContentTags).values(remappedContentTags).onConflictDoNothing();
      // 外层列必须经 ${cmsTags}.id 显式表限定（sql`` 裸 Column 不带表名，防内层捕获）
      await tx.update(cmsTags)
        .set({ contentCount: sql<number>`(select count(*)::int from ${cmsContentTags} where ${cmsContentTags.tagId} = ${cmsTags}.id)` })
        .where(eq(cmsTags.siteId, siteId));
    }
    const remappedExtraChannels = ((data.contentChannels ?? []) as PlainRow[]).map((r) => ({
      contentId: requireMappedId(contentIdMap, r.contentId, '副栏目的内容'),
      channelId: requireMappedId(channelIdMap, r.channelId, '副栏目'),
    }));
    if (remappedExtraChannels.length > 0) {
      const targetIds = [...new Set(remappedExtraChannels.map((row) => row.channelId))];
      const targetRows = await tx.select({ id: cmsChannels.id, type: cmsChannels.type }).from(cmsChannels)
        .where(and(eq(cmsChannels.siteId, siteId), inArray(cmsChannels.id, targetIds)));
      const validTargets = new Set(targetRows.filter((row) => row.type === 'list').map((row) => row.id));
      if (remappedExtraChannels.some((row) => !validTargets.has(row.channelId) || contentMainChannelById.get(row.contentId) === row.channelId)) {
        throw new HTTPException(400, { message: '副栏目必须是本站列表栏目且不能等于内容主栏目' });
      }
      await tx.insert(cmsContentChannels).values(remappedExtraChannels).onConflictDoNothing();
    }
    const remappedRelations = ((data.contentRelations ?? []) as PlainRow[]).map((r) => ({
      contentId: requireMappedId(contentIdMap, r.contentId, '相关文章的内容'),
      relatedId: requireMappedId(contentIdMap, r.relatedId, '相关文章目标'),
      sort: num(r.sort) ?? 0,
    })).filter((r) => r.contentId !== r.relatedId);
    if (remappedRelations.length > 0) {
      await tx.insert(cmsContentRelations).values(remappedRelations).onConflictDoNothing();
    }

    // 5.2 页面部件：来源 id 必须在栏目/内容完成后重映射；导入后统一回到草稿态。
    const widgetIdMap = new Map<number, number>();
    const widgetSourceIds = new Set<number>();
    for (const widget of (data.widgets ?? []) as PlainRow[]) {
      const oldId = requireSourceId(widget.id, '页面部件 id', widgetSourceIds);
      const draftData = remapImportedWidgetData(widget.draftData, contentIdMap, channelIdMap);
      const [created] = await tx.insert(cmsWidgets).values({
        siteId,
        name: str(widget.name) ?? `页面部件-${oldId}`,
        code: requireCmsSlug(widget.code, `页面部件 #${oldId} 编码`),
        type: 'manual-list',
        schemaVersion: 1,
        draftData,
        publishedData: null,
        publishedName: null,
        draftRevision: 1,
        publishedRevision: 0,
        status: 'draft',
        defaultRendererKey: str(widget.defaultRendererKey) ?? 'list-sidebar',
        remark: str(widget.remark),
      }).returning();
      widgetIdMap.set(oldId, created.id);
      await syncCmsResourceRefs(tx, 'widget', created.id, siteId, created);
    }

    // 6. 站点附属实体
    const friendLinkGroupIdMap = new Map<number, number>();
    const friendLinkGroupSourceIds = new Set<number>();
    for (const group of (data.friendLinkGroups ?? []) as PlainRow[]) {
      const oldId = requireSourceId(group.id, '友链分组 id', friendLinkGroupSourceIds);
      const [created] = await tx.insert(cmsFriendLinkGroups).values({
        siteId,
        name: str(group.name) ?? '未命名友链分组',
        code: requireCmsSlug(group.code, `友链分组 #${oldId} code`, 50),
        status: (str(group.status) as typeof cmsFriendLinkGroups.$inferInsert.status) ?? 'enabled',
        sort: num(group.sort) ?? 0,
        remark: str(group.remark),
      }).returning({ id: cmsFriendLinkGroups.id });
      friendLinkGroupIdMap.set(oldId, created.id);
    }
    for (const l of (data.friendLinks ?? []) as PlainRow[]) {
      const sourceGroupId = num(l.groupId);
      const [created] = await tx.insert(cmsFriendLinks).values({
        siteId,
        groupId: sourceGroupId == null ? null : requireMappedId(friendLinkGroupIdMap, sourceGroupId, '友链分组'),
        name: str(l.name) ?? '未命名链接',
        url: importedCmsLink(l.url, '友情链接地址', true)!,
        logo: importedCmsAsset(l.logo, '友情链接 Logo'),
        status: (str(l.status) as typeof cmsFriendLinks.$inferInsert.status) ?? 'enabled',
        sort: num(l.sort) ?? 0,
        remark: str(l.remark),
      }).returning();
      await syncCmsResourceRefs(tx, 'friendLink', created.id, siteId, created);
    }
    for (const r of (data.redirects ?? []) as PlainRow[]) {
      if (!str(r.fromPath) || !str(r.toUrl)) throw new HTTPException(400, { message: '重定向规则缺少来源或目标地址' });
      const toUrl = importedCmsLink(r.toUrl, '重定向目标地址', true)!;
      await assertTrustedRedirectTarget(toUrl);
      await tx.insert(cmsRedirects).values({
        siteId,
        fromPath: str(r.fromPath)!,
        toUrl,
        redirectType: num(r.redirectType) ?? 301,
        status: (str(r.status) as typeof cmsRedirects.$inferInsert.status) ?? 'enabled',
        remark: str(r.remark),
      });
    }
    for (const w of (data.linkWords ?? []) as PlainRow[]) {
      if (!str(w.keyword) || !str(w.url)) throw new HTTPException(400, { message: '内链词缺少关键词或目标地址' });
      await tx.insert(cmsLinkWords).values({
        siteId,
        keyword: str(w.keyword)!,
        url: importedCmsLink(w.url, '内链词目标地址', true)!,
        maxReplaces: num(w.maxReplaces) ?? 1,
        status: (str(w.status) as typeof cmsLinkWords.$inferInsert.status) ?? 'enabled',
      });
    }
    const slotIdMap = new Map<number, number>();
    const slotSourceIds = new Set<number>();
    for (const s of (data.adSlots ?? []) as PlainRow[]) {
      const oldId = requireSourceId(s.id, '广告位 id', slotSourceIds);
      const [created] = await tx.insert(cmsAdSlots).values({
        siteId,
        code: requireCmsSlug(str(s.code) ?? `slot-${oldId}`, `广告位 #${oldId} code`, 50),
        name: str(s.name) ?? '未命名广告位',
        remark: str(s.remark),
      }).returning({ id: cmsAdSlots.id });
      slotIdMap.set(oldId, created.id);
    }
    for (const a of (data.ads ?? []) as PlainRow[]) {
      const slotId = requireMappedId(slotIdMap, a.slotId, '广告位');
      const [created] = await tx.insert(cmsAds).values({
        slotId,
        name: str(a.name) ?? '未命名广告',
        image: importedCmsAsset(a.image, '广告图片'),
        linkUrl: importedCmsLink(a.linkUrl, '广告链接'),
        startAt: parseDateTimeInput(str(a.startAt) ?? undefined),
        endAt: parseDateTimeInput(str(a.endAt) ?? undefined),
        sort: num(a.sort) ?? 0,
        status: (str(a.status) as typeof cmsAds.$inferInsert.status) ?? 'enabled',
      }).returning();
      await syncCmsResourceRefs(tx, 'ad', created.id, siteId, created);
   }
   for (const f of (data.forms ?? []) as PlainRow[]) {
      const parsedForm = createCmsFormSchema.safeParse({
        ...f,
        siteId,
        captchaProvider: str(f.captchaProvider) === 'turnstile' ? 'inherit' : f.captchaProvider,
        turnstileSiteKey: str(f.captchaProvider) === 'turnstile' ? null : f.turnstileSiteKey,
        turnstileSecret: null,
      });
      if (!parsedForm.success) {
        throw new HTTPException(400, { message: '表单 #' + String(num(f.id)) + ' 格式无效：' + (parsedForm.error.issues[0]?.message ?? '未知错误') });
      }
     const [created] = await tx.insert(cmsForms).values({
       siteId,
        code: parsedForm.data.code,
        name: parsedForm.data.name,
        fields: await canonicalizeCmsResourceContent(tx, siteId, normalizeCmsFormFields(parsedForm.data.fields as FormFieldInput[])),
        successMessage: parsedForm.data.successMessage ?? null,
        notifyEmail: parsedForm.data.notifyEmail ?? null,
        captchaProvider: parsedForm.data.captchaProvider,
        turnstileSiteKey: parsedForm.data.turnstileSiteKey ?? null,
        // Secrets are environment-bound and never imported, even from a
        // hand-authored package.
        turnstileSecret: null,
        status: (str(f.status) as typeof cmsForms.$inferInsert.status) ?? 'enabled',
      }).returning();
      await syncCmsResourceRefs(tx, 'form', created.id, siteId, created);
    }
    const interactionSourceIds = new Set<number>();
    let interactionQuestionCount = 0;
    for (const raw of (data.interactions ?? []) as PlainRow[]) {
      const oldId = requireSourceId(raw.id, '互动问卷 id', interactionSourceIds);
      const questions = ((data.interactionQuestions ?? []) as PlainRow[])
        .filter((question) => num(question.interactionId) === oldId)
        .map((question) => ({
          label: question.label,
          type: question.type,
          required: question.required,
          options: question.options,
          minChoices: question.minChoices,
          maxChoices: question.maxChoices,
          sort: question.sort,
          allowOther: question.allowOther,
          otherLabel: question.otherLabel,
          ratingMax: question.ratingMax,
          matrixRows: question.matrixRows,
          pageNo: question.pageNo,
          visibleWhen: question.visibleWhen,
        }));
      const parsed = createCmsInteractionSchema.safeParse({
        ...raw,
        siteId,
        status: 'draft',
        captchaPolicy: raw.captchaPolicy === 'turnstile' ? 'inherit' : raw.captchaPolicy,
        turnstileSiteKey: raw.captchaPolicy === 'turnstile' ? null : raw.turnstileSiteKey,
        turnstileSecret: null,
        questions,
      });
      if (!parsed.success) {
        throw new HTTPException(400, { message: `互动问卷 #${oldId} 格式无效：${parsed.error.issues[0]?.message ?? '未知错误'}` });
      }
      const { questions: parsedQuestions, startAt, endAt, ...interaction } = parsed.data;
      const [created] = await tx.insert(cmsInteractions).values({
        ...interaction,
        status: 'draft',
        turnstileSecret: null,
        startAt: parseDateTimeInput(startAt ?? undefined),
        endAt: parseDateTimeInput(endAt ?? undefined),
      }).returning({ id: cmsInteractions.id });
      await tx.insert(cmsInteractionQuestions).values(parsedQuestions.map((question) => ({
        interactionId: created.id,
        label: question.label,
        type: question.type,
        required: question.required,
        options: question.options,
        minChoices: question.minChoices,
        maxChoices: question.maxChoices,
        sort: question.sort,
        allowOther: question.allowOther,
        otherLabel: question.otherLabel ?? null,
        ratingMax: question.ratingMax,
        matrixRows: question.matrixRows,
        pageNo: question.pageNo,
        visibleWhen: question.visibleWhen ?? null,
      })));
      interactionQuestionCount += parsedQuestions.length;
    }
    let importedHome = false;
    const usedPageSlugs = new Set<string>();
    const usedPagePaths = new Set<string>();
    const contentStaticPaths = new Set(((data.contents ?? []) as PlainRow[])
      .map((content) => str(content.staticPath)?.trim())
      .filter((value): value is string => !!value));
    for (const p of (data.pages ?? []) as PlainRow[]) {
      const blocks = remapImportedWidgetBlocks(p.blocks, widgetIdMap, channelIdMap);
      const isHome = p.isHome === true && !importedHome;
      if (isHome) importedHome = true;
      const slug = requireCmsSlug(p.slug, `页面 #${num(p.id)} slug`);
      if (usedPageSlugs.has(slug)) throw new HTTPException(400, { message: `页面 slug 重复：${slug}` });
      usedPageSlugs.add(slug);
      const path = importedPagePath(p.path, `页面 #${num(p.id)} path`);
      if (path) {
        if ([...channelPathMap.values()].some((channelPath) => path === channelPath || path.startsWith(`${channelPath}/`))) {
          throw new HTTPException(400, { message: `页面 #${num(p.id)} path 与栏目路径空间冲突` });
        }
        if (usedPagePaths.has(path)) throw new HTTPException(400, { message: `页面 path 重复：${path}` });
        if (contentStaticPaths.has(path)) throw new HTTPException(400, { message: `页面 path 与内容静态路径冲突：${path}` });
        usedPagePaths.add(path);
      }
      const [created] = await tx.insert(cmsPages).values({
        siteId,
        name: str(p.name) ?? '未命名页面',
        slug,
        path,
        isHome,
        blocks,
        requiresDynamic: cmsPageRequiresDynamic(blocks),
        seoTitle: str(p.seoTitle),
        seoKeywords: str(p.seoKeywords),
        seoDescription: str(p.seoDescription),
        status: (str(p.status) as typeof cmsPages.$inferInsert.status) ?? 'enabled',
        remark: str(p.remark),
      }).returning();
      await syncCmsPageWidgetRefs(tx, created.id, siteId, blocks);
      await syncCmsResourceRefs(tx, 'page', created.id, siteId, created);
    }
    // 导入页面部件统一降级为草稿；主题插槽只允许绑定已发布部件，因此不恢复旧站绑定。
    // 页面中的 widget-ref 会保留并重映射，部件重新发布后可由运营在站点主题配置中恢复插槽。
    const skippedWidgetSlots = (data.widgetSlots ?? []).length;
    const renamedModels = [...modelCodeMap.entries()].filter(([source, target]) => source !== target);
    const warnings = [
      '运行环境绑定的分析标识、Webhook/CDN/推送配置与验证码密钥未导入，请在目标环境重新配置',
      ...(renamedModels.length > 0
        ? [`${renamedModels.length} 个站点专属模型因目标环境 code 冲突已重命名：${renamedModels.map(([source, target]) => `${source}→${target}`).join('、')}`]
        : []),
      ...(widgetIdMap.size > 0
        ? [`已导入 ${widgetIdMap.size} 个页面部件并统一降级为草稿，请审核后重新发布`]
        : []),
      ...(skippedWidgetSlots > 0
        ? [`已跳过 ${skippedWidgetSlots} 个主题页面部件插槽绑定，请在部件发布后重新绑定`]
        : []),
    ];

    // The import creates every page/resource reference in this transaction,
    // so the publish outbox must be inserted here as well.  Re-read the site
    // after all backfills (model/settings/resource updates) and let the outbox
    // helper bump the public revision and capture the final fence atomically.
    const [finalSite] = await tx.select().from(cmsSites)
      .where(eq(cmsSites.id, siteId)).limit(1);
    requireRow(finalSite, '导入站点不存在');
    const publishTask = await insertCmsSiteRefsRebuildOutbox(
      tx,
      finalSite,
      '站点导入完成',
      `site:${siteId}:import:v${CMS_SITE_EXPORT_VERSION}`,
    );

    return {
      result: {
        siteId,
        siteName: newSite.name,
        siteCode: newSite.code,
        counts: {
          channels: channelIdMap.size,
          tags: tagIdMap.size,
          contents: contentIdMap.size,
          resourceFolders: folderIdMap.size,
          resources: resourceIdMap.size,
          models: (data.models ?? []).length,
          modelFields: (data.modelFields ?? []).length,
          friendLinkGroups: (data.friendLinkGroups ?? []).length,
          friendLinks: (data.friendLinks ?? []).length,
          redirects: (data.redirects ?? []).length,
          linkWords: (data.linkWords ?? []).length,
          adSlots: slotIdMap.size,
          ads: (data.ads ?? []).length,
          forms: (data.forms ?? []).length,
          interactions: interactionSourceIds.size,
          interactionQuestions: interactionQuestionCount,
          widgets: widgetIdMap.size,
          pages: (data.pages ?? []).length,
        },
        skipped: { widgetSlots: skippedWidgetSlots },
        warnings,
      },
      publishTask,
    };
  });
  invalidateSiteCache();
  invalidateRedirectCache();
  invalidateLinkWordCache();
  // Enqueue only after the import transaction commits.  The task row and all
  // imported refs are therefore visible together to the worker.
  await enqueueCmsPublishOutboxes([result.publishTask], `站点「${result.result.siteName}」导入`);
  return result.result;
}
