import { HttpResponse } from 'msw';
import type * as z from 'zod';
import { badRequest, notFound, conflict, locked } from '@/mocks/utils/handlers';
import { mock } from '@/mocks/utils/contract';
import type {
  CmsChannel,
  CmsContent,
  CmsContentStatus,
  CmsForm,
  CmsModel,
  CmsModelField,
  CmsResourceReference,
  CmsSite,
  cmsModelFieldSchema,
} from '@zenith/shared/cms';
import {
  CMS_SECRET_MASK,
  cmsAdContract,
  cmsChannelContract,
  cmsCollectContract,
  cmsCommentContract,
  cmsContentContract,
  cmsDashboardContract,
  cmsErrorProneWordContract,
  cmsFormContract,
  cmsFriendLinkContract,
  cmsModelContract,
  cmsPageContract,
  cmsResourceContract,
  cmsSearchContract,
  cmsSensitiveWordContract,
  cmsSeoContract,
  cmsSiteContract,
  cmsStatContract,
  cmsStaticContract,
  cmsTagContract,
  cmsUploadContract,
  parseCmsLink,
} from '@zenith/shared/cms';
import { SEED_CMS_EDITOR_USER } from '@zenith/shared/seed';
import {
  mockCmsSites, mockCmsModels, mockCmsChannels, mockCmsContents, mockCmsTags,
  mockCmsFriendLinks, mockCmsFriendLinkGroups, buildMockChannelTree,
  getNextCmsSiteId, getNextCmsModelId, getNextCmsModelFieldId, getNextCmsChannelId,
  getNextCmsContentId, getNextCmsTagId, getNextCmsFriendLinkId, getNextCmsFriendLinkGroupId,
  mockCmsAdSlots, mockCmsAds, mockCmsForms, mockCmsFormSubmissions, mockCmsSensitiveWords,
  mockCmsErrorProneWords, mockCmsContentOpLogs, mockCmsLinkWords, mockCmsComments, mockCmsRedirects, mockCmsPushLogs, mockCmsContentVersions,
  getNextCmsAdSlotId, getNextCmsAdId, getNextCmsFormId, getNextCmsSensitiveWordId,
  getNextCmsErrorProneWordId, getNextCmsContentOpLogId, getNextCmsLinkWordId, getNextCmsRedirectId,
  mockCmsSearchWords, mockCmsHotKeywords, mockCmsHotwordGroups,
  getNextCmsSearchWordId, getNextCmsHotwordGroupId, getNextCmsHotwordId,
  mockCmsResources, mockCmsResourceFolders, getNextCmsResourceId, getNextCmsResourceFolderId,
  mockCmsOpenGrants, getNextCmsOpenGrantId,
  mockCmsCollectRules, mockCmsCollectItems, getNextCmsCollectRuleId,
  mockCmsPages, getNextCmsPageId, mockCmsWidgetRefs, getNextCmsWidgetRefId, mockCmsWidgets,
} from '../data/cms';
import { mockCmsPublishingTasks } from '../data/cms-stage3';
import { mockCmsDistributionRules } from '../data/cms-stage5';
import { createProgressingMockTask } from './async-tasks';
import { submitMockCmsWidgetSourceRefresh } from './cms-widgets';
import { mockDateTime, mockDate } from '../utils/date';

type MockContent = CmsContent & { tagIds: number[]; deleted?: boolean };

function syncMockPageWidgetRefs(page: (typeof mockCmsPages)[number]) {
  for (let index = mockCmsWidgetRefs.length - 1; index >= 0; index -= 1) {
    const ref = mockCmsWidgetRefs[index];
    if (ref.ownerType === 'page' && ref.ownerId === page.id) mockCmsWidgetRefs.splice(index, 1);
  }

  for (const block of page.blocks) {
    if (block.type !== 'widget-ref') continue;
    const widgetId = Number(block.props.widgetId);
    if (!Number.isInteger(widgetId) || widgetId <= 0) continue;
    mockCmsWidgetRefs.push({
      id: getNextCmsWidgetRefId(),
      siteId: page.siteId,
      widgetId,
      ownerType: 'page',
      ownerId: page.id,
      field: block.id,
      rendererKey: String(block.props.rendererKey ?? 'list-sidebar') as import('@zenith/shared/cms').CmsWidgetRendererKey,
      styleProps: block.props.styleProps && typeof block.props.styleProps === 'object'
        ? block.props.styleProps as Record<string, unknown>
        : {},
      ownerName: page.name,
      createdAt: mockDateTime(),
      updatedAt: mockDateTime(),
    });
  }
}

function publishedWidgetUsing(sourceType: 'content' | 'channel', sourceId: number) {
  return mockCmsWidgets.find((widget) =>
    widget.status === 'published'
    && widget.publishedData?.items.some((item) => (
      item.sourceType === sourceType && item.sourceId === sourceId
    ) || (
      sourceType === 'channel'
      && item.sourceType === 'content'
      && mockCmsContents.some((content) => content.id === item.sourceId && content.channelId === sourceId)
    )));
}

function channelPath(channelId: number): string {
  return mockCmsChannels.find((c) => c.id === channelId)?.path ?? '';
}

function isDeleted(content: CmsContent): boolean {
  return (content as MockContent).deleted === true;
}

function setDeleted(content: CmsContent, deleted: boolean) {
  (content as MockContent).deleted = deleted;
}

const sensitiveCmsSettingKey = /(?:secret|token|password|private[_-]?key|api[_-]?key|access[_-]?key|indexnow[_-]?key|credential)/i;

function redactMockSettingValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactMockSettingValue);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, nested]) => [
    key,
    sensitiveCmsSettingKey.test(key) ? CMS_SECRET_MASK : redactMockSettingValue(nested),
  ]));
}

function redactMockSite(site: CmsSite): CmsSite {
  const settings = redactMockSettingValue(site.settings) as Record<string, unknown>;
  return { ...site, settings };
}

function mergeMockSiteSettings(
  current: Record<string, unknown>,
  incoming: Record<string, unknown>,
): Record<string, unknown> {
  const out = { ...current };
  for (const [key, value] of Object.entries(incoming)) {
    if (sensitiveCmsSettingKey.test(key) && (value === '' || value === CMS_SECRET_MASK)) continue;
    if (sensitiveCmsSettingKey.test(key) && value === null) delete out[key];
    else if (value && typeof value === 'object' && !Array.isArray(value)) {
      const existing = out[key] && typeof out[key] === 'object' && !Array.isArray(out[key])
        ? out[key] as Record<string, unknown>
        : {};
      out[key] = mergeMockSiteSettings(
        existing,
        value as Record<string, unknown>,
      );
    } else out[key] = value;
  }

  return out;
}

function redactMockForm<T extends { turnstileSecret: string | null }>(form: T): T {
  return { ...form, turnstileSecret: form.turnstileSecret ? CMS_SECRET_MASK : null };
}

function sanitizeMockCmsHtml(value: string | null): string | null {
  return value?.replace(/<script[\s\S]*?<\/script>/gi, '').replace(/\son\w+="[^"]*"/gi, '') ?? null;
}

/**
 * 素材引用查询（对应服务端的 cms_resource_refs 反向索引）。
 *
 * 服务端把素材统一存为 `cms-res://{id}` 句柄后按索引精确查询；Demo 数据里既有句柄
 * 也有历史裸 URL，这里两种形态都识别，保证演示站的引用数与删除保护表现一致。
 */
function collectMockResourceRefs(res: { id: number; siteId: number; url: string }): CmsResourceReference[] {
  const handle = `cms-res://${res.id}`;
  const hit = (value: string | null | undefined) => !!value && (value.includes(handle) || value.includes(res.url));
  const refs: CmsResourceReference[] = [];
  for (const c of mockCmsContents) {
    if (c.siteId !== res.siteId) continue;
    if (hit(c.coverImage)) refs.push({ kind: 'content', id: c.id, title: c.title, field: 'coverImage' });
    if (hit(c.body)) refs.push({ kind: 'content', id: c.id, title: c.title, field: 'body' });
  }
  for (const link of mockCmsFriendLinks) {
    if (link.siteId !== res.siteId) continue;
    if (hit(link.logo)) refs.push({ kind: 'friendLink', id: link.id, title: link.name, field: 'logo' });
    if (hit(link.url)) refs.push({ kind: 'friendLink', id: link.id, title: link.name, field: 'url' });
  }
  return refs;
}

type ModelFieldInput = z.output<typeof cmsModelFieldSchema>;

function buildMockModelFields(modelId: number, fields: ModelFieldInput[], now: string): CmsModelField[] {
  return fields.map((f, i) => ({
    id: getNextCmsModelFieldId(),
    modelId,
    name: f.name,
    label: f.label,
    fieldType: f.fieldType,
    required: f.required,
    searchable: f.searchable,
    showInList: f.showInList,
    showInDetail: f.showInDetail,
    detailGroup: f.detailGroup || null,
    detailSort: i,
    placeholder: f.placeholder ?? null,
    defaultValue: null,
    optionSource: f.optionSource,
    dictCode: f.dictCode ?? null,
    options: f.options ?? null,
    sort: i,
    createdAt: now,
    updatedAt: now,
  }));
}

function authorizedEditorUsers() {
  return { userIds: [2], users: [{ id: 2, username: SEED_CMS_EDITOR_USER.username, nickname: SEED_CMS_EDITOR_USER.nickname }] };
}

export const cmsHandlers = [
  // ═══ 站点 ═══════════════════════════════════════════════════════════════
  // 主题参数声明（与 packages/server/src/cms/themes/default 的 settingsSchema 保持一致）
  mock(cmsSiteContract.themeSettingsSchema, ({ params, ok }) => ok(params.code === 'default' ? [
    { name: 'contactPhone', label: '页头联系电话', fieldType: 'text', group: '页头', placeholder: '如 400-800-8888', description: '显示在页头搜索框左侧，留空不显示' },
    { name: 'bannerImage', label: '首页横幅图', fieldType: 'image', group: '首页', description: '显示在首页顶部，留空不显示' },
    { name: 'bannerLink', label: '横幅跳转链接', fieldType: 'text', group: '首页', placeholder: 'https://... 留空不跳转' },
    { name: 'showHotSection', label: '显示热门排行', fieldType: 'switch', defaultValue: true, group: '首页' },
    { name: 'footerText', label: '页脚附加文案', fieldType: 'textarea', group: '页脚', placeholder: '如联系地址、邮箱等，支持多行' },
  ] : [])),
  mock(cmsSiteContract.detail, ({ params, ok }) => {
    const site = mockCmsSites.find((s) => s.id === params.id);
    return site ? ok(redactMockSite(site)) : notFound('站点不存在', { status: 404 });
  }),
  mock(cmsSiteContract.create, ({ body, ok }) => {
    if (mockCmsSites.some((site) => site.code === body.code)) {
      return badRequest('站点标识或域名已存在', { status: 400 });
    }
    if (!['default', 'docs'].includes(body.theme)) {
      return badRequest(`主题「${body.theme}」不存在，仅支持内置主题`, { status: 400 });
    }
    const now = mockDateTime();
    if (body.isDefault) mockCmsSites.forEach((s) => { s.isDefault = false; });
    const site: CmsSite = {
      id: getNextCmsSiteId(),
      parentId: body.parentId,
      inheritance: body.inheritance,
      name: body.name,
      code: body.code,
      domain: body.domain ?? null,
      aliasDomains: body.aliasDomains,
      isDefault: body.isDefault,
      title: body.title ?? null,
      keywords: body.keywords ?? null,
      description: body.description ?? null,
      logo: null,
      favicon: null,
      icp: body.icp ?? null,
      copyright: body.copyright ?? null,
      theme: body.theme,
      themeRevision: 0,
      publicRevision: 0,
      templateRefsRevision: 0,
      staticMode: body.staticMode,
      robots: body.robots ?? null,
      modelId: body.modelId ?? null,
      extend: body.extend,
      settings: mergeMockSiteSettings({}, body.settings),
      status: body.status,
      sort: body.sort,
      remark: body.remark ?? null,
      createdAt: now,
      updatedAt: now,
    };
    mockCmsSites.push(site);
    return ok(redactMockSite(site), '创建成功');
  }),
  mock(cmsSiteContract.update, ({ params, body, ok }) => {
    const idx = mockCmsSites.findIndex((s) => s.id === params.id);
    if (idx === -1) return notFound('站点不存在', { status: 404 });
    if (body.status === 'disabled') {
      if (mockCmsSites.some((site) => site.parentId === mockCmsSites[idx].id && site.status === 'enabled')) {
        return badRequest('存在启用中的子站点，请先逐级停用子站点', { status: 400 });
      }
      if (mockCmsDistributionRules.some((rule) =>
        rule.status === 'enabled'
        && (rule.sourceSiteId === mockCmsSites[idx].id || rule.targetSiteId === mockCmsSites[idx].id))) {
        return badRequest('该站点被启用中的分发规则引用，请先停用规则', { status: 400 });
      }
    }
    const code = body.code === undefined ? mockCmsSites[idx].code : body.code;
    if (mockCmsSites.some((site, siteIndex) => siteIndex !== idx && site.code === code)) {
      return badRequest('站点标识或域名已存在', { status: 400 });
    }
    const { theme: _ignoredTheme, settings, ...patch } = body;
    const mergedSettings = settings
      ? mergeMockSiteSettings(mockCmsSites[idx].settings, settings)
      : undefined;
    if (mergedSettings) mockCmsSites[idx].templateRefsRevision += 1;
    if (body.isDefault) mockCmsSites.forEach((s) => { s.isDefault = false; });
    Object.assign(mockCmsSites[idx], patch, mergedSettings ? { settings: mergedSettings } : {}, { code, updatedAt: mockDateTime() });
    return ok(redactMockSite(mockCmsSites[idx]), '更新成功');
  }),
  mock(cmsSiteContract.remove, ({ params, ok }) => {
    const { id } = params;
    if (mockCmsSites.some((site) => site.parentId === id)) {
      return badRequest('该站点下存在子站点，请先移动或删除子站点', { status: 400 });
    }
    if (mockCmsDistributionRules.some((rule) => rule.sourceSiteId === id || rule.targetSiteId === id)) {
      return badRequest('该站点被分发规则引用，请先删除规则', { status: 400 });
    }
    if (mockCmsChannels.some((c) => c.siteId === id)) {
      return badRequest('该站点下存在栏目，请先删除栏目', { status: 400 });
    }
    const idx = mockCmsSites.findIndex((s) => s.id === id);
    if (idx === -1) return notFound('站点不存在', { status: 404 });
    mockCmsSites.splice(idx, 1);
    return ok(null, '删除成功');
  }),

  // ═══ 模型 ═══════════════════════════════════════════════════════════════
  mock(cmsModelContract.all, ({ ok }) => ok(mockCmsModels.filter((m) => m.status === 'enabled'))),
  mock(cmsModelContract.list, ({ query, ok, paginate }) => {
    const { keyword } = query;
    let list = [...mockCmsModels];
    if (keyword) list = list.filter((m) => m.name.includes(keyword) || m.code.includes(keyword));
    return ok(paginate(list));
  }),
  mock(cmsModelContract.detail, ({ params, ok }) => {
    const model = mockCmsModels.find((m) => m.id === params.id);
    return model ? ok(model) : notFound('内容模型不存在', { status: 404 });
  }),
  mock(cmsModelContract.create, ({ body, ok }) => {
    const now = mockDateTime();
    const modelId = getNextCmsModelId();
    const model: CmsModel = {
      id: modelId,
      ownerSiteId: body.ownerSiteId,
      ownerSiteName: null,
      name: body.name,
      code: body.code,
      description: body.description ?? null,
      isSystem: false,
      status: body.status,
      sort: 0,
      fields: buildMockModelFields(modelId, body.fields, now),
      createdAt: now,
      updatedAt: now,
    };
    mockCmsModels.push(model);
    return ok(model, '创建成功');
  }),
  mock(cmsModelContract.update, ({ params, body, ok }) => {
    const idx = mockCmsModels.findIndex((m) => m.id === params.id);
    if (idx === -1) return notFound('内容模型不存在', { status: 404 });
    const now = mockDateTime();
    const { fields, ...rest } = body;
    Object.assign(mockCmsModels[idx], rest, { updatedAt: now });
    if (fields) mockCmsModels[idx].fields = buildMockModelFields(mockCmsModels[idx].id, fields, now);
    return ok(mockCmsModels[idx], '更新成功');
  }),
  mock(cmsModelContract.remove, ({ params, ok }) => {
    const model = mockCmsModels.find((m) => m.id === params.id);
    if (!model) return notFound('内容模型不存在', { status: 404 });
    if (model.isSystem) {
      return badRequest('系统内置模型不可删除', { status: 400 });
    }
    mockCmsModels.splice(mockCmsModels.indexOf(model), 1);
    return ok(null, '删除成功');
  }),

  // ═══ 栏目 ═══════════════════════════════════════════════════════════════
  mock(cmsChannelContract.tree, ({ query, ok }) => {
    const list = mockCmsChannels
      .filter((c) => c.siteId === query.siteId)
      .map((c) => ({ ...c, modelName: mockCmsModels.find((m) => m.id === c.modelId)?.name ?? null }));
    return ok(buildMockChannelTree(list));
  }),
  mock(cmsChannelContract.detail, ({ params, ok }) => {
    const channel = mockCmsChannels.find((c) => c.id === params.id);
    return channel ? ok(channel) : notFound('栏目不存在', { status: 404 });
  }),
  mock(cmsChannelContract.create, ({ body, ok }) => {
    const now = mockDateTime();
    const { parentId, slug, siteId } = body;
    const parent = mockCmsChannels.find((c) => c.id === parentId);
    // 与服务端一致：code 留空取 slug，站点内冲突追加序号
    const usedCodes = new Set(mockCmsChannels.filter((c) => c.siteId === siteId).map((c) => c.code));
    let code = body.code?.trim() || slug;
    for (let i = 2; usedCodes.has(code) && i < 1000; i++) code = `${slug}-${i}`;
    const channel: CmsChannel = {
      id: getNextCmsChannelId(),
      siteId,
      parentId,
      modelId: body.modelId ?? null,
      name: body.name,
      code,
      slug,
      path: parent ? `${parent.path}/${slug}` : slug,
      type: body.type,
      linkUrl: body.linkUrl ?? null,
      listTemplate: body.listTemplate ?? null,
      detailTemplate: body.detailTemplate ?? null,
      staticMode: body.staticMode,
      detailPathRule: body.detailPathRule,
      pageSize: body.pageSize,
      pageContent: body.pageContent ?? null,
      seoTitle: body.seoTitle ?? null,
      seoKeywords: body.seoKeywords ?? null,
      seoDescription: body.seoDescription ?? null,
      image: null,
      visible: body.visible,
      status: body.status,
      sort: body.sort,
      settings: body.settings,
      createdAt: now,
      updatedAt: now,
    };
    mockCmsChannels.push(channel);
    return ok(channel, '创建成功');
  }),
  mock(cmsChannelContract.update, ({ params, body, ok }) => {
    const idx = mockCmsChannels.findIndex((c) => c.id === params.id);
    if (idx === -1) return notFound('栏目不存在', { status: 404 });
    const widget = body.status === 'disabled' ? publishedWidgetUsing('channel', params.id) : null;
    if (widget) return conflict(`已发布页面部件「${widget.name}」引用了该栏目`, { status: 409 });
    Object.assign(mockCmsChannels[idx], body, { updatedAt: mockDateTime() });
    const parent = mockCmsChannels.find((c) => c.id === mockCmsChannels[idx].parentId);
    mockCmsChannels[idx].path = parent ? `${parent.path}/${mockCmsChannels[idx].slug}` : mockCmsChannels[idx].slug;
    submitMockCmsWidgetSourceRefresh('channel', [params.id]);
    return ok(mockCmsChannels[idx], '更新成功');
  }),
  mock(cmsChannelContract.remove, ({ params, ok }) => {
    const { id } = params;
    const widget = publishedWidgetUsing('channel', id);
    if (widget) return conflict(`已发布页面部件「${widget.name}」引用了该栏目`, { status: 409 });
    if (mockCmsChannels.some((c) => c.parentId === id)) {
      return badRequest('存在子栏目，请先删除子栏目', { status: 400 });
    }
    if (mockCmsContents.some((c) => c.channelId === id)) {
      return badRequest('栏目下存在内容，请先移除内容', { status: 400 });
    }
    const idx = mockCmsChannels.findIndex((c) => c.id === id);
    if (idx === -1) return notFound('栏目不存在', { status: 404 });
    mockCmsChannels.splice(idx, 1);
    return ok(null, '删除成功');
  }),

  // ═══ 内容 ═══════════════════════════════════════════════════════════════
  mock(cmsContentContract.list, ({ query, ok, paginate }) => {
    const { siteId, channelId, status, contentType, keyword, deleted, archived } = query;
    let list = mockCmsContents.filter((c) => c.siteId === siteId && (deleted ? c.status === 'offline' && isDeleted(c) : !isDeleted(c)));
    if (!deleted) list = list.filter((c) => (archived ? !!c.archivedAt : !c.archivedAt));
    if (channelId) list = list.filter((c) => c.channelId === channelId);
    if (status) list = list.filter((c) => c.status === status);
    if (contentType) list = list.filter((c) => c.contentType === contentType);
    if (keyword) list = list.filter((c) => c.title.includes(keyword) || (c.author ?? '').includes(keyword));
    list = [...list].sort((a, b) => Number(b.isTop) - Number(a.isTop) || (b.topWeight ?? 0) - (a.topWeight ?? 0) || b.id - a.id);
    return ok(paginate(list.map((c) => ({ ...c, channelName: mockCmsChannels.find((ch) => ch.id === c.channelId)?.name ?? null }))));
  }),
  mock(cmsContentContract.checkTitle, ({ query, ok }) => {
    const { siteId, excludeId } = query;
    const title = query.title.trim();
    const matches = mockCmsContents
      .filter((c) => c.siteId === siteId && c.title === title && c.id !== excludeId)
      .slice(0, 5)
      .map((c) => ({ id: c.id, title: c.title, status: c.status }));
    return ok({ duplicate: matches.length > 0, matches });
  }),
  mock(cmsContentContract.linkTarget, ({ query, ok }) => {
    const { siteId } = query;
    const link = query.link.trim();
    const ref = parseCmsLink(link);
    if (!ref) return ok({ kind: 'invalid', label: link, targetId: null, targetCode: null, exists: false });
    if (ref.kind === 'external') return ok({ kind: 'external', label: ref.url, targetId: null, targetCode: null, exists: true });
    if (ref.kind === 'internal') return ok({ kind: 'internal', label: ref.path, targetId: null, targetCode: null, exists: true });
    if (ref.code !== null) {
      const channel = mockCmsChannels.find((ch) => ch.code === ref.code && ch.siteId === siteId);
      return ok({
        kind: 'entity-channel',
        label: channel?.name ?? `栏目「${ref.code}」（不存在）`,
        targetId: channel?.id ?? null,
        targetCode: ref.code,
        exists: !!channel,
      });
    }
    if (ref.entityType === 'content') {
      const target = mockCmsContents.find((c) => c.id === ref.id && c.siteId === siteId);
      return ok({
        kind: 'entity-content',
        label: target?.title ?? `内容 #${ref.id}（已删除）`,
        targetId: ref.id,
        targetCode: null,
        exists: !!target,
      });
    }
    const channel = mockCmsChannels.find((ch) => ch.id === ref.id && ch.siteId === siteId);
    return ok({
      kind: 'entity-channel',
      label: channel?.name ?? `栏目 #${ref.id}（已删除）`,
      targetId: ref.id,
      targetCode: null,
      exists: !!channel,
    });
  }),
  mock(cmsContentContract.detail, ({ params, ok }) => {
    const content = mockCmsContents.find((c) => c.id === params.id);
    if (!content) return notFound('内容不存在', { status: 404 });
    return ok({
      ...content,
      channelName: mockCmsChannels.find((ch) => ch.id === content.channelId)?.name ?? null,
      tags: mockCmsTags.filter((t) => content.tagIds.includes(t.id)),
    });
  }),
  mock(cmsContentContract.recycle, ({ body, ok }) => {
    const { ids } = body;
    const widget = ids.map((id) => publishedWidgetUsing('content', id)).find(Boolean);
    if (widget) return conflict(`已发布页面部件「${widget.name}」引用了所选内容`, { status: 409 });
    for (const c of mockCmsContents) {
      if (ids.includes(c.id)) {
        setDeleted(c, true);
        c.status = 'offline';
      }
    }
    return ok(null, `已移入回收站 ${ids.length} 条`);
  }),
  mock(cmsContentContract.restore, ({ body, ok }) => {
    const { ids } = body;
    for (const c of mockCmsContents) {
      if (ids.includes(c.id)) {
        setDeleted(c, false);
        c.status = 'draft';
      }
    }
    return ok(null, `已恢复 ${ids.length} 条`);
  }),
  mock(cmsContentContract.purge, ({ body, ok }) => {
    const { ids } = body;
    const widget = ids.map((id) => publishedWidgetUsing('content', id)).find(Boolean);
    if (widget) return conflict(`已发布页面部件「${widget.name}」引用了所选内容`, { status: 409 });
    for (const id of ids) {
      const idx = mockCmsContents.findIndex((c) => c.id === id);
      if (idx >= 0) mockCmsContents.splice(idx, 1);
    }
    return ok(null, '已彻底删除');
  }),
  // ─── 归档 ────────────────────────────────────────────────────────────────
  mock(cmsContentContract.archive, ({ body, ok }) => {
    let count = 0;
    for (const c of mockCmsContents) {
      if (body.ids.includes(c.id) && (c.status === 'published' || c.status === 'offline') && !c.archivedAt) {
        c.archivedAt = mockDateTime();
        count += 1;
      }
    }
    return ok(null, `已归档 ${count} 条（仅已发布/已下线内容可归档）`);
  }),
  mock(cmsContentContract.unarchive, ({ body, ok }) => {
    for (const c of mockCmsContents) {
      if (body.ids.includes(c.id)) c.archivedAt = null;
    }
    return ok(null, `已取消归档 ${body.ids.length} 条`);
  }),
  // ─── 词库检查（敏感词 + 易错词命中清单）─────────────────────────────────
  mock(cmsContentContract.checkText, ({ body, ok }) => {
    const { text } = body;
    const countHits = (word: string) => (word ? text.split(word).length - 1 : 0);
    const sensitive = mockCmsSensitiveWords
      .filter((w) => w.status === 'enabled')
      .map((w) => ({ word: w.word, replaceWith: w.replaceWith ?? null, count: countHits(w.word) }))
      .filter((h) => h.count > 0);
    const errorProne = mockCmsErrorProneWords
      .filter((w) => w.status === 'enabled')
      .map((w) => ({ word: w.word, correction: w.correction, count: countHits(w.word) }))
      .filter((h) => h.count > 0);
    return ok({ sensitive, errorProne });
  }),
  ...(['submit', 'reject', 'offline'] as const).map((action) => mock(cmsContentContract[action], ({ params, ok }) => {
    const content = mockCmsContents.find((c) => c.id === params.id);
    if (!content) return notFound('内容不存在', { status: 404 });
    const statusMap: Record<typeof action, CmsContentStatus> = { submit: 'pending', reject: 'rejected', offline: 'offline' };
    const opActionMap: Record<typeof action, { action: string; label: string }> = {
      submit: { action: 'submitted', label: '提交审核' },
      reject: { action: 'rejected', label: '驳回' },
      offline: { action: 'offlined', label: '下线' },
    };
    const widget = action === 'offline' ? publishedWidgetUsing('content', content.id) : null;
    if (widget) return conflict(`已发布页面部件「${widget.name}」引用了该内容`, { status: 409 });
    if (content.lockedAt) return locked(`内容已被持久锁定：${content.lockReason ?? ''}`, { status: 423 });
    content.status = statusMap[action];
    content.updatedAt = mockDateTime();
    submitMockCmsWidgetSourceRefresh('content', [content.id]);
    mockCmsContentOpLogs.push({
      id: getNextCmsContentOpLogId(), contentId: content.id, action: opActionMap[action].action, actionLabel: opActionMap[action].label,
      detail: null, operatorId: 1, operatorName: 'admin', createdAt: mockDateTime(),
    });
    return ok(content, '操作成功');
  })),
  mock(cmsContentContract.create, ({ body, ok }) => {
    const now = mockDateTime();
    const content: MockContent = {
      id: getNextCmsContentId(),
      siteId: body.siteId,
      channelId: body.channelId,
      modelId: mockCmsChannels.find((c) => c.id === body.channelId)?.modelId ?? null,
      contentType: body.contentType,
      mediaData: body.mediaData,
      title: body.title,
      titleStyle: body.titleStyle,
      subTitle: body.subTitle ?? null,
      shortTitle: body.shortTitle ?? null,
      slug: body.slug ?? null,
      summary: body.summary ?? null,
      coverImage: body.coverImage ?? null,
      coverThumb: null,
      author: body.author ?? null,
      editor: body.editor ?? null,
      source: body.source ?? null,
      sourceUrl: body.sourceUrl ?? null,
      isOriginal: body.isOriginal,
      body: body.body ?? null,
      attachments: body.attachments,
      extend: body.extend,
      externalLink: body.externalLink ?? null,
      detailTemplate: body.detailTemplate ?? null,
      staticPath: body.staticPath ?? null,
      isTop: body.isTop,
      topWeight: body.topWeight,
      topExpireAt: body.topExpireAt ?? null,
      isRecommend: body.isRecommend,
      isHot: body.isHot,
      status: 'draft',
      rejectReason: null,
      publishedAt: null,
      scheduledAt: body.scheduledAt ?? null,
      expireAt: body.expireAt ?? null,
      viewCount: 0,
      likeCount: 0,
      favoriteCount: 0,
      version: 1,
      sort: body.sort,
      seoTitle: body.seoTitle ?? null,
      seoKeywords: body.seoKeywords ?? null,
      seoDescription: body.seoDescription ?? null,
      socialImageAlt: null,
      twitterCreator: null,
      archivedAt: null,
      mappingSourceId: null,
      distributionRuleId: null,
      distributionSourceId: null,
      distributionSourceVersion: null,
      lockedAt: null,
      lockedBy: null,
      lockReason: null,
      tagIds: body.tagIds,
      createdAt: now,
      updatedAt: now,
    };
    mockCmsContents.push(content);
    mockCmsContentOpLogs.push({
      id: getNextCmsContentOpLogId(), contentId: content.id, action: 'created', actionLabel: '创建',
      detail: null, operatorId: 1, operatorName: 'admin', createdAt: now,
    });
    return ok(content, '创建成功');
  }),
  mock(cmsContentContract.update, ({ params, body, ok }) => {
    const idx = mockCmsContents.findIndex((c) => c.id === params.id);
    if (idx === -1) return notFound('内容不存在', { status: 404 });
    if (mockCmsContents[idx].lockedAt) return locked('内容已被持久锁定', { status: 423 });
    const { expectedVersion: _expectedVersion, ...rest } = body;
    Object.assign(mockCmsContents[idx], rest, {
      version: (mockCmsContents[idx].version ?? 1) + 1,
      updatedAt: mockDateTime(),
    });
    submitMockCmsWidgetSourceRefresh('content', [params.id]);
    return ok(mockCmsContents[idx], '更新成功');
  }),
  mock(cmsContentContract.lock, ({ params, body, ok }) => {
    const content = mockCmsContents.find((item) => item.id === params.id);
    if (!content) return notFound('内容不存在', { status: 404 });
    if (content.lockedAt) return badRequest('内容已被持久锁定', { status: 400 });
    const lockedAt = mockDateTime();
    content.lockedAt = lockedAt;
    content.lockedBy = 1;
    content.lockedByName = 'admin';
    content.lockReason = body.reason.trim() || 'Demo 合规锁定';
    content.scheduledAt = null;
    content.version += 1;
    mockCmsContentOpLogs.push({
      id: getNextCmsContentOpLogId(), contentId: content.id, action: 'locked', actionLabel: '持久锁定',
      detail: content.lockReason, operatorId: 1, operatorName: 'admin', createdAt: mockDateTime(),
    });
    return ok({ lockedAt, lockedBy: content.lockedBy, lockReason: content.lockReason }, '锁定成功');
  }),
  mock(cmsContentContract.unlock, ({ params, ok }) => {
    const content = mockCmsContents.find((item) => item.id === params.id);
    if (!content) return notFound('内容不存在', { status: 404 });
    content.lockedAt = null;
    content.lockedBy = null;
    content.lockedByName = null;
    content.lockReason = null;
    content.version += 1;
    mockCmsContentOpLogs.push({
      id: getNextCmsContentOpLogId(), contentId: content.id, action: 'unlocked', actionLabel: '解除锁定',
      detail: null, operatorId: 1, operatorName: 'admin', createdAt: mockDateTime(),
    });
    return ok(null, '解锁成功');
  }),
  // ─── 编辑锁 / 草稿预览（demo 模式恒定成功）───────────────────────────────
  mock(cmsContentContract.acquireEditLock, ({ ok }) => ok({ acquired: true, holder: null })),
  mock(cmsContentContract.releaseEditLock, ({ ok }) => ok(null, '已释放')),
  mock(cmsContentContract.previewLink, ({ params, ok }) =>
    ok({ url: `/__cms/main/preview/${params.id}?exp=0&sig=demo`, expiresAt: mockDateTime() }, 'Demo 模式无前台渲染，链接仅作展示')),
  // ─── 操作日志时间线 ──────────────────────────────────────────────────────
  mock(cmsContentContract.opLogs, ({ params, ok }) =>
    ok(mockCmsContentOpLogs.filter((l) => l.contentId === params.id).sort((a, b) => b.id - a.id))),

  // ═══ 标签 ═══════════════════════════════════════════════════════════════
  mock(cmsTagContract.all, ({ query, ok }) => ok(mockCmsTags.filter((t) => t.siteId === query.siteId))),
  mock(cmsTagContract.list, ({ query, ok, paginate }) => {
    const { siteId, keyword } = query;
    let list = mockCmsTags.filter((t) => t.siteId === siteId);
    if (keyword) list = list.filter((t) => t.name.includes(keyword) || t.slug.includes(keyword));
    return ok(paginate(list));
  }),
  mock(cmsTagContract.detail, ({ params, ok }) => {
    const tag = mockCmsTags.find((t) => t.id === params.id);
    return tag ? ok(tag) : notFound('标签不存在', { status: 404 });
  }),
  mock(cmsTagContract.create, ({ body, ok }) => {
    const now = mockDateTime();
    const tag = {
      id: getNextCmsTagId(),
      siteId: body.siteId,
      name: body.name,
      slug: body.slug,
      groupName: body.groupName ?? null,
      contentCount: 0,
      createdAt: now,
      updatedAt: now,
    };
    mockCmsTags.push(tag);
    return ok(tag, '创建成功');
  }),
  mock(cmsTagContract.update, ({ params, body, ok }) => {
    const idx = mockCmsTags.findIndex((t) => t.id === params.id);
    if (idx === -1) return notFound('标签不存在', { status: 404 });
    Object.assign(mockCmsTags[idx], body, { updatedAt: mockDateTime() });
    return ok(mockCmsTags[idx], '更新成功');
  }),
  mock(cmsTagContract.remove, ({ params, ok }) => {
    const idx = mockCmsTags.findIndex((t) => t.id === params.id);
    if (idx === -1) return notFound('标签不存在', { status: 404 });
    mockCmsTags.splice(idx, 1);
    return ok(null, '删除成功');
  }),

  // ═══ 友情链接分组 ═══════════════════════════════════════════════════════
  mock(cmsFriendLinkContract.groupList, ({ query, ok, paginate }) => {
    const { siteId, keyword } = query;
    let list = mockCmsFriendLinkGroups.filter((g) => g.siteId === siteId);
    if (keyword) list = list.filter((g) => g.name.includes(keyword) || g.code.includes(keyword));
    const withCount = list.map((g) => ({ ...g, linkCount: mockCmsFriendLinks.filter((l) => l.groupId === g.id).length }));
    return ok(paginate(withCount));
  }),
  mock(cmsFriendLinkContract.groupAll, ({ query, ok }) =>
    ok(mockCmsFriendLinkGroups.filter((g) => g.siteId === query.siteId && g.status === 'enabled'))),
  mock(cmsFriendLinkContract.groupCreate, ({ body, ok }) => {
    const now = mockDateTime();
    const group = {
      id: getNextCmsFriendLinkGroupId(),
      siteId: body.siteId,
      name: body.name,
      code: body.code,
      status: body.status,
      sort: body.sort,
      remark: body.remark ?? null,
      linkCount: 0,
      createdAt: now,
      updatedAt: now,
    };
    mockCmsFriendLinkGroups.push(group);
    return ok(group, '创建成功');
  }),
  mock(cmsFriendLinkContract.groupUpdate, ({ params, body, ok }) => {
    const idx = mockCmsFriendLinkGroups.findIndex((g) => g.id === params.id);
    if (idx === -1) return notFound('友链分组不存在', { status: 404 });
    Object.assign(mockCmsFriendLinkGroups[idx], body, { updatedAt: mockDateTime() });
    const group = mockCmsFriendLinkGroups[idx];
    for (const link of mockCmsFriendLinks) if (link.groupId === group.id) link.groupName = group.name;
    return ok(group, '更新成功');
  }),
  mock(cmsFriendLinkContract.groupRemove, ({ params, ok }) => {
    const { id } = params;
    const idx = mockCmsFriendLinkGroups.findIndex((g) => g.id === id);
    if (idx === -1) return notFound('友链分组不存在', { status: 404 });
    mockCmsFriendLinkGroups.splice(idx, 1);
    for (const link of mockCmsFriendLinks) {
      if (link.groupId === id) { link.groupId = null; link.groupName = null; }
    }
    return ok(null, '删除成功');
  }),

  // ═══ 友情链接 ═══════════════════════════════════════════════════════════
  mock(cmsFriendLinkContract.list, ({ query, ok, paginate }) => {
    const { siteId, keyword, groupId } = query;
    let list = mockCmsFriendLinks.filter((l) => l.siteId === siteId);
    if (keyword) list = list.filter((l) => l.name.includes(keyword));
    if (groupId !== undefined) {
      list = list.filter((l) => (groupId === 0 ? l.groupId == null : l.groupId === groupId));
    }
    return ok(paginate(list));
  }),
  mock(cmsFriendLinkContract.create, ({ body, ok }) => {
    const now = mockDateTime();
    const groupId = body.groupId ?? null;
    const link = {
      id: getNextCmsFriendLinkId(),
      siteId: body.siteId,
      groupId,
      groupName: mockCmsFriendLinkGroups.find((g) => g.id === groupId)?.name ?? null,
      name: body.name,
      url: body.url,
      logo: body.logo ?? null,
      status: body.status,
      sort: body.sort,
      remark: body.remark ?? null,
      createdAt: now,
      updatedAt: now,
    };
    mockCmsFriendLinks.push(link);
    return ok(link, '创建成功');
  }),
  mock(cmsFriendLinkContract.update, ({ params, body, ok }) => {
    const idx = mockCmsFriendLinks.findIndex((l) => l.id === params.id);
    if (idx === -1) return notFound('友情链接不存在', { status: 404 });
    Object.assign(mockCmsFriendLinks[idx], body, { updatedAt: mockDateTime() });
    const link = mockCmsFriendLinks[idx];
    link.groupName = mockCmsFriendLinkGroups.find((g) => g.id === link.groupId)?.name ?? null;
    return ok(link, '更新成功');
  }),
  mock(cmsFriendLinkContract.remove, ({ params, ok }) => {
    const idx = mockCmsFriendLinks.findIndex((l) => l.id === params.id);
    if (idx === -1) return notFound('友情链接不存在', { status: 404 });
    mockCmsFriendLinks.splice(idx, 1);
    return ok(null, '删除成功');
  }),

  // ═══ 静态化 / 索引重建（任务中心模拟）═══════════════════════════════════
  mock(cmsStaticContract.build, ({ body, ok }) => {
    const { siteId } = body;
    const site = mockCmsSites.find((s) => s.id === siteId);
    if (!site) return notFound('站点不存在', { status: 404 });
    const contentCount = mockCmsContents.filter((c) => c.siteId === siteId).length;
    const task = createProgressingMockTask({
      taskType: 'cms-publish-build',
      title: `CMS 全站静态化（${site.name}）`,
      payload: { siteId, targetType: 'site', reason: '站点管理手动全站静态化' },
      totalItems: 3 + mockCmsChannels.filter((c) => c.siteId === siteId).length + contentCount,
      itemDelayMs: 400,
    });
    mockCmsPublishingTasks.unshift(Object.assign(task, {
      siteId,
      siteName: site.name,
      siteIds: [siteId],
      siteNames: [site.name],
      targetType: 'site' as const,
      artifactCount: 0,
      failedArtifactCount: 0,
    }));
    return ok(task, '任务已提交，可在任务中心查看进度');
  }),
  mock(cmsSearchContract.reindex, ({ body, ok }) => {
    const siteId = body.siteId ?? null;
    const site = siteId ? mockCmsSites.find((s) => s.id === siteId) : null;
    const task = createProgressingMockTask({
      taskType: 'cms-search-reindex',
      title: site ? `CMS 检索索引重建（${site.name}）` : 'CMS 检索索引重建（全部站点）',
      payload: { siteId },
      totalItems: mockCmsContents.filter((c) => !siteId || c.siteId === siteId).length || 1,
      itemDelayMs: 300,
    });
    return ok(task, '任务已提交，可在任务中心查看进度');
  }),

  // ═══ 数据看板 ═════════════════════════════════════════════════════════════
  mock(cmsDashboardContract.stats, ({ query, ok }) => {
    const { siteId } = query;
    const contents = mockCmsContents.filter((c) => c.siteId === siteId && !isDeleted(c));
    const byStatus = (s: string) => contents.filter((c) => c.status === s).length;
    const today = mockDate();
    const trend = Array.from({ length: 14 }, (_, i) => {
      const d = new Date();
      d.setDate(d.getDate() - (13 - i));
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      return { date: key, count: key === today ? contents.filter((c) => c.status === 'published').length : (i % 5 === 0 ? 1 : 0) };
    });
    const channelCounts = new Map<number, number>();
    for (const c of contents) channelCounts.set(c.channelId, (channelCounts.get(c.channelId) ?? 0) + 1);
    return ok({
      totals: {
        published: byStatus('published'),
        draft: byStatus('draft'),
        pending: byStatus('pending'),
        offline: byStatus('offline'),
        rejected: byStatus('rejected'),
        recycled: mockCmsContents.filter((c) => c.siteId === siteId && isDeleted(c)).length,
      },
      pendingComments: mockCmsComments.filter((c) => c.siteId === siteId && c.status === 'pending').length,
      todayPublished: 0,
      totalViews: contents.reduce((sum, c) => sum + c.viewCount, 0),
      publishTrend: trend,
      topViewed: [...contents]
        .filter((c) => c.status === 'published')
        .sort((a, b) => b.viewCount - a.viewCount)
        .slice(0, 10)
        .map((c) => ({ id: c.id, title: c.title, viewCount: c.viewCount, channelName: mockCmsChannels.find((ch) => ch.id === c.channelId)?.name ?? null })),
      channelDistribution: [...channelCounts.entries()]
        .map(([channelId, count]) => ({ channelId, channelName: mockCmsChannels.find((ch) => ch.id === channelId)?.name ?? `栏目 ${channelId}`, count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 10),
    });
  }),

  // ═══ 检索 ═══════════════════════════════════════════════════════════════
  mock(cmsSearchContract.test, ({ query, ok, paginate }) => {
    const { siteId, keyword: kw } = query;
    const hits = mockCmsContents
      .filter((c) => c.siteId === siteId && c.status === 'published'
        && (c.title.includes(kw) || (c.summary ?? '').includes(kw) || (c.body ?? '').includes(kw)))
      .map((c, i) => ({
        id: c.id,
        siteId: c.siteId,
        channelId: c.channelId,
        channelName: mockCmsChannels.find((ch) => ch.id === c.channelId)?.name ?? null,
        title: c.title,
        titleHighlight: c.title.replaceAll(kw, `<mark>${kw}</mark>`),
        snippet: (c.summary ?? '').replaceAll(kw, `<mark>${kw}</mark>`),
        url: `/${channelPath(c.channelId)}/${c.slug ?? c.id}.html`,
        isExternal: false,
        publishedAt: c.publishedAt,
        rank: 1 - i * 0.05,
      }));
    return ok(paginate(hits));
  }),
  mock(cmsSearchContract.segment, ({ query, ok }) => {
    const { text } = query;
    // Demo 模式简化分词：按 2 字滑窗 + 原词
    const tokens = new Set<string>();
    if (text.length <= 2) tokens.add(text);
    else {
      for (let i = 0; i < text.length - 1; i += 2) tokens.add(text.slice(i, i + 2));
      tokens.add(text);
    }
    return ok({ tokens: [...tokens].filter(Boolean) });
  }),
];

// ═══ P2 handlers ══════════════════════════════════════════════════════════════
export const cmsP2Handlers = [
  // ─── 内容版本 ───────────────────────────────────────────────────────────────
  mock(cmsContentContract.versions, ({ params, ok }) => ok(mockCmsContentVersions.filter((v) => v.contentId === params.id))),
  mock(cmsContentContract.restoreVersion, ({ params, ok }) => {
    const content = mockCmsContents.find((c) => c.id === params.id);
    if (!content) return notFound('内容不存在', { status: 404 });
    return ok(content, '回滚成功');
  }),
  mock(cmsContentContract.versionDiff, ({ params, ok }) => {
    const content = mockCmsContents.find((c) => c.id === params.id);
    const version = mockCmsContentVersions.find((v) => v.id === params.versionId);
    if (!content || !version) return notFound('版本不存在', { status: 404 });
    const beforeTitle = (version.snapshot as { title?: string }).title ?? version.title;
    if (beforeTitle === content.title) return ok([]);
    return ok([{ field: 'title', label: '标题', before: beforeTitle, after: content.title }]);
  }),

  // ─── SEO：重定向 ────────────────────────────────────────────────────────────
  mock(cmsSeoContract.redirectList, ({ query, ok, paginate }) => {
    const { siteId, keyword } = query;
    let list = mockCmsRedirects.filter((r) => r.siteId === siteId);
    if (keyword) list = list.filter((r) => r.fromPath.includes(keyword));
    return ok(paginate(list));
  }),
  mock(cmsSeoContract.redirectCreate, ({ body, ok }) => {
    const now = mockDateTime();
    const row = {
      id: getNextCmsRedirectId(),
      siteId: body.siteId,
      fromPath: body.fromPath,
      toUrl: body.toUrl,
      redirectType: body.redirectType,
      status: body.status,
      remark: body.remark ?? null,
      createdAt: now,
      updatedAt: now,
    };
    mockCmsRedirects.push(row);
    return ok(row, '创建成功');
  }),
  mock(cmsSeoContract.redirectUpdate, ({ params, body, ok }) => {
    const idx = mockCmsRedirects.findIndex((r) => r.id === params.id);
    if (idx === -1) return notFound('重定向规则不存在', { status: 404 });
    Object.assign(mockCmsRedirects[idx], body, { updatedAt: mockDateTime() });
    return ok(mockCmsRedirects[idx], '更新成功');
  }),
  mock(cmsSeoContract.redirectRemove, ({ params, ok }) => {
    const idx = mockCmsRedirects.findIndex((r) => r.id === params.id);
    if (idx === -1) return notFound('重定向规则不存在', { status: 404 });
    mockCmsRedirects.splice(idx, 1);
    return ok(null, '删除成功');
  }),

  // ─── SEO：内链词 ────────────────────────────────────────────────────────────
  mock(cmsSeoContract.linkWordList, ({ query, ok, paginate }) => {
    const { siteId, keyword } = query;
    let list = mockCmsLinkWords.filter((w) => w.siteId === siteId);
    if (keyword) list = list.filter((w) => w.keyword.includes(keyword));
    return ok(paginate(list));
  }),
  mock(cmsSeoContract.linkWordCreate, ({ body, ok }) => {
    const now = mockDateTime();
    const row = {
      id: getNextCmsLinkWordId(),
      siteId: body.siteId,
      keyword: body.keyword,
      url: body.url,
      maxReplaces: body.maxReplaces,
      status: body.status,
      createdAt: now,
      updatedAt: now,
    };
    mockCmsLinkWords.push(row);
    return ok(row, '创建成功');
  }),
  mock(cmsSeoContract.linkWordUpdate, ({ params, body, ok }) => {
    const idx = mockCmsLinkWords.findIndex((w) => w.id === params.id);
    if (idx === -1) return notFound('内链词不存在', { status: 404 });
    Object.assign(mockCmsLinkWords[idx], body, { updatedAt: mockDateTime() });
    return ok(mockCmsLinkWords[idx], '更新成功');
  }),
  mock(cmsSeoContract.linkWordRemove, ({ params, ok }) => {
    const idx = mockCmsLinkWords.findIndex((w) => w.id === params.id);
    if (idx === -1) return notFound('内链词不存在', { status: 404 });
    mockCmsLinkWords.splice(idx, 1);
    return ok(null, '删除成功');
  }),

  // ─── SEO：推送 ─────────────────────────────────────────────────────────────
  mock(cmsSeoContract.push, ({ body, ok }) => {
    const now = mockDateTime();
    mockCmsPushLogs.unshift({
      id: mockCmsPushLogs.length + 1,
      siteId: body.siteId,
      engine: 'baidu',
      urls: body.urls,
      success: true,
      statusCode: 200,
      response: '{"success":' + body.urls.length + ',"remain":99}',
      createdAt: now,
    });
    return ok([
      { engine: 'baidu', submitted: true },
      { engine: 'indexnow', submitted: false, reason: 'Demo 模式未配置 IndexNow Key' },
    ], '推送完成');
  }),
  mock(cmsSeoContract.pushLogs, ({ query, ok, paginate }) => ok(paginate(mockCmsPushLogs.filter((l) => l.siteId === query.siteId)))),

  // ─── 评论 ───────────────────────────────────────────────────────────────────
  mock(cmsCommentContract.pendingCount, ({ query, ok }) =>
    ok({ count: mockCmsComments.filter((c) => c.siteId === query.siteId && c.status === 'pending').length })),
  mock(cmsCommentContract.list, ({ query, ok, paginate }) => {
    const { siteId, status, source } = query;
    let list = mockCmsComments.filter((c) => c.siteId === siteId);
    if (status) list = list.filter((c) => c.status === status);
    if (source === 'member') list = list.filter((c) => c.memberId != null);
    if (source === 'guest') list = list.filter((c) => c.memberId == null);
    return ok(paginate([...list].sort((a, b) => b.id - a.id)));
  }),
  mock(cmsCommentContract.batchDelete, ({ body, ok }) => {
    for (const id of body.ids) {
      const idx = mockCmsComments.findIndex((c) => c.id === id);
      if (idx >= 0) mockCmsComments.splice(idx, 1);
    }
    return ok(null, '删除成功');
  }),
  mock(cmsCommentContract.approve, ({ body, ok }) => {
    for (const c of mockCmsComments) {
      if (body.ids.includes(c.id)) c.status = 'approved';
    }
    return ok(null, '操作成功');
  }),
  mock(cmsCommentContract.reject, ({ body, ok }) => {
    for (const c of mockCmsComments) {
      if (body.ids.includes(c.id)) c.status = 'rejected';
    }
    return ok(null, '操作成功');
  }),

  // ─── 素材中心 ─────────────────────────────────────────────────────────────
  mock(cmsResourceContract.folders, ({ query, ok }) => {
    const rows = mockCmsResourceFolders.filter((folder) => folder.siteId === query.siteId).map((folder) => ({
      ...folder,
      resourceCount: mockCmsResources.filter((resource) => resource.folderId === folder.id).length,
    }));
    return ok(rows);
  }),
  mock(cmsResourceContract.folderCreate, ({ body, ok }) => {
    const folder = {
      id: getNextCmsResourceFolderId(),
      siteId: body.siteId,
      parentId: body.parentId,
      name: body.name,
      sort: body.sort,
      resourceCount: 0,
      createdAt: mockDateTime(),
      updatedAt: mockDateTime(),
    };
    mockCmsResourceFolders.push(folder);
    return ok(folder, '创建成功');
  }),
  mock(cmsResourceContract.folderUpdate, ({ params, body, ok }) => {
    const folder = mockCmsResourceFolders.find((item) => item.id === params.id);
    if (!folder) return notFound('素材文件夹不存在', { status: 404 });
    Object.assign(folder, body, { updatedAt: mockDateTime() });
    return ok(folder, '更新成功');
  }),
  mock(cmsResourceContract.folderRemove, ({ params, ok }) => {
    const { id } = params;
    if (mockCmsResourceFolders.some((folder) => folder.parentId === id) || mockCmsResources.some((resource) => resource.folderId === id)) {
      return badRequest('文件夹非空，请先移动其中的子文件夹和素材', { status: 400 });
    }
    const index = mockCmsResourceFolders.findIndex((folder) => folder.id === id);
    if (index < 0) return notFound('素材文件夹不存在', { status: 404 });
    mockCmsResourceFolders.splice(index, 1);
    return ok(null, '删除成功');
  }),
  mock(cmsResourceContract.governance, ({ body, ok }) => ok(createProgressingMockTask({
    taskType: 'cms-resource-governance',
    title: body.operation === 'scan' ? 'CMS 孤立素材扫描' : 'CMS 孤立素材清理',
    payload: body,
    totalItems: mockCmsResources.filter((resource) => resource.siteId === body.siteId).length || 1,
    itemDelayMs: 250,
  }), '任务已提交')),
  mock(cmsResourceContract.move, ({ body, ok }) => {
    for (const resource of mockCmsResources) {
      if (body.ids.includes(resource.id) && resource.siteId === body.siteId) resource.folderId = body.folderId;
    }
    return ok(createProgressingMockTask({
      taskType: 'cms-resource-governance',
      title: 'CMS 素材批量移动',
      payload: { ...body, operation: 'move' },
      totalItems: body.ids.length || 1,
      itemDelayMs: 150,
    }), '移动任务已提交');
  }),
  mock(cmsResourceContract.references, ({ params, ok }) => {
    const res = mockCmsResources.find((r) => r.id === params.id);
    if (!res) return notFound('素材不存在', { status: 404 });
    return ok(collectMockResourceRefs(res));
  }),
  mock(cmsResourceContract.list, ({ query, ok, paginate }) => {
    const { siteId, type, folderId, keyword } = query;
    let list = mockCmsResources.filter((r) => r.siteId === siteId);
    if (type) list = list.filter((r) => r.type === type);
    if (folderId === 0) list = list.filter((r) => r.folderId == null);
    else if (folderId) list = list.filter((r) => r.folderId === folderId);
    if (keyword) list = list.filter((r) => r.name.includes(keyword));
    const sorted = [...list].sort((a, b) => b.id - a.id)
      .map((r) => ({ ...r, refCount: collectMockResourceRefs(r).length }));
    return ok(paginate(sorted));
  }),
  mock(cmsResourceContract.upload, ({ query, body, ok }) => {
    const siteId = query.siteId ?? 1;
    const folderId = query.folderId ?? null;
    const file = body.get('file');
    if (!(file instanceof File)) return badRequest('请选择要上传的文件', { status: 400 });
    const mime = file.type || 'application/octet-stream';
    let type: (typeof mockCmsResources)[number]['type'] = 'other';
    if (mime.startsWith('image/')) type = 'image';
    else if (mime.startsWith('video/')) type = 'video';
    else if (mime.startsWith('audio/')) type = 'audio';
    else if (mime === 'application/pdf' || mime.startsWith('text/')) type = 'document';
    const idx = Math.floor(Math.random() * 12) + 1;
    const resource = {
      id: getNextCmsResourceId(),
      siteId,
      folderId,
      type,
      name: file.name,
      url: type === 'image' ? `${import.meta.env.BASE_URL}avatars/avatar-${String(idx).padStart(2, '0')}.svg` : `/files/${file.name}`,
      thumbUrl: null,
      fileId: null,
      size: file.size,
      width: type === 'image' ? 128 : null,
      height: type === 'image' ? 128 : null,
      mimeType: mime,
      remark: null,
      // 上传素材由 CMS 持有物理文件，删除时可联动清理
      ownsFile: true,
      createdAt: mockDateTime(),
      updatedAt: mockDateTime(),
    };
    mockCmsResources.unshift(resource);
    return ok(resource, '上传成功');
  }),
  mock(cmsResourceContract.update, ({ params, body, ok }) => {
    const res = mockCmsResources.find((r) => r.id === params.id);
    if (!res) return notFound('素材不存在', { status: 404 });
    if (typeof body.name === 'string') res.name = body.name;
    if (body.remark !== undefined) res.remark = body.remark || null;
    if (body.folderId !== undefined) res.folderId = body.folderId;
    res.updatedAt = mockDateTime();
    return ok(res, '已保存');
  }),
  mock(cmsResourceContract.crop, ({ params, body, ok }) => {
    const res = mockCmsResources.find((r) => r.id === params.id);
    if (!res) return notFound('素材不存在', { status: 404 });
    const dot = res.name.lastIndexOf('.');
    const cropName = dot > 0 ? `${res.name.slice(0, dot)}_crop${res.name.slice(dot)}` : `${res.name}_crop`;
    const cropped = {
      ...res,
      id: getNextCmsResourceId(),
      name: cropName,
      width: body.width,
      height: body.height,
      remark: `裁剪自素材 #${res.id}`,
      createdAt: mockDateTime(),
      updatedAt: mockDateTime(),
    };
    mockCmsResources.unshift(cropped);
    return ok(cropped, '裁剪成功，已另存为新素材');
  }),
  mock(cmsResourceContract.replace, ({ params, body, ok }) => {
    const res = mockCmsResources.find((r) => r.id === params.id);
    if (!res) return notFound('素材不存在', { status: 404 });
    const file = body.get('file');
    if (!(file instanceof File)) return badRequest('请选择要上传的文件', { status: 400 });
    // 句柄化后素材 id 是稳定引用，换文件只改素材行本身，站内引用无需改动
    const idx = Math.floor(Math.random() * 12) + 1;
    res.name = file.name;
    res.url = res.type === 'image' ? `${import.meta.env.BASE_URL}avatars/avatar-${String(idx).padStart(2, '0')}.svg` : `/files/${file.name}`;
    res.size = file.size;
    res.mimeType = file.type || res.mimeType;
    res.updatedAt = mockDateTime();
    return ok(res, '替换成功，引用该素材的位置将自动指向新文件');
  }),
  mock(cmsResourceContract.rebuildRefs, ({ body, ok }) => ok(createProgressingMockTask({
    taskType: 'cms-resource-ref-rebuild',
    title: 'CMS 素材引用索引重建',
    payload: body,
    totalItems: 9,
    itemDelayMs: 150,
  }), '任务已提交')),
  mock(cmsResourceContract.batchDelete, ({ body, ok }) => {
    const { ids } = body;
    for (const id of ids) {
      const res = mockCmsResources.find((r) => r.id === id);
      if (!res) continue;
      const refs = collectMockResourceRefs(res);
      if (refs.length > 0) {
        return badRequest(`素材「${res.name}」仍被 ${refs.length} 处引用，请先处理引用后再删除`, { status: 400 });
      }
    }
    for (const id of ids) {
      const idx = mockCmsResources.findIndex((r) => r.id === id);
      if (idx >= 0) mockCmsResources.splice(idx, 1);
    }
    return ok(null, `已删除 ${ids.length} 个素材`);
  }),

  // ─── 广告 ───────────────────────────────────────────────────────────────────
  mock(cmsAdContract.slots, ({ query, ok }) => ok(mockCmsAdSlots.filter((s) => s.siteId === query.siteId).map((s) => ({
    ...s,
    adCount: mockCmsAds.filter((a) => a.slotId === s.id).length,
  })))),
  mock(cmsAdContract.slotCreate, ({ body, ok }) => {
    const now = mockDateTime();
    const row = {
      id: getNextCmsAdSlotId(),
      siteId: body.siteId,
      code: body.code,
      name: body.name,
      remark: body.remark ?? null,
      adCount: 0,
      createdAt: now,
      updatedAt: now,
    };
    mockCmsAdSlots.push(row);
    return ok(row, '创建成功');
  }),
  mock(cmsAdContract.slotUpdate, ({ params, body, ok }) => {
    const idx = mockCmsAdSlots.findIndex((s) => s.id === params.id);
    if (idx === -1) return notFound('广告位不存在', { status: 404 });
    Object.assign(mockCmsAdSlots[idx], body, { updatedAt: mockDateTime() });
    return ok(mockCmsAdSlots[idx], '更新成功');
  }),
  mock(cmsAdContract.slotRemove, ({ params, ok }) => {
    const { id } = params;
    if (mockCmsAds.some((a) => a.slotId === id)) {
      return badRequest('广告位下存在广告，请先删除广告', { status: 400 });
    }
    const idx = mockCmsAdSlots.findIndex((s) => s.id === id);
    if (idx === -1) return notFound('广告位不存在', { status: 404 });
    mockCmsAdSlots.splice(idx, 1);
    return ok(null, '删除成功');
  }),
  mock(cmsAdContract.list, ({ query, ok, paginate }) => {
    const { siteId, slotId } = query;
    const siteSlotIds = new Set(mockCmsAdSlots.filter((s) => s.siteId === siteId).map((s) => s.id));
    let list = mockCmsAds.filter((a) => siteSlotIds.has(a.slotId));
    if (slotId) list = list.filter((a) => a.slotId === slotId);
    return ok(paginate(list));
  }),
  mock(cmsAdContract.create, ({ body, ok }) => {
    const now = mockDateTime();
    const slot = mockCmsAdSlots.find((s) => s.id === body.slotId);
    const row = {
      id: getNextCmsAdId(),
      slotId: body.slotId,
      slotName: slot?.name ?? null,
      name: body.name,
      image: body.image ?? null,
      linkUrl: body.linkUrl ?? null,
      startAt: body.startAt ?? null,
      endAt: body.endAt ?? null,
      clickCount: 0,
      viewCount: 0,
      sort: body.sort,
      status: body.status,
      createdAt: now,
      updatedAt: now,
    };
    mockCmsAds.push(row);
    return ok(row, '创建成功');
  }),
  mock(cmsAdContract.update, ({ params, body, ok }) => {
    const idx = mockCmsAds.findIndex((a) => a.id === params.id);
    if (idx === -1) return notFound('广告不存在', { status: 404 });
    Object.assign(mockCmsAds[idx], body, { updatedAt: mockDateTime() });
    return ok(mockCmsAds[idx], '更新成功');
  }),
  mock(cmsAdContract.remove, ({ params, ok }) => {
    const idx = mockCmsAds.findIndex((a) => a.id === params.id);
    if (idx === -1) return notFound('广告不存在', { status: 404 });
    mockCmsAds.splice(idx, 1);
    return ok(null, '删除成功');
  }),

  // ─── 表单 ───────────────────────────────────────────────────────────────────
  mock(cmsFormContract.submissions, ({ params, ok, paginate }) => {
    const list = mockCmsFormSubmissions.filter((s) => s.formId === params.id);
    return ok(paginate([...list].sort((a, b) => b.id - a.id)));
  }),
  mock(cmsFormContract.deleteSubmissions, ({ params, body, ok }) => {
    for (const id of body.ids) {
      const idx = mockCmsFormSubmissions.findIndex((s) => s.formId === params.id && s.id === id);
      if (idx >= 0) mockCmsFormSubmissions.splice(idx, 1);
    }
    return ok(null, '删除成功');
  }),
  mock(cmsFormContract.list, ({ query, ok, paginate }) => {
    const { siteId, keyword } = query;
    let list = mockCmsForms.filter((f) => f.siteId === siteId);
    if (keyword) list = list.filter((f) => f.name.includes(keyword));
    return ok(paginate(list.map((f) => redactMockForm({ ...f, submissionCount: mockCmsFormSubmissions.filter((s) => s.formId === f.id).length }))));
  }),
  mock(cmsFormContract.create, ({ body, ok }) => {
    const now = mockDateTime();
    const row: CmsForm & { submissionCount: number } = {
      id: getNextCmsFormId(),
      siteId: body.siteId,
      code: body.code,
      name: body.name,
      fields: body.fields.map((f) => ({
        name: f.name,
        label: f.label,
        fieldType: f.fieldType,
        required: f.required,
        options: f.options ?? null,
        minLength: f.minLength ?? null,
        maxLength: f.maxLength ?? null,
        pattern: f.pattern ?? null,
        min: f.min ?? null,
        max: f.max ?? null,
        errorMessage: f.errorMessage ?? null,
      })),
      successMessage: body.successMessage ?? null,
      notifyEmail: body.notifyEmail ?? null,
      captchaProvider: body.captchaProvider,
      turnstileSiteKey: body.turnstileSiteKey ?? null,
      turnstileSecret: body.turnstileSecret || null,
      status: body.status,
      submissionCount: 0,
      createdAt: now,
      updatedAt: now,
    };
    mockCmsForms.push(row);
    return ok(redactMockForm(row), '创建成功');
  }),
  mock(cmsFormContract.update, ({ params, body, ok }) => {
    const idx = mockCmsForms.findIndex((f) => f.id === params.id);
    if (idx === -1) return notFound('表单不存在', { status: 404 });
    const { turnstileSecret, ...patch } = body;
    const secretPatch = turnstileSecret === '' || turnstileSecret === CMS_SECRET_MASK || turnstileSecret === undefined
      ? {}
      : { turnstileSecret };
    Object.assign(mockCmsForms[idx], patch, secretPatch, { updatedAt: mockDateTime() });
    return ok(redactMockForm(mockCmsForms[idx]), '更新成功');
  }),
  mock(cmsFormContract.remove, ({ params, ok }) => {
    const idx = mockCmsForms.findIndex((f) => f.id === params.id);
    if (idx === -1) return notFound('表单不存在', { status: 404 });
    mockCmsForms.splice(idx, 1);
    return ok(null, '删除成功');
  }),

  // ─── 敏感词 ─────────────────────────────────────────────────────────────────
  mock(cmsSensitiveWordContract.list, ({ query, ok, paginate }) => {
    const { keyword } = query;
    let list = [...mockCmsSensitiveWords];
    if (keyword) list = list.filter((w) => w.word.includes(keyword));
    return ok(paginate(list));
  }),
  mock(cmsSensitiveWordContract.create, ({ body, ok }) => {
    const now = mockDateTime();
    const row = {
      id: getNextCmsSensitiveWordId(),
      word: body.word,
      replaceWith: body.replaceWith ?? null,
      status: body.status,
      createdAt: now,
      updatedAt: now,
    };
    mockCmsSensitiveWords.push(row);
    return ok(row, '创建成功');
  }),
  mock(cmsSensitiveWordContract.update, ({ params, body, ok }) => {
    const idx = mockCmsSensitiveWords.findIndex((w) => w.id === params.id);
    if (idx === -1) return notFound('敏感词不存在', { status: 404 });
    Object.assign(mockCmsSensitiveWords[idx], body, { updatedAt: mockDateTime() });
    return ok(mockCmsSensitiveWords[idx], '更新成功');
  }),
  mock(cmsSensitiveWordContract.remove, ({ params, ok }) => {
    const idx = mockCmsSensitiveWords.findIndex((w) => w.id === params.id);
    if (idx === -1) return notFound('敏感词不存在', { status: 404 });
    mockCmsSensitiveWords.splice(idx, 1);
    return ok(null, '删除成功');
  }),

  // ═══ 易错词库 ═════════════════════════════════════════════════════════════
  mock(cmsErrorProneWordContract.list, ({ query, ok, paginate }) => {
    const { keyword, status } = query;
    let list = [...mockCmsErrorProneWords];
    if (keyword) list = list.filter((w) => w.word.includes(keyword) || w.correction.includes(keyword));
    if (status) list = list.filter((w) => w.status === status);
    return ok(paginate(list));
  }),
  mock(cmsErrorProneWordContract.create, ({ body, ok }) => {
    if (mockCmsErrorProneWords.some((w) => w.word === body.word)) {
      return badRequest('该易错词已存在', { status: 400 });
    }
    const now = mockDateTime();
    const row = {
      id: getNextCmsErrorProneWordId(),
      word: body.word,
      correction: body.correction,
      status: body.status,
      remark: body.remark ?? null,
      createdAt: now,
      updatedAt: now,
    };
    mockCmsErrorProneWords.push(row);
    return ok(row, '创建成功');
  }),
  mock(cmsErrorProneWordContract.update, ({ params, body, ok }) => {
    const idx = mockCmsErrorProneWords.findIndex((w) => w.id === params.id);
    if (idx === -1) return notFound('易错词不存在', { status: 404 });
    Object.assign(mockCmsErrorProneWords[idx], body, { updatedAt: mockDateTime() });
    return ok(mockCmsErrorProneWords[idx], '更新成功');
  }),
  mock(cmsErrorProneWordContract.remove, ({ params, ok }) => {
    const idx = mockCmsErrorProneWords.findIndex((w) => w.id === params.id);
    if (idx === -1) return notFound('易错词不存在', { status: 404 });
    mockCmsErrorProneWords.splice(idx, 1);
    return ok(null, '删除成功');
  }),

  // ═══ 栏目运维（合并 / 清空 / 批量新增）═════════════════════════════════════
  mock(cmsChannelContract.merge, ({ body, ok }) => {
    const { sourceIds, targetId } = body;
    const target = mockCmsChannels.find((c) => c.id === targetId);
    if (!target) return notFound('目标栏目不存在', { status: 404 });
    let moved = 0;
    for (const c of mockCmsContents) {
      if (sourceIds.includes(c.channelId)) {
        c.channelId = targetId;
        moved += 1;
      }
    }
    for (const id of sourceIds) {
      const idx = mockCmsChannels.findIndex((c) => c.id === id);
      if (idx >= 0) mockCmsChannels.splice(idx, 1);
    }
    return ok(null, `合并完成，已迁移 ${moved} 条内容`);
  }),
  mock(cmsChannelContract.batchCreate, ({ body, ok }) => {
    const { names, parentId } = body;
    const parentPath = parentId ? (mockCmsChannels.find((c) => c.id === parentId)?.path ?? '') : '';
    const now = mockDateTime();
    for (const [i, name] of names.entries()) {
      const slug = `channel-${Date.now()}-${i}`;
      mockCmsChannels.push({
        id: getNextCmsChannelId(),
        siteId: body.siteId,
        parentId,
        modelId: null,
        modelName: null,
        name,
        code: slug,
        slug,
        path: parentPath ? `${parentPath}/${slug}` : slug,
        type: 'list',
        linkUrl: null,
        listTemplate: null,
        detailTemplate: null,
        staticMode: 'inherit',
        detailPathRule: 'none',
        pageSize: 20,
        pageContent: null,
        seoTitle: null,
        seoKeywords: null,
        seoDescription: null,
        image: null,
        visible: true,
        status: 'enabled',
        sort: 0,
        settings: {},
        createdAt: now,
        updatedAt: now,
      });
    }
    return ok(null, `已创建 ${names.length} 个栏目`);
  }),
  mock(cmsChannelContract.clear, ({ params, ok }) => {
    let count = 0;
    for (const c of mockCmsContents) {
      if (c.channelId === params.id && !isDeleted(c)) {
        setDeleted(c, true);
        c.status = 'offline';
        count += 1;
      }
    }
    return ok(null, `已将 ${count} 条内容移入回收站`);
  }),

  // ═══ 访问统计 ═════════════════════════════════════════════════════════════
  mock(cmsStatContract.visits, ({ query, ok }) => {
    const days = query.days ?? 30;
    const trend = Array.from({ length: days }, (_, i) => {
      const d = new Date(Date.now() - (days - 1 - i) * 86400_000);
      const pv = 80 + Math.round(Math.sin(i / 3) * 30) + (i % 7 === 5 ? 40 : 0);
      return { date: mockDate(d), pv, uv: Math.round(pv * 0.6) };
    });
    const today = trend[trend.length - 1];
    const yesterday = trend[trend.length - 2] ?? today;
    return ok({
      today: { pv: today.pv, uv: today.uv, ips: Math.round(today.uv * 0.9) },
      yesterday: { pv: yesterday.pv, uv: yesterday.uv, ips: Math.round(yesterday.uv * 0.9) },
      totalPv: trend.reduce((s, t) => s + t.pv, 0),
      trend,
      topContents: mockCmsContents.filter((c) => c.status === 'published').slice(0, 10).map((c, i) => ({
        contentId: c.id, title: c.title, pv: 320 - i * 40, uv: 210 - i * 26,
      })),
      devices: [
        { deviceType: 'pc', pv: 1450 },
        { deviceType: 'mobile', pv: 980 },
        { deviceType: 'bot', pv: 260 },
      ],
      referrers: [
        { host: 'www.google.com', pv: 320 },
        { host: 'www.baidu.com', pv: 260 },
        { host: 'github.com', pv: 90 },
      ],
    });
  }),
  mock(cmsStatContract.search, ({ query, ok }) => {
    const days = query.days ?? 30;
    const trend = Array.from({ length: days }, (_, i) => {
      const d = new Date(Date.now() - (days - 1 - i) * 86400_000);
      return { date: mockDate(d), count: 6 + (i % 5) };
    });
    return ok({
      total: trend.reduce((s, t) => s + t.count, 0),
      trend,
      topKeywords: [
        { keyword: 'CMS', count: 46, avgResults: 5 },
        { keyword: '静态化', count: 31, avgResults: 3 },
        { keyword: '全文检索', count: 22, avgResults: 2 },
      ],
      noResultKeywords: [
        { keyword: '小程序模板', count: 9 },
        { keyword: '价格表', count: 5 },
      ],
    });
  }),

  // ─── 站点授权用户 ───────────────────────────────────────────────────────────
  mock(cmsSiteContract.users, ({ ok }) => ok(authorizedEditorUsers())),
  mock(cmsSiteContract.setUsers, ({ ok }) => ok(null, '保存成功')),

  // 开放应用授权（Headless 写入的 fail-closed 边界）
  mock(cmsSiteContract.openGrants, ({ params, ok }) => ok(mockCmsOpenGrants.filter((g) => g.siteId === params.id))),
  mock(cmsSiteContract.saveOpenGrant, ({ params, body, ok }) => {
    const siteId = params.id;
    const existing = mockCmsOpenGrants.find((g) => g.siteId === siteId && g.clientId === body.clientId);
    const row = {
      id: existing?.id ?? getNextCmsOpenGrantId(),
      clientId: body.clientId,
      appName: existing?.appName ?? '演示开放应用',
      siteId,
      siteName: mockCmsSites.find((s) => s.id === siteId)?.name ?? null,
      channelIds: body.channelIds,
      canPublish: body.canPublish,
      status: body.status,
      remark: body.remark ?? null,
      createdAt: existing?.createdAt ?? mockDateTime(),
      updatedAt: mockDateTime(),
    };
    if (existing) Object.assign(existing, row);
    else mockCmsOpenGrants.unshift(row);
    return ok(row, '已保存');
  }),
  mock(cmsSiteContract.removeOpenGrant, ({ params, ok }) => {
    const idx = mockCmsOpenGrants.findIndex((g) => g.id === params.grantId);
    if (idx < 0) return notFound('授权不存在', { status: 404 });
    mockCmsOpenGrants.splice(idx, 1);
    return ok(null, '已删除');
  }),

  // ─── 企业级治理 ─────────────────────────────────────────────────────────────
  // 栏目授权用户（栏目级数据权限）
  mock(cmsChannelContract.users, ({ ok }) => ok(authorizedEditorUsers())),
  mock(cmsChannelContract.setUsers, ({ ok }) => ok(null, '保存成功')),
  // 站点导出（JSON 附件）/ 导入
  mock(cmsSiteContract.export, ({ params }) => {
    const site = mockCmsSites.find((s) => s.id === params.id);
    const pkg = {
      version: 2,
      exportedAt: mockDateTime(),
      site: { name: site?.name ?? '演示站点', code: site?.code ?? 'demo' },
      resourceFolders: [],
      resources: [],
      channels: [], tags: [], contents: [], contentTags: [], contentChannels: [], contentRelations: [],
      friendLinks: [], redirects: [], linkWords: [], adSlots: [], ads: [], forms: [],
      pages: mockCmsPages.filter((page) => page.siteId === params.id),
      widgets: mockCmsWidgets.filter((widget) => widget.siteId === params.id),
      widgetSlots: mockCmsWidgetRefs.filter((ref) => ref.siteId === params.id && ref.ownerType === 'theme_slot'),
    };
    return new HttpResponse(JSON.stringify(pkg, null, 2), {
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Disposition': `attachment; filename="cms-site-${pkg.site.code}.json"`,
      },
    });
  }),
  mock(cmsSiteContract.import, ({ body, ok }) => {
    const pkg = body as { site?: { name?: string; code?: string }; widgets?: unknown[]; widgetSlots?: unknown[] };
    const widgetCount = pkg.widgets?.length ?? 0;
    const skippedWidgetSlots = pkg.widgetSlots?.length ?? 0;
    return ok({
      siteId: 999,
      siteName: pkg.site?.name ?? '导入站点',
      siteCode: `${pkg.site?.code ?? 'imported'}-2`,
      counts: {
        channels: 0, tags: 0, contents: 0, friendLinks: 0, redirects: 0, linkWords: 0, adSlots: 0, ads: 0, forms: 0,
        interactions: 0, interactionQuestions: 0, resourceFolders: 0, resources: 0, models: 0, modelFields: 0, friendLinkGroups: 0,
        widgets: widgetCount, pages: 0,
      },
      skipped: { widgetSlots: skippedWidgetSlots },
      warnings: [
        ...(widgetCount > 0 ? [`已导入 ${widgetCount} 个页面部件并统一降级为草稿，请审核后重新发布`] : []),
        ...(skippedWidgetSlots > 0 ? [`已跳过 ${skippedWidgetSlots} 个主题页面部件插槽绑定，请在部件发布后重新绑定`] : []),
      ],
    }, '站点导入成功，内容已统一转为草稿');
  }),
];

// ─── P3：词典 / 热词 / 批量操作 / 统计开通 / 死链检测 ──────────────────────────
export const cmsP3Handlers = [
  // 自定义词典
  mock(cmsSearchContract.wordList, ({ query, ok, paginate }) => {
    const { siteId, keyword, type, groupName, status } = query;
    let list = mockCmsSearchWords.filter((word) => word.siteId === siteId);
    if (keyword) list = list.filter((w) => w.word.includes(keyword));
    if (type) list = list.filter((word) => word.type === type);
    if (groupName) list = list.filter((word) => word.groupName === groupName);
    if (status) list = list.filter((word) => word.status === status);
    return ok(paginate(list));
  }),
  mock(cmsSearchContract.wordCreate, ({ body, ok }) => {
    const now = mockDateTime();
    const row = {
      id: getNextCmsSearchWordId(),
      siteId: body.siteId,
      word: body.word,
      type: body.type,
      groupName: body.groupName,
      weight: body.weight,
      status: body.status,
      remark: body.remark ?? null,
      createdAt: now,
      updatedAt: now,
    };
    mockCmsSearchWords.push(row);
    return ok(row, '创建成功');
  }),
  mock(cmsSearchContract.wordBatchUpdate, ({ body, ok }) => {
    const { ids } = body;
    for (const word of mockCmsSearchWords) {
      if (!ids.includes(word.id)) continue;
      if (body.status !== undefined) word.status = body.status;
      if (body.groupName !== undefined) word.groupName = body.groupName;
    }
    return ok(null, `已更新 ${ids.length} 个词条`);
  }),
  mock(cmsSearchContract.wordBatchRemove, ({ body, ok }) => {
    const { ids } = body;
    for (let index = mockCmsSearchWords.length - 1; index >= 0; index--) {
      if (ids.includes(mockCmsSearchWords[index].id)) mockCmsSearchWords.splice(index, 1);
    }
    return ok(null, `已删除 ${ids.length} 个词条`);
  }),
  mock(cmsSearchContract.wordUpdate, ({ params, body, ok }) => {
    const idx = mockCmsSearchWords.findIndex((w) => w.id === params.id);
    if (idx === -1) return notFound('词条不存在', { status: 404 });
    Object.assign(mockCmsSearchWords[idx], body, { updatedAt: mockDateTime() });
    return ok(mockCmsSearchWords[idx], '更新成功');
  }),
  mock(cmsSearchContract.wordRemove, ({ params, ok }) => {
    const idx = mockCmsSearchWords.findIndex((w) => w.id === params.id);
    if (idx === -1) return notFound('词条不存在', { status: 404 });
    mockCmsSearchWords.splice(idx, 1);
    return ok(null, '删除成功（当前站点词典已重建）');
  }),

  // 搜索热词
  mock(cmsSearchContract.hotwordGroups, ({ query, ok }) => ok(mockCmsHotwordGroups.filter((group) => group.siteId === query.siteId))),
  mock(cmsSearchContract.hotwordGroupCreate, ({ body, ok }) => {
    const row = { id: getNextCmsHotwordGroupId(), siteId: body.siteId, name: body.name, sort: body.sort, status: body.status, createdAt: mockDateTime(), updatedAt: mockDateTime() };
    mockCmsHotwordGroups.push(row);
    return ok(row, '创建成功');
  }),
  mock(cmsSearchContract.hotwordGroupUpdate, ({ params, body, ok }) => {
    const row = mockCmsHotwordGroups.find((group) => group.id === params.id);
    if (!row) return notFound('热词分组不存在', { status: 404 });
    Object.assign(row, body, { updatedAt: mockDateTime() });
    return ok(row, '更新成功');
  }),
  mock(cmsSearchContract.hotwordGroupRemove, ({ params, ok }) => {
    const { id } = params;
    if (mockCmsHotKeywords.some((word) => word.groupId === id)) return badRequest('分组内仍有热词', { status: 400 });
    const index = mockCmsHotwordGroups.findIndex((group) => group.id === id);
    if (index < 0) return notFound('热词分组不存在', { status: 404 });
    mockCmsHotwordGroups.splice(index, 1);
    return ok(null, '删除成功');
  }),
  mock(cmsSearchContract.hotKeywords, ({ query, ok }) => {
    const { siteId, groupId, keyword } = query;
    let list = mockCmsHotKeywords.filter((word) => word.siteId === siteId);
    if (groupId) list = list.filter((word) => word.groupId === groupId);
    if (keyword) list = list.filter((word) => word.keyword.includes(keyword));
    return ok(list);
  }),
  mock(cmsSearchContract.hotwordCreate, ({ body, ok }) => {
    const groupId = body.groupId ?? null;
    mockCmsHotKeywords.push({
      id: getNextCmsHotwordId(), siteId: body.siteId, groupId,
      groupName: mockCmsHotwordGroups.find((group) => group.id === groupId)?.name ?? null,
      keyword: body.keyword, count: 0, sort: body.sort,
      status: body.status,
    });
    return ok(null, '创建成功');
  }),
  mock(cmsSearchContract.hotwordUpdate, ({ params, body, ok }) => {
    const row = mockCmsHotKeywords.find((word) => word.id === params.id);
    if (!row) return notFound('热词不存在', { status: 404 });
    Object.assign(row, body);
    row.groupName = mockCmsHotwordGroups.find((group) => group.id === row.groupId)?.name ?? null;
    return ok(null, '更新成功');
  }),
  mock(cmsSearchContract.hotwordRemove, ({ params, ok }) => {
    const index = mockCmsHotKeywords.findIndex((word) => word.id === params.id);
    if (index < 0) return notFound('热词不存在', { status: 404 });
    mockCmsHotKeywords.splice(index, 1);
    return ok(null, '删除成功');
  }),
  mock(cmsSearchContract.clearHotKeywords, ({ ok }) => {
    mockCmsHotKeywords.length = 0;
    return ok(null, '已清空');
  }),

  // 内容批量操作
  mock(cmsContentContract.batchMove, ({ body, ok }) => {
    const { ids, channelId } = body;
    for (const c of mockCmsContents) {
      if (ids.includes(c.id)) c.channelId = channelId;
    }
    submitMockCmsWidgetSourceRefresh('content', ids);
    return ok(null, `已移动 ${ids.length} 条内容`);
  }),
  mock(cmsContentContract.batchFlags, ({ body, ok }) => {
    const { ids } = body;
    for (const c of mockCmsContents) {
      if (!ids.includes(c.id)) continue;
      if (typeof body.isTop === 'boolean') c.isTop = body.isTop;
      if (typeof body.isRecommend === 'boolean') c.isRecommend = body.isRecommend;
      if (typeof body.isHot === 'boolean') c.isHot = body.isHot;
      if (typeof body.isOriginal === 'boolean') c.isOriginal = body.isOriginal;
    }
    return ok(null, `已更新 ${ids.length} 条内容`);
  }),
  mock(cmsContentContract.batchTag, ({ body, ok }) => {
    const { ids, tagIds } = body;
    for (const c of mockCmsContents) {
      if (ids.includes(c.id)) c.tagIds = Array.from(new Set([...c.tagIds, ...tagIds]));
    }
    return ok(null, `已打标 ${ids.length} 条内容`);
  }),
  mock(cmsContentContract.batchStatus, ({ body, ok }) => {
    const { ids, action } = body;
    const reason = body.reason?.trim() ?? '';
    const okIds: number[] = [];
    const failed: { id: number; reason: string }[] = [];
    for (const id of ids) {
      const content = mockCmsContents.find((c) => c.id === id);
      if (!content) {
        failed.push({ id, reason: '内容不存在' });
        continue;
      }
      if (action === 'submit') {
        if (content.status === 'draft' || content.status === 'rejected') {
          content.status = 'pending';
          okIds.push(id);
        } else {
          failed.push({ id, reason: `当前状态（${content.status}）不允许提交审核` });
        }
      } else if (action === 'publish') {
        if (content.status !== 'published' && !content.archivedAt) {
          content.status = 'published';
          content.publishedAt = mockDateTime();
          okIds.push(id);
        } else {
          failed.push({ id, reason: '内容已发布或不可发布' });
        }
      } else if (action === 'reject') {
        if (content.status === 'pending') {
          content.status = 'rejected';
          content.rejectReason = reason || '批量驳回';
          okIds.push(id);
        } else {
          failed.push({ id, reason: '仅待审核内容可驳回' });
        }
      } else if (content.status === 'published') {
        content.status = 'offline';
        okIds.push(id);
      } else {
        failed.push({ id, reason: '仅已发布内容可下线' });
      }
    }
    const message = failed.length === 0
      ? `已处理 ${okIds.length} 条内容`
      : `成功 ${okIds.length} 条，失败 ${failed.length} 条`;
    return ok({ okIds, failed }, message);
  }),
  mock(cmsContentContract.distribute, ({ body, ok }) => {
    const { ids } = body;
    const now = mockDateTime();
    const sources = mockCmsContents.filter((c) => ids.includes(c.id));
    const disallowed = sources.find((content) => content.status !== 'published' || content.archivedAt);
    if (disallowed) return badRequest(`内容 #${disallowed.id} 不是可分发的已发布内容`, { status: 400 });
    for (const src of sources) {
      mockCmsContents.push({
        ...src,
        id: getNextCmsContentId(),
        siteId: body.targetSiteId,
        channelId: body.targetChannelId,
        status: 'draft',
        publishedAt: null,
        viewCount: 0,
        likeCount: 0,
        favoriteCount: 0,
        version: 1,
        tagIds: [],
        body: sanitizeMockCmsHtml(src.body),
        extend: structuredClone(src.extend),
        mappingSourceId: null,
        mappingSourceTitle: null,
        distributionRuleId: null,
        distributionSourceId: null,
        distributionSourceVersion: null,
        archivedAt: null,
        createdAt: now,
        updatedAt: now,
      });
    }
    return ok(null, `已分发 ${ids.length} 条内容（目标站点草稿箱）`);
  }),
  mock(cmsContentContract.duplicate, ({ params, body, ok }) => {
    const src = mockCmsContents.find((c) => c.id === params.id);
    if (!src) return notFound('内容不存在', { status: 404 });
    const now = mockDateTime();
    const copy = {
      ...src,
      id: getNextCmsContentId(),
      channelId: body.targetChannelId ?? src.channelId,
      title: `${src.title}（副本）`,
      slug: null,
      status: 'draft' as CmsContentStatus,
      publishedAt: null,
      viewCount: 0,
      tagIds: [...src.tagIds],
      createdAt: now,
      updatedAt: now,
    };
    mockCmsContents.push(copy);
    return ok(copy, '已复制为草稿');
  }),

  // 站点开通统计
  mock(cmsSiteContract.enableAnalytics, ({ params, ok }) => {
    const site = mockCmsSites.find((s) => s.id === params.id);
    if (!site) return notFound('站点不存在', { status: 404 });
    const settings = { ...(site.settings ?? {}) } as Record<string, unknown>;
    if (typeof settings.analyticsSiteKey === 'string' && settings.analyticsSiteKey) {
      return ok({ siteKey: settings.analyticsSiteKey, created: false }, '已开通');
    }
    const siteKey = `mock-key-${site.code}`;
    settings.analyticsSiteKey = siteKey;
    site.settings = settings;
    return ok({ siteKey, created: true }, '开通成功');
  }),

  // 图片上传（水印/缩略图管道）
  mock(cmsUploadContract.uploadImage, ({ ok }) => ok({
    url: 'https://picsum.photos/seed/cms-upload/800/450',
    thumbUrl: 'https://picsum.photos/seed/cms-upload/400/225',
    fileId: 'mock-file-id',
    width: 800,
    height: 450,
    watermarked: false,
  }, '上传成功')),

  // 死链检测（复用任务中心 mock 进度模拟）
  mock(cmsSeoContract.deadlinkCheck, ({ ok }) => ok(createProgressingMockTask({
    taskType: 'cms-deadlink-check',
    title: 'CMS 死链检测',
    totalItems: 30,
  }), '任务已提交')),

  // ─── 采集中心 ───────────────────────────────────────────────────────────────
  mock(cmsCollectContract.items, ({ params, ok, paginate }) => ok(paginate(mockCmsCollectItems.filter((x) => x.ruleId === params.id)))),
  mock(cmsCollectContract.run, ({ ok }) => ok(createProgressingMockTask({
    taskType: 'cms-collect-run',
    title: 'CMS 采集执行',
    totalItems: 20,
  }), '任务已提交')),
  mock(cmsCollectContract.list, ({ query, ok, paginate }) => {
    const { siteId, keyword } = query;
    let list = mockCmsCollectRules.filter((r) => r.siteId === siteId);
    if (keyword) list = list.filter((r) => r.name.includes(keyword));
    return ok(paginate(list));
  }),
  mock(cmsCollectContract.create, ({ body, ok }) => {
    const now = mockDateTime();
    const row = {
      id: getNextCmsCollectRuleId(),
      siteId: body.siteId,
      channelId: body.channelId,
      channelName: mockCmsChannels.find((c) => c.id === body.channelId)?.name ?? null,
      name: body.name,
      listUrl: body.listUrl,
      pageStart: body.pageStart,
      pageEnd: body.pageEnd,
      listSelector: body.listSelector,
      titleSelector: body.titleSelector,
      bodySelector: body.bodySelector,
      summarySelector: body.summarySelector || null,
      coverSelector: body.coverSelector || null,
      removeSelectors: body.removeSelectors,
      autoPublish: body.autoPublish,
      localizeImages: body.localizeImages,
      maxItems: body.maxItems,
      status: body.status,
      lastRunAt: null,
      remark: body.remark || null,
      createdAt: now,
      updatedAt: now,
    };
    mockCmsCollectRules.push(row);
    return ok(row, '创建成功');
  }),
  mock(cmsCollectContract.update, ({ params, body, ok }) => {
    const idx = mockCmsCollectRules.findIndex((r) => r.id === params.id);
    if (idx === -1) return notFound('采集规则不存在', { status: 404 });
    Object.assign(mockCmsCollectRules[idx], body, { updatedAt: mockDateTime() });
    return ok(mockCmsCollectRules[idx], '更新成功');
  }),
  mock(cmsCollectContract.remove, ({ params, ok }) => {
    const idx = mockCmsCollectRules.findIndex((r) => r.id === params.id);
    if (idx === -1) return notFound('采集规则不存在', { status: 404 });
    mockCmsCollectRules.splice(idx, 1);
    return ok(null, '删除成功');
  }),
];

// ─── 页面搭建 ─────────────────────────────────────────────────────────────────
export const cmsP6Handlers = [
  mock(cmsPageContract.detail, ({ params, ok }) => {
    const row = mockCmsPages.find((p) => p.id === params.id);
    return row ? ok(row) : notFound('页面不存在', { status: 404 });
  }),
  mock(cmsPageContract.list, ({ query, ok, paginate }) => {
    const { siteId, keyword } = query;
    let list = mockCmsPages.filter((p) => p.siteId === siteId);
    if (keyword) list = list.filter((p) => p.name.includes(keyword) || p.slug.includes(keyword));
    return ok(paginate(list));
  }),
  mock(cmsPageContract.create, ({ body, ok }) => {
    const now = mockDateTime();
    const row = {
      id: getNextCmsPageId(),
      siteId: body.siteId,
      name: body.name,
      slug: body.slug,
      path: body.path?.trim() || null,
      isHome: body.isHome,
      blocks: body.blocks,
      requiresDynamic: body.blocks.some((block) => ['guest', 'member'].includes(block.displayCondition?.audience ?? 'always')),
      seoTitle: body.seoTitle || null,
      seoKeywords: body.seoKeywords || null,
      seoDescription: body.seoDescription || null,
      status: body.status,
      remark: body.remark || null,
      createdAt: now,
      updatedAt: now,
    };
    mockCmsPages.push(row);
    syncMockPageWidgetRefs(row);
    return ok(row, '创建成功');
  }),
  mock(cmsPageContract.remove, ({ params, ok }) => {
    const idx = mockCmsPages.findIndex((p) => p.id === params.id);
    if (idx === -1) return notFound('页面不存在', { status: 404 });
    for (let refIndex = mockCmsWidgetRefs.length - 1; refIndex >= 0; refIndex -= 1) {
      const ref = mockCmsWidgetRefs[refIndex];
      if (ref.ownerType === 'page' && ref.ownerId === params.id) mockCmsWidgetRefs.splice(refIndex, 1);
    }
    mockCmsPages.splice(idx, 1);
    return ok(null, '删除成功');
  }),
];
